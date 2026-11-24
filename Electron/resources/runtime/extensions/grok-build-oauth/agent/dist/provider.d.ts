/**
 * Canonical `grok-build` provider config (single source, spec §3).
 *
 * Consumed twice, never copied:
 * - the extension entry (`agent/index.ts`) registers it via `pi.registerProvider`;
 * - the host generically loads `createAuthProvider` from this module for any
 *   extension that declares `auth.provider` (no Grok-named special case).
 *
 * Secrets never leave the pi credential store (`auth.json` under the host's Pi home);
 * this module only carries code and non-secret config. The provider NEVER
 * touches the store itself — `login` returns the credential for pi to persist,
 * and `refreshToken` is a pure network refresh whose result pi persists inside
 * its own `credentials.modify()` (which already holds the store lock).
 */
import { type CatalogOptions } from "./catalog.js";
import { AUTH_PROVIDER_ID, GROK_BUILD_PROVIDER_ID, type GrokBuildConversationModel } from "./models.js";
export { AUTH_PROVIDER_ID, GROK_BUILD_PROVIDER_ID };
export { GROK_BUILD_BASE_URL, GROK_BUILD_CHAT_API, GROK_BUILD_CONVERSATION_MODEL_IDS, GROK_BUILD_CONVERSATION_MODELS, GROK_BUILD_NATIVE_SEARCH, grokBuildManifestModels, } from "./models.js";
export { accessTokenFromCredentials, applyMaterializedInputFiles, applyStructuredOutput, buildConversationRequest, conversationProviderTransport, modelHasInputFiles, normalizeStructuredOutputResult, structuredOutputsEnabled, } from "./conversation.js";
export type { MaterializedInputFile, SafeInputFile, StructuredOutputRequest, StructuredOutputResult, } from "./conversation.js";
export { applyHostedSearchToPayload, collectResponsesStream, hostedSearchToolsOf, mergeHostedSearchTools, } from "./hosted-search.js";
export { applyCodeInterpreterToPayload, collectCodeInterpreterStream, mergeCodeInterpreterTool, modelHasCodeInterpreter, } from "./hosted-code-interpreter.js";
export type GrokBuildEmit = (event: string, payload?: unknown) => Promise<void> | void;
export type GrokBuildProviderOptions = {
    /** Best-effort bridge emitter; omitted in the host auth runtime (no bridge there). */
    emit?: GrokBuildEmit;
    /** Test hook: inject the token-endpoint transport (defaults to global fetch). */
    fetchImpl?: typeof fetch;
};
export type GrokBuildOAuthCredentials = {
    access: string;
    refresh?: string;
    expires: number;
    issuer?: string;
    client_id?: string;
    scopes?: string | string[];
    token_type?: string;
    obtained_at?: number;
};
/**
 * Build the provider registration payload. The shape matches pi's extension
 * `registerProvider` contract; the host ModelRuntime's `registerProvider`
 * accepts the same `oauth` block (ExtensionOAuthConfig).
 */
export declare function createGrokBuildProvider(options?: GrokBuildProviderOptions): {
    name: string;
    api: string;
    baseUrl: string;
    authHeader: true;
    models: GrokBuildConversationModel[];
    oauth: {
        name: string;
        login(callbacks: {
            signal?: AbortSignal;
            onSelect?(prompt: {
                message: string;
                options: {
                    id: string;
                    label: string;
                }[];
            }): Promise<string>;
            onAuth?(event: {
                url: string;
                instructions?: string;
            }): void;
            onDeviceCode?(event: {
                userCode: string;
                verificationUri: string;
                intervalSeconds?: number;
                expiresInSeconds?: number;
            }): void;
        }): Promise<GrokBuildOAuthCredentials>;
        refreshToken(credentials: unknown, signal?: AbortSignal): Promise<GrokBuildOAuthCredentials>;
        getApiKey(credentials: unknown): string;
    };
};
/** Generic host/session factory; await the official catalog before registering. */
export declare function createAuthProvider(options?: GrokBuildProviderOptions & CatalogOptions): Promise<{
    name: string;
    api: string;
    baseUrl: string;
    authHeader: true;
    models: GrokBuildConversationModel[];
    oauth: {
        name: string;
        login(callbacks: {
            signal?: AbortSignal;
            onSelect?(prompt: {
                message: string;
                options: {
                    id: string;
                    label: string;
                }[];
            }): Promise<string>;
            onAuth?(event: {
                url: string;
                instructions?: string;
            }): void;
            onDeviceCode?(event: {
                userCode: string;
                verificationUri: string;
                intervalSeconds?: number;
                expiresInSeconds?: number;
            }): void;
        }): Promise<GrokBuildOAuthCredentials>;
        refreshToken(credentials: unknown, signal?: AbortSignal): Promise<GrokBuildOAuthCredentials>;
        getApiKey(credentials: unknown): string;
    };
}>;
