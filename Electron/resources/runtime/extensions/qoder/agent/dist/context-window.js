/**
 * Qoder CN / Qwen context-window compatibility layer (PipiUI).
 *
 * Upstream `pi-provider-qoder@0.3.0` still takes the LARGEST `context_config`
 * tier as `Model.contextWindow` and rewrites request `model_config` so that
 * tier becomes the default. The API marks the 200K tier `is_default: true`.
 *
 * Vendor `models.ts` is patched so cache reads / writes / request configs use
 * the API default. This layer re-registers both providers on `session_start`
 * so a later cache refresh cannot leave the in-memory model list on the max
 * tier, and so `oauth.modifyModels` stays normalizing.
 */
import { getCachedModels, qoderStateDir, readQoderCacheConfigs, resolveDefaultContextWindow, } from "./vendor/models.js";
import { streamQoder } from "./vendor/stream.js";
export const QODER_PROVIDER_IDS = ["qoder-cn", "qoder"];
export function normalizedModels(models, configsById) {
    if (!models)
        return models;
    if (!configsById)
        return [...models];
    return models.map((model) => {
        const entry = configsById[model.id];
        if (!entry)
            return model;
        return { ...model, contextWindow: resolveDefaultContextWindow(entry, model.contextWindow ?? 0) };
    });
}
export function modelConfigForRequest(entry) {
    if (!entry)
        return null;
    return { ...entry };
}
async function applyQoderContextWindowCompat(pi, ctx) {
    for (const providerId of QODER_PROVIDER_IDS) {
        const mode = providerId === "qoder-cn" ? "cn" : "global";
        const registered = ctx.modelRegistry.getRegisteredProviderConfig(providerId);
        if (!registered)
            continue;
        const provider = ctx.modelRegistry.getProvider(providerId);
        const models = provider?.getModels ? provider.getModels() : getCachedModels(mode);
        const configs = readQoderCacheConfigs(mode);
        const normalized = normalizedModels(models, configs);
        const registration = {
            models: normalized,
            api: registered.api ?? "qoder-api",
            streamSimple: streamQoder,
        };
        if (registered.oauth && typeof registered.oauth === "object") {
            registration.oauth = {
                ...registered.oauth,
                modifyModels: (modelsToRewrite) => normalizedModels(modelsToRewrite, configs),
            };
        }
        pi.registerProvider(providerId, registration);
    }
}
export function registerQoderContextWindowCompat(pi) {
    pi.on("session_start", (_event, ctx) => {
        void applyQoderContextWindowCompat(pi, ctx).catch((error) => {
            console.error(`[pipiui-qoder-compat] session_start apply failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
}
export { qoderStateDir, resolveDefaultContextWindow };
