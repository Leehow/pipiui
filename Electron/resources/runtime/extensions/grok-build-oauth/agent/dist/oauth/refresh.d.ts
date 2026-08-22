import { type StoredOAuthCredential } from "./credentials.js";
/** Loose incoming credential shape (a stored auth.json entry handed in under a lock). */
export type RefreshableCredential = {
    access?: unknown;
    refresh?: unknown;
    issuer?: unknown;
    client_id?: unknown;
    scopes?: unknown;
    tier?: unknown;
    tier_raw?: unknown;
    tier_source?: unknown;
};
export type RefreshCredentialOptions = {
    fetchImpl?: typeof fetch;
    /** Network timeout for the refresh call. Default 30s (broker default). */
    refreshTimeoutMs?: number;
};
/**
 * Refresh the credential over the network and return the NEXT credential
 * value. Never reads or writes the store, never takes a lock; the input is
 * the authoritative in-lock current credential, the output is whatever the
 * caller should persist. Tier metadata on the input is preserved verbatim
 * unless the response carries a fresh `tier` claim (which then wins).
 */
export declare function refreshCredentialUnlocked(credentials: RefreshableCredential | Record<string, unknown>, signal?: AbortSignal, opts?: RefreshCredentialOptions): Promise<StoredOAuthCredential>;
