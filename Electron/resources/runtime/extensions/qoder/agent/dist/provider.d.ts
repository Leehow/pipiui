/**
 * Canonical `qoder` provider config (single source).
 *
 * Consumed twice, never copied:
 * - the extension entry (`agent/index.ts`) registers both `qoder` and `qoder-cn`
 *   via the vendored 0.3.0 registrar;
 * - the host generically loads `createAuthProvider` from this module for the
 *   manifest `auth.provider` (id `qoder`).
 */
import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { getQoderUserEmailFallback } from "./vendor/cosy.js";
import { getCachedCredentials } from "./vendor/oauth.js";
import { streamQoder } from "./vendor/stream.js";
export declare const AUTH_PROVIDER_ID = "qoder";
export declare const QODER_PROVIDER_ID = "qoder";
export declare const QODER_CN_PROVIDER_ID = "qoder-cn";
type OAuthConfigWithUsage = NonNullable<ProviderConfig["oauth"]> & {
    fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
};
export declare function modelsForProvider(mode: string, providerID: string): Model<Api>[];
export declare function createQoderProvider(providerID?: string, mode?: string): {
    name: string;
    api: string;
    baseUrl: string;
    models: Model<Api>[];
    oauth: OAuthConfigWithUsage;
    streamSimple: typeof streamQoder;
};
/** Generic host/loader export — same factory, no Qoder-named import required. */
export declare const createAuthProvider: () => ReturnType<typeof createQoderProvider>;
export { getCachedCredentials, getQoderUserEmailFallback };
