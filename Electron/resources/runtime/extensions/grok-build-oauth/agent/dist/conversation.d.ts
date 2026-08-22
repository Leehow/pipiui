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
export type ConversationRequest = {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};
/** Pull the access token out of a Pi OAuth credential. Never returns refresh. */
export declare function accessTokenFromCredentials(credentials: unknown): string;
/**
 * Build the Chat Completions request that Pi's openai-completions transport
 * would send. Used by tests to prove routing + secrecy without a network.
 */
export declare function buildConversationRequest(input: {
    modelId: string;
    credentials: unknown;
    messages?: unknown;
    baseUrl?: string;
}): ConversationRequest;
/** Provider-level transport fields consumed by Pi ModelRuntime. */
export declare function conversationProviderTransport(): {
    api: typeof GROK_BUILD_CHAT_API;
    baseUrl: string;
    authHeader: true;
};
