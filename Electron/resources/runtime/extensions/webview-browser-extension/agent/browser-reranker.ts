// Structural process-local contract: neither extension imports the other package.
export const BROWSER_DISCOVER = "pipiui.browser-reranker.discover.v1";
export const BROWSER_PROVIDE = "pipiui.browser-reranker.provide.v1";
export const BROWSER_WITHDRAW = "pipiui.browser-reranker.withdraw.v1";
const DEADLINE_MS = 1500;
type Candidate = { id: string; role: string; name: string; region: string };
type Outcome = {
  status: "applied" | "skipped" | "fallback";
  scores?: Array<{ id: string; score: number }>;
  reason?: string; evaluatedCount?: number; submittedCount?: number; model?: string; inputTokens?: number;
};
type Offer = {
  version: 1; provider: "jev-optimizer"; instanceId: string;
  availability(root: string, signal?: AbortSignal): Promise<{ ready: boolean; reason?: string }>;
  rerank(input: { intent: string; candidates: Candidate[]; projectRoot: string; signal?: AbortSignal }): Promise<Outcome>;
};
type Bus = {
  on(channel: string, listener: (data: unknown) => void): (() => void) | void;
  emit(channel: string, data: unknown): void;
};
type ConnectedOffer = { offer: Offer; signal: AbortSignal };
export type BrowserRerankerConnection = { current(): ConnectedOffer | undefined; dispose(): void };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const stableReason = (value: unknown, fallback: string) => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : fallback;

export function connectBrowserReranker(bus?: Bus): BrowserRerankerConnection {
  let active: ConnectedOffer | undefined;
  let lifetime: AbortController | undefined;
  let disposed = false;
  const retired = new Set<string>();
  const unsubs: Array<(() => void) | void> = [];
  const retire = () => {
    if (active) retired.add(active.offer.instanceId);
    lifetime?.abort();
    active = undefined;
  };
  if (bus) {
    unsubs.push(bus.on(BROWSER_PROVIDE, (raw) => {
      if (disposed || !record(raw) || raw.version !== 1 || raw.provider !== "jev-optimizer"
        || typeof raw.instanceId !== "string" || !raw.instanceId || retired.has(raw.instanceId)
        || typeof raw.availability !== "function" || typeof raw.rerank !== "function") return;
      if (active?.offer.instanceId === raw.instanceId) return;
      retire();
      lifetime = new AbortController();
      active = { offer: raw as Offer, signal: lifetime.signal };
    }));
    unsubs.push(bus.on(BROWSER_WITHDRAW, (raw) => {
      if (!record(raw) || raw.version !== 1 || raw.provider !== "jev-optimizer" || typeof raw.instanceId !== "string") return;
      retired.add(raw.instanceId);
      if (active?.offer.instanceId === raw.instanceId) retire();
    }));
    bus.emit(BROWSER_DISCOVER, { version: 1 });
  }
  return {
    current: () => active,
    dispose() { disposed = true; retire(); for (const unsub of unsubs) unsub?.(); retired.clear(); },
  };
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Browser action cancelled.");
}

function validatedOrder(outcome: Outcome, candidates: Candidate[]): string[] | undefined {
  const count = outcome.evaluatedCount ?? candidates.length;
  if (!Number.isInteger(count) || count < 2 || count > candidates.length || !Array.isArray(outcome.scores)
    || outcome.scores.length !== count) return;
  const window = candidates.slice(0, count);
  const expected = new Set(window.map(({ id }) => id));
  const scores = new Map<string, number>();
  for (const entry of outcome.scores) {
    if (!record(entry) || !expected.has(entry.id) || scores.has(entry.id)
      || typeof entry.score !== "number" || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > 3) return;
    scores.set(entry.id, entry.score);
  }
  if (scores.size !== expected.size) return;
  return window.map((candidate, index) => ({ ...candidate, index }))
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.index - b.index)
    .map(({ id }) => id).concat(candidates.slice(count).map(({ id }) => id));
}

