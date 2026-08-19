/**
 * Runtime-owned worktree merge recovery (Swift SubagentStore parity, host-free).
 *
 * Swift's App watches every merge outcome and, on failure, resumes the original worker as a
 * fixer up to three times before escalating to the Boss. On hosts that handed finalization to
 * pi (`PIPIUI_WORKTREE_FINALIZER=pi`) there is no App watching — so the loop lives here, next
 * to the finalizer it repairs. The pieces are deliberately small and injected:
 *
 * - a durable per-agentId attempt ledger under `.pi/pipiui-memory/` so restarts neither drop a
 *   recovery nor run a second one (Swift: `WorktreeRecoveryState` persistence);
 * - an injected dispatcher that resumes the exact agentId (Swift: `/subagent_recover`);
 * - an injected escalate sink for Boss messages (Swift: `[worktree-merge-failed]` injection),
 *   with the same 60s dedup so parallel failure waves inject once.
 *
 * The decision layer is pure (`decideWorktreeRecovery`) so every branch is auditable without
 * Git, timers, or a live session.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { WorktreeFinalizationStateV1 } from "../subagent-host/worktree/schema.ts";
import {
	claimAgentCleanupLease,
	inspectAgentLease,
	reapStaleAgentLease,
	releaseAgentCleanupLease,
} from "./agent-lease.ts";

/** Swift parity: three fixer attempts; the third switches to a fresh context. */
export const MAX_RECOVERY_ATTEMPTS = 3;
/** Swift parity: one merge-retry window, so main becoming clean wakes every waiter at once. */
export const WAITING_FOR_MAIN_RETRY_MS = 60_000;
/** Swift parity: identical failure injections are deduped for 60s. */
const ESCALATION_DEDUP_MS = 60_000;

export interface WorktreeRecoveryRecord {
	attempt: number;
	fresh: boolean;
	bossSignaled: boolean;
	/**
	 * The worker's agent name, persisted because a restart rebuilds the loop before any job
	 * registry rehydration — resume needs it to redispatch the exact role.
	 */
	name?: string;
	/**
	 * A fixer was dispatched for this record but no terminal finalization has settled it yet.
	 * A restart seeing this flag re-dispatches exactly once (Swift fixerRunning parity); the
	 * dispatch itself is idempotent per agentId, so a double-fire is a no-op resume, never a
	 * second fixer.
	 */
	inFlight?: boolean;
	/** Serialized finalization state retained for waiting-for-main retries. */
	waitingState?: WorktreeFinalizationStateV1;
	updatedAt: number;
}

export type WorktreeRecoveryStoreShape = {
	schemaVersion: 1;
	records: Record<string, WorktreeRecoveryRecord>;
};

function emptyStore(): WorktreeRecoveryStoreShape {
	return { schemaVersion: 1, records: {} };
}

function normalizeRecord(raw: unknown): WorktreeRecoveryRecord | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const candidate = raw as Record<string, unknown>;
	if (typeof candidate.attempt !== "number" || !Number.isSafeInteger(candidate.attempt) || candidate.attempt < 0) return undefined;
	if (typeof candidate.bossSignaled !== "boolean") return undefined;
	return {
		attempt: candidate.attempt,
		fresh: candidate.fresh === true,
		bossSignaled: candidate.bossSignaled,
		...(typeof candidate.name === "string" && candidate.name.trim() ? { name: candidate.name } : {}),
		...(candidate.inFlight === true ? { inFlight: true } : {}),
		...(candidate.waitingState && typeof candidate.waitingState === "object"
			? { waitingState: candidate.waitingState as WorktreeFinalizationStateV1 }
			: {}),
		updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
	};
}

/**
 * Durable attempt ledger. Reads tolerate missing/corrupt files (a lost ledger only means a
 * recovery restarts from attempt 0 — it can never run two fixers at once, because dispatch
 * itself is idempotent per agentId); writes are atomic so a crash never tears the file.
 */
