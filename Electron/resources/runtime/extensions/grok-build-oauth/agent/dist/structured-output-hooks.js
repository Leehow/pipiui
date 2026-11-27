/**
 * Production Structured Outputs seam: Pi `before_provider_request`.
 *
 * Official `emitBeforeProviderRequest` swallows ordinary handler throws.
 * Take / normalize / apply failures throw a tagged `PipiUIFatalHookError` so
 * PipiUI's runner patch can abort before the provider HTTP call. Host
 * `assertReadyToSend` still gates capability / Responses API.
 *
 * Official `after_provider_response` is `{status, headers}` only — no Responses
 * body (Pi types + sdk `onResponse`). Do not invent a fake body hook.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
export async function takeStructuredOutputViaBridge(fetchImpl = fetch, ctx) {
    const port = process.env.PIPIUI_BRIDGE_PORT?.trim();
    const capability = process.env.PIPIUI_SESSION_CAPABILITY?.trim();
    if (!port || !capability)
        return undefined;
    const body = JSON.stringify({
        schemaVersion: 1, sessionCapability: capability, action: "structured_output",
        event: { op: "claim", requestId: randomUUID(), until: Date.now() + 25_000 },
    });
    const failure = "无法读取 Structured Output 请求，拒绝静默退化为普通发送";
    for (let attempt = 0;; attempt++) {
        ctx?.signal?.throwIfAborted();
        let json;
        let permanent = false;
        try {
            const timeout = AbortSignal.timeout(5_000);
            const res = await fetchImpl(`http://127.0.0.1:${port}/rpc`, {
                method: "POST", headers: { "content-type": "application/json" }, body,
                signal: ctx?.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
            });
            permanent = !res.ok && res.status < 500 && res.status !== 408 && res.status !== 429;
            if (!res.ok)
                throw new Error(failure);
            json = await res.json();
        }
        catch {
            if (permanent || attempt >= 2 || ctx?.signal?.aborted)
                throw new Error(failure);
            await delay(250 * 2 ** attempt, undefined, { signal: ctx?.signal });
            continue;
        }
        if (!isRecord(json) || json.ok !== true || !("result" in json))
            throw new Error(failure);
        if (json.result === null)
            return undefined;
        return normalizeStructuredOutputRequest(json.result);
    }
}
export function createStructuredOutputHooks(options = {}) {
    const controller = options.controller ?? new StructuredOutputController();
    const takeRequest = options.takeRequest ?? ((sessionId, ctx) => {
        if (!options.controller
            && process.env.PIPIUI_BRIDGE_PORT?.trim()
            && process.env.PIPIUI_SESSION_CAPABILITY?.trim()) {
            return takeStructuredOutputViaBridge(fetch, ctx);
        }
        return controller.take(sessionId);
    });
    let lastName;
    let applied;
    let repeatApplied = false;
    const clearAttempt = () => {
        applied = undefined;
        repeatApplied = false;
    };
    const clearPending = () => {
        clearAttempt();
        lastName = undefined;
        controller.clearAll();
    };
    return {
        clearPending,
        clearAttempt,
        providerAttemptEnded(sessionId, failed) {
            if (applied?.sessionId !== sessionId)
                return;
            if (failed)
                repeatApplied = true;
            else
                clearAttempt();
        },
        async beforeProviderRequest(event, ctx) {
            if (!isRecord(event.payload))
                return;
            const sessionId = sessionIdOf(ctx);
            if (!sessionId)
                return;
            let request;
            try {
                request = repeatApplied && applied?.sessionId === sessionId
                    ? applied.request
                    : await takeRequest(sessionId, ctx);
                clearAttempt();
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
                const payload = applyStructuredOutput(event.payload, request, ctx.model?.capabilities);
                applied = { sessionId, request };
                return payload;
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
    pi.on("message_end", (event, ctx) => {
        if (event.message.role === "assistant") {
            hooks.providerAttemptEnded(sessionIdOf(ctx), event.message.stopReason === "error");
        }
    });
    pi.on("before_agent_start", () => hooks.clearAttempt());
    pi.on("agent_settled", () => hooks.clearAttempt());
    pi.on("after_provider_response", (event, ctx) => hooks.afterProviderResponse(event, ctx));
    pi.on("session_start", () => {
        hooks.clearPending();
    });
    pi.on("session_shutdown", () => {
        hooks.clearPending();
    });
    return hooks;
}
