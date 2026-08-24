import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
export interface QoderCredentials extends OAuthCredentials {
    userID: string;
    email: string;
    name: string;
    machineID: string;
}
/** Return the PAT exposed through the environment for a provider mode. */
export declare function getQoderPatForMode(mode: string): string;
/** Exchange an environment PAT before pi resolves its initial model. */
export declare function autoLoginQoderFromEnvironment(providerID: string, mode: string): Promise<void>;
/**
 * Read the Qoder identity (userID/email/name/machineID) from pi's own auth
 * store. pi persists the full OAuthCredentials there on login/refresh and keeps
 * it up to date, so there is no need to maintain a separate credentials cache.
 *
 * Note: the auth.json path/shape is a pi internal convention, not a public API.
 * This is best-effort and falls back to null so callers can use placeholders.
 */
export declare function getCachedCredentials(_accessToken: string, providerID?: string): QoderCredentials | null;
export declare function loginQoder(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
export declare function loginQoderCN(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
export declare function refreshQoderToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
export declare function refreshQoderTokenCN(credentials: OAuthCredentials): Promise<OAuthCredentials>;
