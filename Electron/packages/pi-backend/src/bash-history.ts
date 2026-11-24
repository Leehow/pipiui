import { open, stat } from "node:fs/promises";

/** One response page. Both fields are paged from byte 0; callers keep the live tail separately. */
export type BashHistoryField = "input" | "output";
export type BashHistoryState = "completed" | "failed" | "running" | "unavailable";
export type BashHistoryPage = {
  text: string;
  nextOffset?: number;
  totalBytes: number;
  truncated: boolean;
  state: BashHistoryState;
};

const PAGE_BYTES = 32 * 1024;
const MAX_INDEXED_FILES = 8;
/** Inclusive cap on metadata rows and on bash tool hits scanned from one file. */
const DEFAULT_MAX_ENTRIES = 50_000;
/** A single JSONL record above this is not parsed. Tools that exist only on it are unavailable. */
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const READ_CHUNK_BYTES = 256 * 1024;

export type BashHistoryReaderOptions = {
  /** Inclusive per-file cap. Past this, the file is unavailable instead of a partial branch. */
  maxEntries?: number;
};

type Summary = { id: string; parentId: string | null; type: string };
type LineSpan = { offset: number; length: number };
type CallHit = LineSpan & { entryId: string; toolCallId: string };
type ResultHit = LineSpan & { entryId: string; toolCallId: string; toolName: string; isError: boolean };
type ToolRecord = {
  input?: LineSpan;
  output?: LineSpan & { isError: boolean };
};
type FileIndex = FileStamp & {
  summaries: Summary[];
  calls: CallHit[];
  results: ResultHit[];
  completeOffset: number;
  head: Buffer;
  tail: Buffer;
  overflow: boolean;
  tools: Map<string, ToolRecord>;
};
type FileStamp = { mtimeMs: number; ctimeMs: number; size: number; ino: number; dev: number };
const CHECK_BYTES = 4096;

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.size === b.size && a.ino === b.ino && a.dev === b.dev;
}

/**
 * Paged reader for bash tool arguments and results stored in a session JSONL.
 *
 * The cache retains bounded branch metadata and line offsets, never field text
 * (at most {@link MAX_INDEXED_FILES} files and `maxEntries` rows or tool hits
 * per file). Append scans resume after the last complete line; active-branch
 * tools are reassembled from metadata. Field text is parsed only for a page.
 * `clear()` drops the offset cache and invalidates in-flight index builds.
 */
export class BashHistoryReader {
  private readonly cache = new Map<string, FileIndex>();
  private readonly inflight = new Map<string, Promise<FileIndex>>();
  private readonly maxEntries: number;
  private generation = 0;
  /** Scan work only; excludes bounded identity probes and requested field reads. No body logging. */
  readonly diagnostics = { scannedBytes: 0, fullBuilds: 0, appendBuilds: 0 };

  constructor(options?: BashHistoryReaderOptions) {
    const requested = options?.maxEntries;
    this.maxEntries = requested === undefined || !Number.isFinite(requested)
      ? DEFAULT_MAX_ENTRIES
      : Math.max(0, Math.floor(requested));
  }

  async read(
    path: string,
    toolCallId: string,
    field: BashHistoryField,
    offset = 0,
    transform?: (text: string) => string,
  ): Promise<BashHistoryPage> {
    if (!toolCallId || (field !== "input" && field !== "output")) return unavailable();
    const index = await this.cachedIndex(path);
    if (!index || index.overflow) return unavailable();
    const page = await this.pageFromIndex(path, index, toolCallId, field, offset, transform);
    const after = await fileStamp(path);
    if (!after || !sameStamp(after, index)) {
      const rebuilt = await this.cachedIndex(path);
      if (!rebuilt || rebuilt.overflow) return unavailable();
      return this.pageFromIndex(path, rebuilt, toolCallId, field, offset, transform);
    }
    return page;
  }

  clear(): void {
    this.generation += 1;
    this.cache.clear();
  }

