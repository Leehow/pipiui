import { exactSearch } from "./grep-exact.js";
import { evidenceKey, expandDeepSearch } from "./deep-search.js";
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
import { searchSemantic } from "./zvec-semantic.js";
import { applyOptionalRerank, isProtectedHit, probeOptionalReranker, throwIfCancelled, type Reranker } from "./reranker.js";
import { filterScopedHits, relativeSearchPath } from "./search-scope.js";
import { fuseRecall, queryVariants as normalizeVariants, recallQueries, resultLimit, type RecallSource } from "./wide-recall.js";

export type CodeSearchArgs = {
  query: string;
  queryVariants?: string[];
  deep?: boolean;
  mode?: SearchMode;
  path?: string;
  glob?: string;
  topK?: number;
  /** Internal collection budget; never exposed as a tool parameter. */
  wideRecall?: boolean;
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
  /** Optional in-process optimizer; absent means the original local-only path. */
  reranker?: Reranker;
  isRerankerCurrent?: () => boolean;
};

const DEFAULT_TOP_K = 20;

type LocalSearch = { hits: UnassignedHit[]; notes: string[]; degraded: boolean; provider?: string; emptyMessage?: string; failed?: boolean };

/** One existing local route; collection never assigns refs, marks reads or persists results. */
async function collectLocalQuery(args: CodeSearchArgs): Promise<LocalSearch> {
  const query = args.query.trim();
  try {
    throwIfCancelled(args.signal);
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
    let semanticAvailable = false;

    if (useLexicalFallback) {
      const semantic = await searchSemantic({
        query,
        projectRoot: args.projectRoot,
        path: args.path,
        glob: args.glob,
        topK: args.topK,
        wideRecall: args.wideRecall,
        excludeGlobs: args.excludeGlobs,
        signal: args.signal,
      });
      semanticAvailable = semantic.available;
      if (semantic.hits.length > 0) {
        hits = semantic.hits;
        servingProvider = semantic.provider ?? "zvec";
        notes.push("Ranked by local zvec BM25 + vectors.");
      } else if (semantic.available) {
        notes.push("zvec semantic index had no hits above threshold; tried lexical+symbol fallback.");
      } else if (semantic.reason) {
        notes.push(`${SEMANTIC_UNAVAILABLE_NOTE} (${semantic.reason}).`);
      }
    }

    if (hits.length === 0 && useLexicalFallback) {
      if (open && !semanticAvailable) {
        notes.push(
          "Ranked by weighted term match inside symbol spans (zvec missed or is not in this process). A route note is not a failure: these hits are as good as the words you chose.",
        );
      }
      const terms = extractLexicalTerms(query);
      if (terms.length === 0) {
        if (!semanticAvailable) {
          degraded = true;
          if (!notes.includes(SEMANTIC_UNAVAILABLE_NOTE) && !notes.some((note) => note.startsWith(SEMANTIC_UNAVAILABLE_NOTE))) {
            notes.push(SEMANTIC_UNAVAILABLE_NOTE);
          }
        }
        return { hits: [], notes, degraded: degraded || !semanticAvailable,
          emptyMessage: [`No hits for ${JSON.stringify(query)} (mode ${routed}).`, ...notes,
            degraded ? "Not pretending this was a successful empty index result." : ""].filter(Boolean).join("\n") };
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
    } else if (hits.length === 0) {
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
      if (!semanticAvailable && (useLexicalFallback || open)) {
        degraded = true;
        if (!notes.some((note) => note.includes(SEMANTIC_UNAVAILABLE_NOTE))) {
          notes.push(SEMANTIC_UNAVAILABLE_NOTE);
        }
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
      return { hits: [], notes, degraded, emptyMessage: message };
    }

    const note = providerNote();
    if (note) notes.push(note);
    return { hits, notes, degraded, ...(servingProvider ? { provider: servingProvider } : {}) };
  } catch (error) {
    throwIfCancelled(args.signal);
    const message = error instanceof Error ? error.message : String(error);
    try {
      const hits = await exactSearch({ ...args, query });
      const recovered = `code_search recovered via grep after error: ${message} (details.degraded=true).`;
      return { hits, notes: [recovered], degraded: true, provider: "rg", emptyMessage: recovered };
    } catch {
      throwIfCancelled(args.signal);
      return { hits: [], notes: [], degraded: true, failed: true,
        emptyMessage: `code_search failed (${message}). Use the existing grep / read tools.` };
    }
  }
}

export async function executeCodeSearch(args: CodeSearchArgs): Promise<ToolResult> {
  const query = args.query.trim();
  if (!query) return emptyDegraded("code-retrieval.search", "code_search requires a non-empty query.");
  try {
    throwIfCancelled(args.signal);
    const variants = normalizeVariants(query, args.queryVariants);
    const routed = routeQuery(query, args.mode);
    const eligible = routed === "hybrid" || routed === "semantic";
    if (args.queryVariants?.length && !eligible) return emptyDegraded("code-retrieval.search", "queryVariants requires an open auto/semantic query, not an exact/symbol route.");
    if (args.deep && !eligible) return emptyDegraded("code-retrieval.search", "deep requires an open auto/semantic query, not an exact/symbol route.");
    if (args.path && relativeSearchPath(args.projectRoot, args.path) === undefined) {
      return emptyDegraded("code-retrieval.search", "code_search path must remain inside the current project.");
    }
    const probe = !args.deep && eligible && args.reranker
      ? await probeOptionalReranker(args.reranker, args.projectRoot, args.signal) : undefined;
    const wide = args.deep === true || variants.length > 0 || probe?.ready === true;
    const limit = resultLimit(args.topK);
    let local: LocalSearch;
    let sources: RecallSource[] | undefined;
    if (wide) {
      const poolLimit = Math.min(100, limit * 3);
      const batches = await recallQueries([query, ...variants], async (variant) => {
        const batch = await collectLocalQuery({ ...args, query: variant, topK: poolLimit, wideRecall: true });
        batch.hits = await filterScopedHits(batch.hits, args);
        return batch;
      }, args.signal);
      const fused = fuseRecall(batches, poolLimit, (hit) => isProtectedHit(query, hit));
      sources = fused.sources;
      const serving = batches.filter((batch) => batch.hits.length);
      const providers = new Set(serving.map((batch) => batch.provider));
      local = { hits: fused.hits, notes: [...new Set(batches.flatMap((batch) => batch.notes))],
        degraded: batches.some((batch) => batch.degraded),
        provider: providers.size === 1 ? serving[0]?.provider : undefined,
        emptyMessage: `No hits inside the requested scope after ${batches.length} local query(s).` };
      local.notes.push(`Broad recall: ${batches.length} local query(s), ${fused.hits.length} candidates; returning at most ${limit}.`);
      if (batches.some((batch) => batch.failed)) local.notes.push("A local query failed; retained the other query results.");
    } else {
      local = await collectLocalQuery({ ...args, query });
    }
    throwIfCancelled(args.signal);
    if (local.failed) return emptyDegraded("code-retrieval.search", local.emptyMessage!);
    const deep = args.deep ? await expandDeepSearch({ ...args, query, hits: local.hits, limit }) : undefined;
    const reranked = deep ? { hits: deep.hits, details: deep.reranker }
      : eligible && probe?.ready
        ? await applyOptionalRerank({ ...args, query, hits: local.hits, timeoutMs: probe.remainingMs })
        : { hits: local.hits, details: probe?.details };
    if (reranked.details && probe?.ready) reranked.details.elapsedMs += probe.elapsedMs;
    const hits = wide ? reranked.hits.slice(0, limit) : reranked.hits;
    throwIfCancelled(args.signal);
    const assigned = args.registry.assignAll(hits);
    const resultHits: RetrievalHit[] = assigned.map((record, i) => ({ ...record, ...(hits[i]?.text ? { text: hits[i]!.text } : {}) }));
    const previews = await buildInlinePreviews(resultHits, { projectRoot: args.projectRoot, ledger: args.ledger, budgetTokens: args.tokenBudget });
    const refsBySpan = new Map(assigned.map(hit => [evidenceKey(hit), hit.ref]));
    const relations = deep?.details.links.slice(0, 8).map(link => `${refsBySpan.get(link.from)} --${link.kind}--> ${refsBySpan.get(link.to)}`);
    const content = [
      hits.length ? formatCompressedContent(resultHits, previews.note, previews.previews) : local.emptyMessage,
      ...(hits.length || wide ? local.notes : []),
      ...(deep ? [`Deep search: ${deep.details.expanded} expansions, ${deep.details.filesRead} files, ${deep.details.links.length} retained relations; ${deep.details.stopReason}. Bounded evidence, not proof of completeness.`,
        ...(relations?.length ? [`Relations: ${relations.join("; ")}${deep.details.links.length > 8 ? "; more in results metadata" : ""}.`] : []), ...deep.details.notes] : []),
      ...(reranked.details ? [`Optional Jev reranker: ${reranked.details.status}${reranked.details.reason ? ` (${reranked.details.reason})` : ""}; local provider and score unchanged.`] : []),
    ].filter(Boolean).join("\n");
    return buildToolResult({ projectRoot: args.projectRoot, kind: "code-retrieval.search", hits: resultHits,
      degraded: local.degraded, content, query, degradeReason: local.notes[0],
      ...(local.provider && hits.length ? { provider: local.provider } : {}),
      ...(reranked.details ? { reranker: reranked.details } : {}), ...(sources ? { sources } : {}),
      ...(deep ? { deep: deep.details } : {}),
    });
  } catch (error) {
    throwIfCancelled(args.signal);
    return emptyDegraded("code-retrieval.search", `code_search failed (${error instanceof Error ? error.message : String(error)}). Use the existing grep / read tools.`);
  }
}

async function runLexicalSymbol(
  args: CodeSearchArgs,
  terms: string[],
): Promise<{ hits: UnassignedHit[]; notes: string[]; degraded: boolean; provider?: string }> {
  throwIfCancelled(args.signal);
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

  throwIfCancelled(args.signal);
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
    throwIfCancelled(args.signal);
    try {
      const hits = await fn({
        query,
        path: args.path,
        glob: args.glob,
        topK: args.topK,
        projectRoot: args.projectRoot,
      });
      throwIfCancelled(args.signal);
      if (!Array.isArray(hits)) continue;
      any = true;
      for (const hit of hits) merged.push(hit);
    } catch {
      throwIfCancelled(args.signal);
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
  throwIfCancelled(args.signal);
  if (args.sidecar) {
    const remote = await sidecarSearch(args.sidecar, {
      query,
      path: args.path,
      glob: args.glob,
      topK: args.topK,
      excludeGlobs: args.excludeGlobs,
      signal: args.signal,
    });
    throwIfCancelled(args.signal);
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
