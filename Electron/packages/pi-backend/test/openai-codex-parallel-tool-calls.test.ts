import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const OPENAI_EXTENSION = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions/pipiui-openai-server-tools.ts"),
).href;
const CODEX_EXTENSION = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions/pipiui-codex-server-tools.ts"),
).href;

type Handler = (event: any, ctx: any) => unknown;

async function loadExtension(href: string) {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
  };
  const extension = (await import(href)).default;
  extension(pi as never);
  return { handlers };
}

function responsesPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "gpt-5.2",
    input: [{ role: "user", content: "hello" }],
    tools: [{ type: "function", name: "bash", parameters: { type: "object" } }],
    ...overrides,
  };
}

function toolTypes(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => (tool && typeof tool === "object" && "type" in tool ? String((tool as { type: unknown }).type) : ""));
}

describe("pipiui-openai-server-tools parallel_tool_calls", () => {
  it("enables parallel_tool_calls and keeps hosted web_search on official OpenAI Responses", async () => {
    const { handlers } = await loadExtension(OPENAI_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload();
    const result = beforeRequest?.(
      { type: "before_provider_request", payload },
      { model: { provider: "openai", api: "openai-responses", id: "gpt-5.2" } },
    ) as Record<string, unknown> | undefined;

    expect(result?.parallel_tool_calls).toBe(true);
    expect(toolTypes(result?.tools)).toContain("web_search");
    expect(toolTypes(result?.tools)).toContain("function");
  });

  it("is idempotent when parallel_tool_calls is already true", async () => {
    const { handlers } = await loadExtension(OPENAI_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload({ parallel_tool_calls: true }) },
      { model: { provider: "openai", api: "openai-responses", id: "gpt-5.2" } },
    ) as Record<string, unknown> | undefined;

    expect(result?.parallel_tool_calls).toBe(true);
  });

  it("respects an explicit parallel_tool_calls false", async () => {
    const { handlers } = await loadExtension(OPENAI_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload({ parallel_tool_calls: false }) },
      { model: { provider: "openai", api: "openai-responses", id: "gpt-5.2" } },
    ) as Record<string, unknown> | undefined;

    expect(result?.parallel_tool_calls).toBe(false);
    expect(toolTypes(result?.tools)).toContain("web_search");
  });

  it("does not inject for Anthropic, Google, xAI, unknown gateways, or OpenAI completions", async () => {
    const { handlers } = await loadExtension(OPENAI_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload();
    const models = [
      { provider: "anthropic", api: "anthropic-messages", id: "claude-sonnet-5" },
      { provider: "google", api: "google-generative-ai", id: "gemini-3-pro-preview" },
      { provider: "xai", api: "openai-completions", id: "grok-4.6" },
      { provider: "compatible-gateway", api: "openai-responses", id: "gpt-oss" },
      { provider: "openai", api: "openai-completions", id: "gpt-4.1" },
    ];

    for (const model of models) {
      expect(beforeRequest?.({ type: "before_provider_request", payload }, { model })).toBeUndefined();
    }
  });
});

describe("pipiui-codex-server-tools parallel_tool_calls", () => {
  it("enables parallel_tool_calls and keeps hosted web_search on Codex Responses", async () => {
    const { handlers } = await loadExtension(CODEX_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload({ model: "gpt-5.3-codex" }) },
      { model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex" } },
    ) as Record<string, unknown> | undefined;

    expect(result?.parallel_tool_calls).toBe(true);
    expect(toolTypes(result?.tools)).toContain("web_search");
    expect(toolTypes(result?.tools)).toContain("function");
  });

  it("is idempotent when upstream already set parallel_tool_calls true", async () => {
    const { handlers } = await loadExtension(CODEX_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      {
        type: "before_provider_request",
        payload: responsesPayload({ model: "gpt-5.3-codex", parallel_tool_calls: true }),
      },
      { model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex" } },
    ) as Record<string, unknown> | undefined;

    expect(result?.parallel_tool_calls).toBe(true);
  });

  it("respects an explicit parallel_tool_calls false", async () => {
    const { handlers } = await loadExtension(CODEX_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      {
        type: "before_provider_request",
        payload: responsesPayload({ model: "gpt-5.3-codex", parallel_tool_calls: false }),
      },
      { model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex" } },
    ) as Record<string, unknown> | undefined;

    expect(result?.parallel_tool_calls).toBe(false);
    expect(toolTypes(result?.tools)).toContain("web_search");
  });

  it("does not inject for non-codex providers even when payload looks like Responses", async () => {
    const { handlers } = await loadExtension(CODEX_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload();
    const snapshot = structuredClone(payload);
    const models = [
      { provider: "openai", api: "openai-responses", id: "gpt-5.2" },
      { provider: "anthropic", api: "anthropic-messages", id: "claude-sonnet-5" },
      { provider: "unknown", api: "openai-codex-responses", id: "proxy" },
    ];

    for (const model of models) {
      const event = { type: "before_provider_request", payload };
      expect(beforeRequest?.(event, { model })).toBeUndefined();
      expect(event.payload).toBe(payload);
      expect(payload).toEqual(snapshot);
    }
  });

  it("rejects compatible/proxy providers that only contain openai-codex", async () => {
    const { handlers } = await loadExtension(CODEX_EXTENSION);
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload({
      model: "gpt-5.3-codex",
      parallel_tool_calls: false,
      extra: { keep: true },
    });
    const snapshot = structuredClone(payload);
    const models = [
      { provider: "my-openai-codex-proxy", api: "openai-codex-responses", id: "gpt-5.3-codex" },
      { provider: "openai-codex-compatible", api: "openai-codex-responses", id: "gpt-5.3-codex" },
      { provider: "openai-codex-gateway", api: "openai-codex-responses", id: "gpt-5.3-codex" },
      { provider: "custom-openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex" },
    ];

    for (const model of models) {
      const event = { type: "before_provider_request", payload };
      expect(beforeRequest?.(event, { model })).toBeUndefined();
      expect(event.payload).toBe(payload);
      expect(payload).toEqual(snapshot);
      expect(payload.parallel_tool_calls).toBe(false);
      expect(payload.extra).toBe(event.payload.extra);
    }
  });
});
