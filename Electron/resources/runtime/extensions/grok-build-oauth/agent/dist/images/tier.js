/**
 * M4 — Subscription tier classification (client-side advisory gate only).
 *
 * Aligned with official Grok Build `tier.rs`: restricted tiers are the
 * personal free tier and X Basic; everything else (SuperGrok variants,
 * X Premium/+, unknown future names) is unrestricted (fail-open).
 *
 * Absent tier (`undefined`) is unrestricted — the server authoritatively
 * enforces limits, so we never withhold a capability on a guess.
 * An explicit empty string counts as the free tier (official semantics).
 *
 * `xai` API-key callers are never gated (the gate applies to OAuth only).
 */
export function isRestrictedTier(tier) {
    if (tier === undefined)
        return false;
    const t = tier.trim().toLowerCase();
    return t === "" || t === "free" || t === "x basic" || t === "x_basic";
}
