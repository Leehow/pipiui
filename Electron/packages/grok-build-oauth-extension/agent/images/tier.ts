/**
 * M4 — Subscription tier classification (client-side advisory gate only).
 *
 * Aligned with official Grok Build `tier.rs`: restricted tiers are the
 * personal free tier and X Basic; everything else (SuperGrok variants,
 * X Premium/+, unknown future names) is unrestricted (fail-open).
 *
 * ── Tier sources (round-2 reviewer: tier must come from real data) ─────────
 * 1. Explicit override — `GROK_TIER` / `ext.grok-build-oauth.tier`. Any string
 *    including the EMPTY string (official free-tier semantics) is preserved
 *    verbatim; it is a user-authored value, not a guess.
 * 2. Credential — the OAuth id_token's numeric `tier` claim, captured at
 *    login/refresh and persisted with the credential. The official client
 *    maps known values to display names (0 → free, 1 → supergrok,
 *    2 → x_basic, per xai-org/grok-build `tier.rs` tests); we map ONLY those
 *    known values — an unmapped number stays UNKNOWN (fail-open, shown raw)
 *    and is never guessed into a tier name.
 * 3. Unknown — no override and no credential tier: unrestricted (fail-open);
 *    surfaces display "unknown", never hidden.
 *
 * `xai` API-key callers are never gated (the gate applies to OAuth only).
 * The server remains the final authority in every case.
 */

/** The only JWT claim read: official grok-build maps this numeric claim to tier names. */
export const JWT_TIER_CLAIM = "tier";

/**
 * Numeric claim → official display names. ONLY officially mapped values live
 * here; any other number resolves to unknown (fail-open) rather than a guess.
 */
export const OFFICIAL_JWT_TIER_NAMES: Readonly<Record<number, string>> = Object.freeze({
  0: "free",
  1: "supergrok",
  2: "x_basic",
});

export function isRestrictedTier(tier: string | undefined): boolean {
  if (tier === undefined) return false;
  const t = tier.trim().toLowerCase();
  return t === "" || t === "free" || t === "x basic" || t === "x_basic";
}

/**
 * Extract the `tier` claim from an id_token's JWT payload.
 *
 * The id_token arrives directly from the token endpoint over TLS in our own
 * refresh/login response, so its payload is used for ADVISORY gating only
 * (never for authorization) — no signature verification here, and only the
 * single allowlisted claim is read (no other claims are interpreted).
 * Returns undefined for malformed tokens or a missing/non-finite claim.
 */
export function decodeIdTokenTierClaim(idToken: string | undefined): number | undefined {
  if (typeof idToken !== "string" || !idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    const claim = payload[JWT_TIER_CLAIM];
    return typeof claim === "number" && Number.isFinite(claim) ? claim : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Map a numeric `tier` claim to the official display name. Unmapped numbers
 * (and non-numbers) stay unknown — fail-open, displayed as the raw value.
 */
export function tierNameFromJwtClaim(claim: unknown): { name?: string; raw?: string } {
  if (typeof claim !== "number" || !Number.isFinite(claim)) return {};
  const name = OFFICIAL_JWT_TIER_NAMES[claim];
  return name !== undefined ? { name, raw: String(claim) } : { raw: String(claim) };
}

/** Tier fields as persisted on the credential entry. */
export type CredentialTierInfo = {
  tier?: string;
  tier_raw?: string;
  tier_source?: "jwt";
};

export type TierResolution = {
  /** Official display name or explicit override; undefined = unknown (fail-open). */
  tier?: string;
  /** Where the tier came from — surfaced to the UI so "unknown" is visible, never hidden. */
  source: "override" | "credential" | "unknown";
  /** Advisory gate outcome (server is authoritative). */
  restricted: boolean;
  /** Raw claim value when a numeric claim existed but had no official mapping. */
  raw?: string;
};

/**
 * Resolve the effective advisory tier. Precedence: explicit override (any
 * string, including "" = free) > credential-carried official claim mapping >
 * unknown. Unknown tiers never restrict and never invent a name.
 */
export function resolveSubscriptionTier(input: {
  override?: string;
  credential?: CredentialTierInfo | undefined;
}): TierResolution {
  if (input.override !== undefined) {
    return { tier: input.override, source: "override", restricted: isRestrictedTier(input.override) };
  }
  const cred = input.credential;
  if (cred?.tier !== undefined) {
    return { tier: cred.tier, source: "credential", restricted: isRestrictedTier(cred.tier) };
  }
  if (cred?.tier_raw !== undefined) {
    // Numeric claim with no official mapping: unknown name — fail-open, raw shown.
    return { tier: undefined, source: "credential", restricted: false, raw: cred.tier_raw };
  }
  return { tier: undefined, source: "unknown", restricted: false };
}
