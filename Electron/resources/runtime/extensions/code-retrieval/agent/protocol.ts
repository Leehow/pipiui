import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resultsDir, resultsRelPath } from "./paths.js";
import type { RerankerDetails } from "./reranker.js";
import type { RecallSource } from "./wide-recall.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, truncateLine } from "./truncate.js";
import type {
  RetrievalDetails,
  RetrievalHit,
  RetrievalKind,
  SpanRecord,
  ToolResult,
  UnassignedHit,
} from "./types.js";

const TOP_INLINE = 12;

export class RefRegistry {
  private next = 1;
  private readonly byRef = new Map<string, SpanRecord>();

  assign(hit: UnassignedHit): SpanRecord {
    const ref = `R${this.next++}`;
    const record: SpanRecord = {
      ref,
      path: hit.path,
      startLine: hit.startLine,
      endLine: hit.endLine,
      ...(hit.symbol ? { symbol: hit.symbol } : {}),
      ...(hit.score !== undefined ? { score: hit.score } : {}),
      ...(hit.queryIndices ? { queryIndices: [...hit.queryIndices] } : {}),
    };
    this.byRef.set(ref, record);
    return record;
  }

  assignAll(hits: UnassignedHit[]): SpanRecord[] {
    return hits.map((hit) => this.assign(hit));
  }

  get(ref: string): SpanRecord | undefined {
    return this.byRef.get(ref);
  }

  remember(record: SpanRecord): void {
    this.byRef.set(record.ref, record);
  }

  size(): number {
    return this.byRef.size;
  }

  clear(): void {
    this.next = 1;
    this.byRef.clear();
  }
}

export function formatRefLine(hit: {
  ref: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  score?: number;
  alreadyRead?: boolean;
}): string {
  const range = `${hit.path}:${hit.startLine}-${hit.endLine}`;
  const symbol = hit.symbol ? ` ${hit.symbol}()` : "";
  const score = typeof hit.score === "number" && Number.isFinite(hit.score) ? ` · score ${formatScore(hit.score)}` : "";
  const seen = hit.alreadyRead ? " (already read)" : "";
  return `${hit.ref} ${range}${symbol}${score}${seen}`;
}

function formatScore(score: number): string {
  if (Number.isInteger(score)) return String(score);
  const text = score.toFixed(2);
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

export function formatCompressedContent(
  hits: Array<Parameters<typeof formatRefLine>[0]>,
  extraNote?: string,
  /** ref → bounded inline source preview rendered directly under that ref line. */
  previews?: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [];
  for (const hit of hits.slice(0, TOP_INLINE)) {
    lines.push(formatRefLine(hit));
    const preview = previews?.get(hit.ref);
    if (preview) lines.push(preview);
  }
  if (hits.length > TOP_INLINE) {
    lines.push(`…（至多 12 条内联；其余见 results 落盘）`);
  }
  if (extraNote) lines.push(extraNote);
  return lines.join("\n");
}

export function applyLineTruncation(text: string): string {
  return text
    .split("\n")
    .map((line) => truncateLine(line).text)
    .join("\n");
}

export function truncateToolText(text: string): { text: string; truncated: boolean; note?: string } {
  const lined = applyLineTruncation(text);
  const result = truncateHead(lined, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!result.truncated) return { text: result.content, truncated: false };
  const note =
    `\n\n[Output truncated: ${result.outputLines} of ${result.totalLines} lines` +
    ` (${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}).` +
    ` Full output is in the results jsonl.]`;
  return { text: result.content + note, truncated: true };
}

export async function persistResults(
  projectRoot: string,
  payload: {
    kind: RetrievalKind;
    query?: string;
    degraded: boolean;
    hits: RetrievalHit[];
    content: string;
  },
): Promise<{ hash: string; resultsPath: string }> {
  const dir = resultsDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const hash = createHash("sha256")
    .update(JSON.stringify({ kind: payload.kind, query: payload.query, hits: payload.hits, at: Date.now() }))
    .digest("hex")
    .slice(0, 16);
  const abs = join(dir, `${hash}.jsonl`);
  const header = JSON.stringify({
    schemaVersion: 1,
    kind: payload.kind,
    query: payload.query,
    degraded: payload.degraded,
    hitCount: payload.hits.length,
  });
  const lines = [header, ...payload.hits.map((hit) => JSON.stringify(hit))];
  await writeFile(abs, `${lines.join("\n")}\n`, "utf8");
  return { hash, resultsPath: resultsRelPath(hash) };
}

export async function buildToolResult(args: {
  projectRoot: string;
  kind: RetrievalKind;
  hits: RetrievalHit[];
  degraded: boolean;
  content: string;
  query?: string;
  degradeReason?: string;
  /** Actual serving provider for indexed results; omitted for non-index kinds. */
  provider?: string;
  reranker?: RerankerDetails;
  sources?: RecallSource[];
}): Promise<ToolResult> {
  const persisted = await persistResults(args.projectRoot, {
    kind: args.kind,
    query: args.query,
    degraded: args.degraded,
    hits: args.hits,
    content: args.content,
  });
  const noteParts: string[] = [];
  if (args.degraded) {
    noteParts.push(args.degradeReason ?? "Index sidecar unavailable; used grep fallback (details.degraded=true).");
  }
  if (args.hits.length > TOP_INLINE) {
    noteParts.push(`Full ${args.hits.length} hits: ${persisted.resultsPath}`);
  } else if (args.hits.length > 0) {
    noteParts.push(`results: ${persisted.resultsPath}`);
  }
  const truncated = truncateToolText(args.content);
  const body = [truncated.text, ...noteParts].filter(Boolean).join("\n");
  const details: RetrievalDetails = {
    schemaVersion: 1,
    kind: args.kind,
    hits: args.hits.map(({ text: _text, ...rest }) => rest),
    resultsPath: persisted.resultsPath,
    degraded: args.degraded,
    ...(args.provider ? { provider: args.provider } : {}),
    ...(args.reranker ? { reranker: args.reranker } : {}),
    ...(args.sources ? { sources: args.sources } : {}),
  };
  return {
    content: [{ type: "text", text: body }],
    details,
  };
}

export function emptyDegraded(
  kind: RetrievalKind,
  message: string,
  resultsPath = "",
): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    details: {
      schemaVersion: 1,
      kind,
      hits: [],
      resultsPath,
      degraded: true,
    },
  };
}
