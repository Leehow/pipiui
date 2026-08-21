/**
 * M4 — xAI Imagine API client (wire contract aligned with official
 * Grok Build HEAD 19d42e35, crates/codegen/xai-grok-tools
 * /src/implementations/grok_build/image_gen|image_edit).
 *
 * - image_gen:  POST {base}/images/generations
 * - image_edit: POST {base}/images/edits
 * - payload: model / prompt / n=1 / aspect_ratio / resolution "1k" /
 *   response_format "b64_json"; single ref → `image`, multi → `images`
 *   (aspect_ratio only sent for multi-image edits).
 * - headers: content-type json, Bearer, x-grok-session-id.
 * - response: strict base64 decode of data[0].b64_json; empty/malformed
 *   → invalid_response (nothing is written to disk).
 * - OAuth and explicit XAI_API_KEY share this exact client; only the
 *   Authorization source differs.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { ImagesError } from "./errors.js";
import { redactMessage } from "../oauth/redact.js";
import { tryResolveAgentHome } from "../oauth/home.js";
export const ASPECT_RATIOS = [
    "1:1",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "2:1",
    "1:2",
    "19.5:9",
    "9:19.5",
    "20:9",
    "9:20",
    "auto",
];
export const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_MODEL = "grok-imagine-image-quality";
export const DEFAULT_EDIT_MODEL = "grok-imagine-image-quality";
export const SESSION_ID_HEADER = "x-grok-session-id";
/** Official client uses 300s total / 240s read; keep a single generous cap. */
export const DEFAULT_TIMEOUT_MS = 300_000;
/** Official Imagine reference-image raw size limit (backend 400s above). */
export const MAX_REFERENCE_BYTES = 400 * 1024;
function isLoopbackHost(url) {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
}
/**
 * Normalize a base URL. Bearer credentials are only ever sent over HTTPS;
 * plain HTTP is refused, except for explicit loopback compat relay endpoints
 * (and only when the caller passes `allowHttpLoopback` — i.e. the deprecated
 * compat path is explicitly enabled). (Reviewer MUST-FIX #8.)
 */
