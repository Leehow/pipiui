/**
 * Centralized closeout deadlines. Production values stay conservative so a
 * real merge + post-merge verify can finish; tests inject short fakes.
 */

/** Local Git commands are expected to be quick; a hung hook must not hold main forever. */
export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
/** Swift's post-merge runner uses a 120-second verify deadline. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;
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
