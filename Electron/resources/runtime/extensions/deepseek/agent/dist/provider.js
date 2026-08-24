/**
 * Canonical `deepseek-extended` provider config (single source).
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
import { resolveDeepSeekConfig } from "./config.js";
import { conversationProviderTransport } from "./conversation.js";
import { AUTH_PROVIDER_ID, DEEPSEEK_CONVERSATION_MODELS, DEEPSEEK_PROVIDER_ID, DEEPSEEK_PROVIDER_NAME, } from "./models.js";
export { AUTH_PROVIDER_ID, DEEPSEEK_PROVIDER_ID, DEEPSEEK_PROVIDER_NAME };
export { DEEPSEEK_BASE_URL, DEEPSEEK_CHAT_API, DEEPSEEK_CONVERSATION_MODEL_IDS, DEEPSEEK_CONVERSATION_MODELS, DEEPSEEK_VISION_MODEL_ID, deepseekManifestModels, } from "./models.js";
export { apiKeyFromCredentials, buildConversationRequest, conversationProviderTransport, resolveDeepSeekApiKey, } from "./conversation.js";
/**
 * Build the provider registration payload. The shape matches pi's extension
 * `registerProvider` contract; the host ModelRuntime's `registerProvider`
 * accepts the same fields.
 */
export function createDeepSeekProvider(options = {}) {
    const cfg = resolveDeepSeekConfig(options);
    const transport = conversationProviderTransport();
    return {
        name: DEEPSEEK_PROVIDER_NAME,
        api: transport.api,
        baseUrl: options.baseUrl?.trim() ? cfg.baseUrl : transport.baseUrl,
        authHeader: transport.authHeader,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        models: DEEPSEEK_CONVERSATION_MODELS.map((model) => ({
            ...model,
            input: [...model.input],
            cost: { ...model.cost },
            ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
            ...(model.compat ? { compat: { ...model.compat } } : {}),
        })),
    };
}
/** Generic host/loader export — same factory, no DeepSeek-named import required. */
export const createAuthProvider = createDeepSeekProvider;
