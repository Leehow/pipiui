/**
 * DeepSeek multimodal rewrite.
 *
 * Pi image inputs (`{ type: "image", data, mimeType }`) become inline data URLs
 * when ≤ 32 MiB. Larger images (≤ 64 MiB) go through the Files API and are
 * injected as `file_id`. Images above 64 MiB are rejected.
 *
 * Limits (official vision guide):
 * - single inline image ≤ 32 MiB
 * - Files API image ≤ 64 MiB
 * - request body ≤ 48 MiB
 */
import { MAX_FILES_IMAGE_BYTES } from "./files/types.js";
export { MAX_FILES_IMAGE_BYTES };
export const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_REQUEST_BODY_BYTES = 48 * 1024 * 1024;
const DATA_URL = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i;
export class DeepSeekImageError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "DeepSeekImageError";
        this.code = code;
    }
}
/** Pure size-class decision: ≤32MiB inline, ≤64MiB Files API, else reject. */
export function decideImageRoute(byteLength, limits = {}) {
    const inline = limits.maxInlineBytes ?? MAX_INLINE_IMAGE_BYTES;
    const files = limits.maxFilesBytes ?? MAX_FILES_IMAGE_BYTES;
    if (byteLength <= inline)
        return { kind: "inline", byteLength };
    if (byteLength <= files)
        return { kind: "files", byteLength };
    return { kind: "too_large", byteLength };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function utf8Bytes(text) {
    return Buffer.byteLength(text, "utf8");
}
/** Decoded byte length of a base64 payload (padding-aware). */
export function decodedBase64ByteLength(b64) {
    const clean = b64.replace(/\s+/g, "");
    if (!clean)
        return 0;
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return Math.floor((clean.length * 3) / 4) - padding;
}
export function parseDataUrl(value) {
    const match = DATA_URL.exec(value.trim());
    if (!match)
        return undefined;
    return {
        mime: match[1]?.trim() || "application/octet-stream",
        base64: Boolean(match[2]),
        payload: match[3] ?? "",
    };
}
/** Byte length of an inline image (decoded base64, or UTF-8 for raw data URLs). */
export function inlineImageByteLength(dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed)
        return utf8Bytes(dataUrl);
    return parsed.base64 ? decodedBase64ByteLength(parsed.payload) : utf8Bytes(parsed.payload);
}
export function bytesFromDataUrl(dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
        throw new DeepSeekImageError("invalid_image", "无法从图片数据中解码字节");
    }
    const bytes = parsed.base64
        ? Buffer.from(parsed.payload.replace(/\s+/g, ""), "base64")
        : Buffer.from(parsed.payload, "utf8");
    return { bytes, mimeType: parsed.mime };
}
export function assertInlineImageWithinLimit(byteLength, limit = MAX_INLINE_IMAGE_BYTES) {
    if (byteLength > limit) {
        throw new DeepSeekImageError("image_too_large", `单张 inline 图片超过 32MiB 限制（当前 ${byteLength} bytes）。更大的图片需走 Files API 上传。`);
    }
}
export function assertFilesImageWithinLimit(byteLength, limit = MAX_FILES_IMAGE_BYTES) {
    if (byteLength > limit) {
        throw new DeepSeekImageError("image_too_large", `单张图片超过 64MiB Files API 上限（当前 ${byteLength} bytes）。`);
    }
}
export function assertRequestBodyWithinLimit(byteLength, limit = MAX_REQUEST_BODY_BYTES) {
    if (byteLength > limit) {
        throw new DeepSeekImageError("request_too_large", `请求体超过 48MiB 限制（当前 ${byteLength} bytes）。请减少图片数量或缩小图片。`);
    }
}
export function requestBodyByteLength(body) {
    return utf8Bytes(JSON.stringify(body));
}
export function assertRequestBodySize(body, limit = MAX_REQUEST_BODY_BYTES) {
    assertRequestBodyWithinLimit(requestBodyByteLength(body), limit);
}
export function toDataUrl(mimeType, data) {
    const raw = data.trim();
    if (!raw) {
        throw new DeepSeekImageError("invalid_image", "图片数据为空");
    }
    if (parseDataUrl(raw))
        return raw;
    const mime = (mimeType?.trim() || "image/png").toLowerCase();
    return `data:${mime};base64,${raw.replace(/\s+/g, "")}`;
}
/**
 * Convert a pi / OpenAI-shaped image part to an inline data URL.
 * HTTP(S) URLs are returned unchanged (DeepSeek accepts them; they are not pi bytes).
 * Existing `file_id` parts yield undefined so callers keep the original.
 */
