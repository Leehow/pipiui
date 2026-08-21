import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveOAuthConfig } from "./oauth/config.js";
import { redactMessage } from "./oauth/redact.js";
import { importFromGlobalGrok, parseImportConfirm } from "./oauth/import.js";
import { createGrokBuildProvider, GROK_BUILD_PROVIDER_ID } from "./provider.js";
import { createBroker, type GrokCredentialBroker } from "./oauth/broker.js";
import { authJsonPath } from "./oauth/home.js";
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

/** `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`; throws when both unset (fail closed). */
function getAuthPath(): string {
  return authJsonPath();
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
  // Pi-native OAuth provider `grok-build` — do not override `xai`.
  // The canonical provider config lives in ./provider.js and is shared with
  // the PipiUI host auth runtime (single source, no copied OAuth transport).
  pi.registerProvider(
    GROK_BUILD_PROVIDER_ID,
    createGrokBuildProvider({ emit: (event, payload) => emit(event, payload) }) as never,
  );

  // Explicit one-shot import from the official grok CLI's ~/.grok/auth.json
  // (US-09): requires --confirm, reads the source exactly once, validates
  // issuer/client/expiry, persists via the broker (never deletes the source).
  pi.registerCommand("grok-build:import", {
    description: "Import credentials from ~/.grok/auth.json (requires --confirm)",
    handler: async (args, ctx) => {
      const { confirm } = parseImportConfirm(args);
      if (!confirm) {
        ctx.ui.notify(
          "导入需要显式确认：/grok-build:import --confirm（仅读取一次 ~/.grok/auth.json，不会修改源文件）",
          "warning",
        );
        return;
      }
      let result;
      try {
        const broker = getBroker();
        result = await importFromGlobalGrok({ confirm: true, broker });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`导入失败：${redactMessage(msg, [])}`, "error");
        return;
      }
      if (result.imported) {
        const until = result.expiresAtMs ? new Date(result.expiresAtMs).toLocaleString() : "未知";
        ctx.ui.notify(`已从 ~/.grok/auth.json 导入 grok-build 凭证（有效期至 ${until}）；源文件未修改。`, "info");
      } else {
        ctx.ui.notify(`导入未完成：${result.reason ?? "未知原因"}`, "warning");
      }
      await emit("import_result", { imported: result.imported, reason: result.reason });
    },
  });

  /**
   * Non-secret status snapshot for the app half (Settings > Grok Build panel) and
   * in-session `/grok-build:status`. Credential values never leave the broker.
   */
  async function statusSnapshot(): Promise<Record<string, unknown>> {
    const images = resolveImagesConfig();
    let auth: Awaited<ReturnType<GrokCredentialBroker["status"]>> = {
      loggedIn: false,
      expired: false,
      hasRefresh: false,
      usable: false,
    };
    try {
      auth = await getBroker().status();
    } catch {
      /* no resolved home — report unauthenticated, guidance below */
    }
    // Credential source reflects the ACTUAL resolution rules: the legacy
    // XAI_API_KEY path only exists when compatFallback is enabled (US-27).
    const envKey = process.env.XAI_API_KEY?.trim();
    const source = auth.usable
      ? "oauth"
      : images.compatFallback && envKey
        ? "env"
        : undefined;
    return {
      loggedIn: auth.loggedIn,
      expired: auth.expired,
      hasRefresh: auth.hasRefresh,
      credentialSource: source,
      baseUrl: images.baseUrl,
      model: images.model,
      tier: images.tier,
      compatFallback: images.compatFallback,
    };
  }

  pi.registerCommand("grok-build:status", {
    description: "Show Grok Build OAuth status (no secrets)",
    handler: async (_args, ctx) => {
      const status = await statusSnapshot();
      const parts = [
        status.loggedIn
          ? status.expired
            ? status.hasRefresh
              ? "已登录（凭证已过期，将自动刷新）"
              : "已登录但凭证已过期且无 refresh token — 请重新执行 /login grok-build"
            : `已登录（oauth）${typeof status.expiresAtMs === "number" ? `，到期 ${new Date(status.expiresAtMs).toLocaleString()}` : ""}`
          : status.credentialSource === "env"
            ? "未登录 OAuth；compatFallback 开启，当前使用 XAI_API_KEY 环境变量（deprecated 兼容）"
            : "未登录 — 执行 /login grok-build，或在 设置 > 添加模型/供应商 中登录 Grok Build",
        `base=${status.baseUrl} model=${status.model}`,
        status.compatFallback ? "compatFallback=1（deprecated 兼容回退已开启）" : "compatFallback=0（默认关闭，XAI_API_KEY/relay 不会被使用）",
      ];
      ctx.ui.notify(parts.join("；"), "info");
    },
  });

  // App → agent invoke target (host `invokeExtension`). Only the fixed methods
  // from the extension contract (spec §D10) are answered; unknown methods are
  // refused without echoing raw args back to the bridge (secret hygiene).
  pi.registerCommand(EXTENSION_ID, {
    description: "Grok Build OAuth — invoke bridge (status)",
    handler: (async (args: unknown) => {
      const record = (args ?? {}) as Record<string, unknown>;
      const method = typeof record.method === "string" ? record.method : undefined;
      if (method === "status") {
        return { ok: true, data: await statusSnapshot() };
      }
      return {
        ok: false,
        error: { code: "invalid_params", message: `未知 invoke method：${String(method)}（仅支持 status）` },
      };
    }) as unknown as (args: string) => Promise<void>,
  });

  // ── M4: image_gen / image_edit — official Grok Build wire contract ─────
  // POST {base}/images/generations | /images/edits; model grok-imagine-image-quality,
  // n=1, resolution 1k, b64_json strict decode, x-grok-session-id header.
  // OAuth (via M3 broker: early refresh + 401 single retry) is the only
  // credential path by default; the explicit XAI_API_KEY / loopback-relay
  // compat paths exist ONLY when ext.grok-build-oauth.compatFallback=true
  // (US-27, deprecated) and OAuth is not usable.

  type ImageAuth =
    | { kind: "oauth"; broker: GrokCredentialBroker }
    | { kind: "api_key"; key: string }
    | { kind: "relay" };

  /**
   * Credential resolution (reviewer MUST-FIX #4):
   * - OAuth usable (present, and fresh or refreshable) -> OAuth.
   * - compatFallback=false -> NEVER XAI_API_KEY, never relay: actionable error.
   * - compatFallback=true + OAuth absent/expired-without-refresh -> explicit
   *   deprecated fallback (API key first, then relay).
   */
  async function resolveImageAuth(signal?: AbortSignal): Promise<ImageAuth> {
    const cfg = resolveImagesConfig();
    const broker = getBroker(signal);
    const status = await broker.status();
    if (status.usable) return { kind: "oauth", broker };
    if (cfg.compatFallback) {
      const key = process.env.XAI_API_KEY?.trim();
      if (key) return { kind: "api_key", key };
      return { kind: "relay" };
    }
    throw new ImagesError(
      "auth_expired",
      status.loggedIn
        ? "OAuth 凭证已过期且无 refresh token — 请重新执行 /login grok-build（或在设置中开启 deprecated compat fallback）"
        : "未登录 — 请先执行 /login grok-build（compatFallback 默认关闭，不使用 XAI_API_KEY）",
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
    content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
    details: ImageToolDetails;
  };

  function imageResult(
    saved: { path: string; mime: string },
    b64: string,
    op: ImageOp,
    details: ImageToolDetails,
    note?: string,
  ): ImageToolResult {
    const prefix = op.kind === "gen" ? "图像已生成" : "图像已编辑";
    return {
      content: [
        { type: "text", text: `${prefix}${note ?? ""}: ${saved.path}` },
        // Typed image content (US-18): strict-decoded b64 reaches the model and
        // the host UI as a first-class image block, not just a path string.
        { type: "image", data: b64, mimeType: saved.mime },
      ],
      details: { ...details, path: saved.path, mime: saved.mime },
    };
  }

  async function runImageOp(op: ImageOp, signal?: AbortSignal): Promise<ImageToolResult> {
    const cfg = resolveImagesConfig();
    const auth = await resolveImageAuth(signal);

    if (auth.kind === "relay") {
      // Deprecated loopback relay — only reachable with compatFallback=true.
      return runLegacyRelay(op, signal);
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

    // Resolve edit references (data URLs / in-root file paths) before any HTTP.
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
      // Loopback http base URLs only exist for the deprecated compat relay,
      // which requires compatFallback=true (reviewer MUST-FIX #8).
      allowHttpLoopback: cfg.compatFallback,
    });
    const writer = new SessionImageWriter();
    const model = op.kind === "gen" ? client.model : client.editModel;

    const requestOnce = async (bearer: string) => {
      const result =
        op.kind === "gen"
          ? await client.generate({ prompt: op.prompt, aspectRatio: op.aspectRatio, bearer, signal })
          : await client.edit({ prompt: op.prompt, images: dataUrls, aspectRatio: op.aspectRatio, bearer, signal });
      const saved = await writer.save(result.bytes, { signal });
      return { saved, b64: result.b64 };
    };

    // OAuth path: broker handles early refresh + single forced refresh on 401.
    // API-key path: same client/payload, no refresh, never tier-gated.
    const { saved, b64 } =
      auth.kind === "oauth"
        ? await auth.broker.with401Retry(requestOnce, signal)
        : await requestOnce(auth.key);

    await emit("image_gen.saved", {
      path: saved.path,
      mime: saved.mime,
      backend: "grok-build",
      model,
    });
    const deprecated = auth.kind === "api_key";
    return imageResult(
      saved,
      b64,
      op,
      { backend: "grok-build", model, ...(deprecated ? { deprecated: true } : {}) },
      deprecated ? "（deprecated 兼容 API key 路径）" : undefined,
    );
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
    const writer = new SessionImageWriter();
    const saved = await writer.save(decodeBase64Strict(b64), { signal });
    return imageResult(
      saved,
      b64.replace(/\s+/g, ""),
      op,
      { backend: "grok-build-relay", model: cfg.model, deprecated: true },
      "（deprecated 兼容 relay）",
    );
  }

  pi.registerTool({
    name: "image_gen",
    label: "Grok Build image_gen",
    description:
      "Generate a new image from a text description using xAI Grok Imagine; returns a typed image plus the saved file's absolute path under the session attachments directory. When telling the user where it was saved, refer to the short path. To produce multiple images, emit multiple tool calls with distinct prompts.",
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
      "Edit or transform existing image(s) via the xAI Imagine API; use instead of image_gen for image-to-image work (preserve likeness, transfer style, remix). Each `image` entry is a `data:image/...;base64,...` URL or a path to a JPEG/PNG ≤400KB inside the current workspace or the session attachments directory (arbitrary absolute paths are rejected). Returns a typed image plus the saved file's absolute path.",
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
          description: "Reference image(s): data:image/...;base64,... URLs or in-workspace/attachment filesystem paths.",
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
