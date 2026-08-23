import { FileIdCache } from "./cache.js";
import { DeepSeekFilesClient } from "./client.js";
export declare function hashImageBytes(bytes: Uint8Array): string;
export type FilesImageResolveInput = {
    bytes: Uint8Array;
    mimeType: string;
    filename?: string;
    apiKey?: string;
    signal?: AbortSignal;
};
/**
 * Content-hash → file_id. Cache hit skips upload for the rest of the session.
 * Upload failure is never silently inlined (32MiB+ cannot go inline).
 */
export declare class FilesImageChannel {
    readonly client: DeepSeekFilesClient;
    readonly cache: FileIdCache;
    constructor(client: DeepSeekFilesClient, cache?: FileIdCache);
    resolve(input: FilesImageResolveInput): Promise<string>;
}
