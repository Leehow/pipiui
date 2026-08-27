/**
 * Exact-file tracking for evaluation artifacts (review remediation).
 *
 * Old behavior: delete every results-dir filename absent from an initial
 * snapshot — this raced concurrent sessions and could delete result/index
 * files created by unrelated sessions during the run.
 *
 * New behavior: the tracker records ONLY the `details.resultsPath` values
 * actually returned by tool calls made by this run, deletes exactly those
 * basenames, and refuses anything present in the pre-run directory listing.
 */

import { basename } from "node:path";

export class ResultFileTracker {
  /**
   * @param {Iterable<string>} preExistingNames full listing of the results dir
   *        taken BEFORE this run created anything.
   */
  constructor(preExistingNames = []) {
    this.preExisting = new Set([...preExistingNames].map((n) => basename(n)));
    /** @type {Set<string>} relative resultsPaths like `.pi/agent/code-retrieval/results/<hash>.jsonl` */
    this.tracked = new Set();
  }

  /** Track a ToolResult-style details.resultsPath (empty string ⇒ nothing). */
  trackResultPath(resultsPath) {
    if (typeof resultsPath !== "string" || resultsPath === "") return false;
    this.tracked.add(resultsPath.replace(/\\/g, "/"));
    return true;
  }

  trackedBasenames() {
    return [...this.tracked].map((p) => basename(p));
  }

  /** Plan the deletion: only tracked names that did not exist before the run. */
  deletionPlan() {
    const deletable = [];
    const refusedPreExisting = [];
    for (const name of this.trackedBasenames()) {
      if (this.preExisting.has(name)) refusedPreExisting.push(name);
      else deletable.push(name);
    }
    return { deletable, refusedPreExisting, trackedCount: this.tracked.size };
  }

  /** Delete exactly this run's files. `rmFile(absPath)` is injected for tests. */
  async cleanup(resolveAbsolute, rmFile) {
    const plan = this.deletionPlan();
    let deleted = 0;
    for (const name of plan.deletable) {
      try {
        await rmFile(resolveAbsolute(name));
        deleted += 1;
      } catch {
        // best-effort: missing file is fine
      }
    }
    return { ...plan, deleted };
  }
}

/**
 * Directory-listing sanitizer for JSON output: emits bounded aggregate metrics
 * instead of raw records. Recursion redacts suspicious keys and caps sizes.
 */
const REDACT_KEY_RE =
  /(bearer|authorization|api_?key|^secret$|\bsecrets?\b|\btokens?\b|tokens?$|password)/i;
const KEY_ALLOWLIST_RE = /^(previewTokens|spanTokensOfAnchor|tokenBudget)/i;

export function sanitizeValue(value, opts = {}) {
  const maxArray = opts.maxArrayLength ?? 64;
  const maxString = opts.maxStringLength ?? 200;
  const maxDepth = opts.maxDepth ?? 12;

  const walk = (v, depth) => {
    if (depth > maxDepth) return "[truncated]";
    if (typeof v === "string") return v.length > maxString ? v.slice(0, maxString) + "…" : v;
    if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
    if (Number.isNaN(v)) return null;
    if (Array.isArray(v)) return v.slice(0, maxArray).map((item) => walk(item, depth + 1));
    if (typeof v === "object") {
      const out = {};
      for (const [k, item] of Object.entries(v)) {
        if (REDACT_KEY_RE.test(k) && !KEY_ALLOWLIST_RE.test(k)) continue;
        out[k] = walk(item, depth + 1);
      }
      return out;
    }
    return String(v);
  };
  return walk(value, 0);
}

/** Allowlist projection of one measured case → bounded metric record. */
export function toBoundedCaseMetric(rec) {
  return {
    id: rec.id,
    kind: rec.kind,
    tag: rec.tag,
    latencyMs: rec.latencyMs ?? null,
    error: rec.error ?? null,
    skipped: Boolean(rec.skipped),
    hitCount: Array.isArray(rec.hits) ? rec.hits.length : 0,
    firstGoldRank: rec.firstGoldRank,
    goldInTop12: rec.goldInTop12 === true,
    goldInTop3: rec.goldInTop3 === true,
    degraded: rec.degraded === true,
    provider: typeof rec.provider === "string" ? rec.provider : null,
    previewBlockCount: Array.isArray(rec.previewBlocks) ? rec.previewBlocks.length : 0,
    previewLinesMax: Array.isArray(rec.previewBlocks)
      ? rec.previewBlocks.reduce((m, b) => Math.max(m, b.lines ?? 0), 0)
      : 0,
    previewTokensTotal: rec.previewTokensTotal ?? 0,
    budgetViolationCount: Array.isArray(rec.budgetViolations) ? rec.budgetViolations.length : 0,
    anchorShown: rec.anchorShown === true,
    avoidedFetchTokens: rec.avoidedFetchTokens ?? 0,
  };
}

export function toBoundedJson(doc) {
  return sanitizeValue({
    ...doc,
    cases: (doc.cases ?? []).map(toBoundedCaseMetric),
  });
}
