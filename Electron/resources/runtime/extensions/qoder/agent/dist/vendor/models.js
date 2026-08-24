import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildAuthHeaders, getQoderBaseUrl, getQoderCNFriendlyModelInfo, getQoderMode, getQoderModelListURL, isQoderCNMode, } from "./cosy.js";
export const ZERO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
/** Agent state dir; env override (tests) → homedir-based default (production, same as upstream). */
export function qoderStateDir() {
    return process.env.PIPIUI_QODER_AGENT_DIR || join(homedir(), ".pi", "agent");
}
export function getQoderCachePath(mode) {
    return join(qoderStateDir(), isQoderCNMode(mode) ? "qoder-cn-models-cache.json" : "qoder-models-cache.json");
}
/**
 * Resolve the context window a Qoder model actually runs with:
 *   1. the `context_config` tier marked `is_default: true` by the API;
 *   2. else `max_input_tokens` (the API's advertised input limit);
 *   3. else the caller-supplied fallback (existing model value).
 * Never picks the largest tier just because it exists.
 */
export function resolveDefaultContextWindow(entry, fallback) {
    if (entry && typeof entry.context_config === "object" && entry.context_config !== null) {
        for (const tier of Object.values(entry.context_config)) {
            if (tier &&
                typeof tier === "object" &&
                tier.is_default === true &&
                typeof tier.token_count === "number" &&
                tier.token_count > 0) {
                return tier.token_count;
            }
        }
    }
    if (entry && typeof entry.max_input_tokens === "number" && entry.max_input_tokens > 0) {
        return entry.max_input_tokens;
    }
    return fallback;
}
export function readQoderCacheConfigs(mode) {
    const cachePath = getQoderCachePath(mode);
    if (!existsSync(cachePath))
        return {};
    try {
        const data = JSON.parse(readFileSync(cachePath, "utf8"));
        return data?.configs && typeof data.configs === "object" ? data.configs : {};
    }
    catch {
        return {};
    }
}
function withNormalizedContextWindow(model, configs) {
    const entry = configs[model.id];
    if (!entry)
        return model;
    return { ...model, contextWindow: resolveDefaultContextWindow(entry, model.contextWindow) };
}
export const staticModels = [
    {
        id: "auto",
        name: "Qoder Auto",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180000,
        maxTokens: 32768,
    },
    {
        id: "ultimate",
        name: "Qoder Ultimate",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "performance",
        name: "Qoder Performance",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "efficient",
        name: "Qoder Efficient",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180000,
        maxTokens: 32768,
    },
    {
        id: "lite",
        name: "Qoder Lite",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: false,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 180000,
        maxTokens: 32768,
    },
    {
        id: "qmodel",
        name: "Qwen3.7 Plus (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "cmodel",
        name: "Cantus (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "qmodel_preview",
        name: "Qwen3.8 Max Preview (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "qmodel_latest",
        name: "Qwen3.7 Max (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "dmodel",
        name: "DeepSeek V4 Pro (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "dfmodel",
        name: "DeepSeek V4 Flash (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "gm51model",
        name: "GLM 5.2 (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: true,
        supportsEffort: true,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "kmodel",
        name: "Kimi K2.7 Code (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 256000,
        maxTokens: 32768,
    },
    {
        id: "kmodel_latest",
        name: "Kimi K3 (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
    {
        id: "mmodel",
        name: "MiniMax M3 (Qoder)",
        api: "qoder-api",
        provider: "qoder",
        baseUrl: "https://api3.qoder.sh/",
        reasoning: false,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
    },
];
export const staticCnModels = [
    {
        id: "auto",
        name: "Auto · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 180000,
        maxTokens: 32768,
        description: "Qoder CN smart routing; live catalog reports 180K max input.",
    },
    {
        id: "qwen3.7-max",
        name: "Qwen 3.7 Max · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
        description: "Qoder CN qmodel_latest; context options 200K/400K/1M.",
    },
    {
        id: "qwen3.7-plus",
        name: "Qwen 3.7 Plus · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
        description: "Qoder CN qmodel; context options 200K/400K/1M.",
    },
    {
        id: "qwen3.6-flash",
        name: "Qwen 3.6 Flash · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
        description: "Qoder CN q36fmodel; context options 200K/400K/1M.",
    },
    {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
        description: "Qoder CN dmodel; context options 200K/400K/1M.",
    },
    {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: false,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
        description: "Qoder CN dfmodel; context options 200K/400K/1M.",
    },
    {
        id: "glm-5.2",
        name: "GLM 5.2 · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 200000,
        maxTokens: 32768,
        description: "Qoder CN gm51model; live catalog currently displays GLM-5.2 with 200K context.",
    },
    {
        id: "kimi-k2.6",
        name: "Kimi K2.6 · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: true,
        supportsEffort: false,
        input: ["text", "image"],
        cost: ZERO_COST,
        contextWindow: 256000,
        maxTokens: 32768,
        description: "Qoder CN kmodel; context option 256K.",
    },
    {
        id: "minimax-m2.7",
        name: "MiniMax M2.7 · Qoder CN",
        api: "qoder-api",
        provider: "qoder-cn",
        baseUrl: getQoderBaseUrl("cn"),
        reasoning: false,
        supportsEffort: false,
        input: ["text"],
        cost: ZERO_COST,
        contextWindow: 200000,
        maxTokens: 32768,
        description: "Qoder CN mmodel; live catalog reports 200K context.",
    },
];
export function getCachedModels(mode) {
    const cachePath = getQoderCachePath(mode);
    if (existsSync(cachePath)) {
        try {
            const data = JSON.parse(readFileSync(cachePath, "utf8"));
            if (data && Array.isArray(data.models)) {
                // Older releases injected `auto` without a corresponding service config.
                // Keep an explicitly enabled service model, but drop the legacy fallback.
                const configs = data.configs && typeof data.configs === "object"
                    ? data.configs
                    : {};
                const models = data.configs && typeof data.configs === "object" && !data.configs.auto
                    ? data.models.filter((model) => model.id !== "auto")
                    : data.models;
                return models.map((model) => withNormalizedContextWindow(model, configs));
            }
        }
        catch { }
    }
    return isQoderCNMode(mode) ? staticCnModels : staticModels;
}
export function getCachedModelConfig(modelKey, mode) {
    const cachePath = getQoderCachePath(mode);
    if (existsSync(cachePath)) {
        try {
            const data = JSON.parse(readFileSync(cachePath, "utf8"));
            if (data?.configs?.[modelKey]) {
                // PipiUI: keep the API-marked default tier. Upstream 0.3.0 still calls
                // withMaxContextAsDefault here, which flips is_default onto the largest tier.
                return data.configs[modelKey];
            }
        }
        catch { }
    }
    if (isQoderCNMode(mode)) {
        const reasoningModels = new Set([
            "qoder-cn",
            "auto",
            "qmodel_latest",
            "qmodel",
            "q36fmodel",
            "qfmodel",
            "dmodel",
            "gm51model",
            "kmodel",
            "qwen3.7-max",
            "qwen3.7-plus",
            "qwen3.6-plus",
            "qwen3.6-flash",
            "deepseek-v4-pro",
            "glm-5.2",
            "glm-5.1",
            "kimi-k2.6",
        ]);
        return {
            key: modelKey,
            is_reasoning: reasoningModels.has(modelKey),
            max_output_tokens: 32768,
            source: "system",
        };
    }
    return null;
}
export function isCacheStale(mode) {
    const cachePath = getQoderCachePath(mode);
    if (!existsSync(cachePath))
        return true;
    try {
        const data = JSON.parse(readFileSync(cachePath, "utf8"));
        if (!data || typeof data.updatedAt !== "number")
            return true;
        // Stale if older than 1 hour
        return Date.now() - data.updatedAt > 3600_000;
    }
    catch {
        return true;
    }
}
export async function updateQoderModelsCache(authToken, userID, name, email, mode = getQoderMode()) {
    const modelListURL = getQoderModelListURL(mode);
    try {
        const headers = buildAuthHeaders(null, modelListURL, {
            userID,
            authToken,
            name,
            email,
        });
        const response = await fetch(modelListURL, {
            method: "GET",
            headers: {
                Accept: "application/json",
                ...headers,
            },
        });
        if (!response.ok) {
            return;
        }
        const resData = (await response.json());
        const chatModels = resData.chat || [];
        if (chatModels.length === 0)
            return;
        const newModels = [];
        const configs = {};
        for (const entry of chatModels) {
            const key = entry.key;
            if (!key || !entry.enable)
                continue;
            const display = entry.display_name || key;
            const ctxLen = resolveDefaultContextWindow(entry, entry.max_input_tokens || 180000);
            const isVL = !!entry.is_vl;
            const isReasoning = !!entry.is_reasoning || !!entry.thinking_config;
            const supportsEffort = !!entry.thinking_config?.enabled?.efforts;
            const modelInfo = isQoderCNMode(mode) ? getQoderCNFriendlyModelInfo(key, display) : { id: key, name: display };
            configs[key] = entry;
            if (modelInfo.id !== key)
                configs[modelInfo.id] = entry;
            newModels.push({
                id: modelInfo.id,
                name: modelInfo.name,
                api: "qoder-api",
                provider: isQoderCNMode(mode) ? "qoder-cn" : "qoder",
                baseUrl: getQoderBaseUrl(mode),
                reasoning: isReasoning,
                supportsEffort,
                input: isVL ? ["text", "image"] : ["text"],
                cost: ZERO_COST,
                contextWindow: ctxLen,
                maxTokens: entry.max_output_tokens || 32768,
            });
        }
        if (newModels.length === 0)
            return;
        const cacheData = {
            updatedAt: Date.now(),
            models: newModels,
            configs,
        };
        const cachePath = getQoderCachePath(mode);
        mkdirSync(dirname(cachePath), { recursive: true });
        writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), "utf-8");
    }
    catch { }
}
