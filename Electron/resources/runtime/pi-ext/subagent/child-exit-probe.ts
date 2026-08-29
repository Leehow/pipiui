/**
 * Second-layer child-exit diagnostic probe.
 *
 * The first layer (`createChildExitCloseout` in closeout.ts) bounds/observes the
 * phase as a whole: enter when the final assistant message arrives, terminal when
 * `ChildProcess.close` fires. It cannot say WHY a close is late. This probe adds
 * metadata-only milestone events that separate the two failure shapes:
 *
 *   1. worker main process slow to exit  → `assistant→exit` is large, `exit→close` small;
 *   2. main exited but descendants/stdio hold the pipes
 *                                       → `assistant→exit` small, `exit→close` large
 *                                          (per-stream `stdout-close`/`stderr-close`
 *                                          milestones show which pipe and how late).
 *
 * Records flow through the same durable closeout timeline (`event: "child-exit"`,
 * statuses `mark`/`sample`), so every field is a closed-enum member or a clamped
 * number and nothing free-text can reach disk. When a phase crosses tier
 * thresholds (5s/30s/120s by default) the probe takes a BOUNDED, ASYNC forensic
 * sample: descendant count + process group/session (via `ps`, numeric columns
 * only), root-PID liveness (kill(pid, 0) syscall), which stdio pipes are still
 * open (probe-local state), and the forced/abort cause as a fixed enum.
 *
 * Privacy: numeric OS identifiers only. PIDs/pgids/sessions are ephemeral,
 * recycled, and visible to any local process; the timeline already stamps the
 * recorder's own PID on every record, so child PIDs add no new sensitivity class
 * and stay un-hashed for direct joinability with live `ps`/`lsof` forensics.
 * NEVER recorded: command lines, argv, environment, cwd, prompt/output text,
 * file contents, secrets — the `ps` invocation parses numeric columns only and
 * discards everything else.
 *
 * Safety: the probe is pure diagnostics. It owns no termination timer, adds no
 * exit deadline and changes no abort semantics; OS queries run detached from the
 * closeout path (fire-and-forget, SIGKILL-capped, unref'd) and any failure
 * degrades to closed-enum `unknown`/`error` values. Probe failures never
 * propagate — a throwing callback or a failed OS query cannot affect finalization.
 */

import { spawn } from "node:child_process";
import { recordCloseoutTimeline, type CloseoutTimelineFields } from "./closeout-timeline.ts";

/** Phase durations that trigger exactly one forensic sample each. */
export const CHILD_EXIT_SAMPLE_TIERS_MS: readonly number[] = [5_000, 30_000, 120_000];
/** Hard wall-clock cap for one OS forensic sample; the `ps` child is killed at it. */
export const CHILD_EXIT_SAMPLE_CAP_MS = 2_000;
/** Hard read caps: over either limit the table process is killed IMMEDIATELY and
 *  the sample resolves as `error/cap` — accumulation never continues past them. */
export const SAMPLE_MAX_TABLE_BYTES = 4 * 1024 * 1024;
export const SAMPLE_MAX_TABLE_ROWS = 20_000;
const DEFAULT_TABLE_CAPS: SampleTableCaps = { maxBytes: SAMPLE_MAX_TABLE_BYTES, maxRows: SAMPLE_MAX_TABLE_ROWS };

export type ChildExitProbeCause =
	| "none"
	| "grace-timeout"
	| "post-final-grace-expired"
	| "provider-stall"
	| "runtime-budget"
	| "abort"
	| "unknown";

export type ChildExitSampleSource = "ps" | "error" | "unsupported";

/** Closed failure vocabulary for an OS sample that did NOT succeed. */
export type DescendantSampleFailReason = "spawn" | "timeout" | "cap" | "exit" | "parse" | "identity";

export type DescendantSample = {
	sampleSrc: ChildExitSampleSource;
	rootAlive: "yes" | "no" | "unknown";
	/** Omitted = UNKNOWN. Only a successful, root-present snapshot reports a count —
	 *  a missing root row or any failure never fabricates `descendants: 0`. */
	descendants?: number;
	pgid?: number;
	sess?: number;
	failReason?: DescendantSampleFailReason;
};

