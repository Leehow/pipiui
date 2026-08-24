import { safeFileName, toMaterializedInputFile, type MaterializedInputFile, type SafeInputFile } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function asInputFilePart(file: MaterializedInputFile | SafeInputFile): MaterializedInputFile | undefined {
  if ("type" in file && file.type === "input_file" && typeof file.file_id === "string" && file.file_id.trim()) {
    return toMaterializedInputFile(file.file_id.trim());
  }
  const ready = file as SafeInputFile;
  if ((ready.status === "ready" || ready.sent) && typeof ready.fileId === "string" && ready.fileId.trim()) {
    return toMaterializedInputFile(ready.fileId.trim());
  }
  return undefined;
}

export function materializedInputFilesOf(
  files: readonly (MaterializedInputFile | SafeInputFile)[] | undefined,
): MaterializedInputFile[] {
  if (!files?.length) return [];
  const out: MaterializedInputFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const part = asInputFilePart(file);
    if (!part || seen.has(part.file_id)) continue;
    seen.add(part.file_id);
    out.push(part);
  }
  return out;
}

function contentArrayOf(message: Record<string, unknown>): unknown[] {
  if (Array.isArray(message.content)) return [...message.content];
  if (typeof message.content === "string") {
    return message.content ? [{ type: "input_text", text: message.content }] : [];
  }
  return [];
}

function hasInputFile(content: unknown[], fileId: string): boolean {
  return content.some((part) => {
    if (!isRecord(part)) return false;
    return part.type === "input_file" && part.file_id === fileId;
  });
}

function appendInputFilesToUserMessage(
  message: Record<string, unknown>,
  files: readonly MaterializedInputFile[],
): Record<string, unknown> {
  const content = contentArrayOf(message);
  for (const file of files) {
    if (!hasInputFile(content, file.file_id)) content.push(file);
  }
  return { ...message, content };
}

/**
 * Append already-materialized `{type:"input_file", file_id}` parts onto the
 * Responses `input` array. Does not upload, does not read disk, and does not
 * rewrite hosted tools or structured-output fields.
 */
export function applyMaterializedInputFiles(
  payload: Record<string, unknown>,
  files: readonly (MaterializedInputFile | SafeInputFile)[] | undefined,
): Record<string, unknown> {
  const parts = materializedInputFilesOf(files);
  if (!parts.length) return payload;

  const next = { ...payload };
  const input = Array.isArray(next.input) ? [...next.input] : [];

  if (input.length === 0) {
    next.input = [{ role: "user", content: [...parts] }];
    return next;
  }

  let lastUser = -1;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (isRecord(item) && item.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) {
    input.push({ role: "user", content: [...parts] });
  } else {
    const item = input[lastUser];
    input[lastUser] = isRecord(item) ? appendInputFilesToUserMessage(item, parts) : { role: "user", content: [...parts] };
  }
  next.input = input;
  return next;
}

/** User-visible attachment footnote. Name + size only — never a path or file body. */
export function inputFileTranscriptNote(files: readonly SafeInputFile[]): string {
  const ready = files.filter((file) => file.fileId && (file.status === "ready" || file.sent));
  if (!ready.length) return "";
  return ready
    .map((file) => `附件：${safeFileName(file.name)}（${formatFileSize(file.size)}）`)
    .join("\n");
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
