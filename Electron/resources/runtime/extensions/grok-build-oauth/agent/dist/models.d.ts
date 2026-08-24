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
export declare const AUTH_PROVIDER_ID = "grok-build";
export declare const GROK_BUILD_PROVIDER_ID = "grok-build";
export declare const GROK_BUILD_CHAT_API: "openai-responses";
export declare const GROK_BUILD_BASE_URL = "https://api.x.ai/v1";
export type GrokBuildNativeSearch = {
    tools: Array<"web_search" | "x_search">;
    domains?: {
        allow?: string[];
        deny?: string[];
    };
};
export type GrokBuildHostedTools = {
    tools: Array<"web_search" | "x_search" | "code_interpreter">;
    domains?: {
        allow?: string[];
        deny?: string[];
    };
};
export type GrokBuildModelCapabilities = {
    hostedTools: GrokBuildHostedTools;
    structuredOutputs: true;
    inputFiles: true;
    nativeSearch: GrokBuildNativeSearch;
};
export type GrokBuildConversationModel = {
    id: string;
    name: string;
    api: typeof GROK_BUILD_CHAT_API;
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
        supportsReasoningEffort?: boolean;
    };
    capabilities?: GrokBuildModelCapabilities;
};
/** Hosted Agent Tools on the Responses API. Domain policy is optional overlay. */
export declare const GROK_BUILD_NATIVE_SEARCH: GrokBuildNativeSearch;
export declare const GROK_BUILD_HOSTED_TOOLS: GrokBuildHostedTools;
export declare const GROK_BUILD_CAPABILITIES: GrokBuildModelCapabilities;
/**
 * Concrete, tested Grok Build chat models. Official xAI Responses ids
 * reachable with the grok-build OAuth access token. Keep this list small and
 * explicit — do not scrape a live catalog. Reasoning flags stay as declared.
 */
export declare const GROK_BUILD_CONVERSATION_MODELS: readonly GrokBuildConversationModel[];
export declare const GROK_BUILD_CONVERSATION_MODEL_IDS: readonly string[];
/** Slim Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export declare function grokBuildManifestModels(): Array<{
    id: string;
    name: string;
    api: typeof GROK_BUILD_CHAT_API;
    input: string[];
    reasoning: boolean;
    capabilities: GrokBuildModelCapabilities;
}>;
