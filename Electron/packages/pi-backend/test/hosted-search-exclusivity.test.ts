// Hosted-search exclusivity on the wire: every PipiUI server/hosted web-search
// adapter must remove the local generic search function tools (`web_search`,
// `browser_search`, `browser_fetch`) from the outgoing payload while keeping
// exactly one provider hosted search tool, every unrelated tool, and merely
// similar names (e.g. `web_search_preview`). Local function tools and provider
// hosted tools are distinguished by shape throughout.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uninstallHostedSearchCapture } from "../../../resources/runtime/extensions/hosted-search-events.ts";

const EXTENSIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../resources/runtime/extensions");

const EXTENSION_HREFS = {
  codex: pathToFileURL(join(EXTENSIONS, "pipiui-codex-server-tools.ts")).href,
  openai: pathToFileURL(join(EXTENSIONS, "pipiui-openai-server-tools.ts")).href,
  claude: pathToFileURL(join(EXTENSIONS, "pipiui-claude-server-tools.ts")).href,
  gemini: pathToFileURL(join(EXTENSIONS, "pipiui-gemini-server-tools.ts")).href,
  xai: pathToFileURL(join(EXTENSIONS, "pipiui-xai-server-tools.ts")).href,
  deepseek: pathToFileURL(join(EXTENSIONS, "pipiui-deepseek-server-tools.ts")).href,
};

type Handler = (event: any, ctx: any) => unknown;

async function loadExtension(href: string) {
  vi.resetModules();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn(),
    registerProvider: vi.fn(),
  };
  const extension = (await import(href)).default;
  extension(pi as never);
  return { handlers };
}

const LOCAL_SEARCH_NAMES = ["web_search", "browser_search", "browser_fetch"] as const;

/** Names of function tools (Responses flat shape) remaining in a tools array. */
function flatFunctionNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).type === "function")
    .map((tool) => (tool as Record<string, unknown>).name)
    .filter((name): name is string => typeof name === "string");
}

/** Names of Chat Completions nested function tools remaining in a tools array. */
function nestedFunctionNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => (tool && typeof tool === "object" ? (tool as Record<string, unknown>).function : undefined))
    .filter((fn) => fn && typeof fn === "object")
    .map((fn) => (fn as Record<string, unknown>).name)
    .filter((name): name is string => typeof name === "string");
}

function countHostedType(tools: unknown, type: string): number {
  if (!Array.isArray(tools)) return 0;
  return tools.filter((tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).type === type
    && !((tool as Record<string, unknown>).function && typeof (tool as Record<string, unknown>).function === "object")).length;
}

function runBeforeRequest(handlers: Map<string, Handler[]>, payload: unknown, ctx: unknown): Record<string, unknown> | undefined {
  return handlers.get("before_provider_request")?.[0]?.(
    { type: "before_provider_request", payload },
    ctx,
  ) as Record<string, unknown> | undefined;
}

describe("hosted-search exclusivity: pipiui-codex-server-tools", () => {
  const ctx = { model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex" } };

  it("removes local search function tools in every shape and emits exactly one hosted web_search", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.codex);
    const result = runBeforeRequest(handlers, {
      model: "gpt-5.3-codex",
      input: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", name: "web_search", parameters: { type: "object" } },
        { type: "function", function: { name: "browser_search", parameters: { type: "object" } } },
        { type: "function", name: "browser_fetch", parameters: { type: "object" } },
        { type: "function", name: "read", parameters: { type: "object" } },
        { type: "web_search_preview" },
        { type: "custom", name: "web_search" },
      ],
    }, ctx);

    const names = [...flatFunctionNames(result?.tools), ...nestedFunctionNames(result?.tools)];
    for (const local of LOCAL_SEARCH_NAMES) {
      expect(names.filter((name) => name === local)).toHaveLength(0);
    }
    expect(names).toContain("read");
    // Similar hosted/typed names are preserved, not confused with the hosted tool.
    expect(result?.tools).toContainEqual({ type: "web_search_preview" });
    expect(result?.tools).toContainEqual({ type: "custom", name: "web_search" });
    expect(countHostedType(result?.tools, "web_search")).toBe(1);
    expect(countHostedType(result?.tools, "web_search_preview")).toBe(1);
  });

  it("keeps an upstream hosted web_search exactly once without duplicating it", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.codex);
    const hosted = { type: "web_search", filters: { allowed_domains: ["docs.example"] } };
    const result = runBeforeRequest(handlers, {
      model: "gpt-5.3-codex",
      input: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", name: "web_search", parameters: { type: "object" } },
        hosted,
        { type: "web_search" },
      ],
    }, ctx);

    expect(countHostedType(result?.tools, "web_search")).toBe(1);
    // The upstream hosted entry (with its config) is preserved, not replaced by a bare copy.
    expect(result?.tools).toContainEqual(hosted);
    const names = [...flatFunctionNames(result?.tools), ...nestedFunctionNames(result?.tools)];
    expect(names).not.toContain("web_search");
  });

  it("is idempotent when run on its own output", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.codex);
    const once = runBeforeRequest(handlers, {
      model: "gpt-5.3-codex",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "web_search", parameters: { type: "object" } }],
    }, ctx);
    const twice = runBeforeRequest(handlers, once, ctx);
    expect(twice?.tools).toEqual(once?.tools);
    expect(countHostedType(twice?.tools, "web_search")).toBe(1);
  });
});

