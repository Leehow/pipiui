/**
 * Bounded closeout waits and metadata-only probes.
 * Never records prompt, tool args, stdout/stderr, final text, or secrets.
 */

import { recordCloseoutTimeline } from "./closeout-timeline.ts";
import { logStallProbe } from "./stall-diagnostics.ts";

export const DEFAULT_READONLY_CHILD_EXIT_GRACE_MS = 5_000;
/** A writable worker that has emitted its final message but not yet closed is given
 *  this post-final grace before the direct worker PID is SIGTERM'd (then SIGKILL'd
 *  5s later). This bounds the child-exit long-tail: final → forced kill ≈ 20s. */
export const DEFAULT_WRITABLE_CHILD_EXIT_GRACE_MS = 15_000;
/** Safety ceiling so an operator/env override cannot make the writable post-final
 *  wait effectively unbounded (default is 15s; this permits headroom, never infinite). */
export const MAX_WRITABLE_CHILD_EXIT_GRACE_MS = 60_000;
export const DEFAULT_TERMINAL_REPORT_BUDGET_MS = 8_000;
export const DEFAULT_REPORT_DRAIN_BUDGET_MS = 3_000;

export type CloseoutProbeState =
	| "enter"
	| "ok"
	| "error"
	| "timeout"
	| "terminate"
	| "exit"
	| "late-ok"
	| "late-error"
	/** Hold interval closed without a release (entry forgotten/replaced). */
	| "skip";

export type CloseoutProbeFields = {
	agent?: string;
	run?: string;
	role?: string;
	phase?: string;
	state: CloseoutProbeState;
	elapsedMs?: number;
	error?: string;
	pid?: number;
	attempt?: number;
};

export type CloseoutLate<T> =
	| { status: "fulfilled"; value: T }
	| { status: "rejected"; reason: unknown };

export type CloseoutWaitOutcome<T> =
	| { status: "settled"; value: T }
	| { status: "rejected"; reason: unknown }
	| { status: "timeout" };

const WORKTREE_PROBE_EVENT: Record<string, string> = {
	"queue-wait": "worktree-queue",
	reconciling: "worktree-reconcile",
	merging: "worktree-merge",
	"on-merged": "worktree-on-merged",
	cleaning: "worktree-cleanup",
	"post-verify": "worktree-post-verify",
};

/** lastPhaseError only for timeout/error. enter/ok/wait/terminate/exit must stay clean. */
export function closeoutPhaseError(event: string, state: CloseoutProbeState): string | undefined {
	if (state === "timeout") return `${event}-timeout`;
	if (state === "error") return `${event}-error`;
	return undefined;
}

export function readonlyChildExitGraceMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.PIPIUI_READONLY_CHILD_EXIT_GRACE_MS?.trim();
	if (!raw) return DEFAULT_READONLY_CHILD_EXIT_GRACE_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_READONLY_CHILD_EXIT_GRACE_MS;
}

export function writableChildExitGraceMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.PIPIUI_WRITABLE_CHILD_EXIT_GRACE_MS?.trim();
	if (!raw) return DEFAULT_WRITABLE_CHILD_EXIT_GRACE_MS;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_WRITABLE_CHILD_EXIT_GRACE_MS;
	// Clamp to the safety ceiling: an override may shorten the grace (tests) but never
	// lengthen it past the explicit bounded cap, so ordinary config can't unbrake it.
	return Math.min(parsed, MAX_WRITABLE_CHILD_EXIT_GRACE_MS);
}

function notifyLate<T>(onLate: ((late: CloseoutLate<T>) => void) | undefined, late: CloseoutLate<T>): void {
	if (!onLate) return;
	try {
		onLate(late);
	} catch {
		/* probe callbacks must not become a second failure mode */
	}
}

export function consumeCloseoutLate<T>(
	promise: Promise<T>,
	onLate?: (late: CloseoutLate<T>) => void,
): void {
	void promise.then(
		(value) => notifyLate(onLate, { status: "fulfilled", value }),
		(reason) => notifyLate(onLate, { status: "rejected", reason }),
	);
}

export function waitAbortable(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(finish, ms);
		timer.unref?.();
		if (!signal) return;
		const onAbort = () => finish();
		signal.addEventListener("abort", onAbort, { once: true });
		function finish(): void {
			clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
			resolve();
		}
	});
}

