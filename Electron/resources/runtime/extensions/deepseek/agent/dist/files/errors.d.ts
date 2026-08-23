export type DeepSeekFilesErrorCode = "auth" | "invalid_params" | "invalid_response" | "upload_failed" | "http_failure" | "rate_limited" | "aborted" | "upstream_error";
export declare class DeepSeekFilesError extends Error {
    readonly code: DeepSeekFilesErrorCode;
    readonly status?: number;
    constructor(code: DeepSeekFilesErrorCode, message: string, status?: number);
}
export declare function classifyFilesStatus(status: number): DeepSeekFilesErrorCode;
/** Strip bearer tokens / sk- keys from an upstream snippet. Never log the raw secret. */
export declare function redactSecret(text: string, secret?: string): string;
