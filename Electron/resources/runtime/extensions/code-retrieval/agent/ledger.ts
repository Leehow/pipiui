import { createHash } from "node:crypto";
import type { SeenRange } from "./types.js";

function keyOf(range: SeenRange): string {
  return `${range.path}\0${range.startLine}\0${range.endLine}\0${range.contentHash}`;
}

/** Session-scoped seen-range ledger (spec D5). Not shared across agents. */
export class SeenRangeLedger {
  private readonly seen = new Set<string>();

  has(range: SeenRange): boolean {
    return this.seen.has(keyOf(range));
  }

  add(range: SeenRange): void {
    this.seen.add(keyOf(range));
  }

  remember(path: string, startLine: number, endLine: number, contentHash: string): void {
    this.add({ path, startLine, endLine, contentHash });
  }

  size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export function extractSpanText(fileText: string, startLine: number, endLine: number): string {
  const lines = fileText.split("\n");
  const start = Math.max(1, startLine);
  const end = Math.max(start, endLine);
  return lines.slice(start - 1, end).join("\n");
}

export type MergeableSpan = {
  path: string;
  startLine: number;
  endLine: number;
};

/** Merge overlapping / adjacent spans on the same path. */
export function mergeAdjacentSpans<T extends MergeableSpan>(spans: T[]): T[] {
  if (spans.length <= 1) return spans.slice();
  const sorted = spans.slice().sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return a.endLine - b.endLine;
  });
  const out: T[] = [];
  for (const span of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.path === span.path && span.startLine <= prev.endLine + 1) {
      if (span.endLine > prev.endLine) prev.endLine = span.endLine;
      continue;
    }
    out.push({ ...span });
  }
  return out;
}
