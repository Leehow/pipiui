export declare const ZERO_COST: Readonly<{
    input: 0;
    output: 0;
    cacheRead: 0;
    cacheWrite: 0;
}>;
/** Shape of a single entry returned by the Qoder /model/list endpoint. */
export interface QoderModelEntry {
    key?: string;
    enable?: boolean;
    display_name?: string;
    max_input_tokens?: number;
    max_output_tokens?: number;
    context_config?: Record<string, {
        token_count?: number;
        is_default?: boolean;
    }>;
    is_vl?: boolean;
    is_reasoning?: boolean;
    thinking_config?: {
        enabled?: {
            efforts?: unknown;
        };
    };
    source?: string;
    [key: string]: unknown;
}
export interface QoderModelDef {
    id: string;
    name: string;
    api: "qoder-api";
    provider: "qoder" | "qoder-cn";
    baseUrl: string;
    reasoning: boolean;
    supportsEffort: boolean;
    input: ("text" | "image")[];
    cost: typeof ZERO_COST;
    contextWindow: number;
    maxTokens: number;
    description?: string;
}
/** Agent state dir; env override (tests) → homedir-based default (production, same as upstream). */
export declare function qoderStateDir(): string;
export declare function getQoderCachePath(mode?: string): string;
/**
 * Resolve the context window a Qoder model actually runs with:
 *   1. the `context_config` tier marked `is_default: true` by the API;
 *   2. else `max_input_tokens` (the API's advertised input limit);
 *   3. else the caller-supplied fallback (existing model value).
 * Never picks the largest tier just because it exists.
 */
export declare function resolveDefaultContextWindow(entry: QoderModelEntry | null | undefined, fallback: number): number;
export declare function readQoderCacheConfigs(mode?: string): Record<string, QoderModelEntry>;
export declare const staticModels: QoderModelDef[];
export declare const staticCnModels: QoderModelDef[];
export declare function getCachedModels(mode?: string): QoderModelDef[];
export declare function getCachedModelConfig(modelKey: string, mode?: string): QoderModelEntry | null;
export declare function isCacheStale(mode?: string): boolean;
export declare function updateQoderModelsCache(authToken: string, userID: string, name: string, email: string, mode?: string): Promise<void>;
