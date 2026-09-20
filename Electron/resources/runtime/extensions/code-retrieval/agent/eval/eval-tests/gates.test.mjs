/**
 * Hard-gate tests: stale gold and preview-budget violations must fail the
 * evaluation with explicit denominators, not print-only claims.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGates,
  independentAggregatePreviewViolations,
  PREVIEW_MAX_LINES,
  PREVIEW_BUDGET_TOKENS,
} from "../eval-lib/gates.mjs";

const DEFS = [
  { id: "g1" },
  { id: "g2" },
  { id: "b1", behavioralOnly: true },
];
const okCase = (id) => ({ id, firstGoldRank: 1, goldInTop12: true, goldInTop3: true, anchorShown: true, budgetViolations: [] });

test("stale gold ⇒ FAIL, excluded from every denominator", () => {
  const g = evaluateGates({
    goldChecked: 3,
    goldValid: 2,
    invalidGoldIds: ["g2"],
    cases: [okCase("g1"), { ...okCase("g2") }, { id: "b1" }],
    caseDefs: DEFS,
  });
  assert.equal(g.verdict, "FAIL");
  assert.ok(g.failedGates.includes("stale-gold"));
  assert.deepEqual(g.denominators.staleGoldExcluded, ["g2"]);
  // g2 EXCLUDED though it ran: denominator counts only g1.
  assert.equal(g.denominators.recallScoredCases, 1);
  assert.equal(g.denominators.recall12, 1);
});

test("per-result budget violation ⇒ FAIL with counted violations", () => {
  const g = evaluateGates({
    goldChecked: 2,
    goldValid: 2,
    invalidGoldIds: [],
    cases: [
      okCase("g1"),
      {
        id: "g2",
        firstGoldRank: null,
        goldInTop12: false,
        goldInTop3: false,
        anchorShown: false,
        budgetViolations: [`preview R1 exceeds ${PREVIEW_MAX_LINES} lines`],
      },
    ],
    caseDefs: DEFS,
  });
  assert.equal(g.verdict, "FAIL");
  assert.ok(g.failedGates.includes("preview-budget"));
  assert.equal(g.denominators.budgetViolationCount, 1);
  assert.ok(g.reasons[0].includes("exceeds"));
});

test("incomplete cases shrink the denominator honestly but cannot produce PASS", () => {
  const g = evaluateGates({
    goldChecked: 2,
    goldValid: 2,
    invalidGoldIds: [],
    cases: [
      okCase("g1"),
      { id: "b1", budgetViolations: [] },
      { id: "g2", skipped: true },
      { id: "g2", error: "timeout" }, // duplicate/error is filtered from recall, and now fails validity
    ],
    caseDefs: DEFS,
  });
  assert.equal(g.denominators.executedCases, 3);
  assert.equal(g.denominators.recallScoredCases, 1);
  assert.equal(g.verdict, "FAIL");
  assert.ok(g.failedGates.includes("execution-incomplete"));
});

test("--require-map-previews flips informational count into a hard gate", () => {
  const base = {
    goldChecked: 0,
    goldValid: 0,
    invalidGoldIds: [],
    cases: [],
    caseDefs: [],
    mapPreviewBlockCount: 0,
  };
  const enforced = evaluateGates({ ...base, requireRepoMapPreviews: true });
  assert.equal(enforced.verdict, "FAIL");
  assert.ok(enforced.failedGates.includes("repo-map-previews"));
  const passing = evaluateGates({ ...base, requireRepoMapPreviews: true, mapPreviewBlockCount: 3 });
  assert.equal(passing.verdict, "PASS");
  const info = evaluateGates(base);
  assert.equal(info.verdict, "PASS");
});

test("budget constants stay at the shipped preview values", () => {
  assert.equal(PREVIEW_MAX_LINES, 6);
  assert.equal(PREVIEW_BUDGET_TOKENS, 1000);
});

// ---- Independent fixed AGGREGATE cap per result (second-review remediation):
// the sum of all rendered block tokens must stay <=1000 no matter what each
// block or the renderer's self-reported footer claims. ----

test("three 400-token blocks exceed the fixed aggregate cap even with NO footer", () => {
  // Each block passes individually; only the independent SUM can catch this.
  const v = independentAggregatePreviewViolations({
    blockTokens: [400, 400, 400],
    footerUsed: null,
    footerDenominator: null,
  });
  assert.ok(v.length >= 1, JSON.stringify(v));
  assert.ok(v.some((m) => m.includes("1200")), v.join("; "));
  assert.ok(v.some((m) => m.includes("aggregate")), v.join("; "));
});

test("deceptive 1200/4000 footer hard-fails on used>cap AND inflated denominator", () => {
  // Rendered blocks are small and legal; the footer alone is the lie.
  const v = independentAggregatePreviewViolations({
    blockTokens: [300],
    footerUsed: 1200,
    footerDenominator: 4000,
  });
  assert.ok(v.some((m) => m.includes("usage itself exceeds") && m.includes("1200/4000")), v.join("; "));
  assert.ok(v.some((m) => m.includes("illegal 4000-token budget denominator")), v.join("; "));
});

// ---- Third-review warnings: legal resolved LOWER budgets must pass, and any
// measured usage above a self-declared effective cap must fail. ----

test("legitimate resolved lower-budget footers (~N/5 style) pass", () => {
  assert.deepEqual(
    independentAggregatePreviewViolations({ blockTokens: [], footerUsed: 0, footerDenominator: 5 }),
    [],
  );
  assert.deepEqual(
    independentAggregatePreviewViolations({ blockTokens: [3], footerUsed: 3, footerDenominator: 500 }),
    [],
  );
});

test("exact 1000-token boundary passes; one token more fails", () => {
  const atCap = independentAggregatePreviewViolations({
    blockTokens: [250, 250, 250, 250],
    footerUsed: 1000,
    footerDenominator: 1000,
  });
  assert.deepEqual(atCap, []);
  const overByOne = independentAggregatePreviewViolations({
    blockTokens: [251, 250, 250, 250],
    footerUsed: 1001,
    footerDenominator: 1000,
  });
  assert.ok(overByOne.length >= 2, overByOne.join("; ")); // aggregate + footer usage
});

test("normal legal multi-block result passes cleanly", () => {
  const v = independentAggregatePreviewViolations({
    blockTokens: [180, 220, 90],
    footerUsed: 490,
    footerDenominator: 1000,
  });
  assert.deepEqual(v, []);
});

test("independently measured usage exceeding a declared lower effective cap fails", () => {
  const v = independentAggregatePreviewViolations({
    blockTokens: [10],
    footerUsed: 10,
    footerDenominator: 5,
  });
  assert.ok(v.some((m) => m.includes("legal 5-token effective cap")), v.join("; "));
  // 1000 is only the MAX: a mid-size honest budget stays fully compatible.
  const mid = independentAggregatePreviewViolations({
    blockTokens: [600],
    footerUsed: 600,
    footerDenominator: 999,
  });
  assert.deepEqual(mid, []);
});

test("denominators above the global max or nonsensical are rejected", () => {
  for (const d of [PREVIEW_BUDGET_TOKENS + 1, 4000, 0, -3, Number.NaN]) {
    const v = independentAggregatePreviewViolations({ blockTokens: [], footerUsed: null, footerDenominator: d });
    assert.ok(
      v.some((m) => m.includes("illegal") && m.includes("budget denominator")),
      `d=${d}: ${v.join("; ")}`,
    );
  }
});

test("aggregate violations flow through evaluateGates as a hard preview-budget FAIL", () => {
  const violations = independentAggregatePreviewViolations({
    blockTokens: [400, 400, 400],
    footerUsed: 1200,
    footerDenominator: 4000,
  });
  const g = evaluateGates({
    goldChecked: 1,
    goldValid: 1,
    invalidGoldIds: [],
    cases: [{ id: "g1", firstGoldRank: 1, goldInTop12: true, goldInTop3: true, anchorShown: true, budgetViolations: violations }],
    caseDefs: DEFS.slice(0, 1),
  });
  assert.equal(g.verdict, "FAIL");
  assert.ok(g.failedGates.includes("preview-budget"));
  assert.equal(g.denominators.budgetViolationCount, violations.length);
});