export function toInlineDataUrl(image) {
    if (typeof image === "string") {
        const trimmed = image.trim();
        if (!trimmed) {
            throw new DeepSeekImageError("invalid_image", "图片数据为空");
        }
        if (parseDataUrl(trimmed))
            return trimmed;
        if (/^https?:\/\//i.test(trimmed))
            return trimmed;
        return toDataUrl("image/png", trimmed);
    }
    if (!isRecord(image)) {
        throw new DeepSeekImageError("invalid_image", "无法识别的图片输入");
    }
    if (typeof image.file_id === "string" && image.file_id.trim()) {
        return undefined;
    }
    if (typeof image.data === "string") {
        return toDataUrl(typeof image.mimeType === "string" ? image.mimeType : undefined, image.data);
    }
    const imageUrl = image.image_url;
    if (typeof imageUrl === "string")
        return toInlineDataUrl(imageUrl);
    if (isRecord(imageUrl) && typeof imageUrl.url === "string")
        return toInlineDataUrl(imageUrl.url);
    if (typeof image.url === "string")
        return toInlineDataUrl(image.url);
    throw new DeepSeekImageError("invalid_image", "无法识别的图片输入");
}
export function assertInlineDataUrlSize(dataUrl) {
    if (/^https?:\/\//i.test(dataUrl) && !parseDataUrl(dataUrl))
        return;
    assertInlineImageWithinLimit(inlineImageByteLength(dataUrl));
}
function detailOf(part) {
    if (typeof part.detail === "string")
        return part.detail;
    if (isRecord(part.image_url) && typeof part.image_url.detail === "string")
        return part.image_url.detail;
    return undefined;
}
function isImagePart(part) {
    const type = typeof part.type === "string" ? part.type : "";
    if (type === "image" || type === "image_url" || type === "input_image" || type === "file")
        return true;
    return typeof part.data === "string" && typeof part.mimeType === "string";
}
function emitInline(url, mode, detail) {
    if (mode === "responses") {
        const next = { type: "input_image", image_url: url };
        if (detail)
            next.detail = detail;
        return next;
    }
    const next = { type: "image_url", image_url: { url } };
    if (detail)
        next.image_url.detail = detail;
    return next;
}
function emitFileId(fileId, mode, detail) {
    if (mode === "responses") {
        const next = { type: "input_image", file_id: fileId };
        if (detail)
            next.detail = detail;
        return next;
    }
    const next = { type: "file", file_id: fileId };
    return next;
}
function rewriteContentPart(part, mode) {
    if (!isRecord(part) || !isImagePart(part))
        return part;
    if (typeof part.file_id === "string" && part.file_id.trim()) {
        return part;
    }
    const url = toInlineDataUrl(part);
    if (url === undefined)
        return part;
    assertInlineDataUrlSize(url);
    return emitInline(url, mode, detailOf(part));
}
function filesChannelOf(options) {
    if (options.files)
        return options.files;
    if (options.resolveFiles) {
        const created = options.resolveFiles();
        options.files = created;
        return created;
    }
    throw new DeepSeekImageError("files_required", "单张图片超过 32MiB inline 上限，需要 Files API 通道才能上传。");
}
async function rewriteContentPartAsync(part, mode, options) {
    if (!isRecord(part) || !isImagePart(part))
        return part;
    if (typeof part.file_id === "string" && part.file_id.trim()) {
        return part;
    }
    const url = toInlineDataUrl(part);
    if (url === undefined)
        return part;
    if (/^https?:\/\//i.test(url) && !parseDataUrl(url)) {
        return emitInline(url, mode, detailOf(part));
    }
    const byteLength = inlineImageByteLength(url);
    const route = decideImageRoute(byteLength, options.limits);
    if (route.kind === "inline") {
        return emitInline(url, mode, detailOf(part));
    }
    if (route.kind === "too_large") {
        assertFilesImageWithinLimit(byteLength, options.limits?.maxFilesBytes);
    }
    const { bytes, mimeType } = bytesFromDataUrl(url);
    const fileId = await filesChannelOf(options).resolve({
        bytes,
        mimeType,
        signal: options.signal,
    });
    return emitFileId(fileId, mode, detailOf(part));
}
function rewriteMessage(message, mode) {
    if (!isRecord(message))
        return message;
    if (!Array.isArray(message.content))
        return message;
    return { ...message, content: message.content.map((part) => rewriteContentPart(part, mode)) };
}
async function rewriteMessageAsync(message, mode, options) {
    if (!isRecord(message))
        return message;
    if (!Array.isArray(message.content))
        return message;
    const content = [];
    for (const part of message.content) {
        content.push(await rewriteContentPartAsync(part, mode, options));
    }
    return { ...message, content };
}
/**
 * Walk Chat Completions `messages` or Responses `input` and convert pi images
 * to inline data URLs. Validates each inline image against the 32 MiB cap.
 * Images above the inline cap throw — use `rewritePayloadImagesAsync` for Files API.
 */
export function rewritePayloadImages(payload) {
    if (!isRecord(payload))
        return payload;
    const next = { ...payload };
    if (Array.isArray(next.messages)) {
        next.messages = next.messages.map((message) => rewriteMessage(message, "completions"));
    }
    if (Array.isArray(next.input)) {
        next.input = next.input.map((item) => rewriteMessage(item, "responses"));
    }
    return next;
}
/** Async rewrite: ≤32MiB stay inline; 32–64MiB upload via Files API and inject file_id. */
export async function rewritePayloadImagesAsync(payload, options = {}) {
    if (!isRecord(payload))
        return payload;
    const next = { ...payload };
    if (Array.isArray(next.messages)) {
        const messages = [];
        for (const message of next.messages) {
            messages.push(await rewriteMessageAsync(message, "completions", options));
        }
        next.messages = messages;
    }
    if (Array.isArray(next.input)) {
        const input = [];
        for (const item of next.input) {
            input.push(await rewriteMessageAsync(item, "responses", options));
        }
        next.input = input;
    }
    return next;
}
