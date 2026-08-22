export declare const GROK_BUILD_PROVIDER_ID = "grok-build";
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
    models: never[];
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
