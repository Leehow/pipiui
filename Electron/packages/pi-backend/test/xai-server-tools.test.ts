import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uninstallHostedSearchCapture } from "../../../resources/runtime/extensions/hosted-search-events.ts";

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
  afterEach(() => {
    uninstallHostedSearchCapture();
  });

  it("installs Responses stream capture when native hosted search is on the wire", async () => {
    const originalFetch = globalThis.fetch;
    const { handlers } = await loadXaiServerTools();
    handlers.get("before_provider_request")?.[0]?.(
      { type: "before_provider_request", payload: responsesPayload() },
      xaiResponsesContext({ capabilities: { nativeSearch: { tools: ["web_search"] } } }),
    );
    expect(globalThis.fetch).not.toBe(originalFetch);
    uninstallHostedSearchCapture();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("does not inject hosted search for provider=xai without nativeSearch", async () => {
    const originalFetch = globalThis.fetch;
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
    expect(result?.tools).toEqual(payload.tools);
    expect(JSON.stringify(result?.tools)).not.toContain('"type":"web_search"');
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("injects hosted web_search when an xai catalog model declares nativeSearch", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload({ search_parameters: { mode: "auto" } }) },
      xaiResponsesContext({
        id: "custom-grok",
        baseUrl: "https://relay.example/v1",
        capabilities: { nativeSearch: { tools: ["web_search"] } },
      }),
    ) as Record<string, unknown> | undefined;

    expect(result).not.toHaveProperty("search_parameters");
    expect(toolNames(result?.tools)).toEqual(["bash", "read", "web_search"]);
    expect(result?.tools).toEqual(expect.arrayContaining([{ type: "web_search" }]));
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
      xaiResponsesContext({ capabilities: { nativeSearch: { tools: ["web_search"] } } }),
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
      {
        model: {
          provider: "xai",
          api: "openai-completions",
          id: "grok-4.6",
          name: "Grok 4.6",
          capabilities: { nativeSearch: { tools: ["web_search"] } },
        },
      },
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
      xaiResponsesContext({ capabilities: { nativeSearch: { tools: ["web_search"] } } }),
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

  it("injects declared hosted web_search and x_search for capability models, with domain policy", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      {
        type: "before_provider_request",
        payload: responsesPayload({
          tools: [
            { type: "function", name: "bash" },
            { type: "function", name: "web_search" },
            { type: "function", name: "image_gen" },
          ],
        }),
      },
      {
        model: {
          provider: "grok-build",
          api: "openai-responses",
          id: "grok-4.6",
          name: "Grok 4.6",
          capabilities: {
            nativeSearch: {
              tools: ["web_search", "x_search"],
              domains: { allow: ["docs.example"], deny: ["tracker.example"] },
            },
          },
        },
      },
    ) as Record<string, unknown> | undefined;

    expect(result?.tools).toEqual([
      { type: "function", name: "bash" },
      { type: "function", name: "image_gen" },
      {
        type: "web_search",
        filters: { allowed_domains: ["docs.example"], excluded_domains: ["tracker.example"] },
      },
      { type: "x_search" },
    ]);
  });

  it("does not hide generic web_search when only native x_search is declared", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload() },
      {
        model: {
          provider: "acme-chat",
          api: "openai-responses",
          id: "acme-x",
          capabilities: { nativeSearch: { tools: ["x_search"] } },
        },
      },
    ) as Record<string, unknown> | undefined;

    expect(toolNames(result?.tools)).toEqual(["bash", "web_search", "read", "x_search"]);
    expect(result?.tools).toEqual(expect.arrayContaining([{ type: "x_search" }]));
    expect(result?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function", name: "web_search" })]),
    );
  });

  it("injects hosted search from hostedTools and drops generic web_search without duplicating", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload() },
      {
        model: {
          provider: "acme-chat",
          api: "openai-responses",
          id: "acme-hosted",
          capabilities: { hostedTools: { tools: ["web_search", "x_search"] } },
        },
      },
    ) as Record<string, unknown> | undefined;

    expect(result?.tools).toEqual([
      { type: "function", name: "bash", parameters: { type: "object" } },
      { type: "function", name: "read", parameters: { type: "object" } },
      { type: "web_search" },
      { type: "x_search" },
    ]);
    expect(JSON.stringify(result?.tools).match(/"type":"web_search"/g)).toHaveLength(1);
    expect(JSON.stringify(result?.tools).match(/"type":"x_search"/g)).toHaveLength(1);
    expect(result).not.toHaveProperty("include");
  });

  it("does not hide or inject search for hostedTools code_interpreter only", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload() },
      {
        model: {
          provider: "acme-chat",
          api: "openai-responses",
          id: "acme-code",
          capabilities: { hostedTools: { tools: ["code_interpreter"] } },
        },
      },
    ) as Record<string, unknown> | undefined;

    expect(toolNames(result?.tools)).toEqual(["bash", "web_search", "read", "code_interpreter"]);
    expect(result?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function", name: "web_search" })]),
    );
    expect(JSON.stringify(result?.tools)).not.toContain('"type":"web_search"');
    expect(JSON.stringify(result?.tools)).not.toContain('"type":"x_search"');
    expect((result?.tools as unknown[]).filter(
      (tool) => tool && typeof tool === "object" && (tool as { type?: string }).type === "code_interpreter",
    )).toHaveLength(1);
    expect(result?.include).toEqual(["code_interpreter_call.outputs"]);
  });

  it("advertises declared hosted search tools for capability models", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeStart = handlers.get("before_agent_start")?.[0];
    const result = beforeStart?.(
      { type: "before_agent_start", systemPrompt: "You are a coding agent." },
      {
        model: {
          provider: "grok-build",
          api: "openai-responses",
          id: "grok-4.6",
          capabilities: { nativeSearch: { tools: ["web_search", "x_search"] } },
        },
      },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain("## Hosted search tools");
    expect(result?.systemPrompt).toContain("`x_search`");
    expect(result?.systemPrompt).toContain("`web_search`");
    expect(result?.systemPrompt).not.toContain("## xAI server tools");
  });

  it("injects hosted code_interpreter only when hostedTools declares it", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const on = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload() },
      {
        model: {
          provider: "grok-build",
          api: "openai-responses",
          id: "grok-4.6",
          capabilities: { hostedTools: { tools: ["web_search", "x_search", "code_interpreter"] }, nativeSearch: { tools: ["web_search", "x_search"] } },
        },
      },
    ) as Record<string, unknown> | undefined;
    expect(on?.tools).toEqual(expect.arrayContaining([
      { type: "web_search" },
      { type: "x_search" },
      { type: "code_interpreter" },
    ]));
    expect((on?.tools as unknown[]).filter((tool) => tool && typeof tool === "object" && (tool as { type?: string }).type === "code_interpreter")).toHaveLength(1);
    expect(on?.include).toEqual(["code_interpreter_call.outputs"]);
    const again = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload({ include: ["file_search_call.results", "code_interpreter_call.outputs"] }) },
      {
        model: {
          provider: "grok-build",
          api: "openai-responses",
          id: "grok-4.6",
          capabilities: { hostedTools: { tools: ["code_interpreter"] }, nativeSearch: { tools: ["web_search"] } },
        },
      },
    ) as Record<string, unknown> | undefined;
    expect(again?.include).toEqual(["file_search_call.results", "code_interpreter_call.outputs"]);

    const off = beforeRequest?.(
      { type: "before_provider_request", payload: responsesPayload() },
      {
        model: {
          provider: "grok-build",
          api: "openai-responses",
          id: "grok-4.6",
          capabilities: { hostedTools: { tools: ["web_search"] }, nativeSearch: { tools: ["web_search"] } },
        },
      },
    ) as Record<string, unknown> | undefined;
    expect(JSON.stringify(off?.tools)).not.toContain("code_interpreter");
    expect(off?.tools).toEqual(expect.arrayContaining([{ type: "web_search" }]));
  });

  it("leaves ordinary chat models without nativeSearch untouched", async () => {
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload();
    expect(
      beforeRequest?.(
        { type: "before_provider_request", payload },
        { model: { provider: "grok-build", api: "openai-responses", id: "grok-4.6" } },
      ),
    ).toBeUndefined();
  });

  it("installs Responses capture for live inputFiles without changing payload or tools", async () => {
    const originalFetch = globalThis.fetch;
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const payload = responsesPayload();
    const result = beforeRequest?.(
      { type: "before_provider_request", payload },
      {
        model: {
          provider: "grok-build",
          api: "openai-responses",
          id: "grok-4.6",
          capabilities: { inputFiles: true },
        },
      },
    );
    expect(result).toBeUndefined();
    expect(payload.tools).toEqual(responsesPayload().tools);
    expect(globalThis.fetch).not.toBe(originalFetch);
    uninstallHostedSearchCapture();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("does not install capture when inputFiles is not the live boolean true", async () => {
    const originalFetch = globalThis.fetch;
    const { handlers } = await loadXaiServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    expect(
      beforeRequest?.(
        { type: "before_provider_request", payload: responsesPayload() },
        {
          model: {
            provider: "grok-build",
            api: "openai-responses",
            id: "grok-4.6",
            capabilities: { inputFiles: { upload: true } },
          },
        },
      ),
    ).toBeUndefined();
    expect(globalThis.fetch).toBe(originalFetch);
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
