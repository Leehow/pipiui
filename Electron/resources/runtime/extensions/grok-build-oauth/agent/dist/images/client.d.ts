export declare const ASPECT_RATIOS: readonly ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "auto"];
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export declare const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export declare const DEFAULT_MODEL = "grok-imagine-image-quality";
export declare const DEFAULT_EDIT_MODEL = "grok-imagine-image-quality";
export declare const SESSION_ID_HEADER = "x-grok-session-id";
/** Official client uses 300s total / 240s read; keep a single generous cap. */
export declare const DEFAULT_TIMEOUT_MS = 300000;
/** Official Imagine reference-image raw size limit (backend 400s above). */
export declare const MAX_REFERENCE_BYTES: number;
/**
 * Normalize a base URL. Bearer credentials are only ever sent over HTTPS;
 * plain HTTP is refused, except for explicit loopback compat relay endpoints
 * (and only when the caller passes `allowHttpLoopback` — i.e. the deprecated
 * compat path is explicitly enabled). (Reviewer MUST-FIX #8.)
 */
export declare function normalizeBaseUrl(raw: string, opts?: {
    allowHttpLoopback?: boolean;
}): string;
export declare function assertAspectRatio(aspectRatio: string): asserts aspectRatio is AspectRatio;
export declare function assertModel(model: string): string;
/** Strict base64 decode — rejects empty/malformed input (no partial writes). */
export declare function decodeBase64Strict(b64: string): Buffer;
export type ImageBytes = {
    bytes: Buffer;
    b64: string;
};
export type ImagesClientOptions = {
    baseUrl?: string;
    model?: string;
    editModel?: string;
    sessionId?: string;
    extraHeaders?: Record<string, string>;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    /** Allow http:// loopback base URLs (deprecated compat relay only, explicit opt-in). */
    allowHttpLoopback?: boolean;
};
export declare class ImagesClient {
    readonly baseUrl: string;
    readonly model: string;
    readonly editModel: string;
    private readonly sessionId?;
    private readonly extraHeaders;
    private readonly timeoutMs;
    private readonly fetchImpl;
    constructor(opts?: ImagesClientOptions);
    /** image_gen — POST {base}/images/generations */
    generate(req: {
        prompt: string;
        bearer: string;
        aspectRatio?: string;
        signal?: AbortSignal;
    }): Promise<ImageBytes>;
    /**
     * image_edit — POST {base}/images/edits.
     * `images` must already be resolved `data:image/...;base64,...` URLs.
     * Single ref → `image` object; multiple → `images` array + aspect_ratio.
     */
    edit(req: {
        prompt: string;
        images: string[];
        bearer: string;
        aspectRatio?: string;
        signal?: AbortSignal;
    }): Promise<ImageBytes>;
    private buildHeaders;
    private post;
}
/**
 * Default allowed roots for filesystem reference images: the current working
 * directory (project) and the agent-home attachments root. Absolute paths
 * outside these roots are refused (reviewer MUST-FIX #7).
 */
export declare function defaultReferenceRoots(): string[];
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
export declare function resolveImageReference(raw: string, opts?: {
    cwd?: string;
    allowedRoots?: string[];
}): Promise<string>;
/** Detect image mime from magic bytes; defaults to image/jpeg (official writer default). */
export declare function sniffImageMime(bytes: Uint8Array): string;
