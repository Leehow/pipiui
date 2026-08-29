/**
 * Durable closeout timeline: one JSON line per closeout phase event, correlated by
 * agentId/runId, answering "after the summary, which step was slow".
 *
 * Metadata only, by construction:
 * - every field goes through a closed enum or a strict character-class sanitizer;
 * - `error` must be a fixed lowercase kebab error code (e.g. `verify-timeout`);
 *   arbitrary text has no path into any field, whatever the caller passes;
 * - unknown keys are dropped wholesale — the builder assembles the record itself.
 *
 * Non-blocking by construction:
 * - the hot path (`recordCloseoutTimeline`) does validation + JSON.stringify +
 *   one array push, then schedules an async flush. No filesystem call is ever made
 *   synchronously on the caller's stack;
 * - EVERY filesystem operation — append AND retention (readdir/unlink) — runs in
 *   an isolated ONE-SHOT helper process. The default transport only spawns,
 *   unrefs its handles and pipes bytes on stdin; zero fs syscalls happen here, so
 *   a permanently wedged disk (blocked open, dead NFS, FIFO with no reader)
 *   cannot hold a libuv handle in this process — it always reaches `beforeExit`;
 * - each helper carries its OWN REFERENCED self-watchdog
 *   (CLOSEOUT_TIMELINE_HELPER_WATCHDOG_MS, or cap+reapCap in drain mode): whatever
 *   wedges, the helper force-exits ITSELF at the deadline. The parent owns no
 *   lifecycle timers, so this process exiting first can never orphan one — a
 *   healthy run clears the watchdog and exits instantly;
 * - on normal process exit (`beforeExit`) the still-buffered tail is stolen
 *   synchronously and written by an isolated helper raced against a hard cap
 *   (EXIT_DRAIN_CAP_MS, default 2s). At the cap the parent sends one SIGKILL,
 *   then confirms WITHIN A BOUND: settling requires the helper's own `exit`
 *   event or an ESRCH liveness probe — `__lastDrainOutcomeForTests()` exposes the
 *   verdict (`ack` / `exit-failed` / `os-dead` / `unconfirmed` / `no-spawn`), and
 *   "reaped" is NEVER claimed without that evidence. Even an unconfirmed child
 *   dies by its own watchdog shortly after, so no permanent orphan exists.
 *   SIGKILL of *this* process may still lose the tail — accepted.
 * - files are date-sharded (`closeout-timeline-YYYY-MM-DD.jsonl`). There are no
 *   renames, so no cross-process rotation race exists by design. Retention lives
 *   ENTIRELY inside helpers: an in-memory per-hour throttle decides whether the
 *   next handoff also prunes expired shards — the main process compares integers
 *   only and touches no filesystem.
 *
 * Project-isolated: records land under `{mainCwd}/.pi/agent/`, next to the rest of
 * the project's own pi state. Never the global ~/.pi. Without a configured
 * directory the recorder is a silent no-op (default off = default safe).
 *
 * Probe failures never propagate or block: enqueue-time overflow is counted in
 * stats().dropped; a detached handoff or drain helper that fails loses its chunk
 * silently — telemetry must never surface as, or cause, a second failure mode.
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import { spawn } from "node:child_process";

export const CLOSEOUT_TIMELINE_SHARD_PREFIX = "closeout-timeline-";
export const CLOSEOUT_TIMELINE_RETAIN_DAYS = 7;

/** Buffer bounds: flush this many lines early, never buffer more than this many. */
export const CLOSEOUT_TIMELINE_FLUSH_BATCH = 64;
export const CLOSEOUT_TIMELINE_MAX_PENDING_LINES = 512;
export const CLOSEOUT_TIMELINE_FLUSH_DELAY_MS = 20;

/**
 * REFERENCED self-watchdog running INSIDE every helper: append or retention may
 * wedge forever on a hostile filesystem, so each helper force-exits itself at
 * this deadline regardless of what the parent does. The parent deliberately owns
 * no kill timer for detached helpers — exiting first cannot orphan one.
 */
export const CLOSEOUT_TIMELINE_HELPER_WATCHDOG_MS = 5_000;
/**
 * Bound for the drain confirmation phase: after the cap SIGKILL, the parent polls
 * liveness (ESRCH) and waits for the helper's `exit` event at most this long.
 * Expiring WITHOUT evidence settles as `unconfirmed` — the kill claim is never
 * asserted without proof. The drain helper's own watchdog is additionally set to
 * cap + this value, so even a SIGKILL-resistant child self-terminates right after.
 */
export const CLOSEOUT_TIMELINE_HELPER_REAP_CAP_MS = 500;

