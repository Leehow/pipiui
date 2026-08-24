/**
 * Chat-with-Files types and capability / safety helpers.
 *
 * Safe metadata never includes credentials or the original local absolute path.
 * Provider file ids are scoped to the grok-build / xAI Files API.
 */
export const INPUT_FILES_STORE_VERSION = 1;
export const DEFAULT_FILES_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;
export const DEFAULT_DELETE_TIMEOUT_MS = 15_000;
/** Conservative xAI request-body aligned cap. */
export const MAX_INPUT_FILE_BYTES = 48 * 1024 * 1024;
export const INPUT_FILE_PURPOSE = "assistants";
const ALLOWED_EXTENSIONS = new Set([
    ".pdf", ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl",
    ".html", ".htm", ".xml", ".rtf",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".c", ".h", ".cpp", ".cc", ".java",
    ".go", ".rs", ".rb", ".sh", ".bash", ".zsh", ".yaml", ".yml", ".toml",
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
]);
const ALLOWED_MIME_PREFIXES = [
    "text/",
    "application/pdf",
    "application/json",
    "application/xml",
    "application/rtf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
];
export function modelHasInputFiles(model) {
    const caps = model?.capabilities;
    if (!caps || typeof caps !== "object" || Array.isArray(caps))
        return false;
    return caps.inputFiles === true;
}
/** Basename only. Rejects absolute paths and `..` traversal in the display name. */
export function safeFileName(raw) {
    const trimmed = raw.trim();
    const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    const base = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim() || "file";
    const cleaned = base.replace(/[\u0000-\u001f]/g, "").replace(/^\.+/, "");
    return cleaned || "file";
}
export function extensionOf(name) {
    const base = safeFileName(name);
    const dot = base.lastIndexOf(".");
    return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}
export function isAllowedInputFileType(name, mimeType) {
    const ext = extensionOf(name);
    if (ext && ALLOWED_EXTENSIONS.has(ext))
        return true;
    const mime = (mimeType ?? "").trim().toLowerCase();
    if (!mime)
        return false;
    return ALLOWED_MIME_PREFIXES.some((prefix) => mime === prefix || mime.startsWith(`${prefix}.`) || mime.startsWith(prefix));
}
export function assertInputFileBounds(input) {
    const name = safeFileName(input.name);
    if (!name)
        throw new Error("文件名无效");
    if (!Number.isFinite(input.size) || input.size <= 0)
        throw new Error("空文件不能上传");
    if (input.size > MAX_INPUT_FILE_BYTES) {
        throw new Error(`文件过大（最大 ${Math.floor(MAX_INPUT_FILE_BYTES / (1024 * 1024))} MB）`);
    }
    if (!isAllowedInputFileType(name, input.mimeType)) {
        throw new Error("不支持的文件类型");
    }
}
export function toMaterializedInputFile(fileId) {
    return { type: "input_file", file_id: fileId };
}
export function publicInputFile(file) {
    return {
        id: file.id,
        name: safeFileName(file.name),
        size: file.size,
        mimeType: file.mimeType,
        status: file.status,
        ...(file.fileId ? { fileId: file.fileId } : {}),
        ...(file.digest ? { digest: file.digest } : {}),
        ...(file.sent ? { sent: true } : {}),
        ...(file.error ? { error: file.error } : {}),
    };
}
