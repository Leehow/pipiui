/**
 * Sidecar ownership policy for the evaluation harness (review remediation).
 *
 * The evaluator must NEVER terminate a pre-existing or shared Tantivy/query
 * sidecar merely because it attached (leased) to it. Several concurrent
 * sessions may lease the same process through `.pi/agent/code-retrieval/
 * sidecar.json`; `attachSidecar()` reuses whatever is healthy.
 *
 * Policy implemented here:
 * - A sidecar is "shared" whenever a live snapshot existed before this run
 *   attached, or whenever the PID cannot be proven to have been spawned by
 *   THIS process tree. Shared / unproven ⇒ `detach-only`.
 * - Even for an eval-spawned sidecar the default cleanup is `detach-only`:
 *   every sidecar carries an idle timer, so dropping our leases lets it exit
 *   by itself without racing a replacement process spawned meanwhile.
 * - `stopDecision` therefore never returns `kill` unless the caller supplies
 *   provable ownership (a ChildProcess handle we spawned ourselves). The
 *   shipped runner passes none — the kill branch exists so that ownership
 *   logic is pinned by tests, not because the runner uses it.
 */

export const CLEANUP_POLICY_NOTE =
  "evaluator detaches only its own leases; shared sidecars are left running";

/** Observed sidecar state at one instant: null ⇒ no live snapshot. */
export function classifySidecarTransition(prePid, postPid) {
  const pre = Number.isInteger(prePid) && prePid > 0 ? prePid : null;
  const post = Number.isInteger(postPid) && postPid > 0 ? postPid : null;
  if (post === null) return { kind: "none", spawnedByEval: false, shared: false };
  if (pre === null) {
    // No live sidecar existed at start; a new PID appeared afterwards. Most
    // plausibly ours (we requested the attach) but another session could have
    // won the spawn race — treat as UNPROVEN either way.
    return { kind: "appeared-during-run", spawnedByEval: false, shared: false };
  }
  if (pre === post) return { kind: "pre-existing", spawnedByEval: false, shared: true };
  return { kind: "replaced-during-run", spawnedByEval: false, shared: true };
}

/**
 * The single choke point for termination decisions. `provenOwnedPids` must
 * contain only PIDs for which the caller holds a ChildProcess handle returned
 * by its own spawn(). Everything else is detach-only.
 */
export function stopDecision({ pid, provenOwnedPids = [], note = "" }) {
  const p = Number.isInteger(pid) && pid > 0 ? pid : null;
  if (p !== null && provenOwnedPids.includes(p)) {
    return { action: "kill", reason: "PID was spawned by this evaluation (child-process handle held)" };
  }
  return {
    action: "detach-only",
    reason: note || CLEANUP_POLICY_NOTE,
  };
}

/** Detach one lease; never throws, never signals any process. */
export function describeDetach(sessionId) {
  return { action: "detach", sessionId };
}
