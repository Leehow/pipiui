import assert from "node:assert/strict";
import { test } from "node:test";
import { ResultFileTracker, createCleanupStack } from "../eval-lib/result-files.mjs";
import { evaluateGates } from "../eval-lib/gates.mjs";

const result = (name) => ({ details: { resultsPath: `.pi/agent/code-retrieval/results/${name}` } });

test("a timed-out original task is still tracked when it resolves during teardown", async () => {
  const tracker = new ResultFileTracker(["pre-existing.jsonl"]);
  let finish;
  let cancelled = 0;
  const task = tracker.trackTask(new Promise(resolve => { finish = resolve; }), () => { cancelled++; setTimeout(() => finish(result("late.jsonl")), 5); });
  assert.equal(await tracker.settleTasks(100), 0);
  await task;
  const deleted = [];
  const cleanup = await tracker.cleanup((name) => name, async (name) => { deleted.push(name); });
  assert.equal(cancelled, 1);
  assert.deepEqual(deleted, ["late.jsonl"]);
  assert.equal(cleanup.pendingTasks, 0);
});

test("receipts after cleanup are reaped exactly; pre-existing and unrelated files remain untouched", async () => {
  const tracker = new ResultFileTracker(["pre-existing.jsonl"]);
  let finish;
  const task = tracker.trackTask(new Promise(resolve => { finish = resolve; }));
  assert.equal(await tracker.settleTasks(1), 1);
  const deleted = [];
  const cleanup = await tracker.cleanup((name) => name, async (name) => { deleted.push(name); });
  assert.equal(cleanup.pendingTasks, 1);
  finish(result("late.jsonl"));
  await task;
  await new Promise(resolve => setImmediate(resolve));
  tracker.trackResultPath(result("pre-existing.jsonl").details.resultsPath);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(deleted, ["late.jsonl"]);
});

test("exceptional exits run every cleanup once even if one cleanup fails", async () => {
  const stack = createCleanupStack();
  const calls = [];
  const detach = stack.add(async () => { calls.push("detach"); });
  stack.add(async () => { calls.push("files"); throw new Error("fixture cleanup failure"); });
  await assert.rejects((async () => { try { throw new Error("early evaluation failure"); } finally { await stack.close(); } })(), /early evaluation failure/);
  await detach();
  await stack.close();
  assert.deepEqual(calls, ["files", "detach"]);
});

test("legacy execution errors and incomplete measurements are hard failures", () => {
  const base = { goldChecked: 1, goldValid: 1, invalidGoldIds: [], caseDefs: [{ id: "x" }] };
  for (const cases of [
    [{ id: "x", error: "registered tool reported a failure", budgetViolations: [], honestyViolations: [] }],
    [{ id: "x", skipped: true }], [], [{ id: "x" }, { id: "x" }],
  ]) {
    const gates = evaluateGates({ ...base, cases });
    assert.equal(gates.verdict, "FAIL");
    assert.ok(gates.failedGates.includes("execution-incomplete"));
  }
  const error = evaluateGates({ ...base, cases: [{ id: "x", error: "timeout" }] });
  assert.deepEqual(error.executionErrors, [{ id: "x", error: "timeout" }]);
  assert.equal(error.denominators.recallScoredCases, 0);
});