export type SampleTableCaps = { maxBytes: number; maxRows: number };
/** In-memory-only child identity (never recorded on disk): first alive sample's pgid/sess. */
export type ChildIdentity = { pgid?: number; sess?: number };
export type SampleOptions = {
	/** The probe already observed this child's `exit`: liveness is settled dead —
	 *  never `kill(pid,0)` it again (a reused PID would answer "yes" for someone else). */
	rootExited?: boolean;
	caps?: Partial<SampleTableCaps>;
	/** Previously-established identity of the real child. A root row that
	 *  contradicts it is a REUSED PID: the sample resolves `error/identity` and no
	 *  table field of the foreign process is ever reported. */
	expected?: ChildIdentity;
};

/** Minimal structural slice of ChildProcess the probe touches — test fakes qualify. */
export type ChildExitProcLike = {
	once(event: string, listener: (...args: any[]) => void): unknown;
	pid?: number;
	stdout?: { once(event: string, listener: () => void): unknown } | null;
	stderr?: { once(event: string, listener: () => void): unknown } | null;
	connected?: boolean;
};

export type ChildExitTimelineProbe = {
	/** Call when the final assistant message has arrived (= phase enter). Idempotent. */
	markFinal(): void;
	/** Stop scheduled sampling (close/error already does this). Events still record. */
	dispose(): void;
	/**
	 * Hard seal: the first-layer terminal has been written (error path). Every later
	 * event — close, stdio close, disconnect, in-flight sample — is silently
	 * dropped so nothing can land after the terminal (terminal-last, no fallback).
	 */
	seal(): void;
};

/** kill(pid, 0) verdict: alive / dead / the OS refused to say. Pure syscall, no fs. */
export function resolveRootAlive(pid: number | undefined): "yes" | "no" | "unknown" {
	if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return "unknown";
	try {
		process.kill(pid, 0);
		return "yes";
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		if (code === "ESRCH") return "no";
		if (code === "EPERM") return "yes"; // exists, owned by someone else
		return "unknown";
	}
}

/**
 * One BOUNDED process-table sample. Everything is enforced while READING, not after:
 *  - byte cap AND row cap: the next chunk that crosses either limit kills the table
 *    process at once and resolves `error/cap` — nothing past the limit is parsed;
 *  - wall-clock cap: at `capMs` the process is killed and the sample resolves
 *    `error/timeout` — a late `close` finds `settled` and skips parsing entirely;
 *  - `ps` nonzero exit / signal death resolves `error/exit` or `error/timeout`, never
 *    a fake success;
 *  - the stdout handle is unref'd: sampling must never be a process lifeline.
 *
 * Liveness comes from the SAME snapshot instant as the descendant count: a present
 * root row = "yes", a missing one = "no" (O(n) parent-adjacency BFS, single pass).
 * `kill(pid, 0)` runs only as a fallback when the table itself is unavailable, and
 * never when `rootExited` is known — a reused PID must not answer for the old child.
 *
 * `argv` is a test seam; production passes the fixed numeric-column `ps` invocation.
 * NEVER recorded: command lines, argv, environment, cwd, prompt/output, secrets —
 * the table is parsed as NUMBERS ONLY and everything else is discarded.
 */
const identityMismatch = (rowPgid: number | undefined, rowSess: number | undefined, expected: ChildIdentity | undefined): boolean => {
	if (!expected) return false; // nothing to compare against yet (first alive sample)
	// Every comparable field must MATCH. A row that lost the fields we know about
	// cannot be verified either — conservatively treat it as a foreign process.
	if (expected.pgid !== undefined && (rowPgid === undefined || rowPgid !== expected.pgid)) return true;
	if (expected.sess !== undefined && (rowSess === undefined || rowSess !== expected.sess)) return true;
	return false;
};

