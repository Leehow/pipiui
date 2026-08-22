import { resolveOAuthConfig } from "./oauth/config.js";
import { redactMessage } from "./oauth/redact.js";
import { importFromGlobalGrok, parseImportConfirm } from "./oauth/import.js";
import { createGrokBuildProvider, GROK_BUILD_PROVIDER_ID } from "./provider.js";
import { createBroker } from "./oauth/broker.js";
import { authJsonPath } from "./oauth/home.js";
import { ImagesClient, resolveImageReference, } from "./images/client.js";
import { ImagesError, TIER_RESTRICTED_UPSELL } from "./images/errors.js";
import { resolveImagesConfig, resolveRelayBase, isHttpsBaseUrl } from "./images/config.js";
import { resolveSubscriptionTier } from "./images/tier.js";
import { SessionImageWriter } from "./images/storage.js";
const EXTENSION_ID = "grok-build-oauth";
const BRIDGE_PORT = process.env.PIPIUI_BRIDGE_PORT;
const SESSION_CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;
function settingsSnapshot() {
    const key = `PIPIUI_EXT_SETTINGS_${EXTENSION_ID.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
    const raw = process.env[key];
    if (!raw)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
async function emit(event, payload) {
    if (!BRIDGE_PORT || !SESSION_CAPABILITY)
        return;
    try {
        await fetch(`http://127.0.0.1:${BRIDGE_PORT}/rpc`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            // Bounded: a best-effort UI hint must never hang on a stalled bridge.
            // (The provider refresh path additionally treats this as strictly
            // fire-and-forget — see `notifyUnlocked` in provider.ts.)
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
                schemaVersion: 1,
                sessionCapability: SESSION_CAPABILITY,
                action: "ext.emit",
                extensionId: EXTENSION_ID,
                event,
                payload,
            }),
        });
    }
    catch {
        // best-effort
    }
}
/** `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`; throws when both unset (fail closed). */
function getAuthPath() {
    return authJsonPath();
}
function getBroker(signal) {
    const cfg = resolveOAuthConfig();
    return createBroker({
        authPath: getAuthPath(),
        earlyRefreshSec: cfg.earlyRefreshSec,
        fetchImpl: fetch,
    });
}
export default function (pi) {
    // Pi-native OAuth provider `grok-build` — do not override `xai`.
    // The canonical provider config lives in ./provider.js and is shared with
    // the PipiUI host auth runtime (single source, no copied OAuth transport).
    pi.registerProvider(GROK_BUILD_PROVIDER_ID, createGrokBuildProvider({ emit: (event, payload) => emit(event, payload) }));
    // Explicit one-shot import from the official grok CLI's ~/.grok/auth.json
    // (US-09): requires --confirm, reads the source exactly once, validates
    // issuer/client/expiry, persists via the broker (never deletes the source).
    pi.registerCommand("grok-build:import", {
        description: "Import credentials from ~/.grok/auth.json (requires --confirm)",
        handler: async (args, ctx) => {
            const { confirm } = parseImportConfirm(args);
            if (!confirm) {
                ctx.ui.notify("导入需要显式确认：/grok-build:import --confirm（仅读取一次 ~/.grok/auth.json，不会修改源文件）", "warning");
                return;
            }
            let result;
            try {
                const broker = getBroker();
                result = await importFromGlobalGrok({ confirm: true, broker });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                ctx.ui.notify(`导入失败：${redactMessage(msg, [])}`, "error");
                return;
            }
            if (result.imported) {
                const until = result.expiresAtMs ? new Date(result.expiresAtMs).toLocaleString() : "未知";
                ctx.ui.notify(`已从 ~/.grok/auth.json 导入 grok-build 凭证（有效期至 ${until}）；源文件未修改。`, "info");
            }
            else {
                ctx.ui.notify(`导入未完成：${result.reason ?? "未知原因"}`, "warning");
            }
            await emit("import_result", { imported: result.imported, reason: result.reason });
        },
    });
    /**
     * Non-secret status snapshot for the app half (Settings > Grok Build panel) and
     * in-session `/grok-build:status`. Credential values never leave the broker.
     */
    async function statusSnapshot() {
        const images = resolveImagesConfig();
        let auth = {
            loggedIn: false,
            expired: false,
            hasRefresh: false,
            usable: false,
        };
        try {
            auth = await getBroker().status();
        }
        catch {
            /* no resolved home — report unauthenticated, guidance below */
        }
        // Credential source reflects the ACTUAL resolution rules: the legacy
        // XAI_API_KEY path only exists when compatFallback is enabled (US-27).
        const envKey = process.env.XAI_API_KEY?.trim();
        // Tier: explicit override (incl. restricted EMPTY string) or the
        // credential's official id_token `tier` claim; unknown stays visible.
        const tierResolution = resolveSubscriptionTier({
            override: images.tier,
            credential: { tier: auth.tier, tier_raw: auth.tierRaw, tier_source: auth.tierSource },
        });
        const source = auth.usable
            ? "oauth"
            : images.compatFallback && envKey
                ? "env"
                : undefined;
        return {
            loggedIn: auth.loggedIn,
            expired: auth.expired,
            hasRefresh: auth.hasRefresh,
            expiresAtMs: auth.expiresAtMs,
            credentialSource: source,
            baseUrl: images.baseUrl,
            model: images.model,
            tier: tierResolution.tier,
            tierSource: tierResolution.source,
            ...(tierResolution.raw !== undefined ? { tierRaw: tierResolution.raw } : {}),
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
                `tier=${status.tier === undefined ? (status.tierRaw !== undefined ? `未知（claim=${status.tierRaw}，fail-open）` : "未知（fail-open）") : status.tier === "" ? "（空 = Free，受限）" : status.tier}（来源：${status.tierSource === "override" ? "手动配置" : status.tierSource === "credential" ? "登录凭证" : "未知"}）`,
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
        handler: (async (args) => {
            const record = (args ?? {});
            const method = typeof record.method === "string" ? record.method : undefined;
            if (method === "status") {
                return { ok: true, data: await statusSnapshot() };
            }
            return {
                ok: false,
                error: { code: "invalid_params", message: `未知 invoke method：${String(method)}（仅支持 status）` },
            };
        }),
    });
    /**
     * Credential resolution (round-2 reviewer Critical #2):
     * - OAuth usable (present, and fresh or refreshable) -> OAuth over HTTPS only.
     * - compatFallback=false -> NEVER XAI_API_KEY, never relay: actionable error.
     * - compatFallback=true + OAuth absent/expired-without-refresh -> deprecated
     *   fallback: the real XAI_API_KEY only over an HTTPS base; a loopback HTTP
     *   base means the deprecated RELAY transport, which is an independent
     *   loopback endpoint speaking `Bearer local` — the real OAuth token or API
     *   key is never sent to HTTP under any configuration.
     */
    async function resolveImageAuth(signal) {
        const cfg = resolveImagesConfig();
        const broker = getBroker(signal);
        const status = await broker.status();
        if (status.usable)
            return { kind: "oauth", broker };
        if (cfg.compatFallback) {
            const key = process.env.XAI_API_KEY?.trim();
            if (key && isHttpsBaseUrl(cfg.baseUrl))
                return { kind: "api_key", key };
            return { kind: "relay" };
        }
        throw new ImagesError("auth_expired", status.loggedIn
            ? "OAuth 凭证已过期且无 refresh token — 请重新执行 /login grok-build（或在设置中开启 deprecated compat fallback）"
            : "未登录 — 请先执行 /login grok-build（compatFallback 默认关闭，不使用 XAI_API_KEY）");
    }
    function imageResult(saved, b64, op, details, note) {
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
    async function runImageOp(op, signal) {
        const cfg = resolveImagesConfig();
        const auth = await resolveImageAuth(signal);
        if (auth.kind === "relay") {
            // Deprecated loopback relay — only reachable with compatFallback=true.
            // Independent loopback transport with the local relay credential; real
            // OAuth/API-key Bearers never go to it.
            return runLegacyRelay(op, signal);
        }
        // Client-side advisory tier gate — OAuth callers only; API-key callers
        // are never gated. Tier resolution is real-data driven: explicit override
        // (GROK_TIER / settings, incl. the restricted EMPTY string) or the
        // credential's official id_token `tier` claim; unknown stays fail-open.
        // Server remains the final authority (US-22/US-23).
        if (auth.kind === "oauth") {
            const credStatus = await auth.broker.status();
            const tierResolution = resolveSubscriptionTier({ override: cfg.tier, credential: credStatus });
            if (tierResolution.restricted) {
                await emit("image_gen.gated", { code: "tier_restricted", backend: "grok-build" });
                return {
                    content: [{ type: "text", text: TIER_RESTRICTED_UPSELL }],
                    details: { code: "tier_restricted", backend: "grok-build" },
                };
            }
        }
        // Resolve edit references (data URLs / in-root file paths) before any HTTP.
        const dataUrls = [];
        if (op.kind === "edit") {
            for (const ref of op.refs)
                dataUrls.push(await resolveImageReference(ref));
        }
        const client = new ImagesClient({
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            editModel: cfg.editModel,
            sessionId: cfg.sessionId,
            fetchImpl: fetch,
            // HTTPS-only base: the client refuses plain HTTP outright — the
            // deprecated relay never flows through here (it is a separate loopback
            // transport with the local relay credential).
        });
        const writer = new SessionImageWriter();
        const model = op.kind === "gen" ? client.model : client.editModel;
        const requestOnce = async (bearer) => {
            const result = op.kind === "gen"
                ? await client.generate({ prompt: op.prompt, aspectRatio: op.aspectRatio, bearer, signal })
                : await client.edit({ prompt: op.prompt, images: dataUrls, aspectRatio: op.aspectRatio, bearer, signal });
            const saved = await writer.save(result.bytes, { signal });
            return { saved, b64: result.b64 };
        };
        // OAuth path: broker handles early refresh + single forced refresh on 401.
        // API-key path: same client/payload, no refresh, never tier-gated.
        const { saved, b64 } = auth.kind === "oauth"
            ? await auth.broker.with401Retry(requestOnce, signal)
            : await requestOnce(auth.key);
        await emit("image_gen.saved", {
            path: saved.path,
            mime: saved.mime,
            backend: "grok-build",
            model,
        });
        const deprecated = auth.kind === "api_key";
        return imageResult(saved, b64, op, { backend: "grok-build", model, ...(deprecated ? { deprecated: true } : {}) }, deprecated ? "（deprecated 兼容 API key 路径）" : undefined);
    }
    /** Deprecated compat fallback: legacy PipiUI loopback relay (default off). */
    async function runLegacyRelay(op, signal) {
        const relay = resolveRelayBase(); // loopback-only, validated
        await emit("compat_fallback", { deprecated: true, relay: true });
        const cfg = resolveImagesConfig();
        const suffix = op.kind === "edit" ? "/images/edits" : "/images/generations";
        const body = {
            model: cfg.model,
            prompt: op.prompt,
            n: 1,
            response_format: "b64_json",
        };
        if (op.aspectRatio)
            body.aspect_ratio = op.aspectRatio;
        if (op.kind === "edit") {
            const urls = [];
            for (const ref of op.refs)
                urls.push(await resolveImageReference(ref));
            if (urls.length === 1)
                body.image = { url: urls[0] };
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
        const json = (await res.json().catch(() => null));
        const b64 = json?.data?.[0]?.b64_json;
        if (typeof b64 !== "string" || !b64.trim()) {
            throw new ImagesError("invalid_response", "兼容 relay 响应缺少 b64_json 图像数据");
        }
        const { decodeBase64Strict } = await import("./images/client.js");
        const writer = new SessionImageWriter();
        const saved = await writer.save(decodeBase64Strict(b64), { signal });
        return imageResult(saved, b64.replace(/\s+/g, ""), op, { backend: "grok-build-relay", model: cfg.model, deprecated: true }, "（deprecated 兼容 relay）");
    }
    pi.registerTool({
        name: "image_gen",
        label: "Grok Build image_gen",
        description: "Generate a new image from a text description using xAI Grok Imagine; returns a typed image plus the saved file's absolute path under the session attachments directory. When telling the user where it was saved, refer to the short path. To produce multiple images, emit multiple tool calls with distinct prompts.",
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Text description of the image to generate." },
                aspect_ratio: {
                    type: "string",
                    description: "Aspect ratio. Defaults to 'auto'. Supported: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, auto.",
                },
            },
            required: ["prompt"],
            additionalProperties: false,
        },
        async execute(_toolCallId, params, signal) {
            const p = params;
            return runImageOp({ kind: "gen", prompt: p.prompt, aspectRatio: p.aspect_ratio }, signal);
        },
    });
    pi.registerTool({
        name: "image_edit",
        label: "Grok Build image_edit",
        description: "Edit or transform existing image(s) via the xAI Imagine API; use instead of image_gen for image-to-image work (preserve likeness, transfer style, remix). Each `image` entry is a `data:image/...;base64,...` URL or a path to a JPEG/PNG ≤400KB inside the current workspace or the session attachments directory (arbitrary absolute paths are rejected). Returns a typed image plus the saved file's absolute path.",
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
                    description: "Output aspect ratio. Ignored for single-image edits (output matches input). Defaults to 'auto'.",
                },
            },
            required: ["prompt", "image"],
            additionalProperties: false,
        },
        async execute(_toolCallId, params, signal) {
            const p = params;
            return runImageOp({ kind: "edit", prompt: p.prompt, aspectRatio: p.aspect_ratio, refs: p.image ?? [] }, signal);
        },
    });
}
