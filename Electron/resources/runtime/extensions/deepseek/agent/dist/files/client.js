/**
 * DeepSeek Files API client.
 *
 * POST /files  multipart (file + purpose=user_data)
 * GET  /files/{id}
 * DELETE /files/{id}
 *
 * baseUrl follows provider config (HTTPS only). API key uses the same
 * credential chain as conversation requests and is never written to logs.
 */
import { resolveDeepSeekConfig } from "../config.js";
import { classifyFilesStatus, DeepSeekFilesError, redactSecret } from "./errors.js";
import { DEFAULT_FILES_TIMEOUT_MS, FILES_PURPOSE, filenameForMime, MAX_FILES_IMAGE_BYTES, } from "./types.js";
const MISSING_KEY = "未配置 DeepSeek API key — 请先 /login deepseek 或在设置中填写 ext.deepseek.apiKey";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseFileObject(json, action) {
    const id = typeof json.id === "string" ? json.id.trim() : "";
    if (!id)
        throw new DeepSeekFilesError("invalid_response", `Files API ${action}响应缺少 file id`);
    const out = { id };
    if (typeof json.bytes === "number" && Number.isFinite(json.bytes))
        out.bytes = json.bytes;
    else if (json.bytes !== undefined) {
        throw new DeepSeekFilesError("invalid_response", `Files API ${action}响应 metadata 无效`);
    }
    if (typeof json.filename === "string")
        out.filename = json.filename;
    else if (json.filename !== undefined) {
        throw new DeepSeekFilesError("invalid_response", `Files API ${action}响应 metadata 无效`);
    }
    if (typeof json.purpose === "string")
        out.purpose = json.purpose;
    if (typeof json.created_at === "number" && Number.isFinite(json.created_at))
        out.createdAt = json.created_at;
    return out;
}
export class DeepSeekFilesClient {
    baseUrl;
    apiKey;
    fetchImpl;
    timeoutMs;
    constructor(options = {}) {
        const cfg = resolveDeepSeekConfig({ baseUrl: options.baseUrl, apiKey: options.apiKey });
        this.baseUrl = cfg.baseUrl;
        this.apiKey = cfg.apiKey;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_FILES_TIMEOUT_MS;
    }
    requireKey(override) {
        const key = (override ?? this.apiKey ?? "").trim();
        if (!key)
            throw new DeepSeekFilesError("auth", MISSING_KEY);
        return key;
    }
    async upload(input) {
        const size = input.bytes.byteLength;
        if (size <= 0)
            throw new DeepSeekFilesError("invalid_params", "Files API 上传内容为空");
        if (size > MAX_FILES_IMAGE_BYTES) {
            throw new DeepSeekFilesError("invalid_params", `单张图片超过 64MiB Files API 上限（当前 ${size} bytes）。`);
        }
        const mimeType = (input.mimeType?.trim() || "application/octet-stream").toLowerCase();
        const filename = (input.filename?.trim() || filenameForMime(mimeType)).replace(/[/\\]/g, "_");
        const purpose = (input.purpose?.trim() || FILES_PURPOSE) || FILES_PURPOSE;
        const key = this.requireKey(input.apiKey);
        const copy = new Uint8Array(size);
        copy.set(input.bytes);
        const form = new FormData();
        form.append("file", new Blob([copy], { type: mimeType }), filename);
        form.append("purpose", purpose);
        const json = await this.requestJson({
            method: "POST",
            path: "/files",
            body: form,
            apiKey: key,
            signal: input.signal,
            action: "上传",
        });
        return parseFileObject(json, "上传");
    }
    async retrieve(input) {
        const fileId = input.fileId.trim();
        if (!fileId)
            throw new DeepSeekFilesError("invalid_params", "缺少 file id");
        const json = await this.requestJson({
            method: "GET",
            path: `/files/${encodeURIComponent(fileId)}`,
            apiKey: this.requireKey(input.apiKey),
            signal: input.signal,
            action: "查询",
        });
        return parseFileObject(json, "查询");
    }
    async remove(input) {
        const fileId = input.fileId.trim();
        if (!fileId)
            throw new DeepSeekFilesError("invalid_params", "缺少 file id");
        const json = await this.requestJson({
            method: "DELETE",
            path: `/files/${encodeURIComponent(fileId)}`,
            apiKey: this.requireKey(input.apiKey),
            signal: input.signal,
            action: "删除",
        });
        const id = typeof json.id === "string" && json.id.trim() ? json.id.trim() : fileId;
        return { id, deleted: json.deleted === undefined ? true : json.deleted === true };
    }
    async requestJson(input) {
        const url = `${this.baseUrl}${input.path}`;
        const signals = [AbortSignal.timeout(this.timeoutMs)];
        if (input.signal)
            signals.push(input.signal);
        const signal = AbortSignal.any(signals);
        let res;
        try {
            res = await this.fetchImpl(url, {
                method: input.method,
                headers: { authorization: `Bearer ${input.apiKey}` },
                ...(input.body ? { body: input.body } : {}),
                signal,
            });
        }
        catch (err) {
            if (input.signal?.aborted)
                throw new DeepSeekFilesError("aborted", `已取消文件${input.action}`);
            const msg = err instanceof Error ? err.message : String(err);
            throw new DeepSeekFilesError("upstream_error", redactSecret(`Files API ${input.action}失败: ${msg}`, input.apiKey));
        }
        const raw = await res.text().catch(() => "");
        if (!res.ok) {
            const snippet = redactSecret([...raw].slice(0, 160).join(""), input.apiKey);
            throw new DeepSeekFilesError(classifyFilesStatus(res.status), `Files API ${input.action}失败 HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`, res.status);
        }
        if (!raw.trim())
            return {};
        try {
            const parsed = JSON.parse(raw);
            if (!isRecord(parsed))
                throw new Error("not object");
            return parsed;
        }
        catch {
            throw new DeepSeekFilesError("invalid_response", `Files API ${input.action}响应无法解析`);
        }
    }
}