/** Closed vocabulary. Anything outside these sets is dropped or substituted below. */
export const CLOSEOUT_TIMELINE_STATUSES = [
	"enter",
	"ok",
	"error",
	"timeout",
	"terminate",
	"exit",
	"late-ok",
	"late-error",
	"skip",
	// child-exit probe extensions (additive): a phase-internal milestone marker and
	// one tiered forensic sample. Phase terminals stay ok/error — mark/sample records
	// never count as terminal samples in existing queries.
	"mark",
	"sample",
] as const;

export const CLOSEOUT_TIMELINE_EVENTS = [
	"child-exit",
	"verify",
	"job-finalize",
	"findings",
	"worktree-queue",
	"worktree-reconcile",
	"worktree-merge",
	"worktree-on-merged",
	"worktree-cleanup",
	"worktree-post-verify",
	"worktree-other",
	"end-report",
	"report-drain",
	"lease-release",
	"done-hold",
	"done-deliver",
] as const;

export const CLOSEOUT_TIMELINE_PHASES = [
	"generating",
	"tool-active",
	"final-received",
	"verifying",
	"queue-wait",
	"reconciling",
	"merging",
	"on-merged",
	"cleaning",
	"post-verify",
	"done-await-host",
	"child-exit",
	"findings",
	"done-deliver",
] as const;

export const CLOSEOUT_TIMELINE_ROLES = ["read-only", "writable", "boss"] as const;

/**
 * child-exit probe milestone detail (closed): which point of the close sequence a
 * `mark` record pins. `final` = final assistant received (= phase enter time);
 * `exit` = the child process itself exited; `stdout-close`/`stderr-close` = that
 * pipe closed in the PARENT; `disconnect` = IPC channel closed (only wired when
 * an IPC channel exists); `close` = ChildProcess.close fired, carrying the
 * computed durations; `sample` = tiered forensic sample record.
 */
export const CLOSEOUT_TIMELINE_EXIT_DETAILS = [
	"final",
	"exit",
	"stdout-close",
	"stderr-close",
	"disconnect",
	"close",
	/** ChildProcess `error` (spawn failure etc.) — a real event, never a close. */
	"error",
	"sample",
] as const;

/** Why the child was being forced/aborted at sample or close time (closed domain). */
export const CLOSEOUT_TIMELINE_EXIT_CAUSES = [
	"none",
	"grace-timeout",
	"post-final-grace-expired",
	"provider-stall",
	"runtime-budget",
	"abort",
	"unknown",
] as const;

/** Tri-state for OS liveness answers: the OS refused to say, we record `unknown`. */
export const CLOSEOUT_TIMELINE_TRI_STATE = ["yes", "no", "unknown"] as const;

/** Which pipes were still open when a sample was taken (probe-local knowledge). */
export const CLOSEOUT_TIMELINE_STDIO_OPEN = ["both", "stdout", "stderr", "none", "unknown"] as const;

/** Fixed POSIX signal names only; anything else drops the field. */
export const CLOSEOUT_TIMELINE_SIGNALS = [
	"SIGHUP",
	"SIGINT",
	"SIGQUIT",
	"SIGABRT",
	"SIGKILL",
	"SIGTERM",
	"SIGTRAP",
	"SIGPIPE",
	"SIGALRM",
	"SIGUSR1",
	"SIGUSR2",
	"SIGCHLD",
	"SIGCONT",
	"SIGSTOP",
	"SIGTSTP",
	"SIGTTIN",
	"SIGTTOU",
	"SIGURG",
	"SIGXCPU",
	"SIGXFSZ",
	"SIGVTALRM",
	"SIGPROF",
	"SIGSYS",
] as const;

/** How a forensic sample was produced (or why it failed). */
export const CLOSEOUT_TIMELINE_SAMPLE_SOURCES = ["ps", "error", "unsupported"] as const;

/**
 * Closed error-code domain: exactly what the closeout probers can ever emit —
 * `${event}-timeout` / `${event}-error` over the enumerated events, plus the few
 * explicit fixed codes in index.ts. Anything else drops the error FIELD entirely
 * (the stderr probe line still carries it). No regex, no substitution residue.
 */
const CLOSEOUT_TIMELINE_EXTRA_ERROR_CODES = [
	"done-not-queued",
	"verify-failed",
	"findings-error",
	// child-exit probe: WHY one OS forensic sample failed (never faked as success).
	"child-exit-sample-spawn",
	"child-exit-sample-timeout",
	"child-exit-sample-cap",
	"child-exit-sample-exit",
	"child-exit-sample-parse",
	"child-exit-sample-identity",
	"child-exit-sample-error",
] as const;

