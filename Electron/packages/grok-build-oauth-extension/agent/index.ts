import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOAuthConfig } from "./oauth/config.js";
import { requestDeviceCode, pollDeviceToken, OAuthError } from "./oauth/device.js";
import { toOAuthCredentials } from "./oauth/credentials.js";
import { redactMessage } from "./oauth/redact.js";
import { importFromGlobalGrok } from "./oauth/import.js";
import { createBroker, type GrokCredentialBroker } from "./oauth/broker.js";
import {
  ImagesClient,
  resolveImageReference,
} from "./images/client.js";
import { ImagesError, TIER_RESTRICTED_UPSELL } from "./images/errors.js";
import { resolveImagesConfig, legacyRelayBase } from "./images/config.js";
import { isRestrictedTier } from "./images/tier.js";
import { SessionImageWriter } from "./images/storage.js";

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

  // ── M4: image_gen / image_edit — official Grok Build wire contract ─────
  // POST {base}/images/generations | /images/edits; model grok-imagine-image-quality,
  // n=1, resolution 1k, b64_json strict decode, x-grok-session-id header.
  // OAuth (via M3 broker: early refresh + 401 single retry) and explicit
  // XAI_API_KEY share this exact client; only Authorization differs.

  type ImageAuth =
    | { kind: "oauth"; broker: GrokCredentialBroker }
    | { kind: "api_key"; key: string };

  async function resolveImageAuth(signal?: AbortSignal): Promise<ImageAuth> {
    const broker = getBroker(signal);
    if (await broker.hasCredential()) return { kind: "oauth", broker };
    const key = process.env.XAI_API_KEY?.trim();
    if (key) return { kind: "api_key", key };
    throw new ImagesError(
      "auth_expired",
      "未登录 — 请先执行 /login grok-build 或设置 XAI_API_KEY",
    );
  }

  type ImageOp =
    | { kind: "gen"; prompt: string; aspectRatio?: string }
    | { kind: "edit"; prompt: string; aspectRatio?: string; refs: string[] };

  type ImageToolDetails = {
    path?: string;
    mime?: string;
    backend: string;
    model?: string;
    code?: string;
    deprecated?: boolean;
  };
  type ImageToolResult = {
    content: { type: "text"; text: string }[];
    details: ImageToolDetails;
  };

  async function runImageOp(op: ImageOp, signal?: AbortSignal): Promise<ImageToolResult> {
    const cfg = resolveImagesConfig();
    let auth: ImageAuth;
    try {
      auth = await resolveImageAuth(signal);
    } catch (err) {
      // Deprecated PipiUI loopback relay — only when compatFallback=true
      // and no OAuth/API-key credential is present (spec §D6 / US-27).
      if (err instanceof ImagesError && err.code === "auth_expired" && cfg.compatFallback) {
        return runLegacyRelay(op, signal);
      }
      throw err;
    }

    // Client-side advisory tier gate — OAuth callers only; API-key callers
    // are never gated. Server remains the final authority (US-22/US-23).
    if (auth.kind === "oauth" && isRestrictedTier(cfg.tier)) {
      await emit("image_gen.gated", { code: "tier_restricted", backend: "grok-build" });
      return {
        content: [{ type: "text" as const, text: TIER_RESTRICTED_UPSELL }],
        details: { code: "tier_restricted", backend: "grok-build" },
      };
    }

    // Resolve edit references (data URLs / safe file paths) before any HTTP.
    const dataUrls: string[] = [];
    if (op.kind === "edit") {
      for (const ref of op.refs) dataUrls.push(await resolveImageReference(ref));
    }

    const client = new ImagesClient({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      editModel: cfg.editModel,
      sessionId: cfg.sessionId,
      fetchImpl: fetch as unknown as typeof fetch,
    });
    const writer = new SessionImageWriter();
    const model = op.kind === "gen" ? client.model : client.editModel;

    const requestOnce = async (bearer: string) => {
      const result =
        op.kind === "gen"
          ? await client.generate({ prompt: op.prompt, aspectRatio: op.aspectRatio, bearer, signal })
          : await client.edit({ prompt: op.prompt, images: dataUrls, aspectRatio: op.aspectRatio, bearer, signal });
      const saved = await writer.save(result.bytes, { signal });
      return saved;
    };

    // OAuth path: broker handles early refresh + single forced refresh on 401.
    // API-key path: same client/payload, no refresh, never tier-gated.
    const saved =
      auth.kind === "oauth"
        ? await auth.broker.with401Retry(requestOnce, signal)
        : await requestOnce(auth.key);

    await emit("image_gen.saved", {
      path: saved.path,
      mime: saved.mime,
      backend: "grok-build",
      model,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `${op.kind === "gen" ? "图像已生成" : "图像已编辑"}: ${saved.path}`,
        },
      ],
      details: { path: saved.path, mime: saved.mime, backend: "grok-build", model },
    };
  }

  /** Deprecated compat fallback: legacy PipiUI loopback relay (default off). */
  async function runLegacyRelay(op: ImageOp, signal?: AbortSignal): Promise<ImageToolResult> {
    const relay = legacyRelayBase();
    await emit("compat_fallback", { deprecated: true, relay: true });
    const cfg = resolveImagesConfig();
    const suffix = op.kind === "edit" ? "/images/edits" : "/images/generations";
    const body: Record<string, unknown> = {
      model: cfg.model,
      prompt: op.prompt,
      n: 1,
      response_format: "b64_json",
    };
    if (op.aspectRatio) body.aspect_ratio = op.aspectRatio;
    if (op.kind === "edit") {
      const urls: string[] = [];
      for (const ref of op.refs) urls.push(await resolveImageReference(ref));
      if (urls.length === 1) body.image = { url: urls[0] };
      else {
        body.images = urls.map((url) => ({ url }));
        body.aspect_ratio = op.aspectRatio ?? "auto";
      }
    }
    const res = await fetch(`${relay.replace(/\/+$/, "")}${suffix}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer local" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = [...(await res.text().catch(() => ""))].slice(0, 200).join("");
      throw new ImagesError("upstream_error", `兼容 relay 请求失败 HTTP ${res.status}: ${text}`, res.status);
    }
    const json = (await res.json().catch(() => null)) as { data?: Array<{ b64_json?: string }> } | null;
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || !b64.trim()) {
      throw new ImagesError("invalid_response", "兼容 relay 响应缺少 b64_json 图像数据");
    }
    const { decodeBase64Strict } = await import("./images/client.js");
    const saved = await new SessionImageWriter().save(decodeBase64Strict(b64), { signal });
    return {
      content: [
        {
          type: "text" as const,
          text: `图像已生成（deprecated 兼容 relay）: ${saved.path}`,
        },
      ],
      details: {
        path: saved.path,
        mime: saved.mime,
        backend: "grok-build-relay",
        model: cfg.model,
        deprecated: true,
      },
    };
  }

  pi.registerTool({
    name: "image_gen",
    label: "Grok Build image_gen",
    description:
      "Generate a new image from a text description using xAI Grok Imagine; returns the saved image's absolute path under the session attachments directory. When telling the user where it was saved, refer to the short path. To produce multiple images, emit multiple tool calls with distinct prompts.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image to generate." },
        aspect_ratio: {
          type: "string",
          description:
            "Aspect ratio. Defaults to 'auto'. Supported: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, auto.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal) {
      const p = params as { prompt: string; aspect_ratio?: string };
      return runImageOp({ kind: "gen", prompt: p.prompt, aspectRatio: p.aspect_ratio }, signal);
    },
  });

  pi.registerTool({
    name: "image_edit",
    label: "Grok Build image_edit",
    description:
      "Edit or transform existing image(s) via the xAI Imagine API; use instead of image_gen for image-to-image work (preserve likeness, transfer style, remix). Each `image` entry is a `data:image/...;base64,...` URL or a filesystem path to a JPEG/PNG ≤400KB. Returns the saved image's absolute path.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A text description of the desired edit or transformation.",
        },
        image: {
          type: "array",
          items: { type: "string" },
          description: "Reference image(s): data:image/...;base64,... URLs or filesystem paths.",
        },
        aspect_ratio: {
          type: "string",
          description:
            "Output aspect ratio. Ignored for single-image edits (output matches input). Defaults to 'auto'.",
        },
      },
      required: ["prompt", "image"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal) {
      const p = params as { prompt: string; image: string[]; aspect_ratio?: string };
      return runImageOp(
        { kind: "edit", prompt: p.prompt, aspectRatio: p.aspect_ratio, refs: p.image ?? [] },
        signal,
      );
    },
  });
}