/** Metadata is added after the host's budget check. Never return an oversized observation. */
function enforceObservationBudget(result: any): any {
  if (!result.ok || JSON.stringify(result).length <= 20_000) return result;
  // Fail explicitly rather than deleting page structure or renumbering published references.
  // Preserve bounded measurement fields, but expose no snapshot/element references as evidence.
  const source = result.observationOptimization ?? {};
  const optimization: Record<string, unknown> = { status: "fallback", reason: "observation-budget", displayedCount: 0 };
  for (const key of ["collectedCount", "candidateCount", "evaluationWindowCount", "evaluatedCount", "submittedCount",
    "collectionMs", "publishMs", "availabilityMs", "prepareMs", "scoringMs", "elapsedMs", "inputTokens"]) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) optimization[key] = value;
  }
  if (typeof source.model === "string" && /^[\w./-]{1,100}$/.test(source.model)) optimization.model = source.model;
  return {
    ok: false, code: "browser_observation_budget", requiresObservation: true, truncated: true,
    error: "Browser observation with optimization metadata exceeds the 20000 UTF-16 unit budget. No observation was returned; narrow region/role/name or omit intent.",
    observationOptimization: optimization,
  };
}

export async function observeWithOptionalRerank(
  params: Record<string, any>, projectRoot: string, signal: AbortSignal | undefined,
  connection: BrowserRerankerConnection | undefined,
  bridge: (action: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<any>,
): Promise<any> {
  cancelled(signal);
  if (!params.intent) return bridge("observe", params, signal);
  if (params.target === "both") {
    const result = await bridge("observe", params, signal);
    // Each pane has its own 20k envelope; the legal combined envelope may be larger.
    // Host tagging and multi-target metadata happen after the controller's check.
    if (!record(result.desktop) || !record(result.mobile)) return enforceObservationBudget(result);
    const desktop = enforceObservationBudget(result.desktop);
    const mobile = enforceObservationBudget(result.mobile);
    const failed = [desktop, mobile].find(pane => pane.ok !== true);
    return {
      ...result, desktop, mobile, ok: !failed,
      ...(failed ? {
        code: failed.code, requiresObservation: failed.requiresObservation,
        error: [desktop.ok ? undefined : `desktop: ${desktop.error || "failed"}`, mobile.ok ? undefined : `mobile: ${mobile.error || "failed"}`].filter(Boolean).join("; "),
      } : {}),
    };
  }
  const selected = connection?.current();
  const start = Date.now();
  const local = async (reason: string) => {
    cancelled(signal);
    const result = await bridge("observe", params, signal);
    if (result.ok && result.observationOptimization) result.observationOptimization = {
      ...result.observationOptimization, status: "local", reason: stableReason(reason, "unavailable"), elapsedMs: Date.now() - start,
    };
    return enforceObservationBudget(result);
  };
  if (!selected) return local("no-provider");

  const ac = new AbortController();
  let stopped: string | undefined;
  const stop = (reason: string) => { if (!stopped) { stopped = reason; ac.abort(); } };
  const userAbort = () => stop("aborted");
  const withdrawn = () => stop("withdrawn");
  signal?.addEventListener("abort", userAbort, { once: true });
  selected.signal.addEventListener("abort", withdrawn, { once: true });
  if (selected.signal.aborted) withdrawn();
  const timer = setTimeout(() => stop("timeout"), DEADLINE_MS);
  const abort = new Promise<never>((_, reject) => {
    if (ac.signal.aborted) reject(new Error("aborted"));
    else ac.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  void abort.catch(() => {});
  const race = <T>(work: () => Promise<T>) => {
    if (Date.now() - start >= DEADLINE_MS) stop("timeout");
    if (ac.signal.aborted) return Promise.reject(new Error("aborted"));
    return Promise.race([work(), abort]);
  };
  try {
    let available: { ready: boolean; reason?: string };
    try { available = await race(() => selected.offer.availability(projectRoot, ac.signal)); }
    catch { return await local(stopped ?? "unavailable"); }
    cancelled(signal);
    if (!available?.ready || stopped) return await local(stopped ?? available?.reason ?? "unavailable");

    const availabilityMs = Date.now() - start;
    const prepareStart = Date.now();
    const prepared = await bridge("prepare_intent_observation", params, signal);
    cancelled(signal);
    if (!prepared.ok) return prepared;
    if (typeof prepared.preparationID !== "string") return { ok: false, code: "invalid-preparation", error: "Invalid browser preparation" };
    const prepareMs = Date.now() - prepareStart;
    const candidates: Candidate[] = [];
    let reason: string | undefined = prepared.cloudReason;
    const seen = new Set<string>();
    if (!Array.isArray(prepared.candidates) || typeof prepared.intent !== "string") reason ??= "invalid-candidates";
    for (const item of (Array.isArray(prepared.candidates) ? prepared.candidates.slice(0, 64) : [])) {
      if (!record(item) || typeof item.id !== "string" || !item.id || seen.has(item.id)
        || [item.role, item.name, item.region].some((value) => typeof value !== "string")) {
        reason ??= "invalid-candidates";
        break;
      }
      seen.add(item.id);
      // This is an in-process allowlist, not the cloud payload. The provider must see
      // complete known secrets so it can redact BEFORE enforcing its UTF-8/JSON budgets.
      candidates.push({ id: item.id, role: item.role, name: item.name, region: item.region });
    }
    if (candidates.length < 2) reason ??= "insufficient-candidates";
    if (new Set(candidates.map(({ role, name, region }) => JSON.stringify({ role, name, region }))).size < 2) reason ??= "identical-candidates";
    let outcome: Outcome = { status: "skipped", reason, evaluatedCount: 0 };
    const scoreStart = Date.now();
    if (!reason) {
      try {
        outcome = await race(() => selected.offer.rerank({
          intent: prepared.intent, candidates, projectRoot, signal: ac.signal,
        }));
      } catch { outcome = { status: "fallback", reason: stopped ?? "network", evaluatedCount: 0 }; }
    }
    cancelled(signal);
    if (stopped) outcome = { status: "fallback", reason: stopped, evaluatedCount: outcome?.evaluatedCount ?? 0 };
    if (!record(outcome) || !["applied", "skipped", "fallback"].includes(outcome.status)) outcome = { status: "fallback", reason: "invalid-response", evaluatedCount: 0 };
    let order: string[] | undefined;
    if (outcome.status === "applied") {
      order = validatedOrder(outcome, candidates);
      if (!order) outcome = { ...outcome, status: "fallback", reason: "invalid-response", evaluatedCount: 0 };
      else if (new Set(outcome.scores!.map(({ score }) => score)).size < 2) {
        order = undefined;
        outcome = { ...outcome, status: "skipped", reason: "flat-scores", evaluatedCount: outcome.scores!.length };
      }
    }
    const scoringMs = Date.now() - scoreStart;
    // Revoke/timeout still publishes the saved LOCAL order. User cancellation never publishes.
    cancelled(signal);
    const result = await bridge("finalize_intent_observation", {
      preparation_id: prepared.preparationID,
      ...(params.target ? { target: params.target } : {}),
      ...(order ? { candidate_ids: order } : {}),
    }, signal);
    if (result.ok && result.observationOptimization) {
      const evaluated = outcome.evaluatedCount ?? (outcome.status === "applied" ? outcome.scores?.length : 0) ?? 0;
      result.observationOptimization = {
        ...result.observationOptimization, status: outcome.status,
        reason: stableReason(outcome.reason, outcome.status === "applied" ? "jev-ranked" : "unavailable"), availabilityMs, prepareMs, scoringMs, elapsedMs: Date.now() - start,
        evaluatedCount: Number.isInteger(evaluated) && evaluated >= 0 && evaluated <= candidates.length ? evaluated : 0,
        ...(Number.isInteger(outcome.submittedCount) && outcome.submittedCount! >= 0 && outcome.submittedCount! <= candidates.length ? { submittedCount: outcome.submittedCount } : {}),
        ...(typeof outcome.model === "string" && /^[\w./-]{1,100}$/.test(outcome.model) ? { model: outcome.model } : {}),
        ...(typeof outcome.inputTokens === "number" && Number.isFinite(outcome.inputTokens) && outcome.inputTokens >= 0 ? { inputTokens: outcome.inputTokens } : {}),
      };
    }
    return enforceObservationBudget(result);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", userAbort);
    selected.signal.removeEventListener("abort", withdrawn);
    ac.abort();
  }
}
