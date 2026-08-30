/**
 * Canonical capability-enrichment seam for official built-in hosted-search providers.
 *
 * The bundled server-tools adapters in `resources/runtime/extensions/` inject
 * provider-native web search UNCONDITIONALLY for their exact provider+API pair
 * (`before_provider_request`), regardless of catalog capabilities:
 *
 *   pipiui-openai-server-tools.ts   provider === "openai"        api === "openai-responses"
 *   pipiui-codex-server-tools.ts    provider === "openai-codex"  api === "openai-codex-responses"
 *   pipiui-claude-server-tools.ts   provider is anthropic        api === "anthropic-messages"
 *   pipiui-gemini-server-tools.ts   provider === "google"        api === "google-generative-ai"
 *
 * Built-in official catalog rows (e.g. `openai-codex/gpt-5.6-sol`) carry no
 * `capabilities`, so the capability-driven filters (main-session tool policy,
 * worker native-search runtime catalog) could not hide the local generic search
 * tools (`web_search`, `browser_search`, `browser_fetch`) and a hosted-web model
 * saw both search channels.
 *
 * This module is the ONLY place in the host that matches provider ids / API
 * streamer ids for hosted-search capability purposes. Downstream filters stay
 * capability-only (`hostedTools` / `nativeSearch` bags) and never infer from
 * provider names. Matching here is EXACT — one wrong character is a near-miss
 * and stays unenriched (fuzzy relay providers keep generic search; the
 * adapters' own request-time defense still cleans those payloads on the wire).
 *
 * Deliberately NOT in the table: `xai` and `deepseek`. Their adapters are
 * capability-driven ("keys off catalog capabilities — never a provider id and
 * never a default search fallback"), and their models get capabilities through
 * extension contributions (xAI / Grok Build / DeepSeek). An `x_search`-only row
 * is never enriched either — a lone `x_search` must keep generic `web_search`.
 *
 * Declared/contributed capabilities always win: enrichment only FILLS rows that
 * declare no conflicting hosted search of their own, and is idempotent.
 */

import {
  HOSTED_TOOL_NAMES,
  hostedToolsOf,
  nativeSearchOf,
  normalizeModelCapabilities,
  type HostedToolName,
  type ModelCapabilities,
} from "@pipi/host-api";

/** One bundled official adapter's exact provider+API hosted-search contract. */
export type OfficialHostedSearchAdapter = {
  /** Bundled adapter file that owns the wire behavior (diagnostics/tests only). */
  adapter: string;
  /** Exact pi streamer id (`model.api`) the adapter drives. */
  api: string;
  /** Exact built-in provider ids, compared lowercased exactly as the adapters do. */
  providers: readonly string[];
  /** Hosted search tools the adapter guarantees on the wire. */
  tools: readonly HostedToolName[];
};

export const OFFICIAL_HOSTED_SEARCH_ADAPTERS: readonly OfficialHostedSearchAdapter[] = [
  {
    adapter: "pipiui-openai-server-tools.ts",
    api: "openai-responses",
    providers: ["openai"],
    tools: ["web_search"],
  },
  {
    adapter: "pipiui-codex-server-tools.ts",
    api: "openai-codex-responses",
    providers: ["openai-codex"],
    tools: ["web_search"],
  },
  {
    adapter: "pipiui-claude-server-tools.ts",
    api: "anthropic-messages",
    providers: ["anthropic"],
    tools: ["web_search"],
  },
  {
    adapter: "pipiui-gemini-server-tools.ts",
    api: "google-generative-ai",
    providers: ["google"],
    tools: ["web_search"],
  },
];

/**
 * Hosted search tools the mounted official adapter guarantees for this exact
 * provider+API pair, or `undefined` when no official adapter matches
 * (near-miss providers/APIs included). Mirrors the adapters' predicates:
 * provider lowercased-exact, api exact.
 */
export function officialHostedSearchToolsFor(
  provider: string | undefined,
  api: string | undefined,
): readonly HostedToolName[] | undefined {
  if (typeof api !== "string" || !api) return undefined;
  const normalizedProvider = typeof provider === "string" ? provider.toLowerCase() : "";
  if (!normalizedProvider) return undefined;
  for (const contract of OFFICIAL_HOSTED_SEARCH_ADAPTERS) {
    if (contract.api !== api) continue;
    if (!contract.providers.includes(normalizedProvider)) continue;
    return contract.tools;
  }
  return undefined;
}

/**
 * Pure enrichment: given a model row's exact provider, exact API streamer id and
 * its (possibly absent) capability bag, return the capability bag the mounted
 * official adapter's behavior implies. Identity (same value) when nothing
 * changes: no adapter match, `web_search` already declared, or an
 * `x_search`-only declaration (which must keep generic `web_search`).
 */
export function enrichCapabilitiesForOfficialHostedSearch(
  provider: string | undefined,
  api: string | undefined,
  capabilities: ModelCapabilities | undefined,
): ModelCapabilities | undefined {
  const hosted = officialHostedSearchToolsFor(provider, api);
  if (!hosted?.length) return capabilities;
  // The catalog pipeline normalizes bags before this seam; normalize here too so
  // lenient shapes (`nativeSearch: ["x_search"]`) are read the same way.
  const normalized = normalizeModelCapabilities(capabilities) ?? capabilities;
  const declared = hostedToolsOf({ capabilities: normalized });
  const legacy = nativeSearchOf({ capabilities: normalized });
  // Declared/contributed capabilities always win over enrichment. Both bags are
  // inspected: `hostedToolsOf` prefers `hostedTools` and `nativeSearchOf`
  // prefers `nativeSearch`, so a model declaring a legacy `nativeSearch`
  // x_search/web_search alongside a distinct `hostedTools` bag (e.g.
  // code_interpreter) is still honored by the bag that actually declares it.
  if (declared?.tools.includes("web_search") || legacy?.tools.includes("web_search")) return capabilities;
  // x_search-only semantics: an explicit x_search declaration in EITHER bag
  // must not hide generic web search, even when the other bag exists.
  if (declared?.tools.includes("x_search") || legacy?.tools.includes("x_search")) return capabilities;
  // Canonical tool order, adapter tools union any already-declared hosted tools
  // (e.g. a `code_interpreter`-only row keeps its declaration).
  const tools = HOSTED_TOOL_NAMES.filter(
    (name) => hosted.includes(name) || declared?.tools.includes(name) === true,
  );
  return {
    ...(capabilities ?? {}),
    hostedTools: { tools },
  };
}
