/**
 * Canonical Grok Build conversation models.
 *
 * Declared once and consumed by:
 * - the Pi provider factory (`createAuthProvider`) so session runtime can stream;
 * This list is the offline floor only. The async factory prefers the official
 * Grok Build catalog; the manifest must not resurrect retired floor models.
 *
 * Image generation stays on `image_gen` / `image_edit` tools — these ids are
 * conversation models only. They are never written to models.json.
 */
export const AUTH_PROVIDER_ID = "grok-build";
export const GROK_BUILD_PROVIDER_ID = AUTH_PROVIDER_ID;
export const GROK_BUILD_CHAT_API = "openai-responses";
export const GROK_BUILD_BASE_URL = "https://api.x.ai/v1";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
/** Hosted Agent Tools on the Responses API. Domain policy is optional overlay. */
export const GROK_BUILD_NATIVE_SEARCH = {
    tools: ["web_search", "x_search"],
};
export const GROK_BUILD_HOSTED_TOOLS = {
    tools: ["web_search", "x_search", "code_interpreter"],
};
export const GROK_BUILD_CAPABILITIES = {
    hostedTools: { tools: [...GROK_BUILD_HOSTED_TOOLS.tools] },
    structuredOutputs: true,
    inputFiles: true,
    nativeSearch: { tools: [...GROK_BUILD_NATIVE_SEARCH.tools] },
};
/**
 * Concrete, tested Grok Build chat models. Official xAI Responses ids
 * reachable with the grok-build OAuth access token. Keep this list small and
 * explicit as an offline floor. Online metadata comes from catalog.ts.
 */
export const GROK_BUILD_CONVERSATION_MODELS = [
    {
        id: "grok-4.6",
        name: "Grok 4.6",
        api: GROK_BUILD_CHAT_API,
        reasoning: true,
        input: ["text", "image"],
        cost: { ...ZERO_COST },
        contextWindow: 500000,
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
        capabilities: { ...GROK_BUILD_CAPABILITIES },
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
        capabilities: { ...GROK_BUILD_CAPABILITIES },
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
        capabilities: { ...GROK_BUILD_CAPABILITIES },
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
        contextWindow: model.contextWindow,
        capabilities: {
            hostedTools: {
                tools: [...(model.capabilities?.hostedTools.tools ?? GROK_BUILD_HOSTED_TOOLS.tools)],
            },
            structuredOutputs: true,
            inputFiles: true,
            nativeSearch: {
                tools: [...(model.capabilities?.nativeSearch.tools ?? GROK_BUILD_NATIVE_SEARCH.tools)],
            },
        },
    }));
}
