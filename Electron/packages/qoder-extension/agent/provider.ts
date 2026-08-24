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
import {
  getQoderBaseUrl,
  getQoderMode,
  getQoderUserEmailFallback,
  isQoderCNMode,
  toQoderCNFriendlyModel,
} from "./vendor/cosy.js";
import { getCachedModels, staticCnModels, staticModels } from "./vendor/models.js";
import {
  getCachedCredentials,
  loginQoder,
  loginQoderCN,
  refreshQoderToken,
  refreshQoderTokenCN,
} from "./vendor/oauth.js";
import { streamQoder } from "./vendor/stream.js";
import { fetchQoderUsage, fetchQoderUsageCN } from "./vendor/usage.js";

export const AUTH_PROVIDER_ID = "qoder";
export const QODER_PROVIDER_ID = AUTH_PROVIDER_ID;
export const QODER_CN_PROVIDER_ID = "qoder-cn";

type OAuthConfigWithUsage = NonNullable<ProviderConfig["oauth"]> & {
  fetchUsage: (credentials: OAuthCredentials) => Promise<unknown>;
};

export function modelsForProvider(mode: string, providerID: string): Model<Api>[] {
  const cached = getCachedModels(mode);
  const modelsToUse = cached.length > 0 ? cached : isQoderCNMode(mode) ? staticCnModels : staticModels;
  return modelsToUse.map((m) => {
    const model = isQoderCNMode(mode) ? toQoderCNFriendlyModel(m) : m;
    return {
      ...model,
      provider: providerID,
      baseUrl: getQoderBaseUrl(mode),
    };
  }) as unknown as Model<Api>[];
}

function createQoderOAuth(providerID: string, mode: string): OAuthConfigWithUsage {
  return {
    name: isQoderCNMode(mode) ? "Qoder CN (PAT)" : "Qoder (Browser OAuth / PAT)",
    login: isQoderCNMode(mode) ? loginQoderCN : loginQoder,
    refreshToken: isQoderCNMode(mode) ? refreshQoderTokenCN : refreshQoderToken,
    getApiKey: (cred: OAuthCredentials) => cred.access,
    modifyModels: (models: Model<Api>[], _cred: OAuthCredentials) => {
      const nonQoder = models.filter((m: Model<Api>) => m.provider !== providerID);
      return [...nonQoder, ...modelsForProvider(mode, providerID)];
    },
    fetchUsage: isQoderCNMode(mode) ? fetchQoderUsageCN : fetchQoderUsage,
  };
}

export function createQoderProvider(
  providerID = QODER_PROVIDER_ID,
  mode?: string,
): {
  name: string;
  api: string;
  baseUrl: string;
  models: Model<Api>[];
  oauth: OAuthConfigWithUsage;
  streamSimple: typeof streamQoder;
} {
  const resolvedMode = providerID === QODER_CN_PROVIDER_ID ? "cn" : (mode ?? getQoderMode());
  return {
    name: isQoderCNMode(resolvedMode) ? "Qoder CN" : "Qoder",
    api: "qoder-api",
    baseUrl: getQoderBaseUrl(resolvedMode),
    models: modelsForProvider(resolvedMode, providerID),
    oauth: createQoderOAuth(providerID, resolvedMode),
    streamSimple: streamQoder,
  };
}

/** Generic host/loader export — same factory, no Qoder-named import required. */
export const createAuthProvider = (): ReturnType<typeof createQoderProvider> => createQoderProvider(QODER_PROVIDER_ID);

export { getCachedCredentials, getQoderUserEmailFallback };