export const CLOSEOUT_TIMELINE_ERROR_CODES: readonly string[] = (() => {
	const codes = new Set<string>(CLOSEOUT_TIMELINE_EXTRA_ERROR_CODES);
	for (const event of [...CLOSEOUT_TIMELINE_EVENTS, "other", "worktree-other"] as const) {
		codes.add(`${event}-timeout`);
		codes.add(`${event}-error`);
	}
	return [...codes].sort();
})();

/** Dynamic `worktree-<phase>` probes collapse here when <phase> is not enumerated. */
const EVENT_FALLBACK = "worktree-other";
/** Fixed domain separators: agent and run live in SEPARATE hash domains. */
const AGENT_KEY_DOMAIN = "pipiui-closeout-agent-v1\n";
const RUN_KEY_DOMAIN = "pipiui-closeout-run-v1\n";

export type CloseoutTimelineStatus = (typeof CLOSEOUT_TIMELINE_STATUSES)[number];
export type CloseoutTimelineEvent = (typeof CLOSEOUT_TIMELINE_EVENTS)[number];
export type CloseoutTimelineExitDetail = (typeof CLOSEOUT_TIMELINE_EXIT_DETAILS)[number];

/** Input is deliberately loose; the builders whitelist what survives. */
export type CloseoutTimelineFields = {
	agent?: string;
	run?: string;
	role?: string;
	phase?: string;
	status?: string;
	elapsedMs?: number;
	error?: string;
	attempt?: number;
	// child-exit probe fields — every one a closed enum member or a clamped number:
	detail?: string;
	cause?: string;
	childPid?: number;
	pgid?: number;
	sess?: number;
	depth?: number;
	exitCode?: number;
	signal?: string;
	descendants?: number;
	rootAlive?: string;
	stdioOpen?: string;
	sampleSrc?: string;
	tierMs?: number;
	assistantToExitMs?: number;
	exitToStdioCloseMs?: number;
	exitToCloseMs?: number;
};

export type CloseoutTimelineRecord = {
	ts: string;
	tMs: number;
	monoMs: number;
	seq: number;
	pid: number;
	event: CloseoutTimelineEvent | "other";
	/** SHA-256(agent-domain+agentId), 16 hex — never the raw caller-controlled id. */
	agent?: string;
	/** Same construction over runId in its own domain; joinable, never cross-equal. */
	run?: string;
	role?: string;
	phase?: string;
	status?: CloseoutTimelineStatus;
	elapsedMs?: number;
	error?: string;
	attempt?: number;
	// child-exit probe extension — same whitelist rules as above:
	detail?: CloseoutTimelineExitDetail;
	cause?: string;
	/** Numeric OS identifiers only (ephemeral, recycled, no user content). */
	childPid?: number;
	pgid?: number;
	sess?: number;
	depth?: number;
	exitCode?: number;
	signal?: string;
	descendants?: number;
	rootAlive?: string;
	stdioOpen?: string;
	sampleSrc?: string;
	tierMs?: number;
	assistantToExitMs?: number;
	exitToStdioCloseMs?: number;
	exitToCloseMs?: number;
};

/**
 * Stable ONE-WAY correlation keys for caller-controlled ids, per FIELD DOMAIN:
 * first 16 hex chars of `SHA-256(domain + value)`. Equal ids collapse with
 * themselves and nothing else; the original never lands on disk, and because the
 * domains differ an agent id and a run id with the SAME literal value can never
 * produce equal keys (no cross-field equality leak).
 *
 * Recompute for queries:
 *   node -e 'console.log(require("node:crypto").createHash("sha256")
 *     .update("pipiui-closeout-agent-v1\\nMY_AGENT_ID").digest("hex").slice(0,16))'
 *   # run ids use the pipiui-closeout-run-v1 domain instead
 * then filter normally:
 *   jq -c 'select(.agent=="<agentKey>" and .run=="<runKey>")' \
 *     .pi/agent/closeout-timeline-*.jsonl
 */
function domainKey(domain: string, value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0 || value.length > 200) return undefined;
	return createHash("sha256").update(domain + value, "utf8").digest("hex").slice(0, 16);
}

export function closeoutTimelineAgentKey(value: unknown): string | undefined {
	return domainKey(AGENT_KEY_DOMAIN, value);
}

export function closeoutTimelineRunKey(value: unknown): string | undefined {
	return domainKey(RUN_KEY_DOMAIN, value);
}

/** Field-typed aliases keeping the gate vocabulary at call sites. */
export const sanitizeAgentSlug = closeoutTimelineAgentKey;
export const sanitizeRunToken = closeoutTimelineRunKey;