export function normalizeBaseUrl(raw, opts = {}) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new ImagesError("invalid_params", "xai_api_base_url 不能为空");
    }
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new ImagesError("invalid_params", `非法的 xai_api_base_url: ${trimmed}`);
    }
    if (url.protocol === "https:") {
        // ok
    }
    else if (url.protocol === "http:" && opts.allowHttpLoopback && isLoopbackHost(url)) {
        // loopback compat relay only, explicitly enabled
    }
    else if (url.protocol === "http:" && isLoopbackHost(url)) {
        throw new ImagesError("invalid_params", `拒绝 HTTP base URL（${trimmed}）：Bearer 凭证仅发性 HTTPS；loopback HTTP 仅在 compatFallback 开启时用于 deprecated relay`);
    }
    else {
        throw new ImagesError("invalid_params", `拒绝非 HTTPS 的 xai_api_base_url: ${trimmed}（Bearer 凭证仅发 HTTPS）`);
    }
    return trimmed.replace(/\/+$/, "");
}
export function assertAspectRatio(aspectRatio) {
    if (!ASPECT_RATIOS.includes(aspectRatio)) {
        throw new ImagesError("invalid_params", `不支持的 aspect_ratio "${aspectRatio}"。可选值: ${ASPECT_RATIOS.join(", ")}`);
    }
}
export function assertModel(model) {
    const m = model.trim();
    if (!m)
        throw new ImagesError("invalid_params", "model 不能为空");
    return m;
}
/** Strict base64 decode — rejects empty/malformed input (no partial writes). */
export function decodeBase64Strict(b64) {
    const s = b64.replace(/\s+/g, "");
    if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
        throw new ImagesError("invalid_response", "图像响应 base64 数据为空或格式非法");
    }
    return Buffer.from(s, "base64");
}
function classifyStatus(status) {
    if (status === 401)
        return { code: "auth_expired", label: "认证已失效" };
    if (status === 403)
        return { code: "tier_restricted", label: "当前订阅 tier 不支持图像生成" };
    if (status === 429)
        return { code: "rate_limited", label: "请求过于频繁，请稍后再试" };
    if (status >= 500)
        return { code: "upstream_error", label: "上游服务错误" };
    return { code: "http_failure", label: "请求失败" };
}
export class ImagesClient {
    baseUrl;
    model;
    editModel;
    sessionId;
    extraHeaders;
    timeoutMs;
    fetchImpl;
    constructor(opts = {}) {
        this.baseUrl = normalizeBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL, { allowHttpLoopback: opts.allowHttpLoopback === true });
        this.model = assertModel(opts.model ?? DEFAULT_MODEL);
        this.editModel = assertModel(opts.editModel ?? DEFAULT_EDIT_MODEL);
        this.sessionId = opts.sessionId?.trim() || undefined;
        this.extraHeaders = opts.extraHeaders ?? {};
        this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }
    /** image_gen — POST {base}/images/generations */
    async generate(req) {
        const prompt = req.prompt?.trim();
        if (!prompt)
            throw new ImagesError("invalid_params", "prompt 不能为空");
        if (!req.bearer)
            throw new ImagesError("auth_expired", "缺少凭证 — 请先 /login grok-build 或设置 XAI_API_KEY");
        const aspectRatio = req.aspectRatio ?? "auto";
        assertAspectRatio(aspectRatio);
        const payload = {
            model: this.model,
            prompt,
            n: 1,
            aspect_ratio: aspectRatio,
            resolution: "1k",
            response_format: "b64_json",
        };
        return this.post("/images/generations", payload, req.bearer, req.signal);
    }
    /**
     * image_edit — POST {base}/images/edits.
     * `images` must already be resolved `data:image/...;base64,...` URLs.
     * Single ref → `image` object; multiple → `images` array + aspect_ratio.
     */
    async edit(req) {
        const prompt = req.prompt?.trim();
        if (!prompt)
            throw new ImagesError("invalid_params", "prompt 不能为空");
        if (!req.bearer)
            throw new ImagesError("auth_expired", "缺少凭证 — 请先 /login grok-build 或设置 XAI_API_KEY");
        if (!req.images || req.images.length === 0) {
            throw new ImagesError("invalid_params", "image_edit 需要至少一张参考图；纯文本生成请使用 image_gen。");
        }
        const aspectRatio = req.aspectRatio ?? "auto";
        const payload = {
            model: this.editModel,
            prompt,
            n: 1,
            resolution: "1k",
            response_format: "b64_json",
        };
        const imgs = req.images.map((url) => ({ url }));
        if (imgs.length === 1) {
            payload.image = imgs[0];
        }
        else {
            // Multi-image edits need an explicit ratio (single edits auto-detect).
            assertAspectRatio(aspectRatio);
            payload.images = imgs;
            payload.aspect_ratio = aspectRatio;
        }
        return this.post("/images/edits", payload, req.bearer, req.signal);
    }
    buildHeaders(bearer) {
        const headers = {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
            ...this.extraHeaders,
        };
        if (this.sessionId)
            headers[SESSION_ID_HEADER] = this.sessionId;
        return headers;
    }
    async post(suffix, payload, bearer, userSignal) {
        const url = `${this.baseUrl}${suffix}`;
        userSignal?.throwIfAborted();
        // Bearer is captured once per call so request + error redaction agree.
        const headers = this.buildHeaders(bearer);
        const signals = [AbortSignal.timeout(this.timeoutMs)];
        if (userSignal)
            signals.push(userSignal);
        const signal = AbortSignal.any(signals);
        let res;
        try {
            res = await this.fetchImpl(url, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                signal,
            });
        }
        catch (err) {
            if (userSignal?.aborted)
                throw err; // user abort → propagate AbortError
            if (signal.aborted) {
                throw new ImagesError("upstream_error", `图像生成超时（${this.timeoutMs}ms）`);
            }
            const msg = err instanceof Error ? err.message : String(err);
            throw new ImagesError("upstream_error", redactMessage(`图像生成 API 请求失败: ${msg}`, [bearer]));
        }
        if (!res.ok) {
            const raw = await res.text().catch(() => "");
            const truncated = redactMessage([...raw].slice(0, 200).join(""), [bearer]);
            const { code } = classifyStatus(res.status);
            throw new ImagesError(code, redactMessage(`图像生成失败 HTTP ${res.status}: ${truncated}`, [bearer]), res.status);
        }
        const body = await res.text().catch(() => "");
        let json;
        try {
            json = JSON.parse(body);
        }
        catch {
            const preview = redactMessage([...body].slice(0, 200).join(""), [bearer]);
            throw new ImagesError("invalid_response", `图像响应无法解析: ${preview}`);
        }
        const data = json?.data;
        const b64 = Array.isArray(data) ? data[0]?.b64_json : undefined;
        if (typeof b64 !== "string" || !b64.trim()) {
            throw new ImagesError("invalid_response", "图像响应缺少 b64_json 图像数据");
        }
        const bytes = decodeBase64Strict(b64);
        return { bytes, b64: b64.replace(/\s+/g, "") };
    }
}
/**
 * Default allowed roots for filesystem reference images: the current working
 * directory (project) and the agent-home attachments root. Absolute paths
 * outside these roots are refused (reviewer MUST-FIX #7).
 */
