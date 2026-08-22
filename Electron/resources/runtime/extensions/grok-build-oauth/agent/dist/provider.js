/**
 * Canonical `grok-build` provider config (single source, spec §3).
 *
 * Consumed twice, never copied:
 * - the extension entry (`agent/index.ts`) registers it via `pi.registerProvider`;
 * - the PipiUI host registers the same factory into its auth ModelRuntime so the
 *   provider login panel can show login state / re-login / logout without a session.
 *
 * Secrets never leave the pi credential store (`auth.json` under the host's Pi home);
 * this module only carries code and non-secret config. The provider NEVER
 * touches the store itself — `login` returns the credential for pi to persist,
 * and `refreshToken` is a pure network refresh whose result pi persists inside
 * its own `credentials.modify()` (which already holds the store lock).
 */
import { resolveOAuthConfig } from "./oauth/config.js";
import { requestDeviceCode, pollDeviceToken, OAuthError } from "./oauth/device.js";
import { toOAuthCredentials } from "./oauth/credentials.js";
import { refreshCredentialUnlocked } from "./oauth/refresh.js";
import { redactMessage } from "./oauth/redact.js";
export const GROK_BUILD_PROVIDER_ID = "grok-build";
function displayUriOf(code) {
    if (code.verification_uri_complete)
        return code.verification_uri_complete;
    const sep = code.verification_uri.includes("?") ? "&" : "?";
    return `${code.verification_uri}${sep}user_code=${encodeURIComponent(code.user_code)}`;
}
/**
 * Build the provider registration payload. The shape matches pi's extension
 * `registerProvider` contract; the host ModelRuntime's `registerProvider`
 * accepts the same `oauth` block (ExtensionOAuthConfig).
 */
