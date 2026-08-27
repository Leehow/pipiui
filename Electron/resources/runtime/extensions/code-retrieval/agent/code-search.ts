import { exactSearch } from "./grep-exact.js";
import { getSymbolLayer } from "./hooks.js";
import type { SeenRangeLedger } from "./ledger.js";
import { buildInlinePreviews } from "./previews.js";
import { buildToolResult, emptyDegraded, formatCompressedContent, type RefRegistry } from "./protocol.js";
import {
  extractLexicalTerms,
  isIdentifierLike,
  looksLikeOpenQuery,
  routeQuery,
  SEMANTIC_UNAVAILABLE_NOTE,
  type SearchMode,
} from "./route.js";
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
  /** Provider honesty: what was selected vs what actually serves indexed hits. */
  providerInfo?: { requested?: string; actual?: string };
  /** ext.code-retrieval.tokenBudget; caps inline previews under it. */
  tokenBudget?: number;
  /** Session seen-range ledger; inline previews mark their exact shown window. */
  ledger?: SeenRangeLedger;
};

const DEFAULT_TOP_K = 20;

export async function executeCodeSearch(args: CodeSearchArgs): Promise<ToolResult> {
  const query = args.query.trim();
  if (!query) {
    return emptyDegraded("code-retrieval.search", "code_search requires a non-empty query.");
  }

  try {
    const routed = routeQuery(query, args.mode);
    // Provider honesty: report the layer that ACTUALLY serves the returned
    // hits (sidecar identity or "rg" for the local path), never a stale
    // advertised one. A "tantivy" request that ends up on another layer must say so.
    const requestedProvider = args.providerInfo?.requested;
    // Set from whichever runExact batch produced hits first; local fallback always sets "rg".
    let servingProvider: string | undefined;
    const providerNote = () =>
      requestedProvider === "tantivy" &&
      servingProvider !== undefined &&
      servingProvider !== "tantivy"
        ? `Requested exact provider tantivy is not available; these results were served by ${servingProvider}.`
        : undefined;
    const notes: string[] = [];
    let degraded = false;
    let hits: UnassignedHit[] = [];
    const open = looksLikeOpenQuery(query) || routed === "semantic";
    const useLexicalFallback = routed === "hybrid" || routed === "semantic";

    if (open) {
      notes.push(
        "Ranked by weighted term match inside symbol spans, not by meaning (semantic retrieval is not enabled in this build): these hits are as good as the words you chose.",
      );
    }

    if (useLexicalFallback) {
      const terms = extractLexicalTerms(query);
      if (terms.length === 0) {
        degraded = true;
        notes.push(SEMANTIC_UNAVAILABLE_NOTE);
        return emptySearchResult(args, query, routed, notes, degraded);
      }
      const lexical = await runLexicalSymbol(args, terms);
      hits = lexical.hits;
      degraded = degraded || lexical.degraded;
      if (lexical.hits.length > 0 && lexical.provider && servingProvider === undefined) {
        servingProvider = lexical.provider;
      }
      for (const note of lexical.notes) {
        if (!notes.includes(note)) notes.push(note);
      }
    } else {
      if (routed === "symbol") {
        const symbolHits = await trySymbolSearch(args, [query]);
        if (symbolHits) {
          hits = mergeHits(hits, symbolHits);
        } else {
          degraded = true;
          notes.push("Symbol index is not ready; used exact grep fallback (details.degraded=true).");
        }
      }

      if (routed === "exact" || hits.length === 0) {
        const exact = await runExact(args, query);
        hits = mergeHits(hits, exact.hits);
        if (exact.hits.length > 0 && exact.provider && servingProvider === undefined) {
          servingProvider = exact.provider;
        }
        if (exact.degraded) {
          degraded = true;
          notes.push(
            exact.reason ??
              "Sidecar unreachable; used grep fallback (details.degraded=true).",
          );
        }
      }
    }

    if (hits.length === 0) {
      if (useLexicalFallback || open) {
        degraded = true;
        if (!notes.includes(SEMANTIC_UNAVAILABLE_NOTE)) notes.push(SEMANTIC_UNAVAILABLE_NOTE);
      }
      const message = [
        `No hits for ${JSON.stringify(query)} (mode ${routed}).`,
        ...notes,
        degraded
          ? "This is a real miss, not an empty index: none of those terms occur in indexed code. That is information about your vocabulary — re-running the same words through grep will miss too."
          : "",
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
        // No hits were served by any layer, so no serving-provider claim exists.
      });
    }

    const assigned = args.registry.assignAll(hits);
    const resultHits: RetrievalHit[] = assigned.map((record, i) => ({
      ...record,
      ...(hits[i]?.text ? { text: hits[i]!.text } : {}),
    }));
    const previews = await buildInlinePreviews(resultHits, {
      projectRoot: args.projectRoot,
      ledger: args.ledger,
      budgetTokens: args.tokenBudget,
    });
    const note = providerNote();
    const content = [
      formatCompressedContent(resultHits, previews.note, previews.previews),
      ...notes,
      ...(note ? [note] : []),
    ]
      .filter(Boolean)
      .join("\n");
    return buildToolResult({
      projectRoot: args.projectRoot,
      kind: "code-retrieval.search",
      hits: resultHits,
      degraded,
      content,
      query,
      degradeReason: notes[0],
      ...(servingProvider ? { provider: servingProvider } : {}),
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
      // Degraded rg/node paths carry the same previews: a fallback that only names
      // files would undo exactly the friction this feature removes.
      const previews = await buildInlinePreviews(assigned, {
        projectRoot: args.projectRoot,
        ledger: args.ledger,
        budgetTokens: args.tokenBudget,
      });
      return buildToolResult({
        projectRoot: args.projectRoot,
        kind: "code-retrieval.search",
        hits: assigned,
        degraded: true,
        content: [
          formatCompressedContent(assigned, previews.note, previews.previews),
          `code_search recovered via grep after error: ${message} (details.degraded=true).`,
        ].join("\n"),
        query,
        degradeReason: message,
        provider: "rg",
      });
    } catch {
      return emptyDegraded(
        "code-retrieval.search",
        `code_search failed (${message}). Use the existing grep / read tools.`,
      );
    }
  }
}