describe("hosted-search exclusivity: pipiui-openai-server-tools", () => {
  const ctx = { model: { provider: "openai", api: "openai-responses", id: "gpt-5.2" } };

  it("removes local search function tools in every shape and emits exactly one hosted web_search", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.openai);
    const result = runBeforeRequest(handlers, {
      model: "gpt-5.2",
      input: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", name: "web_search", parameters: { type: "object" } },
        { type: "function", function: { name: "browser_search", parameters: { type: "object" } } },
        { type: "function", name: "browser_fetch", parameters: { type: "object" } },
        { type: "function", name: "bash", parameters: { type: "object" } },
        { type: "web_search_preview" },
      ],
    }, ctx);

    const names = [...flatFunctionNames(result?.tools), ...nestedFunctionNames(result?.tools)];
    for (const local of LOCAL_SEARCH_NAMES) {
      expect(names.filter((name) => name === local)).toHaveLength(0);
    }
    expect(names).toContain("bash");
    expect(result?.tools).toContainEqual({ type: "web_search_preview" });
    expect(countHostedType(result?.tools, "web_search")).toBe(1);
  });

  it("collapses a hosted duplicate and drops the colliding local tool", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.openai);
    const result = runBeforeRequest(handlers, {
      model: "gpt-5.2",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "web_search" }, { type: "web_search" }],
    }, ctx);
    expect(result?.tools).toEqual([{ type: "web_search" }]);
  });
});

describe("hosted-search exclusivity: pipiui-claude-server-tools", () => {
  const ctx = { model: { provider: "anthropic", api: "anthropic-messages", id: "claude-sonnet-5" } };

  it("removes flat Messages function tools for all local search names and emits exactly one server tool", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.claude);
    const result = runBeforeRequest(handlers, {
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { name: "web_search", description: "local", input_schema: { type: "object" } },
        { name: "browser_search", description: "local", input_schema: { type: "object" } },
        { name: "browser_fetch", description: "local", input_schema: { type: "object" } },
        { name: "read", description: "local", input_schema: { type: "object" } },
        { name: "web_search_preview", description: "similar name only", input_schema: { type: "object" } },
        { type: "custom", name: "web_search" },
      ],
    }, ctx);

    const functionTools = (result?.tools as unknown[]).filter(
      (tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).type === undefined,
    );
    const names = functionTools.map((tool) => (tool as Record<string, unknown>).name);
    for (const local of LOCAL_SEARCH_NAMES) {
      expect(names.filter((name) => name === local)).toHaveLength(0);
    }
    expect(names).toContain("read");
    expect(names).toContain("web_search_preview");
    // Typed non-function tools are never stripped, even at the exact local names.
    expect(result?.tools).toContainEqual({ type: "custom", name: "web_search" });
    expect((result?.tools as unknown[]).filter(
      (tool) => tool && typeof tool === "object" && typeof (tool as Record<string, unknown>).type === "string"
        && String((tool as Record<string, unknown>).type).startsWith("web_search_"),
    )).toHaveLength(1);
  });

  it("preserves the Anthropic server tool even though its name is web_search", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.claude);
    const result = runBeforeRequest(handlers, {
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 8 },
        { name: "web_search", input_schema: { type: "object" } },
        { name: "browser_search", input_schema: { type: "object" } },
      ],
    }, ctx);

    expect(result?.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 8 }]);
  });

  it("collapses duplicate hosted web_search_* entries to the first configured instance", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.claude);
    const first = { type: "web_search_20250305", name: "web_search", max_uses: 4 };
    const result = runBeforeRequest(handlers, {
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        first,
        { type: "web_search_20250305", name: "web_search", max_uses: 8 },
        { type: "web_search_20241120", name: "web_search" },
        { name: "web_search", input_schema: { type: "object" } },
        { name: "read", input_schema: { type: "object" } },
      ],
    }, ctx);

    const hosted = (result?.tools as unknown[]).filter(
      (tool) => tool && typeof tool === "object" && typeof (tool as Record<string, unknown>).type === "string"
        && String((tool as Record<string, unknown>).type).startsWith("web_search_"),
    );
    expect(hosted).toEqual([first]);
    expect(result?.tools).toContainEqual({ name: "read", input_schema: { type: "object" } });
    const names = (result?.tools as unknown[])
      .filter((tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).type === undefined)
      .map((tool) => (tool as Record<string, unknown>).name);
    expect(names).toEqual(["read"]);
  });
});

