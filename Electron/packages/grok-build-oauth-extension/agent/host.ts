/**
 * Stable host library entry (`agent/dist/host.js`) — the chatrpgv4 pi-coc host
 * consumer loads THIS module from the same build artifact as the extension
 * itself (single source; no second OAuth/image implementation exists).
 *
 * The manifest declares this entry (`host.entry`) and the bundled sync writes a
 * content-hash receipt next to it so a future pi-coc resolver can verify both
 * hosts consume byte-identical code (spec §D1 "两宿主解析到同一文件内容").
 *
 * Everything funnels through the same primitives the tools use: the credential
 * broker (symlink-safe shared-profile locking, early refresh, 401 retry), the
 * advisory tier gate, the ImagesClient wire contract, and the atomic
 * SessionImageWriter. Results carry bytes + metadata (never just a path).
 */
import { createBroker, type GrokCredentialBroker, type BrokerCredential } from "./oauth/broker.js";
import { resolveOAuthConfig } from "./oauth/config.js";
import { ImagesClient } from "./images/client.js";
import { isRestrictedTier } from "./images/tier.js";
import { SessionImageWriter } from "./images/storage.js";
import { ImagesError, TIER_RESTRICTED_UPSELL } from "./images/errors.js";
import { resolveImagesConfig } from "./images/config.js";
import { authJsonPath } from "./oauth/home.js";

export { NoAgentHomeError } from "./oauth/home.js";
export { ImagesError } from "./images/errors.js";
export { OAuthError } from "./oauth/device.js";

export type HostStatus = {
  loggedIn: boolean;
  expired: boolean;
  hasRefresh: boolean;
  usable: boolean;
  expiresAtMs?: number;
  issuer?: string;
};

export type HostImageResult = {
  /** Decoded image bytes. */
  bytes: Uint8Array;
  /** Strict-decoded base64 (no whitespace). */
  b64: string;
  mime: string;
  /** Absolute path of the atomically-saved file under the attachments root. */
  path: string;
  model: string;
  backend: string;
  deprecated?: boolean;
};

export type HostLibraryOptions = {
  /** Defaults to `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR` (fail closed). */
  authPath?: string;
  fetchImpl?: typeof fetch;
  /** Images isolation root override (tests). */
  imagesRoot?: string;
};

export type HostLibrary = {
  status(): Promise<HostStatus>;
  generateImage(req: { prompt: string; aspectRatio?: string; signal?: AbortSignal }): Promise<HostImageResult>;
  editImage(req: {
    prompt: string;
    /** data URLs or paths inside the allowed roots (cwd / attachments). */
    images: string[];
    aspectRatio?: string;
    signal?: AbortSignal;
  }): Promise<HostImageResult>;
  /** Direct access to the shared broker for host-managed refresh (rare). */
  broker(): GrokCredentialBroker;
};

function tierGate(tier: string | undefined): void {
  if (isRestrictedTier(tier)) {
    throw new ImagesError("tier_restricted", TIER_RESTRICTED_UPSELL);
  }
}

async function runWithBroker<T>(
  broker: GrokCredentialBroker,
  op: (bearer: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<{ result: T; deprecated?: boolean }> {
  // OAuth is the canonical path; compat fallback (deprecated) mirrors the
  // extension tools' rules so both hosts behave identically.
  const cfg = resolveImagesConfig();
  const status = await broker.status();
  if (status.usable) {
    return { result: await broker.with401Retry(op, signal) };
  }
  if (cfg.compatFallback) {
    const key = process.env.XAI_API_KEY?.trim();
    if (key) return { result: await op(key), deprecated: true };
  }
  throw new ImagesError(
    "auth_expired",
    status.loggedIn
      ? "OAuth 凭证已过期且无 refresh token — 请重新登录 grok-build"
      : "未登录 — 请先登录 grok-build（compatFallback 默认关闭，不使用 XAI_API_KEY）",
  );
}

export function createGrokBuildHostLibrary(options: HostLibraryOptions = {}): HostLibrary {
  const authPath = options.authPath ?? authJsonPath();
  const fetchImpl = (options.fetchImpl ?? fetch) as typeof fetch;

  const broker = createBroker({
    authPath,
    earlyRefreshSec: resolveOAuthConfig().earlyRefreshSec,
    fetchImpl,
  });

  const execute = async (
    kind: "gen" | "edit",
    req: { prompt: string; aspectRatio?: string; signal?: AbortSignal; images?: string[] },
  ): Promise<HostImageResult> => {
    const cfg = resolveImagesConfig();
    // Advisory client-side tier gate (OAuth callers only; API-key compat never gated;
    // server authoritative).
    const status = await broker.status();
    if (status.usable) tierGate(cfg.tier);

    const client = new ImagesClient({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      editModel: cfg.editModel,
      sessionId: cfg.sessionId,
      fetchImpl,
      allowHttpLoopback: cfg.compatFallback,
    });
    const writer = new SessionImageWriter(options.imagesRoot);
    const model = kind === "gen" ? client.model : client.editModel;

    const { result, deprecated } = await runWithBroker(
      broker,
      async (bearer: string) => {
        const image =
          kind === "gen"
            ? await client.generate({ prompt: req.prompt, aspectRatio: req.aspectRatio, bearer, signal: req.signal })
            : await client.edit({
                prompt: req.prompt,
                images: req.images ?? [],
                aspectRatio: req.aspectRatio,
                bearer,
                signal: req.signal,
              });
        const saved = await writer.save(image.bytes, { signal: req.signal });
        return { image, saved };
      },
      req.signal,
    );

    return {
      bytes: new Uint8Array(result.image.bytes),
      b64: result.image.b64,
      mime: result.saved.mime,
      path: result.saved.path,
      model,
      backend: deprecated ? "grok-build-compat" : "grok-build",
      ...(deprecated ? { deprecated: true } : {}),
    };
  };

  return {
    async status(): Promise<HostStatus> {
      return broker.status();
    },
    async generateImage(req): Promise<HostImageResult> {
      return execute("gen", req);
    },
    async editImage(req): Promise<HostImageResult> {
      return execute("edit", req);
    },
    broker(): GrokCredentialBroker {
      return broker;
    },
  };
}

/** Version of the host entry — the receipt pins the content hash of this file. */
export const HOST_LIBRARY_VERSION = "1.0.0";

// Re-export the credential type for host consumers that need it.
export type { BrokerCredential };