async function runLexicalSymbol(
  args: CodeSearchArgs,
  terms: string[],
): Promise<{ hits: UnassignedHit[]; notes: string[]; degraded: boolean; provider?: string }> {
  const notes: string[] = [];
  let degraded = false;
  const identTerms = terms.filter(isIdentifierLike);
  const symbolTerms = identTerms.length > 0 ? identTerms : terms.slice(0, 4);
  const perTermK = Math.max(1, Math.min((args.topK ?? DEFAULT_TOP_K) * 3, 100));
  const termArgs = { ...args, topK: perTermK };

  const symbolFn = getSymbolLayer().searchSymbols;
  const symbolBatches = symbolFn
    ? await Promise.all(
        symbolTerms.map(async (term) => ({
          term,
          hits: await trySymbolSearch(termArgs, [term]),
        })),
      )
    : [];
  if (!symbolFn) {
    degraded = true;
    notes.push("Symbol layer unavailable; hybrid search used exact only (details.degraded=true).");
  }

  const exactBatches = await Promise.all(
    terms.map(async (term) => ({
      term,
      result: await runExact(termArgs, literalQuery(term)),
    })),
  );

  const collected: UnassignedHit[] = [];
  const termHits = new Map<string, Set<string>>();

  const addHits = (batchHits: UnassignedHit[] | undefined, term: string) => {
    if (!batchHits) return;
    for (const hit of batchHits) {
      const key = hitKey(hit);
      let set = termHits.get(key);
      if (!set) {
        set = new Set();
        termHits.set(key, set);
        collected.push(hit);
      }
      set.add(term);
    }
  };

  for (const batch of symbolBatches) addHits(batch.hits ?? undefined, batch.term);
  let servingProvider: string | undefined;
  for (const batch of exactBatches) {
    if (batch.result.degraded) {
      degraded = true;
      if (batch.result.reason && !notes.includes(batch.result.reason)) {
        notes.push(batch.result.reason);
      }
    }
    if (batch.result.hits.length > 0 && batch.result.provider && servingProvider === undefined) {
      servingProvider = batch.result.provider;
    }
    addHits(batch.result.hits, batch.term);
  }

  const topK = Math.max(1, Math.min(args.topK ?? DEFAULT_TOP_K, 100));
  const identSet = new Set(identTerms);
  const pathTerms = new Map<string, Set<string>>();
  for (const [key, set] of termHits) {
    const path = key.slice(0, key.indexOf(":"));
    let bucket = pathTerms.get(path);
    if (!bucket) {
      bucket = new Set();
      pathTerms.set(path, bucket);
    }
    for (const term of set) bucket.add(term);
  }
  const ranked = collected
    .map((hit) => ({
      ...hit,
      score: scoreHit(hit, termHits.get(hitKey(hit)) ?? new Set(), identSet, pathTerms.get(hit.path) ?? new Set()),
    }))
    .sort((a, b) => {
      const fileA = pathTerms.get(a.path)?.size ?? 0;
      const fileB = pathTerms.get(b.path)?.size ?? 0;
      return (
        fileB - fileA ||
        (b.score ?? 0) - (a.score ?? 0) ||
        a.path.localeCompare(b.path) ||
        a.startLine - b.startLine
      );
    })
    .slice(0, topK);

  notes.push(`Used lexical+symbol fallback (terms: ${terms.join(", ")}).`);
  return { hits: ranked, notes, degraded, ...(servingProvider ? { provider: servingProvider } : {}) };
}

