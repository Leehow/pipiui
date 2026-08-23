/**
 * Conversation request adapter for contributed DeepSeek chat models.
 *
 * Pi's built-in `openai-responses` streamer is the session transport
 * (`api` + `baseUrl` + stored API key). This module is the host-owned,
 * testable seam: HTTPS Responses URLs, Bearer from the Pi credential store
 * (settings fallback), fail-closed without a key, and no key material in
 * thrown messages.
 */
import { type DeepSeekEndpoint, type DeepSeekRequest, type FilesRewriteOptions } from "./client.js";
import { DeepSeekFilesClient } from "./files/client.js";
import { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API } from "./models.js";
export { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API };
/** Pull the API key out of a Pi credential. Never returns refresh tokens. */
export declare function apiKeyFromCredentials(credentials: unknown): string;
/**
 * Pi credential store first, then `ext.deepseek.apiKey`.
 * Throws a user-actionable message and never echoes secrets.
 */
export declare function resolveDeepSeekApiKey(credentials?: unknown): string;
/** Same credential chain as conversation requests: Pi store first, then settings. */
export declare function createConversationFilesClient(input?: {
    credentials?: unknown;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
}): DeepSeekFilesClient;
export declare function buildConversationRequest(input: {
    modelId: string;
    credentials?: unknown;
    messages?: unknown;
    input?: unknown;
    instructions?: string;
    baseUrl?: string;
    endpoint?: DeepSeekEndpoint;
    extra?: Record<string, unknown>;
}): DeepSeekRequest;
export declare function buildConversationRequestAsync(input: {
    modelId: string;
    credentials?: unknown;
    messages?: unknown;
    input?: unknown;
    instructions?: string;
    baseUrl?: string;
    endpoint?: DeepSeekEndpoint;
    extra?: Record<string, unknown>;
    fetchImpl?: typeof fetch;
} & FilesRewriteOptions): Promise<DeepSeekRequest>;
/** Provider-level transport fields consumed by Pi ModelRuntime. */
export declare function conversationProviderTransport(): {
    api: typeof DEEPSEEK_CHAT_API;
    baseUrl: string;
    authHeader: true;
};
