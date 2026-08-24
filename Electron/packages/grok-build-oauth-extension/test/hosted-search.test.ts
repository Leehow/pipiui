import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyHostedSearchToPayload,
  collectResponsesStream,
  GROK_BUILD_NATIVE_SEARCH,
  hostedSearchToolsOf,
  hostedWebSearchTool,
  interpretResponsesError,
  mergeHostedSearchTools,
  nativeSearchFromUnknown,
  normalizeResponsesUsage,
} from "../agent/hosted-search.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): unknown[] {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as unknown[];
}

describe("hosted search request contract", () => {
  it("emits raw Responses hosted tools and applies web domain policy only", () => {
    expect(hostedSearchToolsOf(GROK_BUILD_NATIVE_SEARCH)).toEqual([
      { type: "web_search" },
      { type: "x_search" },
    ]);
    expect(hostedWebSearchTool({
      allow: ["docs.example", "docs.example", ""],
      deny: ["tracker.example"],
    })).toEqual({
      type: "web_search",
      filters: {
        allowed_domains: ["docs.example"],
        excluded_domains: ["tracker.example"],
      },
    });
    expect(hostedSearchToolsOf({ tools: ["x_search"], domains: { allow: ["docs.example"] } })).toEqual([
      { type: "x_search" },
    ]);
  });

  it("drops generic web_search only when native web_search is declared", () => {
    const existing = [
      { type: "function", name: "bash", parameters: { type: "object" } },
      { type: "function", name: "web_search", parameters: { type: "object" } },
      { type: "function", name: "image_gen", parameters: { type: "object" } },
    ];
    expect(mergeHostedSearchTools(existing, { tools: ["web_search", "x_search"] })).toEqual([
      { type: "function", name: "bash", parameters: { type: "object" } },
      { type: "function", name: "image_gen", parameters: { type: "object" } },
      { type: "web_search" },
      { type: "x_search" },
    ]);
    expect(mergeHostedSearchTools(existing, { tools: ["x_search"] })).toEqual([
      ...existing,
      { type: "x_search" },
    ]);
  });

  it("strips retired search_parameters and does not duplicate hosted tools", () => {
    const payload = applyHostedSearchToPayload(
      {
        model: "grok-4.6",
        input: [{ role: "user", content: "hi" }],
        search_parameters: { mode: "auto" },
        tools: [{ type: "web_search" }, { type: "function", name: "web_search" }],
      },
      { tools: ["web_search", "x_search"], domains: { deny: ["tracker.example"] } },
    );
    expect(payload).not.toHaveProperty("search_parameters");
    expect(payload.tools).toEqual([
      { type: "web_search", filters: { excluded_domains: ["tracker.example"] } },
      { type: "x_search" },
    ]);
    expect(nativeSearchFromUnknown(["x_search", "web_search", "web_search"])).toEqual({
      tools: ["x_search", "web_search"],
    });
  });
});

describe("hosted search stream / error / usage fixtures", () => {
  it("collects web_search and x_search lifecycle events plus usage", () => {
    const result = collectResponsesStream(loadFixture("responses-hosted-search-stream.json"));
    expect(result.searches).toEqual([
      { kind: "web_search", phase: "in_progress", itemId: "ws_1", outputIndex: 1 },
      { kind: "web_search", phase: "searching", itemId: "ws_1", outputIndex: 1 },
      { kind: "web_search", phase: "completed", itemId: "ws_1", outputIndex: 1 },
      { kind: "x_search", phase: "in_progress", itemId: "xs_1", outputIndex: 2 },
      { kind: "x_search", phase: "completed", itemId: "xs_1", outputIndex: 2 },
    ]);
    expect(result.usage).toEqual({
      input: 20,
      output: 40,
      cacheRead: 8,
      cacheWrite: 2,
      reasoning: 12,
      totalTokens: 70,
      serverSideToolUsage: { SERVER_SIDE_TOOL_WEB_SEARCH: 1, SERVER_SIDE_TOOL_X_SEARCH: 1 },
    });
    expect(result.error).toBeUndefined();
    expect(result.citations).toEqual([]);
  });

  it("preserves url_citation annotations, indexes, and inline source URLs", () => {
    const result = collectResponsesStream(loadFixture("responses-hosted-search-citations.json"));
    expect(result.citations).toEqual([
      { url: "https://docs.example/a", title: "Example A", startIndex: 0, endIndex: 12, type: "url_citation" },
      { url: "https://docs.example/b", title: "Example B", startIndex: 13, endIndex: 24, type: "url_citation" },
      { url: "https://docs.example/c" },
    ]);
  });

  it("accepts x_search item and custom-tool fallbacks without inventing sources", () => {
    const result = collectResponsesStream(loadFixture("responses-hosted-search-x-fallback.json"));
    expect(result.searches).toEqual([
      {
        kind: "x_search",
        phase: "in_progress",
        itemId: "xs_item",
        outputIndex: 2,
        query: "from:xai",
        sources: [{ url: "https://x.com/xai/status/1", title: "post" }],
      },
      {
        kind: "x_search",
        phase: "completed",
        itemId: "xs_item",
        outputIndex: 2,
        query: "from:xai",
      },
      {
        kind: "x_search",
        phase: "completed",
        itemId: "xs_custom",
        outputIndex: 3,
      },
    ]);
  });

  it("keeps hosted search beside ordinary function calls", () => {
    const result = collectResponsesStream(loadFixture("responses-hosted-search-mixed.json"));
    expect(result.searches.map((item) => item.kind)).toEqual(["web_search", "web_search", "web_search"]);
    expect(result.searches[0]?.query).toBe("pipiui");
    expect(result.usage?.serverSideToolUsage).toEqual({ SERVER_SIDE_TOOL_WEB_SEARCH: 1 });
  });

  it("maps response.failed and never echoes secrets", () => {
    const failed = interpretResponsesError({
      type: "response.failed",
      response: {
        error: { code: "invalid_api_key", message: "Bearer at-secret is not valid" },
      },
    });
    expect(failed).toEqual({
      code: "invalid_api_key",
      message: "Bearer [redacted] is not valid",
    });
    expect(JSON.stringify(failed)).not.toContain("at-secret");
    expect(collectResponsesStream(loadFixture("responses-hosted-search-error.json")).error).toEqual({
      code: "rate_limited",
      message: "too many hosted search calls",
    });
  });

  it("normalizes Responses usage with cached tokens subtracted from input", () => {
    expect(normalizeResponsesUsage({
      input_tokens: 30,
      output_tokens: 10,
      total_tokens: 40,
      input_tokens_details: { cached_tokens: 5, cache_write_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 3 },
    })).toEqual({
      input: 24,
      output: 10,
      cacheRead: 5,
      cacheWrite: 1,
      reasoning: 3,
      totalTokens: 40,
    });
  });
});
