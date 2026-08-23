import { exactSearch } from "./grep-exact.js";
import { getSymbolLayer } from "./hooks.js";
import { buildToolResult, emptyDegraded, formatCompressedContent, type RefRegistry } from "./protocol.js";
import { routeQuery, type SearchMode } from "./route.js";
import { sidecarSearch } from "./sidecar-lifecycle.js";
import type { RetrievalHit, SidecarConnection, ToolResult, UnassignedHit } from "./types.js";

export type CodeSearchArgs = {
  query: string;
  mode?: SearchMode;
  path?: string;
  glob?: string;
  topK?: number;
  projectRoot: string;
  registry: RefRegistry;
  excludeGlobs: string[];
  sidecar: SidecarConnection | undefined;
  signal?: AbortSignal;
};

export async function executeCodeSearch(args: CodeSearchArgs): Promise<ToolResult> {
  const query = args.query.trim();
  if (!query) {
    return emptyDegraded("code-retrieval.search", "code_search requires a non-empty query.");
  }

  try {
    const routed = routeQuery(query, args.mode);
    const notes: string[] = [];
    let degraded = false;
    let hits: UnassignedHit[] = [];

    if (routed === "semantic") {
      degraded = true;
      notes.push(
        "Semantic retrieval is phase 4 and is not enabled. Falling back to exact (rg) so the session stays usable (details.degraded=true).",
      );
    }

    if (routed === "symbol" || routed === "hybrid") {
      const symbolHits = await trySymbolSearch(args);
      if (symbolHits) {
        hits = mergeHits(hits, symbolHits);
      } else {
        degraded = true;
        notes.push(
          routed === "symbol"
            ? "Symbol index is not ready; used exact grep fallback (details.degraded=true)."
            : "Symbol layer unavailable; hybrid search used exact only (details.degraded=true).",
        );
      }
    }

    if (routed === "exact" || routed === "semantic" || routed === "hybrid" || hits.length === 0) {
      const exact = await runExact(args);
      hits = mergeHits(hits, exact.hits);
      if (exact.degraded) {
        degraded = true;
        notes.push(
          exact.reason ??
            "Sidecar unreachable; used grep fallback (details.degraded=true).",
        );
      }
    }

    if (hits.length === 0) {
      const message = [
        `No hits for ${JSON.stringify(query)} (mode ${routed}).`,
        ...notes,
        degraded ? "Not pretending this was a successful empty index result." : "",
      ]
        .filter(Boolean)
        .join("\n");
      return buildToolResult({
        projectRoot: args.projectRoot,
        kind: "code-retrieval.search",
        hits: [],
        degraded,
        content: message,
        query,
        degradeReason: notes[0],
      });
    }

    const assigned = args.registry.assignAll(hits);
    const resultHits: RetrievalHit[] = assigned.map((record, i) => ({
      ...record,
      ...(hits[i]?.text ? { text: hits[i]!.text } : {}),
    }));
    const content = [formatCompressedContent(resultHits), ...notes].filter(Boolean).join("\n");
    return buildToolResult({
      projectRoot: args.projectRoot,
      kind: "code-retrieval.search",
      hits: resultHits,
      degraded,
      content,
      query,
      degradeReason: notes[0],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const fallback = await exactSearch({
        query,
        projectRoot: args.projectRoot,
        path: args.path,
        glob: args.glob,
        topK: args.topK,
        excludeGlobs: args.excludeGlobs,
        signal: args.signal,
      });
      const assigned = args.registry.assignAll(fallback);
      return buildToolResult({
        projectRoot: args.projectRoot,
        kind: "code-retrieval.search",
        hits: assigned,
        degraded: true,
        content: [
          formatCompressedContent(assigned),
          `code_search recovered via grep after error: ${message} (details.degraded=true).`,
        ].join("\n"),
        query,
        degradeReason: message,
      });
    } catch {
      return emptyDegraded(
        "code-retrieval.search",
        `code_search failed (${message}). Use the existing grep / read tools.`,
      );
    }
  }
}

async function trySymbolSearch(args: CodeSearchArgs): Promise<UnassignedHit[] | undefined> {
  const fn = getSymbolLayer().searchSymbols;
  if (!fn) return undefined;
  try {
    const hits = await fn({
      query: args.query,
      path: args.path,
      glob: args.glob,
      topK: args.topK,
      projectRoot: args.projectRoot,
    });
    return Array.isArray(hits) ? hits : undefined;
  } catch {
    return undefined;
  }
}

async function runExact(
  args: CodeSearchArgs,
): Promise<{ hits: UnassignedHit[]; degraded: boolean; reason?: string }> {
  if (args.sidecar) {
    const remote = await sidecarSearch(args.sidecar, {
      query: args.query,
      path: args.path,
      glob: args.glob,
      topK: args.topK,
      excludeGlobs: args.excludeGlobs,
    });
    if (remote) {
      return {
        hits: coerceHits(remote.hits),
        degraded: remote.degraded,
      };
    }
    const local = await exactSearch({
      query: args.query,
      projectRoot: args.projectRoot,
      path: args.path,
      glob: args.glob,
      topK: args.topK,
      excludeGlobs: args.excludeGlobs,
      signal: args.signal,
    });
    return {
      hits: local,
      degraded: true,
      reason: "Sidecar was listed but did not answer; used grep fallback (details.degraded=true).",
    };
  }

  const local = await exactSearch({
    query: args.query,
    projectRoot: args.projectRoot,
    path: args.path,
    glob: args.glob,
    topK: args.topK,
    excludeGlobs: args.excludeGlobs,
    signal: args.signal,
  });
  return {
    hits: local,
    degraded: true,
    reason: "Index sidecar is not ready; used grep fallback (details.degraded=true).",
  };
}

function coerceHits(raw: unknown[]): UnassignedHit[] {
  const out: UnassignedHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.path !== "string") continue;
    const startLine = Number(rec.startLine);
    const endLine = Number(rec.endLine);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) continue;
    out.push({
      path: rec.path,
      startLine,
      endLine,
      ...(typeof rec.symbol === "string" ? { symbol: rec.symbol } : {}),
      ...(typeof rec.score === "number" ? { score: rec.score } : {}),
      ...(typeof rec.text === "string" ? { text: rec.text } : {}),
    });
  }
  return out;
}

function mergeHits(left: UnassignedHit[], right: UnassignedHit[]): UnassignedHit[] {
  const seen = new Set(left.map((h) => `${h.path}:${h.startLine}:${h.endLine}`));
  const out = left.slice();
  for (const hit of right) {
    const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}
