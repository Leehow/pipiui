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
import { DEEPSEEK_CURATED_MODELS, DEEPSEEK_FAMILY_DEFAULTS, DEEPSEEK_CONVERSATION_MODELS, cloneModel, } from "./models.js";
export const MODELS_DEV_URL = "https://models.dev/api.json";
const MODELS_DEV_PROVIDER = "deepseek";
/** Cost carried by an id no source describes. Family rate, flagged not verified. */
const FAMILY_DEFAULT_COST = (() => {
    const flash = DEEPSEEK_CURATED_MODELS[0];
    if (!flash)
        throw new Error("curated catalog must not be empty");
    return { ...flash.cost };
})();
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positiveInt(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : undefined;
}
function nonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
async function getJson(fetchImpl, url, headers, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { headers, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`${url} responded ${response.status}`);
        }
        return await response.json();
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Live ids for this account, in the order DeepSeek returns them.
 *
 * Ids are taken verbatim: deciding which of them is "a chat model" from the
 * string alone would be a guess, and a wrong guess hides a working model.
 */
export async function fetchDeepSeekModelIds(input) {
    const body = await getJson(input.fetchImpl, `${input.baseUrl.replace(/\/+$/, "")}/models`, { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" }, input.timeoutMs ?? 10_000);
    if (!isRecord(body) || !Array.isArray(body.data)) {
        throw new Error("DeepSeek /models returned an unexpected shape");
    }
    const ids = [];
    for (const entry of body.data) {
        const id = isRecord(entry) && typeof entry.id === "string" ? entry.id.trim() : "";
        if (id && !ids.includes(id))
            ids.push(id);
    }
    if (!ids.length)
        throw new Error("DeepSeek /models returned no ids");
    return ids;
}
function readModelsDevEntry(raw) {
    if (!isRecord(raw))
        return undefined;
    const entry = {};
    if (typeof raw.name === "string" && raw.name.trim())
        entry.name = raw.name.trim();
    if (typeof raw.reasoning === "boolean")
        entry.reasoning = raw.reasoning;
    const modalities = isRecord(raw.modalities) ? raw.modalities : undefined;
    if (modalities && Array.isArray(modalities.input)) {
        const input = modalities.input.filter((item) => item === "text" || item === "image");
        if (input.length)
            entry.input = input;
    }
    const limit = isRecord(raw.limit) ? raw.limit : undefined;
    const context = positiveInt(limit?.context);
    const output = positiveInt(limit?.output);
    if (context !== undefined)
        entry.contextWindow = context;
    if (output !== undefined)
        entry.maxTokens = output;
    const cost = isRecord(raw.cost) ? raw.cost : undefined;
    const costInput = nonNegative(cost?.input);
    const costOutput = nonNegative(cost?.output);
    if (costInput !== undefined && costOutput !== undefined) {
        entry.cost = {
            input: costInput,
            output: costOutput,
            cacheRead: nonNegative(cost?.cache_read) ?? 0,
            cacheWrite: nonNegative(cost?.cache_write) ?? 0,
        };
    }
    return entry;
}
/** DeepSeek's slice of the models.dev catalog, keyed by model id. */
export async function fetchModelsDevMetadata(input) {
    const body = await getJson(input.fetchImpl, input.url ?? MODELS_DEV_URL, { Accept: "application/json" }, input.timeoutMs ?? 20_000);
    const out = new Map();
    if (!isRecord(body))
        return out;
    const provider = isRecord(body[MODELS_DEV_PROVIDER]) ? body[MODELS_DEV_PROVIDER] : undefined;
    const models = provider && isRecord(provider.models) ? provider.models : undefined;
    if (!models)
        return out;
    for (const [id, raw] of Object.entries(models)) {
        const entry = readModelsDevEntry(raw);
        if (entry)
            out.set(id, entry);
    }
    return out;
}
const curatedById = new Map(DEEPSEEK_CURATED_MODELS.map((item) => [item.id, item]));
/** Ids the curated table does not describe — the only reason to pull models.dev. */
export function uncuratedIds(ids) {
    return ids.filter((id) => !curatedById.has(id));
}
function fromFamily(id, metadata) {
    const source = metadata?.cost ? "models.dev" : "family-default";
    return {
        id,
        name: metadata?.name ?? id,
        api: DEEPSEEK_FAMILY_DEFAULTS.api,
        reasoning: metadata?.reasoning ?? DEEPSEEK_FAMILY_DEFAULTS.reasoning,
        input: [...(metadata?.input ?? DEEPSEEK_FAMILY_DEFAULTS.input)],
        cost: { ...(metadata?.cost ?? FAMILY_DEFAULT_COST) },
        contextWindow: metadata?.contextWindow ?? DEEPSEEK_FAMILY_DEFAULTS.contextWindow,
        maxTokens: metadata?.maxTokens ?? DEEPSEEK_FAMILY_DEFAULTS.maxTokens,
        thinkingLevelMap: { ...DEEPSEEK_FAMILY_DEFAULTS.thinkingLevelMap },
        compat: { ...DEEPSEEK_FAMILY_DEFAULTS.compat },
        capabilities: {
            hostedTools: { tools: [...DEEPSEEK_FAMILY_DEFAULTS.capabilities.hostedTools.tools] },
            structuredOutputs: true,
            nativeSearch: { tools: [...DEEPSEEK_FAMILY_DEFAULTS.capabilities.nativeSearch.tools] },
        },
        metadataSource: source,
    };
}
/**
 * Build the catalog for a set of live ids. Curated ids keep their curated order
 * so the default model stays stable across refreshes; anything newly discovered
 * follows in the order DeepSeek listed it.
 */
export function mergeCatalog(input) {
    const live = new Set(input.ids);
    const merged = [];
    for (const curated of DEEPSEEK_CURATED_MODELS) {
        if (!live.has(curated.id))
            continue;
        merged.push({ ...cloneModel(curated), metadataSource: "curated" });
    }
    for (const id of input.ids) {
        if (curatedById.has(id))
            continue;
        merged.push(fromFamily(id, input.metadata?.get(id)));
    }
    return merged;
}
/**
 * One refresh pass. Throws if DeepSeek itself is unreachable — the caller keeps
 * the previous cache. A models.dev failure is not fatal: uncurated ids simply
 * fall back to family defaults rather than losing the whole refresh.
 */
export async function refreshCatalog(input) {
    const ids = await fetchDeepSeekModelIds({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        fetchImpl: input.fetchImpl,
    });
    let metadata;
    let usedModelsDev = false;
    if (uncuratedIds(ids).length) {
        usedModelsDev = true;
        try {
            metadata = await fetchModelsDevMetadata({
                fetchImpl: input.fetchImpl,
                ...(input.modelsDevUrl ? { url: input.modelsDevUrl } : {}),
            });
        }
        catch (error) {
            input.onWarn?.(`models.dev metadata unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { models: mergeCatalog({ ids, ...(metadata ? { metadata } : {}) }), usedModelsDev };
}
/** The floor, deep-copied, for callers that have no cache yet. */
export function floorCatalog() {
    return DEEPSEEK_CONVERSATION_MODELS.map((item) => ({
        ...cloneModel(item),
        metadataSource: "curated",
    }));
}