export function createGrokBuildProvider(options = {}) {
    const emit = options.emit ?? (() => undefined);
    const fetchImpl = options.fetchImpl;
    // Fire-and-forget notification used ONLY from `refreshToken`: pi invokes
    // that callback INSIDE `credentials.modify()` while already holding the
    // auth-store lock, and the bridge emitter is an unbounded network hop (no
    // timeout/signal of its own). Awaiting it there would let a stalled bridge
    // hold the store lock indefinitely — so never await side effects in the
    // refresh callback; the returned credential is the whole contract.
    const notifyUnlocked = (event, payload) => {
        try {
            void Promise.resolve(emit(event, payload)).catch(() => {
                /* best-effort */
            });
        }
        catch {
            /* best-effort */
        }
    };
    return {
        // Auth-only provider: no chat models are exposed (images transport is tool-based).
        name: "Grok Build",
        api: "openai-completions",
        models: [],
        oauth: {
            name: "Grok Build",
            async login(callbacks) {
                const cfg = resolveOAuthConfig();
                const signal = callbacks.signal;
                if (signal?.aborted)
                    throw new DOMException("Aborted", "AbortError");
                // Choose mode via onSelect if available; default device
                let mode = "device";
                if (callbacks.onSelect) {
                    try {
                        const choice = await callbacks.onSelect({
                            message: "Choose Grok Build login method",
                            options: [
                                { id: "browser", label: "Browser (open verification URL)" },
                                { id: "device", label: "Device code (manual)" },
                            ],
                        });
                        if (choice === "browser" || choice === "device")
                            mode = choice;
                    }
                    catch {
                        // selection aborted -> propagate abort
                        if (signal?.aborted)
                            throw new DOMException("Aborted", "AbortError");
                    }
                }
                const surface = mode === "browser" ? "ui" : "cli";
                let code;
                try {
                    code = await requestDeviceCode({
                        issuer: cfg.issuer,
                        clientId: cfg.clientId,
                        scopes: cfg.scopes,
                        referrer: cfg.referrer,
                        surface,
                        signal,
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    await emit("auth_error", { code: err?.code ?? "device_code_failed", message: redactMessage(msg, []) });
                    throw err instanceof OAuthError ? new Error(`${err.code}: ${redactMessage(err.message, [])}`) : err;
                }
                const displayUri = displayUriOf(code);
                // Notify host UI
                try {
                    if (mode === "browser") {
                        callbacks.onAuth?.({ url: displayUri, instructions: `Confirm code ${code.user_code} in your browser` });
                    }
                    else {
                        callbacks.onDeviceCode?.({
                            userCode: code.user_code,
                            verificationUri: code.verification_uri,
                            intervalSeconds: code.interval,
                            expiresInSeconds: code.expires_in,
                        });
                    }
                }
                catch {
                    // UI callbacks are best-effort
                }
                await emit("login_progress", {
                    phase: "device_requested",
                    user_code: code.user_code,
                    verification_uri: code.verification_uri,
                    verification_uri_complete: code.verification_uri_complete,
                    interval: code.interval,
                    expires_in: code.expires_in,
                });
                let tokens;
                try {
                    tokens = await pollDeviceToken({
                        issuer: cfg.issuer,
                        clientId: cfg.clientId,
                        deviceCode: code,
                        surface,
                        signal,
                    });
                }
                catch (err) {
                    const codeStr = err?.code ?? "token_failed";
                    const msg = err instanceof Error ? err.message : String(err);
                    await emit("auth_error", { code: codeStr, message: redactMessage(msg, [code.device_code, code.user_code]) });
                    // Map to user-actionable errors
                    if (err instanceof OAuthError) {
                        if (err.code === "access_denied")
                            throw new Error("Authorization denied. Please try /login grok-build again.");
                        if (err.code === "expired_token")
                            throw new Error("Device code expired. Please run /login grok-build again.");
                        throw new Error(`${err.code}: ${redactMessage(err.message, [code.device_code])}`);
                    }
                    throw err;
                }
                const creds = toOAuthCredentials(tokens, { issuer: cfg.issuer, clientId: cfg.clientId, scopes: cfg.scopes });
                await emit("token_refreshed", { expires_at: creds.expires });
                // Pi expects OAuthCredentials { access, refresh, expires, ...extra }.
                // The official id_token `tier` claim is captured with the credential
                // (tier/tier_raw/tier_source) so the tier gate/status use real data.
                return {
                    access: creds.access,
                    refresh: creds.refresh,
                    expires: creds.expires,
                    issuer: creds.issuer,
                    client_id: creds.client_id,
                    scopes: creds.scopes,
                    token_type: creds.token_type,
                    obtained_at: creds.obtained_at,
                    ...(creds.tier !== undefined ? { tier: creds.tier } : {}),
                    ...(creds.tier_raw !== undefined ? { tier_raw: creds.tier_raw } : {}),
                    ...(creds.tier_source !== undefined ? { tier_source: creds.tier_source } : {}),
                };
            },
            async refreshToken(credentials, signal) {
                // Round-3 reviewer Critical: pi-ai's resolveStoredOAuth calls this
                // INSIDE `credentials.modify()` — while pi already holds the
                // auth-store lock. This callback must therefore be pure: refresh over
                // the network using the handed-in (authoritative, in-lock) credential
                // and RETURN the next value; pi persists it. No broker, no store
                // adapter, no second lock acquisition — those self-deadlock. And no
                // AWAITED side effects either: bridge emits go through
                // `notifyUnlocked` (fire-and-forget) so a stalled bridge can never
                // extend the time this lock is held.
                const current = (credentials ?? {});
                const access = current.access;
                const refresh = current.refresh;
                try {
                    const next = await refreshCredentialUnlocked(current, signal, { fetchImpl });
                    notifyUnlocked("token_refreshed", { expires_at: next.expires });
                    return {
                        access: next.access,
                        refresh: next.refresh,
                        expires: next.expires,
                        issuer: next.issuer,
                        client_id: next.client_id,
                        scopes: next.scopes,
                        token_type: next.token_type,
                        obtained_at: next.obtained_at,
                        ...(next.tier !== undefined ? { tier: next.tier } : {}),
                        ...(next.tier_raw !== undefined ? { tier_raw: next.tier_raw } : {}),
                        ...(next.tier_source !== undefined ? { tier_source: next.tier_source } : {}),
                    };
                }
                catch (err) {
                    const code = err?.code;
                    const msg = err instanceof Error ? err.message : String(err);
                    const redacted = redactMessage(msg, [refresh ?? "", access ?? ""]);
                    notifyUnlocked("auth_error", { code: code ?? "refresh_failed", message: redacted });
                    if (code === "invalid_grant") {
                        throw new Error("Refresh token expired or revoked — please run /login grok-build again. [redacted]");
                    }
                    if (code === "auth_expired") {
                        // Already a user-actionable re-login message (issuer mismatch /
                        // missing refresh token / revoked refresh).
                        throw new Error(redacted);
                    }
                    throw new Error(redacted);
                }
            },
            getApiKey(credentials) {
                return credentials.access;
            },
        },
    };
}
