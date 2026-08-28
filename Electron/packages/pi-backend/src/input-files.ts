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

type InflightUpload = { controller: AbortController; epoch: number };

export class InputFilesController {
  private readonly inflight = new Map<string, InflightUpload>();
  private readonly bytes = new Map<string, Uint8Array>();
  /** Per-session generation invalidates upload continuations during teardown. */
  private readonly sessionEpochs = new Map<string, number>();
  /** Every mutating operation is tracked so teardown can settle it before file deletion. */
  private readonly pending = new Map<string, Set<Promise<unknown>>>();
  private readonly disposing = new Set<string>();
  private readonly disposals = new Map<string, Promise<void>>();

  constructor(
    private readonly store: StoreLike,
    private readonly remote: InputFilesRemote | undefined,
    private readonly resolveModel: (sessionId: string) => Model | undefined,
  ) {}

  private key(sessionId: string, attachmentId: string): string {
    return `${sessionId}\0${attachmentId}`;
  }

  private belongsToSession(key: string, sessionId: string): boolean {
    return key.startsWith(`${sessionId}\0`);
  }

  private epoch(sessionId: string): number {
    return this.sessionEpochs.get(sessionId) ?? 0;
  }

  private isCurrent(sessionId: string, epoch: number): boolean {
    return !this.disposing.has(sessionId) && this.epoch(sessionId) === epoch;
  }

  private track<T>(sessionId: string, task: Promise<T>): Promise<T> {
    const tasks = this.pending.get(sessionId) ?? new Set<Promise<unknown>>();
    tasks.add(task);
    this.pending.set(sessionId, tasks);
    const done = () => {
      tasks.delete(task);
      if (tasks.size === 0) this.pending.delete(sessionId);
    };
    void task.then(done, done);
    return task;
  }

  private cancelledAttachment(draft: StoreAttachment): InputFileAttachment {
    const cancelled: StoreAttachment = { ...draft, status: "cancelled" };
    delete cancelled.error;
    return publicInputFileAttachment(cancelled);
  }

  private releaseBytes(key: string, expected?: Uint8Array): void {
    if (expected && this.bytes.get(key) !== expected) return;
    this.bytes.delete(key);
  }

  private abortUpload(key: string): void {
    const upload = this.inflight.get(key);
    if (!upload) return;
    this.inflight.delete(key);
    upload.controller.abort();
  }

  /** Observable lifecycle diagnostics without exposing retained byte Maps. */
  retainedByteCount(sessionId?: string): number {
    return [...this.bytes.entries()]
      .filter(([key]) => !sessionId || this.belongsToSession(key, sessionId))
      .reduce((total, [, bytes]) => total + bytes.byteLength, 0);
  }

  /** Observable lifecycle diagnostics without exposing abort-controller Maps. */
  inflightCount(sessionId?: string): number {
    return [...this.inflight.keys()].filter((key) => !sessionId || this.belongsToSession(key, sessionId)).length;
  }

  /** Sessions with retained bytes, uploads, or mutating attachment work. */
  runtimeSessionIds(): string[] {
    const ids = new Set<string>([...this.pending.keys(), ...this.disposing, ...this.disposals.keys()]);
    for (const key of [...this.bytes.keys(), ...this.inflight.keys()]) {
      const separator = key.indexOf("\0");
      if (separator > 0) ids.add(key.slice(0, separator));
    }
    return [...ids];
  }

  /**
   * Abort and release every transient attachment resource for one session.
   * The store metadata survives host shutdown; an explicit session deletion
   * may remove persistent files afterwards. Repeated/concurrent calls share
   * one safe settlement.
   */
  async disposeSession(sessionId: string): Promise<void> {
    const current = this.disposals.get(sessionId);
    if (current) return current;
    this.disposing.add(sessionId);
    const disposedEpoch = this.epoch(sessionId) + 1;
    this.sessionEpochs.set(sessionId, disposedEpoch);
    const task = (async () => {
      for (const [key] of this.inflight) {
        if (this.belongsToSession(key, sessionId)) this.abortUpload(key);
      }
      for (const key of [...this.bytes.keys()]) {
        if (this.belongsToSession(key, sessionId)) this.releaseBytes(key);
      }
      // A stage/retry may be between a store write and remote upload. The
      // disposal fence rejects new mutators, so one snapshot covers every
      // operation that can still touch durable session files.
      const pending = [...(this.pending.get(sessionId) ?? [])];
      await Promise.allSettled(pending);
      // Preserve attachment metadata, but never leave a shutdown-aborted
      // upload permanently stuck in `uploading` after its bytes are gone.
      const attachments = await this.store.list(sessionId).catch(() => []);
      const next = attachments.map((item) => {
        if (item.status !== "uploading") return item;
        const cancelled: StoreAttachment = { ...item, status: "cancelled", error: "已取消" };
        return cancelled;
      });
      if (next.some((item, index) => item !== attachments[index])) {
        await this.store.write(sessionId, next).catch(() => undefined);
      }
    })().finally(() => {
      this.disposing.delete(sessionId);
      if (this.sessionEpochs.get(sessionId) === disposedEpoch) this.sessionEpochs.delete(sessionId);
      this.disposals.delete(sessionId);
    });
    this.disposals.set(sessionId, task);
    return task;
  }

