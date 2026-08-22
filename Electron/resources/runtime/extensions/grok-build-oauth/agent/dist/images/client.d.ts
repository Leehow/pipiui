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
/** True when the URL is a plain-HTTP loopback endpoint (relay transport only). */
export declare function isLoopbackHttpUrl(raw: string): boolean;
/**
 * Normalize a base URL. Bearer credentials (OAuth access tokens and API keys)
 * are ONLY ever sent over HTTPS — plain HTTP is always refused, with NO
 * loopback exception (round-2 reviewer Critical #2: `compatFallback` must not
 * turn into an allow-list that leaks the real Bearer to an HTTP base). The
 * deprecated compat relay is a SEPARATE loopback transport that speaks its own
 * `Bearer local` credential and never receives real tokens (see
 * `resolveRelayBase` in images/config.js).
 */
export declare function normalizeBaseUrl(raw: string): string;
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
