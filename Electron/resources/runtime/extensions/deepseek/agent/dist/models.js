/**
 * What this extension knows about DeepSeek models, first-hand.
 *
 * This file is no longer the catalog — `catalog.ts` builds that at runtime from
 * DeepSeek's own `GET /models`. What lives here is the knowledge the network
 * cannot supply:
 *
 * - transport invariants (`api`, `compat`) that belong to our Responses adapter
 *   and must never be driven by a third-party metadata feed;
 * - curated per-id metadata verified against DeepSeek's published pricing page,
 *   which outranks models.dev for ids it covers;
 * - the offline floor: the catalog registered when no fetch has ever succeeded.
 *
 * These ids are conversation models only. They are never written to models.json.
 */
/** Independent extension provider. Must not collide with reserved official `deepseek`. */
export const AUTH_PROVIDER_ID = "deepseek-extended";
export const DEEPSEEK_PROVIDER_ID = AUTH_PROVIDER_ID;
export const DEEPSEEK_PROVIDER_NAME = "DeepSeek Extended";
export const DEEPSEEK_CHAT_API = "openai-responses";
export const DEEPSEEK_RESPONSES_API = DEEPSEEK_CHAT_API;
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
/** Current flagship. Vision-capable, so it is also the multimodal id. */
export const DEEPSEEK_FLASH_MODEL_ID = "deepseek-flash";
export const DEEPSEEK_VISION_MODEL_ID = DEEPSEEK_FLASH_MODEL_ID;
export const DEEPSEEK_PRO_MODEL_ID = "deepseek-v4-pro";
/**
 * Retired names DeepSeek still accepts: requests are served by V4.1 Flash and
 * billed at the Flash price. They are absent from the offline floor so a fresh
 * install does not advertise them, but they keep curated metadata so a session
 * pinned to one — or a `GET /models` that still lists them — is priced right.
 */
export const DEEPSEEK_RETIRED_MODEL_IDS = [
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
];
/**
 * Official effort set (api-docs.deepseek.com/guides/thinking_mode): the API
 * accepts low/high/max and folds minimal→low, medium→high, xhigh→high,
 * ultra→max server-side. We expose low (the cheap tier), high (the default)
 * and max; minimal/medium stay hidden since the fold makes them duplicates.
 */
const V4_THINKING = {
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    max: "max",
};
/**
 * Transport invariants of our Responses adapter, not upstream metadata. A
 * discovered model inherits these unchanged: letting a metadata feed move them
 * would break streaming rather than merely misprice a row.
 */
const V4_COMPAT = {
    supportsStore: false,
    supportsDeveloperRole: false,
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "deepseek",
};
/** Hosted Responses `web_search`. Files API / code_interpreter are phase 2. */
export const DEEPSEEK_HOSTED_TOOLS = {
    tools: ["web_search"],
};
export const DEEPSEEK_CAPABILITIES = {
    hostedTools: { tools: [...DEEPSEEK_HOSTED_TOOLS.tools] },
    structuredOutputs: true,
    nativeSearch: { tools: [...DEEPSEEK_HOSTED_TOOLS.tools] },
};
/**
 * Shape every discovered model inherits before metadata is applied: 1M context,
 * 384K output and the V4 thinking map are family-wide on this endpoint, and
 * hosted `web_search` is on because every DeepSeek Responses model today serves
 * it — defaulting it off would re-create the hand-edit this catalog removes.
 */
export const DEEPSEEK_FAMILY_DEFAULTS = {
    api: DEEPSEEK_CHAT_API,
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    thinkingLevelMap: { ...V4_THINKING },
    compat: { ...V4_COMPAT },
    capabilities: { ...DEEPSEEK_CAPABILITIES },
};
// Off-peak USD / 1M tokens, read off DeepSeek's Models & Pricing page.
// Peak rates (01:00-04:00 and 06:00-10:00 UTC, Mon-Fri) are exactly double;
// the catalog carries one number per model, and off-peak is the convention here.
const FLASH_COST = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 };
const PRO_COST = { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 };
function model(id, name, overrides) {
    return {
        id,
        name,
        api: DEEPSEEK_FAMILY_DEFAULTS.api,
        reasoning: DEEPSEEK_FAMILY_DEFAULTS.reasoning,
        input: [...DEEPSEEK_FAMILY_DEFAULTS.input],
        contextWindow: DEEPSEEK_FAMILY_DEFAULTS.contextWindow,
        maxTokens: DEEPSEEK_FAMILY_DEFAULTS.maxTokens,
        thinkingLevelMap: { ...DEEPSEEK_FAMILY_DEFAULTS.thinkingLevelMap },
        compat: { ...DEEPSEEK_FAMILY_DEFAULTS.compat },
        capabilities: {
            hostedTools: { tools: [...DEEPSEEK_FAMILY_DEFAULTS.capabilities.hostedTools.tools] },
            structuredOutputs: true,
            nativeSearch: { tools: [...DEEPSEEK_FAMILY_DEFAULTS.capabilities.nativeSearch.tools] },
        },
        ...overrides,
        cost: { ...overrides.cost },
    };
}
/**
 * Ids whose economics we verified ourselves. Outranks models.dev, which lags
 * DeepSeek's own releases and has carried costs matching neither its peak nor
 * off-peak table. A superset of the floor: retired-but-accepted aliases live
 * here so they are priced correctly if they still surface.
 */
