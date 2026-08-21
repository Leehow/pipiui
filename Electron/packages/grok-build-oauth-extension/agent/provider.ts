/**
 * Canonical `grok-build` provider config (single source, spec §3).
 *
 * Consumed twice, never copied:
 * - the extension entry (`agent/index.ts`) registers it via `pi.registerProvider`;
 * - the PipiUI host registers the same factory into its auth ModelRuntime so the
 *   provider login panel can show login state / re-login / logout without a session.
 *
 * Secrets never leave the pi credential store (`auth.json` under the host's Pi home);
 * this module only carries code and non-secret config.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOAuthConfig } from "./oauth/config.js";
import { requestDeviceCode, pollDeviceToken, OAuthError } from "./oauth/device.js";
import { toOAuthCredentials } from "./oauth/credentials.js";
import { redactMessage } from "./oauth/redact.js";
import { createBroker } from "./oauth/broker.js";

export const GROK_BUILD_PROVIDER_ID = "grok-build";

export type GrokBuildEmit = (event: string, payload?: unknown) => Promise<void> | void;

export type GrokBuildProviderOptions = {
  /** Best-effort bridge emitter; omitted in the host auth runtime (no bridge there). */
  emit?: GrokBuildEmit;
  /** Explicit `auth.json` path. Defaults to `PI_CODING_AGENT_DIR` / `~/.pi/agent`. */
  authPath?: string;
};

export type GrokBuildOAuthCredentials = {
  access: string;
  refresh?: string;
  expires: number;
  issuer?: string;
  client_id?: string;
  scopes?: string | string[];
  token_type?: string;
  obtained_at?: number;
};

function displayUriOf(code: { verification_uri: string; verification_uri_complete?: string; user_code: string }): string {
  if (code.verification_uri_complete) return code.verification_uri_complete;
  const sep = code.verification_uri.includes("?") ? "&" : "?";
  return `${code.verification_uri}${sep}user_code=${encodeURIComponent(code.user_code)}`;
}

export function defaultAuthPath(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (envDir) return join(envDir, "auth.json");
  return join(homedir(), ".pi", "agent", "auth.json");
}

function brokerFor(authPath: string, signal?: AbortSignal) {
  const cfg = resolveOAuthConfig();
  return createBroker({
    authPath,
    earlyRefreshSec: cfg.earlyRefreshSec,
    fetchImpl: fetch as unknown as typeof fetch,
  });
}

/**
 * Build the provider registration payload. The shape matches pi's extension
 * `registerProvider` contract; the host ModelRuntime's `registerProvider`
 * accepts the same `oauth` block (ExtensionOAuthConfig).
 */
