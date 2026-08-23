import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FEATURES } from "../src/features.js";
import { assemblePiSpawn, resolveSpawnPaths } from "../src/spawn-assembly.js";
import {
  forceWebSearchFromSettings,
  installDeepSeekCitationCapture,
  mapChatCompletionsToResponses,
  mapDeepSeekCitations,
  mapResponsesToChatCompletions,
  mergeHostedWebSearch,
  rewriteChatCompletionsUrlToResponses,
  rewriteDeepSeekRequest,
} from "../../../resources/runtime/extensions/pipiui-deepseek-server-tools.ts";

const EXTENSION = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions/pipiui-deepseek-server-tools.ts"),
).href;

type Handler = (event: any, ctx: any) => unknown;

async function loadDeepSeekServerTools() {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
    registerProvider: vi.fn(),
  };
  const extension = (await import(`${EXTENSION}?t=${Date.now()}`)).default;
  extension(pi as never);
  return { handlers, pi };
}

function deepseekContext(overrides: Record<string, unknown> = {}) {
  return {
    model: {
      provider: "deepseek",
      api: "openai-completions",
      id: "deepseek-chat",
      name: "DeepSeek Chat",
      ...overrides,
    },
  };
}

function completionsPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: "hello" },
    ],
    tools: [
      { type: "function", function: { name: "bash", parameters: { type: "object" } } },
      { type: "function", function: { name: "web_search", parameters: { type: "object" } } },
      { type: "function", function: { name: "read", parameters: { type: "object" } } },
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

describe("pipiui-deepseek-server-tools", () => {
  it("is mounted by default next to the other hosted-search extensions", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "resources", "runtime");
    const path = join(root, "extensions", "pipiui-deepseek-server-tools.ts");
    expect(DEFAULT_FEATURES.deepseekServerTools).toBe(true);
    expect(resolveSpawnPaths(root).deepseekServerTools).toBe(path);
    expect(assemblePiSpawn({
      cwd: "/tmp/project",
      features: { deepseekServerTools: true },
      paths: { deepseekServerTools: path },
    }).args).toEqual(["-e", path]);
  });
  afterEach(() => {
    delete process.env.PIPIUI_DEEPSEEK_FORCE_WEB_SEARCH;
  });

  it("injects hosted web_search and drops the client function of the same name", () => {
    const tools = mergeHostedWebSearch([
      { type: "function", function: { name: "bash", parameters: { type: "object" } } },
      { type: "function", name: "web_search", parameters: { type: "object" } },
      { type: "function", function: { name: "read", parameters: { type: "object" } } },
    ]);
    expect(toolNames(tools)).toEqual(["bash", "read", "web_search"]);
    expect(tools).toEqual(expect.arrayContaining([{ type: "web_search" }]));
    expect(tools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function", name: "web_search" })]),
    );
  });

  it("maps Chat Completions history onto stateless Responses input items", () => {
    const mapped = mapChatCompletionsToResponses({
      model: "deepseek-chat",
      max_tokens: 4096,
      messages: [
        { role: "system", content: "Stay in the workspace." },
        { role: "user", content: "search then edit" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_search",
              type: "function",
              function: { name: "web_search", arguments: "{\"query\":\"pipiui\"}" },
            },
            {
              id: "call_bash",
              type: "function",
              function: { name: "bash", arguments: "{\"command\":\"ls\"}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_bash", content: "ok" },
        {
          type: "web_search_call",
          id: "ws_replay",
          status: "completed",
          action: { type: "search" },
        },
      ],
    });

    expect(mapped).not.toHaveProperty("messages");
    expect(mapped.instructions).toBe("Stay in the workspace.");
    expect(mapped.max_output_tokens).toBe(4096);
    expect(mapped.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "search then edit" }],
      },
      {
        type: "web_search_call",
        id: "call_search",
        status: "completed",
        action: { type: "search", query: "pipiui" },
      },
      {
        type: "function_call",
        call_id: "call_bash",
        name: "bash",
        arguments: "{\"command\":\"ls\"}",
      },
      {
        type: "function_call_output",
        call_id: "call_bash",
        output: "ok",
      },
      {
        type: "web_search_call",
        id: "ws_replay",
        status: "completed",
        action: { type: "search" },
      },
    ]);
  });

  it("maps DeepSeek search results and url_citation annotations onto pi citations", () => {
    const citations = mapDeepSeekCitations({
      id: "resp_1",
      object: "response",
      output: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: {
            type: "search",
            sources: [{ url: "https://docs.example/a", title: "Docs A" }],
          },
        },
        {
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "See the docs.",
            annotations: [{
              type: "url_citation",
              url: "https://docs.example/b",
              title: "Docs B",
              start_index: 0,
              end_index: 12,
            }],
          }],
        },
      ],
    });

    expect(citations).toEqual([
      { url: "https://docs.example/a", title: "Docs A" },
      { url: "https://docs.example/b", title: "Docs B", startIndex: 0, endIndex: 12, type: "url_citation" },
    ]);
  });

  it("rewrites a Completions request into Responses with optional forced tool_choice", () => {
    const result = rewriteDeepSeekRequest(completionsPayload(), { forceWebSearch: true });
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("messages");
    expect(Array.isArray(result?.input)).toBe(true);
    expect(result?.instructions).toBe("You are a coding agent.");
    expect(toolNames(result?.tools)).toEqual(["bash", "read", "web_search"]);
    expect(result?.tool_choice).toEqual({ type: "web_search" });
    expect(forceWebSearchFromSettings({ "ext.deepseek.forceWebSearch": true })).toBe(true);
  });

  it("maps a Responses body back to Chat Completions plus citations", () => {
    const mapped = mapResponsesToChatCompletions({
      id: "resp_2",
      object: "response",
      model: "deepseek-chat",
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "bash",
          arguments: "{\"command\":\"pwd\"}",
        },
        {
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "done [[1]](https://docs.example/c)",
          }],
        },
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens: 6,
        total_tokens: 16,
      },
    });

    expect(mapped?.choices?.[0]?.message).toMatchObject({
      role: "assistant",
      content: "done [[1]](https://docs.example/c)",
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "bash", arguments: "{\"command\":\"pwd\"}" },
      }],
    });
    expect(mapped?.choices?.[0]?.message.citations).toEqual([
      { url: "https://docs.example/c", type: "url_citation" },
    ]);
    expect(mapped?.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 6,
      total_tokens: 16,
      prompt_tokens_details: { cached_tokens: 4 },
    });
  });

  it("rewrites deepseek Completions through the extension hook and leaves other providers alone", async () => {
    const { handlers } = await loadDeepSeekServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const result = beforeRequest?.(
      { type: "before_provider_request", payload: completionsPayload() },
      deepseekContext(),
    ) as Record<string, unknown> | undefined;

    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("messages");
    expect(toolNames(result?.tools)).toEqual(["bash", "read", "web_search"]);
    expect(result?.tools).toEqual(expect.arrayContaining([{ type: "web_search" }]));

    const openaiPayload = completionsPayload();
    expect(
      beforeRequest?.(
        { type: "before_provider_request", payload: openaiPayload },
        { model: { provider: "openai", api: "openai-completions", id: "gpt-4.1" } },
      ),
    ).toBeUndefined();
  });

  it("forces tool_choice from ext.deepseek.forceWebSearch and advertises hosted search", async () => {
    const { handlers } = await loadDeepSeekServerTools();
    const beforeRequest = handlers.get("before_provider_request")?.[0];
    const beforeStart = handlers.get("before_agent_start")?.[0];
    const forced = beforeRequest?.(
      { type: "before_provider_request", payload: { model: "deepseek-chat", input: [{ role: "user", content: "hi" }] } },
      { ...deepseekContext({ api: "openai-responses" }), settings: { "ext.deepseek.forceWebSearch": true } },
    ) as Record<string, unknown> | undefined;

    expect(forced?.tool_choice).toEqual({ type: "web_search" });
    expect(forced?.tools).toEqual(expect.arrayContaining([{ type: "web_search" }]));

    const prompt = beforeStart?.(
      { type: "before_agent_start", systemPrompt: "You are a coding agent." },
      deepseekContext(),
    ) as { systemPrompt?: string } | undefined;
    expect(prompt?.systemPrompt).toContain("## DeepSeek server tools");
    expect(prompt?.systemPrompt).toContain("hosted search");
  });

  it("rewrites /chat/completions transport URLs onto /responses", () => {
    expect(rewriteChatCompletionsUrlToResponses("https://api.deepseek.com/chat/completions")).toBe(
      "https://api.deepseek.com/responses",
    );
    expect(rewriteChatCompletionsUrlToResponses("https://relay.example/deepseek/chat/completions")).toBe(
      "https://relay.example/deepseek/responses",
    );
    expect(rewriteChatCompletionsUrlToResponses("https://api.deepseek.com/responses")).toBeUndefined();
  });

  it("maps pi image parts onto Responses input_image", () => {
    const mapped = mapChatCompletionsToResponses({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
      }],
    });
    expect(mapped.input).toEqual([{
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "look" },
        { type: "input_image", image_url: "data:image/png;base64,abc" },
      ],
    }]);
  });

  it("remaps every deepseek catalog model onto openai-responses at session_start", async () => {
    const { handlers, pi } = await loadDeepSeekServerTools();
    const sessionStart = handlers.get("session_start")?.[0];
    await sessionStart?.(
      { type: "session_start" },
      {
        modelRegistry: {
          getProvider: (id: string) => {
            if (id !== "deepseek") return undefined;
            return {
              getModels: () => [
                { id: "deepseek-v4-flash", api: "openai-completions", provider: "deepseek" },
                { id: "deepseek-v4-flash-vision-exp", api: "openai-responses", provider: "deepseek" },
              ],
            };
          },
        },
      },
    );
    expect(pi.registerProvider).toHaveBeenCalledWith("deepseek", {
      api: "openai-responses",
      models: [
        { id: "deepseek-v4-flash", api: "openai-responses", provider: "deepseek" },
        { id: "deepseek-v4-flash-vision-exp", api: "openai-responses", provider: "deepseek" },
      ],
    });
  });

  it("hooks after_provider_response and fetch tee so citation mapping is live", async () => {
    const { handlers } = await loadDeepSeekServerTools();
    expect(handlers.get("after_provider_response")?.[0]).toBeTypeOf("function");
    expect(handlers.get("session_start")?.[0]).toBeTypeOf("function");

    const captured: Array<{ url: string }> = [];
    const target = {
      fetch: async () => new Response(JSON.stringify({
        object: "response",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "see [[1]](https://docs.example/live)" }],
        }],
      }), { headers: { "content-type": "application/json" } }),
    };
    const uninstall = installDeepSeekCitationCapture(target, (citations) => {
      captured.push(...citations);
    });
    try {
      await target.fetch("https://api.deepseek.com/responses");
      expect(captured).toEqual([{ url: "https://docs.example/live", type: "url_citation" }]);
    } finally {
      uninstall();
    }
  });
});
