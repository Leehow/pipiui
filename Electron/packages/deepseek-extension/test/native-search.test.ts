import { describe, expect, it } from "vitest";
import agent from "../agent/index.js";
import {
  applyThinkingCap,
  buildResponsesBody,
  DEEPSEEK_WEB_SEARCH_BUILTIN,
  mergeHostedWebSearchTool,
  responsesUrl,
  THINKING_CAP_DIRECTIVE,
} from "../agent/client.js";
import { DEEPSEEK_CURATED_MODELS, modelSupportsHostedWebSearch } from "../agent/models.js";

function clientWebSearchTool() {
  return { type: "function", name: "web_search", description: "local search", parameters: { type: "object" } };
}

function browserSearchTool(name: string) {
  return { type: "function", name, description: "local browser route", parameters: { type: "object" } };
}

function nestedFunctionTool(name: string) {
  return { type: "function", function: { name, parameters: { type: "object" } } };
}

function responsesBodyWithTools() {
  return buildResponsesBody({
    model: "deepseek-v4-flash",
    input: [{ role: "user", content: "搜一下 DeepSeek V4" }],
    extra: {
      tools: [
        { type: "function", function: { name: "bash", parameters: { type: "object" } } },
        clientWebSearchTool(),
        { type: "function", function: { name: "read", parameters: { type: "object" } } },
      ],
    },
  }) as { tools: unknown[]; [key: string]: unknown };
}

function toolSummaries(tools: unknown[]): string[] {
  return tools.map((tool) => {
    const record = tool as Record<string, unknown>;
    if (record.type === "function") {
      const fn = record.function as { name?: unknown } | undefined;
      return typeof fn?.name === "string" ? `function:${fn.name}` : `function:${String(record.name)}`;
    }
    return String(record.type);
  });
}

