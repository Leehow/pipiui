import { createHash } from "node:crypto";
import { redactMessage } from "../oauth/redact.js";
import { classifyFilesStatus, FilesError } from "./errors.js";
import { assertInputFileBounds, DEFAULT_DELETE_TIMEOUT_MS, DEFAULT_FILES_BASE_URL, DEFAULT_UPLOAD_TIMEOUT_MS, INPUT_FILE_PURPOSE, MAX_INPUT_FILE_BYTES, safeFileName, } from "./types.js";
export { DEFAULT_FILES_BASE_URL, DEFAULT_UPLOAD_TIMEOUT_MS, MAX_INPUT_FILE_BYTES };
export function normalizeFilesBaseUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        throw new FilesError("invalid_params", "xAI Files API 地址不能为空");
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new FilesError("invalid_params", "非法的 xAI Files API 地址");
    }
    if (url.protocol !== "https:") {
        throw new FilesError("invalid_params", "Grok 文件上传仅允许 HTTPS");
    }
    return trimmed.replace(/\/+$/, "");
}
export function digestOf(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
function redact(message, bearer) {
    const tokens = bearer ? [bearer] : [];
    return redactMessage(message, tokens)
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\/(?:Users|home|private|var|tmp)\/[^\s"'`]+/gi, "[path]");
}
function throwIfAborted(signal) {
    if (signal?.aborted) {
        const err = new FilesError("aborted", "已取消文件上传");
        throw err;
    }
}
function raceWithAbort(promise, signal) {
    if (signal.aborted)
        return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
        }, (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
        });
    });
}
export class FilesClient {
    baseUrl;
    fetchImpl;
    timeoutMs;
    deleteTimeoutMs;
    constructor(options = {}) {
        this.baseUrl = normalizeFilesBaseUrl(options.baseUrl?.trim() || DEFAULT_FILES_BASE_URL);
        this.fetchImpl = (options.fetchImpl ?? fetch);
        this.timeoutMs = options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
        this.deleteTimeoutMs = options.deleteTimeoutMs ?? DEFAULT_DELETE_TIMEOUT_MS;
    }
    async upload(input) {
        const name = safeFileName(input.name);
        const mimeType = (input.mimeType ?? "application/octet-stream").trim() || "application/octet-stream";
        assertInputFileBounds({ name, size: input.bytes.byteLength, mimeType });
        if (!input.bearer?.trim()) {
            throw new FilesError("auth_expired", "未登录 — 请先登录 Grok Build");
        }
        throwIfAborted(input.signal);
        const form = new FormData();
        const payload = new Uint8Array(input.bytes.byteLength);
        payload.set(input.bytes);
        form.append("file", new Blob([payload], { type: mimeType }), name);
        form.append("purpose", INPUT_FILE_PURPOSE);
        const json = await this.requestJson({
            method: "POST",
            path: "/files",
            body: form,
            bearer: input.bearer,
            signal: input.signal,
            timeoutMs: this.timeoutMs,
            action: "上传",
        });
        const fileId = typeof json.id === "string" ? json.id.trim() : "";
        if (!fileId)
            throw new FilesError("invalid_response", "文件上传响应缺少 file id");
        if (json.bytes !== undefined && (typeof json.bytes !== "number" || !Number.isFinite(json.bytes))) {
            throw new FilesError("invalid_response", "文件上传响应 metadata 无效");
        }
        if (json.filename !== undefined && typeof json.filename !== "string") {
            throw new FilesError("invalid_response", "文件上传响应 metadata 无效");
        }
        return {
            fileId,
            name,
            size: input.bytes.byteLength,
            mimeType,
            digest: digestOf(input.bytes),
        };
    }
    async remove(input) {
        const fileId = input.fileId.trim();
        if (!fileId)
            throw new FilesError("invalid_params", "缺少 file id");
        if (!input.bearer?.trim())
            throw new FilesError("auth_expired", "未登录 — 请先登录 Grok Build");
        throwIfAborted(input.signal);
        await this.requestJson({
            method: "DELETE",
            path: `/files/${encodeURIComponent(fileId)}`,
            bearer: input.bearer,
            signal: input.signal,
            timeoutMs: this.deleteTimeoutMs,
            action: "删除",
        });
    }
    async requestJson(input) {
        const url = `${this.baseUrl}${input.path}`;
        const signals = [AbortSignal.timeout(input.timeoutMs)];
        if (input.signal)
            signals.push(input.signal);
        const signal = AbortSignal.any(signals);
        let res;
        try {
            res = await raceWithAbort(Promise.resolve(this.fetchImpl(url, {
                method: input.method,
                headers: { authorization: `Bearer ${input.bearer}` },
                ...(input.body ? { body: input.body } : {}),
                signal,
            })), signal);
        }
        catch (err) {
            if (input.signal?.aborted)
                throw new FilesError("aborted", `已取消文件${input.action}`);
            if (signal.aborted)
                throw new FilesError("upstream_error", `文件${input.action}超时`);
            const msg = err instanceof Error ? err.message : String(err);
            throw new FilesError("upstream_error", redact(`文件${input.action}失败: ${msg}`, input.bearer));
        }
        if (input.signal?.aborted)
            throw new FilesError("aborted", `已取消文件${input.action}`);
        const raw = await res.text().catch(() => "");
        if (!res.ok) {
            const { code } = classifyFilesStatus(res.status);
            throw new FilesError(code, redact(`文件${input.action}失败 HTTP ${res.status}: ${[...raw].slice(0, 160).join("")}`, input.bearer), res.status);
        }
        if (!raw.trim())
            return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : {};
        }
        catch {
            throw new FilesError("invalid_response", redact(`文件${input.action}响应无法解析`, input.bearer));
        }
    }
}
