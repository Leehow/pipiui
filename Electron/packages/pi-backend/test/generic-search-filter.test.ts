import { describe, expect, it } from "vitest";
import {
  extraExcludedGenericSearchTools,
  hidesGenericWebSearch,
  nativeSearchRuntimeCatalog,
} from "../src/generic-search-filter.js";
import {
  hideGenericWebSearchForModelRef,
  nativeSearchCapabilityHidesGenericWebSearch,
  resolveSubagentToolSelection,
} from "../../../resources/runtime/pi-ext/subagent/desktop-tool-policy.mjs";

const nativeWeb = { provider: "acme", id: "fast", capabilities: { nativeSearch: { tools: ["web_search", "x_search"] as const } } };
const xOnly = { provider: "acme", id: "x", capabilities: { nativeSearch: { tools: ["x_search"] as const } } };
const codeOnly = { provider: "acme", id: "code", capabilities: { hostedTools: { tools: ["code_interpreter"] as const } } };
const fullHosted = {
  provider: "grok-build",
  id: "grok-4.6",
  capabilities: {
    hostedTools: { tools: ["web_search", "x_search", "code_interpreter"] as const },
    structuredOutputs: true as const,
    inputFiles: true as const,
    nativeSearch: { tools: ["web_search", "x_search"] as const },
  },
};
const hostedWeb = { provider: "acme", id: "hosted-web", capabilities: { hostedTools: { tools: ["web_search"] as const } } };
const ordinary = { provider: "anthropic", id: "claude" };
const undeclaredXai = { provider: "xai", id: "grok-3" };

function exploreTools(hideGenericWebSearch: boolean) {
  return resolveSubagentToolSelection({
    declaredTools: ["read", "grep", "web_search", "fetch_content", "source_check"],
    disabledTools: [],
    hasDesktopCapability: false,
    hasMemoryBrokerCapability: false,
    hasSessionRecall: true,
    allowRecursiveDelegation: false,
    availableExtensionTools: ["fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
    hideGenericWebSearch,
  });
}

describe("generic web_search filter — shared predicates", () => {
  it("hides only for declared native or hosted web_search", () => {
    expect(hidesGenericWebSearch(nativeWeb)).toBe(true);
    expect(hidesGenericWebSearch(hostedWeb)).toBe(true);
    expect(hidesGenericWebSearch(xOnly)).toBe(false);
    expect(hidesGenericWebSearch(ordinary)).toBe(false);
    expect(hidesGenericWebSearch(undeclaredXai)).toBe(false);
    expect(hidesGenericWebSearch(codeOnly)).toBe(false);
    expect(hidesGenericWebSearch(fullHosted)).toBe(true);
    expect(extraExcludedGenericSearchTools(nativeWeb)).toEqual(["web_search"]);
    expect(extraExcludedGenericSearchTools(hostedWeb)).toEqual(["web_search"]);
    expect(extraExcludedGenericSearchTools(xOnly)).toEqual([]);
    expect(extraExcludedGenericSearchTools(codeOnly)).toEqual([]);
    expect(extraExcludedGenericSearchTools(ordinary)).toEqual([]);
    expect(extraExcludedGenericSearchTools(undeclaredXai)).toEqual([]);
  });

  it("stamps effective nativeSearch into the worker catalog without provider branches at lookup", () => {
    const catalog = nativeSearchRuntimeCatalog([nativeWeb, hostedWeb, xOnly, codeOnly, fullHosted, ordinary, undeclaredXai]);
    expect(catalog["acme/fast"]?.tools).toEqual(["web_search", "x_search"]);
    expect(catalog["acme/hosted-web"]?.tools).toEqual(["web_search"]);
    expect(catalog["acme/x"]?.tools).toEqual(["x_search"]);
    expect(catalog["acme/code"]?.tools).toBeUndefined();
    expect(catalog["acme/code"]?.capabilities?.hostedTools).toEqual({ tools: ["code_interpreter"] });
    expect(catalog["grok-build/grok-4.6"]?.tools).toEqual(["web_search", "x_search"]);
    expect(catalog["grok-build/grok-4.6"]?.capabilities).toMatchObject({
      hostedTools: { tools: ["web_search", "x_search", "code_interpreter"] },
      structuredOutputs: true,
      inputFiles: true,
    });
    expect(catalog["anthropic/claude"]).toBeUndefined();
    expect(catalog["xai/grok-3"]).toBeUndefined();
    expect(hideGenericWebSearchForModelRef("acme/fast", catalog)).toBe(true);
    expect(hideGenericWebSearchForModelRef("acme/hosted-web", catalog)).toBe(true);
    expect(hideGenericWebSearchForModelRef("acme/x", catalog)).toBe(false);
    expect(hideGenericWebSearchForModelRef("acme/code", catalog)).toBe(false);
    expect(hideGenericWebSearchForModelRef("anthropic/claude", catalog)).toBe(false);
    expect(hideGenericWebSearchForModelRef("xai/grok-3", catalog)).toBe(false);
    expect(nativeSearchCapabilityHidesGenericWebSearch({ tools: ["x_search"] })).toBe(false);
    expect(nativeSearchCapabilityHidesGenericWebSearch({ tools: ["web_search"] })).toBe(true);
  });
});

describe("generic web_search filter — subagent tool assembly", () => {
  it("drops web_search from the allowlist only when hideGenericWebSearch is set", () => {
    expect(exploreTools(false)).toEqual({
      flag: "--tools",
      names: ["read", "grep", "web_search", "fetch_content", "source_check", "session_recall"],
    });
    expect(exploreTools(true)).toEqual({
      flag: "--tools",
      names: ["read", "grep", "fetch_content", "source_check", "session_recall"],
    });
  });

  it("adds web_search to the exclude list for unconstrained workers when hidden", () => {
    const kept = resolveSubagentToolSelection({
      declaredTools: undefined,
      disabledTools: [],
      hasDesktopCapability: false,
      hideGenericWebSearch: false,
      allowRecursiveDelegation: false,
    });
    expect(kept.flag).toBe("--exclude-tools");
    expect(kept.names).not.toContain("web_search");

    const hidden = resolveSubagentToolSelection({
      declaredTools: undefined,
      disabledTools: [],
      hasDesktopCapability: false,
      hideGenericWebSearch: true,
      allowRecursiveDelegation: false,
    });
    expect(hidden.flag).toBe("--exclude-tools");
    expect(hidden.names).toContain("web_search");
  });

  it("keeps sibling retrieval tools when generic web_search is hidden", () => {
    const names = new Set(exploreTools(true).names);
    expect(names.has("web_search")).toBe(false);
    expect(names.has("fetch_content")).toBe(true);
    expect(names.has("source_check")).toBe(true);
  });
});
