/**
 * Resolved OAuth config — production issuer/client/scopes are taken from
 * official Grok Build HEAD 19d42e35 (not guessed). They are overridable via
 * env or extension settings. Priority: env > settings > hardcoded prod defaults.
 *
 * The issuer is the base for the device-code, token and refresh endpoints;
 * refresh tokens and access tokens are bearer credentials, so a NON-HTTPS
 * issuer is always refused (round-2 reviewer Critical #2: a plain-HTTP
 * issuer would receive the refresh token in cleartext).
 *
 * Spec §7.3: these values were locked by reading
 * crates/codegen/xai-grok-shell/src/auth/config.rs at HEAD 19d42e35.
 */
export declare const PROD_ISSUER = "https://auth.x.ai";
export declare const PROD_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export declare const PROD_REFERRER = "grok-build";
export declare function defaultScopes(): string[];
export type OAuthConfig = {
    issuer: string;
    clientId: string;
    scopes: string[];
    referrer: string;
    earlyRefreshSec: number;
};
/** Refuse non-HTTPS issuers — token/refresh endpoints must never be plain HTTP. */
export declare function assertHttpsIssuer(issuer: string): string;
export declare function resolveOAuthConfig(overrides?: Partial<OAuthConfig>): OAuthConfig;
export declare function xGrokClientVersion(): string;