export function runProcessTableSample(
	argv: readonly string[],
	childPid: number,
	capMs: number,
	caps: SampleTableCaps,
	rootExited: boolean,
	expected?: ChildIdentity,
): Promise<DescendantSample> {
	return new Promise<DescendantSample>((resolve) => {
		const failAlive = (): "yes" | "no" | "unknown" =>
			rootExited ? "no" : resolveRootAlive(childPid);
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(argv[0]!, argv.slice(1), { stdio: ["ignore", "pipe", "ignore"] });
			child.unref();
			try {
				(child.stdout as { unref?: () => void } | null)?.unref?.(); // never a lifeline
			} catch {
				/* stream refcount is best-effort */
			}
		} catch {
			resolve({ sampleSrc: "error", rootAlive: failAlive(), failReason: "spawn" });
			return;
		}
		let settled = false;
		const fail = (reason: DescendantSampleFailReason): void => {
			if (settled) return;
			settled = true;
			if (killTimer !== undefined) clearTimeout(killTimer);
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
			resolve({ sampleSrc: "error", rootAlive: failAlive(), failReason: reason });
		};
		const killTimer = setTimeout(() => fail("timeout"), Math.max(1, capMs));
		killTimer.unref?.();
		let bytes = 0;
		let rows = 0;
		let text = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			if (settled) return;
			bytes += chunk.length;
			for (let i = 0; i < chunk.length; i++) {
				if (chunk[i] === 10) rows += 1;
			}
			if (bytes > caps.maxBytes || rows > caps.maxRows) {
				fail("cap"); // terminate FIRST; no further chunk is parsed
				return;
			}
			text += chunk;
		});
		child.once("error", () => fail("spawn"));
		child.once("close", (code: unknown, signal: unknown) => {
			if (settled) return; // timeout/cap already won: skip parsing entirely
			settled = true;
			clearTimeout(killTimer);
			if (code !== 0 || signal !== null && signal !== undefined) {
				resolve({
					sampleSrc: "error",
					rootAlive: failAlive(),
					failReason: signal ? "timeout" : "exit",
				});
				return;
			}
			try {
				// STRICT parse: any non-empty line that is not exactly four integer
				// columns is a FORMAT ERROR (error/parse) — never silently skipped, and
				// never misread as a successful "root missing" snapshot. Fully EMPTY
				// output is the one legitimate no-row case (exit-0 table with no root).
				// O(n) single pass: parent→children adjacency, then one BFS from the child.
				const childrenByParent = new Map<number, number[]>();
				let rootPresent = false;
				let rootPgid: number | undefined;
				let rootSess: number | undefined;
				let sawNonEmptyLine = false;
				for (const rawLine of text.split("\n")) {
					const line = rawLine.trim();
					if (!line) continue;
					sawNonEmptyLine = true;
					const cols = line.split(/\s+/);
					const pid = Number(cols[0]);
					const ppid = Number(cols[1]);
					const pgid = cols.length > 2 ? Number(cols[2]) : Number.NaN;
					const sess = cols.length > 3 ? Number(cols[3]) : Number.NaN;
					if (
						cols.length !== 4
						|| !Number.isInteger(pid) || pid <= 0
						|| !Number.isInteger(ppid) || ppid < 0
						|| !Number.isInteger(pgid) || pgid < 0
						|| !Number.isInteger(sess) || sess < 0
					) {
						resolve({ sampleSrc: "error", rootAlive: failAlive(), failReason: "parse" });
						return;
					}
					if (pid === childPid) {
						rootPresent = true;
						if (pgid > 0) rootPgid = pgid;
						if (sess > 0) rootSess = sess;
					}
					const siblings = childrenByParent.get(ppid);
					if (siblings) siblings.push(pid);
					else childrenByParent.set(ppid, [pid]);
				}
				if (!sawNonEmptyLine) {
					if (bytes > 0) {
						// Non-empty bytes but only whitespace/newlines: a FORMAT error, not a
						// legal empty table (only truly 0-byte output is "no rows").
						resolve({ sampleSrc: "error", rootAlive: failAlive(), failReason: "parse" });
						return;
					}
					// Truly empty table (exit 0, zero bytes): not a format error — the root
					// row is simply absent; liveness "no", descendant count UNKNOWN, not zero.
					resolve({ sampleSrc: "ps", rootAlive: "no" });
					return;
				}
				if (!rootPresent) {
					// The root row is gone from the table at snapshot time: liveness "no",
					// and the descendant count is UNKNOWN — not zero.
					resolve({ sampleSrc: "ps", rootAlive: "no" });
					return;
				}
				if (identityMismatch(rootPgid, rootSess, expected) || rootExited) {
					// The row exists but (a) contradicts the child's established identity, or
					// (b) the child already exited: post-exit rows are UNATTRIBUTABLE (a reused
					// PID inside the same group shares pgid/sess — a matching row proves
					// nothing). Record a closed-enum identity failure and NONE of the foreign
					// process's fields — never its descendants, pgid, sess or liveness.
					resolve({ sampleSrc: "error", rootAlive: "unknown", failReason: "identity" });
					return;
				}
				let descendants = 0;
				const queue: number[] = [childPid];
				const seen = new Set<number>([childPid]);
				while (queue.length > 0) {
					const parent = queue.pop()!;
					for (const pid of childrenByParent.get(parent) ?? []) {
						if (seen.has(pid)) continue;
						seen.add(pid);
						descendants += 1;
						queue.push(pid);
					}
				}
				resolve({
					sampleSrc: "ps",
					// Same-snapshot row presence answers liveness — unless the probe already
					// observed the child's own exit (a reused row must never answer "yes").
					rootAlive: rootExited ? "no" : "yes",
					descendants,
					...(rootPgid !== undefined ? { pgid: rootPgid } : {}),
					...(rootSess !== undefined ? { sess: rootSess } : {}),
				});
			} catch {
				resolve({ sampleSrc: "error", rootAlive: failAlive(), failReason: "parse" });
			}
		});
	});
}

