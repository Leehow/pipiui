import { afterEach, describe, expect, it, vi } from "vitest";
import registerBrowserTool from "../../../resources/runtime/extensions/webview-browser-extension/agent/browser-tool.ts";
import { capabilityCall } from "../../../resources/runtime/extensions/webview-browser-extension/agent/capability-bridge.ts";
import { BROWSER_DISCOVER, BROWSER_PROVIDE, BROWSER_WITHDRAW } from "../../../resources/runtime/extensions/webview-browser-extension/agent/browser-reranker.ts";
import { createJevOptimizer } from "../../../resources/runtime/extensions/jev-optimizer/agent/index.ts";

vi.mock("../../../resources/runtime/extensions/webview-browser-extension/agent/capability-bridge.ts", () => ({ capabilityCall: vi.fn() }));
const bridge = vi.mocked(capabilityCall);
const candidates = [
  { id: "c1", role: "button", name: "Save draft", region: "Editor" },
  { id: "c2", role: "button", name: "Publish", region: "Editor" },
  { id: "c3", role: "link", name: "Preview", region: "Navigation" },
];
const prepared = () => ({ ok: true, preparationID: "desktop:prep-private", intent: "Publish", candidates, collectedCount: 3, collectionMs: 1 });
const observation = () => ({ ok: true, title: "Page", url: "https://synthetic.test/", snapshotID: "desktop:snap", elements: [{ index: 0, token: "desktop:real-token", role: "button", name: "Publish" }],
  regions: [{ id: "r1", name: "Editor", count: 3 }], limitations: ["cross-origin boundary"],
  observationOptimization: { status: "local", reason: "local-ranked", collectedCount: 3, candidateCount: 3, evaluationWindowCount: 3, evaluatedCount: 0, displayedCount: 1, collectionMs: 1, publishMs: 1 } });