export function defaultReferenceRoots() {
    const roots = [];
    try {
        roots.push(resolve(process.cwd()));
    }
    catch {
        /* cwd unavailable */
    }
    const home = tryResolveAgentHome();
    if (home)
        roots.push(resolve(home, "attachments"));
    return roots;
}
/** True when `candidate` (already realpath'd) is inside one of `roots` (realpath'd). */
function isInsideRoots(candidate, resolvedRoots) {
    for (const root of resolvedRoots) {
        if (candidate === root || candidate.startsWith(root.endsWith("/") ? root : `${root}/`))
            return true;
    }
    return false;
}
/**
 * Resolve an image_edit reference into a compressed-enough data URL.
 * Accepts `data:image/...;base64,...` URLs and filesystem paths — filesystem
 * paths must stay inside the allowed roots (cwd / agent-home attachments):
 * arbitrary absolute paths are refused, symlink escapes are resolved via
 * realpath and refused when they land outside, and `..` segments are always
 * rejected. JPEG/PNG ≤ MAX_REFERENCE_BYTES pass through (official client
 * re-encodes other formats; without an image codec we reject them with an
 * actionable error instead of sending a doomed request).
 */
export async function resolveImageReference(raw, opts = {}) {
    const value = raw.trim();
    if (!value)
        throw new ImagesError("invalid_params", "image_edit 参考图不能为空");
    if (value.startsWith("data:image/")) {
        const comma = value.indexOf(",");
        if (comma < 0 || !value.slice(0, comma).includes(";base64")) {
            throw new ImagesError("invalid_params", "image_edit 仅支持 base64 data URL 参考图");
        }
        const bytes = decodeBase64Strict(value.slice(comma + 1));
        if (bytes.byteLength === 0) {
            throw new ImagesError("invalid_params", "参考图不含任何数据");
        }
        if (bytes.byteLength > MAX_REFERENCE_BYTES) {
            throw new ImagesError("invalid_params", `参考图过大（${bytes.byteLength} 字节，上限 ${MAX_REFERENCE_BYTES}），请先压缩为 JPEG/PNG`);
        }
        return value; // mime preserved as provided; server validates
    }
    // Filesystem path
    if (value.split(/[\\/]/).includes("..")) {
        throw new ImagesError("invalid_params", "参考图路径不允许包含 .. (路径穿越)");
    }
    const path = value.startsWith("file://") ? value.slice("file://".length) : value;
    const abs = isAbsolute(path) ? resolve(path) : resolve(opts.cwd ?? process.cwd(), path);
    // Containment: resolve symlinks on both sides; refuse anything that lands
    // outside the allowed roots (cwd / attachments). Arbitrary absolute paths
    // (e.g. ~/.ssh/id_rsa renamed to .jpg) never reach the upload path.
    const rootCandidates = (opts.allowedRoots ?? defaultReferenceRoots()).map((r) => resolve(r));
    const resolvedRoots = [];
    for (const root of rootCandidates) {
        try {
            resolvedRoots.push(await realpath(root));
        }
        catch {
            resolvedRoots.push(root); // root may not exist yet — compare lexically
        }
    }
    let realAbs;
    try {
        realAbs = await realpath(abs);
    }
    catch {
        throw new ImagesError("invalid_params", "参考图无法读取（文件不存在或不可读）");
    }
    if (!isInsideRoots(realAbs, resolvedRoots)) {
        throw new ImagesError("invalid_params", "参考图路径越界：仅允许当前工作目录或 attachments 目录内的图片（或直接使用 data URL）");
    }
    let bytes;
    try {
        bytes = await readFile(realAbs);
    }
    catch {
        throw new ImagesError("invalid_params", "参考图无法读取（文件不存在或不可读）");
    }
    if (bytes.byteLength === 0) {
        throw new ImagesError("invalid_params", "参考图不含任何数据");
    }
    if (bytes.byteLength > MAX_REFERENCE_BYTES) {
        throw new ImagesError("invalid_params", `参考图过大（${bytes.byteLength} 字节，上限 ${MAX_REFERENCE_BYTES}），请先压缩`);
    }
    const mime = sniffImageMime(bytes);
    if (mime !== "image/jpeg" && mime !== "image/png") {
        throw new ImagesError("invalid_params", "参考图仅支持 JPEG/PNG（≤400KB）；其他格式请先转换");
    }
    return `data:${mime};base64,${bytes.toString("base64")}`;
}
/** Detect image mime from magic bytes; defaults to image/jpeg (official writer default). */
export function sniffImageMime(bytes) {
    const b = bytes;
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
        return "image/jpeg";
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
        return "image/png";
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
        return "image/webp";
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
        return "image/gif";
    return "image/jpeg";
}
