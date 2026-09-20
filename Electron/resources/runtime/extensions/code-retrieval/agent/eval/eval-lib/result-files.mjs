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
    this.tasks = new Map();
    this.cleanupTarget = null;
    this.lateCleanups = new Set();
  }

  /** Register the original task, not just its timeout race. Late receipts still belong to this run. */
  trackTask(promise, cancel = () => {}) {
    const tracked = Promise.resolve(promise).then((result) => {
      this.trackResultPath(result?.details?.resultsPath);
      return result;
    });
    this.tasks.set(tracked, cancel);
    tracked.then(() => this.tasks.delete(tracked), () => this.tasks.delete(tracked));
    return tracked;
  }

  async settleTasks(graceMs = 2000) {
    if (!this.tasks.size) return 0;
    for (const cancel of this.tasks.values()) { try { cancel(); } catch { /* still clean other tasks */ } }
    let timer;
    try {
      await Promise.race([Promise.allSettled([...this.tasks.keys()]), new Promise(resolve => { timer = setTimeout(resolve, graceMs); })]);
    } finally { clearTimeout(timer); }
    return this.tasks.size;
  }

  /** Track a ToolResult-style details.resultsPath (empty string ⇒ nothing). */
  trackResultPath(resultsPath) {
    if (typeof resultsPath !== "string" || resultsPath === "") return false;
    const normalized = resultsPath.replace(/\\/g, "/");
    const fresh = !this.tracked.has(normalized);
    this.tracked.add(normalized);
    const name = basename(normalized);
    if (fresh && this.cleanupTarget && !this.preExisting.has(name)) {
      const { resolveAbsolute, rmFile } = this.cleanupTarget;
      const pending = Promise.resolve().then(() => rmFile(resolveAbsolute(name))).catch(() => {});
      this.lateCleanups.add(pending);
      pending.then(() => this.lateCleanups.delete(pending));
    }
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
    // Install the late-receipt reaper before the first await. It only sees explicitly returned names.
    this.cleanupTarget = { resolveAbsolute, rmFile };
    let deleted = 0;
    for (const name of plan.deletable) {
      try {
        await rmFile(resolveAbsolute(name));
        deleted += 1;
      } catch {
        // best-effort: missing file is fine
      }
    }
    await Promise.allSettled([...this.lateCleanups]);
    return { ...plan, deleted, pendingTasks: this.tasks.size };
  }
}

/** Both evaluator entry points use one idempotent finalizer stack, including exceptional exits. */
export function createCleanupStack() {
  const callbacks = [];
  return {
    add(action) {
      let pending;
      const once = () => pending ??= Promise.resolve().then(action);
      callbacks.push(once);
      return once;
    },
    async close() {
      for (const callback of [...callbacks].reverse()) { try { await callback(); } catch { /* attempt every cleanup */ } }
    },
  };
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
    honestyViolationCount: Array.isArray(rec.honestyViolations) ? rec.honestyViolations.length : 0,
    outputTokenEstimate: rec.outputTokenEstimate ?? null,
    requiredCount: rec.requiredCount ?? 0,
    requiredFound: rec.requiredFound ?? 0,
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
