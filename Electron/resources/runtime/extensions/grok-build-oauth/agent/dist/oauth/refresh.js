/**
 * Pure credential refresh — network + credential shaping ONLY.
 *
 * Round-3 reviewer Critical: pi-ai's `resolveStoredOAuth` invokes the
 * provider's `refreshToken` INSIDE `credentials.modify()` — i.e. while pi
 * already holds the auth-store lock (`<auth.json>.lock`). Any refresh path
 * that re-acquires that lock (broker `forceRefresh`, store adapters, …)
 * self-deadlocks until the 15s pi abort fires. This module is the piece both
 * sides share, and it is guaranteed lock-free and side-effect-free:
 *
 * - NO credential-store access (no read/modify/write, no lock acquisition);
 * - NO persistence — the CALLER owns reading the authoritative current
 *   credential and writing the result:
 *     · pi path:   provider.refreshToken(credentials, signal) runs inside
 *                  pi's `modify` and simply returns the value; pi persists it.
 *     · broker path: runs inside the broker's `withExclusive` section, which
 *                  already holds the unified store lock and does the RMW.
 * - only `fetch` to the HTTPS token endpoint, with caller-supplied abort +
 *   bounded timeout, and redacted errors.
 */
import { refreshAccessToken, OAuthError } from "./device.js";
import { toOAuthCredentials } from "./credentials.js";
import { redactMessage } from "./redact.js";
import { resolveOAuthConfig } from "./config.js";
function asString(v) {
    return typeof v === "string" && v ? v : undefined;
}
/**
 * Refresh the credential over the network and return the NEXT credential
 * value. Never reads or writes the store, never takes a lock; the input is
 * the authoritative in-lock current credential, the output is whatever the
 * caller should persist. Tier metadata on the input is preserved verbatim
 * unless the response carries a fresh `tier` claim (which then wins).
 */
export async function refreshCredentialUnlocked(credentials, signal, opts = {}) {
    const cfg = resolveOAuthConfig();
    const current = (credentials ?? {});
    const access = asString(current.access);
    const refresh = asString(current.refresh);
    const storedIssuer = asString(current.issuer);
    // Issuer mismatch -> require re-login (fail closed, message redacted by construction)
    if (storedIssuer && storedIssuer.replace(/\/+$/, "") !== cfg.issuer.replace(/\/+$/, "")) {
        throw new OAuthError("auth_expired", "Issuer mismatch — please run /login grok-build again. [redacted]");
    }
    // No refresh token -> require re-login, don't attempt network
    if (!refresh) {
        throw new OAuthError("auth_expired", "No refresh token — please run /login grok-build again.");
    }
    signal?.throwIfAborted();
    const issuer = storedIssuer || cfg.issuer;
    const clientId = asString(current.client_id) || cfg.clientId;
    const scopes = Array.isArray(current.scopes)
        ? current.scopes.filter((s) => typeof s === "string").length
            ? current.scopes
            : cfg.scopes
        : cfg.scopes;
    let tokens;
    try {
        const timeoutSignal = AbortSignal.timeout(opts.refreshTimeoutMs ?? 30_000);
        const effective = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        tokens = await refreshAccessToken({
            issuer,
            clientId,
            refreshToken: refresh,
            fetchImpl: opts.fetchImpl ?? fetch,
            signal: effective,
        });
    }
    catch (err) {
        // Caller aborts propagate untouched (pi's 15s refresh abort must cancel).
        if (signal?.aborted)
            throw err;
        const code = err?.code;
        const msg = err instanceof Error ? err.message : String(err);
        const redacted = redactMessage(msg, [refresh, access ?? ""]);
        // invalid_grant keeps its code so locked callers (broker) can run their
        // conditional cleanup; everyone else maps it to a re-login message.
        if (code === "invalid_grant")
            throw new OAuthError("invalid_grant", redacted);
        throw new OAuthError(code ?? "refresh_failed", redacted);
    }
    return toOAuthCredentials(tokens, {
        issuer,
        clientId,
        scopes,
        refreshFallback: refresh,
        previousTier: {
            ...(asString(current.tier) !== undefined ? { tier: asString(current.tier) } : {}),
            ...(asString(current.tier_raw) !== undefined ? { tier_raw: asString(current.tier_raw) } : {}),
            ...(current.tier_source === "jwt" ? { tier_source: "jwt" } : {}),
        },
    });
}