function bus() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    on: (channel: string, fn: (data: unknown) => void) => {
      if (!handlers.has(channel)) handlers.set(channel, new Set());
      handlers.get(channel)!.add(fn);
      return () => { handlers.get(channel)!.delete(fn); };
    },
    emit: vi.fn((channel: string, data?: unknown) => { for (const fn of handlers.get(channel) ?? []) fn(data); }),
  };
}
function harness(register = true) {
  const events = bus();
  const tools: any[] = [];
  const hooks = new Map<string, Array<() => void>>();
  const pi: any = { events, registerTool: (tool: any) => tools.push(tool), on: (event: string, hook: () => void) => {
    if (!hooks.has(event)) hooks.set(event, []); hooks.get(event)!.push(hook);
  } };
  bridge.mockImplementation(async (_method, payload) => {
    if (payload.action === "prepare_intent_observation") return prepared();
    return observation();
  });
  if (register) registerBrowserTool(pi);
  return { pi, events, shutdown: () => { for (const fn of hooks.get("session_shutdown") ?? []) fn(); },
    register: () => registerBrowserTool(pi),
    run: (params: any = { action: "observe", intent: "Publish" }, signal?: AbortSignal) => tools[0].execute("call", params, signal, undefined, { cwd: "/synthetic/project" }),
  };
}
function offer(over: Record<string, any> = {}) {
  return { version: 1, provider: "jev-optimizer", instanceId: "test-provider",
    availability: vi.fn(async () => ({ ready: true })),
    rerank: vi.fn(async () => ({ status: "applied", evaluatedCount: 3, scores: [{ id: "c1", score: 1 }, { id: "c2", score: 3 }, { id: "c3", score: 3 }], model: "jev-latest", inputTokens: 30 })), ...over };
}
function actions() { return bridge.mock.calls.map(([, payload]) => payload.action); }
const state = (over = {}) => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: "code-gen", browserEnabled: true, browserGeneration: "browser-gen", ...over });
const syntheticDeps = (over = {}) => ({ env: { PIPIUI_JEV_STATE_FILE: "/injected/state", PIPIUI_JEV_GENERATION: "code-gen", EXT_JEV_OPTIMIZER_APIKEY: "test-fake-key" }, readState: async () => state(), ...over });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("registered browser optional Jev Score", () => {
  it("missing provider takes one ordinary local bridge; old no-intent and both never probe", async () => {
    const h = harness();
    expect((await h.run()).details.observationOptimization.reason).toBe("no-provider");
    expect(actions()).toEqual(["observe"]);
    const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    bridge.mockClear();
    await h.run({ action: "observe", role: "button", cursor: "page-two" });
    await h.run({ action: "observe", intent: "Publish", target: "both" });
    expect(actions()).toEqual(["observe", "observe"]);
    expect(provider.availability).not.toHaveBeenCalled();
    expect(provider.rerank).not.toHaveBeenCalled();
  });

  it.each([{ hasKey: false }, { browserEnabled: false }, { enabled: false }, { browserEnabled: undefined, browserGeneration: undefined }])("real provider unavailable %j means zero HTTP and one local RPC", async (over) => {
    const h = harness();
    const http = vi.fn(async () => new Response("unused"));
    const handle = createJevOptimizer(h.pi, syntheticDeps({ fetch: http, readState: async () => state(over) }));
    const result = await h.run();
    expect(result.isError).toBeUndefined();
    expect(actions()).toEqual(["observe"]);
    expect(result.details.observationOptimization.status).toBe("local");
    expect(http).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("availability→prepare→one score→finalize, ties stable and only final observation visible", async () => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    const result = await h.run({ action: "observe", intent: "  Publish  ", target: "mobile", scope: "page", region: "r1", role: "button", name: "Publish" });
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
    expect(provider.availability).toHaveBeenCalledOnce();
    expect(provider.rerank).toHaveBeenCalledOnce();
    expect(provider.rerank.mock.calls[0][0]).toMatchObject({ projectRoot: "/synthetic/project", intent: "Publish", candidates });
    expect(bridge.mock.calls[0][1]).toMatchObject({ target: "mobile", scope: "page", region: "r1", role: "button", name: "Publish" });
    expect(bridge.mock.calls[1][1]).toEqual({ action: "finalize_intent_observation", preparation_id: "desktop:prep-private", target: "mobile", candidate_ids: ["c2", "c3", "c1"] });
    expect(result.details.observationOptimization).toMatchObject({ status: "applied", evaluatedCount: 3, inputTokens: 30, model: "jev-latest", displayedCount: 1 });
    expect(result.details.observationOptimization.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.details.limitations).toEqual(["cross-origin boundary"]);
    expect(result.details.elements[0].token).toBe("desktop:real-token");
    expect(JSON.stringify(result)).not.toContain("prep-private");
    expect(JSON.stringify(result)).not.toContain("Save draft");
  });

  it("real Jev provider + fake HTTP works in provider-first load order and uploads only prepared allowlist", async () => {
    const h = harness(false); const http = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(Object.keys(body.state)).toEqual(["intent", "candidates"]);
      expect(body.state.intent).toBe("[redacted] Publish");
      expect(body.state.candidates).toEqual(candidates);
      expect(String(init!.body)).not.toMatch(/token-secret|private-title|private-url|private-path|private-value|test-fake-key/);
      return new Response(JSON.stringify({ answers: { c1: { type: "score", score: 0 }, c2: { type: "score", score: 3 }, c3: { type: "score", score: 1 } }, model: "jev-latest", usage: { input_tokens: 44 } }));
    });
    const handle = createJevOptimizer(h.pi, syntheticDeps({ fetch: http }));
    h.register();
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? {
      ...prepared(), intent: "[redacted] Publish", candidates: candidates.map((candidate) => ({ ...candidate, token: "token-secret", url: "private-url", title: "private-title", domPath: "private-path", value: "private-value" })),
    } : observation());
    const result = await h.run();
    expect(http).toHaveBeenCalledOnce();
    expect(result.details.observationOptimization).toMatchObject({ status: "applied", inputTokens: 44, evaluatedCount: 3 });
    expect(bridge.mock.calls[1][1].candidate_ids).toEqual(["c2", "c3", "c1"]);
    handle.dispose();
  });

  it("redacts complete known-key boundaries before UTF-8 clipping in the real provider", async () => {
    const key = "sk-synthetic-test-secret";
    const secretCandidate = { id: "c1", role: "r".repeat(41) + key, name: "中".repeat(163) + key, region: "中".repeat(35) + key };
    const h = harness();
    let wire = "";
    const http = vi.fn(async (_url: string, init?: RequestInit) => {
      wire = String(init!.body);
      return new Response(JSON.stringify({ answers: { c1: { type: "score", score: 3 }, c2: { type: "score", score: 1 }, c3: { type: "score", score: 0 } } }));
    });
    const handle = createJevOptimizer(h.pi, syntheticDeps({ fetch: http, env: { ...syntheticDeps().env, EXT_JEV_OPTIMIZER_APIKEY: key } }));
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? {
      ...prepared(), candidates: [secretCandidate, ...candidates.slice(1)],
    } : observation());
    try {
      const result = await h.run();
      expect(http).toHaveBeenCalledOnce();
      expect(result.details.observationOptimization.status).toBe("applied");
      expect(wire).not.toContain(key);
      expect(wire).not.toContain(key.slice(0, -1));
      const body = JSON.parse(wire);
      expect(body.state.candidates[0].id).toBe("c1");
      for (const field of ["role", "name", "region"]) expect(body.state.candidates[0][field]).toContain("<redacted>");
      expect(Buffer.byteLength(wire)).toBeLessThanOrEqual(65536);
      for (const { id, ...description } of body.state.candidates) expect(Buffer.byteLength(JSON.stringify(description))).toBeLessThanOrEqual(768);
    } finally { handle.dispose(); }
  });

  it.each([1, 2])("retains structured optimization metadata in a %i-item batch", async (count) => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    const result = await h.run({ actions: Array.from({ length: count }, () => ({ action: "observe", intent: "Publish" })) });
    expect(result.isError).toBeUndefined();
    for (const entry of result.details.results) {
      expect(entry.details.observationOptimization).toMatchObject({ status: "applied", reason: "jev-ranked", evaluatedCount: 3, inputTokens: 30, model: "jev-latest", displayedCount: 1 });
      for (const field of ["availabilityMs", "prepareMs", "scoringMs", "elapsedMs"]) expect(entry.details.observationOptimization[field]).toBeGreaterThanOrEqual(0);
    }
    if (count > 1) expect(result.details.results[0].details.summarized).toBe(true);
    expect(result.details.results.at(-1).details.elements[0]).toMatchObject({ index: 0, token: "desktop:real-token" });
  });

  it("old no-intent batch never gains optimization metadata", async () => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    bridge.mockImplementation(async () => { const { observationOptimization, ...old } = observation(); return old; });
    const result = await h.run({ actions: [{ action: "observe" }, { action: "observe" }] });
    for (const entry of result.details.results) expect(entry.details).not.toHaveProperty("observationOptimization");
    expect(provider.availability).not.toHaveBeenCalled();
  });

  function sizedObservation(length: number) {
    const result = { ...observation(), truncated: false, viewport: { width: 1280, height: 800 }, focus: { role: "button", name: "Publish" },
      elements: [{ index: 7, token: "desktop:unchanged-seven", role: "button", name: "Publish" }, { index: 19, token: "desktop:unchanged-nineteen", role: "link", name: "Preview" }],
      regions: Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, name: `Region-${i}`, role: "region", count: 4, more: 4, expanded: false })),
      observationOptimization: { ...observation().observationOptimization, displayedCount: 2 },
    };
    let remaining = length - JSON.stringify(result).length;
    expect(remaining).toBeGreaterThanOrEqual(0);
    for (let i = 0; remaining > 0; i++) {
      const addition = Math.min(64, remaining);
      result.regions[i % result.regions.length].name += "中".repeat(addition);
      remaining -= addition;
    }
    expect(JSON.stringify(result).length).toBe(length);
    return result;
  }

  it.each([19600, 19990])("final observation envelope stays within 20000 UTF-16 units from %i", async (size) => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    const published = sizedObservation(size);
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? prepared() : structuredClone(published));
    const result = await h.run();
    expect(provider.rerank).toHaveBeenCalledOnce();
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
    expect(JSON.stringify(result.details).length).toBeLessThanOrEqual(20000);
    if (size === 19600) {
      expect(result.isError).toBeUndefined();
      expect(result.details.elements).toEqual(published.elements); // Never renumber usable refs.
      expect(result.details.regions).toEqual(published.regions);
      expect(result.details.focus).toEqual(published.focus);
      expect(result.details.limitations).toEqual(published.limitations);
      expect(result.details.truncated).toBe(false);
      expect(result.details.observationOptimization).toMatchObject({ status: "applied", displayedCount: 2, evaluatedCount: 3, inputTokens: 30 });
    } else {
      expect(result.isError).toBe(true); // Do not silently erase structure to force a success.
      expect(result.details).toMatchObject({ code: "browser_observation_budget", requiresObservation: true, truncated: true,
        observationOptimization: { status: "fallback", reason: "observation-budget", displayedCount: 0, evaluatedCount: 3, inputTokens: 30 } });
      expect(result.details).not.toHaveProperty("elements");
      expect(result.details).not.toHaveProperty("snapshotID");
      expect(JSON.stringify(result.content)).not.toContain("desktop:unchanged");
    }
  });

  it("local metadata cannot push an already full envelope over budget", async () => {
    const h = harness();
    bridge.mockImplementation(async () => sizedObservation(20000));
    const result = await h.run();
    expect(actions()).toEqual(["observe"]);
    expect(JSON.stringify(result.details).length).toBeLessThanOrEqual(20000);
    expect(result.isError).toBe(true);
    expect(result.details.observationOptimization).toMatchObject({ displayedCount: 0, evaluatedCount: 0, reason: "observation-budget" });
  });

  it("overbudget final metadata explicitly fails and prevents the batch tail", async () => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? prepared() : sizedObservation(19990));
    const result = await h.run({ actions: [{ action: "observe", intent: "Publish" }, { action: "click", locator: { role: "button", name: "Delete" } }] });
    expect(result.isError).toBe(true);
    expect(result.details.failedIndex).toBe(0);
    expect(result.details.skipped).toEqual([1]);
    expect(result.details.results[0].details.observationOptimization.displayedCount).toBe(0);
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
    expect(JSON.stringify(result.details).length).toBeLessThanOrEqual(20000);
  });

  it.each([
    { cloudReason: "redaction-capacity", candidates: [] },
    { candidates: candidates.slice(0, 1) },
    { candidates: [candidates[0], { ...candidates[0], id: "c2" }] },
  ])("ineligible preparation never asks provider to upload", async (over) => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? { ...prepared(), ...over } : observation());
    const result = await h.run();
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
    expect(provider.rerank).not.toHaveBeenCalled();
    expect(bridge.mock.calls[1][1]).not.toHaveProperty("candidate_ids");
    expect(result.details.observationOptimization.status).toBe("skipped");
    expect(result.details.observationOptimization.evaluatedCount).toBe(0);
  });

  it.each([
    { status: "fallback", reason: "http-429", evaluatedCount: 3 },
    { status: "applied", scores: [{ id: "c1", score: 3 }, { id: "c1", score: 1 }, { id: "c3", score: 0 }] },
    { status: "applied", scores: [{ id: "c1", score: 3 }] },
    { status: "applied", scores: [{ id: "c1", score: 4 }, { id: "c2", score: 1 }, { id: "c3", score: 0 }] },
    { status: "applied", scores: [{ id: "c1", score: 3 }, { id: "c2", score: NaN }, { id: "c3", score: 0 }] },
    { status: "applied", scores: [{ id: "c1", score: 3 }, { id: "c2", score: 1 }, { id: "invented", score: 0 }] },
    { status: "applied", evaluatedCount: 3, scores: candidates.map(({ id }) => ({ id, score: 2 })), inputTokens: 11 },
  ])("invalid/service/flat result preserves prepared local order: %j", async (outcome) => {
    const h = harness(); const provider = offer({ rerank: vi.fn(async () => outcome) }); h.events.emit(BROWSER_PROVIDE, provider);
    const result = await h.run();
    expect(provider.rerank).toHaveBeenCalledOnce();
    expect(bridge.mock.calls[1][1]).not.toHaveProperty("candidate_ids");
    expect(["fallback", "skipped"]).toContain(result.details.observationOptimization.status);
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
  });

  it("partial budget window requires complete prefix IDs and retains unevaluated local tail", async () => {
    const h = harness(); const provider = offer({ rerank: vi.fn(async () => ({ status: "applied", evaluatedCount: 2, scores: [{ id: "c1", score: 1 }, { id: "c2", score: 3 }] })) });
    h.events.emit(BROWSER_PROVIDE, provider);
    const result = await h.run();
    expect(bridge.mock.calls[1][1].candidate_ids).toEqual(["c2", "c1", "c3"]);
    expect(result.details.observationOptimization.evaluatedCount).toBe(2);
  });

  it("real provider still rejects an overbudget cloud payload without HTTP", async () => {
    const h = harness();
    const http = vi.fn(async () => new Response("unused"));
    const handle = createJevOptimizer(h.pi, syntheticDeps({ fetch: http }));
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? { ...prepared(), intent: "x".repeat(65536) } : observation());
    try {
      const result = await h.run();
      expect(http).not.toHaveBeenCalled();
      expect(result.details.observationOptimization).toMatchObject({ status: "skipped", reason: "budget", evaluatedCount: 0, submittedCount: 0 });
      expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
      expect(bridge.mock.calls[1][1]).not.toHaveProperty("candidate_ids");
    } finally { handle.dispose(); }
  });

  it("consumer bounds candidate count and allowlists full descriptions without breaking secret boundaries", async () => {
    const h = harness();
    const wide = Array.from({ length: 80 }, (_, i) => ({ id: `runtime-${i}`, role: "button", name: `${i}${'敏\"'.repeat(1000)}`, region: "区".repeat(500), token: "not-uploaded" }));
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? { ...prepared(), candidates: wide } : observation());
    const provider = offer({ rerank: vi.fn(async (input) => {
      expect(input.candidates).toHaveLength(64);
      expect(input.candidates.map(({ id }) => id)).toEqual(wide.slice(0, 64).map(({ id }) => id));
      expect(JSON.stringify(input.candidates)).not.toContain("not-uploaded");
      expect(input.candidates).toEqual(wide.slice(0, 64).map(({ token, ...candidate }) => candidate));
      return { status: "applied", evaluatedCount: 64, scores: input.candidates.map(({ id }, i) => ({ id, score: i % 4 })) };
    }) });
    h.events.emit(BROWSER_PROVIDE, provider);
    expect((await h.run()).details.observationOptimization.evaluatedCount).toBe(64);
    expect(provider.rerank).toHaveBeenCalledOnce();
  });

  it("withdraw during scoring aborts provider, finalizes locally once and ignores late scores", async () => {
    const h = harness(); let resolve: (value: unknown) => void = () => {};
    let scoreSignal: AbortSignal | undefined;
    const provider = offer({ rerank: vi.fn((input) => { scoreSignal = input.signal; h.events.emit(BROWSER_WITHDRAW, { version: 1, provider: "jev-optimizer", instanceId: "test-provider" }); return new Promise((r) => { resolve = r; }); }) });
    h.events.emit(BROWSER_PROVIDE, provider);
    const result = await h.run();
    expect(scoreSignal?.aborted).toBe(true);
    expect(result.details.observationOptimization.reason).toBe("withdrawn");
    expect(bridge.mock.calls[1][1]).not.toHaveProperty("candidate_ids");
    resolve({ status: "applied", scores: candidates.map(({ id }) => ({ id, score: 3 })) });
    h.events.emit(BROWSER_PROVIDE, provider); // retired instance cannot resurrect
    await h.run();
    expect(provider.rerank).toHaveBeenCalledOnce();
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation", "observe"]);
  });

  it("real provider browser authorization revocation rejects late HTTP and publishes local", async () => {
    const h = harness(); let raw = state(); let scoreSignal: AbortSignal | null | undefined;
    const http = vi.fn(async (_url: string, init?: RequestInit) => { scoreSignal = init?.signal; raw = state({ browserEnabled: false, browserGeneration: "revoked" }); return new Promise<Response>(() => {}); });
    const handle = createJevOptimizer(h.pi, syntheticDeps({ fetch: http, pollMs: 5, readState: async () => raw }));
    const result = await h.run();
    expect(scoreSignal?.aborted).toBe(true);
    expect(result.details.observationOptimization.status).toBe("fallback");
    expect(bridge.mock.calls[1][1]).not.toHaveProperty("candidate_ids");
    expect(http).toHaveBeenCalledOnce();
    handle.dispose();
  });

  it.each(["availability", "prepare", "score"])("user cancellation during %s issues no finalize or batch tail", async (phase) => {
    const h = harness(); const ac = new AbortController();
    const provider = offer({ availability: vi.fn(async () => { if (phase === "availability") ac.abort(); return { ready: true }; }),
      rerank: vi.fn(async () => { if (phase === "score") ac.abort(); return { status: "fallback", reason: "aborted" }; }) });
    if (phase === "prepare") bridge.mockImplementation(async () => { ac.abort(); return prepared(); });
    h.events.emit(BROWSER_PROVIDE, provider);
    const result = await h.run({ actions: [{ action: "observe", intent: "Publish" }, { action: "click", locator: { role: "button", name: "Delete" } }] }, ac.signal);
    expect(actions()).toEqual(phase === "availability" ? [] : ["prepare_intent_observation"]);
    expect(result.isError).toBe(true);
    expect(result.details.failedIndex).toBe(0);
  });

  it("already aborted calls do not probe or touch the host", async () => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    const ac = new AbortController(); ac.abort();
    const result = await h.run(undefined, ac.signal);
    expect(result.isError).toBe(true);
    expect(provider.availability).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("1500ms total includes availability and request; hung/late result does not trigger retry", async () => {
    vi.useFakeTimers();
    const h = harness(); let scoreSignal: AbortSignal | undefined;
    const provider = offer({ availability: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ ready: true }), 1000))),
      rerank: vi.fn((input) => { scoreSignal = input.signal; return new Promise(() => {}); }) });
    h.events.emit(BROWSER_PROVIDE, provider);
    const pending = h.run();
    await vi.advanceTimersByTimeAsync(1499);
    expect(actions()).toEqual(["prepare_intent_observation"]);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.details.observationOptimization.reason).toBe("timeout");
    expect(provider.rerank).toHaveBeenCalledOnce();
    expect(scoreSignal?.aborted).toBe(true);
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
  });

  it("hung availability is bounded and falls back to a single local observation", async () => {
    vi.useFakeTimers(); const h = harness(); const provider = offer({ availability: vi.fn(() => new Promise(() => {})) });
    h.events.emit(BROWSER_PROVIDE, provider); const pending = h.run();
    await vi.advanceTimersByTimeAsync(1500);
    expect((await pending).details.observationOptimization.reason).toBe("timeout");
    expect(actions()).toEqual(["observe"]);
    expect(provider.rerank).not.toHaveBeenCalled();
  });

  it("page changed on finalize returns original error and stops batch without re-score", async () => {
    const h = harness(); const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider);
    bridge.mockImplementation(async (_method, payload) => payload.action === "prepare_intent_observation" ? prepared() : { ok: false, code: "browser_observation_changed", error: "Page changed", requiresObservation: true });
    const result = await h.run({ actions: [{ action: "observe", intent: "Publish" }, { action: "click", locator: { role: "button", name: "Delete" } }] });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("browser_observation_changed");
    expect(JSON.stringify(result)).not.toContain('"status":"applied"');
    expect(provider.rerank).toHaveBeenCalledOnce();
    expect(actions()).toEqual(["prepare_intent_observation", "finalize_intent_observation"]);
  });

  it("registration handshake is versioned and session shutdown disconnects the consumer", async () => {
    const h = harness(); expect(h.events.emit).toHaveBeenCalledWith(BROWSER_DISCOVER, { version: 1 });
    h.events.emit(BROWSER_PROVIDE, offer({ version: 2 }));
    await h.run(); expect(actions()).toEqual(["observe"]);
    const provider = offer(); h.events.emit(BROWSER_PROVIDE, provider); h.shutdown();
    await h.run(); expect(provider.availability).not.toHaveBeenCalled();
  });
});