const PS_TABLE_ARGV = ["ps", "-eo", "pid=,ppid=,pgid=,sess="];

export function sampleDescendantsViaPs(
	childPid: number | undefined,
	capMs: number = CHILD_EXIT_SAMPLE_CAP_MS,
	options: SampleOptions = {},
): Promise<DescendantSample> {
	if (process.platform === "win32" || childPid === undefined || childPid <= 0) {
		return Promise.resolve({
			sampleSrc: "unsupported",
			rootAlive: options.rootExited ? "no" : resolveRootAlive(childPid),
		});
	}
	return runProcessTableSample(
		PS_TABLE_ARGV,
		childPid,
		capMs,
		{ ...DEFAULT_TABLE_CAPS, ...options.caps },
		options.rootExited === true,
		options.expected,
	);
}

/**
 * Attach the probe to one spawned child attempt. Emits timeline records only —
 * `mark` milestones while the close sequence unfolds, one `sample` per crossed
 * tier, and a final `close` record carrying the computed durations
 * (assistantToExitMs / exitToStdioCloseMs / exitToCloseMs, total = elapsedMs).
 * Every callback is exception-isolated; a probe can never become a second
 * failure mode of finalization.
 */
export function createChildExitTimelineProbe(options: {
	proc: ChildExitProcLike;
	agent?: string;
	run?: string;
	role?: string;
	childPid?: number;
	depth?: number;
	attempt?: number;
	sampleTiersMs?: readonly number[];
	sampleCapMs?: number;
	/** Closed-enum cause of any forcing/abort known to the caller. */
	cause?: () => ChildExitProbeCause;
	now?: () => number;
	/** Test seam; defaults to the bounded `ps` implementation. */
	sampleDescendants?: (childPid: number, capMs: number, opts: { rootExited: boolean; expected?: ChildIdentity }) => Promise<DescendantSample>;
}): ChildExitTimelineProbe {
	const now = options.now ?? Date.now;
	const tiers = options.sampleTiersMs ?? CHILD_EXIT_SAMPLE_TIERS_MS;
	const capMs = options.sampleCapMs ?? CHILD_EXIT_SAMPLE_CAP_MS;
	const childPid = options.childPid ?? options.proc.pid;

	let finalAt: number | undefined;
	let exitAt: number | undefined;
	let stdoutClosedAt: number | undefined;
	let stderrClosedAt: number | undefined;
	let lastExitCode: unknown;
	let lastExitSignal: unknown;
	let finished = false;
	let dropInFlightSamples = false;
	let samplingCanceled = false;
	let tierIndex = 0;
	/** Stable child identity (first alive sample's pgid/sess, in-memory only) —
	 *  guards every later sample against a reused PID answering for the child. */
	let identity: ChildIdentity | undefined;
	const tierTimers: ReturnType<typeof setTimeout>[] = [];

	const emit = (fields: CloseoutTimelineFields): void => {
		try {
			recordCloseoutTimeline("child-exit", {
				agent: options.agent,
				run: options.run,
				role: options.role,
				phase: "child-exit",
				childPid: childPid === undefined ? undefined : Math.max(0, childPid),
				depth: options.depth,
				attempt: options.attempt,
				...fields,
			});
		} catch {
			/* probes must not throw */
		}
	};

	const sinceFinal = (): number | undefined => finalAt === undefined ? undefined : Math.max(0, now() - finalAt);

	const safeCause = (): ChildExitProbeCause => {
		try {
			return options.cause?.() ?? "unknown";
		} catch {
			return "unknown";
		}
	};

	const stdioOpenNow = (): "both" | "stdout" | "stderr" | "none" => {
		if (stdoutClosedAt === undefined && stderrClosedAt === undefined) return "both";
		if (stdoutClosedAt === undefined) return "stdout";
		if (stderrClosedAt === undefined) return "stderr";
		return "none";
	};

	const clearTierTimers = (): void => {
		samplingCanceled = true;
		while (tierTimers.length > 0) {
			const timer = tierTimers.pop()!;
			clearTimeout(timer);
		}
	};

	const armNextTier = (): void => {
		if (samplingCanceled || finalAt === undefined || tierIndex >= tiers.length) return;
		const tierMs = tiers[tierIndex]!;
		tierIndex += 1;
		const elapsed = Math.max(0, now() - finalAt);
		const delay = Math.max(0, tierMs - elapsed);
		const timer = setTimeout(() => {
			if (samplingCanceled) return;
			void takeSample(tierMs);
			armNextTier();
		}, delay);
		timer.unref?.();
		tierTimers.push(timer);
	};

	const takeSample = (tierMs: number): void => {
		// Never sample after a terminal, and FREEZE the phase context FIRST: elapsed,
		// stdio state and cause are captured synchronously at tier fire so one record
		// can never mix a pre-query elapsed with a post-query stdio/cause.
		if (finished) return;
		const frozenElapsedMs = sinceFinal();
		const frozenStdioOpen = stdioOpenNow();
		const frozenCause = safeCause();
		// Observed death beats any OS table: after the child's `exit`, NO sample may
		// start (nothing in the table can be attributed to the child anymore — a
		// reused PID inside the same group shares pgid/sess). Record a minimal
		// non-attribution marker only.
		if (exitAt !== undefined) {
			emit({
				status: "sample",
				detail: "sample",
				tierMs,
				elapsedMs: frozenElapsedMs,
				sampleSrc: "unsupported",
				rootAlive: "no",
				stdioOpen: frozenStdioOpen,
				cause: frozenCause,
			});
			return;
		}
		const sampler = options.sampleDescendants
			?? ((pid: number, cap: number, opts: { rootExited: boolean; expected?: ChildIdentity }) => sampleDescendantsViaPs(pid, cap, opts));
		if (childPid === undefined || childPid <= 0) {
			emit({
				status: "sample",
				detail: "sample",
				tierMs,
				elapsedMs: frozenElapsedMs,
				sampleSrc: "unsupported",
				rootAlive: "unknown",
				stdioOpen: frozenStdioOpen,
				cause: frozenCause,
			});
			return;
		}
		// Fire-and-forget: the closeout path never awaits OS forensics.
		void sampler(childPid, capMs, { rootExited: false, ...(identity !== undefined ? { expected: identity } : {}) }).then(
			(sample) => {
				if (dropInFlightSamples) return; // terminal closed the window — no late samples
				const exitedByResolution = exitAt !== undefined;
				if (exitedByResolution) {
					// Exit landed while this query was in flight: no table row can be
					// attributed to the child anymore (zombie vs same-group reuse is
					// undecidable). Drop ps results entirely; keep only a field-less
					// stale/error marker for non-ps outcomes.
					if (sample.sampleSrc !== "ps") {
						emit({
							status: "sample",
							detail: "sample",
							tierMs,
							elapsedMs: frozenElapsedMs,
							sampleSrc: sample.sampleSrc,
							rootAlive: "no",
							stdioOpen: frozenStdioOpen,
							cause: frozenCause,
							...(sample.failReason ? { error: `child-exit-sample-${sample.failReason}` } : {}),
						});
					}
					return;
				}
				// Establish the child identity from the FIRST successful alive sample.
				if (
					identity === undefined
					&& sample.sampleSrc === "ps"
					&& (sample.pgid !== undefined || sample.sess !== undefined)
				) {
					identity = {
						...(sample.pgid !== undefined ? { pgid: sample.pgid } : {}),
						...(sample.sess !== undefined ? { sess: sample.sess } : {}),
					};
				}
				emit({
					status: "sample",
					detail: "sample",
					tierMs,
					elapsedMs: frozenElapsedMs,
					sampleSrc: sample.sampleSrc,
					rootAlive: sample.rootAlive,
					...(sample.descendants !== undefined ? { descendants: sample.descendants } : {}),
					...(sample.pgid !== undefined ? { pgid: sample.pgid } : {}),
					...(sample.sess !== undefined ? { sess: sample.sess } : {}),
					stdioOpen: frozenStdioOpen,
					cause: frozenCause,
					...(sample.sampleSrc === "error" && sample.failReason
						? { error: `child-exit-sample-${sample.failReason}` }
						: {}),
				});
			},
			() => {
				if (dropInFlightSamples) return;
				const exitedByResolution = exitAt !== undefined;
				if (exitedByResolution) {
					// Post-exit rejection: keep only the field-less stale/error marker.
					emit({
						status: "sample",
						detail: "sample",
						tierMs,
						elapsedMs: frozenElapsedMs,
						sampleSrc: "error",
						rootAlive: "no",
						stdioOpen: frozenStdioOpen,
						cause: frozenCause,
						error: "child-exit-sample-error",
					});
					return;
				}
				emit({
					status: "sample",
					detail: "sample",
					tierMs,
					elapsedMs: frozenElapsedMs,
					sampleSrc: "error",
					rootAlive: "unknown",
					stdioOpen: frozenStdioOpen,
					cause: frozenCause,
					error: "child-exit-sample-error",
				});
			},
		);
	};

	const finish = (closeAt: number, code: unknown, signal: unknown): void => {
		if (finished) return;
		finished = true;
		dropInFlightSamples = true; // no in-flight sample may land after the terminal
		clearTierTimers();
		// Node guarantees stdio is closed by ChildProcess `close`; any stream not yet
		// stamped closed exactly at the close instant. Stamping here (synchronously,
		// before the close record) keeps milestone order terminal-last WITHOUT a
		// microtask, and keeps the duration math complete.
		if (stdoutClosedAt === undefined) {
			stdoutClosedAt = closeAt;
			emit({ status: "mark", detail: "stdout-close", elapsedMs: finalAt === undefined ? undefined : Math.max(0, closeAt - finalAt) });
		}
		if (stderrClosedAt === undefined) {
			stderrClosedAt = closeAt;
			emit({ status: "mark", detail: "stderr-close", elapsedMs: finalAt === undefined ? undefined : Math.max(0, closeAt - finalAt) });
		}
		const exitCode = typeof code === "number" && Number.isFinite(code) ? code : undefined;
		const exitSignal = typeof signal === "string" && signal.length > 0 ? signal : undefined;
		const dur = (from: number | undefined): number | undefined =>
			from === undefined ? undefined : Math.max(0, closeAt - from);
		const stdioLast = stdoutClosedAt !== undefined || stderrClosedAt !== undefined
			? Math.max(stdoutClosedAt ?? 0, stderrClosedAt ?? 0)
			: undefined;
		emit({
			status: "mark",
			detail: "close",
			elapsedMs: dur(finalAt),
			...(exitCode !== undefined ? { exitCode } : {}),
			...(exitSignal !== undefined ? { signal: exitSignal } : {}),
			assistantToExitMs: finalAt !== undefined && exitAt !== undefined
				? Math.max(0, exitAt - finalAt)
				: undefined,
			exitToStdioCloseMs: exitAt !== undefined && stdioLast !== undefined
				? Math.max(0, stdioLast - exitAt)
				: undefined,
			exitToCloseMs: dur(exitAt),
			cause: safeCause(),
		});
	};

	// All listeners are `once`: they cannot accumulate across attempts (one probe
	// per spawned proc) and auto-detach after firing. Every handler is synchronous
	// and guarded: after the close terminal, no further milestone is emitted.
	try {
		options.proc.once("exit", (code: unknown, signal: unknown) => {
			if (finished) return;
			lastExitCode = code;
			lastExitSignal = signal;
			if (exitAt === undefined) exitAt = now();
			const exitCode = typeof code === "number" && Number.isFinite(code) ? code : undefined;
			const exitSignal = typeof signal === "string" && signal.length > 0 ? signal : undefined;
			emit({
				status: "mark",
				detail: "exit",
				elapsedMs: sinceFinal(),
				...(exitCode !== undefined ? { exitCode } : {}),
				...(exitSignal !== undefined ? { signal: exitSignal } : {}),
			});
		});
		const watchStream = (
			stream: { once(event: string, listener: () => void): unknown } | null | undefined,
			detail: "stdout-close" | "stderr-close",
		): void => {
			if (!stream) return;
			const note = (): void => {
				if (finished) return; // the close terminal already stamped/recorded this stream
				if (detail === "stdout-close") {
					if (stdoutClosedAt !== undefined) return;
					stdoutClosedAt = now();
				} else {
					if (stderrClosedAt !== undefined) return;
					stderrClosedAt = now();
				}
				emit({ status: "mark", detail, elapsedMs: sinceFinal() });
			};
			// `end` (EOF) normally precedes ChildProcess `close`; stream `close` can fire
			// in the same tick. Listening to both (idempotent) pins the true late-pipe time.
			stream.once("end", note);
			stream.once("close", note);
		};
		watchStream(options.proc.stdout, "stdout-close");
		watchStream(options.proc.stderr, "stderr-close");
		if (options.proc.connected === true) {
			options.proc.once("disconnect", () => {
				if (finished) return;
				emit({ status: "mark", detail: "disconnect", elapsedMs: sinceFinal() });
			});
		}
		options.proc.once("close", (code: unknown, signal: unknown) => {
			const closeAt = now(); // FIRST LINE: the true close time, synchronously captured
			finish(closeAt, code ?? lastExitCode, signal ?? lastExitSignal);
		});
		options.proc.once("error", () => {
			if (finished) return;
			// An error is a REAL event, not a close: record it as its own milestone and
			// keep waiting for the genuine close (Node emits `close` after `error`).
			emit({ status: "mark", detail: "error", elapsedMs: sinceFinal() });
			// Sampling stops here so no sample can land after the error either.
			dropInFlightSamples = true;
			clearTierTimers();
		});
	} catch {
		/* listener wiring refused: probe degrades to sampling only, never throws */
	}

	return {
		markFinal() {
			if (finalAt !== undefined) return;
			finalAt = now();
			emit({ status: "mark", detail: "final", elapsedMs: 0 });
			armNextTier();
		},
		dispose() {
			dropInFlightSamples = true;
			clearTierTimers();
		},
		seal() {
			// The first-layer terminal is on disk (error path). Nothing attributed to
			// the child — close marks, stdio fills, disconnect, in-flight samples —
			// may ever land after it.
			finished = true;
			dropInFlightSamples = true;
			clearTierTimers();
		},
	};
}
