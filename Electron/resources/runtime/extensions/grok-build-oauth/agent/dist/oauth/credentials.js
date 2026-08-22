import { tierNameFromJwtClaim, decodeIdTokenTierClaim } from "../images/tier.js";
export function toOAuthCredentials(tokens, meta) {
    const now = Date.now();
    const expiresIn = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in) ? tokens.expires_in : 3600;
    const expires = now + Math.max(60, expiresIn) * 1000;
    const refresh = tokens.refresh_token ?? meta.refreshFallback ?? "";
    // Official `tier` claim (numeric). Only officially mapped values become a
    // tier name; an unmapped number is kept raw (unknown, fail-open) and any
    // other claim is ignored — nothing is guessed.
    const tierInfo = tierNameFromJwtClaim(decodeIdTokenTierClaim(tokens.id_token));
    return {
        access: tokens.access_token,
        refresh,
        expires,
        issuer: meta.issuer,
        client_id: meta.clientId,
        scopes: meta.scopes,
        token_type: tokens.token_type ?? "Bearer",
        obtained_at: now,
        ...(tierInfo.name !== undefined ? { tier: tierInfo.name } : {}),
        ...(tierInfo.raw !== undefined ? { tier_raw: tierInfo.raw } : {}),
        ...(tierInfo.name !== undefined || tierInfo.raw !== undefined ? { tier_source: "jwt" } : {}),
    };
}
