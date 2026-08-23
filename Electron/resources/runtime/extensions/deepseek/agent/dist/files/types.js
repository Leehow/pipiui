/** DeepSeek Files API `purpose` for vision / user image uploads. */
export const FILES_PURPOSE = "user_data";
/** Official Files API image cap (vision guide). */
export const MAX_FILES_IMAGE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_FILES_TIMEOUT_MS = 60_000;
export function filenameForMime(mimeType) {
    switch (mimeType.trim().toLowerCase()) {
        case "image/jpeg":
        case "image/jpg":
            return "image.jpg";
        case "image/png":
            return "image.png";
        case "image/gif":
            return "image.gif";
        case "image/webp":
            return "image.webp";
        default:
            return "image.bin";
    }
}
