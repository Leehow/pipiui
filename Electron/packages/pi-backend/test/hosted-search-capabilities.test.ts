/**
 * Hosted-search exclusivity: canonical capability enrichment for official
 * built-in providers.
 *
 * The enrichment seam (`hosted-search-capabilities.ts`) is the only place that
 * matches provider+API; these tests pin its exact table (including near-miss
 * providers/APIs) and prove enriched capabilities flow through the catalog into
 * (a) the selected main model shape `assemblePiSpawn` consumes and (b) the
 * worker native-search runtime catalog, while ordinary models,
 * `x_search`-only models and contributed hosted-web models are untouched.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import {
  enrichCapabilitiesForOfficialHostedSearch,
  officialHostedSearchToolsFor,
  OFFICIAL_HOSTED_SEARCH_ADAPTERS,
} from "../src/hosted-search-capabilities.js";
import { mainSessionExcludeToolArgs } from "../src/main-tool-policy.js";
import {
  effectiveModelHidesGenericWebSearch,
  modelHidesGenericWebSearch,
  type Model,
} from "@pipi/host-api";
import type { AuthRuntimeLike } from "../src/provider-auth.js";

function fakeAuthRuntime(
  catalog: Array<Record<string, unknown>>,
  credentialed: string[],
): AuthRuntimeLike {
  const ids = new Set(credentialed);
  return {
    getProviders: async () => [],
    getAvailable: async () => catalog.filter((model) => ids.has(String(model.provider))),
    login: async () => {
      throw new Error("not used");
    },
    logout: async () => undefined,
  };
}

// One row per bundled official hosted-search adapter, plus the rows whose
// generic search must survive: x_search-only (contributed), ordinary models,
// and exact near-miss provider/API combinations.
const RUNTIME_CATALOG: Array<Record<string, unknown>> = [
  { provider: "openai", id: "gpt-5.5", name: "GPT-5.5", api: "openai-responses", reasoning: true, input: ["text"] },
  { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", api: "openai-codex-responses", reasoning: true, input: ["text"] },
  { provider: "anthropic", id: "claude-5-sonnet", name: "Claude 5 Sonnet", api: "anthropic-messages", reasoning: true, input: ["text"] },
  { provider: "google", id: "gemini-3-pro", name: "Gemini 3 Pro", api: "google-generative-ai", reasoning: true, input: ["text"] },
  { provider: "xai", id: "grok-5", name: "Grok 5", api: "openai-responses", reasoning: true, input: ["text"], capabilities: { hostedTools: ["x_search"] } },
  { provider: "deepseek", id: "deepseek-chat", name: "DeepSeek Chat", api: "openai-completions", reasoning: true, input: ["text"] },
  { provider: "openai", id: "gpt-chat", name: "GPT Chat", api: "openai-completions", reasoning: true, input: ["text"] },
  { provider: "openai-codex", id: "codex-on-responses", name: "Codex on Responses", api: "openai-responses", reasoning: true, input: ["text"] },
  { provider: "openai-compatible-relay", id: "relay-1", name: "Relay 1", api: "openai-responses", reasoning: true, input: ["text"] },
  { provider: "anthropic-proxy", id: "proxy-1", name: "Proxy 1", api: "anthropic-messages", reasoning: true, input: ["text"] },
  { provider: "google-gemini-cli", id: "gemini-cli-1", name: "Gemini CLI 1", api: "google-generative-ai", reasoning: true, input: ["text"] },
  { provider: "google", id: "gemini-via-cli", name: "Gemini via CLI", api: "google-gemini-cli", reasoning: true, input: ["text"] },
];

const OFFICIAL_HOSTED_WEB_REFS = [
  "openai/gpt-5.5",
  "openai-codex/gpt-5.6-sol",
  "anthropic/claude-5-sonnet",
  "google/gemini-3-pro",
];

describe("official hosted-search enrichment seam (pure)", () => {
  it("covers exactly the four bundled official adapters", () => {
    expect(OFFICIAL_HOSTED_SEARCH_ADAPTERS.map((contract) => [contract.api, ...contract.providers])).toEqual([
      ["openai-responses", "openai"],
      ["openai-codex-responses", "openai-codex"],
      ["anthropic-messages", "anthropic"],
      ["google-generative-ai", "google"],
    ]);
    for (const contract of OFFICIAL_HOSTED_SEARCH_ADAPTERS) {
      expect(contract.tools).toEqual(["web_search"]);
    }
  });

  it("enriches every official hosted-web provider+API pair", () => {
    expect(officialHostedSearchToolsFor("openai", "openai-responses")).toEqual(["web_search"]);
    expect(officialHostedSearchToolsFor("openai-codex", "openai-codex-responses")).toEqual(["web_search"]);
    expect(officialHostedSearchToolsFor("anthropic", "anthropic-messages")).toEqual(["web_search"]);
    expect(officialHostedSearchToolsFor("google", "google-generative-ai")).toEqual(["web_search"]);
    // Provider case-folding mirrors the adapters' own lowercase comparison.
    expect(officialHostedSearchToolsFor("OpenAI", "openai-responses")).toEqual(["web_search"]);
  });

  it("refuses exact near-miss providers and APIs", () => {
    expect(officialHostedSearchToolsFor("openai", "openai-completions")).toBeUndefined();
    expect(officialHostedSearchToolsFor("openai", "openai-codex-responses")).toBeUndefined();
    expect(officialHostedSearchToolsFor("openai-codex", "openai-responses")).toBeUndefined();
    expect(officialHostedSearchToolsFor("openai-compatible", "openai-responses")).toBeUndefined();
    expect(officialHostedSearchToolsFor("openai-codex-relay", "openai-codex-responses")).toBeUndefined();
    expect(officialHostedSearchToolsFor("anthropic-proxy", "anthropic-messages")).toBeUndefined();
    expect(officialHostedSearchToolsFor("claude-relay", "anthropic-messages")).toBeUndefined();
    expect(officialHostedSearchToolsFor("google", "google-gemini-cli")).toBeUndefined();
    expect(officialHostedSearchToolsFor("google-gemini-cli", "google-generative-ai")).toBeUndefined();
    expect(officialHostedSearchToolsFor("xai", "openai-responses")).toBeUndefined();
    expect(officialHostedSearchToolsFor("openai", undefined)).toBeUndefined();
    expect(officialHostedSearchToolsFor(undefined, "openai-responses")).toBeUndefined();
  });

  it("fills hostedTools.web_search for capability-less rows and stays idempotent", () => {
    expect(enrichCapabilitiesForOfficialHostedSearch("openai-codex", "openai-codex-responses", undefined)).toEqual({
      hostedTools: { tools: ["web_search"] },
    });
    const once = enrichCapabilitiesForOfficialHostedSearch("google", "google-generative-ai", undefined);
    const twice = enrichCapabilitiesForOfficialHostedSearch("google", "google-generative-ai", once);
    expect(twice).toEqual(once);
  });

  it("keeps declared/contributed hosted-web capabilities untouched (xAI/Grok/DeepSeek contributions win)", () => {
    const contributed: Model["capabilities"] = {
      hostedTools: {
        tools: ["web_search", "code_interpreter"],
        domains: { allow: ["docs.example"] },
      },
      structuredOutputs: true,
    };
    expect(enrichCapabilitiesForOfficialHostedSearch("openai", "openai-responses", contributed)).toBe(contributed);
    const legacy: Model["capabilities"] = { nativeSearch: { tools: ["web_search"], domains: { deny: ["no.example"] } } };
    expect(enrichCapabilitiesForOfficialHostedSearch("anthropic", "anthropic-messages", legacy)).toBe(legacy);
  });

  it("preserves x_search-only behavior: never enriched, generic web_search stays", () => {
    const xOnly: Model["capabilities"] = { hostedTools: { tools: ["x_search"] } };
    expect(enrichCapabilitiesForOfficialHostedSearch("openai", "openai-responses", xOnly)).toBe(xOnly);
    const xOnlyLegacy: Model["capabilities"] = { nativeSearch: ["x_search"] };
    expect(enrichCapabilitiesForOfficialHostedSearch("google", "google-generative-ai", xOnlyLegacy)).toBe(xOnlyLegacy);
    expect(modelHidesGenericWebSearch({ capabilities: xOnly })).toBe(false);
  });

  it("honors an explicit declaration in EITHER bag when both nativeSearch and hostedTools exist", () => {
    // Reviewer finding: hostedToolsOf prefers hostedTools, so a legacy
    // nativeSearch x_search-only declaration must not be masked by a separate
    // hostedTools bag into gaining hosted web_search.
    const mixedXOnly: Model["capabilities"] = {
      nativeSearch: { tools: ["x_search"] },
      hostedTools: { tools: ["code_interpreter"] },
    };
    expect(enrichCapabilitiesForOfficialHostedSearch("openai", "openai-responses", mixedXOnly)).toBe(mixedXOnly);
    expect(modelHidesGenericWebSearch({ capabilities: mixedXOnly })).toBe(false);
    // Lenient (shorthand) placement of the same declaration behaves identically.
    const mixedShorthand: Model["capabilities"] = { nativeSearch: ["x_search"], hostedTools: ["code_interpreter"] };
    expect(enrichCapabilitiesForOfficialHostedSearch("anthropic", "anthropic-messages", mixedShorthand)).toBe(mixedShorthand);
    // A declared legacy web_search wins over enrichment just the same.
    const mixedLegacyWeb: Model["capabilities"] = {
      nativeSearch: { tools: ["web_search"], domains: { deny: ["no.example"] } },
      hostedTools: { tools: ["code_interpreter"] },
    };
    expect(enrichCapabilitiesForOfficialHostedSearch("google", "google-generative-ai", mixedLegacyWeb)).toBe(mixedLegacyWeb);
    // A hostedTools bag without any search declaration still unions normally
    // (code_interpreter kept, web_search filled).
    expect(
      enrichCapabilitiesForOfficialHostedSearch("openai-codex", "openai-codex-responses", {
        nativeSearch: undefined,
        hostedTools: { tools: ["code_interpreter"] },
      } as Model["capabilities"]),
    ).toEqual({ hostedTools: { tools: ["web_search", "code_interpreter"] } });
  });

  it("unions with non-search declarations (e.g. code_interpreter-only rows)", () => {
    expect(
      enrichCapabilitiesForOfficialHostedSearch("openai", "openai-responses", {
        hostedTools: { tools: ["code_interpreter"] },
      }),
    ).toEqual({ hostedTools: { tools: ["web_search", "code_interpreter"] } });
  });

  it("leaves ordinary models and near-misses untouched (identity)", () => {
    expect(enrichCapabilitiesForOfficialHostedSearch("deepseek", "openai-completions", undefined)).toBeUndefined();
    expect(enrichCapabilitiesForOfficialHostedSearch("openai-compatible-relay", "openai-responses", undefined)).toBeUndefined();
    expect(enrichCapabilitiesForOfficialHostedSearch("google", "google-gemini-cli", { structuredOutputs: true })).toEqual({
      structuredOutputs: true,
    });
  });
});

describe("official hosted-search enrichment through the catalog", () => {
  let root = "";
  let backend: ReturnType<typeof createPiHostBackend> | undefined;

  afterEach(async () => {
    await backend?.close?.();
    backend = undefined;
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });

  async function setup(): Promise<ReturnType<typeof createPiHostBackend>> {
    root = await mkdtemp(join(tmpdir(), "pipi-hosted-capabilities-"));
    const agent = join(root, "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "models.json"), JSON.stringify({ providers: {} }));
    backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      authRuntime: fakeAuthRuntime(RUNTIME_CATALOG, [
        "openai",
        "openai-codex",
        "anthropic",
        "google",
        "xai",
        "deepseek",
        "openai-compatible-relay",
        "anthropic-proxy",
        "google-gemini-cli",
      ]),
    });
    return backend;
  }

  const modelOf = (models: Model[], provider: string, id: string): Model => {
    const model = models.find((item) => item.provider === provider && item.id === id);
    expect(model, `${provider}/${id} in catalog`).toBeTruthy();
    return model as Model;
  };

  it("enriches built-in hosted-web rows and leaves ordinary/x_search-only/near-miss rows alone", async () => {
    const host = await setup();
    const models = (await host.handle("listModels", [])) as Model[];

    for (const ref of OFFICIAL_HOSTED_WEB_REFS) {
      const [provider, id] = ref.split("/");
      const model = modelOf(models, provider, id);
      expect(model.capabilities, ref).toEqual({ hostedTools: { tools: ["web_search"] } });
      expect(effectiveModelHidesGenericWebSearch(model), ref).toBe(true);
    }

    // x_search-only (contributed shape): preserved, generic web search stays.
    const grok = modelOf(models, "xai", "grok-5");
    expect(grok.capabilities).toEqual({ hostedTools: { tools: ["x_search"] } });
    expect(effectiveModelHidesGenericWebSearch(grok)).toBe(false);

    // Ordinary model: no capabilities at all.
    expect(modelOf(models, "deepseek", "deepseek-chat").capabilities).toBeUndefined();

    // Exact near-misses stay capability-less.
    expect(modelOf(models, "openai", "gpt-chat").capabilities).toBeUndefined();
    expect(modelOf(models, "openai-codex", "codex-on-responses").capabilities).toBeUndefined();
    expect(modelOf(models, "openai-compatible-relay", "relay-1").capabilities).toBeUndefined();
    expect(modelOf(models, "anthropic-proxy", "proxy-1").capabilities).toBeUndefined();
    expect(modelOf(models, "google-gemini-cli", "gemini-cli-1").capabilities).toBeUndefined();
    expect(modelOf(models, "google", "gemini-via-cli").capabilities).toBeUndefined();
  });

  it("flows enrichment into the selected main model (the shape assemblePiSpawn consumes)", async () => {
    const host = await setup();
    const selected = (await host.handle("setModel", ["openai-codex", "gpt-5.6-sol"])) as { model: Model };
    expect(selected.model.capabilities).toEqual({ hostedTools: { tools: ["web_search"] } });
    const state = (await host.handle("getModelState", [])) as { model: Model };
    expect(state.model.capabilities).toEqual({ hostedTools: { tools: ["web_search"] } });

    // Main-session spawn argv for that model: exactly the three local search
    // surfaces leave the tool list; nothing else is excluded by the policy.
    expect(mainSessionExcludeToolArgs({ model: selected.model })).toEqual([
      "--exclude-tools",
      "browser_fetch,browser_search,web_search",
    ]);
    // Ordinary and x_search-only models keep every generic search tool.
    expect(mainSessionExcludeToolArgs({ model: modelOf(
      (await host.handle("listModels", [])) as Model[],
      "xai",
      "grok-5",
    ) })).toEqual([]);
    expect(mainSessionExcludeToolArgs({ model: { provider: "deepseek", id: "deepseek-chat" } })).toEqual([]);
  });

  it("publishes enriched capabilities into the worker native-search runtime catalog", async () => {
    const host = await setup();
    await host.handle("getSubagentModels", []);
    const raw = await readFile(join(root, "agent", "pipiui-native-search-runtime.json"), "utf8");
    const catalog = JSON.parse(raw) as Record<string, { tools?: string[]; capabilities?: unknown }>;

    for (const ref of OFFICIAL_HOSTED_WEB_REFS) {
      expect(catalog[ref]?.tools, ref).toEqual(["web_search"]);
      expect(catalog[ref]?.capabilities).toEqual({ hostedTools: { tools: ["web_search"] } });
    }
    expect(catalog["xai/grok-5"]).toEqual({
      tools: ["x_search"],
      capabilities: { hostedTools: { tools: ["x_search"] } },
    });
    expect(catalog["deepseek/deepseek-chat"]).toBeUndefined();
    expect(catalog["openai/gpt-chat"]).toBeUndefined();
    expect(catalog["openai-compatible-relay/relay-1"]).toBeUndefined();
  });
});
