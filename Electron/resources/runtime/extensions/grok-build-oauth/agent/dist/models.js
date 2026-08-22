/**
 * Canonical Grok Build conversation models.
 *
 * Declared once and consumed by:
 * - the Pi provider factory (`createAuthProvider`) so session runtime can stream;
 * - the manifest `auth.provider.models` contribution so the host catalog can
 *   overlay the same ids when the Pi runtime catalog is empty.
 *
 * Image generation stays on `image_gen` / `image_edit` tools — these ids are
 * conversation models only. They are never written to models.json.
 */
export const AUTH_PROVIDER_ID = "grok-build";
export const GROK_BUILD_PROVIDER_ID = AUTH_PROVIDER_ID;
export const GROK_BUILD_CHAT_API = "openai-completions";
export const GROK_BUILD_BASE_URL = "https://api.x.ai/v1";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
/**
 * Concrete, tested Grok Build chat models. Official xAI Chat Completions ids
 * reachable with the grok-build OAuth access token. Keep this list small and
 * explicit — do not scrape a live catalog.
 */
export const GROK_BUILD_CONVERSATION_MODELS = [
    {
        id: "grok-4.6",
        name: "Grok 4.6",
        api: GROK_BUILD_CHAT_API,
        reasoning: true,
        input: ["text", "image"],
        cost: { ...ZERO_COST },
        contextWindow: 256000,
        maxTokens: 16384,
        thinkingLevelMap: {
            off: null,
            minimal: "minimal",
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "xhigh",
        },
        compat: { supportsReasoningEffort: true },
    },
    {
        id: "grok-4-fast",
        name: "Grok 4 Fast",
        api: GROK_BUILD_CHAT_API,
        reasoning: false,
        input: ["text"],
        cost: { ...ZERO_COST },
        contextWindow: 256000,
        maxTokens: 16384,
    },
    {
        id: "grok-code-fast-1",
        name: "Grok Code Fast",
        api: GROK_BUILD_CHAT_API,
        reasoning: false,
        input: ["text"],
        cost: { ...ZERO_COST },
        contextWindow: 256000,
        maxTokens: 16384,
    },
];
export const GROK_BUILD_CONVERSATION_MODEL_IDS = GROK_BUILD_CONVERSATION_MODELS.map((model) => model.id);
/** Slim Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export function grokBuildManifestModels() {
    return GROK_BUILD_CONVERSATION_MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        api: model.api,
        input: [...model.input],
        reasoning: model.reasoning,
    }));
}