/** Fixed kebab codes only, from a closed domain; anything else drops the field. */
export function sanitizeErrorCode(error: unknown): string | undefined {
	if (typeof error !== "string") return undefined;
	return (CLOSEOUT_TIMELINE_ERROR_CODES as readonly string[]).includes(error) ? error : undefined;
}

/** Round and clamp into [min, max]; non-finite input drops the field. */
export function clampTimelineInt(value: unknown, min: number, max: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function memberOf<T extends string>(value: unknown, members: readonly T[]): T | undefined {
	return typeof value === "string" && (members as readonly string[]).includes(value) ? (value as T) : undefined;
}

let seqCounter = 0;

/** Pure: builds one metadata-only record from sanitized fields. */
export function buildCloseoutTimelineRecord(
	rawEvent: string,
	fields: CloseoutTimelineFields,
	now: number = Date.now(),
	monoMs: number = Math.round(performance.now()),
	recorderPid: number = process.pid,
): CloseoutTimelineRecord {
	seqCounter += 1;
	const known = memberOf(rawEvent, CLOSEOUT_TIMELINE_EVENTS);
	let event: CloseoutTimelineEvent | "other";
	if (known) {
		event = known;
	} else if (/^worktree-[a-z0-9-]{1,40}$/.test(rawEvent)) {
		// The worktree prober derives event names from phases; unmapped ones must not
		// smuggle free text, so they fold into the fixed fallback token.
		event = EVENT_FALLBACK;
	} else {
		event = "other";
	}
	const record: CloseoutTimelineRecord = {
		ts: new Date(now).toISOString(),
		tMs: now,
		monoMs,
		seq: seqCounter,
		pid: recorderPid,
		event,
	};
	const agent = sanitizeAgentSlug(fields.agent);
	const run = sanitizeRunToken(fields.run);
	const role = memberOf(fields.role, CLOSEOUT_TIMELINE_ROLES);
	const phase = memberOf(fields.phase, CLOSEOUT_TIMELINE_PHASES);
	const status = memberOf(fields.status, CLOSEOUT_TIMELINE_STATUSES);
	const elapsedMs = typeof fields.elapsedMs === "number" && Number.isFinite(fields.elapsedMs)
		? Math.max(0, Math.round(fields.elapsedMs))
		: undefined;
	const attempt = typeof fields.attempt === "number" && Number.isFinite(fields.attempt)
		? Math.min(999, Math.max(0, Math.floor(fields.attempt)))
		: undefined;
	const error = sanitizeErrorCode(fields.error);
	const detail = memberOf(fields.detail, CLOSEOUT_TIMELINE_EXIT_DETAILS);
	const cause = memberOf(fields.cause, CLOSEOUT_TIMELINE_EXIT_CAUSES);
	const childPid = clampTimelineInt(fields.childPid, 0, 2_147_483_647);
	const pgid = clampTimelineInt(fields.pgid, 0, 2_147_483_647);
	const sess = clampTimelineInt(fields.sess, 0, 2_147_483_647);
	const depth = clampTimelineInt(fields.depth, 0, 99);
	const exitCode = clampTimelineInt(fields.exitCode, -999, 999);
	const signal = memberOf(fields.signal, CLOSEOUT_TIMELINE_SIGNALS);
	const descendants = clampTimelineInt(fields.descendants, 0, 99_999);
	const rootAlive = memberOf(fields.rootAlive, CLOSEOUT_TIMELINE_TRI_STATE);
	const stdioOpen = memberOf(fields.stdioOpen, CLOSEOUT_TIMELINE_STDIO_OPEN);
	const sampleSrc = memberOf(fields.sampleSrc, CLOSEOUT_TIMELINE_SAMPLE_SOURCES);
	const tierMs = clampTimelineInt(fields.tierMs, 0, 604_800_000);
	const assistantToExitMs = clampTimelineInt(fields.assistantToExitMs, 0, 2_147_483_647);
	const exitToStdioCloseMs = clampTimelineInt(fields.exitToStdioCloseMs, 0, 2_147_483_647);
	const exitToCloseMs = clampTimelineInt(fields.exitToCloseMs, 0, 2_147_483_647);
	if (agent) record.agent = agent;
	if (run) record.run = run;
	if (role) record.role = role;
	if (phase) record.phase = phase;
	if (status) record.status = status;
	if (elapsedMs !== undefined) record.elapsedMs = elapsedMs;
	if (error) record.error = error;
	if (attempt !== undefined) record.attempt = attempt;
	if (detail) record.detail = detail;
	if (cause) record.cause = cause;
	if (childPid !== undefined) record.childPid = childPid;
	if (pgid !== undefined && pgid > 0) record.pgid = pgid;
	if (sess !== undefined && sess > 0) record.sess = sess; // macOS `ps sess` reports 0 — drop, not available
	if (depth !== undefined) record.depth = depth;
	if (exitCode !== undefined) record.exitCode = exitCode;
	if (signal) record.signal = signal;
	if (descendants !== undefined) record.descendants = descendants;
	if (rootAlive) record.rootAlive = rootAlive;
	if (stdioOpen) record.stdioOpen = stdioOpen;
	if (sampleSrc) record.sampleSrc = sampleSrc;
	if (tierMs !== undefined) record.tierMs = tierMs;
	if (assistantToExitMs !== undefined) record.assistantToExitMs = assistantToExitMs;
	if (exitToStdioCloseMs !== undefined) record.exitToStdioCloseMs = exitToStdioCloseMs;
	if (exitToCloseMs !== undefined) record.exitToCloseMs = exitToCloseMs;
	return record;
}

export function formatCloseoutTimelineLine(record: CloseoutTimelineRecord): string {
	return JSON.stringify(record);
}

/** UTC-date shard name. Every process derives it independently — no shared state. */
export function shardNameFor(ms: number): string {
	return `${CLOSEOUT_TIMELINE_SHARD_PREFIX}${new Date(ms).toISOString().slice(0, 10)}.jsonl`;
}

export function shardDateFromName(name: string): number | undefined {
	if (!name.startsWith(CLOSEOUT_TIMELINE_SHARD_PREFIX) || !name.endsWith(".jsonl")) return undefined;
	const day = name.slice(CLOSEOUT_TIMELINE_SHARD_PREFIX.length, -".jsonl".length);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
	const ms = Date.parse(`${day}T00:00:00Z`);
	return Number.isFinite(ms) ? ms : undefined;
}

type TimelineFileWriter = (file: string, text: string) => Promise<void>;

// Default transport owns directory creation so injected test writers stay pure.
// Its payload is handed to a DETACHED one-shot helper that performs mkdir +
// append (+ hourly retention) under its own self-watchdog; this process only
// spawns, unrefs every handle and pipes bytes on stdin — zero fs syscalls here,
// so a wedged destination cannot stall anything outside the helper itself.
function defaultWriter(): TimelineFileWriter {
	return (file, text) => {
		handOffToHelper(file, text, dueForPrune());
		return Promise.resolve();
	};
}

/** Observability for tests (and orphan audits): last spawned helper + reaped flag. */
let lastHelperPid: number | undefined;
let lastHelperReaped = false;
export function __lastTimelineHelperForTests(): { pid?: number; reaped: boolean } {
	return { pid: lastHelperPid, reaped: lastHelperReaped };
}

function spawnTimelineHelper(file: string, watchdogMs: number, prune: boolean): ReturnType<typeof spawn> {
	const child = spawn(process.execPath, [
		"-e", EXIT_FLUSH_CHILD_CODE, file,
		String(Math.max(50, Math.floor(watchdogMs))),
		prune ? "1" : "0",
	], {
		stdio: ["pipe", "ignore", "ignore"],
	});
	lastHelperPid = child.pid;
	lastHelperReaped = false;
	child.once("exit", () => {
		lastHelperReaped = true;
	});
	return child;
}

/**
 * Detached one-shot handoff for the steady-state flush. Deliberately NO parent-side
 * lifecycle management: no kill timer to lose at exit — the helper's own referenced
 * watchdog is what bounds it. Chunk loss on any failure is silent (telemetry only).
 */
function handOffToHelper(file: string, text: string, prune: boolean): void {
	let child: ReturnType<typeof spawn>;
	try {
		child = spawnTimelineHelper(file, CLOSEOUT_TIMELINE_HELPER_WATCHDOG_MS, prune);
	} catch {
		return; // spawn refused: chunk lost, closeout path unaffected
	}
	child.unref(); // must not keep this process alive — telemetry, never lifeline
	(child.stdin as { unref?: () => void } | null)?.unref?.();
	child.stdin?.on("error", () => { /* EPIPE races are expected */ });
	child.stdin?.end(text);
}

/** In-memory per-hour retention throttle: integer compare only — zero filesystem. */
let lastPruneHour = -1;
function dueForPrune(): boolean {
	const hour = Math.floor(Date.now() / (60 * 60 * 1_000));
	if (hour === lastPruneHour) return false;
	lastPruneHour = hour;
	return true;
}

export type CloseoutTimelineSink = {
	/** Buffered enqueue. Returns false when the line was dropped (cap exceeded). */
	write(line: string): boolean;
	flush(): Promise<void>;
	stats(): { pending: number; dropped: number };
	/** Steal every still-buffered line. The exit drain uses this, not `flush`. */
	drainPending(): string[];
	/** Cancel the lazy flush timer without writing (the exit drain takes over). */
	cancelScheduledFlush(): void;
	/** The project directory this sink writes into. */
	readonly directory: string;
};

/**
 * Async buffered sink for one directory. `write` never touches the filesystem;
 * chunks are appended off the hot path by a detached flush loop. All write errors
 * are swallowed (chunk lost, counter incremented); nothing ever rejects outward.
 */
export function createCloseoutTimelineSink(
	dir: string | undefined,
	options?: { maxPendingLines?: number; flushDelayMs?: number; writer?: TimelineFileWriter },
): CloseoutTimelineSink {
	if (!dir) throw new Error("closeout timeline requires a project dir");
	const maxPending = options?.maxPendingLines ?? CLOSEOUT_TIMELINE_MAX_PENDING_LINES;
	const flushDelayMs = options?.flushDelayMs ?? CLOSEOUT_TIMELINE_FLUSH_DELAY_MS;
	const writeFile = options?.writer ?? defaultWriter();

	const pending: string[] = [];
	let dropped = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let flushing: Promise<void> = Promise.resolve();

	const scheduleFlush = (): void => {
		if (pending.length >= CLOSEOUT_TIMELINE_FLUSH_BATCH) {
			void runFlush(); // serialized behind any in-flight flush
			return;
		}
		if (timer !== undefined) return;
		timer = setTimeout(() => {
			timer = undefined;
			void runFlush();
		}, flushDelayMs);
		timer.unref?.();
	};

	async function runFlush(): Promise<void> {
		// Serial drain: a slow disk delays telemetry only, never the closeout path.
		const previous = flushing;
		let gate: (() => void) | undefined;
		const gated = new Promise<void>((resolve) => { gate = resolve; });
		flushing = gated;
		await previous.catch(() => {});
		try {
			while (pending.length > 0) {
				const chunk = pending.splice(0, CLOSEOUT_TIMELINE_FLUSH_BATCH);
				const file = path.join(dir!, shardNameFor(Date.now()));
				const text = `${chunk.join("\n")}\n`;
				try {
					await writeFile(file, text);
				} catch {
					dropped += chunk.length; // sink down: this chunk is lost, closeout unaffected
				}
			}
		} finally {
			gate!();
		}
	}

	return {
		write(line: string): boolean {
			if (pending.length >= maxPending) {
				dropped += 1;
				return false;
			}
			pending.push(line);
			scheduleFlush();
			return true;
		},
		async flush(): Promise<void> {
			while (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			await flushing.catch(() => {});
			if (pending.length > 0) await runFlush();
		},
		drainPending(): string[] {
			return pending.splice(0, pending.length);
		},
		cancelScheduledFlush(): void {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
		},
		directory: dir!,
		stats() {
			return { pending: pending.length, dropped };
		},
	};
}

type SinkHolder = { sink?: CloseoutTimelineSink };

const activeSink: SinkHolder = {};

/** Hard upper bound for the best-effort exit drain. */
export const CLOSEOUT_TIMELINE_EXIT_DRAIN_CAP_MS = 2_000;
let exitDrainArmed = false;

function armExitDrain(): void {
	if (exitDrainArmed) return;
	exitDrainArmed = true;
	process.once("beforeExit", () => {
		void drainCloseoutTimelineBeforeExit().catch(() => {});
	});
}

/**
 * Isolated one-shot helper: a separate Node process, not a worker thread. Worker.
 * terminate() cannot interrupt a kernel-blocked open (FIFO / wedged NFS); a child
 * carrying its own watchdog can — and the watchdog lives in argv, not the parent:
 *   argv[1] = shard path · argv[2] = self-watchdog ms · argv[3] = "1" run retention
 * stdin carries the payload. Steps: mkdir → append → (optional) readdir/unlink of
 * expired shards → clearTimeout → exit(0). ANY wedge (open/write/readdir/unlink)
 * dies at the watchdog deadline via its own process.exit — parent exit is
 * irrelevant to this guarantee. Nonzero exit = chunk lost (telemetry only).
 */
const EXIT_FLUSH_CHILD_CODE = `
const { mkdir, appendFile, readdir, unlink } = require("node:fs/promises");
const { dirname, join } = require("node:path");
const file = process.argv[1];
const watchdogMs = Math.max(50, parseInt(process.argv[2], 10) || ${CLOSEOUT_TIMELINE_HELPER_WATCHDOG_MS});
const wantPrune = process.argv[3] === "1";
// Self-watchdog. CRITICAL platform fact (sampled on darwin24): a process.exit()
// called while a libuv worker thread sits in an uninterruptible kernel open()
// NEVER completes — the exiting-but-not-dead process lingers forever, which is
// exactly the orphan this file exists to prevent. An externally-delivered SIGKILL
// does land, and delivering it TO OURSELF requires no parent — so the watchdog
// kills the helper with its own hand instead of merely exiting.
const die = (): void => {
	try { process.kill(process.pid, "SIGKILL"); } catch { /* already dying */ }
	process.exit(3);
};
const wd = setTimeout(die, watchdogMs);
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
	const text = Buffer.concat(chunks).toString("utf8");
	const dir = dirname(file);
	(async () => {
		await mkdir(dir, { recursive: true });
		await appendFile(file, text, "utf8");
		if (wantPrune) {
			// Retention runs HERE, never in the recording process: best-effort unlink
			// of shards older than RETAIN_DAYS. Today's shard is always newer than the
			// cutoff, so no live writer can be racing an unlink on its own target.
			try {
				const cutoff = Date.now() - ${CLOSEOUT_TIMELINE_RETAIN_DAYS} * 24 * 60 * 60 * 1000;
				const names = await readdir(dir);
				await Promise.all(names.map(async (name) => {
					const m = /^closeout-timeline-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$/.exec(name);
					if (!m || Date.parse(m[1] + "T00:00:00Z") >= cutoff) return;
					try { await unlink(join(dir, name)); } catch {}
				}));
			} catch {}
		}
		clearTimeout(wd);
		process.exit(0);
	})().catch(() => process.exit(1));
});
`;

/** Verdict of the last bounded drain — "reaped" is never claimed without evidence. */
export type CloseoutTimelineDrainOutcome = {
	/**
	 * - `ack`: helper exited 0 on its own → tail persisted.
	 * - `exit-failed`: real exit event, nonzero code / killed signal → chunk lost.
	 * - `os-dead`: SIGKILL sent, ESRCH liveness probe says the PID is gone
	 *   (Node's exit event is late) → dead at OS level, chunk lost.
	 * - `unconfirmed`: cap + REAP_CAP elapsed and the PID still probe-positive;
	 *   our handles are released so it cannot hold this process, and the verdict
		 honestly refuses to claim reap. Its own watchdog still bounds its life.
	 * - `no-spawn`: spawn threw synchronously; nothing was ever started.
	 */
	status: "ack" | "exit-failed" | "os-dead" | "unconfirmed" | "no-spawn";
	ok: boolean;
};
let lastDrainOutcome: CloseoutTimelineDrainOutcome | undefined;
export function __lastDrainOutcomeForTests(): CloseoutTimelineDrainOutcome | undefined {
	return lastDrainOutcome;
}

function exitFlushViaHelper(
	file: string,
	lines: readonly string[],
	capMs: number,
): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
		let confirmPoll: ReturnType<typeof setInterval> | undefined;
		let child: ReturnType<typeof spawn> | undefined;
		const settle = (outcome: CloseoutTimelineDrainOutcome): void => {
			if (settled) return;
			settled = true;
			if (giveUpTimer !== undefined) clearTimeout(giveUpTimer);
			if (confirmPoll !== undefined) clearInterval(confirmPoll);
			// Release every reference so a lingering child can never hold this loop:
			// after ack/exit-failed/os-dead it is already dead; in the unconfirmed case
			// this detach IS the boundedness mechanism.
			try { child?.unref(); } catch { /* never set */ }
			try { (child?.stdin as { destroy?: () => void } | null)?.destroy?.(); } catch { /* gone */ }
			lastDrainOutcome = outcome;
			resolve(outcome.ok);
		};
		// Phase two, entered ONLY at the cap: one SIGKILL, then BOUNDED verification.
		// No unconditional settle-without-evidence: the only exits from here are the
		// helper's own `exit` event (armed below), an ESRCH probe win, or expiring
		// into an explicit `unconfirmed` after CLOSEOUT_TIMELINE_HELPER_REAP_CAP_MS.
		const killAndConfirm = (): void => {
			if (!child?.pid) {
				settle({ status: "no-spawn", ok: false });
				return;
			}
			try {
				child.kill("SIGKILL"); // throws ESRCH when already reaped-dead — harmless
			} catch {
				/* fall through to evidence collection below */
			}
			const startedAt = Date.now();
			confirmPoll = setInterval(() => {
				if (child?.pid === undefined) {
					settle({ status: "unconfirmed", ok: false });
					return;
				}
				let esrch = false;
				try {
					process.kill(child.pid, 0);
				} catch (err) {
					esrch = (err as NodeJS.ErrnoException).code === "ESRCH";
				}
				if (esrch) {
					settle({ status: "os-dead", ok: false });
					return;
				}
				if (Date.now() - startedAt > CLOSEOUT_TIMELINE_HELPER_REAP_CAP_MS) {
					settle({ status: "unconfirmed", ok: false });
				}
			}, 25);
		};
		// Referenced on purpose while pending: capMs IS the phase-one bound.
		giveUpTimer = setTimeout(() => {
			if (!settled) killAndConfirm();
		}, capMs);
		try {
			// Helper watchdog = cap + REAP_CAP: even a SIGKILL-resistant wedged child
			// force-exits itself just after our confirmation bound expires.
			child = spawnTimelineHelper(file, capMs + CLOSEOUT_TIMELINE_HELPER_REAP_CAP_MS, false);
			child.once("exit", (code, signal) => {
				const ack = code === 0 && !signal;
				settle({ status: ack ? "ack" : "exit-failed", ok: ack });
			});
			child.once("error", () => {
				// Spawn-level failure (ENOENT etc.): the exit event may never fire, so
				// enter the same bounded confirm path instead of trusting a timer alone.
				killAndConfirm();
			});
			child.stdin?.on("error", () => { /* EPIPE after SIGKILL is expected */ });
			child.stdin?.end(`${lines.join("\n")}\n`);
		} catch {
			settle({ status: "no-spawn", ok: false });
		}
	});
}

