/**
 * DeepSeek Files API client.
 *
 * POST /files  multipart (file + purpose=user_data)
 * GET  /files/{id}
 * DELETE /files/{id}
 *
 * baseUrl follows provider config (HTTPS only). API key uses the same
 * credential chain as conversation requests and is never written to logs.
 */
import { type DeepSeekFileDeleted, type DeepSeekFileObject } from "./types.js";
export type DeepSeekFilesClientOptions = {
    baseUrl?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
};
export declare class DeepSeekFilesClient {
    readonly baseUrl: string;
    private readonly apiKey?;
    private readonly fetchImpl;
    private readonly timeoutMs;
    constructor(options?: DeepSeekFilesClientOptions);
    private requireKey;
    upload(input: {
        bytes: Uint8Array;
        mimeType?: string;
        filename?: string;
        purpose?: string;
        apiKey?: string;
        signal?: AbortSignal;
    }): Promise<DeepSeekFileObject>;
    retrieve(input: {
        fileId: string;
        apiKey?: string;
        signal?: AbortSignal;
    }): Promise<DeepSeekFileObject>;
    remove(input: {
        fileId: string;
        apiKey?: string;
        signal?: AbortSignal;
    }): Promise<DeepSeekFileDeleted>;
    private requestJson;
}
