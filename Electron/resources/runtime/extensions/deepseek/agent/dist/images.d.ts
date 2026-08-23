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
import { FilesImageChannel } from "./files/channel.js";
import { MAX_FILES_IMAGE_BYTES } from "./files/types.js";
export { MAX_FILES_IMAGE_BYTES };
export declare const MAX_INLINE_IMAGE_BYTES: number;
export declare const MAX_REQUEST_BODY_BYTES: number;
export type DeepSeekImageErrorCode = "image_too_large" | "request_too_large" | "invalid_image" | "files_required" | "files_failed";
export declare class DeepSeekImageError extends Error {
    readonly code: DeepSeekImageErrorCode;
    constructor(code: DeepSeekImageErrorCode, message: string);
}
export type ImageSizeLimits = {
    maxInlineBytes?: number;
    maxFilesBytes?: number;
};
export type ImageRoute = {
    kind: "inline";
    byteLength: number;
} | {
    kind: "files";
    byteLength: number;
} | {
    kind: "too_large";
    byteLength: number;
};
/** Pure size-class decision: ≤32MiB inline, ≤64MiB Files API, else reject. */
export declare function decideImageRoute(byteLength: number, limits?: ImageSizeLimits): ImageRoute;
/** Decoded byte length of a base64 payload (padding-aware). */
export declare function decodedBase64ByteLength(b64: string): number;
export declare function parseDataUrl(value: string): {
    mime: string;
    base64: boolean;
    payload: string;
} | undefined;
/** Byte length of an inline image (decoded base64, or UTF-8 for raw data URLs). */
export declare function inlineImageByteLength(dataUrl: string): number;
export declare function bytesFromDataUrl(dataUrl: string): {
    bytes: Buffer;
    mimeType: string;
};
export declare function assertInlineImageWithinLimit(byteLength: number, limit?: number): void;
export declare function assertFilesImageWithinLimit(byteLength: number, limit?: number): void;
export declare function assertRequestBodyWithinLimit(byteLength: number, limit?: number): void;
export declare function requestBodyByteLength(body: unknown): number;
export declare function assertRequestBodySize(body: unknown, limit?: number): void;
export declare function toDataUrl(mimeType: string | undefined, data: string): string;
/**
 * Convert a pi / OpenAI-shaped image part to an inline data URL.
 * HTTP(S) URLs are returned unchanged (DeepSeek accepts them; they are not pi bytes).
 * Existing `file_id` parts yield undefined so callers keep the original.
 */
export declare function toInlineDataUrl(image: unknown): string | undefined;
export declare function assertInlineDataUrlSize(dataUrl: string): void;
export type RewriteImagesOptions = {
    files?: FilesImageChannel;
    resolveFiles?: () => FilesImageChannel;
    limits?: ImageSizeLimits;
    signal?: AbortSignal;
};
/**
 * Walk Chat Completions `messages` or Responses `input` and convert pi images
 * to inline data URLs. Validates each inline image against the 32 MiB cap.
 * Images above the inline cap throw — use `rewritePayloadImagesAsync` for Files API.
 */
export declare function rewritePayloadImages<T>(payload: T): T;
/** Async rewrite: ≤32MiB stay inline; 32–64MiB upload via Files API and inject file_id. */
export declare function rewritePayloadImagesAsync<T>(payload: T, options?: RewriteImagesOptions): Promise<T>;
