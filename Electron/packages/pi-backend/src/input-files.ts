import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { InputFileAttachment, InputFileStageRequest, Model } from "@pipi/host-api";

export type InputFilesUploadResult = {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  digest: string;
};

export type InputFilesRemote = {
  upload(input: {
    bytes: Uint8Array;
    name: string;
    mimeType?: string;
    signal?: AbortSignal;
  }): Promise<InputFilesUploadResult>;
  remove(fileId: string, signal?: AbortSignal): Promise<void>;
};

type StoreAttachment = InputFileAttachment & { digest?: string };

type StoreLike = {
  list(sessionId: string): Promise<StoreAttachment[]>;
  write(sessionId: string, attachments: readonly StoreAttachment[]): Promise<StoreAttachment[]>;
  upsert(sessionId: string, attachment: StoreAttachment): Promise<StoreAttachment[]>;
  remove(sessionId: string, attachmentId: string): Promise<{ removed?: StoreAttachment; attachments: StoreAttachment[] }>;
  findReusable(attachments: readonly StoreAttachment[], digest: string): StoreAttachment | undefined;
};

const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

/** Live model only: `capabilities.inputFiles === true`. Objects / unknown / old catalogs fail closed. */
export function modelDeclaresInputFiles(model: { capabilities?: { inputFiles?: unknown } } | undefined): boolean {
  return model?.capabilities?.inputFiles === true;
}

export function safeInputFileName(raw: string): string {
  const trimmed = raw.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim() || "file";
  return base.replace(/[\u0000-\u001f]/g, "").replace(/^\.+/, "") || "file";
}

export function safeInputFileSessionId(raw: string): string {
  const trimmed = raw.trim();
  if (!SAFE_SESSION_ID.test(trimmed)) throw new Error("缺少会话");
  return trimmed;
}

export function publicInputFileAttachment(file: StoreAttachment): InputFileAttachment {
  return {
    id: file.id,
    name: safeInputFileName(file.name),
    size: file.size,
    mimeType: file.mimeType,
    status: file.status,
    ...(file.fileId ? { fileId: file.fileId } : {}),
    ...(file.sent ? { sent: true } : {}),
    ...(file.error ? { error: file.error } : {}),
  };
}

