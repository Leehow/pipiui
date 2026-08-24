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
/** Generic host/loader export — same factory, no Grok-named import required. */
export declare const createAuthProvider: typeof createGrokBuildProvider;