  private async cachedIndex(path: string): Promise<FileIndex | null> {
    const stamp = await fileStamp(path);
    if (!stamp) return null;
    const cached = this.cache.get(path);
    if (cached && sameStamp(cached, stamp)) {
      this.touch(path, cached);
      return cached;
    }
    const key = `${path}\0${stamp.dev}\0${stamp.ino}\0${stamp.ctimeMs}\0${stamp.mtimeMs}\0${stamp.size}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const generation = this.generation;
    const pending = this.buildIndex(path, stamp, cached)
      .then(async (index) => {
        if (generation !== this.generation) return index;
        const latest = await fileStamp(path);
        if (latest && sameStamp(latest, stamp)) this.touch(path, index);
        return index;
      })
      .finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key);
      });
    this.inflight.set(key, pending);
    return pending;
  }

  private touch(path: string, index: FileIndex): void {
    this.cache.delete(path);
    this.cache.set(path, index);
    while (this.cache.size > MAX_INDEXED_FILES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async buildIndex(path: string, stamp: FileStamp, cached?: FileIndex): Promise<FileIndex> {
    // Only growth on the same inode with unchanged prefix boundaries is appendable.
    // These bounded probes detect ordinary rewrites; they are not a whole-file integrity hash.
    const append = cached && stamp.ino === cached.ino && stamp.dev === cached.dev && stamp.size > cached.size
      && (await readAt(path, 0, cached.head.length)).equals(cached.head)
      && (await readAt(path, cached.size - cached.tail.length, cached.tail.length)).equals(cached.tail);
    if (append) this.diagnostics.appendBuilds++;
    else this.diagnostics.fullBuilds++;
    const summaries = append ? cached.summaries.slice() : [];
    const calls = append ? cached.calls.slice() : [];
    const results = append ? cached.results.slice() : [];
    let overflow = Boolean(append && cached.overflow);
    let partial: ReturnType<typeof inspectLine>;
    let completeOffset = append ? cached.completeOffset : 0;
    if (!overflow) completeOffset = await forEachLine(path, stamp.size, completeOffset, (line, offset, complete) => {
      const inspected = inspectLine(line, offset);
      if (!inspected) return;
      if (summaries.length + 1 > this.maxEntries
        || calls.length + results.length + inspected.calls.length + inspected.results.length > this.maxEntries) {
        overflow = true;
        return false;
      }
      if (!complete) {
        partial = inspected;
        return;
      }
      summaries.push(inspected.summary);
      calls.push(...inspected.calls);
      results.push(...inspected.results);
    }, (bytes) => { this.diagnostics.scannedBytes += bytes; });
    const head = await readAt(path, 0, Math.min(CHECK_BYTES, stamp.size));
    const tail = await readAt(path, Math.max(0, stamp.size - CHECK_BYTES), Math.min(CHECK_BYTES, stamp.size));
    const tools = overflow ? new Map<string, ToolRecord>() : assemble(
      partial ? [...summaries, partial.summary] : summaries,
      partial ? [...calls, ...partial.calls] : calls,
      partial ? [...results, ...partial.results] : results,
    );
    return { ...stamp, summaries: overflow ? [] : summaries, calls: overflow ? [] : calls,
      results: overflow ? [] : results, completeOffset, head, tail, overflow, tools };
  }

  private async pageFromIndex(
    path: string,
    index: FileIndex,
    toolCallId: string,
    field: BashHistoryField,
    offset: number,
    transform?: (text: string) => string,
  ): Promise<BashHistoryPage> {
    const record = index.tools.get(toolCallId);
    if (!record) return unavailable();
    const state: BashHistoryState = record.output
      ? record.output.isError ? "failed" : "completed"
      : record.input
        ? "running"
        : "unavailable";
    const located = field === "input" ? record.input : record.output;
    if (!located) {
      if (field === "output" && state === "running") {
        return { text: "", totalBytes: 0, truncated: false, state: "running" };
      }
      return unavailable();
    }
    const line = await readAt(path, located.offset, located.length);
    const entry = parseLine(line);
    const extracted = entry ? fieldText(entry, field, toolCallId) : undefined;
    if (extracted === undefined) return unavailable();
    const text = transform ? transform(extracted) : extracted;
    return { ...pageUtf8(text, offset), state };
  }
}

function unavailable(): BashHistoryPage {
  return { text: "", totalBytes: 0, truncated: false, state: "unavailable" };
}

async function fileStamp(path: string): Promise<FileStamp | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, size: info.size, ino: info.ino, dev: info.dev };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

async function readAt(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Walk the requested suffix, returning the end of its last complete line.
 * The callback is synchronous: `line`
 * may be a view into a reused chunk. Lines longer than {@link MAX_LINE_BYTES}
 * are skipped and never buffered whole.
 */
async function forEachLine(
  path: string,
  size: number,
  start: number,
  onLine: (line: Buffer, offset: number, complete: boolean) => boolean | void,
  onRead: (bytes: number) => void,
): Promise<number> {
  if (size <= start) return start;
  const handle = await open(path, "r");
  try {
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    let filePos = start;
    let completeOffset = start;
    let carry = Buffer.alloc(0);
    let carryOffset = 0;
    let skipping = false;
    let stop = false;
    const emit = (line: Buffer, offset: number) => {
      if (stop) return;
      if (onLine(line, offset, true) === false) stop = true;
    };
    while (filePos < size && !stop) {
      const want = Math.min(chunk.length, size - filePos);
      const { bytesRead } = await handle.read(chunk, 0, want, filePos);
      if (bytesRead === 0) break;
      onRead(bytesRead);
      const localBase = filePos;
      filePos += bytesRead;
      let cursor = 0;
      while (cursor < bytesRead && !stop) {
        const newline = findByte(chunk, 0x0a, cursor, bytesRead);
        if (newline < 0) {
          const rest = chunk.subarray(cursor, bytesRead);
          if (!skipping) {
            if (carry.length + rest.length > MAX_LINE_BYTES) {
              skipping = true;
              carry = Buffer.alloc(0);
            } else if (carry.length === 0) {
              carry = Buffer.from(rest);
              carryOffset = localBase + cursor;
            } else {
              carry = Buffer.concat([carry, rest]);
            }
          }
          break;
        }
        completeOffset = localBase + newline + 1;
        if (skipping) {
          skipping = false;
          cursor = newline + 1;
          continue;
        }
        const part = chunk.subarray(cursor, newline);
        if (carry.length === 0) {
          if (part.length <= MAX_LINE_BYTES) emit(part, localBase + cursor);
        } else {
          const combined = Buffer.concat([carry, part]);
          const offset = carryOffset;
          carry = Buffer.alloc(0);
          if (combined.length <= MAX_LINE_BYTES) emit(combined, offset);
        }
        cursor = newline + 1;
      }
    }
    if (!stop && !skipping && carry.length > 0 && carry.length <= MAX_LINE_BYTES) onLine(carry, carryOffset, false);
    return completeOffset;
  } finally {
    await handle.close();
  }
}

function findByte(buffer: Buffer, value: number, from: number, to: number): number {
  for (let index = from; index < to; index++) if (buffer[index] === value) return index;
  return -1;
}

function parseLine(line: Buffer): Record<string, unknown> | undefined {
  const raw = line.length > 0 && line[line.length - 1] === 0x0d ? line.subarray(0, -1) : line;
  if (raw.length === 0) return undefined;
  try {
    const value = JSON.parse(raw.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function inspectLine(
  line: Buffer,
  offset: number,
): { summary: Summary; calls: CallHit[]; results: ResultHit[] } | undefined {
  const entry = parseLine(line);
  if (!entry) return undefined;
  const type = typeof entry.type === "string" ? entry.type : "";
  if (type === "session" || typeof entry.id !== "string") return undefined;
  const summary: Summary = {
    id: entry.id,
    parentId: typeof entry.parentId === "string" ? entry.parentId : null,
    type,
  };
  const calls: CallHit[] = [];
  const results: ResultHit[] = [];
  const length = line.length;
  const message = entry.message;
  if (type !== "message" || !message || typeof message !== "object" || Array.isArray(message)) {
    return { summary, calls, results };
  }
  const record = message as Record<string, unknown>;
  if (record.role === "assistant" && Array.isArray(record.content)) {
    for (const part of record.content) {
      if (!part || typeof part !== "object") continue;
      const call = part as Record<string, unknown>;
      if (call.type !== "toolCall" || call.name !== "bash" || typeof call.id !== "string" || !call.id) continue;
      calls.push({ entryId: summary.id, toolCallId: call.id, offset, length });
    }
  } else if (record.role === "toolResult" && typeof record.toolCallId === "string" && record.toolCallId) {
    results.push({
      entryId: summary.id,
      toolCallId: record.toolCallId,
      toolName: typeof record.toolName === "string" ? record.toolName : "",
      isError: Boolean(record.isError),
      offset,
      length,
    });
  }
  return { summary, calls, results };
}

function isMetadataReroot(type: string): boolean {
  return type === "thinking_level_change" || type === "model_change" || type === "session_info";
}

/** Active leaf chain, same parentId / metadata-reroot rules as session history. */
function activeBranch(ordered: Summary[]): Summary[] {
  if (ordered.length === 0) return [];
  const byId = new Map(ordered.map((entry) => [entry.id, entry]));
  const previous = new Map<string, Summary>();
  for (let index = 1; index < ordered.length; index++) previous.set(ordered[index]!.id, ordered[index - 1]!);
  const branch: Summary[] = [];
  let current: Summary | undefined = ordered[ordered.length - 1];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    branch.push(current);
    if (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
      continue;
    }
    if (!current.parentId && isMetadataReroot(current.type)) {
      current = previous.get(current.id);
      continue;
    }
    current = undefined;
  }
  branch.reverse();
  return branch;
}

function assemble(summaries: Summary[], calls: CallHit[], results: ResultHit[]): Map<string, ToolRecord> {
  const rank = new Map<string, number>();
  for (const [index, entry] of activeBranch(summaries).entries()) rank.set(entry.id, index);
  const tools = new Map<string, ToolRecord>();
  const orderedCalls = calls
    .filter((hit) => rank.has(hit.entryId))
    .sort((a, b) => rank.get(a.entryId)! - rank.get(b.entryId)!);
  for (const hit of orderedCalls) {
    const record = tools.get(hit.toolCallId) ?? {};
    record.input = { offset: hit.offset, length: hit.length };
    tools.set(hit.toolCallId, record);
  }
  const orderedResults = results
    .filter((hit) => rank.has(hit.entryId))
    .sort((a, b) => rank.get(a.entryId)! - rank.get(b.entryId)!);
  for (const hit of orderedResults) {
    if (hit.toolName && hit.toolName !== "bash") continue;
    const record = tools.get(hit.toolCallId) ?? {};
    if (!hit.toolName && !record.input) continue;
    record.output = { offset: hit.offset, length: hit.length, isError: hit.isError };
    tools.set(hit.toolCallId, record);
  }
  return tools;
}

function fieldText(entry: Record<string, unknown>, field: BashHistoryField, toolCallId: string): string | undefined {
  const message = entry.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const record = message as Record<string, unknown>;
  if (field === "output") {
    if (record.role !== "toolResult" || record.toolCallId !== toolCallId) return undefined;
    return contentText(record.content);
  }
  if (record.role !== "assistant" || !Array.isArray(record.content)) return undefined;
  for (const part of record.content) {
    if (!part || typeof part !== "object") continue;
    const call = part as Record<string, unknown>;
    if (call.type !== "toolCall" || call.name !== "bash" || call.id !== toolCallId) continue;
    const args = call.arguments;
    return args != null && typeof args === "object" ? JSON.stringify(args) : String(args ?? "");
  }
  return undefined;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") text += record.text;
  }
  return text;
}

function pageUtf8(text: string, offset: number): Omit<BashHistoryPage, "state"> {
  const bytes = Buffer.from(text, "utf8");
  const totalBytes = bytes.length;
  let start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  if (start > totalBytes) start = totalBytes;
  while (start > 0 && (bytes[start]! & 0xc0) === 0x80) start--;
  let end = Math.min(start + PAGE_BYTES, totalBytes);
  if (end < totalBytes) {
    let cursor = start;
    while (cursor < end) {
      const needed = utf8Length(bytes[cursor]!);
      if (cursor + needed > end) break;
      cursor += Math.max(1, needed);
    }
    end = cursor;
  }
  const nextOffset = end < totalBytes ? end : undefined;
  return {
    text: bytes.subarray(start, end).toString("utf8"),
    ...(nextOffset === undefined ? {} : { nextOffset }),
    totalBytes,
    truncated: nextOffset !== undefined,
  };
}

function utf8Length(lead: number): number {
  if (lead < 0x80) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  return 1;
}