  /** Dispose all transient attachment state without reaching into private Maps. */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.runtimeSessionIds()].map((sessionId) => this.disposeSession(sessionId)));
  }

  async list(sessionId: string): Promise<InputFileAttachment[]> {
    return (await this.store.list(sessionId)).map(publicInputFileAttachment);
  }

  async stage(sessionId: string, request: InputFileStageRequest): Promise<InputFileAttachment> {
    if (this.disposing.has(sessionId)) throw new Error("会话正在关闭");
    const epoch = this.epoch(sessionId);
    return this.track(sessionId, this.stageForEpoch(sessionId, request, epoch));
  }

  private async stageForEpoch(sessionId: string, request: InputFileStageRequest, epoch: number): Promise<InputFileAttachment> {
    this.assertCapable(sessionId);
    if (!this.remote) throw new Error("当前环境未启用文件上传");
    const bytes = decodeStageBytes(request);
    const digest = digestOf(bytes);
    const requestedId = request.id?.trim();
    const draftId = requestedId || randomUUID();
    const draft: StoreAttachment = {
      id: draftId,
      name: safeInputFileName(request.name),
      size: bytes.byteLength,
      mimeType: request.mimeType?.trim() || "application/octet-stream",
      status: "uploading",
      digest,
    };
    const existing = this.store.findReusable(await this.store.list(sessionId), digest);
    if (!this.isCurrent(sessionId, epoch)) return this.cancelledAttachment(draft);
    if (existing?.fileId) {
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
      return this.isCurrent(sessionId, epoch)
        ? publicInputFileAttachment(reused)
        : this.cancelledAttachment(reused);
    }
    const key = this.key(sessionId, draft.id);
    this.bytes.set(key, bytes);
    try {
      await this.store.upsert(sessionId, draft);
    } catch (error) {
      this.releaseBytes(key, bytes);
      throw error;
    }
    if (!this.isCurrent(sessionId, epoch) || this.bytes.get(key) !== bytes) {
      this.releaseBytes(key, bytes);
      return this.cancelledAttachment(draft);
    }
    return this.upload(sessionId, draft, bytes, epoch);
  }

  async retry(sessionId: string, attachmentId: string, request?: InputFileStageRequest): Promise<InputFileAttachment> {
    if (this.disposing.has(sessionId)) throw new Error("会话正在关闭");
    const epoch = this.epoch(sessionId);
    return this.track(sessionId, this.retryForEpoch(sessionId, attachmentId, request, epoch));
  }

  private async retryForEpoch(
    sessionId: string,
    attachmentId: string,
    request: InputFileStageRequest | undefined,
    epoch: number,
  ): Promise<InputFileAttachment> {
    this.assertCapable(sessionId);
    if (!this.remote) throw new Error("当前环境未启用文件上传");
    const current = (await this.store.list(sessionId)).find((item) => item.id === attachmentId);
    if (!current) throw new Error("找不到该附件");
    if (!this.isCurrent(sessionId, epoch)) return this.cancelledAttachment(current);
    const key = this.key(sessionId, attachmentId);
    const bytes = request ? decodeStageBytes(request) : this.bytes.get(key);
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
    this.abortUpload(key);
    this.bytes.set(key, bytes);
    try {
      await this.store.upsert(sessionId, next);
    } catch (error) {
      this.releaseBytes(key, bytes);
      throw error;
    }
    if (!this.isCurrent(sessionId, epoch) || this.bytes.get(key) !== bytes) {
      this.releaseBytes(key, bytes);
      return this.cancelledAttachment(next);
    }
    return this.upload(sessionId, next, bytes, epoch);
  }

  async cancel(sessionId: string, attachmentId: string): Promise<InputFileAttachment> {
    if (this.disposing.has(sessionId)) throw new Error("会话正在关闭");
    const epoch = this.epoch(sessionId);
    return this.track(sessionId, this.cancelForEpoch(sessionId, attachmentId, epoch));
  }

  private async cancelForEpoch(sessionId: string, attachmentId: string, epoch: number): Promise<InputFileAttachment> {
    const key = this.key(sessionId, attachmentId);
    this.abortUpload(key);
    this.releaseBytes(key);
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
    if (!this.isCurrent(sessionId, epoch)) return this.cancelledAttachment(next);
    await this.store.upsert(sessionId, next);
    return this.isCurrent(sessionId, epoch)
      ? publicInputFileAttachment(next)
      : this.cancelledAttachment(next);
  }

  async remove(sessionId: string, attachmentId: string): Promise<InputFileAttachment[]> {
    if (this.disposing.has(sessionId)) throw new Error("会话正在关闭");
    const epoch = this.epoch(sessionId);
    return this.track(sessionId, this.removeForEpoch(sessionId, attachmentId, epoch));
  }

  private async removeForEpoch(sessionId: string, attachmentId: string, epoch: number): Promise<InputFileAttachment[]> {
    const key = this.key(sessionId, attachmentId);
    this.abortUpload(key);
    this.releaseBytes(key);
    const { removed, attachments } = await this.store.remove(sessionId, attachmentId);
    if (removed?.fileId && !removed.sent && this.isCurrent(sessionId, epoch)) {
      await this.remote?.remove(removed.fileId).catch(() => undefined);
    }
    return attachments.map(publicInputFileAttachment);
  }

  /** Provider after-response only. Never expose over host IPC. */
  async markSent(sessionId: string, attachmentIds?: readonly string[]): Promise<InputFileAttachment[]> {
    if (this.disposing.has(sessionId)) return [];
    const epoch = this.epoch(sessionId);
    return this.track(sessionId, this.markSentForEpoch(sessionId, attachmentIds, epoch));
  }

  private async markSentForEpoch(
    sessionId: string,
    attachmentIds: readonly string[] | undefined,
    epoch: number,
  ): Promise<InputFileAttachment[]> {
    const selected = attachmentIds?.length ? new Set(attachmentIds) : undefined;
    const attachments = await this.store.list(sessionId);
    if (!this.isCurrent(sessionId, epoch)) return [];
    const next = attachments.map((item) => (
      item.status === "ready" && item.fileId && (!selected || selected.has(item.id))
        ? { ...item, sent: true }
        : item
    ));
    await this.store.write(sessionId, next);
    return this.isCurrent(sessionId, epoch)
      ? next.filter((item) => item.sent && item.fileId).map(publicInputFileAttachment)
      : [];
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

  private async upload(
    sessionId: string,
    draft: StoreAttachment,
    bytes: Uint8Array,
    epoch: number,
  ): Promise<InputFileAttachment> {
    const key = this.key(sessionId, draft.id);
    if (!this.isCurrent(sessionId, epoch) || this.bytes.get(key) !== bytes) {
      this.releaseBytes(key, bytes);
      return this.cancelledAttachment(draft);
    }
    this.abortUpload(key);
    const controller = new AbortController();
    const upload: InflightUpload = { controller, epoch };
    this.inflight.set(key, upload);
    let retainBytesForRetry = false;
    try {
      const uploaded = await this.remote!.upload({
        bytes,
        name: draft.name,
        mimeType: draft.mimeType,
        signal: controller.signal,
      });
      if (!this.isCurrent(sessionId, epoch) || this.inflight.get(key) !== upload) {
        if (uploaded.fileId) await this.remote?.remove(uploaded.fileId).catch(() => undefined);
        return this.cancelledAttachment(draft);
      }
      const current = await this.currentAttachment(sessionId, draft.id);
      if (!this.isCurrent(sessionId, epoch) || this.inflight.get(key) !== upload || !current || current.status === "cancelled") {
        if (uploaded.fileId) await this.remote?.remove(uploaded.fileId).catch(() => undefined);
        return this.cancelledAttachment({ ...draft, ...current });
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
      return this.isCurrent(sessionId, epoch) && this.inflight.get(key) === upload
        ? publicInputFileAttachment(ready)
        : this.cancelledAttachment(ready);
    } catch (error) {
      if (!this.isCurrent(sessionId, epoch) || this.inflight.get(key) !== upload) {
        return this.cancelledAttachment(draft);
      }
      const current = await this.currentAttachment(sessionId, draft.id);
      if (!this.isCurrent(sessionId, epoch) || this.inflight.get(key) !== upload || !current || current.status === "cancelled") {
        return this.cancelledAttachment({ ...draft, ...current });
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
      retainBytesForRetry = !aborted && this.isCurrent(sessionId, epoch) && this.inflight.get(key) === upload;
      return retainBytesForRetry
        ? publicInputFileAttachment(failed)
        : this.cancelledAttachment(failed);
    } finally {
      if (this.inflight.get(key) === upload) this.inflight.delete(key);
      if (!retainBytesForRetry) this.releaseBytes(key, bytes);
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