describe("DeepSeek Extended server-native web_search", () => {
  it("sends conversation model requests to the /responses endpoint", () => {
    expect(responsesUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/responses");
  });

  it("derives hosted web_search support from declared model capabilities only", () => {
    expect(modelSupportsHostedWebSearch("deepseek-flash")).toBe(true);
    expect(modelSupportsHostedWebSearch("deepseek-v4-pro")).toBe(true);
    // Retired aliases keep curated metadata, so they answer from it too.
    expect(modelSupportsHostedWebSearch("deepseek-v4-flash")).toBe(true);
    expect(modelSupportsHostedWebSearch("deepseek-v4-flash-vision-exp")).toBe(true);
    // Curated ids are exact, never prefixes: an unlisted neighbour is unknown.
    expect(modelSupportsHostedWebSearch("deepseek-flash-preview")).toBe(false);
    // A live catalog overrides the curated default, so a model discovered at
    // runtime answers from what was actually registered.
    expect(
      modelSupportsHostedWebSearch("deepseek-v9-experimental", [
        { ...DEEPSEEK_CURATED_MODELS[0]!, id: "deepseek-v9-experimental" },
      ]),
    ).toBe(true);
    // Not our catalog: reserved official provider ids never inherit the capability.
    expect(modelSupportsHostedWebSearch("deepseek-chat")).toBe(false);
    expect(modelSupportsHostedWebSearch("deepseek-reasoner")).toBe(false);
    expect(modelSupportsHostedWebSearch("totally-unknown")).toBe(false);
    expect(modelSupportsHostedWebSearch(undefined)).toBe(false);
    expect(modelSupportsHostedWebSearch(42)).toBe(false);
  });

  it("injects exactly one built-in {type:\"web_search\"} and keeps every other tool", () => {
    const body = responsesBodyWithTools();
    const next = mergeHostedWebSearchTool(body, true) as typeof body;
    expect(toolSummaries(next.tools)).toEqual([
      "function:bash",
      "function:read",
      "web_search",
    ]);
    expect(next.tools.filter((tool) => (tool as Record<string, unknown>).type === "web_search")).toHaveLength(1);
    expect(next.tools.at(-1)).toEqual({ type: "web_search" });
    expect(JSON.stringify(next.tools)).not.toContain("\"web_search\",\"function\"");
    expect(next.tools).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "web_search" })]));
  });

  it("strips all three local search function tools in both shapes, keeps similar and non-function names, and yields exactly one built-in", () => {
    const body = responsesBodyWithTools();
    body.tools = [
      clientWebSearchTool(),
      nestedFunctionTool("web_search"),
      browserSearchTool("browser_search"),
      browserSearchTool("browser_fetch"),
      nestedFunctionTool("browser_fetch"),
      nestedFunctionTool("bash"),
      { type: "function", name: "web_search_preview", parameters: { type: "object" } },
      // Same exact names but NOT function tools: they must survive.
      { type: "custom", name: "web_search" },
      { type: "custom", name: "browser_search" },
      { name: "browser_fetch" },
      { type: "web_search" },
      { type: "web_search" },
    ];
    const next = mergeHostedWebSearchTool(body, true) as typeof body;
    const functionNameOf = (tool: unknown): string | null => {
      const record = tool as Record<string, unknown>;
      if (record.type !== "function") return null;
      if (typeof record.name === "string") return record.name;
      const fn = record.function as { name?: unknown } | undefined;
      return typeof fn?.name === "string" ? fn.name : null;
    };
    const functionNames = next.tools.map(functionNameOf).filter((name): name is string => name !== null);
    for (const local of ["web_search", "browser_search", "browser_fetch"]) {
      expect(functionNames.filter((name) => name === local)).toHaveLength(0);
    }
    expect(next.tools.filter((tool) => (tool as Record<string, unknown>).type === "web_search")).toHaveLength(1);
    expect(next.tools.at(-1)).toEqual({ type: "web_search" });
    // Local non-search tools and merely similar names are preserved.
    expect(functionNames).toContain("bash");
    expect(functionNames).toContain("web_search_preview");
    // Non-function tools sharing the exact local names are preserved.
    expect(next.tools).toContainEqual({ type: "custom", name: "web_search" });
    expect(next.tools).toContainEqual({ type: "custom", name: "browser_search" });
    expect(next.tools).toContainEqual({ name: "browser_fetch" });
  });

  it("never double-injects when the built-in is already present", () => {
    const body = responsesBodyWithTools();
    const once = mergeHostedWebSearchTool(body, true) as typeof body;
    const twice = mergeHostedWebSearchTool(once, true) as typeof body;
    expect(twice.tools).toEqual(once.tools);
    expect(twice.tools.filter((tool) => (tool as Record<string, unknown>).type === "web_search")).toHaveLength(1);
  });

  it("creates the built-in tool for supported models even without a tools array", () => {
    const body = buildResponsesBody({ model: "deepseek-v4-flash", input: [] });
    const next = mergeHostedWebSearchTool(body, true) as { tools: unknown[] };
    expect(next.tools).toEqual([{ type: "web_search" }]);
    expect(DEEPSEEK_WEB_SEARCH_BUILTIN).toEqual({ type: "web_search" });
  });

  it("leaves unsupported models untouched instead of pretending support", () => {
    const body = responsesBodyWithTools();
    const untouched = mergeHostedWebSearchTool(body, false);
    expect(untouched).toBe(body);
    expect(toolSummaries((untouched as typeof body).tools)).toContain("function:web_search");
  });

  it("rewrites the before_provider_request body for a capable extended model", async () => {
    const hooks: Array<{ event: string; handler: (...args: unknown[]) => unknown }> = [];
    agent({
      registerProvider: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        hooks.push({ event, handler });
      },
    } as never);
    const hook = hooks.find((item) => item.event === "before_provider_request");
    expect(hook).toBeTruthy();
    const payload = {
      model: "deepseek-v4-flash",
      input: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", name: "bash", parameters: { type: "object" } },
        clientWebSearchTool(),
        browserSearchTool("browser_search"),
        browserSearchTool("browser_fetch"),
        nestedFunctionTool("read"),
        // Same exact name but a non-function tool: must reach the wire.
        { type: "custom", name: "web_search" },
      ],
    };
    const rewritten = (await hook!.handler(
      { type: "before_provider_request", payload },
      { model: { provider: "deepseek-extended", id: "deepseek-v4-flash" } },
    )) as typeof payload;
    // Final outbound body: zero local search FUNCTION tools of any shape,
    // exactly one built-in, and the legal non-function same-name tool kept.
    const functionNameOf = (tool: unknown): string | null => {
      const record = tool as Record<string, unknown>;
      if (record.type !== "function") return null;
      if (typeof record.name === "string") return record.name;
      const fn = record.function as { name?: unknown } | undefined;
      return typeof fn?.name === "string" ? fn.name : null;
    };
    const outboundFunctionNames = rewritten.tools.map(functionNameOf).filter((name): name is string => name !== null);
    for (const local of ["web_search", "browser_search", "browser_fetch"]) {
      expect(outboundFunctionNames).not.toContain(local);
    }
    expect(rewritten.tools.filter((tool) => (tool as Record<string, unknown>).type === "web_search")).toHaveLength(1);
    expect(toolSummaries(rewritten.tools)).toEqual(["function:bash", "function:read", "custom", "web_search"]);
    expect(rewritten.tools).toContainEqual({ type: "custom", name: "web_search" });
    // Thinking cap lands on the default/low path.
    expect((rewritten.input[0] as { role?: string }).role).toBe("developer");
    expect((rewritten.input[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(THINKING_CAP_DIRECTIVE);

    // A model outside our catalog gets no hosted tool and no drops — but the
    // thinking cap is provider-level policy and applies regardless.
    const other = (await hook!.handler(
      { type: "before_provider_request", payload },
      { model: { provider: "deepseek-extended", id: "unknown-future-model" } },
    )) as typeof payload;
    expect(other.tools).toEqual(payload.tools);
    expect(other.tools.some((tool) => (tool as Record<string, unknown>).type === "web_search")).toBe(false);
    expect((other.input[0] as { role?: string }).role).toBe("developer");
    expect(JSON.stringify(other.input[0])).toContain("internal reasoning must stay under");
  });

  it("caps thinking on the default/low path and leaves none/high/max alone", () => {
    const plain = applyThinkingCap({ model: "deepseek-v4-flash", input: [{ role: "user", content: "hi" }] });
    expect((plain.input[0] as { role?: string }).role).toBe("developer");
    expect((plain.input[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(THINKING_CAP_DIRECTIVE);
    expect(plain.input[1]).toEqual({ role: "user", content: "hi" });
    const fromString = applyThinkingCap({ input: "hi" });
    expect((fromString.input[0] as { role?: string }).role).toBe("developer");
    expect(fromString.input[1]).toEqual({ role: "user", content: [{ type: "input_text", text: "hi" }] });
    const low = applyThinkingCap({ input: [], reasoning: { effort: "low" } });
    expect((low.input[0] as { role?: string }).role).toBe("developer");
    for (const effort of ["none", "high", "max"]) {
      const body = { input: [{ role: "user", content: "hi" }], reasoning: { effort } };
      expect(applyThinkingCap(body)).toBe(body);
    }
    expect(applyThinkingCap(plain)).toBe(plain);
  });
});
