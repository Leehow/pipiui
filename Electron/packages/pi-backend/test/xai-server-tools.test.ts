import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const EXTENSION = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions/pipiui-xai-server-tools.ts"),
).href;

type Handler = (event: any, ctx: any) => unknown;

async function loadXaiServerTools() {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
    registerProvider: vi.fn(),
  };
  const extension = (await import(EXTENSION)).default;
  extension(pi as never);
  return { handlers, pi };
}

function xaiResponsesContext(overrides: Record<string, unknown> = {}) {
  return {
    model: {
      provider: "xai",
      api: "openai-responses",
      id: "grok-4.6",
      name: "Grok 4.6",
      ...overrides,
    },
  };
}

function xaiCompletionsContext() {
  return {
    model: { provider: "xai", api: "openai-completions", id: "grok-4.6", name: "Grok 4.6" },
  };
}

function withSession(ctx: Record<string, unknown>, sessionId = "sess-grok-cache-1") {
  return {
    ...ctx,
    sessionManager: { getSessionId: () => sessionId },
  };
}

function responsesPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "grok-4.6",
    input: [{ role: "user", content: "hello" }],
    tools: [
      { type: "function", name: "bash", parameters: { type: "object" } },
      { type: "function", name: "web_search", parameters: { type: "object" } },
      { type: "function", name: "read", parameters: { type: "object" } },
    ],
    ...overrides,
  };
}

function completionsPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "grok-4.6",
    messages: [{ role: "user", content: "hello" }],
    tools: [
      { type: "function", function: { name: "bash", parameters: { type: "object" } } },
      { type: "function", function: { name: "web_search", parameters: { type: "object" } } },
    ],
    ...overrides,
  };
}

function toolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return "";
    const rec = tool as Record<string, unknown>;
    if (typeof rec.name === "string") return rec.name;
    if (rec.function && typeof rec.function === "object" && rec.function !== null && "name" in rec.function) {
      return String((rec.function as { name: unknown }).name);
    }
    return typeof rec.type === "string" ? rec.type : "";
  });
}