describe("hosted-search exclusivity: pipiui-gemini-server-tools", () => {
  const ctx = { model: { provider: "google", api: "google-generative-ai", id: "gemini-3-pro" } };

  it("strips all local search declarations, keeps others, and emits exactly one google_search", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.gemini);
    const result = runBeforeRequest(handlers, {
      model: "gemini-3-pro",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [{
        functionDeclarations: [
          { name: "web_search", parameters: { type: "object" } },
          { name: "browser_search", parameters: { type: "object" } },
          { name: "browser_fetch", parameters: { type: "object" } },
          { name: "read", parameters: { type: "object" } },
          { name: "web_search_preview", parameters: { type: "object" } },
        ],
      }],
    }, ctx);

    const tools = result?.tools as unknown[];
    const declarations = tools.flatMap((tool) =>
      Array.isArray((tool as Record<string, unknown>).functionDeclarations)
        ? ((tool as Record<string, unknown>).functionDeclarations as Record<string, unknown>[])
        : []);
    const names = declarations.map((decl) => decl.name);
    for (const local of LOCAL_SEARCH_NAMES) {
      expect(names.filter((name) => name === local)).toHaveLength(0);
    }
    expect(names).toContain("read");
    expect(names).toContain("web_search_preview");
    expect(tools.filter((tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).google_search)).toHaveLength(1);
  });

  it("keeps an existing google_search exactly once and drops a tools element left empty by stripping", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.gemini);
    const result = runBeforeRequest(handlers, {
      model: "gemini-3-pro",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [
        { functionDeclarations: [{ name: "web_search" }, { name: "browser_search" }] },
        { google_search: {} },
      ],
    }, ctx);

    expect(result?.tools).toEqual([{ google_search: {} }]);
  });

  it("collapses duplicate google_search entries to the first configured instance", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.gemini);
    const configured = { google_search: { search_result_mode: "search_result_mode_static" } };
    const result = runBeforeRequest(handlers, {
      model: "gemini-3-pro",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [
        configured,
        { google_search: {} },
        { functionDeclarations: [{ name: "browser_fetch" }, { name: "read" }] },
      ],
    }, ctx);

    const googleSearchEntries = (result?.tools as unknown[]).filter(
      (tool) => tool && typeof tool === "object" && (tool as Record<string, unknown>).google_search !== undefined,
    );
    expect(googleSearchEntries).toEqual([configured]);
    // Non-search declarations survive the duplicate collapse untouched.
    expect(result?.tools).toContainEqual({ functionDeclarations: [{ name: "read" }] });
  });
});