export class WorktreeRecoveryStoreV1 {
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	readUnarmed(): WorktreeRecoveryStoreShape {
		try {
			const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as { schemaVersion?: unknown; records?: unknown };
			if (raw?.schemaVersion !== 1 || !raw.records || typeof raw.records !== "object") return emptyStore();
			const records: Record<string, WorktreeRecoveryRecord> = {};
			for (const [agentId, record] of Object.entries(raw.records as Record<string, unknown>)) {
				const normalized = normalizeRecord(record);
				if (normalized) records[agentId] = normalized;
			}
			return { schemaVersion: 1, records };
		} catch {
			return emptyStore();
		}
	}

	load(): WorktreeRecoveryStoreShape {
		const store = this.readUnarmed();
		// After the caller finishes this turn's recovery decisions (fixer re-dispatch),
		// reap leftover trees that those decisions did not keep active.
		armLeftoverWorktreeSweep(this);
		return store;
	}

	save(store: WorktreeRecoveryStoreShape): void {
		try {
			fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
			const tmp = `${this.filePath}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
			fs.renameSync(tmp, this.filePath);
		} catch {
			// Recovery persistence is best-effort: a failed write degrades to in-memory behavior.
		}
	}

	get(agentId: string): WorktreeRecoveryRecord | undefined {
		return this.load().records[agentId];
	}

	upsert(agentId: string, patch: Partial<Omit<WorktreeRecoveryRecord, "waitingState">> & { waitingState?: WorktreeFinalizationStateV1 | null }): WorktreeRecoveryRecord {
		const store = this.load();
		const current = store.records[agentId] ?? { attempt: 0, fresh: false, bossSignaled: false, updatedAt: Date.now() };
		const next: WorktreeRecoveryRecord = { ...current, ...patch, updatedAt: Date.now() };
		// null is the explicit "drop the retained state" marker; it never serializes.
		if (patch.waitingState === null) delete next.waitingState;
		store.records[agentId] = next;
		this.save(store);
		return next;
	}

	clear(agentId: string): void {
		const store = this.load();
		if (!(agentId in store.records)) return;
		delete store.records[agentId];
		this.save(store);
	}
}

/** Directory convention: alongside the Boss ledger, one ledger file per routing key. */
export function worktreeRecoveryStorePath(mainCwd: string, sessionKey?: string): string {
	const key = (sessionKey ?? "").trim() || "default";
	return path.join(mainCwd, ".pi", "pipiui-memory", `worktree-recovery-${key}.json`);
}

function recoveryStoreMainCwd(store: WorktreeRecoveryStoreV1): string | undefined {
	const filePath = (store as unknown as { filePath: string }).filePath;
	const marker = `${path.sep}.pi${path.sep}pipiui-memory${path.sep}`;
	const index = filePath.lastIndexOf(marker);
	if (index <= 0) return undefined;
	return filePath.slice(0, index);
}

const LEFTOVER_WORKTREE_SWEEP_KEY = "__pipiuiLeftoverWorktreeSweep";
const LEFTOVER_WORKTREE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const leftoverSweepArmed = new Set<string>();

function leftoverWorktreeActiveAgentIds(store: WorktreeRecoveryStoreV1): Set<string> {
	const active = new Set<string>();
	for (const [agentId, record] of Object.entries(store.readUnarmed().records)) {
		if (record.inFlight || record.waitingState) active.add(agentId);
	}
	return active;
}

function leftoverSweepLeaseHooks(mainCwd: string) {
	return {
		inspect(agentId: string) {
			return inspectAgentLease(mainCwd, agentId).status;
		},
		reapStale(agentId: string) {
			return reapStaleAgentLease(mainCwd, agentId);
		},
		claimCleanup(agentId: string) {
			const claimed = claimAgentCleanupLease(mainCwd, agentId, "leftover-sweep");
			if (!claimed.lease) {
				return {
					ok: false as const,
					status: inspectAgentLease(mainCwd, agentId).status,
					message: claimed.problem,
				};
			}
			return {
				ok: true as const,
				claim: {
					releaseOnEnd: claimed.created,
					release() {
						releaseAgentCleanupLease(claimed);
					},
				},
			};
		},
	};
}

async function runLeftoverWorktreeSweep(store: WorktreeRecoveryStoreV1): Promise<void> {
	const mainCwd = recoveryStoreMainCwd(store);
	if (!mainCwd) return;
	try {
		const { WorktreeFinalizationServiceV1 } = await import("../subagent-host/worktree/index.ts");
		await new WorktreeFinalizationServiceV1({
			logger: {
				info(event, fields) {
					console.info(`[pipiui-subagent] ${event}`, fields ?? {});
				},
				warn(event, fields) {
					console.warn(`[pipiui-subagent] ${event}`, fields ?? {});
				},
			},
		}).sweepLeftovers({
			mainCwd,
			activeAgentIds: leftoverWorktreeActiveAgentIds(store),
			lease: leftoverSweepLeaseHooks(mainCwd),
		});
	} catch (error) {
		console.warn("[pipiui-subagent] worktree leftover sweep failed", error);
	}
}

/**
 * Startup recovery loads the ledger first, then this deferred sweep runs after those
 * decisions are queued. In-flight / waiting-for-main records stay in the active set.
 */
function armLeftoverWorktreeSweep(store: WorktreeRecoveryStoreV1): void {
	const depth = Number.parseInt(process.env.PIPIUI_AGENT_DEPTH || "0", 10);
	const filePath = (store as unknown as { filePath: string }).filePath;
	if (depth !== 0 || leftoverSweepArmed.has(filePath)) return;
	leftoverSweepArmed.add(filePath);
	queueMicrotask(() => {
		void runLeftoverWorktreeSweep(store);
	});
	const globalState = globalThis as Record<string, unknown>;
	const previous = globalState[LEFTOVER_WORKTREE_SWEEP_KEY] as ReturnType<typeof setInterval> | undefined;
	if (previous) return;
	const timer = setInterval(() => {
		void runLeftoverWorktreeSweep(store);
	}, LEFTOVER_WORKTREE_SWEEP_INTERVAL_MS);
	timer.unref?.();
	globalState[LEFTOVER_WORKTREE_SWEEP_KEY] = timer;
}

// ---------------------------------------------------------------------------
// Pure decision layer
// ---------------------------------------------------------------------------

export type WorktreeRecoveryAction =
	| { kind: "none" }
	| { kind: "clear" }
	| { kind: "recover"; fresh: boolean; attempt: number }
	| { kind: "waiting-for-main" }
	| { kind: "escalate"; message: "merge-failed" | "verify-failed" };

export interface WorktreeRecoveryDecisionInput {
	merge: WorktreeFinalizationStateV1["result"]["merge"];
	recoveryDisposition: WorktreeFinalizationStateV1["result"]["recovery"]["disposition"];
	nextAction: WorktreeFinalizationStateV1["result"]["recovery"]["nextAction"];
	postMergeVerify: WorktreeFinalizationStateV1["result"]["verify"]["postMerge"];
	attempt: number;
	bossSignaled: boolean;
}

/**
 * The only merge failures a resumed worker can fix are the committed-tree ones: a real merge
 * conflict, or a merge that failed mechanically and can be retried. Dirty/uncommitted worker
 * trees and pre-merge verify failures need the worker's own continuation, which the existing
 * interrupted-reminder channel already drives — so this loop stays strictly about integration.
 */
const RECOVERABLE_NEXT_ACTIONS = new Set(["resolve-conflict", "retry-finalization"]);

export function decideWorktreeRecovery(input: WorktreeRecoveryDecisionInput): WorktreeRecoveryAction {
	if (input.merge === "merged" || input.merge === "already-integrated") {
		// Integrated but still not "merged" overall (cleanup/verify remain) still ends THIS
		// loop: the integration the fixer was resumed for has happened.
		if (input.postMergeVerify === "failed") return { kind: "escalate", message: "verify-failed" };
		return { kind: "clear" };
	}
	if (input.postMergeVerify === "failed") return { kind: "escalate", message: "verify-failed" };
	if (input.recoveryDisposition === "waiting-for-main") return { kind: "waiting-for-main" };
	const recoverable =
		(input.merge === "conflicted" || input.merge === "failed")
		&& RECOVERABLE_NEXT_ACTIONS.has(input.nextAction);
	if (recoverable) {
		const attempt = input.attempt + 1;
		if (attempt <= MAX_RECOVERY_ATTEMPTS) {
			return { kind: "recover", fresh: attempt === MAX_RECOVERY_ATTEMPTS, attempt };
		}
		if (!input.bossSignaled) return { kind: "escalate", message: "merge-failed" };
		return { kind: "none" };
	}
	return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Escalation messages (Swift WorktreeMergeFailedMessage / PostMergeVerifyFailedMessage parity)
// ---------------------------------------------------------------------------

const MERGE_FAILED_GUIDANCE =
	"Worktree kept (pendingReview). Default action: dispatch a general-purpose fixer to resolve the merge (brief carries the branch name + conflicted file list, verify = the post-merge build/test command). You adjudicate three ways only: accept the fixer result / discard a worthless worktree / ask the user (one sentence, one concrete choice). Never open conflict diffs yourself; never forward the raw git error to the user; do not treat this message as a new user request.";

export function formatWorktreeMergeFailedMessage(input: {
	agentId: string;
	name?: string;
	branch?: string;
	worktreePath?: string;
	error: string;
	attemptsUsed: number;
	conflictPaths?: string[];
}): string {
	const lines = [
		`[worktree-merge-failed] agentId=${input.agentId} name=${input.name ?? "?"} branch=${input.branch ?? "?"} path=${input.worktreePath ?? "?"} attempts=${input.attemptsUsed}/${MAX_RECOVERY_ATTEMPTS}`,
		"",
		"error:",
		input.error,
	];
	if (input.conflictPaths && input.conflictPaths.length > 0) {
		lines.push("", "conflicted files:", ...input.conflictPaths);
	}
	lines.push("", MERGE_FAILED_GUIDANCE);
	return lines.join("\n");
}

export function formatPostMergeVerifyFailedMessage(input: {
	agentId: string;
	name?: string;
	branch?: string;
	command?: string;
	exitCode?: number;
	timedOut?: boolean;
	outputTail?: string;
	mainDirty?: boolean;
}): string {
	const exitDesc = input.timedOut ? `${input.exitCode ?? -1} (timeout)` : `${input.exitCode ?? -1}`;
	const guidance = input.mainDirty
		? "The main repo failed this attested verify command after merging the branch, but the main repo currently has uncommitted changes — the failure may come from the user's own work in progress, not this agent's work. Attribute first: if it belongs to the agent's work, dispatch a general-purpose fixer on the main repo (brief carries the command and output tail above, verify = the same command); if it looks like user WIP, explain to the user in one sentence and never touch their uncommitted code. Do not treat this message as a new user request."
		: "The main repo failed this attested verify command after merging the branch; the worktree has been merged and removed. Immediately dispatch a general-purpose fixer on the main repo (brief carries the command and output tail above, verify = the same command); accept only after verified=pass. Ask the user briefly only when the trade-off is genuinely theirs. Do not treat this message as a new user request.";
	return [
		`[post-merge-verify-failed] agentId=${input.agentId} name=${input.name ?? "?"} branch=${input.branch ?? "?"}` + (input.mainDirty ? " mainDirty=true" : ""),
		"",
		`verify: $ ${input.command ?? "(unknown)"} → exit ${exitDesc}`,
		"output tail:",
		input.outputTail?.trim() || "(no output)",
		"",
		guidance,
	].join("\n");
}

/** A dirty main changes the verify-failure guidance, so probe it the way Swift does. */
export function probeMainDirty(mainCwd: string): boolean {
	try {
		const env = { ...process.env };
		delete env.PIPIUI_COMPUTER_CAPABILITY;
		const result = spawnSync("git", ["-C", mainCwd, "status", "--porcelain"], {
			encoding: "utf8",
			shell: false,
			env,
			timeout: 10_000,
		});
		if (result.status !== 0 || result.error) return true;
		return typeof result.stdout === "string" && result.stdout.trim().length > 0;
	} catch {
		return true;
	}
}

// ---------------------------------------------------------------------------
// Injection dedup (Swift shouldNotify parity)
// ---------------------------------------------------------------------------

/** Inject the same failure once per 60s window; parallel waves share one message. */
export class EscalationDeduperV1 {
	private readonly lastInjected = new Map<string, number>();
	private readonly windowMs: number;
	private readonly now: () => number;

	constructor(options?: { windowMs?: number; now?: () => number }) {
		this.windowMs = options?.windowMs ?? ESCALATION_DEDUP_MS;
		this.now = options?.now ?? Date.now;
	}

	shouldInject(kind: string, agentId: string, detail: string): boolean {
		const key = `${kind}|${agentId}|${detail}`;
		const current = this.now();
		const previous = this.lastInjected.get(key);
		if (previous !== undefined && current - previous < this.windowMs) return false;
		this.lastInjected.set(key, current);
		return true;
	}
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface WorktreeRecoveryDispatchInput {
	agentId: string;
	name?: string;
	fresh: boolean;
	verifyCommand?: string;
}

export interface WorktreeRecoveryContext {
	agentId: string;
	name?: string;
	mainCwd?: string;
	branch?: string;
	worktreePath?: string;
	verifyCommand?: string;
	state: WorktreeFinalizationStateV1;
	/** Resume the exact agentId as the fixer (the /subagent_recover core). */
	dispatchRecovery: (input: WorktreeRecoveryDispatchInput) => void;
	/** Deliver one structured escalation message to the Boss conversation. */
	escalate: (text: string) => void;
	/** Re-run finalization for a retained waiting-for-main record. */
	retryFinalization?: (state: WorktreeFinalizationStateV1) => Promise<void> | void;
	depth?: number;
}

const escalationDeduper = new EscalationDeduperV1();

function mergeErrorText(state: WorktreeFinalizationStateV1): string {
	return state.result.recovery.reason || state.result.messages.join("\n") || "merge failed";
}

/**
 * Apply one terminal finalization to the recovery loop. Depth-gated: only the Boss-depth
 * process owns escalation, because a worker-depth session ends with its process and has no
 * durable conversation to wake.
 */
export function scheduleWorktreeRecovery(
	store: WorktreeRecoveryStoreV1,
	context: WorktreeRecoveryContext,
): WorktreeRecoveryAction {
	const { agentId, state } = context;
	if (context.depth !== undefined && context.depth !== 0) return { kind: "none" };
	const record = store.get(agentId);
	const action = decideWorktreeRecovery({
		merge: state.result.merge,
		recoveryDisposition: state.result.recovery.disposition,
		nextAction: state.result.recovery.nextAction,
		postMergeVerify: state.result.verify.postMerge,
		attempt: record?.attempt ?? 0,
		bossSignaled: record?.bossSignaled ?? false,
	});

	switch (action.kind) {
		case "clear":
			store.clear(agentId);
			return action;
		case "recover": {
			// Persist the claim BEFORE dispatch (Swift order): a replayed terminal event or a
			// concurrent restart sees the claim. The claim survives until a later terminal
			// finalization settles the record (merge lands, or the attempts budget moves on to
			// escalation) — there is no in-process "done" hook to clear it sooner.
			store.upsert(agentId, {
				attempt: action.attempt,
				fresh: action.fresh,
				inFlight: true,
				...(context.name ? { name: context.name } : {}),
			});
			context.dispatchRecovery({
				agentId,
				name: context.name,
				fresh: action.fresh,
				verifyCommand: context.verifyCommand,
			});
			return action;
		}
		case "waiting-for-main": {
			store.upsert(agentId, { waitingState: state });
			scheduleWaitingForMainRetry(store, context);
			return action;
		}
		case "escalate": {
			if (action.message === "merge-failed") {
				const attemptsUsed = record?.attempt ?? MAX_RECOVERY_ATTEMPTS;
				const detail = mergeErrorText(state);
				if (escalationDeduper.shouldInject("merge", agentId, detail)) {
					store.upsert(agentId, { bossSignaled: true });
					context.escalate(
						formatWorktreeMergeFailedMessage({
							agentId,
							name: context.name,
							branch: context.branch,
							worktreePath: context.worktreePath,
							error: detail,
							attemptsUsed,
						}),
					);
				}
			} else {
				const mainDirty = context.mainCwd ? probeMainDirty(context.mainCwd) : false;
				const detail = `${state.result.verify.command ?? ""}|${state.result.verify.postMergeExitCode ?? -1}|${state.result.verify.postMergeTimedOut === true}`;
				if (escalationDeduper.shouldInject("verify", agentId, detail)) {
					store.upsert(agentId, { bossSignaled: true });
					context.escalate(
						formatPostMergeVerifyFailedMessage({
							agentId,
							name: context.name,
							branch: context.branch,
							command: state.result.verify.command,
							exitCode: state.result.verify.postMergeExitCode,
							timedOut: state.result.verify.postMergeTimedOut === true,
							outputTail: state.result.verify.outputTail,
							mainDirty,
						}),
					);
				}
			}
			return action;
		}
		case "none":
		default:
			return action;
	}
}

// ---------------------------------------------------------------------------
// waiting-for-main retry
// ---------------------------------------------------------------------------

let waitingForMainTimer: ReturnType<typeof setTimeout> | undefined;
/** One live context per store path so the timer can still find its retry target. */
const waitingForMainContexts = new Map<string, WorktreeRecoveryContext>();

function waitingForMainKey(store: WorktreeRecoveryStoreV1): string {
	return (store as unknown as { filePath: string }).filePath;
}

/**
 * Single-slot retry window (Swift scheduleWaitingForMainRetry parity): every retained record
 * behind one timer, so a main checkout becoming clean wakes all waiters together.
 */
export function scheduleWaitingForMainRetry(
	store: WorktreeRecoveryStoreV1,
	context: WorktreeRecoveryContext,
	options?: { delayMs?: number },
): void {
	waitingForMainContexts.set(waitingForMainKey(store), context);
	if (waitingForMainTimer) return;
	const delay = options?.delayMs ?? WAITING_FOR_MAIN_RETRY_MS;
	waitingForMainTimer = setTimeout(() => {
		waitingForMainTimer = undefined;
		runWaitingForMainRetry(store);
	}, delay);
	waitingForMainTimer.unref?.();
}

async function runWaitingForMainRetry(store: WorktreeRecoveryStoreV1): Promise<void> {
	const context = waitingForMainContexts.get(waitingForMainKey(store));
	const retry = context?.retryFinalization;
	if (!retry) return;
	const loaded = store.load();
	for (const [agentId, record] of Object.entries(loaded.records)) {
		if (!record.waitingState) continue;
		const state = record.waitingState;
		store.upsert(agentId, { waitingState: null });
		try {
			await retry(state);
		} catch {
			// A failed retry simply leaves the record retained; the next terminal event or
			// restart re-arms the loop.
			store.upsert(agentId, { waitingState: state });
		}
	}
}

/** Test-only: drop module timer/context state between fixtures. */
export function resetWaitingForMainForTests(): void {
	if (waitingForMainTimer) clearTimeout(waitingForMainTimer);
	waitingForMainTimer = undefined;
	waitingForMainContexts.clear();
	resetLeftoverWorktreeSweepForTests();
}

/** Test-only: drop the leftover-worktree sweep interval armed by store.load(). */
export function resetLeftoverWorktreeSweepForTests(): void {
	const globalState = globalThis as Record<string, unknown>;
	const previous = globalState[LEFTOVER_WORKTREE_SWEEP_KEY] as ReturnType<typeof setInterval> | undefined;
	if (previous) clearInterval(previous);
	delete globalState[LEFTOVER_WORKTREE_SWEEP_KEY];
	leftoverSweepArmed.clear();
}
