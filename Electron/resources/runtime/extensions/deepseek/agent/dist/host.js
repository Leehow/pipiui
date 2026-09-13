/**
 * Stable host library entry (`agent/dist/host.js`).
 *
 * The host generically loads `createAuthProvider` from the provider module.
 * This file re-exports the same factory so both hosts consume one source.
 */
export { AUTH_PROVIDER_ID, DEEPSEEK_CONVERSATION_MODELS, DEEPSEEK_CURATED_MODELS, DEEPSEEK_PROVIDER_ID, DEEPSEEK_PROVIDER_NAME, createAuthProvider, createDeepSeekProvider, effectiveCatalog, refreshDeepSeekCatalog, } from "./provider.js";
export const HOST_LIBRARY_VERSION = "1.0.0";
