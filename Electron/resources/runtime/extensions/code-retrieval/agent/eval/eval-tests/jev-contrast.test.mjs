import assert from "node:assert/strict";
import { test } from "node:test";
import { caseParams, contrastSummary, providerHonestyViolations, routingExplained, summarizeArm } from "../eval-lib/jev-contrast.mjs";
import { evaluateGates } from "../eval-lib/gates.mjs";
import { sanitizeValue, toBoundedCaseMetric } from "../eval-lib/result-files.mjs";

const defs = Array.from({ length: 30 }, (_, i) => ({ id: `case-${i}`, kind: i ? "descriptive" : "exact" }));
const samples = () => defs.flatMap((c) => [0, 1, 2].flatMap((repetition) => ["A", "B"].map((arm) => ({
  id: c.id, kind: c.kind, arm, repetition, error: null, firstGoldRank: 2, goldInTop12: true, goldInTop3: true,
  latencyMs: arm === "A" ? 20 : 30, outputTokenEstimate: 100, budgetViolations: [], honestyViolations: [], requiredCount: 0, requiredFound: 0,
}))));

test("contrast changes only descriptive query variants, not exact/symbol/nav controls", () => {
  const desc = { query: "where a feature lives", kind: "descriptive", queryVariants: ["another expression"], path: "src", glob: "*.ts", topK: 12 };
  assert.deepEqual(caseParams(desc, "A"), { query: desc.query, mode: "semantic", path: "src", glob: "*.ts", topK: 12 });
  assert.deepEqual(caseParams(desc, "B").queryVariants, desc.queryVariants);
  assert.equal(caseParams({ ...desc, kind: "exact" }, "B").queryVariants, undefined);
  assert.equal(caseParams({ ...desc, kind: "exact" }, "A").mode, "exact");
  assert.equal(caseParams({ ...desc, kind: "symbol-hint" }, "B").queryVariants, undefined);
  assert.deepEqual(caseParams({ kind: "nav", operation: "definition", symbol: "foo", path: "src" }, "B"), { operation: "definition", symbol: "foo", path: "src" });
});

test("semantic zvec and an exact tantivy sidecar are not contradictory providers", () => {
  assert.deepEqual(providerHonestyViolations({ hits: [{}], provider: "zvec", degraded: false }, "tantivy"), []);
  assert.deepEqual(providerHonestyViolations({ hits: [{}], provider: "rg", degraded: true }, "tantivy"), []);
  assert.equal(providerHonestyViolations({ hits: [{}], provider: "rg", degraded: false }, "tantivy").length, 1);
  const mixed = { sources: [{ provider: "zvec", degraded: false, hitCount: 4 }, { provider: "tantivy", degraded: false, hitCount: 2 }] };
  assert.deepEqual(providerHonestyViolations(mixed, "tantivy"), []);
  assert.equal(providerHonestyViolations({ ...mixed, provider: "zvec" }, "tantivy").length, 1);
});

test("honesty failures retain a hard gate separate from preview budgets", () => {
  const gates = evaluateGates({ goldChecked: 1, goldValid: 1, invalidGoldIds: [], caseDefs: [{ id: "x" }],
    cases: [{ id: "x", budgetViolations: [], honestyViolations: ["wrong provider"], goldInTop12: true }] });
  assert.deepEqual(gates.failedGates, ["retrieval-honesty"]);
  assert.equal(gates.denominators.budgetViolationCount, 0);
  assert.equal(gates.denominators.honestyViolationCount, 1);
  assert.equal(routingExplained({ hits: [], degraded: false }, "No hits for this expression."), true);
  assert.equal(routingExplained({ hits: [], degraded: false }, ""), false);
  assert.equal(routingExplained({ hits: [{}], degraded: false }, "R1 src/a.ts:1-2"), true);
});

test("offline summary never invents Jev recall, task speedup, rounds or cloud costs", () => {
  const summary = contrastSummary(defs, samples(), []);
  assert.equal(summary.verdict, "PASS");
  assert.equal(summary.A.scored, 90); assert.equal(summary.B.scored, 90);
  assert.equal(summary.A.latencyP50Ms, 20); assert.equal(summary.B.latencyP95Ms, 30);
  assert.equal(summary.C.status, "not-run"); assert.equal(summary.C.recallAt12, null);
  assert.equal(summary.singleQueryJev.totalCostUsd, null);
  assert.equal(summary.liveAgentLlmRounds, null);
  assert.match(summary.speedupClaim, /UNPROVEN/);
});

test("stale gold, missing/duplicated samples, budgets and exact regressions cannot pass", () => {
  const stale = contrastSummary(defs, samples(), ["case-1"]);
  assert.equal(stale.verdict, "FAIL"); assert.equal(stale.A.scored, 87);
  assert.ok(contrastSummary(defs, [], []).failedGates.includes("incomplete-measurement"));
  const duplicate = samples(); duplicate.push(duplicate[0]);
  assert.ok(contrastSummary(defs, duplicate, []).failedGates.includes("incomplete-measurement"));
  const bad = samples(); bad[1] = { ...bad[1], goldInTop12: false, firstGoldRank: null, budgetViolations: ["too large"] };
  const fail = contrastSummary(defs, bad, []);
  assert.ok(fail.failedGates.includes("preview-budget"));
  assert.ok(fail.failedGates.includes("exact-control-regression"));
});

test("case projection stays aggregate-only and metrics exclude errors", () => {
  const raw = { ...samples()[0], hits: [{ path: "private-file.ts", text: "private text" }], query: "private query", source: "private source" };
  const safe = JSON.stringify(sanitizeValue(toBoundedCaseMetric(raw)));
  assert.ok(!safe.includes("private"));
  assert.equal(JSON.parse(safe).outputTokenEstimate, 100);
  assert.equal(summarizeArm([{ ...raw, error: "failed" }]).latencyP50Ms, null);
});
