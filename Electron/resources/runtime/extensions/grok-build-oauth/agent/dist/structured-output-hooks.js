import { StructuredOutputController } from "./structured-output-controller.js";
import { applyStructuredOutput, fatalStructuredOutputError, normalizeStructuredOutputRequest, normalizeStructuredOutputResult, structuredOutputsEnabled, } from "./structured-output.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sessionIdOf(ctx) {
    return ctx.sessionManager?.getSessionId?.()?.trim() ?? "";
}
function isCompletionsPayload(payload) {
    return Array.isArray(payload.messages) && !Array.isArray(payload.input);
}
function isResponsesApi(model) {
    const api = typeof model?.api === "string" ? model.api.trim().toLowerCase() : "";
    if (!api)
        return true;
    return api === "openai-responses" || api.endsWith("-responses") || api === "responses";
}
function responseBodyOf(event) {
    if (event.body !== undefined)
        return event.body;
    if (event.response !== undefined)
        return event.response;
    return undefined;
}
export async function takeStructuredOutputViaBridge(fetchImpl = fetch) {
    const port = process.env.PIPIUI_BRIDGE_PORT?.trim();
    const capability = process.env.PIPIUI_SESSION_CAPABILITY?.trim();
    if (!port || !capability)
        return undefined;
    const res = await fetchImpl(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({
            schemaVersion: 1,
            sessionCapability: capability,
            action: "structured_output",
            event: { op: "take" },
        }),
    });
    const json = (await res.json().catch(() => null));
    if (!isRecord(json) || json.ok !== true) {
        throw new Error("无法读取 Structured Output 请求，拒绝静默退化为普通发送");
    }
    if (json.result == null)
        return undefined;
    return normalizeStructuredOutputRequest(json.result);
}
export function createStructuredOutputHooks(options = {}) {
    const controller = options.controller ?? new StructuredOutputController();
    const takeRequest = options.takeRequest ?? ((sessionId) => {
        if (!options.controller
            && process.env.PIPIUI_BRIDGE_PORT?.trim()
            && process.env.PIPIUI_SESSION_CAPABILITY?.trim()) {
            return takeStructuredOutputViaBridge();
        }
        return controller.take(sessionId);
    });
    let lastName;
    const clearPending = () => {
        lastName = undefined;
        controller.clearAll();
    };
    return {
        clearPending,
        async beforeProviderRequest(event, ctx) {
            if (!isRecord(event.payload))
                return;
            const sessionId = sessionIdOf(ctx);
            if (!sessionId)
                return;
            let request;
            try {
                request = await takeRequest(sessionId);
            }
            catch (error) {
                throw fatalStructuredOutputError(error instanceof Error && /structured output|Structured Output|拒绝/.test(error.message)
                    ? error
                    : "无法读取 Structured Output 请求，拒绝静默退化为普通发送");
            }
            if (!request)
                return;
            lastName = request.name;
            try {
                if (!structuredOutputsEnabled(ctx.model?.capabilities)) {
                    throw new Error("该模型未声明 structuredOutputs 能力，拒绝静默退化为普通发送");
                }
                if (!isResponsesApi(ctx.model) || isCompletionsPayload(event.payload)) {
                    throw new Error("Structured Outputs 仅支持 Responses /responses，拒绝写入 chat/completions");
                }
                return applyStructuredOutput(event.payload, request, ctx.model?.capabilities);
            }
            catch (error) {
                throw fatalStructuredOutputError(error);
            }
        },
        async afterProviderResponse(event, _ctx) {
            const body = responseBodyOf(event);
            if (body === undefined)
                return;
            const result = normalizeStructuredOutputResult(body, lastName);
            lastName = undefined;
            await options.onResult?.(result);
        },
    };
}
export function registerStructuredOutputHooks(pi, options) {
    const hooks = createStructuredOutputHooks(options);
    pi.on("before_provider_request", (event, ctx) => hooks.beforeProviderRequest(event, ctx));
    pi.on("after_provider_response", (event, ctx) => hooks.afterProviderResponse(event, ctx));
    pi.on("session_start", () => {
        hooks.clearPending();
    });
    pi.on("session_shutdown", () => {
        hooks.clearPending();
    });
    return hooks;
}
