/**
 * Canonical DeepSeek conversation models.
 *
 * Declared once and consumed by:
 * - the Pi provider factory (`createAuthProvider`) so session runtime can stream;
 * - the manifest `auth.provider.models` contribution so the host catalog can
 *   overlay the same ids when the Pi runtime catalog is empty.
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
export const DEEPSEEK_VISION_MODEL_ID = "deepseek-v4-flash-vision-exp";
const V4_THINKING = {
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    max: "max",
};
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
// Off-peak USD / 1M tokens from official pricing (vision matches V4 Flash).
const V4_FLASH_COST = { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0 };
/**
 * Current DeepSeek conversation catalog (phase 1).
 * Vision is the only multimodal id; text model matches the live V4 docs.
 */
export const DEEPSEEK_CONVERSATION_MODELS = [
    {
        id: DEEPSEEK_VISION_MODEL_ID,
        name: "DeepSeek V4 Flash Vision",
        api: DEEPSEEK_CHAT_API,
        reasoning: true,
        input: ["text", "image"],
        cost: { ...V4_FLASH_COST },
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        thinkingLevelMap: { ...V4_THINKING },
        compat: { ...V4_COMPAT },
        capabilities: { ...DEEPSEEK_CAPABILITIES },
    },
    {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: DEEPSEEK_CHAT_API,
        reasoning: true,
        input: ["text"],
        cost: { ...V4_FLASH_COST },
        contextWindow: 1_000_000,
        maxTokens: 384_000,
        thinkingLevelMap: { ...V4_THINKING },
        compat: { ...V4_COMPAT },
        capabilities: { ...DEEPSEEK_CAPABILITIES },
    },
];
export const DEEPSEEK_CONVERSATION_MODEL_IDS = DEEPSEEK_CONVERSATION_MODELS.map((model) => model.id);
/** Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export function deepseekManifestModels() {
    return DEEPSEEK_CONVERSATION_MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        api: model.api,
        input: [...model.input],
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { ...model.cost },
        ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
        ...(model.compat ? { compat: { ...model.compat } } : {}),
        capabilities: {
            hostedTools: {
                tools: [...(model.capabilities?.hostedTools.tools ?? DEEPSEEK_HOSTED_TOOLS.tools)],
            },
            structuredOutputs: true,
            nativeSearch: {
                tools: [...(model.capabilities?.nativeSearch.tools ?? DEEPSEEK_HOSTED_TOOLS.tools)],
            },
        },
    }));
}
