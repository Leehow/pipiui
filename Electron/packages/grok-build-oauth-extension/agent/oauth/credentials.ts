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
};

export function toOAuthCredentials(tokens: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}, meta: { issuer: string; clientId: string; scopes: string[]; refreshFallback?: string }): StoredOAuthCredential {
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
