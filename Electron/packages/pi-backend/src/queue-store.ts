import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { QueuedAttachment, QueuedMessage } from "./message-queue.js";

/** Injectable persistence boundary for the host-owned product queue. */
export interface QueueStore {
  load(sessionId: string): Promise<QueuedMessage[]>;
  save(sessionId: string, items: QueuedMessage[]): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

type StoredQueue = { version: 1; sessionId: string; items: unknown[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const copy = <T>(value: T): T => structuredClone(value);

function attachment(value: unknown): QueuedAttachment | undefined {
  if (!isRecord(value) || typeof value.dataBase64 !== "string" || typeof value.mimeType !== "string") return undefined;
  return copy(value) as QueuedAttachment;
}

/**
 * Parses only the action-safe queue fields. `sending` has ambiguous delivery
 * status after a host crash, so it is deliberately restored as `queued`; this
 * can re-send a message but never silently loses it. Queue files contain no
 * model credentials or auth material — only user text and attachment payloads.
 */
function restoreItem(value: unknown, sessionId: string): QueuedMessage | undefined {
  if (!isRecord(value)
    || typeof value.id !== "string" || value.id.length === 0
    || typeof value.text !== "string"
    || !Array.isArray(value.attachments)
    || typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return undefined;
  const attachments = value.attachments.map(attachment);
  if (attachments.some(item => !item)) return undefined;
  const failed = value.state === "failed";
  const state = failed ? "failed" as const : "queued" as const;
  return {
    id: value.id,
    sessionId,
    text: value.text,
    attachments: attachments as QueuedAttachment[],
    createdAt: value.createdAt,
    state,
    error: failed && typeof value.error === "string" ? value.error : undefined,
  };
}

/** Atomic per-session JSON store below the user-owned pi agent directory. */
export class FileQueueStore implements QueueStore {
  constructor(private readonly root: string) {}

  private pathFor(sessionId: string): string {
    // Session ids become one encoded filename only; no user text or secrets are
    // included in filenames, and path separators cannot escape the store root.
    return join(this.root, `${encodeURIComponent(sessionId)}.json`);
  }

  async load(sessionId: string): Promise<QueuedMessage[]> {
    let raw: StoredQueue;
    try {
      raw = JSON.parse(await fs.readFile(this.pathFor(sessionId), "utf8")) as StoredQueue;
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      return [];
    }
    if (!isRecord(raw) || raw.version !== 1 || raw.sessionId !== sessionId || !Array.isArray(raw.items)) return [];
    return raw.items.map(item => restoreItem(item, sessionId)).filter((item): item is QueuedMessage => Boolean(item));
  }

  async save(sessionId: string, items: QueuedMessage[]): Promise<void> {
    const target = this.pathFor(sessionId);
    await fs.mkdir(this.root, { recursive: true });
    const body: StoredQueue = { version: 1, sessionId, items: copy(items) };
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(temporary, JSON.stringify(body) + "\n", "utf8");
    await fs.rename(temporary, target);
  }

  async remove(sessionId: string): Promise<void> {
    await fs.rm(this.pathFor(sessionId), { force: true });
  }
}
