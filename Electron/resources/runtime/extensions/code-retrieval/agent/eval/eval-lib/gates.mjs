/**
 * Hard validity gates for the evaluation run (review remediation).
 *
 * Stale gold anchors and preview-budget violations are EVALUATION FAILURES —
 * they invalidate the measurement — not printable trivia. Each gate reports
 * explicit denominators so reports cannot blur what was actually scored.
 */

export const PREVIEW_MAX_LINES = 6;
export const PREVIEW_BUDGET_TOKENS = 1000;

/**
 * Independent FIXED aggregate preview cap per tool result: the SUM of all
 * rendered preview-block tokens must stay <= PREVIEW_BUDGET_TOKENS. This check
 * never trusts the renderer's self-reported footer beyond using a legal lower
 * denominator as that result's effective cap — a footer can be absent,
 * understated against the real rendered blocks, or outright deceptive by
 * naming an inflated denominator (e.g. "~1200/4000 preview tokens") to make
 * an over-budget result look legal.
 *
 * Rules:
 * - measured sum > PREVIEW_BUDGET_TOKENS ⇒ violation, whatever any footer says;
 * - self-reported usage above PREVIEW_BUDGET_TOKENS ⇒ violation;
 * - footer denominators are legal only when 1..PREVIEW_BUDGET_TOKENS; anything
 *   above the global max (e.g. 4000) or nonsensical (0/negative/NaN) fails;
 * - a legitimate resolved LOWER budget (e.g. a caller's tokenBudget override →
 *   "~0/5") passes — but independently measured usage must then also fit
 *   within that effective cap.
 *
 * @param {{
 *   blockTokens: number[],
 *   footerUsed: number|null,
 *   footerDenominator: number|null,
 * }} input measured tokens parsed from ONE tool result
 * @returns {string[]} violation messages; empty means the result passed
 */
export function independentAggregatePreviewViolations(input) {
  const violations = [];
  const { footerUsed, footerDenominator } = input ?? {};
  const blockTokens = ((input?.blockTokens ?? [])).filter(
    (t) => typeof t === "number" && Number.isFinite(t) && t >= 0,
  );
  const total = blockTokens.reduce((n, t) => n + t, 0);
  if (total > PREVIEW_BUDGET_TOKENS) {
    violations.push(
      `aggregate preview tokens ~${total} across ${blockTokens.length} block(s) exceed the fixed ${PREVIEW_BUDGET_TOKENS}-token per-result cap (independent of renderer footer)`,
    );
  }
  if (typeof footerUsed === "number" && footerUsed > PREVIEW_BUDGET_TOKENS) {
    violations.push(
      `renderer footer reports ~${footerUsed}/${footerDenominator} preview tokens used: usage itself exceeds the fixed ${PREVIEW_BUDGET_TOKENS}-token per-result cap`,
    );
  }
  if (typeof footerDenominator === "number") {
    if (
      !Number.isFinite(footerDenominator) ||
      footerDenominator <= 0 ||
      footerDenominator > PREVIEW_BUDGET_TOKENS
    ) {
      // Denominators above the global max (e.g. "1200/4000") or nonsensical
      // ones break the shipped contract outright.
      violations.push(
        `renderer footer claims an illegal ${footerDenominator}-token budget denominator; the shipped per-result maximum is ${PREVIEW_BUDGET_TOKENS}`,
      );
    } else if (total > footerDenominator) {
      // A legal resolved LOWER budget is this result's effective cap —
      // independently measured usage must respect it, not just the global max.
      violations.push(
        `independently measured preview tokens ~${total} exceed the rendered footer's legal ${footerDenominator}-token effective cap`,
      );
    }
  }
  return violations;
}

/**
 * @param {{
 *   goldChecked: number,
 *   goldValid: number,
 *   invalidGoldIds: string[],
 *   cases: Array<{id:string, skipped?:boolean, error?:string|null,
 *                 firstGoldRank?:number|null, goldInTop12?:boolean, goldInTop3?:boolean,
 *                 anchorShown?:boolean, budgetViolations?:string[], behavioralOnly?:boolean}>,
 *   caseDefs: Array<{id:string, behavioralOnly?:boolean}>,
 *   requireRepoMapPreviews?: boolean,
 *   mapPreviewBlockCount?: number,
 * }} input
 */