describe("pipiui-xai-server-tools", () => {
  it("injects hosted web_search on any xai Responses channel, including custom endpoints", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload({
      search_parameters: { mode: "auto" },
    });
    const result = beforeRequest?.(
      { type: "before_provider_request", payload },
      xaiResponsesContext({ id: "custom-grok", baseUrl: "https://relay.example/v1" }),
    ) as Record<string, unknown> | undefined;

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("search_parameters");
    expect(JSON.stringify(result)).not.toMatch(/search_parameters/);
    expect(toolNames(result?.tools)).toEqual(["bash", "read", "web_search"]);
    expect(result?.tools).toEqual(
      expect.arrayContaining([{ type: "web_search" }]),
    );
    expect(result?.tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function", name: "web_search" })]),
    );
  });

  it("keeps an explicit hosted web_search and does not duplicate it", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      {
        type: "before_provider_request",
        payload: responsesPayload({
          tools: [
            { type: "function", name: "bash" },
            { type: "web_search" },
            { type: "function", name: "web_search" },
          ],
        }),
      },
      xaiResponsesContext(),
    ) as Record<string, unknown> | undefined;

    const hosted = (result?.tools as unknown[]).filter(
      (tool) => tool && typeof tool === "object" && (tool as { type?: string }).type === "web_search",
    );
    expect(hosted).toEqual([{ type: "web_search" }]);
  });

  it("strips retired search_parameters and client web_search on leftover completions without injecting hosted tools", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = completionsPayload({ search_parameters: { mode: "auto" } });
    const result = beforeRequest?.(
      { type: "before_provider_request", payload },
      xaiCompletionsContext(),
    ) as Record<string, unknown> | undefined;

    expect(result).not.toHaveProperty("search_parameters");
    expect(toolNames(result?.tools)).toEqual(["bash"]);
    expect(result?.tools).not.toEqual(expect.arrayContaining([{ type: "web_search" }]));
  });

  it("advertises xAI hosted web_search in the system prompt for provider=xai", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeStart = handlers.get("before_agent_start")?.[0];
    const result = beforeStart?.(
      { type: "before_agent_start", systemPrompt: "You are a coding agent." },
      xaiResponsesContext(),
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain("## xAI server tools");
    expect(result?.systemPrompt).toContain("hosted Agent Tools");
    expect(result?.systemPrompt).not.toContain("Use client web_search");
  });

  it("leaves non-xAI payloads and prompts untouched", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const beforeStart = handlers.get("before_agent_start")?.[0];
    const payload = responsesPayload();
    const openaiCtx = { model: { provider: "openai", api: "openai-responses", id: "gpt-4.1" } };

    expect(beforeRequest?.({ type: "before_provider_request", payload }, openaiCtx)).toBeUndefined();
    expect(
      beforeStart?.(
        { type: "before_agent_start", systemPrompt: "You are a coding agent." },
        openaiCtx,
      ),
    ).toBeUndefined();
  });

  it("pins every xAI request to a stable x-grok-conv-id from the session", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeHeaders = handlers.get("before_provider_headers")?.[0];
    expect(beforeHeaders).toBeTypeOf("function");

    const sessionId = "e0d2432a-87fa-48a8-82b8-0eee12a9ed08";
    const headers: Record<string, string | null> = { Authorization: "Bearer x" };
    beforeHeaders?.(
      { type: "before_provider_headers", headers },
      withSession(xaiResponsesContext(), sessionId),
    );
    expect(headers["x-grok-conv-id"]).toBe(sessionId);
    expect(headers.Authorization).toBe("Bearer x");

    const completionsHeaders: Record<string, string | null> = {};
    beforeHeaders?.(
      { type: "before_provider_headers", headers: completionsHeaders },
      withSession(xaiCompletionsContext(), sessionId),
    );
    expect(completionsHeaders["x-grok-conv-id"]).toBe(sessionId);

    const openaiHeaders: Record<string, string | null> = {};
    beforeHeaders?.(
      { type: "before_provider_headers", headers: openaiHeaders },
      withSession({ model: { provider: "openai", api: "openai-responses", id: "gpt-4.1" } }, sessionId),
    );
    expect(openaiHeaders).not.toHaveProperty("x-grok-conv-id");
  });

  it("sets prompt_cache_key on xAI Responses to the same conversation id", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const sessionId = "pipiui-xai";
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload() },
      withSession(xaiResponsesContext(), sessionId),
    ) as Record<string, unknown> | undefined;

    expect(result?.prompt_cache_key).toBe(sessionId);
  });

  it("remaps every xai catalog model onto openai-responses at session_start", async () => {
    const { handlers, pi } = await loadXaiServerTools();
    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart?.(
      { type: "session_start" },
      {
        modelRegistry: {
          getProvider: (id: string) => {
            if (id !== "xai") return undefined;
            return {
              getModels: () => [
                { id: "grok-4.3", api: "openai-completions", provider: "xai", baseUrl: "https://relay.example/v1" },
                { id: "grok-4.5", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1" },
                { id: "custom-id", api: "openai-completions", provider: "xai", baseUrl: "https://relay.example/v1" },
              ],
            };
          },
        },
      },
    );

    expect(pi.registerProvider).toHaveBeenCalledWith("xai", {
      api: "openai-responses",
      models: [
        { id: "grok-4.3", api: "openai-responses", provider: "xai", baseUrl: "https://relay.example/v1" },
        { id: "grok-4.5", api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1" },
        { id: "custom-id", api: "openai-responses", provider: "xai", baseUrl: "https://relay.example/v1" },
      ],
    });
  });

  it("captures xAI rate-limit headers for the quota pill and throttles repeat writes", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pipiui-xai-quota-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const { handlers } = await loadXaiServerTools();
      const afterResponse = handlers.get("after_provider_response")?.[0];
      expect(afterResponse).toBeTypeOf("function");

      const headers = {
        "x-ratelimit-limit-requests": "8300",
        "x-ratelimit-remaining-requests": "6225",
        "x-ratelimit-limit-tokens": "53000000",
        "x-ratelimit-remaining-tokens": "47700000",
      };
      afterResponse?.({ type: "after_provider_response", status: 200, headers }, xaiCompletionsContext());

      const captured = JSON.parse(readFileSync(join(agentDir, "grok-rate-limits.json"), "utf8"));
      expect(captured).toMatchObject({
        limitRequests: 8300, remainingRequests: 6225,
        limitTokens: 53000000, remainingTokens: 47700000,
      });
      expect(captured.capturedAt).toBeGreaterThan(0);

      const firstWrite = captured.capturedAt;
      afterResponse?.(
        { type: "after_provider_response", status: 200, headers: { "x-ratelimit-limit-requests": "1", "x-ratelimit-remaining-requests": "1" } },
        xaiCompletionsContext(),
      );
      expect(JSON.parse(readFileSync(join(agentDir, "grok-rate-limits.json"), "utf8"))).toEqual(captured);
      expect(firstWrite).toBeGreaterThan(0);

      afterResponse?.(
        { type: "after_provider_response", status: 200, headers: { "x-ratelimit-limit-requests": "9", "x-ratelimit-remaining-requests": "9" } },
        { model: { provider: "openai", api: "openai-completions", id: "gpt-4.1" } },
      );
      expect(JSON.parse(readFileSync(join(agentDir, "grok-rate-limits.json"), "utf8"))).toEqual(captured);
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
