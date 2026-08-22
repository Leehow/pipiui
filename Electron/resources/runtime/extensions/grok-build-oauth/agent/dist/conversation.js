/**
 * Conversation request adapter for contributed Grok Build chat models.
 *
 * Pi's built-in `openai-completions` streamer is the session transport
 * (`api` + `baseUrl` + `oauth.getApiKey`). This module is the host-owned,
 * testable seam: HTTPS-only chat completions URL, Bearer from App-profile
 * OAuth credentials, fail-closed without an access token, and no token
 * material in thrown messages.
 */
import { GROK_BUILD_BASE_URL, GROK_BUILD_CHAT_API } from "./models.js";
export { GROK_BUILD_BASE_URL, GROK_BUILD_CHAT_API };
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
/**
 * Build the Chat Completions request that Pi's openai-completions transport
 * would send. Used by tests to prove routing + secrecy without a network.
 */
export function buildConversationRequest(input) {
    const token = accessTokenFromCredentials(input.credentials);
    const modelId = typeof input.modelId === "string" ? input.modelId.trim() : "";
    if (!modelId)
        throw new Error("缺少 Grok Build 对话模型 id");
    const base = assertHttpsBase(input.baseUrl?.trim() || GROK_BUILD_BASE_URL);
    return {
        url: `${base}/chat/completions`,
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
        },
        body: {
            model: modelId,
            stream: true,
            ...(input.messages !== undefined ? { messages: input.messages } : {}),
        },
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
