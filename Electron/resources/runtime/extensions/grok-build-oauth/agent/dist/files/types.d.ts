/**
 * Chat-with-Files types and capability / safety helpers.
 *
 * Safe metadata never includes credentials or the original local absolute path.
 * Provider file ids are scoped to the grok-build / xAI Files API.
 */
export declare const INPUT_FILES_STORE_VERSION: 1;
export declare const DEFAULT_FILES_BASE_URL = "https://api.x.ai/v1";
export declare const DEFAULT_UPLOAD_TIMEOUT_MS = 60000;
export declare const DEFAULT_DELETE_TIMEOUT_MS = 15000;
/** Conservative xAI request-body aligned cap. */
export declare const MAX_INPUT_FILE_BYTES: number;
export declare const INPUT_FILE_PURPOSE: "assistants";
export type InputFileStatus = "uploading" | "ready" | "failed" | "cancelled";
/** Official Responses content part. */
export type MaterializedInputFile = {
    type: "input_file";
    file_id: string;
};
export type SafeInputFile = {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    status: InputFileStatus;
    /** Provider-scoped xAI file id. Absent until upload succeeds. */
    fileId?: string;
    /** sha256 of bytes; used for in-session reuse. Not a secret. */
    digest?: string;
    /** True after the file was referenced by a sent turn. */
    sent?: boolean;
    /** Redacted, path-free, credential-free error. */
    error?: string;
};
export type SafeFileSource = {
    fileId: string;
    name: string;
    /** HTTPS url when the model cited a public link; never a local path. */
    url?: string;
};
export declare function modelHasInputFiles(model: {
    capabilities?: unknown;
} | undefined): boolean;
/** Basename only. Rejects absolute paths and `..` traversal in the display name. */
export declare function safeFileName(raw: string): string;
export declare function extensionOf(name: string): string;
export declare function isAllowedInputFileType(name: string, mimeType?: string): boolean;
export declare function assertInputFileBounds(input: {
    name: string;
    size: number;
    mimeType?: string;
}): void;
export declare function toMaterializedInputFile(fileId: string): MaterializedInputFile;
export declare function publicInputFile(file: SafeInputFile): SafeInputFile;
