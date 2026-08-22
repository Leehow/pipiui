import { tierNameFromJwtClaim, decodeIdTokenTierClaim, type CredentialTierInfo } from "../images/tier.js";

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

export function toOAuthCredentials(tokens: {
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
}): StoredOAuthCredential {
  const now = Date.now();
  const expiresIn = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in) ? tokens.expires_in : 3600;
  const expires = now + Math.max(60, expiresIn) * 1000;
  const refresh = tokens.refresh_token ?? meta.refreshFallback ?? "";
  // Official `tier` claim (numeric). Only officially mapped values become a
  // tier name; an unmapped number is kept raw (unknown, fail-open) and any
  // other claim is ignored — nothing is guessed.
  const tierInfo = tierNameFromJwtClaim(decodeIdTokenTierClaim(tokens.id_token));
  const hasNewTierClaim = tierInfo.name !== undefined || tierInfo.raw !== undefined;
  const tierName = hasNewTierClaim ? tierInfo.name : meta.previousTier?.tier;
  const tierRaw = hasNewTierClaim ? tierInfo.raw : meta.previousTier?.tier_raw;
  return {
    access: tokens.access_token,
    refresh,
    expires,
    issuer: meta.issuer,
    client_id: meta.clientId,
    scopes: meta.scopes,
    token_type: tokens.token_type ?? "Bearer",
    obtained_at: now,
    ...(tierName !== undefined ? { tier: tierName } : {}),
    ...(tierRaw !== undefined ? { tier_raw: tierRaw } : {}),
    ...(tierName !== undefined || tierRaw !== undefined ? { tier_source: "jwt" as const } : {}),
  };
}