function decodeStageBytes(file: InputFileStageRequest): Uint8Array {
  const raw = file.dataBase64?.trim() ?? "";
  if (!raw) throw new Error("缺少文件内容");
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.byteLength) throw new Error("空文件不能上传");
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class JsonInputFileStore implements StoreLike {
  constructor(private readonly agentHome: string | ((sessionId: string) => string | Promise<string>)) {}

  private async resolveHome(sessionId: string): Promise<string> {
    return typeof this.agentHome === "string" ? this.agentHome : await this.agentHome(sessionId);
  }

  async list(sessionId: string): Promise<StoreAttachment[]> {
    const id = safeInputFileSessionId(sessionId);
    const raw = await readFile(join(await this.resolveHome(id), "input-files", `${id}.json`), "utf8").catch(() => "");
    if (!raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || !Array.isArray(parsed.attachments)) return [];
      const attachments: StoreAttachment[] = [];
      for (const item of parsed.attachments) {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") continue;
        if (typeof item.size !== "number" || !Number.isFinite(item.size)) continue;
        const status = item.status;
        if (status !== "uploading" && status !== "ready" && status !== "failed" && status !== "cancelled") continue;
        const next: StoreAttachment = {
          id: item.id,
          name: safeInputFileName(item.name),
          size: item.size,
          mimeType: typeof item.mimeType === "string" && item.mimeType.trim() ? item.mimeType : "application/octet-stream",
          status,
        };
        if (typeof item.fileId === "string" && item.fileId.trim()) next.fileId = item.fileId;
        if (typeof item.digest === "string" && item.digest.trim()) next.digest = item.digest;
        if (item.sent === true) next.sent = true;
        if (typeof item.error === "string" && item.error.trim()) next.error = item.error;
        attachments.push(next);
      }
      return attachments;
    } catch {
      return [];
    }
  }

  async write(sessionId: string, attachments: readonly StoreAttachment[]): Promise<StoreAttachment[]> {
    const id = safeInputFileSessionId(sessionId);
    const next = attachments.map((item) => ({
      id: item.id,
      name: safeInputFileName(item.name),
      size: item.size,
      mimeType: item.mimeType,
      status: item.status,
      ...(item.fileId ? { fileId: item.fileId } : {}),
      ...(item.digest ? { digest: item.digest } : {}),
      ...(item.sent ? { sent: true } : {}),
      ...(item.error ? { error: item.error } : {}),
    }));
    const path = join(await this.resolveHome(id), "input-files", `${id}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ version: 1, attachments: next })}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
    return next;
  }

  async upsert(sessionId: string, attachment: StoreAttachment): Promise<StoreAttachment[]> {
    const current = await this.list(sessionId);
    const next = current.filter((item) => item.id !== attachment.id);
    next.push(attachment);
    return this.write(sessionId, next);
  }

  async remove(sessionId: string, attachmentId: string): Promise<{ removed?: StoreAttachment; attachments: StoreAttachment[] }> {
    const current = await this.list(sessionId);
    const removed = current.find((item) => item.id === attachmentId);
    const attachments = current.filter((item) => item.id !== attachmentId);
    await this.write(sessionId, attachments);
    return { removed, attachments };
  }

  findReusable(attachments: readonly StoreAttachment[], digest: string): StoreAttachment | undefined {
    return attachments.find((item) => item.digest === digest && item.fileId && (item.status === "ready" || item.sent));
  }
}

type InputFilesServiceFactory = (options?: { authPath?: string }) => InputFilesRemote;

export async function loadGrokInputFilesRemote(
  runtimeRoot: string,
  authPath?: string,
): Promise<InputFilesRemote | undefined> {
  const url = pathToFileURL(join(runtimeRoot, "extensions/grok-build-oauth/agent/dist/host.js")).href;
  try {
    const mod = await import(url) as { createInputFilesService?: InputFilesServiceFactory };
    if (typeof mod.createInputFilesService !== "function") return undefined;
    return mod.createInputFilesService(authPath ? { authPath } : undefined);
  } catch {
    return undefined;
  }
}

export class InputFilesController {
  private readonly inflight = new Map<string, AbortController>();
  private readonly bytes = new Map<string, Uint8Array>();

  constructor(
    private readonly store: StoreLike,
    private readonly remote: InputFilesRemote | undefined,
    private readonly resolveModel: (sessionId: string) => Model | undefined,
  ) {}

  async list(sessionId: string): Promise<InputFileAttachment[]> {
    return (await this.store.list(sessionId)).map(publicInputFileAttachment);
  }

  async stage(sessionId: string, request: InputFileStageRequest): Promise<InputFileAttachment> {
    this.assertCapable(sessionId);
    if (!this.remote) throw new Error("当前环境未启用文件上传");
    const bytes = decodeStageBytes(request);
    const digest = digestOf(bytes);
    const existing = this.store.findReusable(await this.store.list(sessionId), digest);
    if (existing?.fileId) {
      const requestedId = request.id?.trim();
      const reused: StoreAttachment = {
        ...existing,
        id: requestedId && requestedId !== existing.id ? requestedId : existing.id,
        name: safeInputFileName(request.name || existing.name),
        size: bytes.byteLength,
        mimeType: request.mimeType?.trim() || existing.mimeType,
        status: "ready",
        fileId: existing.fileId,
        digest,
        sent: requestedId && requestedId !== existing.id ? false : existing.sent,
      };
      delete reused.error;
      await this.store.upsert(sessionId, reused);
      return publicInputFileAttachment(reused);
    }
    const id = request.id?.trim() || randomUUID();
    const draft: StoreAttachment = {
      id,
      name: safeInputFileName(request.name),
      size: bytes.byteLength,
      mimeType: request.mimeType?.trim() || "application/octet-stream",
      status: "uploading",
      digest,
    };
    this.bytes.set(`${sessionId}:${id}`, bytes);
    await this.store.upsert(sessionId, draft);
    return this.upload(sessionId, draft, bytes);
  }

  async retry(sessionId: string, attachmentId: string, request?: InputFileStageRequest): Promise<InputFileAttachment> {
    this.assertCapable(sessionId);
    if (!this.remote) throw new Error("当前环境未启用文件上传");
    const current = (await this.store.list(sessionId)).find((item) => item.id === attachmentId);
    if (!current) throw new Error("找不到该附件");
    const bytes = request ? decodeStageBytes(request) : this.bytes.get(`${sessionId}:${attachmentId}`);
    if (!bytes) throw new Error("请重新选择文件后再试");
    const digest = digestOf(bytes);
    const next: StoreAttachment = {
      ...current,
      name: request ? safeInputFileName(request.name) : current.name,
      size: bytes.byteLength,
      mimeType: request?.mimeType?.trim() || current.mimeType,
      status: "uploading",
      digest,
    };
    delete next.error;
    this.bytes.set(`${sessionId}:${attachmentId}`, bytes);
    await this.store.upsert(sessionId, next);
    return this.upload(sessionId, next, bytes);
  }

  async cancel(sessionId: string, attachmentId: string): Promise<InputFileAttachment> {
    this.inflight.get(`${sessionId}:${attachmentId}`)?.abort();
    const current = (await this.store.list(sessionId)).find((item) => item.id === attachmentId);
    const next: StoreAttachment = {
      id: attachmentId,
      name: current?.name ?? "file",
      size: current?.size ?? 0,
      mimeType: current?.mimeType ?? "application/octet-stream",
      status: "cancelled",
      ...(current?.fileId ? { fileId: current.fileId } : {}),
      ...(current?.digest ? { digest: current.digest } : {}),
      ...(current?.sent ? { sent: true } : {}),
    };
    await this.store.upsert(sessionId, next);
    return publicInputFileAttachment(next);
  }

  async remove(sessionId: string, attachmentId: string): Promise<InputFileAttachment[]> {
    this.inflight.get(`${sessionId}:${attachmentId}`)?.abort();
    const { removed, attachments } = await this.store.remove(sessionId, attachmentId);
    this.bytes.delete(`${sessionId}:${attachmentId}`);
    if (removed?.fileId && !removed.sent) {
      await this.remote?.remove(removed.fileId).catch(() => undefined);
    }
    return attachments.map(publicInputFileAttachment);
  }

  /** Provider after-response only. Never expose over host IPC. */
  async markSent(sessionId: string, attachmentIds?: readonly string[]): Promise<InputFileAttachment[]> {
    const selected = attachmentIds?.length ? new Set(attachmentIds) : undefined;
    const attachments = await this.store.list(sessionId);
    const next = attachments.map((item) => (
      item.status === "ready" && item.fileId && (!selected || selected.has(item.id))
        ? { ...item, sent: true }
        : item
    ));
    await this.store.write(sessionId, next);
    return next.filter((item) => item.sent && item.fileId).map(publicInputFileAttachment);
  }

  async readyForSend(sessionId: string): Promise<InputFileAttachment[]> {
    const attachments = await this.store.list(sessionId);
    const pending = attachments.filter((item) => !item.sent);
    if (!pending.length) return [];
    this.assertCapable(sessionId);
    if (pending.some((item) => item.status === "uploading")) {
      throw new Error("文件仍在上传");
    }
    if (pending.some((item) => item.status === "failed")) {
      throw new Error("有文件上传失败，请重试或移除");
    }
    return pending.filter((item) => item.status === "ready" && item.fileId).map(publicInputFileAttachment);
  }

  private assertCapable(sessionId: string): void {
    if (!modelDeclaresInputFiles(this.resolveModel(sessionId))) {
      throw new Error("当前模型不支持文件附件");
    }
  }

  private async upload(sessionId: string, draft: StoreAttachment, bytes: Uint8Array): Promise<InputFileAttachment> {
    const key = `${sessionId}:${draft.id}`;
    this.inflight.get(key)?.abort();
    const controller = new AbortController();
    this.inflight.set(key, controller);
    try {
      const uploaded = await this.remote!.upload({
        bytes,
        name: draft.name,
        mimeType: draft.mimeType,
        signal: controller.signal,
      });
      const current = await this.currentAttachment(sessionId, draft.id);
      if (!current || current.status === "cancelled") {
        if (uploaded.fileId) await this.remote?.remove(uploaded.fileId).catch(() => undefined);
        return publicInputFileAttachment({ ...draft, ...current, status: "cancelled" });
      }
      const ready: StoreAttachment = {
        ...draft,
        name: safeInputFileName(uploaded.name),
        size: uploaded.size,
        mimeType: uploaded.mimeType,
        status: "ready",
        fileId: uploaded.fileId,
        digest: uploaded.digest || draft.digest,
      };
      delete ready.error;
      await this.store.upsert(sessionId, ready);
      return publicInputFileAttachment(ready);
    } catch (error) {
      const current = await this.currentAttachment(sessionId, draft.id);
      if (!current || current.status === "cancelled") {
        return publicInputFileAttachment({ ...draft, ...current, status: "cancelled" });
      }
      const aborted = controller.signal.aborted
        || (error as { code?: string })?.code === "aborted"
        || (error instanceof Error && error.name === "AbortError");
      const failed: StoreAttachment = {
        ...draft,
        status: aborted ? "cancelled" : "failed",
        error: aborted ? "已取消" : sanitizeInputFileError(error),
      };
      await this.store.upsert(sessionId, failed);
      return publicInputFileAttachment(failed);
    } finally {
      if (this.inflight.get(key) === controller) this.inflight.delete(key);
    }
  }

  private async currentAttachment(sessionId: string, attachmentId: string): Promise<StoreAttachment | undefined> {
    return (await this.store.list(sessionId)).find((item) => item.id === attachmentId);
  }
}

export function sanitizeInputFileError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:at|rt|sk)-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/(?:[A-Za-z]:)?(?:\/|\\)(?:Users|home|private|var|tmp)[^\s"'`]+/gi, "[path]")
    .trim() || "文件上传失败";
}