describe("hosted-search exclusivity: pipiui-xai-server-tools", () => {
  afterEach(() => {
    uninstallHostedSearchCapture();
  });

  const responsesCtx = (capabilities: unknown) => ({
    model: {
      provider: "xai",
      api: "openai-responses",
      id: "grok-4.6",
      capabilities,
    },
  });

  it("drops every local search function tool only when effective web_search is declared", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.xai);
    const result = runBeforeRequest(handlers, {
      model: "grok-4.6",
      input: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", name: "web_search", parameters: { type: "object" } },
        { type: "function", name: "browser_search", parameters: { type: "object" } },
        { type: "function", name: "browser_fetch", parameters: { type: "object" } },
        { type: "function", name: "read", parameters: { type: "object" } },
      ],
    }, responsesCtx({ nativeSearch: { tools: ["web_search"] } }));

    const names = flatFunctionNames(result?.tools);
    for (const local of LOCAL_SEARCH_NAMES) {
      expect(names.filter((name) => name === local)).toHaveLength(0);
    }
    expect(names).toContain("read");
    expect(countHostedType(result?.tools, "web_search")).toBe(1);
  });

  it("hides the same local tools when only the hostedTools web_search slice is declared", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.xai);
    const result = runBeforeRequest(handlers, {
      model: "grok-4.6",
      input: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", name: "browser_search", parameters: { type: "object" } },
        { type: "function", name: "read", parameters: { type: "object" } },
      ],
    }, responsesCtx({ hostedTools: { tools: ["web_search"] } }));

    expect(flatFunctionNames(result?.tools)).toEqual(["read"]);
    expect(countHostedType(result?.tools, "web_search")).toBe(1);
  });

  it("keeps every local search tool (including generic web_search) for x_search-only capabilities", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.xai);
    const tools = [
      { type: "function", name: "web_search", parameters: { type: "object" } },
      { type: "function", name: "browser_search", parameters: { type: "object" } },
      { type: "function", name: "browser_fetch", parameters: { type: "object" } },
    ];
    const result = runBeforeRequest(handlers, {
      model: "grok-4.6",
      input: [{ role: "user", content: "hello" }],
      tools: [...tools],
    }, responsesCtx({ nativeSearch: { tools: ["x_search"] } }));

    expect(flatFunctionNames(result?.tools)).toEqual(["web_search", "browser_search", "browser_fetch"]);
    expect(countHostedType(result?.tools, "x_search")).toBe(1);
    expect(countHostedType(result?.tools, "web_search")).toBe(0);
  });

  it("strips nested Completions function tools on the legacy completions path", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.xai);
    const result = runBeforeRequest(handlers, {
      model: "grok-4.6",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", function: { name: "web_search", parameters: { type: "object" } } },
        { type: "function", function: { name: "browser_search", parameters: { type: "object" } } },
        { type: "function", function: { name: "browser_fetch", parameters: { type: "object" } } },
        { type: "function", function: { name: "bash", parameters: { type: "object" } } },
      ],
    }, responsesCtx({ nativeSearch: { tools: ["web_search"] } }));

    expect(nestedFunctionNames(result?.tools)).toEqual(["bash"]);
    // Legacy completions never gets hosted tools injected.
    expect(countHostedType(result?.tools, "web_search")).toBe(0);
  });
});

describe("hosted-search exclusivity: pipiui-deepseek-server-tools", () => {
  const ctx = { model: { provider: "deepseek", api: "openai-completions", id: "deepseek-chat" } };

  it("strips all local search function tools through the request rewrite and emits exactly one hosted web_search", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.deepseek);
    const result = runBeforeRequest(handlers, {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        { type: "function", function: { name: "web_search", parameters: { type: "object" } } },
        { type: "function", name: "browser_search", parameters: { type: "object" } },
        { type: "function", function: { name: "browser_fetch", parameters: { type: "object" } } },
        { type: "function", function: { name: "bash", parameters: { type: "object" } } },
        { type: "custom", name: "web_search" },
      ],
    }, ctx);

    const names = [...flatFunctionNames(result?.tools), ...nestedFunctionNames(result?.tools)];
    for (const local of LOCAL_SEARCH_NAMES) {
      expect(names.filter((name) => name === local)).toHaveLength(0);
    }
    expect(names).toContain("bash");
    expect(result?.tools).toContainEqual({ type: "custom", name: "web_search" });
    expect(countHostedType(result?.tools, "web_search")).toBe(1);
  });

  it("collapses duplicate hosted entries and is idempotent", async () => {
    const { handlers } = await loadExtension(EXTENSION_HREFS.deepseek);
    const once = runBeforeRequest(handlers, {
      model: "deepseek-chat",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "web_search" }, { type: "web_search" }],
    }, ctx);
    expect(countHostedType(once?.tools, "web_search")).toBe(1);
    const twice = runBeforeRequest(handlers, once, ctx);
    expect(twice?.tools).toEqual(once?.tools);
    expect(countHostedType(twice?.tools, "web_search")).toBe(1);
  });
});
