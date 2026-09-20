import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { getSymbolLayer, normalizeCodeNavResult, type CodeNavFn } from "./hooks.js";
import { resolveProjectFile } from "./read-spans.js";
import { filterScopedHits, type SearchScope } from "./search-scope.js";
import { applyOptionalRerank, isProtectedHit, probeOptionalReranker, throwIfCancelled, type Reranker, type RerankerDetails } from "./reranker.js";
import { extractSymbols } from "./symbol/extract.js";
import { initTreeSitter, isTreeSitterReady, langFromPath } from "./symbol/treesitter.js";
import type { SymbolInfo } from "./symbol/types.js";
import type { UnassignedHit } from "./types.js";

export type EvidenceLink = { from: string; to: string; kind: "import" | "link" | "callers" | "callees" };
export type DeepSearchDetails = {
  expanded: number; filesRead: number; bytesRead: number; navigationCalls: number; links: EvidenceLink[];
  stopReason: "frontier-exhausted" | "budget" | "deadline";
  incomplete: boolean; notes: string[];
};
export const DEEP_LIMITS = { seeds: 3, candidates: 36, expansions: 6, navigationCalls: 12, files: 10, fileBytes: 256 * 1024, bytes: 512 * 1024, depth: 2, localMs: 1500 } as const;
type Source = { lines: string[]; symbols: SymbolInfo[] };
export type DeepSearchArgs = SearchScope & {
  query: string; projectRoot: string; hits: UnassignedHit[]; limit: number; signal?: AbortSignal;
  reranker?: Reranker; isRerankerCurrent?: () => boolean;
  /** Existing name-based graph hook; a bounded wait does not cancel its internal indexing. */
  navigate?: CodeNavFn;
};
export const evidenceKey = (hit: UnassignedHit): string => `${hit.path}:${hit.startLine}-${hit.endLine}`;

async function until<T>(work: () => Promise<T>, signal: AbortSignal, check: () => void): Promise<T> {
  check();
  let rejectAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([work(), new Promise<never>((_, reject) => {
      rejectAbort = () => reject(signal.reason);
      signal.addEventListener("abort", rejectAbort, { once: true });
      if (signal.aborted) rejectAbort();
    })]);
    check();
    return result;
  } finally { if (rejectAbort) signal.removeEventListener("abort", rejectAbort); }
}

