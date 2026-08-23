import { rewriteDeepSeekPayloadAsync } from "./client.js";
import { createDeepSeekProvider, DEEPSEEK_PROVIDER_ID } from "./provider.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDeepSeekModel(model) {
    return (model?.provider || "").toLowerCase() === DEEPSEEK_PROVIDER_ID;
}
export default function (pi) {
    pi.registerProvider(DEEPSEEK_PROVIDER_ID, createDeepSeekProvider());
    pi.on("before_provider_request", async (event, ctx) => {
        if (!isDeepSeekModel(ctx.model))
            return;
        if (!isRecord(event.payload))
            return;
        return rewriteDeepSeekPayloadAsync(event.payload);
    });
}
