import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StructuredOutputController } from "../agent/structured-output-controller.js";
import {
  createStructuredOutputHooks,
  registerStructuredOutputHooks,
  takeStructuredOutputViaBridge,
} from "../agent/structured-output-hooks.js";
import {
  isPipiUIFatalHookError,
  type StructuredOutputRequest,
} from "../agent/structured-output.js";

type HookHandler = (...args: unknown[]) => unknown;
type MockPi = {
  registerProvider: (id: string, config: unknown) => void;
  registerCommand: (name: string, opts: unknown) => void;
  registerTool: (tool: unknown) => void;
  on: (event: string, handler: HookHandler) => void;
};

const ENV_KEYS = ["PIPIUI_BRIDGE_PORT", "PIPIUI_SESSION_CAPABILITY"];

function mockPi() {
  const providers = new Map<string, unknown>();
  const hooks = new Map<string, HookHandler[]>();
  const api: MockPi = {
    registerProvider: (id, config) => { providers.set(id, config); },
    registerCommand: () => undefined,
    registerTool: () => undefined,
    on: (event, handler) => {
      const list = hooks.get(event) ?? [];
      list.push(handler);
      hooks.set(event, list);
    },
  };
  return { api, providers, hooks };
}

function hook(hooks: Map<string, HookHandler[]>, event: string): HookHandler {
  const list = hooks.get(event) ?? [];
  const handler = list[list.length - 1];
  if (!handler) throw new Error(`missing ${event}`);
  return handler;
}

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
};

const request: StructuredOutputRequest = { name: "flag", schema, strict: true };

function grokCtx(sessionId: string, extras: { structuredOutputs?: boolean; api?: string } = {}) {
  return {
    model: {
      provider: "grok-build",
      id: "grok-4.6",
      api: extras.api ?? "openai-responses",
      capabilities: extras.structuredOutputs === false ? {} : { structuredOutputs: true },
    },
    sessionManager: { getSessionId: () => sessionId },
  };
}

function responsesPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "grok-4.6",
    stream: true,
    input: [{ role: "user", content: "summarize" }],
    tools: [{ type: "web_search" }, { type: "code_interpreter" }],
    include: ["code_interpreter_call.outputs"],
    ...overrides,
  };
}

