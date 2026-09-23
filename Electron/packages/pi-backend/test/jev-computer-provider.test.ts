import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJevOptimizer, COMPUTER_CHOICE_DISCOVER, COMPUTER_CHOICE_PROVIDE, COMPUTER_CHOICE_WITHDRAW,
  buildComputerChoicePayload, executeComputerChoiceAvailability, type ComputerChoiceInput, type ComputerChoiceOffer,
} from "../../../resources/runtime/extensions/jev-optimizer/agent/index.js";
import { parseHostState, checkBrowserAvailability, checkAvailability } from "../../../resources/runtime/extensions/jev-optimizer/agent/state.js";
import type { EventBus, JevDeps } from "../../../resources/runtime/extensions/jev-optimizer/agent/types.js";
import { JevRuntimeStateStore } from "../src/jev-runtime-state.js";

const KEY = "sk-synthetic-computer-secret";
const ROOT = "/synthetic/computer-project";
const hostState = (over = {}) => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: "base", browserEnabled: true, browserGeneration: "browser", contextEnabled: true, computerEnabled: true, computerUseEnabled: true, computerGeneration: "computer", ...over });
const input = (over: Partial<ComputerChoiceInput> = {}): ComputerChoiceInput => ({ projectRoot: ROOT, goal: "打开设置", candidates: [
  { id: "click-settings", description: "Click the Settings button" },
  { id: "finish", description: "Finish; independent verification required" },
  { id: "handoff", description: "Hand off to the main agent" },
], ...over });
const deps = (over: JevDeps = {}): JevDeps => ({
  env: { PIPIUI_JEV_STATE_FILE: `${ROOT}/.pi/agent/jev-optimizer/runtime-state.json`, PIPIUI_JEV_GENERATION: "base", EXT_JEV_OPTIMIZER_APIKEY: KEY },
  readState: async () => hostState(), fetch: vi.fn(async () => { throw Error("unexpected HTTP"); }), ...over,
});
function response(body: any, choice = Object.keys(body.questions.action.criteria)[0]!) {
  return { answers: { action: { type: "choice", choice, confidence: 1,
    probabilities: Object.fromEntries(Object.keys(body.questions.action.criteria).map(id => [id, id === choice ? 1 : 0])),
  } }, model: "jev-latest", usage: { input_tokens: 42 } };
}
const reply = (mutate: (body: any) => void = () => {}): NonNullable<JevDeps["fetch"]> => async (_url, init) => {
  const body = response(JSON.parse(String(init!.body))); mutate(body); return new Response(JSON.stringify(body));
};
class Bus implements EventBus {
  handlers = new Map<string, Set<(data: unknown) => void>>();
  on(channel: string, handler: (data: unknown) => void) {
    const handlers = this.handlers.get(channel) ?? new Set(); this.handlers.set(channel, handlers); handlers.add(handler);
    return () => { handlers.delete(handler); };
  }
  emit(channel: string, data?: unknown) { for (const handler of this.handlers.get(channel) ?? []) handler(data); }
}
const handles: Array<{ dispose(): void }> = [];
const roots: string[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function provider(options = deps()) {
  const bus = new Bus(); const offers: ComputerChoiceOffer[] = []; const withdrawn: unknown[] = [];
  const events = new Map<string, (...args: unknown[]) => unknown>();
  bus.on(COMPUTER_CHOICE_PROVIDE, value => offers.push(value as ComputerChoiceOffer));
  bus.on(COMPUTER_CHOICE_WITHDRAW, value => withdrawn.push(value));
  const handle = createJevOptimizer({ events: bus, on: (name, handler) => events.set(name, handler) }, options);
  handles.push(handle);
  return { bus, offers, withdrawn, handle, events, offer: offers[0]! };
}

describe("registered desktop Choice provider", () => {
  it("publishes/discovers/withdraws the narrow independent contract, including its generation", async () => {
    const f = provider();
    expect(f.offers).toHaveLength(1);
    expect(Object.keys(f.offer).sort()).toEqual(["availability", "choose", "instanceId", "provider", "version"]);
    expect(await f.offer.availability(ROOT)).toEqual({ ready: true, generation: "computer" });
    f.bus.emit(COMPUTER_CHOICE_DISCOVER);
    expect(f.offers).toHaveLength(2);
    expect(f.offers[1]!.instanceId).toBe(f.handle.instanceId);
    f.events.get("session_shutdown")!();
    expect(f.withdrawn).toEqual([{ version: 1, provider: "jev-optimizer", instanceId: f.handle.instanceId }]);
    expect(await f.offer.choose(input())).toEqual({ status: "skipped", reason: "withdrawn" });
    expect(await f.offer.availability(ROOT)).toEqual({ ready: false, reason: "withdrawn" });
    f.bus.emit(COMPUTER_CHOICE_DISCOVER); f.handle.dispose();
    expect(f.offers).toHaveLength(2); expect(f.withdrawn).toHaveLength(1);
  });

  it("projects only allowlisted fields and keeps bound values/redactions, tokens and images local", async () => {
    const secret = "synthetic-bound-input-value";
    const value = input({ goal: `查找 ${secret} ${KEY}`, redactions: [secret],
      candidates: [{ id: "click-settings", description: `Click ${secret} ${KEY}` }, ...input().candidates.slice(1)],
      history: [{ operation: `click ${KEY}`, outcome: `observed ${secret}` }],
      coverage: { collected: 500, omitted: 452, truncated: true },
    });
    Object.assign(value, { screenshot: "private-image", pid: 12, snapshotId: "private-snapshot" });
    Object.assign(value.candidates[0]!, { token: "private-token", value: "private-field", x: 400, y: 500, role: "private-role" });
    Object.assign(value.history![0]!, { raw: "private-history" });
    Object.assign(value.coverage!, { raw: "private-ax" });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${KEY}` });
      const raw = String(init!.body); const body = JSON.parse(raw);
      expect(raw).not.toMatch(/private-|redactions|projectRoot|snapshot|screenshot/);
      expect(raw).not.toContain(KEY); expect(raw).not.toContain(secret);
      expect(body.state.goal).toBe("查找 <redacted> <redacted>");
      expect(body.state.candidates[0]).toEqual({ id: "click-settings", description: "Click <redacted> <redacted>" });
      expect(body.state.history).toEqual([{ operation: "click <redacted>", outcome: "observed <redacted>" }]);
      expect(body.state.coverage).toEqual({ collected: 500, omitted: 452, truncated: true });
      return new Response(JSON.stringify(response(body)));
    });
    const f = provider(deps({ fetch }));
    expect(await f.offer.choose(value)).toEqual({ status: "applied", candidateId: "click-settings", model: "jev-latest", inputTokens: 42 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("denies missing/old/disabled desktop authority and wrong projects with zero HTTP", async () => {
    for (const change of [{ enabled: false }, { hasKey: false }, { generation: "other" }, { computerEnabled: false },
      { computerEnabled: undefined, computerGeneration: undefined }, { computerEnabled: true, computerGeneration: undefined }, { computerGeneration: " " }]) {
      const options = deps({ readState: async () => hostState(change) }); const f = provider(options);
      expect((await f.offer.availability(ROOT)).ready).toBe(false);
      expect((await f.offer.choose(input())).status).toBe("skipped");
      expect(options.fetch).not.toHaveBeenCalled();
    }
    const options = deps(); delete options.env!.EXT_JEV_OPTIMIZER_APIKEY;
    const f = provider(options);
    expect(await f.offer.choose(input())).toEqual({ status: "skipped", reason: "no-key" });
    expect(options.fetch).not.toHaveBeenCalled();
    const other = provider();
    expect(await other.offer.availability("/synthetic")).toEqual({ ready: false, reason: "project-mismatch" });
    expect(await other.offer.choose(input({ projectRoot: "/other" }))).toEqual({ status: "skipped", reason: "project-mismatch" });
    const legacy = hostState({ computerEnabled: undefined, computerGeneration: undefined });
    expect(parseHostState(legacy)).toMatchObject({ computerEnabled: false, computerGeneration: undefined });
    expect((await checkBrowserAvailability(deps({ readState: async () => legacy }))).ready).toBe(true);
    expect((await checkAvailability(deps({ readState: async () => legacy }))).ready).toBe(true);
    const independent = provider(deps({ readState: async () => hostState({ browserEnabled: false, contextEnabled: false }) }));
    expect(await independent.offer.availability(ROOT)).toEqual({ ready: true, generation: "computer" });
  });

  it.each([false, undefined, "true", 1])("requires explicit desktop execution authority (%s) without affecting browser or code", async computerUseEnabled => {
    const raw = hostState({ computerUseEnabled });
    const options = deps({ readState: async () => raw });
    const f = provider(options);
    expect(parseHostState(raw)?.computerUseEnabled).toBe(false);
    expect(await f.offer.availability(ROOT)).toEqual({ ready: false, reason: "computer-execution-disabled" });
    expect(await f.offer.choose(input())).toEqual({ status: "skipped", reason: "computer-execution-disabled" });
    expect(options.fetch).not.toHaveBeenCalled();
    expect((await checkBrowserAvailability(options)).ready).toBe(true);
    expect((await checkAvailability(options)).ready).toBe(true);
  });

  it("bounds UTF-8 descriptions and JSON to 64 KiB without dropping any of 48 IDs or goal constraints", () => {
    const goal = "😀".repeat(500) + "最后不能删除";
    const value = input({ goal, candidates: Array.from({ length: 48 }, (_, i) => ({ id: `action-${i}`, description: `${'名😀\"'.repeat(600)}${KEY}` })) });
    const built = buildComputerChoicePayload(value, KEY);
    expect(built.status).toBe("ok"); if (built.status !== "ok") return;
    expect(Buffer.byteLength(built.json)).toBeLessThanOrEqual(65536);
    const body = JSON.parse(built.json);
    expect(body.state.goal).toBe(goal);
    expect(built.ids).toEqual(value.candidates.map(candidate => candidate.id));
    expect(Object.keys(body.questions.action.criteria)).toEqual(built.ids);
    expect(body.state.candidates).toHaveLength(48);
    expect(built.json).not.toContain(KEY.slice(0, 8));
    for (const { description } of body.state.candidates) expect(description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    expect(buildComputerChoicePayload(input({ candidates: [...value.candidates, { id: "overflow", description: "overflow" }] }), KEY)).toMatchObject({ status: "skipped" });
    expect(buildComputerChoicePayload(input({ goal: " ".repeat(70_000) + "end" }), KEY)).toEqual({ status: "skipped", reason: "budget" });
    expect(buildComputerChoicePayload(input({ goal: "😀".repeat(513) }), KEY)).toEqual({ status: "skipped", reason: "invalid-goal" });
  });

  it("keeps generated control IDs despite overlapping local input values and redacts only their text", async () => {
    const redactions = ["on", "off", "finish"];
    const ids = ["operation_1", "handoff", "finish"];
    const value = input({
      goal: `on off finish ${KEY}`,
      redactions,
      candidates: ids.map((id, i) => ({ id, description: `${redactions[i]} ${KEY}` })),
      history: [{ operation: "on off", outcome: `finish ${KEY}` }],
    });
    Object.assign(value, { value: "on", inputs: [{ value: "off" }] });
    for (const candidate of value.candidates) Object.assign(candidate, { value: "finish" });
    for (const choice of ids) {
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init!.body));
        expect(Object.keys(body.state).sort()).toEqual(["candidates", "goal", "history"]);
        expect(body.state.goal).toBe("<redacted> <redacted> <redacted> <redacted>");
        expect(body.state.candidates).toEqual(ids.map(id => ({ id, description: "<redacted> <redacted>" })));
        expect(body.state.history).toEqual([{ operation: "<redacted> <redacted>", outcome: "<redacted> <redacted>" }]);
        expect(body.questions.action.criteria).toEqual(Object.fromEntries(ids.map(id => [id, "<redacted> <redacted>"])));
        expect(String(init!.body)).not.toContain(KEY);
        expect(String(init!.body)).not.toMatch(/"(?:redactions|value|inputs)":/);
        return new Response(JSON.stringify(response(body, choice)));
      });
      expect(await provider(deps({ fetch })).offer.choose(value)).toMatchObject({ status: "applied", candidateId: choice });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("still rejects API keys and recognizable credential fragments in control IDs", async () => {
    for (const id of [KEY, KEY.slice(0, 8), KEY.slice(-8)]) {
      const options = deps();
      expect(await provider(options).offer.choose(input({ candidates: [{ id, description: "Click" }] }))).toEqual({ status: "skipped", reason: "secret" });
      expect(options.fetch).not.toHaveBeenCalled();
    }
  });

  it("fully redacts before clipping and rejects already-clipped secret fragments in every text field", async () => {
    const value = "synthetic-input-redaction-value";
    const built = buildComputerChoicePayload(input({ goal: `Find ${value}`, redactions: [value], candidates: [{ id: "click", description: `${"n".repeat(1000)}${KEY}${value}` }] }), KEY);
    expect(built.status).toBe("ok");
    if (built.status === "ok") { expect(built.json).not.toContain(KEY.slice(0, 8)); expect(built.json).not.toContain(value.slice(0, 8)); }
    const overlapping = buildComputerChoicePayload(input({ goal: "123456789abcdef", redactions: ["123456789", "789abcdef"] }), KEY);
    expect(overlapping.status).toBe("ok");
    if (overlapping.status === "ok") expect(JSON.parse(overlapping.json).state.goal).toBe("<redacted>");
    const short = buildComputerChoicePayload(input({ goal: "red", redactions: ["red"] }), KEY);
    expect(short.status).toBe("ok");
    if (short.status === "ok") expect(JSON.parse(short.json).state.goal).toBe("<redacted>");
    for (const secret of [KEY, value, "秘密字符内容不应上传到云端"])
      for (const fragment of [Array.from(secret).slice(0, 8).join("") + "…", Array.from(secret).slice(-8).join("")])
        for (const field of ["goal", "description", "operation", "outcome"]) {
          const current = input({ redactions: [value, "秘密字符内容不应上传到云端"] });
          if (field === "goal") current.goal = fragment;
          if (field === "description") current.candidates[0]!.description = fragment;
          if (field === "operation" || field === "outcome") current.history = [{ operation: "click", outcome: "observed", [field]: fragment }];
          const options = deps();
          const outcome = await provider(options).offer.choose(current);
          expect(outcome.status).toBe("skipped"); expect(outcome.candidateId).toBeUndefined();
          expect(options.fetch).not.toHaveBeenCalled();
        }
  });

  it("rejects oversized local redactions and source descriptions before any HTTP", async () => {
    const cases: Array<{ over: Partial<ComputerChoiceInput>; reason: string }> = [
      { over: { redactions: Array(2049).fill("") }, reason: "redaction-budget" },
      { over: { redactions: ["x".repeat(4 * 1024 * 1024)] }, reason: "redaction-budget" },
      { over: { redactions: ["界".repeat(21_846)] }, reason: "redaction-budget" },
      // The credential counts toward the deduplicated 64 KiB secret budget.
      { over: { redactions: ["x".repeat(65536)] }, reason: "redaction-budget" },
      { over: { redactions: ["x".repeat(32768), "y".repeat(32768)] }, reason: "redaction-budget" },
      { over: { candidates: [{ id: "click", description: "x".repeat(4 * 1024 * 1024) }] }, reason: "budget" },
      { over: { candidates: [{ id: "click", description: "界".repeat(21_846) }] }, reason: "budget" },
      { over: { candidates: Array.from({ length: 5 }, (_, i) => ({ id: `click-${i}`, description: "x".repeat(65536) })) }, reason: "budget" },
    ];
    for (const { over, reason } of cases) {
      const options = deps();
      // A fragment in goal must not be inspected before these cheap input budgets.
      expect(await provider(options).offer.choose(input({ goal: KEY.slice(0, 8), ...over }))).toEqual({ status: "skipped", reason });
      expect(options.fetch).not.toHaveBeenCalled();
    }
  });

  it("checks raw redaction count before inspecting its entries", async () => {
    const redactions = Array(2049).fill("");
    const inspect = vi.fn(() => { throw Error("must not inspect oversized array"); });
    Object.defineProperty(redactions, 0, { get: inspect });
    const options = deps();
    expect(await provider(options).offer.choose(input({ redactions }))).toEqual({ status: "skipped", reason: "redaction-budget" });
    expect(inspect).not.toHaveBeenCalled(); expect(options.fetch).not.toHaveBeenCalled();
  });

  it("accepts and fully redacts ordinary 32 KiB inputs after deduplication", async () => {
    const value = "界".repeat(10_922) + "ab";
    expect(Buffer.byteLength(value)).toBe(32768);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(body.state.candidates[0].description).toBe("Fill <redacted>");
      expect(String(init!.body)).not.toContain(value);
      expect(String(init!.body)).not.toContain("redactions");
      return new Response(JSON.stringify(response(body)));
    });
    const current = input({ redactions: Array(2048).fill(value), candidates: [{ id: "fill", description: `Fill ${value}` }] });
    expect(await provider(deps({ fetch })).offer.choose(current)).toMatchObject({ status: "applied", candidateId: "fill" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(buildComputerChoicePayload(input({ redactions: Array(2048).fill(value) }), KEY).status).toBe("ok");
    expect(buildComputerChoicePayload(input({ candidates: Array.from({ length: 4 }, (_, i) => ({ id: `click-${i}`, description: "x".repeat(65536) })) }), KEY).status).toBe("ok");
  });

  it("rejects malformed inputs without upload rather than silently selecting a smaller candidate pool", async () => {
    for (const over of [
      { candidates: [] }, { candidates: [input().candidates[0], input().candidates[0]] },
      { candidates: [{ id: "click", description: 1 }] }, { candidates: [{ id: "bad id", description: "Click" }] },
      { history: [{ operation: "click", outcome: 5 }] }, { coverage: { collected: -1, omitted: 0, truncated: false } },
      { redactions: [1] },
    ]) {
      const options = deps();
      expect((await provider(options).offer.choose(input(over as any))).status).toBe("skipped");
      expect(options.fetch).not.toHaveBeenCalled();
    }
  });

  it.each([
    { probabilities: [0.33, 0.33, 0.33], valid: true },
    { probabilities: [0.25, 0.25, 0.49], valid: true },
    { probabilities: [1 / 3, 1 / 3, 1 / 3], valid: true },
    // Closed rounding intervals include their endpoints: lower/upper sums equal 1.
    { probabilities: [0.50, 0.51], valid: true },
    { probabilities: [0.49, 0.50], valid: true },
    { probabilities: [0.1, 0.1, 0.1], valid: false },
    { probabilities: [0.331, 0.331, 0.331], valid: false },
    { probabilities: [0.32, 0.32, 0.32], valid: false },
    { probabilities: [0.34, 0.34, 0.34], valid: false },
  ])("validates exact mass or cent-rounded intervals: $probabilities → $valid", async ({ probabilities, valid }) => {
    const candidates = input().candidates.slice(0, probabilities.length);
    const choice = candidates[probabilities.indexOf(Math.max(...probabilities))]!.id;
    const fetch = vi.fn(reply(value => {
      value.answers.action.choice = choice;
      value.answers.action.probabilities = Object.fromEntries(candidates.map((candidate, i) => [candidate.id, probabilities[i]]));
    }));
    const outcome = await provider(deps({ fetch })).offer.choose(input({ candidates }));
    expect(outcome).toMatchObject(valid ? { status: "applied", candidateId: choice } : { status: "fallback", reason: "invalid-response" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still rejects a non-maximum choice when rounded probabilities have valid mass", async () => {
    const fetch = vi.fn(reply(value => {
      value.answers.action.probabilities = { "click-settings": 0.25, finish: 0.25, handoff: 0.49 };
    }));
    expect(await provider(deps({ fetch })).offer.choose(input())).toEqual({ status: "fallback", reason: "invalid-response" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("strictly validates the answer, exact candidate set, finite probabilities, confidence and duplicate JSON keys", async () => {
    for (const mutate of [
      (v: any) => { delete v.answers.action; }, (v: any) => { v.answers.extra = v.answers.action; },
      (v: any) => { v.diagnostic = "x".repeat(65536); },
      (v: any) => { v.answers.action.choice = "unknown"; }, (v: any) => { v.answers.action.type = "score"; },
      (v: any) => { v.answers.action.confidence = Infinity; }, (v: any) => { v.answers.action.confidence = -1; },
      (v: any) => { v.answers.action.probabilities["click-settings"] = "1"; },
      (v: any) => { v.answers.action.probabilities.extra = 0; }, (v: any) => { delete v.answers.action.probabilities.handoff; },
      (v: any) => { v.answers.action.probabilities["click-settings"] = 0.2; },
      (v: any) => { v.answers.action.probabilities["click-settings"] = 0.4; v.answers.action.probabilities.finish = 0.6; },
      (v: any) => { v.answers.action.probabilities["click-settings"] = 2; v.answers.action.probabilities.finish = -1; },
    ]) {
      const fetch = vi.fn(reply(mutate));
      expect(await provider(deps({ fetch })).offer.choose(input())).toEqual({ status: "fallback", reason: "invalid-response" });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    for (const raw of ["not json", '{"answers":{},"answers":{}}', '{"answers":{"action":{"choice":"finish","choi\\u0063e":"handoff"}}}']) {
      expect(await provider(deps({ fetch: async () => new Response(raw) })).offer.choose(input())).toEqual({ status: "fallback", reason: "invalid-response" });
    }
    const f = provider(deps({ fetch: reply(v => { v.model = `model-${KEY.slice(0, 8)}`; v.usage.input_tokens = -1; }) }));
    expect(await f.offer.choose(input())).toEqual({ status: "applied", candidateId: "click-settings" });
  });

  it("does not retry service failures or disclose server error text", async () => {
    for (const status of [401, 429, 503, 0]) {
      const fetch = vi.fn(async () => { if (!status) throw Error(KEY); return new Response(KEY, { status }); });
      const outcome = await provider(deps({ fetch })).offer.choose(input());
      expect(outcome.status).toBe("fallback"); expect(outcome.candidateId).toBeUndefined();
      expect(JSON.stringify(outcome)).not.toContain(KEY); expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("rechecks authority before upload and after HTTP; cancelled or rotated answers never apply", async () => {
    let reads = 0;
    const options = deps({ readState: async () => hostState({ computerEnabled: ++reads < 2 }) });
    expect((await provider(options).offer.choose(input())).status).toBe("skipped");
    expect(options.fetch).not.toHaveBeenCalled();
    for (const change of [{ computerEnabled: false }, { computerUseEnabled: false }, { computerGeneration: "new" }, { generation: "new" }, { hasKey: false }]) {
      let raw = hostState();
      const fetch = vi.fn(async (url: string, init?: RequestInit) => { raw = hostState(change); return reply()(url, init); });
      const outcome = await provider(deps({ readState: async () => raw, fetch })).offer.choose(input());
      expect(outcome.status).toBe("fallback"); expect(outcome.candidateId).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(1);
    }
    const ac = new AbortController(); ac.abort();
    const before = deps();
    expect(await provider(before).offer.choose(input({ signal: ac.signal }))).toEqual({ status: "skipped", reason: "aborted" });
    expect(before.fetch).not.toHaveBeenCalled();
    const rotated = deps(); rotated.fetch = async (url, init) => { rotated.env!.EXT_JEV_OPTIMIZER_APIKEY = "replacement-secret"; return reply()(url, init); };
    expect((await provider(rotated).offer.choose(input())).status).toBe("fallback");
  });

  it("aborts in-flight HTTP on cancellation/withdrawal and discards late responses", async () => {
    for (const action of ["cancel", "withdraw"]) {
      const ac = new AbortController(); let release!: (response: Response) => void; let request: RequestInit | undefined;
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => { request = init; return new Promise<Response>(resolve => { release = resolve; }); });
      const f = provider(deps({ fetch }));
      const pending = f.offer.choose(input({ signal: ac.signal }));
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      if (action === "cancel") ac.abort(); else f.handle.dispose();
      expect(await pending).toMatchObject({ status: "fallback", reason: action === "cancel" ? "aborted" : "withdrawn" });
      expect(request?.signal?.aborted).toBe(true);
      release(new Response(JSON.stringify(response(JSON.parse(String(request!.body))))));
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("bounds hung fetch, body and state work by the decision deadline", async () => {
    for (const over of [
      { fetch: async () => new Promise<Response>(() => {}) },
      { fetch: async () => ({ ok: true, text: async () => new Promise<string>(() => {}) }) as Response },
      { readState: async () => new Promise<string>(() => {}) },
    ]) expect(await provider(deps({ ...over, deadlineMs: 20 })).offer.choose(input())).toEqual({ status: "fallback", reason: "timeout" });
  });

  it("uses the real host state file: unrelated revokes preserve a pending desktop decision, desktop revoke aborts it", async () => {
    const root = await mkdtemp(join(tmpdir(), "jev-computer-provider-")); roots.push(root);
    const store = new JevRuntimeStateStore();
    const enabled = { enabled: true, hasKey: true, browserEnabled: true, contextEnabled: true, computerEnabled: true, computerUseEnabled: true };
    const snapshot = store.ensure(root, enabled);
    const options = deps({ env: { PIPIUI_JEV_STATE_FILE: snapshot.file, PIPIUI_JEV_GENERATION: snapshot.generation, EXT_JEV_OPTIMIZER_APIKEY: KEY }, readState: undefined, pollMs: 5 });
    const initial = await executeComputerChoiceAvailability(root, options);
    options.fetch = async (url, init) => { store.revokeBrowser(root); store.revokeContext(root); return reply()(url, init); };
    expect((await provider(options).offer.choose(input({ projectRoot: root }))).status).toBe("applied");
    expect(await executeComputerChoiceAvailability(root, options)).toEqual(initial);
    options.fetch = async (url, init) => { store.setComputerUseEnabled(false); store.setComputerUseEnabled(true); return reply()(url, init); };
    const rotated = await provider(options).offer.choose(input({ projectRoot: root }));
    expect(rotated.status).toBe("fallback");
    expect(rotated.candidateId).toBeUndefined();
    // Polling and the final availability check can win the same revocation race.
    expect(["computer-generation-mismatch", "generation-mismatch"]).toContain(rotated.reason);
    const currentState = JSON.parse(await readFile(snapshot.file, "utf8"));
    expect(currentState.generation).toBe(snapshot.generation);
    expect(currentState.computerGeneration).toEqual(expect.any(String));
    expect(currentState.computerGeneration).not.toBe(initial.generation);
    let signal: AbortSignal | null | undefined;
    options.fetch = async (_url, init) => { signal = init?.signal; store.revokeComputer(root); return new Promise<Response>(() => {}); };
    const outcome = await provider(options).offer.choose(input({ projectRoot: root }));
    expect(outcome).toEqual({ status: "fallback", reason: "generation-mismatch" }); expect(signal?.aborted).toBe(true);
    store.ensure(root, enabled);
    expect((await executeComputerChoiceAvailability(root, options)).generation).not.toBe(initial.generation);
  });
});
