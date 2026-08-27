/**
 * Ownership policy tests: the evaluator must never terminate pre-existing or
 * shared sidecars. Pins eval-lib/ownership.mjs decisions, including the
 * refusal paths that protect user sessions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySidecarTransition, stopDecision, CLEANUP_POLICY_NOTE } from "../eval-lib/ownership.mjs";

test("pre-existing pid ⇒ shared, never spawned-by-eval", () => {
  const t = classifySidecarTransition(4242, 4242);
  assert.equal(t.kind, "pre-existing");
  assert.equal(t.shared, true);
  assert.equal(t.spawnedByEval, false);
});

test("no live sidecar at start + new pid afterwards ⇒ unproven, not killable", () => {
  const t = classifySidecarTransition(null, 5151);
  assert.equal(t.kind, "appeared-during-run");
  assert.equal(t.spawnedByEval, false);
});

test("pid replaced during run ⇒ shared replacement, unkillable", () => {
  const t = classifySidecarTransition(4242, 9999);
  assert.equal(t.kind, "replaced-during-run");
  assert.equal(t.shared, true);
  assert.equal(t.spawnedByEval, false);
});

test("sidecar gone at post-state ⇒ none", () => {
  const t = classifySidecarTransition(4242, null);
  assert.equal(t.kind, "none");
  assert.equal(t.shared, false);
});

test("stopDecision refuses any pid without proven ownership", () => {
  for (const pid of [4242, 9999, 0, -1, NaN, null]) {
    const d = stopDecision({ pid });
    assert.equal(d.action, "detach-only");
    assert.equal(d.reason.includes(CLEANUP_POLICY_NOTE.slice(0, 20)) || d.reason.length > 0, true);
  }
});

test("stopDecision kills ONLY a proven-owned child-process pid", () => {
  const owned = stopDecision({ pid: 777, provenOwnedPids: [777] });
  assert.equal(owned.action, "kill");
  const other = stopDecision({ pid: 778, provenOwnedPids: [777] });
  assert.equal(other.action, "detach-only");
});

test("invalid pids are normalized away", () => {
  assert.equal(stopDecision({ pid: Number.NaN }).action, "detach-only");
  assert.equal(stopDecision({}).action, "detach-only");
});
