import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  INPUT_FILES_STORE_VERSION,
  publicInputFile,
  safeFileName,
  type SafeInputFile,
} from "./types.js";

export function inputFilesStorePath(agentHome: string, sessionId: string): string {
  return join(agentHome, "input-files", `${sessionId}.json`);
}

type StoreFile = {
  version: typeof INPUT_FILES_STORE_VERSION;
  attachments: SafeInputFile[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAttachment(value: unknown): SafeInputFile | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || !value.id.trim()) return undefined;
  if (typeof value.name !== "string") return undefined;
  if (typeof value.size !== "number" || !Number.isFinite(value.size)) return undefined;
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
  constructor(private readonly agentHome: string) {}

  async list(sessionId: string): Promise<SafeInputFile[]> {
    const raw = await readFile(inputFilesStorePath(this.agentHome, sessionId), "utf8").catch(() => "");
    if (!raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.attachments)) return [];
      return parsed.attachments.map(parseAttachment).filter((item): item is SafeInputFile => Boolean(item));
    } catch {
      return [];
    }
  }

  async write(sessionId: string, attachments: readonly SafeInputFile[]): Promise<SafeInputFile[]> {
    const next = attachments.map(publicInputFile);
    const payload: StoreFile = { version: INPUT_FILES_STORE_VERSION, attachments: next };
    const path = inputFilesStorePath(this.agentHome, sessionId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    return next;
  }

  async upsert(sessionId: string, attachment: SafeInputFile): Promise<SafeInputFile[]> {
    const current = await this.list(sessionId);
    const next = current.filter((item) => item.id !== attachment.id);
    next.push(publicInputFile(attachment));
    return this.write(sessionId, next);
  }

  async remove(sessionId: string, attachmentId: string): Promise<{ removed?: SafeInputFile; attachments: SafeInputFile[] }> {
    const current = await this.list(sessionId);
    const removed = current.find((item) => item.id === attachmentId);
    const attachments = current.filter((item) => item.id !== attachmentId);
    await this.write(sessionId, attachments);
    return { removed, attachments };
  }

  findReusable(attachments: readonly SafeInputFile[], digest: string): SafeInputFile | undefined {
    return attachments.find((item) => item.digest === digest && item.fileId && (item.status === "ready" || item.sent));
  }

  materialized(attachments: readonly SafeInputFile[]): SafeInputFile[] {
    return attachments.filter((item) => item.fileId && (item.status === "ready" || item.sent));
  }
}