function scoreHit(
  hit: UnassignedHit,
  terms: Set<string>,
  identTerms: Set<string>,
  fileTerms: Set<string>,
): number {
  let score = 0;
  for (const term of fileTerms) {
    score += identTerms.has(term) || isIdentifierLike(term) ? 2 : 0.5;
  }
  for (const term of terms) {
    score += identTerms.has(term) || isIdentifierLike(term) ? 3 : 1;
    if (hit.symbol && (hit.symbol === term || hit.symbol.includes(term))) score += 2;
  }
  if (hit.symbol) score += 0.5;
  return score;
}

function hitKey(hit: UnassignedHit): string {
  return `${hit.path}:${hit.startLine}:${hit.endLine}`;
}

function literalQuery(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function trySymbolSearch(args: CodeSearchArgs, queries: string[]): Promise<UnassignedHit[] | undefined> {
  const fn = getSymbolLayer().searchSymbols;
  if (!fn) return undefined;
  const merged: UnassignedHit[] = [];
  let any = false;
  for (const query of queries) {
    try {
      const hits = await fn({
        query,
        path: args.path,
        glob: args.glob,
        topK: args.topK,
        projectRoot: args.projectRoot,
      });
      if (!Array.isArray(hits)) continue;
      any = true;
      for (const hit of hits) merged.push(hit);
    } catch {
      // one term failing must not abort the rest
    }
  }
  return any ? mergeHits([], merged) : undefined;
}

export type ExactOutcome = {
  hits: UnassignedHit[];
  degraded: boolean;
  reason?: string;
  /**
   * Provider that actually served these hits: sidecar identity or "rg" for the
   * local path. Omitted when the serving sidecar's identity is unknown — it is
   * never inferred from the requested mode.
   */
  provider?: string;
};

async function runExact(args: CodeSearchArgs, query: string): Promise<ExactOutcome> {
  if (args.sidecar) {
    const remote = await sidecarSearch(args.sidecar, {
      query,
      path: args.path,
      glob: args.glob,
      topK: args.topK,
      excludeGlobs: args.excludeGlobs,
    });
    if (remote) {
      // Provider honesty: report only the identity the sidecar itself declares.
      // A legacy sidecar predating provider reporting stays UNKNOWN — never
      // inferred from the requested mode — and unverified identity degrades,
      // mirroring sidecarStatus's providerDegraded rule.
      const actual = args.sidecar.provider;
      const requested = args.providerInfo?.requested ?? args.sidecar.requestedProvider;
      if (actual === undefined) {
        return {
          hits: coerceHits(remote.hits),
          degraded: true,
          reason:
            args.sidecar.providerFallback?.reason ??
            `Running sidecar does not report a provider; identity unknown and not trusted as ${requested ?? "auto"}, so these hits carry no verified provider.`,
        };
      }
      // A known-identity sidecar serving an explicit different selection is a
      // real fallback (e.g. tantivy requested, rg sidecar spawned): say so AND
      // mark degraded, matching the manifest's 回退 rg 并标注降级 contract.
      const selectionMismatch =
        requested !== undefined && requested !== "auto" && requested !== actual;
      return {
        hits: coerceHits(remote.hits),
        degraded: remote.degraded || selectionMismatch,
        ...(selectionMismatch
          ? {
              reason:
                args.sidecar.providerFallback?.reason ??
                `Requested exact provider ${requested} is unavailable here; these results were served by ${actual}.`,
            }
          : {}),
        provider: actual,
      };
    }
    const local = await exactSearch({
      query,
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
      // The local rg path served the results: details.provider must name it
      // even when the listed sidecar advertised a different provider.
      provider: "rg",
      reason: "Sidecar was listed but did not answer; used local rg fallback (details.provider=rg, details.degraded=true).",
    };
  }

  const local = await exactSearch({
    query,
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
    provider: "rg",
    reason: "Index sidecar is not ready; used rg fallback (details.provider=rg, details.degraded=true).",
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

function emptySearchResult(
  args: CodeSearchArgs,
  query: string,
  routed: string,
  notes: string[],
  degraded: boolean,
): Promise<ToolResult> {
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
