import { type CredentialTierInfo } from "../images/tier.js";
export type GrokBuildOAuthExtra = {
    issuer: string;
    client_id: string;
    scopes: string[];
    token_type?: string;
    obtained_at: number;
    principal?: string;
};
export type StoredOAuthCredential = {
    access: string;
    refresh: string;
    expires: number;
    issuer: string;
    client_id: string;
    scopes: string[];
    token_type?: string;
    obtained_at: number;
} & CredentialTierInfo;
export declare function toOAuthCredentials(tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    /** OIDC id_token; only its numeric `tier` claim is read (see images/tier.js). */
    id_token?: string;
}, meta: {
    issuer: string;
    clientId: string;
    scopes: string[];
    refreshFallback?: string;
    /**
     * Tier metadata carried by the credential being replaced. When the token
     * response carries NO new `tier` claim (refresh responses legitimately omit
     * `id_token`), the previous tier/tier_raw/tier_source are preserved instead
     * of being silently dropped; a fresh claim always wins.
     */
    previousTier?: CredentialTierInfo;
}): StoredOAuthCredential;
