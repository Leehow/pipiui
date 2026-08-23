/** DeepSeek Files API `purpose` for vision / user image uploads. */
export declare const FILES_PURPOSE = "user_data";
/** Official Files API image cap (vision guide). */
export declare const MAX_FILES_IMAGE_BYTES: number;
export declare const DEFAULT_FILES_TIMEOUT_MS = 60000;
export type DeepSeekFileObject = {
    id: string;
    bytes?: number;
    filename?: string;
    purpose?: string;
    createdAt?: number;
};
export type DeepSeekFileDeleted = {
    id: string;
    deleted: boolean;
};
export declare function filenameForMime(mimeType: string): string;
