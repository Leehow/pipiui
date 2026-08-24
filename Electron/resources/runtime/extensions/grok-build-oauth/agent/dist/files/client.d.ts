import { DEFAULT_FILES_BASE_URL, DEFAULT_UPLOAD_TIMEOUT_MS, MAX_INPUT_FILE_BYTES } from "./types.js";
export { DEFAULT_FILES_BASE_URL, DEFAULT_UPLOAD_TIMEOUT_MS, MAX_INPUT_FILE_BYTES };
export declare function normalizeFilesBaseUrl(raw: string): string;
export declare function digestOf(bytes: Uint8Array): string;
export type UploadedInputFile = {
    fileId: string;
    name: string;
    size: number;
    mimeType: string;
    digest: string;
};
export type FilesClientOptions = {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    deleteTimeoutMs?: number;
};
export declare class FilesClient {
    readonly baseUrl: string;
    private readonly fetchImpl;
    private readonly timeoutMs;
    private readonly deleteTimeoutMs;
    constructor(options?: FilesClientOptions);
    upload(input: {
        bytes: Uint8Array;
        name: string;
        mimeType?: string;
        bearer: string;
        signal?: AbortSignal;
    }): Promise<UploadedInputFile>;
    remove(input: {
        fileId: string;
        bearer: string;
        signal?: AbortSignal;
    }): Promise<void>;
    private requestJson;
}