/** Per-attempt fetch timeout that aborts with the parent and always drops its timer. */
export function createTimeoutAbort(
	ms: number,
	parent?: AbortSignal,
): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	if (parent?.aborted || !Number.isFinite(ms) || ms <= 0) {
		controller.abort();
		return { signal: controller.signal, dispose() {} };
	}
	const timer = setTimeout(() => controller.abort(), ms);
	timer.unref?.();
	const onParent = (): void => {
		clearTimeout(timer);
		try {
			controller.abort();
		} catch {
			/* already aborted */
		}
	};
	parent?.addEventListener("abort", onParent, { once: true });
	return {
		signal: controller.signal,
		dispose() {
			clearTimeout(timer);
			parent?.removeEventListener("abort", onParent);
		},
	};
}

export async function runAbortableRetries(
	attempt: (signal: AbortSignal) => Promise<boolean>,
	signal: AbortSignal,
	delays: readonly number[],
): Promise<"ok" | "aborted" | "exhausted"> {
	for (let index = 0; ; index++) {
		if (signal.aborted) return "aborted";
		if (await attempt(signal)) return "ok";
		if (signal.aborted) return "aborted";
		if (index >= delays.length) return "exhausted";
		await waitAbortable(delays[index]!, signal);
	}
}

export type CloseoutReportPost<T> = (payload: T, signal: AbortSignal) => Promise<unknown>;

export type CloseoutReportRef = {
	agentId: string;
	runId?: string;
};

/** True when a live handle already belongs to a newer run of the same agentId. */
export function isSupersededCloseoutReport(
	payload: CloseoutReportRef,
	liveRunId: string | undefined,
): boolean {
	return Boolean(liveRunId && payload.runId && payload.runId !== liveRunId);
}

type CloseoutReportAgentState<T> = {
	generation: number;
	abort: AbortController;
	tail: Promise<void>;
};

/**
 * Per-agentId ordered report queue with an O(agentId) current-run epoch.
 * beginRun owns the live run; any other runId is stale. Same-run beginRun is
 * idempotent: it must not unseal or abort the current queue. Terminal end
 * seals the current run so same-run late enqueue cannot POST. Timeout also aborts.
 */
type CloseoutReportEpoch = {
	runId: string;
	sealed: boolean;
};

export function createCloseoutReportQueue<T extends CloseoutReportRef>(): {
	beginRun(agentId: string, runId: string): void;
	enqueue(payload: T, post: CloseoutReportPost<T>): Promise<void>;
	has(agentId: string): boolean;
	tail(agentId: string): Promise<void> | undefined;
	currentRun(agentId: string): string | undefined;
	sealedRun(agentId: string): string | undefined;
	isSealedRun(agentId: string, runId?: string): boolean;
	ignores(agentId: string, runId?: string): boolean;
	seal(agentId: string, runId: string | undefined): void;
	abandon(agentId: string, runId?: string): boolean;
	drain(agentId: string): Promise<void>;
} {
	const agents = new Map<string, CloseoutReportAgentState<T>>();
	const epochs = new Map<string, CloseoutReportEpoch>();

	const currentRun = (agentId: string): string | undefined => epochs.get(agentId)?.runId;

	const isSealedRun = (agentId: string, runId?: string): boolean => {
		const epoch = epochs.get(agentId);
		return Boolean(runId && epoch && epoch.runId === runId && epoch.sealed);
	};

	const ignores = (agentId: string, runId?: string): boolean => {
		const epoch = epochs.get(agentId);
		if (!runId) return Boolean(epoch);
		if (!epoch) return true;
		return epoch.runId !== runId || epoch.sealed;
	};

	const abortAgent = (agentId: string): void => {
		const state = agents.get(agentId);
		if (!state) return;
		state.generation += 1;
		try {
			state.abort.abort();
		} catch {
			/* already aborted */
		}
		agents.delete(agentId);
	};

	const beginRun = (agentId: string, runId: string): void => {
		const epoch = epochs.get(agentId);
		if (epoch?.runId === runId) return;
		abortAgent(agentId);
		epochs.set(agentId, { runId, sealed: false });
	};

	const seal = (agentId: string, runId: string | undefined): void => {
		if (!runId) return;
		const epoch = epochs.get(agentId);
		if (!epoch) {
			epochs.set(agentId, { runId, sealed: true });
			return;
		}
		if (epoch.runId === runId) epoch.sealed = true;
	};

	const abandon = (agentId: string, runId?: string): boolean => {
		const epoch = epochs.get(agentId);
		if (runId && epoch && epoch.runId !== runId) {
			return true;
		}
		if (runId) seal(agentId, runId);
		else if (epoch) epoch.sealed = true;
		abortAgent(agentId);
		return true;
	};

	return {
		beginRun,
		enqueue(payload, post) {
			if (ignores(payload.agentId, payload.runId)) return Promise.resolve();
			let state = agents.get(payload.agentId);
			if (!state) {
				state = {
					generation: 0,
					abort: new AbortController(),
					tail: Promise.resolve(),
				};
				agents.set(payload.agentId, state);
			}
			const owner = state;
			const generation = owner.generation;
			const flight = owner.tail.catch(() => {}).then(async () => {
				if (ignores(payload.agentId, payload.runId) || owner.generation !== generation || owner.abort.signal.aborted) {
					return;
				}
				await post(payload, owner.abort.signal);
			});
			owner.tail = flight;
			const cleanup = (): void => {
				const current = agents.get(payload.agentId);
				if (current === owner && current.tail === flight && current.generation === generation) {
					agents.delete(payload.agentId);
				}
			};
			void flight.then(cleanup, cleanup);
			return flight;
		},
		has: (agentId) => agents.has(agentId),
		tail: (agentId) => agents.get(agentId)?.tail,
		currentRun,
		sealedRun: (agentId) => {
			const epoch = epochs.get(agentId);
			return epoch?.sealed ? epoch.runId : undefined;
		},
		isSealedRun,
		ignores,
		seal,
		abandon,
		async drain(agentId) {
			while (agents.has(agentId)) {
				const current = agents.get(agentId);
				if (!current) return;
				await current.tail.catch(() => {});
			}
		},
	};
}

