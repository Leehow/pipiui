export type FilesErrorCode = "invalid_params" | "unsupported_model" | "invalid_response" | "auth_expired" | "rate_limited" | "upstream_error" | "http_failure" | "aborted";
export declare class FilesError extends Error {
    readonly code: FilesErrorCode;
    readonly status?: number;
    constructor(code: FilesErrorCode, message: string, status?: number);
}
export declare function classifyFilesStatus(status: number): {
    code: FilesErrorCode;
};