/** A single bounded collection phase. Never assigns refs, marks the seen ledger, or applies score thresholds. */
export async function expandDeepSearch(args: DeepSearchArgs): Promise<{ hits: UnassignedHit[]; details: DeepSearchDetails; reranker?: RerankerDetails }> {
  const details: DeepSearchDetails = { expanded: 0, filesRead: 0, bytesRead: 0, navigationCalls: 0, links: [], stopReason: "frontier-exhausted", incomplete: false, notes: [] };
  const note = (text: string) => { details.incomplete = true; if (!details.notes.includes(text)) details.notes.push(text); };
  const limited = () => { details.stopReason = "budget"; note("Deep collection reached a work or output budget; remaining relations were not examined."); };
  throwIfCancelled(args.signal);
  const scopeDeadline = AbortSignal.timeout(DEEP_LIMITS.localMs);
  const scopeSignal = args.signal ? AbortSignal.any([args.signal, scopeDeadline]) : scopeDeadline;
  let local: UnassignedHit[];
  try {
    local = await until(() => filterScopedHits(args.hits, { ...args, signal: scopeSignal }), scopeSignal, () => scopeSignal.throwIfAborted());
  } catch (error) {
    throwIfCancelled(args.signal);
    if (!scopeDeadline.aborted) throw error;
    details.stopReason = "deadline";
    note("Scope validation exceeded its deadline; no unchecked paths were returned.");
    return { hits: [], details };
  }
  local = local.filter(h => Number.isInteger(h.startLine) && Number.isInteger(h.endLine) && h.startLine > 0 && h.endLine >= h.startLine);
  // Multiple spans in one file are not by themselves a reason for another cloud call.
  const choices = local.filter((h, i) => local.findIndex(other => other.path === h.path) === i).slice(0, 12);
  const protectedHits = local.filter(h => isProtectedHit(args.query, h));
  let seeds = protectedHits.length ? protectedHits.slice(0, DEEP_LIMITS.seeds) : choices.slice(0, DEEP_LIMITS.seeds);
  let reranker: RerankerDetails | undefined;
  if (!protectedHits.length && choices.length > DEEP_LIMITS.seeds && args.reranker) {
    const probe = await probeOptionalReranker(args.reranker, args.projectRoot, args.signal);
    reranker = probe.details;
    if (probe.ready) {
      const ranked = await applyOptionalRerank({ ...args, hits: choices, timeoutMs: probe.remainingMs });
      reranker = ranked.details;
      if (reranker) reranker.elapsedMs += probe.elapsedMs;
      seeds = ranked.hits.slice(0, DEEP_LIMITS.seeds);
    }
  }
  throwIfCancelled(args.signal);
  if (choices.length > seeds.length || protectedHits.length > seeds.length) limited();
  const timeout = new AbortController();
  const expiresAt = Date.now() + DEEP_LIMITS.localMs;
  const timer = setTimeout(() => timeout.abort(new Error("deep-search-deadline")), DEEP_LIMITS.localMs);
  const signal = args.signal ? AbortSignal.any([args.signal, timeout.signal]) : timeout.signal;
  const check = () => {
    // Synchronous graph parsing can delay timers; never start another operation after it overruns.
    if (Date.now() >= expiresAt && !timeout.signal.aborted) timeout.abort(new Error("deep-search-deadline"));
    signal.throwIfAborted();
  };
  const cache = new Map<string, Source | null>();
  const discovered = new Map<string, UnassignedHit>();
  const hydrated = new Map<string, UnassignedHit>();
  const queue = seeds.map(hit => ({ hit, depth: 0 }));
  const expanded = new Set<string>();
  const links = new Set<string>();
  const navigate = args.navigate ?? getSymbolLayer().codeNav;

  const scoped = (hits: UnassignedHit[]) => until(() => filterScopedHits(hits, { ...args, signal }), signal, check);
  const nav = async (operation: "callers" | "callees" | "definition", hit: UnassignedHit) => {
    if (details.navigationCalls >= DEEP_LIMITS.navigationCalls) { limited(); return undefined; }
    details.navigationCalls++;
    const result = normalizeCodeNavResult(await until(() => navigate!({ operation, symbol: hit.symbol, path: hit.path, line: hit.startLine, projectRoot: args.projectRoot }), signal, check));
    if (result.incomplete || result.degraded || result.unsupported || (operation === "definition" && result.hits.length > 1)) note("Symbol relations are name-based or incomplete; verify the returned evidence.");
    return result;
  };
  const load = async (path: string): Promise<Source | undefined> => {
    check();
    if (cache.has(path)) return cache.get(path) ?? undefined;
    if (details.filesRead >= DEEP_LIMITS.files) { limited(); return undefined; }
    cache.set(path, null);
    const allowed = await scoped([{ path, startLine: 1, endLine: 1 }]);
    if (!allowed.length) return undefined;
    const abs = await until(() => resolveProjectFile(args.projectRoot, path), signal, check);
    if (!abs) return undefined;
    try {
      const info = await until(() => stat(abs), signal, check);
      if (!info.isFile()) return undefined;
      if (info.size > DEEP_LIMITS.fileBytes || details.bytesRead + info.size > DEEP_LIMITS.bytes) { limited(); return undefined; }
      check();
      const text = await until(() => readFile(abs, { encoding: "utf8", signal }), signal, check);
      const size = Buffer.byteLength(text);
      details.filesRead++; details.bytesRead += size;
      if (size > DEEP_LIMITS.fileBytes || details.bytesRead > DEEP_LIMITS.bytes || text.includes("\0")) { limited(); return undefined; }
      const lang = langFromPath(path);
      const source = { lines: text.split(/\r?\n/), symbols: lang && isTreeSitterReady() ? extractSymbols(path, text, lang) : [] };
      cache.set(path, source);
      return source;
    } catch (error) { signal.throwIfAborted(); note("A related file could not be read; retained the original local evidence."); return undefined; }
  };
  const hydrate = async (raw: UnassignedHit): Promise<UnassignedHit | undefined> => {
    if (!Number.isInteger(raw.startLine) || !Number.isInteger(raw.endLine) || raw.startLine < 1 || raw.endLine < raw.startLine) return undefined;
    const valid = await scoped([raw]);
    const hit = valid[0];
    if (!hit) return undefined;
    const source = await load(hit.path);
    if (!source || hit.startLine > source.lines.length) return undefined;
    const current = { ...hit, endLine: Math.min(hit.endLine, source.lines.length), text: source.lines.slice(hit.startLine - 1, Math.min(hit.endLine, source.lines.length)).join("\n") };
    hydrated.set(evidenceKey(raw), current);
    return current;
  };
  const attach = (from: UnassignedHit, to: UnassignedHit, kind: EvidenceLink["kind"], depth: number) => {
    const a = evidenceKey(from), b = evidenceKey(to);
    if (a === b) return;
    if (!discovered.has(b) && discovered.size >= DEEP_LIMITS.candidates) { limited(); return; }
    discovered.set(a, from); discovered.set(b, to);
    const key = `${a}|${kind}|${b}`;
    if (!links.has(key)) { links.add(key); details.links.push({ from: a, to: b, kind }); }
    if (depth < DEEP_LIMITS.depth && !expanded.has(b)) queue.push({ hit: to, depth: depth + 1 });
    else if (depth >= DEEP_LIMITS.depth) { limited(); }
  };
  const follow = async (from: UnassignedHit, specifier: string, kind: "import" | "link", signature: string, depth: number) => {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return;
    const base = relative(args.projectRoot, resolve(args.projectRoot, dirname(from.path), specifier)).replace(/\\/g, "/");
    const extension = extname(base);
    const possibilities = [base, ...(/\.[cm]?js$/.test(base) ? [base.replace(/\.[cm]?js$/, ".ts"), base.replace(/\.[cm]?js$/, ".tsx")] : []),
      ...(!extension ? [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"].map(suffix => base + suffix) : [])];
    for (const path of possibilities) {
      check();
      const allowed = await scoped([{ path, startLine: 1, endLine: 1 }]);
      if (!allowed.length) continue;
      const source = await load(allowed[0]!.path);
      if (!source) continue;
      const definitions = source.symbols.filter(s => s.kind !== "call" && s.kind !== "import");
      const identifiers = new Set(signature.match(/[A-Za-z_$][\w$]*/g) ?? []);
      const named = definitions.filter(s => identifiers.has(s.name));
      const candidates = named.length ? named : definitions;
      if (candidates.length > 3) { limited(); note("Import definition candidates were truncated to three per module."); }
      const targets: UnassignedHit[] = candidates.slice(0, 3).map(s => ({ path: allowed[0]!.path, startLine: s.startLine, endLine: s.endLine, symbol: s.name }));
      if (!targets.length) targets.push({ path: allowed[0]!.path, startLine: 1, endLine: Math.min(60, source.lines.length) });
      for (const target of targets) { const hit = await hydrate(target); if (hit) attach(from, hit, kind, depth); }
      return;
    }
  };

  try {
    await until(initTreeSitter, signal, check);
    if (!isTreeSitterReady()) note("Tree-sitter unavailable; import discovery is partial.");
    while (queue.length && details.expanded < DEEP_LIMITS.expansions) {
      check();
      const current = queue.shift()!;
      if (expanded.has(evidenceKey(current.hit))) continue;
      expanded.add(evidenceKey(current.hit)); details.expanded++;
      const hit = await hydrate(current.hit);
      if (!hit) continue;
      discovered.set(evidenceKey(hit), hit);
      const source = cache.get(hit.path)!;
      if (current.depth >= DEEP_LIMITS.depth) { limited(); continue; }
      // Parsed imports, not regex over comments/strings. Only literal relative modules are followed.
      const imports = source.symbols.filter(s => s.kind === "import" && /^["']?\.\.?\//.test(s.name));
      if (imports.length > 8) { limited(); note("Relative import candidates were truncated to eight per file."); }
      for (const imported of imports.slice(0, 8)) {
        const specifier = imported.name.replace(/^["']|["']$/g, "");
        await follow(hit, specifier, "import", imported.signature ?? "", current.depth);
      }
      if (/\.mdx?$/.test(hit.path)) for (const link of hit.text?.matchAll(/\]\((\.\.?\/[^\s)#]+)(?:#[^\s)]*)?\)/g) ?? []) {
        await follow(hit, link[1]!, "link", "", current.depth);
      }
      if (navigate) for (const operation of ["callers", "callees"] as const) {
        try {
          const result = await nav(operation, hit);
          if (!result) break;
          if (result.hits.length > 6) limited();
          for (const raw of result.hits.slice(0, 6)) {
            if (operation === "callees" && !(await scoped([raw])).length) continue;
            // Callees are call sites, not definitions, and may share the caller's line range.
            // Resolve the symbol before display-range deduplication can swallow a same-line call.
            const definitions = operation === "callees" && raw.symbol ? await nav("definition", raw) : undefined;
            if (operation === "callees" && !definitions?.hits.length) note("A callee definition was unavailable; its call site is not proof of the implementation.");
            const targets = operation === "callees" ? definitions?.hits ?? [] : [raw];
            if (targets.length > 3) limited();
            for (const target of targets.slice(0, 3)) { const related = await hydrate(target); if (related) attach(hit, related, operation, current.depth); }
          }
        } catch { signal.throwIfAborted(); note("Symbol navigation failed; retained local/import evidence."); }
      } else note("Symbol graph unavailable; followed supported relative imports/links only.");
    }
    if (queue.length) limited();
  } catch {
    throwIfCancelled(args.signal);
    if (timeout.signal.aborted) { details.stopReason = "deadline"; note("Deep search deadline reached; stopped waiting for symbol navigation (its existing hook has no cancellation contract)."); }
    else note("Deep expansion unavailable; retained local evidence.");
  } finally { clearTimeout(timer); }
  throwIfCancelled(args.signal);
  // Group discovered relations with their anchor; never rerank/filter these links by a score threshold.
  const ordered: UnassignedHit[] = [];
  const selected = new Set<string>();
  const append = (hit: UnassignedHit) => { const key = evidenceKey(hit); if (!selected.has(key)) { selected.add(key); ordered.push(hit); } };
  for (const hit of protectedHits) append(hydrated.get(evidenceKey(hit)) ?? hit);
  for (const seed of seeds) {
    const current = hydrated.get(evidenceKey(seed)) ?? seed;
    append(current);
    const pending = [evidenceKey(current)], visited = new Set<string>();
    while (pending.length) {
      const from = pending.shift()!;
      if (visited.has(from)) continue;
      visited.add(from);
      for (const edge of details.links.filter(edge => edge.from === from)) {
        const hit = discovered.get(edge.to);
        if (hit) { append(hit); pending.push(edge.to); }
      }
    }
  }
  for (const hit of local) append(hydrated.get(evidenceKey(hit)) ?? hit);
  // An enclosing index span and a parsed body must not spend two output slots on the same source.
  const covers = (a: UnassignedHit, b: UnassignedHit) => a.path === b.path && a.startLine <= b.startLine && a.endLine >= b.endLine;
  let compact: UnassignedHit[] = [];
  for (const hit of ordered) {
    if (compact.some(existing => covers(existing, hit))) continue;
    const first = compact.findIndex(existing => covers(hit, existing));
    compact = compact.filter(existing => !covers(hit, existing));
    if (first < 0) compact.push(hit); else compact.splice(first, 0, hit);
  }
  const canonical = (key: string) => { const original = discovered.get(key); return original ? compact.find(hit => covers(hit, original)) : undefined; };
  const seenLinks = new Set<string>();
  details.links = details.links.flatMap(link => {
    const from = canonical(link.from), to = canonical(link.to);
    if (!from || !to || evidenceKey(from) === evidenceKey(to)) return [];
    const edge = { ...link, from: evidenceKey(from), to: evidenceKey(to) };
    const key = `${edge.from}|${edge.kind}|${edge.to}`;
    if (seenLinks.has(key)) return [];
    seenLinks.add(key);
    return [edge];
  });
  const hits = compact.slice(0, args.limit);
  const returned = new Set(hits.map(evidenceKey));
  if (details.links.some(link => !returned.has(link.from) || !returned.has(link.to))) limited();
  details.links = details.links.filter(link => returned.has(link.from) && returned.has(link.to));
  return { hits, details, ...(reranker ? { reranker } : {}) };
}