describe("production structured-output hooks", () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function loadRegistered() {
    const mod = await import("../agent/index.js");
    const pi = mockPi();
    (mod.default as (api: MockPi) => void)(pi.api);
    return pi;
  }

  it("registers structured-output hooks on the grok-build extension", async () => {
    const pi = await loadRegistered();
    expect(pi.providers.has("grok-build")).toBe(true);
    expect(pi.hooks.has("before_provider_request")).toBe(true);
    expect(pi.hooks.has("after_provider_response")).toBe(true);
    expect(pi.hooks.has("session_start")).toBe(true);
    expect(pi.hooks.has("session_shutdown")).toBe(true);
  });

  it("injects text.format from the setter and consumes the one-shot", async () => {
    const controller = new StructuredOutputController();
    controller.set("sess-a", request);
    const hooks = createStructuredOutputHooks({ controller });
    const payload = responsesPayload();
    const next = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload },
      grokCtx("sess-a"),
    ) as Record<string, unknown>;
    expect(next.tools).toEqual(payload.tools);
    expect(next.include).toEqual(payload.include);
    expect(next.input).toEqual(payload.input);
    expect(next.text).toEqual({
      format: { type: "json_schema", name: "flag", schema, strict: true },
    });
    expect(JSON.stringify(next.tools)).not.toContain("json_schema");
    expect(controller.peek("sess-a")).toBeUndefined();

    const second = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    );
    expect(second).toBeUndefined();
  });

  it("preserves the applied format for provider recovery and consumes it after success", async () => {
    const controller = new StructuredOutputController();
    controller.set("sess-a", request);
    const hooks = createStructuredOutputHooks({ controller });
    const run = () => hooks.beforeProviderRequest({ payload: responsesPayload() }, grokCtx("sess-a"));
    const original = await run();
    expect(original?.text).toBeDefined();
    hooks.providerAttemptEnded("sess-a", true);
    expect(await run()).toEqual(original);
    hooks.providerAttemptEnded("sess-a", false);
    expect(await run()).toBeUndefined();
  });

  it("isolates sessions and clear() drops the next turn", async () => {
    const controller = new StructuredOutputController();
    controller.set("sess-a", request);
    controller.set("sess-b", { ...request, name: "other" });
    const hooks = createStructuredOutputHooks({ controller });
    const forA = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    ) as { text: { format: { name: string } } };
    expect(forA.text.format.name).toBe("flag");
    expect(controller.peek("sess-b")?.name).toBe("other");
    controller.set("sess-b", null);
    const forB = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-b"),
    );
    expect(forB).toBeUndefined();
  });

  it("session start/shutdown clear pending so it cannot leak", async () => {
    const controller = new StructuredOutputController();
    const pi = mockPi();
    registerStructuredOutputHooks(pi.api, { controller });
    controller.set("sess-a", request);
    await hook(pi.hooks, "session_start")();
    expect(controller.peek("sess-a")).toBeUndefined();
    controller.set("sess-a", request);
    await hook(pi.hooks, "session_shutdown")();
    expect(controller.peek("sess-a")).toBeUndefined();
  });

  it("fails closed on unsupported models and completions payloads", async () => {
    const controller = new StructuredOutputController();
    const hooks = createStructuredOutputHooks({ controller });
    controller.set("sess-a", request);
    await expect(
      hooks.beforeProviderRequest(
        { type: "before_provider_request", payload: responsesPayload() },
        grokCtx("sess-a", { structuredOutputs: false }),
      ),
    ).rejects.toThrow(/未声明 structuredOutputs/);
    controller.set("sess-a", request);
    await expect(
      hooks.beforeProviderRequest(
        {
          type: "before_provider_request",
          payload: { model: "grok-4.6", messages: [{ role: "user", content: "hi" }] },
        },
        grokCtx("sess-a"),
      ),
    ).rejects.toThrow(/responses/);
    controller.set("sess-a", request);
    await expect(
      hooks.beforeProviderRequest(
        { type: "before_provider_request", payload: responsesPayload() },
        grokCtx("sess-a", { api: "openai-completions" }),
      ),
    ).rejects.toThrow(/responses/);
  });

  it("tags take/normalize failures as fatal without leaking schema or secrets", async () => {
    process.env.PIPIUI_BRIDGE_PORT = "9";
    process.env.PIPIUI_SESSION_CAPABILITY = "cap-sess-a";
    const leak = /secret_schema|sk-live|file-abc|\/Users\/haoli|Bearer /;
    const hooks = createStructuredOutputHooks({
      takeRequest: async () => {
        throw new Error("ECONNREFUSED /Users/haoli/secret.json Bearer sk-live file-abc");
      },
    });
    const takeErr = await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    ).catch((error: unknown) => error);
    expect(isPipiUIFatalHookError(takeErr)).toBe(true);
    expect(String((takeErr as Error).message)).toMatch(/无法读取 Structured Output/);
    expect(String((takeErr as Error).message)).not.toMatch(leak);

    const invalid = createStructuredOutputHooks({
      takeRequest: async () => takeStructuredOutputViaBridge(async () => new Response("not-json", { status: 200 })),
    });
    const invalidErr = await invalid.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    ).catch((error: unknown) => error);
    expect(isPipiUIFatalHookError(invalidErr)).toBe(true);
    expect(String((invalidErr as Error).message)).toMatch(/无法读取 Structured Output/);

    const malformed = createStructuredOutputHooks({
      takeRequest: async () => takeStructuredOutputViaBridge(async () => new Response(JSON.stringify({
        ok: true,
        result: { name: "  ", schema: { secret_schema_field_xyz: true } },
      }), { status: 200 })),
    });
    const normalizeErr = await malformed.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    ).catch((error: unknown) => error);
    expect(isPipiUIFatalHookError(normalizeErr)).toBe(true);
    expect(String((normalizeErr as Error).message)).toMatch(/名称不能为空/);
    expect(String((normalizeErr as Error).message)).not.toMatch(leak);
  });

  it("does not invent after_provider_response normalization when the official event has no body", async () => {
    const seen: unknown[] = [];
    const hooks = createStructuredOutputHooks({
      onResult: (result) => { seen.push(result); },
    });
    await hooks.afterProviderResponse(
      { type: "after_provider_response", status: 200, headers: { "content-type": "text/event-stream" } },
      grokCtx("sess-a"),
    );
    expect(seen).toEqual([]);
  });

  it("normalizes only when a full Responses body is actually present", async () => {
    const seen: unknown[] = [];
    const controller = new StructuredOutputController();
    controller.set("sess-a", request);
    const hooks = createStructuredOutputHooks({
      controller,
      onResult: (result) => { seen.push(result); },
    });
    await hooks.beforeProviderRequest(
      { type: "before_provider_request", payload: responsesPayload() },
      grokCtx("sess-a"),
    );
    await hooks.afterProviderResponse(
      {
        type: "after_provider_response",
        status: 200,
        headers: {},
        body: { status: "completed", output_text: "{\"ok\":true}" },
      },
      grokCtx("sess-a"),
    );
    expect(seen).toEqual([
      { kind: "valid_json", name: "flag", value: { ok: true }, text: "{\"ok\":true}" },
    ]);
  });

  it("takes the host request over the session-scoped bridge", async () => {
    process.env.PIPIUI_BRIDGE_PORT = "9";
    process.env.PIPIUI_SESSION_CAPABILITY = "cap-sess-a";
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { event?: { op?: string }; sessionCapability?: string };
      expect(body.event).toMatchObject({ op: "claim", requestId: expect.any(String) });
      expect(body.sessionCapability).toBe("cap-sess-a");
      expect(JSON.stringify(body)).not.toContain("sess-forged");
      return new Response(JSON.stringify({
        ok: true,
        result: { name: "flag", schema, strict: true },
      }), { status: 200 });
    };
    const taken = await takeStructuredOutputViaBridge(fetchImpl);
    expect(taken).toEqual({ name: "flag", schema, strict: true });
  });
});