/**
 * Normal-exit tail persistence: fires once from `beforeExit`, off the closeout hot
 * path. Steals all still-buffered lines synchronously and hands them to an isolated
 * helper process raced against EXIT_DRAIN_CAP_MS (+ REAP_CAP after any SIGKILL).
 * SIGKILL of this process may still lose buffered lines — accepted; a wedge can
 * only cost cap + reap bound, then everything is cancelled and reaped.
 */
export async function drainCloseoutTimelineBeforeExit(capMs: number = CLOSEOUT_TIMELINE_EXIT_DRAIN_CAP_MS): Promise<void> {
	const sink = activeSink.sink;
	if (!sink || sink.stats().pending === 0) return;
	sink.cancelScheduledFlush();
	const lines = sink.drainPending();
	if (lines.length === 0) return;
	const cap = Number.isFinite(capMs) && capMs > 0 ? capMs : CLOSEOUT_TIMELINE_EXIT_DRAIN_CAP_MS;
	await exitFlushViaHelper(path.join(sink.directory, shardNameFor(Date.now())), lines, cap).catch(() => {});
}

/** Wire the recorder to one project's `.pi/agent` directory. Undefined disables it. Lazy. */
export function setCloseoutTimelineDir(dir: string | undefined): void {
	activeSink.sink = dir ? createCloseoutTimelineSink(dir) : undefined;
	if (dir) armExitDrain();
}

