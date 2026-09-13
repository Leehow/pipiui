import { applyThinkingCap, mergeHostedWebSearchTool, rewriteDeepSeekPayloadAsync } from "./client.js";
import { refreshDeepSeekCatalog } from "./catalog-runtime.js";
import { modelSupportsHostedWebSearch } from "./models.js";
import { createDeepSeekProvider, DEEPSEEK_PROVIDER_ID } from "./provider.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDeepSeekModel(model) {
    return (model?.provider || "").toLowerCase() === DEEPSEEK_PROVIDER_ID;
}
export default function (pi) {
    const registration = createDeepSeekProvider();
    pi.registerProvider(DEEPSEEK_PROVIDER_ID, registration);
    // Capability lookups answer from the catalog that was actually registered, so
    // a model discovered at runtime is not treated as unknown. Held in memory to
    // keep `before_provider_request` off the filesystem.
    let activeCatalog = registration.models;
    // Registration above is synchronous by contract; this refresh runs behind it
    // and lands in the catalog on the next launch.
    void refreshDeepSeekCatalog().then((outcome) => {
        if (outcome.status === "written")
            activeCatalog = outcome.models;
    });
    pi.on("before_provider_request", async (event, ctx) => {
        if (!isDeepSeekModel(ctx.model))
            return;
        if (!isRecord(event.payload))
            return;
        // Server-native search is enabled from declared model capabilities only:
        // supported models get the official Responses built-in `{type:"web_search"}`
        // (never a local function tool); unsupported models are left untouched.
        const payload = mergeHostedWebSearchTool(event.payload, modelSupportsHostedWebSearch(ctx.model?.id, activeCatalog));
        // Thinking-length governor: caps chain-of-thought at ~150 words unless
        // the caller explicitly asked for none/high/max (measured: effort "low"
        // alone does not shorten DeepSeek's thinking).
        return rewriteDeepSeekPayloadAsync(applyThinkingCap(payload));
    });
}