export function evaluateGates(input) {
  const reasons = [];
  const failed = [];

  // ---- Gate: stale gold ⇒ exclusion + hard fail ----
  const staleGoldExcluded = [...(input.invalidGoldIds ?? [])];
  if (staleGoldExcluded.length > 0) {
    failed.push("stale-gold");
    reasons.push(
      `${staleGoldExcluded.length}/${input.goldChecked} gold anchor(s) no longer verify on disk: ${staleGoldExcluded.join(", ")}. They are EXCLUDED from all recall denominators; refresh the case corpus.`,
    );
  }

  const defById = new Map((input.caseDefs ?? []).map((c) => [c.id, c]));
  const executed = (input.cases ?? []).filter((c) => !c.skipped);

  // Recall denominators: non-behavioral cases with valid gold that ran without error.
  const pathScored = executed.filter(
    (c) =>
      !(defById.get(c.id)?.behavioralOnly ?? false) &&
      !staleGoldExcluded.includes(c.id) &&
      !c.error,
  );
  const recallDenominator = pathScored.length;
  const recall12 = pathScored.filter((c) => c.goldInTop12).length;
  const recall3 = pathScored.filter((c) => c.goldInTop3).length;
  const anchorEligible = pathScored.filter((c) => c.goldInTop3).length;
  const anchorShown = pathScored.filter((c) => c.anchorShown).length;

  // ---- Gate: preview budget enforced PER RESULT (per rendered block), not on a
  // cumulative cross-case value. Any violation fails the run. ----
  const budgetViolations = [];
  for (const c of executed) {
    for (const v of c.budgetViolations ?? []) budgetViolations.push({ case: c.id, violation: v });
  }
  if (budgetViolations.length > 0) {
    failed.push("preview-budget");
    reasons.push(`${budgetViolations.length} preview-budget violation(s): ${budgetViolations.slice(0, 10).map((v) => `${v.case}: ${v.violation}`).join("; ")}`);
  }

  const honestyViolations = executed.flatMap((c) => (c.honestyViolations ?? []).map((violation) => ({ case: c.id, violation })));
  if (honestyViolations.length) {
    failed.push("retrieval-honesty");
    reasons.push(`${honestyViolations.length} retrieval-honesty violation(s): ${honestyViolations.slice(0, 10).map((v) => `${v.case}: ${v.violation}`).join("; ")}`);
  }

  // ---- Optional integration gate: repo_map must render real previews once the
  // core fix lands in the registered tool. Off by default so this evaluator can
  // be run before/without that slice; integration flips it on. ----
  if (input.requireRepoMapPreviews && !(input.mapPreviewBlockCount > 0)) {
    failed.push("repo-map-previews");
    reasons.push(`--require-map-previews set but repo_map rendered 0 inline preview blocks`);
  }

  const executionErrors = executed.filter((c) => c.error).map((c) => ({ id: c.id, error: c.error }));
  const allCases = input.cases ?? [];
  const counts = new Map();
  for (const c of allCases) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  const incomplete = allCases.some((c) => c.skipped) || [...defById.keys()].some((id) => counts.get(id) !== 1)
    || allCases.some((c) => !defById.has(c.id));
  if (executionErrors.length || incomplete) {
    failed.push("execution-incomplete");
    reasons.push(`${executionErrors.length} execution error(s); skipped/missing/duplicate cases=${incomplete}. Failed measurements cannot produce PASS.`);
  }

  return {
    verdict: failed.length > 0 ? "FAIL" : "PASS",
    failedGates: failed,
    reasons,
    denominators: {
      goldChecked: input.goldChecked ?? 0,
      goldValid: input.goldValid ?? 0,
      staleGoldExcluded,
      recallScoredCases: recallDenominator,
      recall12,
      recall3,
      anchorEligible,
      anchorShown,
      executedCases: executed.length,
      totalCases: (input.cases ?? []).length,
      budgetViolationCount: budgetViolations.length,
      honestyViolationCount: honestyViolations.length,
    },
    budgetViolations,
    honestyViolations,
    executionErrors,
  };
}
