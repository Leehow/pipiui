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
export declare const AUTH_PROVIDER_ID = "deepseek-extended";
export declare const DEEPSEEK_PROVIDER_ID = "deepseek-extended";
export declare const DEEPSEEK_PROVIDER_NAME = "DeepSeek Extended";
export declare const DEEPSEEK_CHAT_API: "openai-responses";
export declare const DEEPSEEK_RESPONSES_API: "openai-responses";
export declare const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
/** Current flagship. Vision-capable, so it is also the multimodal id. */
export declare const DEEPSEEK_FLASH_MODEL_ID = "deepseek-flash";
export declare const DEEPSEEK_VISION_MODEL_ID = "deepseek-flash";
export declare const DEEPSEEK_PRO_MODEL_ID = "deepseek-v4-pro";
/**
 * Retired names DeepSeek still accepts: requests are served by V4.1 Flash and
 * billed at the Flash price. They are absent from the offline floor so a fresh
 * install does not advertise them, but they keep curated metadata so a session
 * pinned to one — or a `GET /models` that still lists them — is priced right.
 */
export declare const DEEPSEEK_RETIRED_MODEL_IDS: readonly ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];
export type DeepSeekHostedTools = {
    tools: Array<"web_search">;
};
export type DeepSeekModelCapabilities = {
    hostedTools: DeepSeekHostedTools;
    structuredOutputs: true;
    nativeSearch: DeepSeekHostedTools;
};
/** Where a catalog row's economics came from. Surfaced so unverified rows are visible. */
export type DeepSeekMetadataSource = "curated" | "models.dev" | "family-default";
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
    /** Absent on the floor and on curated rows; set by the runtime merge. */
    metadataSource?: DeepSeekMetadataSource;
};
/** Hosted Responses `web_search`. Files API / code_interpreter are phase 2. */
export declare const DEEPSEEK_HOSTED_TOOLS: DeepSeekHostedTools;
export declare const DEEPSEEK_CAPABILITIES: DeepSeekModelCapabilities;
/**
 * Shape every discovered model inherits before metadata is applied: 1M context,
 * 384K output and the V4 thinking map are family-wide on this endpoint, and
 * hosted `web_search` is on because every DeepSeek Responses model today serves
 * it — defaulting it off would re-create the hand-edit this catalog removes.
 */
export declare const DEEPSEEK_FAMILY_DEFAULTS: {
    readonly api: "openai-responses";
    readonly reasoning: true;
    readonly input: Array<"text" | "image">;
    readonly contextWindow: 1000000;
    readonly maxTokens: 384000;
    readonly thinkingLevelMap: {
        readonly minimal: null;
        readonly low: "low";
        readonly medium: null;
        readonly high: "high";
        readonly max: "max";
    };
    readonly compat: {
        readonly supportsStore: false;
        readonly supportsDeveloperRole: false;
        readonly requiresReasoningContentOnAssistantMessages: true;
        readonly thinkingFormat: "deepseek";
    };
    readonly capabilities: {
        readonly hostedTools: DeepSeekHostedTools;
        readonly structuredOutputs: true;
        readonly nativeSearch: DeepSeekHostedTools;
    };
};
/**
 * Ids whose economics we verified ourselves. Outranks models.dev, which lags
 * DeepSeek's own releases and has carried costs matching neither its peak nor
 * off-peak table. A superset of the floor: retired-but-accepted aliases live
 * here so they are priced correctly if they still surface.
 */
export declare const DEEPSEEK_CURATED_MODELS: readonly DeepSeekConversationModel[];
/**
 * Offline floor: the catalog registered before any successful fetch, and after
 * a fetch that failed with no cache on disk. Only currently-published ids.
 */
export declare const DEEPSEEK_CONVERSATION_MODELS: readonly DeepSeekConversationModel[];
export declare const DEEPSEEK_CONVERSATION_MODEL_IDS: readonly string[];
/** Deep copy so callers cannot mutate the shared constants through a registration. */
export declare function cloneModel(source: DeepSeekConversationModel): DeepSeekConversationModel;
/**
 * Capability evidence: does this model declare hosted `web_search`?
 *
 * The live catalog answers for ids it lists — a discovered model is judged on
 * what was actually registered. An id it does not list falls back to the
 * curated table, so a session pinned to a retired-but-accepted alias keeps
 * server-native search instead of silently dropping to the local tool. An id
 * in neither is unknown, and unknown never grants a capability.
 */
export declare function modelSupportsHostedWebSearch(modelId: unknown, catalog?: readonly DeepSeekConversationModel[]): boolean;
/** Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export declare function deepseekManifestModels(): Array<{
    id: string;
    name: string;
    api: typeof DEEPSEEK_CHAT_API;
    input: string[];
    reasoning: boolean;
    contextWindow: number;
    maxTokens: number;
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    thinkingLevelMap?: DeepSeekConversationModel["thinkingLevelMap"];
    compat?: DeepSeekConversationModel["compat"];
    capabilities: DeepSeekModelCapabilities;
}>;
