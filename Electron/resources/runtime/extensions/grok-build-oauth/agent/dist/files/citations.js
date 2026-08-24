import { safeFileName } from "./types.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function looksLikeLocalPath(value) {
    return /^(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/)|file:)/.test(value) || value.includes("\\");
}
function httpsUrlOf(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    if (!/^https:\/\//i.test(trimmed))
        return undefined;
    if (looksLikeLocalPath(trimmed))
        return undefined;
    return trimmed;
}
function fileIdOf(value) {
    const raw = value.file_id ?? value.fileId;
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
function nameOf(value, fallback) {
    const raw = value.filename ?? value.name ?? value.title;
    return typeof raw === "string" && raw.trim() ? safeFileName(raw) : fallback;
}
function collectFromUnknown(value, into, seen) {
    if (Array.isArray(value)) {
        for (const item of value)
            collectFromUnknown(item, into, seen);
        return;
    }
    if (!isRecord(value))
        return;
    const type = typeof value.type === "string" ? value.type : "";
    const fileId = fileIdOf(value);
    if (fileId && (type === "file_citation" || type === "input_file" || type === "file" || value.filename || value.file_id)) {
        if (!seen.has(fileId)) {
            seen.add(fileId);
            const url = httpsUrlOf(value.url);
            into.push({
                fileId,
                name: nameOf(value, "file"),
                ...(url ? { url } : {}),
            });
        }
    }
    if (Array.isArray(value.annotations))
        collectFromUnknown(value.annotations, into, seen);
    if (Array.isArray(value.citations))
        collectFromUnknown(value.citations, into, seen);
    if (Array.isArray(value.content))
        collectFromUnknown(value.content, into, seen);
    if (Array.isArray(value.output))
        collectFromUnknown(value.output, into, seen);
    if (isRecord(value.response))
        collectFromUnknown(value.response, into, seen);
    if (isRecord(value.message))
        collectFromUnknown(value.message, into, seen);
    if (isRecord(value.annotation))
        collectFromUnknown(value.annotation, into, seen);
}
/** Map Responses file citations / annotations to clickable-or-safe sources. */
export function fileSourcesFromResponse(value) {
    const sources = [];
    collectFromUnknown(value, sources, new Set());
    return sources;
}
