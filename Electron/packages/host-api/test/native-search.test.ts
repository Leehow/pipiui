import { describe, expect, it } from "vitest";
import {
  declaredModelCapabilityKeys,
  effectiveModelHidesGenericWebSearch,
  effectiveNativeSearchOf,
  extraExcludedToolsForNativeSearch,
  hostedToolsOf,
  mergeModelCapabilities,
  modelHasHostedTool,
  modelHasInputFiles,
  modelHasNativeSearchTool,
  modelHasStructuredOutputs,
  modelHidesGenericWebSearch,
  modelSatisfiesCapability,
  nativeSearchDomainPolicyOf,
  nativeSearchOf,
  normalizeModelCapabilities,
  parseModelCapabilities,
} from "../src/index.js";

describe("native-search capability contract", () => {
  it("normalizes a tool-name array and a structured object with domain policy", () => {
    expect(parseModelCapabilities({ nativeSearch: ["x_search", "web_search", "web_search"] })).toEqual({
      ok: true,
      capabilities: { nativeSearch: { tools: ["x_search", "web_search"] } },
    });
    expect(parseModelCapabilities({
      nativeSearch: {
        tools: ["web_search"],
        domains: { allow: ["docs.example", "docs.example"], deny: ["tracker.example"] },
      },
      extra: true,
    })).toEqual({
      ok: true,
      capabilities: {
        extra: true,
        nativeSearch: {
          tools: ["web_search"],
          domains: { allow: ["docs.example"], deny: ["tracker.example"] },
        },
      },
    });
  });

  it("rejects unknown tools and malformed domain lists", () => {
    expect(parseModelCapabilities({ nativeSearch: ["web_search", "live_search"] })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/web_search or x_search/),
    });
    expect(parseModelCapabilities({ nativeSearch: { tools: ["web_search"], domains: { allow: [" "] } } })).toMatchObject({
      ok: false,
    });
    expect(parseModelCapabilities("web_search")).toMatchObject({ ok: false });
  });

  it("drops invalid nativeSearch at runtime without discarding sibling keys", () => {
    expect(normalizeModelCapabilities({ nativeSearch: ["nope"], keep: 1 })).toEqual({ keep: 1 });
    expect(normalizeModelCapabilities(undefined)).toBeUndefined();
    expect(normalizeModelCapabilities(["web_search"])).toBeUndefined();
  });

  it("hides generic web_search only when native web_search is declared", () => {
    const web = { capabilities: { nativeSearch: { tools: ["web_search", "x_search"] as const } } };
    const xOnly = { capabilities: { nativeSearch: { tools: ["x_search"] as const } } };
    expect(modelHasNativeSearchTool(web, "web_search")).toBe(true);
    expect(modelHasNativeSearchTool(xOnly, "x_search")).toBe(true);
    expect(modelHidesGenericWebSearch(web)).toBe(true);
    expect(modelHidesGenericWebSearch(xOnly)).toBe(false);
    expect(modelHidesGenericWebSearch({ capabilities: {} })).toBe(false);
    expect(nativeSearchOf(xOnly)?.tools).toEqual(["x_search"]);
    expect(effectiveModelHidesGenericWebSearch(web)).toBe(true);
    expect(effectiveModelHidesGenericWebSearch(xOnly)).toBe(false);
    expect(effectiveModelHidesGenericWebSearch({ provider: "anthropic" })).toBe(false);
    expect(effectiveNativeSearchOf({ provider: "xai" })).toBeUndefined();
    expect(effectiveModelHidesGenericWebSearch({ provider: "xai" })).toBe(false);
    expect(effectiveModelHidesGenericWebSearch({ provider: "xai", capabilities: { nativeSearch: { tools: ["x_search"] } } })).toBe(false);
    expect(extraExcludedToolsForNativeSearch(web)).toEqual(["web_search", "browser_search", "browser_fetch"]);
    expect(extraExcludedToolsForNativeSearch(xOnly)).toEqual([]);
    expect(extraExcludedToolsForNativeSearch({ provider: "xai" })).toEqual([]);
  });

  it("exposes domain policy only for native web_search", () => {
    const domains = { allow: ["docs.example"] };
    expect(nativeSearchDomainPolicyOf({
      capabilities: { nativeSearch: { tools: ["web_search"], domains } },
    })).toEqual(domains);
    expect(nativeSearchDomainPolicyOf({
      capabilities: { nativeSearch: { tools: ["x_search"], domains } },
    })).toBeUndefined();
  });

  it("merges overlay keys while falling back to base nativeSearch", () => {
    const base = { nativeSearch: { tools: ["web_search"] as const }, keep: "base" };
    const overlay = { extra: "overlay" };
    expect(mergeModelCapabilities(base, overlay)).toEqual({
      keep: "base",
      extra: "overlay",
      nativeSearch: { tools: ["web_search"] },
    });
    expect(mergeModelCapabilities(base, { nativeSearch: { tools: ["x_search"] } })?.nativeSearch).toEqual({
      tools: ["x_search"],
    });
    expect(mergeModelCapabilities(undefined, undefined)).toBeUndefined();
  });

  it("parses hostedTools, structuredOutputs, and inputFiles without requiring provider ids",
    () => {
      expect(parseModelCapabilities({
        hostedTools: ["code_interpreter", "web_search", "web_search"],
        structuredOutputs: true,
        inputFiles: { upload: true, citations: true },
      })).toEqual({
        ok: true,
        capabilities: {
          hostedTools: { tools: ["code_interpreter", "web_search"] },
          structuredOutputs: true,
          inputFiles: { upload: true, citations: true },
        },
      });
      expect(parseModelCapabilities({
        hostedTools: { tools: ["x_search"], domains: { deny: ["tracker.example"] } },
        structuredOutputs: false,
        inputFiles: false,
      })).toEqual({
        ok: true,
        capabilities: { hostedTools: { tools: ["x_search"] } },
      });
      expect(parseModelCapabilities({ hostedTools: ["file_search"] })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/code_interpreter/),
      });
    });

  it("derives nativeSearch from hostedTools and hostedTools from legacy nativeSearch",
    () => {
      const hostedOnly = {
        capabilities: { hostedTools: { tools: ["web_search", "code_interpreter"] as const } },
      };
      const legacyOnly = {
        capabilities: { nativeSearch: { tools: ["x_search"] as const } },
      };
      expect(nativeSearchOf(hostedOnly)?.tools).toEqual(["web_search"]);
      expect(hostedToolsOf(legacyOnly)?.tools).toEqual(["x_search"]);
      expect(modelHasHostedTool(hostedOnly, "code_interpreter")).toBe(true);
      expect(modelHasHostedTool(legacyOnly, "code_interpreter")).toBe(false);
      expect(modelHasNativeSearchTool(hostedOnly, "web_search")).toBe(true);
      expect(modelHidesGenericWebSearch(hostedOnly)).toBe(true);
      expect(modelHidesGenericWebSearch({
        capabilities: { hostedTools: { tools: ["code_interpreter"] } },
      })).toBe(false);
    });

  it("does not hide generic web_search for code_interpreter or x_search-only bags",
    () => {
      const codeOnly = { capabilities: { hostedTools: { tools: ["code_interpreter"] as const } } };
      const xOnly = { capabilities: { hostedTools: { tools: ["x_search"] as const } } };
      expect(modelHidesGenericWebSearch(codeOnly)).toBe(false);
      expect(modelHidesGenericWebSearch(xOnly)).toBe(false);
      expect(effectiveModelHidesGenericWebSearch(codeOnly)).toBe(false);
      expect(effectiveModelHidesGenericWebSearch({ provider: "xai", ...codeOnly })).toBe(false);
      expect(effectiveNativeSearchOf({ provider: "xai" })).toBeUndefined();
      expect(effectiveNativeSearchOf({ provider: "xai", ...codeOnly })).toBeUndefined();
      expect(effectiveNativeSearchOf({
        capabilities: { hostedTools: { tools: ["web_search", "code_interpreter"] } },
      })).toEqual({ tools: ["web_search"] });
      expect(effectiveModelHidesGenericWebSearch({
        capabilities: { hostedTools: { tools: ["web_search"] } },
      })).toBe(true);
      expect(extraExcludedToolsForNativeSearch(codeOnly)).toEqual([]);
      expect(extraExcludedToolsForNativeSearch({
        capabilities: { hostedTools: { tools: ["web_search"] } },
      })).toEqual(["web_search", "browser_search", "browser_fetch"]);
    });

  it("gates structuredOutputs and inputFiles only when explicitly declared",
    () => {
      expect(modelHasStructuredOutputs({ capabilities: { structuredOutputs: true } })).toBe(true);
      expect(modelHasStructuredOutputs({ capabilities: { structuredOutputs: { jsonSchema: true } } })).toBe(true);
      expect(modelHasStructuredOutputs({ capabilities: {} })).toBe(false);
      expect(modelHasInputFiles({ capabilities: { inputFiles: true } })).toBe(true);
      expect(modelHasInputFiles(undefined)).toBe(false);
      expect(modelSatisfiesCapability({
        capabilities: {
          hostedTools: { tools: ["code_interpreter"] },
          structuredOutputs: true,
        },
      }, "hostedTools.code_interpreter")).toBe(true);
      expect(modelSatisfiesCapability({ capabilities: {} }, "structuredOutputs")).toBe(false);
      expect(modelSatisfiesCapability(undefined, "inputFiles")).toBe(false);
      expect(modelSatisfiesCapability({ capabilities: { structuredOutputs: true } }, "mystery")).toBe(false);
      expect(declaredModelCapabilityKeys({
        capabilities: {
          hostedTools: { tools: ["web_search", "code_interpreter"] },
          inputFiles: true,
        },
      })).toEqual(["hostedTools.web_search", "hostedTools.code_interpreter", "inputFiles"]);
    });

  it("merges overlay hostedTools and request features while keeping omitted base fields",
    () => {
      const base = {
        nativeSearch: { tools: ["web_search"] as const },
        hostedTools: { tools: ["web_search"] as const },
        structuredOutputs: true as const,
      };
      expect(mergeModelCapabilities(base, { inputFiles: true })).toEqual({
        nativeSearch: { tools: ["web_search"] },
        hostedTools: { tools: ["web_search"] },
        structuredOutputs: true,
        inputFiles: true,
      });
      expect(mergeModelCapabilities(base, {
        hostedTools: { tools: ["code_interpreter"] },
      })?.hostedTools).toEqual({ tools: ["code_interpreter"] });
    });
});
