/**
 * Canonical `qoder` provider config (single source).
 *
 * Consumed twice, never copied:
 * - the extension entry (`agent/index.ts`) registers both `qoder` and `qoder-cn`
 *   via the vendored 0.3.0 registrar;
 * - the host generically loads `createAuthProvider` from this module for the
 *   manifest `auth.provider` (id `qoder`).
 */
import { getQoderBaseUrl, getQoderMode, getQoderUserEmailFallback, isQoderCNMode, toQoderCNFriendlyModel, } from "./vendor/cosy.js";
import { getCachedModels, staticCnModels, staticModels } from "./vendor/models.js";
import { getCachedCredentials, loginQoder, loginQoderCN, refreshQoderToken, refreshQoderTokenCN, } from "./vendor/oauth.js";
import { streamQoder } from "./vendor/stream.js";
import { fetchQoderUsage, fetchQoderUsageCN } from "./vendor/usage.js";
export const AUTH_PROVIDER_ID = "qoder";
export const QODER_PROVIDER_ID = AUTH_PROVIDER_ID;
export const QODER_CN_PROVIDER_ID = "qoder-cn";
export function modelsForProvider(mode, providerID) {
    const cached = getCachedModels(mode);
    const modelsToUse = cached.length > 0 ? cached : isQoderCNMode(mode) ? staticCnModels : staticModels;
    return modelsToUse.map((m) => {
        const model = isQoderCNMode(mode) ? toQoderCNFriendlyModel(m) : m;
        return {
            ...model,
            provider: providerID,
            baseUrl: getQoderBaseUrl(mode),
        };
    });
}
function createQoderOAuth(providerID, mode) {
    return {
        name: isQoderCNMode(mode) ? "Qoder CN (PAT)" : "Qoder (Browser OAuth / PAT)",
        login: isQoderCNMode(mode) ? loginQoderCN : loginQoder,
        refreshToken: isQoderCNMode(mode) ? refreshQoderTokenCN : refreshQoderToken,
        getApiKey: (cred) => cred.access,
        modifyModels: (models, _cred) => {
            const nonQoder = models.filter((m) => m.provider !== providerID);
            return [...nonQoder, ...modelsForProvider(mode, providerID)];
        },
        fetchUsage: isQoderCNMode(mode) ? fetchQoderUsageCN : fetchQoderUsage,
    };
}
export function createQoderProvider(providerID = QODER_PROVIDER_ID, mode) {
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
export const createAuthProvider = () => createQoderProvider(QODER_PROVIDER_ID);
export { getCachedCredentials, getQoderUserEmailFallback };
