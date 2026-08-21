import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOAuthConfig } from "./oauth/config.js";
import { requestDeviceCode, pollDeviceToken, OAuthError } from "./oauth/device.js";
import { toOAuthCredentials } from "./oauth/credentials.js";
import { redactMessage } from "./oauth/redact.js";
import { importFromGlobalGrok } from "./oauth/import.js";
import { createBroker } from "./oauth/broker.js";

const EXTENSION_ID = "grok-build-oauth";
const BRIDGE_PORT = process.env.PIPIUI_BRIDGE_PORT;
const SESSION_CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;

function settingsSnapshot(): unknown {
  const key = `PIPIUI_EXT_SETTINGS_${EXTENSION_ID.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function emit(event: string, payload?: unknown): Promise<void> {
  if (!BRIDGE_PORT || !SESSION_CAPABILITY) return;
  try {
    await fetch(`http://127.0.0.1:${BRIDGE_PORT}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        sessionCapability: SESSION_CAPABILITY,
        action: "ext.emit",
        extensionId: EXTENSION_ID,
        event,
        payload,
      }),
    });
  } catch {
    // best-effort
  }
}

function displayUriOf(code: { verification_uri: string; verification_uri_complete?: string; user_code: string }): string {
  if (code.verification_uri_complete) return code.verification_uri_complete;
  const sep = code.verification_uri.includes("?") ? "&" : "?";
  return `${code.verification_uri}${sep}user_code=${encodeURIComponent(code.user_code)}`;
}

function getAuthPath(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (envDir) return join(envDir, "auth.json");
  return join(homedir(), ".pi", "agent", "auth.json");
}

function getBroker(signal?: AbortSignal): ReturnType<typeof createBroker> {
  const cfg = resolveOAuthConfig();
  return createBroker({
    authPath: getAuthPath(),
    earlyRefreshSec: cfg.earlyRefreshSec,
    fetchImpl: fetch as unknown as typeof fetch,
  });
}

export default function (pi: ExtensionAPI): void {
  // Pi-native OAuth provider `grok-build` — do not override `xai`
  pi.registerProvider("grok-build", {
    // Use openai-compatible api placeholder; model list empty until discovery
    // Provider is auth-only for M2; images wire later.
    api: "openai-completions" as never,
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
            callbacks.onAuth({ url: displayUri, instructions: `Confirm code ${code.user_code} in your browser` });
          } else {
            callbacks.onDeviceCode({
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
        } as unknown as never;
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
        const broker = getBroker(signal as AbortSignal | undefined);
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
          } as unknown as never;
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
  });

  // Explicit import command — disabled by default, requires confirm
  pi.registerCommand("grok-build:import", {
    description: "Import credentials from ~/.grok/auth.json (requires confirm)",
    handler: async (args, ctx) => {
      const confirm = ((args as unknown) as Record<string, unknown> | undefined)?.confirm === true;
      if (!confirm) {
        ctx.ui.notify("Import requires confirm: /grok-build:import --confirm or invoke with {confirm:true}", "warning");
        return;
      }
      const result = await importFromGlobalGrok({ confirm: true });
      if (result.imported) {
        ctx.ui.notify("Found ~/.grok/auth.json — copy its token via /login grok-build instead of silent read. No file was modified.", "info");
      } else {
        ctx.ui.notify(`Import not performed: ${result.reason ?? "unknown"}`, "warning");
      }
      await emit("import_checked", result);
    },
  });

  pi.registerCommand("grok-build:status", {
    description: "Show Grok Build OAuth status (no secrets)",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Use /login grok-build and /logout grok-build. Status is visible in Settings > Grok Build.", "info");
    },
  });

  // Keep placeholder invoke for bridge verification
  pi.registerCommand(EXTENSION_ID, {
    description: "Grok Build OAuth — invoke bridge check",
    handler: async (args) => {
      await emit("invoke", { args: args ?? null, settings: settingsSnapshot() });
    },
  });

  // M3: image_gen shares the same broker API as provider requests (early refresh, 401 single retry, redaction)
  pi.registerTool({
    name: "image_gen",
    label: "Grok Build image_gen (OAuth via broker, image transport pending)",
    description: "Placeholder — image generation ships after OAuth phases; broker validates auth.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image prompt" },
        aspect_ratio: { type: "string", description: "Aspect ratio (e.g. 16:9, auto)" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal) {
      // Broker ensures early refresh before any image request; never logs token
      const broker = getBroker(signal);
      let tokenPreview = "none";
      try {
        const token = await broker.getAccessToken(signal);
        tokenPreview = "[redacted]";
        void token;
      } catch (err) {
        const msg = err instanceof Error ? redactMessage(err.message, []) : String(err);
        // still proceed to placeholder but mark auth state
        tokenPreview = msg.includes("Not logged") ? "not_logged_in" : "refresh_failed";
      }
      const payload = {
        message: "grok-build-oauth M3 — broker ready; image_gen transport ships next phase",
        params,
        settings: settingsSnapshot(),
        broker: { tokenPreview, earlyRefreshSec: resolveOAuthConfig().earlyRefreshSec },
      };
      await emit("skeleton.image_gen", payload);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        details: payload,
      };
    },
  });
}