export const DEEPSEEK_CURATED_MODELS = [
    model(DEEPSEEK_FLASH_MODEL_ID, "DeepSeek Flash", {
        input: ["text", "image"],
        cost: { ...FLASH_COST },
    }),
    model(DEEPSEEK_PRO_MODEL_ID, "DeepSeek V4 Pro", {
        // Vision is explicitly unsupported on Pro; from 2026-09-14 its requests are
        // routed to V4.1 Flash and billed at the Flash price, but the id stays.
        input: ["text"],
        cost: { ...PRO_COST },
    }),
    model("deepseek-v4-flash", "DeepSeek V4 Flash (retired alias)", {
        input: ["text"],
        cost: { ...FLASH_COST },
    }),
    model("deepseek-v4-flash-vision-exp", "DeepSeek V4 Flash Vision (retired alias)", {
        input: ["text", "image"],
        cost: { ...FLASH_COST },
    }),
];
/**
 * Offline floor: the catalog registered before any successful fetch, and after
 * a fetch that failed with no cache on disk. Only currently-published ids.
 */
export const DEEPSEEK_CONVERSATION_MODELS = DEEPSEEK_CURATED_MODELS.filter((candidate) => !DEEPSEEK_RETIRED_MODEL_IDS.includes(candidate.id));
export const DEEPSEEK_CONVERSATION_MODEL_IDS = DEEPSEEK_CONVERSATION_MODELS.map((item) => item.id);
/** Deep copy so callers cannot mutate the shared constants through a registration. */
export function cloneModel(source) {
    return {
        ...source,
        input: [...source.input],
        cost: { ...source.cost },
        ...(source.thinkingLevelMap ? { thinkingLevelMap: { ...source.thinkingLevelMap } } : {}),
        ...(source.compat ? { compat: { ...source.compat } } : {}),
        ...(source.capabilities
            ? {
                capabilities: {
                    hostedTools: { tools: [...source.capabilities.hostedTools.tools] },
                    structuredOutputs: true,
                    nativeSearch: { tools: [...source.capabilities.nativeSearch.tools] },
                },
            }
            : {}),
    };
}
/**
 * Capability evidence: does this model declare hosted `web_search`?
 *
 * The live catalog answers for ids it lists — a discovered model is judged on
 * what was actually registered. An id it does not list falls back to the
 * curated table, so a session pinned to a retired-but-accepted alias keeps
 * server-native search instead of silently dropping to the local tool. An id
 * in neither is unknown, and unknown never grants a capability.
 */
export function modelSupportsHostedWebSearch(modelId, catalog = DEEPSEEK_CURATED_MODELS) {
    const id = typeof modelId === "string" ? modelId.trim() : "";
    if (!id)
        return false;
    const found = catalog.find((candidate) => candidate.id === id)
        ?? DEEPSEEK_CURATED_MODELS.find((candidate) => candidate.id === id);
    const tools = found?.capabilities?.hostedTools.tools.length
        ? found.capabilities.hostedTools.tools
        : (found?.capabilities?.nativeSearch.tools ?? []);
    return tools.includes("web_search");
}
/** Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export function deepseekManifestModels() {
    return DEEPSEEK_CONVERSATION_MODELS.map((item) => ({
        id: item.id,
        name: item.name,
        api: item.api,
        input: [...item.input],
        reasoning: item.reasoning,
        contextWindow: item.contextWindow,
        maxTokens: item.maxTokens,
        cost: { ...item.cost },
        ...(item.thinkingLevelMap ? { thinkingLevelMap: { ...item.thinkingLevelMap } } : {}),
        ...(item.compat ? { compat: { ...item.compat } } : {}),
        capabilities: {
            hostedTools: {
                tools: [...(item.capabilities?.hostedTools.tools ?? DEEPSEEK_HOSTED_TOOLS.tools)],
            },
            structuredOutputs: true,
            nativeSearch: {
                tools: [...(item.capabilities?.nativeSearch.tools ?? DEEPSEEK_HOSTED_TOOLS.tools)],
            },
        },
    }));
}