function positiveTimeoutMs(timeoutMs: number, fallback: number): number {
	return Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : fallback;
}

/**
 * Race optional closeout work against a hard deadline.
 * Timeout returns locally; the loser is consumed so it cannot finish twice
 * or surface as an unhandled rejection.
 */
export async function awaitBounded<T>(
	work: Promise<T>,
	timeoutMs: number,
	options?: {
		signal?: AbortSignal;
		fallbackMs?: number;
		onLate?: (late: CloseoutLate<T>) => void;
	},
): Promise<CloseoutWaitOutcome<T>> {
	const ms = positiveTimeoutMs(timeoutMs, options?.fallbackMs ?? timeoutMs);
	if (!Number.isSafeInteger(ms) || ms <= 0) {
		consumeCloseoutLate(work, options?.onLate);
		return { status: "timeout" };
	}
	if (options?.signal?.aborted) {
		consumeCloseoutLate(work, options.onLate);
		return { status: "timeout" };
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	let settled = false;
	try {
		return await new Promise<CloseoutWaitOutcome<T>>((resolve) => {
			const finish = (outcome: CloseoutWaitOutcome<T>): void => {
				if (settled) return;
				settled = true;
				if (outcome.status === "timeout") consumeCloseoutLate(work, options?.onLate);
				resolve(outcome);
			};
			work.then(
				(value) => finish({ status: "settled", value }),
				(reason) => finish({ status: "rejected", reason }),
			);
			timer = setTimeout(() => finish({ status: "timeout" }), ms);
			if (options?.signal) {
				onAbort = () => finish({ status: "timeout" });
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		});
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		if (onAbort && options?.signal) options.signal.removeEventListener("abort", onAbort);
	}
}

/** enter → ok | error | timeout, plus late-* after a timeout. */
export async function settleCloseoutWait<T>(
	work: Promise<T>,
	timeoutMs: number,
	onProbe: (state: CloseoutProbeState, elapsedMs: number) => void,
	options?: { signal?: AbortSignal },
): Promise<CloseoutWaitOutcome<T>> {
	const startedAt = Date.now();
	const probe = (state: CloseoutProbeState): void => {
		try {
			onProbe(state, Math.max(0, Date.now() - startedAt));
		} catch {
			/* probes must not throw */
		}
	};
	probe("enter");
	const outcome = await awaitBounded(work, timeoutMs, {
		...(options?.signal ? { signal: options.signal } : {}),
		onLate: (late) => probe(late.status === "rejected" ? "late-error" : "late-ok"),
	});
	if (outcome.status === "timeout") probe("timeout");
	else if (outcome.status === "rejected") probe("error");
	else probe("ok");
	return outcome;
}

export function logCloseoutProbe(event: string, fields: CloseoutProbeFields): void {
	logStallProbe(event, {
		agent: fields.agent,
		run: fields.run,
		role: fields.role,
		phase: fields.phase,
		state: fields.state,
		elapsedMs: fields.elapsedMs,
		error: fields.error,
		pid: fields.pid,
		attempt: fields.attempt,
	});
	// Durable twin of the stderr probe line: same allowlisted metadata, JSONL on disk.
	// No pid here: the timeline sink stamps the RECORDING process's own pid on every
	// record, so a caller-supplied one would be an excess property by contract.
	recordCloseoutTimeline(event, {
		agent: fields.agent,
		run: fields.run,
		role: fields.role,
		phase: fields.phase,
		status: fields.state,
		elapsedMs: fields.elapsedMs,
		error: fields.error,
		attempt: fields.attempt,
	});
}

export type ChildExitCloseout = {
	arm(): void;
	settled(state: "ok" | "error"): void;
	cancel(): void;
	nextAttempt(): void;
	forced(): boolean;
	/** Forced close is success only after a real terminal final, a successful terminate, and settled ok. */
	accepted(): boolean;
};

export function createChildExitCloseout(options: {
	agent?: string;
	run?: string;
	role?: string;
	pid?: number;
	/** Omit for writable: probe enter/ok only, wait for the real close. */
	graceMs?: number;
	terminate: () => boolean | void;
	now?: () => number;
	onProbe: (fields: CloseoutProbeFields) => void;
}): ChildExitCloseout {
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let armed = false;
	let forced = false;
	let finished = false;
	let sawFinal = false;
	let terminateSucceeded = false;
	let lastSettled: "ok" | "error" | undefined;
	let startedAt = 0;
	const now = options.now ?? Date.now;

	const probe = (state: CloseoutProbeState): void => {
		try {
			options.onProbe({
				agent: options.agent,
				run: options.run,
				role: options.role,
				phase: "child-exit",
				state,
				elapsedMs: startedAt ? Math.max(0, now() - startedAt) : 0,
				pid: options.pid,
			});
		} catch {
			/* probes must not throw */
		}
	};

	const clearTimer = (): void => {
		if (timer === undefined) return;
		clearTimeout(timer);
		timer = undefined;
	};

	return {
		arm() {
			if (armed) return;
			armed = true;
			sawFinal = true;
			finished = false;
			startedAt = now();
			const gen = generation;
			probe("enter");
			if (options.graceMs === undefined) return;
			if (!Number.isFinite(options.graceMs) || options.graceMs < 0) return;
			timer = setTimeout(() => {
				if (gen !== generation || !armed) return;
				timer = undefined;
				probe("timeout");
				forced = true;
				try {
					terminateSucceeded = options.terminate() !== false;
				} catch {
					terminateSucceeded = false;
				}
				probe("terminate");
			}, options.graceMs);
			timer.unref?.();
		},
		settled(state) {
			clearTimer();
			if (finished) return;
			if (!armed && !forced) return;
			finished = true;
			lastSettled = state;
			probe(forced && state === "ok" ? "exit" : state);
			armed = false;
		},
		cancel() {
			generation += 1;
			clearTimer();
			armed = false;
		},
		nextAttempt() {
			generation += 1;
			clearTimer();
			armed = false;
			forced = false;
			finished = false;
			sawFinal = false;
			terminateSucceeded = false;
			lastSettled = undefined;
			startedAt = 0;
		},
		forced: () => forced,
		accepted: () => forced && sawFinal && terminateSucceeded && lastSettled === "ok",
	};
}

export type WorktreeProgressDetail = {
	timedOut?: boolean;
	error?: string;
	waitedMs?: number;
};

export function worktreeProbeEvent(phase: string): string {
	return WORKTREE_PROBE_EVENT[phase] ?? `worktree-${phase}`;
}

export function createWorktreePhaseProber(onProbe: (event: string, fields: CloseoutProbeFields) => void): {
	note(phase: string, detail?: WorktreeProgressDetail): void;
	finish(state?: "ok" | "error"): void;
} {
	let current: { event: string; phase: string; startedAt: number } | undefined;
	const probe = (event: string, fields: CloseoutProbeFields): void => {
		try {
			onProbe(event, fields);
		} catch {
			/* probes must not throw */
		}
	};
	const leave = (state: "ok" | "error" | "timeout", extra?: Partial<CloseoutProbeFields>): void => {
		if (!current) return;
		probe(current.event, {
			phase: current.phase,
			state,
			elapsedMs: Math.max(0, Date.now() - current.startedAt),
			...extra,
		});
		current = undefined;
	};
	return {
		note(phase, detail) {
			const event = worktreeProbeEvent(phase);
			if (current && current.event !== event) leave("ok");
			if (detail?.timedOut) {
				if (!current) {
					current = { event, phase, startedAt: Date.now() };
				}
				leave("timeout", {
					error: closeoutPhaseError(event, "timeout"),
					...(detail.waitedMs !== undefined ? { elapsedMs: detail.waitedMs } : {}),
				});
				return;
			}
			if (detail?.error) {
				if (!current) current = { event, phase, startedAt: Date.now() };
				leave("error", { error: closeoutPhaseError(event, "error") });
				return;
			}
			if (!current) {
				current = { event, phase, startedAt: Date.now() };
				probe(event, { phase, state: "enter", elapsedMs: 0 });
			}
		},
		finish(state = "ok") {
			const event = current?.event;
			leave(state, state === "error" ? { error: event ? closeoutPhaseError(event, "error") : undefined } : {});
		},
	};
}
