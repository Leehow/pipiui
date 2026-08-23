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
export declare const AUTH_PROVIDER_ID = "deepseek";
export declare const DEEPSEEK_PROVIDER_ID = "deepseek";
export declare const DEEPSEEK_CHAT_API: "openai-responses";
export declare const DEEPSEEK_RESPONSES_API: "openai-responses";
export declare const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export declare const DEEPSEEK_VISION_MODEL_ID = "deepseek-v4-flash-vision-exp";
export type DeepSeekHostedTools = {
    tools: Array<"web_search">;
};
export type DeepSeekModelCapabilities = {
    hostedTools: DeepSeekHostedTools;
    structuredOutputs: true;
    nativeSearch: DeepSeekHostedTools;
};
export type DeepSeekConversationModel = {
    id: string;
    name: string;
    api: typeof DEEPSEEK_CHAT_API;
    reasoning: boolean;
    input: Array<"text" | "image">;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;
    compat?: {
        supportsStore?: boolean;
        supportsDeveloperRole?: boolean;
        requiresReasoningContentOnAssistantMessages?: boolean;
        thinkingFormat?: "deepseek";
    };
    capabilities?: DeepSeekModelCapabilities;
};
/** Hosted Responses `web_search`. Files API / code_interpreter are phase 2. */
export declare const DEEPSEEK_HOSTED_TOOLS: DeepSeekHostedTools;
export declare const DEEPSEEK_CAPABILITIES: DeepSeekModelCapabilities;
/**
 * Current DeepSeek conversation catalog (phase 1).
 * Vision is the only multimodal id; text model matches the live V4 docs.
 */
export declare const DEEPSEEK_CONVERSATION_MODELS: readonly DeepSeekConversationModel[];
export declare const DEEPSEEK_CONVERSATION_MODEL_IDS: readonly string[];
/** Slim Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export declare function deepseekManifestModels(): Array<{
    id: string;
    name: string;
    api: typeof DEEPSEEK_CHAT_API;
    input: string[];
    reasoning: boolean;
    capabilities: DeepSeekModelCapabilities;
}>;
