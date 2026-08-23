import { createHash } from "node:crypto";
import { FileIdCache } from "./cache.js";
import { DeepSeekFilesError } from "./errors.js";
import { filenameForMime } from "./types.js";
export function hashImageBytes(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
/**
 * Content-hash → file_id. Cache hit skips upload for the rest of the session.
 * Upload failure is never silently inlined (32MiB+ cannot go inline).
 */
export class FilesImageChannel {
    client;
    cache;
    constructor(client, cache = new FileIdCache()) {
        this.client = client;
        this.cache = cache;
    }
    async resolve(input) {
        const hash = hashImageBytes(input.bytes);
        const hit = this.cache.get(hash);
        if (hit)
            return hit;
        try {
            const uploaded = await this.client.upload({
                bytes: input.bytes,
                mimeType: input.mimeType,
                filename: input.filename || filenameForMime(input.mimeType),
                apiKey: input.apiKey,
                signal: input.signal,
            });
            this.cache.set(hash, uploaded.id);
            return uploaded.id;
        }
        catch (error) {
            if (error instanceof DeepSeekFilesError && error.code === "upload_failed")
                throw error;
            const message = error instanceof Error ? error.message : String(error);
            throw new DeepSeekFilesError("upload_failed", `Files API 上传失败，无法以内联方式发送超过 32MiB 的图片：${message}`, error instanceof DeepSeekFilesError ? error.status : undefined);
        }
    }
}
