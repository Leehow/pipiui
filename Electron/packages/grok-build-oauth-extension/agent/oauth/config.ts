/**
 * Resolved OAuth config — production issuer/client/scopes are taken from
 * official Grok Build HEAD 19d42e35 (not guessed). They are overridable via
 * env or extension settings. Priority: env > settings > hardcoded prod defaults.
 *
 * Spec §7.3: these values were locked by reading
 * crates/codegen/xai-grok-shell/src/auth/config.rs at HEAD 19d42e35.
 */
export const PROD_ISSUER = "https://auth.x.ai";
export const PROD_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const PROD_REFERRER = "grok-build";

export function defaultScopes(): string[] {
  return [
    "openid",
    "profile",
    "email",
    "offline_access",
    "grok-cli:access",
    "api:access",
    "conversations:read",
    "conversations:write",
    "workspaces:read",
    "workspaces:write",
  ];
}

export type OAuthConfig = {
  issuer: string;
  clientId: string;
  scopes: string[];
  referrer: string;
  earlyRefreshSec: number;
};

function parseScopes(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || !raw.trim()) return fallback;
  // GROK_OAUTH2_SCOPES is comma-separated in official code; settings scopes
  // is space-separated. Accept both.
  const parts = raw.split(raw.includes(",") ? "," : " ");
  const trimmed = parts.map((s) => s.trim()).filter(Boolean);
  return trimmed.length ? trimmed : fallback;
}

function settingsSnapshot(): Record<string, unknown> | undefined {
  const key = `PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH`;
  const raw = process.env[key];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function resolveOAuthConfig(overrides?: Partial<OAuthConfig>): OAuthConfig {
  const envIssuer = process.env.GROK_OAUTH2_ISSUER?.trim();
  const envClient = process.env.GROK_OAUTH2_CLIENT_ID?.trim();
  const envScopes = process.env.GROK_OAUTH2_SCOPES;
  const settings = settingsSnapshot();

  const settingsIssuer = typeof settings?.["ext.grok-build-oauth.issuer"] === "string" ? (settings["ext.grok-build-oauth.issuer"] as string).trim() : undefined;
  const settingsClient = typeof settings?.["ext.grok-build-oauth.clientId"] === "string" ? (settings["ext.grok-build-oauth.clientId"] as string).trim() : undefined;
  const settingsScopes = typeof settings?.["ext.grok-build-oauth.scopes"] === "string" ? (settings["ext.grok-build-oauth.scopes"] as string) : undefined;
  const settingsEarly = typeof settings?.["ext.grok-build-oauth.earlyRefreshSec"] === "number" ? (settings["ext.grok-build-oauth.earlyRefreshSec"] as number) : undefined;

  const fallbackScopes = defaultScopes();
  const scopes = overrides?.scopes ?? parseScopes(envScopes, parseScopes(settingsScopes, fallbackScopes));

  let issuer = overrides?.issuer ?? envIssuer ?? (settingsIssuer || undefined) ?? PROD_ISSUER;
  issuer = issuer.trim().replace(/\/+$/, "");
  let clientId = overrides?.clientId ?? envClient ?? (settingsClient || undefined) ?? PROD_CLIENT_ID;
  clientId = clientId.trim();

  const referrer = overrides?.referrer ?? PROD_REFERRER;
  const early = overrides?.earlyRefreshSec ?? settingsEarly ?? 60;
  const earlyClamped = Math.min(120, Math.max(30, early));

  return { issuer, clientId, scopes, referrer, earlyRefreshSec: earlyClamped };
}

export function xGrokClientVersion(): string {
  return "0.1.0";
}
