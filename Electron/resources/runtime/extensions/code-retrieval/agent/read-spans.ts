import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { getSymbolLayer } from "./hooks.js";
import { extractSpanText, hashContent, mergeAdjacentSpans, type SeenRangeLedger } from "./ledger.js";
import { buildToolResult, emptyDegraded, type RefRegistry } from "./protocol.js";
import { estimateTokens } from "./settings.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.js";
import type { RetrievalHit, SpanRecord, ToolResult } from "./types.js";

export type ReadSpansArgs = {
  refs: string[];
  projectRoot: string;
  registry: RefRegistry;
  ledger: SeenRangeLedger;
  tokenBudget: number;
};

type ResolvedSpan = SpanRecord & { body?: string; contentHash: string; alreadyRead: boolean };

export async function executeReadSpans(args: ReadSpansArgs): Promise<ToolResult> {
  try {
    const requested = await resolveRefs(args);
    if (requested.length === 0) {
      return emptyDegraded(
        "code-retrieval.spans",
        "read_spans: no known refs. Call code_search / repo_map first and pass the returned R# ids.",
      );
    }

    const merged = mergeAdjacentSpans(requested);
    const byHash = new Map<string, ResolvedSpan>();
    const unique: ResolvedSpan[] = [];
    for (const span of merged) {
      const key = `${span.path}\0${span.contentHash}`;
      if (byHash.has(key)) continue;
      byHash.set(key, span);
      unique.push(span);
    }

    let used = 0;
    const hits: RetrievalHit[] = [];
    const blocks: string[] = [];

    for (const span of unique) {
      const seen = args.ledger.has({
        path: span.path,
        startLine: span.startLine,
        endLine: span.endLine,
        contentHash: span.contentHash,
      });
      const hit: RetrievalHit = {
        ref: span.ref,
        path: span.path,
        startLine: span.startLine,
        endLine: span.endLine,
        ...(span.symbol ? { symbol: span.symbol } : {}),
        ...(span.score !== undefined ? { score: span.score } : {}),
        alreadyRead: seen,
      };

      if (seen) {
        hits.push(hit);
        blocks.push(`${formatHeader(hit)} (already read)`);
        continue;
      }

      const rawBody = span.body ?? "";
      const tokens = estimateTokens(rawBody);
      if (used + tokens > args.tokenBudget && used > 0) {
        hits.push({ ...hit, alreadyRead: false });
        blocks.push(`${formatHeader(hit)} (omitted: token budget ${args.tokenBudget})`);
        continue;
      }

      const numbered = numberLines(rawBody, span.startLine);
      const capped = truncateLikeRead(numbered);
      used += estimateTokens(capped.text);
      args.ledger.remember(span.path, span.startLine, span.endLine, span.contentHash);
      for (const original of requested) {
        if (original.path !== span.path) continue;
        if (original.startLine >= span.startLine && original.endLine <= span.endLine) {
          args.ledger.remember(original.path, original.startLine, original.endLine, original.contentHash);
        }
      }
      hits.push(hit);
      blocks.push(`${formatHeader(hit)}\n${capped.text}`);
    }

    return buildToolResult({
      projectRoot: args.projectRoot,
      kind: "code-retrieval.spans",
      hits,
      degraded: false,
      content: blocks.join("\n\n"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyDegraded("code-retrieval.spans", `read_spans failed: ${message}. Use the existing read tool.`);
  }
}

async function resolveRefs(args: ReadSpansArgs): Promise<ResolvedSpan[]> {
  const out: ResolvedSpan[] = [];
  for (const raw of args.refs) {
    const record = parseRef(raw, args.registry);
    if (!record) continue;
    const resolved = await hydrateSpan(record, args.projectRoot);
    if (resolved) out.push(resolved);
  }
  return out;
}

function parseRef(raw: string, registry: RefRegistry): SpanRecord | undefined {
  const known = registry.get(raw.trim());
  if (known) return known;
  const match = raw.trim().match(/^(.+):(\d+)-(\d+)$/);
  if (!match) return undefined;
  return {
    ref: raw.trim(),
    path: match[1]!,
    startLine: Number(match[2]),
    endLine: Number(match[3]),
  };
}

async function hydrateSpan(record: SpanRecord, projectRoot: string): Promise<ResolvedSpan | undefined> {
  let startLine = record.startLine;
  let endLine = record.endLine;
  if (record.symbol) {
    try {
      const body = await getSymbolLayer().resolveSymbolBody?.({
        path: record.path,
        symbol: record.symbol,
        projectRoot,
      });
      if (body) {
        startLine = body.startLine;
        endLine = body.endLine;
      }
    } catch {
      // keep stored range
    }
  }
  const abs = resolveProjectFile(projectRoot, record.path);
  if (!abs) return undefined;
  let fileText: string;
  try {
    fileText = await readFile(abs, "utf8");
  } catch {
    return undefined;
  }
  const body = extractSpanText(fileText, startLine, endLine);
  const contentHash = hashContent(body);
  return {
    ...record,
    startLine,
    endLine,
    body,
    contentHash,
    alreadyRead: false,
  };
}

function resolveProjectFile(projectRoot: string, rawPath: string): string | undefined {
  const abs = isAbsolute(rawPath) ? rawPath : resolve(projectRoot, rawPath);
  const rel = relative(projectRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return abs;
}

function formatHeader(hit: RetrievalHit): string {
  const symbol = hit.symbol ? ` ${hit.symbol}()` : "";
  return `${hit.ref} ${hit.path}:${hit.startLine}-${hit.endLine}${symbol}`;
}

function numberLines(text: string, startLine: number): string {
  const lines = text.split("\n");
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width, " ")}| ${line}`)
    .join("\n");
}

function truncateLikeRead(text: string): { text: string; truncated: boolean } {
  const result = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!result.truncated) return { text: result.content, truncated: false };
  const note = result.firstLineExceedsLimit
    ? "The requested line range exceeds the read cap (2000 lines or 50KB).\nTry a smaller range, or use the grep tool to search for specific content."
    : `File content exceeds the read cap (2000 lines or 50KB).\nShowing ${result.outputLines} of ${result.totalLines} lines (${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}).`;
  return { text: `${result.content}\n\n${note}`, truncated: true };
}
