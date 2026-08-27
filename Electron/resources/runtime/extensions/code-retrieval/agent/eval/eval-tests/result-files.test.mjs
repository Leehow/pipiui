/**
 * Exact-file cleanup + bounded/redacted JSON output tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ResultFileTracker, sanitizeValue, toBoundedCaseMetric, toBoundedJson } from "../eval-lib/result-files.mjs";

const RP = (hash) => `.pi/agent/code-retrieval/results/${hash}.jsonl`;

test("tracker tracks only explicit resultsPath values from this run", () => {
  const t = new ResultFileTracker(["unrelated-a.jsonl"]);
  assert.equal(t.trackResultPath(RP("run1")), true);
  assert.equal(t.trackResultPath(""), false);
  assert.equal(t.trackResultPath(undefined), false);
  assert.deepEqual(t.trackedBasenames(), ["run1.jsonl"]);
});

test("cleanup deletes tracked names and REFUSES pre-existing ones", async () => {
  // 'old.jsonl' existed before the run: even if THIS run re-creates the same
  // filename it must be refused.
  const t = new ResultFileTracker(["old.jsonl"]);
  t.trackResultPath(RP("ours"));
  t.trackResultPath(RP("old"));
  const deletedPaths = [];
  const res = await t.cleanup(
    (name) => `/tmp/resultsdir/${name}`,
    async (abs) => deletedPaths.push(abs),
  );
  assert.deepEqual(deletedPaths, ["/tmp/resultsdir/ours.jsonl"]);
  assert.equal(res.deleted, 1);
  assert.deepEqual(res.refusedPreExisting, ["old.jsonl"]);
});

test("mid-flight creations by OTHER sessions are untouched (not tracked)", async () => {
  const t = new ResultFileTracker([]);
  t.trackResultPath(RP("ours.jsonl"));
  const deletedPaths = [];
  await t.cleanup((name) => `/r/${name}`, async (abs) => deletedPaths.push(abs));
  assert.equal(deletedPaths.length, 1); // foreign 'concurrent.jsonl' simply isn't known
  assert.ok(!deletedPaths.join(",").includes("concurrent"));
});

test("sanitizeValue drops secret-shaped keys but keeps token-budget metrics", () => {
  const out = sanitizeValue({
    tokenBudget: 4000,
    previewTokensTotal: 42,
    bearer: "SHOULD-VANISH",
    authorizationHeader: "x",
    apiKey: "y",
    sidecarToken: "z",
    passwordHash: "w",
    nested: { deeperBearer: "gone", keep: "me" },
  });
  assert.equal(out.bearer, undefined);
  assert.equal(out.authorizationHeader, undefined);
  assert.equal(out.apiKey, undefined);
  assert.equal(out.sidecarToken, undefined);
  assert.equal(out.passwordHash, undefined);
  assert.equal(out.nested.deeperBearer, undefined);
  assert.equal(out.tokenBudget, 4000);
  assert.equal(out.previewTokensTotal, 42);
  assert.equal(out.nested.keep, "me");
});

test("sanitizeValue caps strings and arrays", () => {
  const out = sanitizeValue(
    { long: "a".repeat(500), arr: Array.from({ length: 100 }, (_, i) => i) },
    { maxStringLength: 10, maxArrayLength: 3 },
  );
  assert.ok(out.long.length <= 11);
  assert.equal(out.arr.length, 3);
});

test("toBoundedCaseMetric projects bounded metrics only — no raw hits, queries or texts", () => {
  const rec = {
    id: "c1",
    kind: "exact",
    tag: "t",
    query: "some query text",
    latencyMs: 12,
    hits: [{ ref: "R1", path: "a/b.ts", startLine: 1, endLine: 99 }],
    previewBlocks: [{ ref: "R1", path: "a/b.ts", lines: 6, tokens: 90 }],
    budgetViolations: [],
    anchorShownRef: "R1",
    providerInfoEcho: "whatever",
  };
  const m = JSON.parse(JSON.stringify(toBoundedCaseMetric(rec)));
  assert.equal(m.query, undefined);
  assert.equal(m.hits, undefined);
  assert.equal(m.previewBlocks, undefined); // counts only
  assert.equal(m.previewBlockCount, 1);
  assert.equal(m.hitCount, 1);
  assert.equal(m.anchorShown, false);
  assert.equal(m.budgetViolationCount, 0);
});

test("toBoundedJson maps every case through the projection and redacts", () => {
  const doc = {
    cases: [
      { id: "c1", kind: "exact", tag: "", latencyMs: 1, hits: [], previewBlocks: [], budgetViolations: [] },
    ],
    honestyProbes: [{ name: "n", pass: true, detail: "sidecarToken=abc" }],
    trace: { available: false, reason: "none" },
  };
  const out = JSON.parse(JSON.stringify(toBoundedJson(doc)));
  assert.equal(out.cases.length, 1);
  assert.equal("hits" in out.cases[0], false);
});
