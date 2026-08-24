import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { INPUT_FILES_STORE_VERSION, publicInputFile, safeFileName, } from "./types.js";
export function inputFilesStorePath(agentHome, sessionId) {
    return join(agentHome, "input-files", `${sessionId}.json`);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseAttachment(value) {
    if (!isRecord(value))
        return undefined;
    if (typeof value.id !== "string" || !value.id.trim())
        return undefined;
    if (typeof value.name !== "string")
        return undefined;
    if (typeof value.size !== "number" || !Number.isFinite(value.size))
        return undefined;
    const status = value.status;
    if (status !== "uploading" && status !== "ready" && status !== "failed" && status !== "cancelled") {
        return undefined;
    }
    return publicInputFile({
        id: value.id.trim(),
        name: safeFileName(value.name),
        size: value.size,
        mimeType: typeof value.mimeType === "string" && value.mimeType.trim() ? value.mimeType : "application/octet-stream",
        status,
        ...(typeof value.fileId === "string" && value.fileId.trim() ? { fileId: value.fileId.trim() } : {}),
        ...(typeof value.digest === "string" && value.digest.trim() ? { digest: value.digest.trim() } : {}),
        ...(value.sent === true ? { sent: true } : {}),
        ...(typeof value.error === "string" && value.error.trim() ? { error: value.error } : {}),
    });
}
export class SessionInputFileStore {
    agentHome;
    constructor(agentHome) {
        this.agentHome = agentHome;
    }
    async list(sessionId) {
        const raw = await readFile(inputFilesStorePath(this.agentHome, sessionId), "utf8").catch(() => "");
        if (!raw.trim())
            return [];
        try {
            const parsed = JSON.parse(raw);
            if (!isRecord(parsed) || !Array.isArray(parsed.attachments))
                return [];
            return parsed.attachments.map(parseAttachment).filter((item) => Boolean(item));
        }
        catch {
            return [];
        }
    }
    async write(sessionId, attachments) {
        const next = attachments.map(publicInputFile);
        const payload = { version: INPUT_FILES_STORE_VERSION, attachments: next };
        const path = inputFilesStorePath(this.agentHome, sessionId);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
        return next;
    }
    async upsert(sessionId, attachment) {
        const current = await this.list(sessionId);
        const next = current.filter((item) => item.id !== attachment.id);
        next.push(publicInputFile(attachment));
        return this.write(sessionId, next);
    }
    async remove(sessionId, attachmentId) {
        const current = await this.list(sessionId);
        const removed = current.find((item) => item.id === attachmentId);
        const attachments = current.filter((item) => item.id !== attachmentId);
        await this.write(sessionId, attachments);
        return { removed, attachments };
    }
    findReusable(attachments, digest) {
        return attachments.find((item) => item.digest === digest && item.fileId && (item.status === "ready" || item.sent));
    }
    materialized(attachments) {
        return attachments.filter((item) => item.fileId && (item.status === "ready" || item.sent));
    }
}