/** Test seam: swap the active sink (capture in memory, failing sinks, …). */
export function setCloseoutTimelineSinkForTests(sink: CloseoutTimelineSink | undefined): void {
	activeSink.sink = sink;
}

export function closeoutTimelineStats(): { pending: number; dropped: number } {
	return activeSink.sink?.stats() ?? { pending: 0, dropped: 0 };
}

/**
 * Append one closeout event to the durable timeline. Synchronous cost is
 * validate+stringify+push only; never throws; never blocks the closeout path.
 */
export function recordCloseoutTimeline(event: string, fields: CloseoutTimelineFields): void {
	const sink = activeSink.sink;
	if (!sink) return;
	try {
		const line = formatCloseoutTimelineLine(buildCloseoutTimelineRecord(event, fields));
		sink.write(line);
	} catch {
		/* the timeline must never become a second failure mode */
	}
}

/** Test helper: in-memory sink with the same queue/drop contract plus inspectable lines. */
export function captureCloseoutTimelineSink(options?: { maxPendingLines?: number; rejectWrites?: boolean }): CloseoutTimelineSink & { lines: string[] } {
	const lines: string[] = [];
	const inner = createCloseoutTimelineSink("/does/not/matter", {
		maxPendingLines: options?.maxPendingLines,
		writer: async (_file, text) => {
			if (options?.rejectWrites) throw new Error("sink-down");
			for (const line of text.trim().split("\n")) lines.push(line);
		},
	});
	return {
		write: (line) => inner.write(line),
		flush: () => inner.flush(),
		drainPending: () => inner.drainPending(),
		cancelScheduledFlush: () => inner.cancelScheduledFlush(),
		stats: () => inner.stats(),
		directory: "/does/not/matter",
		lines,
	};
}
