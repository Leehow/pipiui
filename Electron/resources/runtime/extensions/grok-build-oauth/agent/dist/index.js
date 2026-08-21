import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOAuthConfig } from "./oauth/config.js";
import { importFromGlobalGrok } from "./oauth/import.js";
import { createGrokBuildProvider, GROK_BUILD_PROVIDER_ID } from "./provider.js";
import { createBroker } from "./oauth/broker.js";
import { ImagesClient, resolveImageReference, } from "./images/client.js";
import { ImagesError, TIER_RESTRICTED_UPSELL } from "./images/errors.js";
import { resolveImagesConfig, legacyRelayBase } from "./images/config.js";
import { isRestrictedTier } from "./images/tier.js";
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
function getAuthPath() {
    const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
    if (envDir)
        return join(envDir, "auth.json");
    return join(homedir(), ".pi", "agent", "auth.json");
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
    // Explicit import command — disabled by default, requires confirm
    pi.registerCommand("grok-build:import", {
        description: "Import credentials from ~/.grok/auth.json (requires confirm)",
        handler: async (args, ctx) => {
            const confirm = args?.confirm === true;
            if (!confirm) {
                ctx.ui.notify("Import requires confirm: /grok-build:import --confirm or invoke with {confirm:true}", "warning");
                return;
            }
            const result = await importFromGlobalGrok({ confirm: true });
            if (result.imported) {
                ctx.ui.notify("Found ~/.grok/auth.json — copy its token via /login grok-build instead of silent read. No file was modified.", "info");
            }
            else {
                ctx.ui.notify(`Import not performed: ${result.reason ?? "unknown"}`, "warning");
            }
            await emit("import_checked", result);
        },
    });
    /**
     * Non-secret status snapshot for the app half (Settings > Grok Build panel) and
     * in-session `/grok-build:status`. Credential values never leave the broker.
     */
    async function statusSnapshot() {
        const broker = getBroker();
        const auth = await broker.status();
        const images = resolveImagesConfig();
        const source = auth.loggedIn
            ? "oauth"
            : process.env.XAI_API_KEY?.trim()
                ? "env"
                : undefined;
        return {
            loggedIn: auth.loggedIn,
            expired: auth.expired,
            expiresAtMs: auth.expiresAtMs,
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
                        ? "已登录但凭证已过期 — 请重新执行 /login grok-build"
                        : `已登录（oauth）${typeof status.expiresAtMs === "number" ? `，到期 ${new Date(status.expiresAtMs).toLocaleString()}` : ""}`
                    : status.credentialSource === "env"
                        ? "未登录 OAuth；当前使用 XAI_API_KEY 环境变量（api_key）"
                        : "未登录 — 执行 /login grok-build，或在 设置 > 添加模型/供应商 中登录 Grok Build",
                `base=${status.baseUrl} model=${status.model}`,
                status.compatFallback ? "compatFallback=1（deprecated 兼容回退已开启）" : "compatFallback=0（默认关闭）",
            ];
            ctx.ui.notify(parts.join("；"), "info");
        },
    });
    // App → agent invoke target (host `invokeExtension`). Method `status` answers with the
    // non-secret snapshot; anything else echoes for bridge verification (M3 contract).
    // Pi types command handlers as returning void; the host invoke contract answers with
    // ExtInvokeResult, so the handler is cast at the registration boundary.
    pi.registerCommand(EXTENSION_ID, {
        description: "Grok Build OAuth — invoke bridge (status)",
        handler: (async (args) => {
            const record = (args ?? {});
            const method = typeof record.method === "string" ? record.method : undefined;
            if (method === "status") {
                return { ok: true, data: await statusSnapshot() };
            }
            await emit("invoke", { args: args ?? null, settings: settingsSnapshot() });
            return { ok: true, data: { echoed: args ?? null } };
        }),
    });
    async function resolveImageAuth(signal) {
        const broker = getBroker(signal);
        if (await broker.hasCredential())
            return { kind: "oauth", broker };
        const key = process.env.XAI_API_KEY?.trim();
        if (key)
            return { kind: "api_key", key };
        throw new ImagesError("auth_expired", "未登录 — 请先执行 /login grok-build 或设置 XAI_API_KEY");
    }
    async function runImageOp(op, signal) {
        const cfg = resolveImagesConfig();
        let auth;
        try {
            auth = await resolveImageAuth(signal);
        }
        catch (err) {
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
                content: [{ type: "text", text: TIER_RESTRICTED_UPSELL }],
                details: { code: "tier_restricted", backend: "grok-build" },
            };
        }
        // Resolve edit references (data URLs / safe file paths) before any HTTP.
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
        });
        const writer = new SessionImageWriter();
        const model = op.kind === "gen" ? client.model : client.editModel;
        const requestOnce = async (bearer) => {
            const result = op.kind === "gen"
                ? await client.generate({ prompt: op.prompt, aspectRatio: op.aspectRatio, bearer, signal })
                : await client.edit({ prompt: op.prompt, images: dataUrls, aspectRatio: op.aspectRatio, bearer, signal });
            const saved = await writer.save(result.bytes, { signal });
            return saved;
        };
        // OAuth path: broker handles early refresh + single forced refresh on 401.
        // API-key path: same client/payload, no refresh, never tier-gated.
        const saved = auth.kind === "oauth"
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
                    type: "text",
                    text: `${op.kind === "gen" ? "图像已生成" : "图像已编辑"}: ${saved.path}`,
                },
            ],
            details: { path: saved.path, mime: saved.mime, backend: "grok-build", model },
        };
    }
    /** Deprecated compat fallback: legacy PipiUI loopback relay (default off). */
    async function runLegacyRelay(op, signal) {
        const relay = legacyRelayBase();
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
        const saved = await new SessionImageWriter().save(decodeBase64Strict(b64), { signal });
        return {
            content: [
                {
                    type: "text",
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
        description: "Generate a new image from a text description using xAI Grok Imagine; returns the saved image's absolute path under the session attachments directory. When telling the user where it was saved, refer to the short path. To produce multiple images, emit multiple tool calls with distinct prompts.",
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
        description: "Edit or transform existing image(s) via the xAI Imagine API; use instead of image_gen for image-to-image work (preserve likeness, transfer style, remix). Each `image` entry is a `data:image/...;base64,...` URL or a filesystem path to a JPEG/PNG ≤400KB. Returns the saved image's absolute path.",
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
