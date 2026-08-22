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
import { createBroker } from "./oauth/broker.js";
import { resolveOAuthConfig } from "./oauth/config.js";
import { ImagesClient, resolveImageReference } from "./images/client.js";
import { resolveSubscriptionTier } from "./images/tier.js";
import { SessionImageWriter } from "./images/storage.js";
import { ImagesError, TIER_RESTRICTED_UPSELL } from "./images/errors.js";
import { resolveImagesConfig } from "./images/config.js";
import { authJsonPath, attachmentsRoot, tryResolveAgentHome } from "./oauth/home.js";
export { NoAgentHomeError } from "./oauth/home.js";
export { ImagesError } from "./images/errors.js";
export { OAuthError } from "./oauth/device.js";
async function runWithBroker(broker, op, signal) {
    // OAuth is the canonical path; compat fallback (deprecated) mirrors the
    // extension tools' rules so both hosts behave identically.
    const cfg = resolveImagesConfig();
    const status = await broker.status();
    if (status.usable) {
        return { result: await broker.with401Retry(op, signal) };
    }
    if (cfg.compatFallback) {
        const key = process.env.XAI_API_KEY?.trim();
        if (key)
            return { result: await op(key), deprecated: true };
    }
    throw new ImagesError("auth_expired", status.loggedIn
        ? "OAuth 凭证已过期且无 refresh token — 请重新登录 grok-build"
        : "未登录 — 请先登录 grok-build（compatFallback 默认关闭，不使用 XAI_API_KEY）");
}
export function createGrokBuildHostLibrary(options = {}) {
    const authPath = options.authPath ?? authJsonPath();
    const fetchImpl = (options.fetchImpl ?? fetch);
    const broker = createBroker({
        authPath,
        earlyRefreshSec: resolveOAuthConfig().earlyRefreshSec,
        fetchImpl,
        ...(options.credentialStore ? { credentialStore: options.credentialStore } : {}),
    });
    // Reference-image roots — SAME resolver contract as the agent tool
    // (resolveImageReference: realpath containment, JPEG/PNG, ≤400KB): the
    // current working directory plus the attachments root (imagesRoot override
    // wins, e.g. tests / host-scoped isolation roots).
    const referenceRoots = () => {
        const roots = [process.cwd()];
        if (options.imagesRoot)
            roots.push(options.imagesRoot);
        else {
            const home = tryResolveAgentHome();
            if (home)
                roots.push(attachmentsRoot(home));
        }
        return roots;
    };
    const execute = async (kind, req) => {
        const cfg = resolveImagesConfig();
        // Advisory client-side tier gate (OAuth callers only; API-key compat never gated;
        // server authoritative). Tier comes from the explicit override or the
        // credential's official id_token `tier` claim; unknown stays fail-open.
        const status = await broker.status();
        if (status.usable) {
            const tierResolution = resolveSubscriptionTier({ override: cfg.tier, credential: status });
            if (tierResolution.restricted) {
                throw new ImagesError("tier_restricted", TIER_RESTRICTED_UPSELL);
            }
        }
        const client = new ImagesClient({
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            editModel: cfg.editModel,
            sessionId: cfg.sessionId,
            fetchImpl,
            // HTTPS-only base (the client refuses plain HTTP; the deprecated relay
            // is a separate loopback transport and is not offered on the host entry).
        });
        const writer = new SessionImageWriter(options.imagesRoot);
        const model = kind === "gen" ? client.model : client.editModel;
        const { result, deprecated } = await runWithBroker(broker, async (bearer) => {
            // Host/tool parity (round-2 reviewer): edit references go through the
            // SAME resolveImageReference contract as the agent tool — realpath
            // containment inside the allowed roots, `..` rejection, JPEG/PNG only,
            // ≤ MAX_REFERENCE_BYTES — before any bytes reach the client.
            const resolvedImages = kind === "edit"
                ? await Promise.all((req.images ?? []).map((ref) => resolveImageReference(ref, { allowedRoots: referenceRoots() })))
                : [];
            const image = kind === "gen"
                ? await client.generate({ prompt: req.prompt, aspectRatio: req.aspectRatio, bearer, signal: req.signal })
                : await client.edit({
                    prompt: req.prompt,
                    images: resolvedImages,
                    aspectRatio: req.aspectRatio,
                    bearer,
                    signal: req.signal,
                });
            const saved = await writer.save(image.bytes, { signal: req.signal });
            return { image, saved };
        }, req.signal);
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
        async status() {
            return broker.status();
        },
        async generateImage(req) {
            return execute("gen", req);
        },
        async editImage(req) {
            return execute("edit", req);
        },
        broker() {
            return broker;
        },
    };
}
/** Version of the host entry — the receipt pins the content hash of this file. */
export const HOST_LIBRARY_VERSION = "1.0.0";
