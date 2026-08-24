/**
 * Bounded wait for optional terminal memory. Closeout must continue even if
 * the broker candidate never settles. Timeout is best-effort skip: it does
 * not fail the worker, delete a worktree, or rewrite the summary.
 */

export const DEFAULT_TERMINAL_CANDIDATE_TIMEOUT_MS = 15_000;

export const TERMINAL_CANDIDATE_WAIT = "terminal-candidate-wait";
export const TERMINAL_CANDIDATE_TIMEOUT = "terminal-candidate-timeout";
export const TERMINAL_CANDIDATE_ERROR = "terminal-candidate-error";

export type TerminalCandidateProbeState = "wait" | "timeout" | "ok" | "error";

/**
 * lastPhaseError for a candidate probe. wait/ok must not set or overwrite
 * that field — host LWW would stick `terminal-candidate-wait` and cover
 * verify-failed / verify-timeout.
 */
export function terminalCandidatePhaseError(
	state: TerminalCandidateProbeState,
): string | undefined {
	if (state === "timeout") return TERMINAL_CANDIDATE_TIMEOUT;
	if (state === "error") return TERMINAL_CANDIDATE_ERROR;
	return undefined;
}

export type TerminalCandidateLate<T> =
	| { status: "fulfilled"; value: T }
	| { status: "rejected"; reason: unknown };

export type TerminalCandidateOutcome<T> =
	| { status: "settled"; value: T }
	| { status: "rejected"; reason: unknown }
	| { status: "timeout" };

export type AwaitTerminalCandidateOptions<T> = {
	/** External abort (tests / future signal-aware clients). */
	signal?: AbortSignal;
	/** Abort this controller when the deadline wins so a signal-aware client can stop. */
	abortOnTimeout?: AbortController;
	onLate?: (late: TerminalCandidateLate<T>) => void;
};

function positiveTimeoutMs(timeoutMs: number | undefined): number {
	return Number.isSafeInteger(timeoutMs) && timeoutMs !== undefined && timeoutMs > 0
		? timeoutMs
		: DEFAULT_TERMINAL_CANDIDATE_TIMEOUT_MS;
}

function notifyLate<T>(onLate: ((late: TerminalCandidateLate<T>) => void) | undefined, late: TerminalCandidateLate<T>): void {
	if (!onLate) return;
	try {
		onLate(late);
	} catch {
		// Probe callbacks must not become a second failure mode.
	}
}

/** Attach a handler so a timed-out candidate cannot surface as an unhandled rejection. */
export function consumeTerminalCandidateLate<T>(
	promise: Promise<T>,
	onLate?: (late: TerminalCandidateLate<T>) => void,
): void {
	void promise.then(
		(value) => notifyLate(onLate, { status: "fulfilled", value }),
		(reason) => notifyLate(onLate, { status: "rejected", reason }),
	);
}

/**
 * Race optional memory work against a conservative deadline.
 * The winner is reported once; the loser is consumed and cannot finish twice.
 */
export async function awaitTerminalCandidate<T>(
	work: Promise<T>,
	timeoutMs: number = DEFAULT_TERMINAL_CANDIDATE_TIMEOUT_MS,
	options?: AwaitTerminalCandidateOptions<T>,
): Promise<TerminalCandidateOutcome<T>> {
	const ms = positiveTimeoutMs(timeoutMs);
	if (options?.signal?.aborted) {
		if (options.abortOnTimeout && !options.abortOnTimeout.signal.aborted) {
			options.abortOnTimeout.abort();
		}
		consumeTerminalCandidateLate(work, options.onLate);
		return { status: "timeout" };
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	let settled = false;
	try {
		return await new Promise<TerminalCandidateOutcome<T>>((resolve) => {
			const finish = (outcome: TerminalCandidateOutcome<T>): void => {
				if (settled) return;
				settled = true;
				if (outcome.status === "timeout") {
					if (options?.abortOnTimeout && !options.abortOnTimeout.signal.aborted) {
						options.abortOnTimeout.abort();
					}
					consumeTerminalCandidateLate(work, options?.onLate);
				}
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
