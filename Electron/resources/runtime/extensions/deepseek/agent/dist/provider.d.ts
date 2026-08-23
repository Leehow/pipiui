/**
 * Canonical `deepseek` provider config (single source).
 *
 * Consumed twice, never copied:
 * - the extension entry (`agent/index.ts`) registers it via `pi.registerProvider`;
 * - the host generically loads `createAuthProvider` from this module for any
 *   extension that declares `auth.provider` (no DeepSeek-named special case).
 *
 * Secrets never leave the Pi credential store (`auth.json` under the host's Pi home).
 * This module only carries code and non-secret config. Stored API keys win;
 * `ext.deepseek.apiKey` is a settings fallback passed as `apiKey` so Pi's
 * composer uses it only when no stored credential exists.
 */
import { AUTH_PROVIDER_ID, DEEPSEEK_PROVIDER_ID, type DeepSeekConversationModel } from "./models.js";
export { AUTH_PROVIDER_ID, DEEPSEEK_PROVIDER_ID };
export { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API, DEEPSEEK_CONVERSATION_MODEL_IDS, DEEPSEEK_CONVERSATION_MODELS, DEEPSEEK_VISION_MODEL_ID, deepseekManifestModels, } from "./models.js";
export { apiKeyFromCredentials, buildConversationRequest, conversationProviderTransport, resolveDeepSeekApiKey, } from "./conversation.js";
export type DeepSeekProviderOptions = {
    baseUrl?: string;
    /** Test / explicit settings fallback. Never read from ~/.pi. */
    apiKey?: string;
};
/**
 * Build the provider registration payload. The shape matches pi's extension
 * `registerProvider` contract; the host ModelRuntime's `registerProvider`
 * accepts the same fields.
 */
export declare function createDeepSeekProvider(options?: DeepSeekProviderOptions): {
    name: string;
    api: string;
    baseUrl: string;
    authHeader: true;
    apiKey?: string;
    models: DeepSeekConversationModel[];
};
/** Generic host/loader export — same factory, no DeepSeek-named import required. */
export declare const createAuthProvider: typeof createDeepSeekProvider;