export function createGrokBuildProvider(options: GrokBuildProviderOptions = {}): {
  name: string;
  api: string;
  models: never[];
  oauth: {
    name: string;
    login(callbacks: {
      signal?: AbortSignal;
      onSelect?(prompt: { message: string; options: { id: string; label: string }[] }): Promise<string>;
      onAuth?(event: { url: string; instructions?: string }): void;
      onDeviceCode?(event: {
        userCode: string;
        verificationUri: string;
        intervalSeconds?: number;
        expiresInSeconds?: number;
      }): void;
    }): Promise<GrokBuildOAuthCredentials>;
    refreshToken(credentials: unknown, signal?: AbortSignal): Promise<GrokBuildOAuthCredentials>;
    getApiKey(credentials: unknown): string;
  };
} {
  const emit: GrokBuildEmit = options.emit ?? (() => undefined);
  const authPath = options.authPath ?? defaultAuthPath();

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
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

        // Choose mode via onSelect if available; default device
        let mode: "browser" | "device" = "device";
        if (callbacks.onSelect) {
          try {
            const choice = await callbacks.onSelect({
              message: "Choose Grok Build login method",
              options: [
                { id: "browser", label: "Browser (open verification URL)" },
                { id: "device", label: "Device code (manual)" },
              ],
            });
            if (choice === "browser" || choice === "device") mode = choice;
          } catch {
            // selection aborted -> propagate abort
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await emit("auth_error", { code: (err as OAuthError)?.code ?? "device_code_failed", message: redactMessage(msg, []) });
          throw err instanceof OAuthError ? new Error(`${err.code}: ${redactMessage(err.message, [])}`) : err;
        }

        const displayUri = displayUriOf(code);

        // Notify host UI
        try {
          if (mode === "browser") {
            callbacks.onAuth?.({ url: displayUri, instructions: `Confirm code ${code.user_code} in your browser` });
          } else {
            callbacks.onDeviceCode?.({
              userCode: code.user_code,
              verificationUri: code.verification_uri,
              intervalSeconds: code.interval,
              expiresInSeconds: code.expires_in,
            });
          }
        } catch {
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
        } catch (err) {
          const codeStr = (err as OAuthError)?.code ?? "token_failed";
          const msg = err instanceof Error ? err.message : String(err);
          await emit("auth_error", { code: codeStr, message: redactMessage(msg, [code.device_code, code.user_code]) });
          // Map to user-actionable errors
          if (err instanceof OAuthError) {
            if (err.code === "access_denied") throw new Error("Authorization denied. Please try /login grok-build again.");
            if (err.code === "expired_token") throw new Error("Device code expired. Please run /login grok-build again.");
            throw new Error(`${err.code}: ${redactMessage(err.message, [code.device_code])}`);
          }
          throw err;
        }

        const creds = toOAuthCredentials(tokens, { issuer: cfg.issuer, clientId: cfg.clientId, scopes: cfg.scopes });
        await emit("token_refreshed", { expires_at: creds.expires });
        // Pi expects OAuthCredentials { access, refresh, expires, ...extra }
        return {
          access: creds.access,
          refresh: creds.refresh,
          expires: creds.expires,
          issuer: creds.issuer,
          client_id: creds.client_id,
          scopes: creds.scopes,
          token_type: creds.token_type,
          obtained_at: creds.obtained_at,
        };
      },
      async refreshToken(credentials, signal) {
        const cfg = resolveOAuthConfig();
        const access = (credentials as unknown as Record<string, unknown>).access as string | undefined;
        const refresh = (credentials as unknown as Record<string, unknown>).refresh as string | undefined;
        const storedIssuer = (credentials as unknown as Record<string, unknown>).issuer as string | undefined;

        if (storedIssuer && storedIssuer.replace(/\/+$/, "") !== cfg.issuer.replace(/\/+$/, "")) {
          throw new Error("Issuer mismatch — please run /login grok-build again. [redacted]");
        }
        if (!refresh) {
          throw new Error("No refresh token — please run /login grok-build again.");
        }
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

        // Broker handles earlyRefresh, rotation, 401 dedup, cross-process lock + re-read + freshness guard, 0600 atomic write, redaction
        const broker = brokerFor(authPath, signal as AbortSignal | undefined);
        try {
          const next = await broker.forceRefresh(signal);
          await emit("token_refreshed", { expires_at: next.expires });
          return {
            access: next.access,
            refresh: next.refresh,
            expires: next.expires,
            issuer: next.issuer,
            client_id: next.client_id,
            scopes: next.scopes,
            token_type: next.token_type,
            obtained_at: next.obtained_at,
          };
        } catch (err) {
          const code = (err as OAuthError)?.code;
          const msg = err instanceof Error ? err.message : String(err);
          const redacted = redactMessage(msg, [refresh, access ?? ""]);
          await emit("auth_error", { code: code ?? "refresh_failed", message: redacted });
          if (code === "auth_expired" || code === "invalid_grant") {
            throw new Error("Refresh token expired or revoked — please run /login grok-build again. [redacted]");
          }
          throw new Error(redacted);
        }
      },
      getApiKey(credentials) {
        return ((credentials as unknown) as Record<string, unknown>).access as string;
      },
    },
  };
}
