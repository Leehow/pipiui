/**
 * Centralized closeout deadlines. Production values stay conservative so a
 * real merge + post-merge verify can finish; tests inject short fakes.
 */

/** Local Git commands are expected to be quick; a hung hook must not hold main forever. */
export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
/** Swift's post-merge runner uses a 120-second verify deadline. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;

/**
 * Per-call verify budget: PIPIUI_VERIFY_TIMEOUT_MS overrides the conservative
 * default for long test suites. Invalid or <1000ms values fall back silently.
 * Post-merge verify additionally remains bounded by the queue-head envelope
 * (DEFAULT_QUEUE_HEAD_TIMEOUT_MS); a larger value cannot extend past that.
 */
export function resolveVerifyTimeoutMs(): number {
	const raw = process.env.PIPIUI_VERIFY_TIMEOUT_MS;
	if (typeof raw === "string" && /^[0-9]+$/.test(raw.trim())) {
		const parsed = Number.parseInt(raw, 10);
		if (Number.isSafeInteger(parsed) && parsed >= 1000) return parsed;
	}
	return DEFAULT_VERIFY_TIMEOUT_MS;
}
export const DEFAULT_SPAWN_TERMINATION_GRACE_MS = 1_000;
/** Extra slack after a predecessor's own head budget so same-tick timeout cannot skip the waiter. */
export const DEFAULT_QUEUE_WAIT_TIMEOUT_MS = 30 * 60_000;
/**
 * Backup bound for one queue-head item (inspect/merge/onMerged/verify/cleanup).
 * The service also returns a typed retained result at this mark.
 */
export const DEFAULT_QUEUE_HEAD_TIMEOUT_MS = 15 * 60_000;
/** Host `onMerged` hook. Production Git fan-out is 15s per inflight worker. */
export const DEFAULT_ON_MERGED_TIMEOUT_MS = 30_000;
/** Same conservative envelope as the queue-head backup. */
export const DEFAULT_FINALIZATION_DEADLINE_MS = DEFAULT_QUEUE_HEAD_TIMEOUT_MS;
