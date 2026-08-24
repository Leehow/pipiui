/**
 * Conversation request adapter for contributed Grok Build chat models.
 *
 * Pi's built-in `openai-responses` streamer is the session transport
 * (`api` + `baseUrl` + `oauth.getApiKey`). This module is the host-owned,
 * testable seam: HTTPS-only Responses URL, Bearer from App-profile
 * OAuth credentials, fail-closed without an access token, no token
 * material in thrown messages, hosted `web_search` / `x_search` only when
 * the catalog declares `nativeSearch` (no default-search fallback),
 * hosted `code_interpreter` when the model declares it (plus Responses
 * `include: ["code_interpreter_call.outputs"]`), optional structured
 * output via `applyStructuredOutput` (Responses `text.format` /
 * `json_schema`, never a tool), and optional materialized input files
 * (`{type:"input_file",file_id}`) last.
 */
import { GROK_BUILD_BASE_URL, GROK_BUILD_CHAT_API } from "./models.js";
import { applyHostedSearchToPayload, nativeSearchFromUnknown, } from "./hosted-search.js";
import { applyCodeInterpreterToPayload, codeInterpreterFromCapabilities, } from "./hosted-code-interpreter.js";
import { applyStructuredOutput, } from "./structured-output.js";
import { applyMaterializedInputFiles } from "./files/input.js";
import { modelHasInputFiles } from "./files/types.js";
export { GROK_BUILD_BASE_URL, GROK_BUILD_CHAT_API };
export { applyStructuredOutput, normalizeStructuredOutputResult, structuredOutputsEnabled, } from "./structured-output.js";
export { applyMaterializedInputFiles } from "./files/input.js";
export { modelHasInputFiles } from "./files/types.js";
/** Pull the access token out of a Pi OAuth credential. Never returns refresh. */
export function accessTokenFromCredentials(credentials) {
    const record = credentials && typeof credentials === "object" && !Array.isArray(credentials)
        ? credentials
        : undefined;
    const access = record?.access;
    if (typeof access !== "string" || !access.trim()) {
        throw new Error("未登录 — 请先登录 Grok Build");
    }
    return access;
}
function assertHttpsBase(baseUrl) {
    let protocol;
    try {
        protocol = new URL(baseUrl).protocol;
    }
    catch {
        /* fall through */
    }
    if (protocol !== "https:") {
        throw new Error("Grok Build 对话请求仅允许 HTTPS");
    }
    return baseUrl.replace(/\/+$/, "");
}
function resolveNativeSearch(input) {
    if (input.nativeSearch)
        return input.nativeSearch;
    const caps = input.capabilities;
    const fromRecord = caps && typeof caps === "object" && caps !== null && !Array.isArray(caps)
        ? nativeSearchFromUnknown(caps.nativeSearch)
            ?? nativeSearchFromUnknown(caps.hostedTools)
        : undefined;
    return fromRecord ?? nativeSearchFromUnknown(caps);
}
function resolveCodeInterpreter(input) {
    if (input.codeInterpreter === false)
        return false;
    return codeInterpreterFromCapabilities(input.capabilities) === true;
}
/**
 * Build the Responses request that Pi's openai-responses transport would send.
 * Used by tests to prove routing + secrecy + hosted tools without a network.
 */
function resolveInputFiles(input) {
    const files = input.inputFiles;
    if (!files?.length)
        return undefined;
    if (!modelHasInputFiles({ capabilities: input.capabilities })) {
        throw new Error("该模型未声明 inputFiles 能力");
    }
    return files;
}
export function buildConversationRequest(input) {
    const token = accessTokenFromCredentials(input.credentials);
    const modelId = typeof input.modelId === "string" ? input.modelId.trim() : "";
    if (!modelId)
        throw new Error("缺少 Grok Build 对话模型 id");
    const baseUrl = assertHttpsBase(input.baseUrl?.trim() || GROK_BUILD_BASE_URL);
    const nativeSearch = resolveNativeSearch(input);
    const base = {
        model: modelId,
        stream: true,
        ...(input.input !== undefined
            ? { input: input.input }
            : input.messages !== undefined
                ? { input: input.messages }
                : {}),
        ...(input.tools !== undefined ? { tools: input.tools } : {}),
    };
    const composed = applyStructuredOutput(applyCodeInterpreterToPayload(nativeSearch ? applyHostedSearchToPayload(base, nativeSearch) : base, resolveCodeInterpreter(input)), input.structuredOutput, input.capabilities);
    const files = resolveInputFiles(input);
    const payload = files ? applyMaterializedInputFiles(composed, files) : composed;
    return {
        url: `${baseUrl}/responses`,
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
        },
        body: payload,
    };
}
/** Provider-level transport fields consumed by Pi ModelRuntime. */
export function conversationProviderTransport() {
    return {
        api: GROK_BUILD_CHAT_API,
        baseUrl: GROK_BUILD_BASE_URL,
        authHeader: true,
    };
}
