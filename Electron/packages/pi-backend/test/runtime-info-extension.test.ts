import { describe, expect, it, vi } from "vitest";

const EXTENSION = "../../../resources/runtime/extensions/pipiui-runtime-info.ts";

type Handler = (event: any, ctx: any) => unknown;

async function loadRuntimeInfo() {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  let tool: any;
  const pi = {
    getActiveTools: vi.fn(() => ["read", "pipiui_runtime_info"]),
    getThinkingLevel: vi.fn(() => "xhigh"),
    getSessionName: vi.fn(() => "Current session"),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerTool: vi.fn((definition: any) => { tool = definition; }),
  };
  const extension = (await import(EXTENSION)).default;
  extension(pi as never);
  return { pi, tool, handlers };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/workspace/project",
    model: {
      provider: "xai",
      id: "grok-test",
      name: "Grok Test",
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: null,
      },
    },
    thinkingLevel: "xhigh",
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionName: () => "Current session",
    },
    getContextUsage: () => ({ tokens: 1200, contextWindow: 10000, percent: 12 }),
    ...overrides,
  };
}

function parseResult(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("pipiui_runtime_info extension", () => {
  it("reports live Pi state and authoritative supported thinking levels", async () => {
    const { tool } = await loadRuntimeInfo();
    const ctx = context();
    const first = parseResult(await tool.execute("call-1", {}, undefined, undefined, ctx));
    expect(first).toMatchObject({
      provider: "xai",
      model: { id: "grok-test", name: "Grok Test" },
      thinking: { current: "xhigh", supported: ["minimal", "low", "medium", "high", "xhigh"] },
      session: { id: "session-1", name: "Current session" },
      cwd: "/workspace/project",
      activeTools: ["read", "pipiui_runtime_info"],
      contextUsage: { tokens: 1200, contextWindow: 10000, percent: 12 },
      lastProviderRequest: { status: "not_observed" },
    });

    ctx.cwd = "/workspace/changed";
    ctx.sessionManager.getSessionId = () => "session-2";
    ctx.getContextUsage = () => ({ tokens: 2500, contextWindow: 10000, percent: 25 });
    const second = parseResult(await tool.execute("call-2", {}, undefined, undefined, ctx));
    expect(second).toMatchObject({
      cwd: "/workspace/changed",
      session: { id: "session-2" },
      contextUsage: { tokens: 2500, percent: 25 },
    });
  });

  it("observes only whitelisted fields from the final provider payload", async () => {
    const { handlers, tool } = await loadRuntimeInfo();
    const ctx = context();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    expect(beforeRequest).toBeTypeOf("function");
    await beforeRequest?.({
      type: "before_provider_request",
      payload: {
        reasoning_effort: "xhigh",
        messages: [{ role: "system", content: "SECRET SYSTEM PROMPT" }],
        tools: [{ name: "secret_tool" }],
        headers: { authorization: "Bearer SECRET" },
        apiKey: "SECRET KEY",
        baseUrl: "https://secret.invalid",
      },
    }, ctx);

    const result = await tool.execute("call", {}, undefined, undefined, ctx);
    const info = parseResult(result);
    expect(info.lastProviderRequest).toMatchObject({
      status: "observed",
      provider: "xai",
      model: "grok-test",
      thinkingLevel: "xhigh",
      serializedReasoning: { reasoning_effort: "xhigh" },
    });
    expect(info.lastProviderRequest.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.content[0].text).not.toMatch(/SECRET|messages|headers|apiKey|baseUrl|system prompt/i);
  });

  it("does not guess reasoning fields and clears evidence on every session start", async () => {
    const { handlers, tool } = await loadRuntimeInfo();
    const ctx = context();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const sessionStart = handlers.get("session_start")?.[0];
    await beforeRequest?.({ type: "before_provider_request", payload: { temperature: 0.2 } }, ctx);
    expect(parseResult(await tool.execute("call", {}, undefined, undefined, ctx)).lastProviderRequest)
      .toMatchObject({ status: "observed", serializedReasoning: { status: "not_observed" } });

    for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
      await sessionStart?.({ type: "session_start", reason }, ctx);
      expect(parseResult(await tool.execute("call", {}, undefined, undefined, ctx)).lastProviderRequest)
        .toEqual({ status: "not_observed" });
      await beforeRequest?.({ type: "before_provider_request", payload: { reasoning: { effort: "high" } } }, ctx);
    }
  });

  it("never exposes request evidence captured for a different live session", async () => {
    const { handlers, tool } = await loadRuntimeInfo();
    const firstSession = context();
    await handlers.get("before_provider_request")?.[0]?.(
      { type: "before_provider_request", payload: { reasoning_effort: "xhigh" } },
      firstSession,
    );
    const secondSession = context({
      sessionManager: {
        getSessionId: () => "session-2",
        getSessionName: () => "Other session",
      },
    });
    expect(parseResult(await tool.execute("call", {}, undefined, undefined, secondSession)).lastProviderRequest)
      .toEqual({ status: "not_observed" });
  });

  it("instructs the model to verify runtime questions with the tool first", async () => {
    const { tool } = await loadRuntimeInfo();
    expect(tool.parameters).toBeDefined();
    expect(JSON.stringify(tool.parameters)).not.toMatch(/provider|model|session|path/i);
    expect(`${tool.description}\n${tool.promptGuidelines.join("\n")}`).toMatch(/call.*first/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(/history|system prompt|PI_/i);
  });
});
