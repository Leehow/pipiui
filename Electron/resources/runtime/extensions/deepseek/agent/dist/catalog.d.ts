/**
 * Runtime model discovery for `deepseek-extended`.
 *
 * DeepSeek's `GET /models` is authoritative for which ids an account can call,
 * but it returns `{id, object, owned_by}` and nothing else — no price, no
 * context window, no modality. So discovery is a merge of three ranked sources:
 *
 *   1. `agent/models.ts` curated rows — verified against DeepSeek's own pricing
 *      page, so they win outright for the ids they cover;
 *   2. models.dev — community metadata, used only for ids we have not curated
 *      (it lags DeepSeek's releases and has published costs matching neither
 *      DeepSeek's peak nor off-peak table, so it must not overwrite (1));
 *   3. family defaults — a brand-new id still becomes usable, priced at the
 *      family rate and tagged `family-default` so the guess stays visible.
 *
 * Transport fields (`api`, `compat`) never come from the network.
 */
import { type DeepSeekConversationModel } from "./models.js";
export declare const MODELS_DEV_URL = "https://models.dev/api.json";
export type FetchLike = (url: string, init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}>;
/**
 * Live ids for this account, in the order DeepSeek returns them.
 *
 * Ids are taken verbatim: deciding which of them is "a chat model" from the
 * string alone would be a guess, and a wrong guess hides a working model.
 */
export declare function fetchDeepSeekModelIds(input: {
    baseUrl: string;
    apiKey: string;
    fetchImpl: FetchLike;
    timeoutMs?: number;
}): Promise<string[]>;
export type ModelsDevEntry = {
    name?: string;
    reasoning?: boolean;
    input?: Array<"text" | "image">;
    contextWindow?: number;
    maxTokens?: number;
    cost?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
};
/** DeepSeek's slice of the models.dev catalog, keyed by model id. */
export declare function fetchModelsDevMetadata(input: {
    fetchImpl: FetchLike;
    url?: string;
    timeoutMs?: number;
}): Promise<Map<string, ModelsDevEntry>>;
/** Ids the curated table does not describe — the only reason to pull models.dev. */
export declare function uncuratedIds(ids: readonly string[]): string[];
/**
 * Build the catalog for a set of live ids. Curated ids keep their curated order
 * so the default model stays stable across refreshes; anything newly discovered
 * follows in the order DeepSeek listed it.
 */
export declare function mergeCatalog(input: {
    ids: readonly string[];
    metadata?: Map<string, ModelsDevEntry>;
}): DeepSeekConversationModel[];
export type CatalogRefreshResult = {
    models: DeepSeekConversationModel[];
    /** True when models.dev was consulted; it is skipped when every id is curated. */
    usedModelsDev: boolean;
};
/**
 * One refresh pass. Throws if DeepSeek itself is unreachable — the caller keeps
 * the previous cache. A models.dev failure is not fatal: uncurated ids simply
 * fall back to family defaults rather than losing the whole refresh.
 */
export declare function refreshCatalog(input: {
    baseUrl: string;
    apiKey: string;
    fetchImpl: FetchLike;
    modelsDevUrl?: string;
    onWarn?: (message: string) => void;
}): Promise<CatalogRefreshResult>;
/** The floor, deep-copied, for callers that have no cache yet. */
export declare function floorCatalog(): DeepSeekConversationModel[];
