export function toOAuthCredentials(tokens, meta) {
    const now = Date.now();
    const expiresIn = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in) ? tokens.expires_in : 3600;
    const expires = now + Math.max(60, expiresIn) * 1000;
    const refresh = tokens.refresh_token ?? meta.refreshFallback ?? "";
    return {
        access: tokens.access_token,
        refresh,
        expires,
        issuer: meta.issuer,
        client_id: meta.clientId,
        scopes: meta.scopes,
        token_type: tokens.token_type ?? "Bearer",
        obtained_at: now,
    };
}
