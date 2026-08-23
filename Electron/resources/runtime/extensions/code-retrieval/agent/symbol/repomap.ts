/**
 * repo_map (D4 / D6): symbol extract + PageRank-like ranking.
 * Output is signatures / imports / call edges only — no function bodies.
 * Token budget defaults to ext.code-retrieval.tokenBudget (4000).
 */

import { extractProjectCached } from "./cache.js";
import { extractMany } from "./extract.js";
import { initTreeSitter, isTreeSitterReady, treeSitterInitError } from "./treesitter.js";
import {
  DEFAULT_TOKEN_BUDGET,
  estimateTokens,
  type MapEntry,
  type MapSymbol,
  type SourceFile,
  type SymbolInfo,
  type SymbolKind,
} from "./types.js";

const DAMPING = 0.85;
const RANK_ITERS = 20;

function pageRank(nodes: string[], edges: Array<[string, string]>): Map<string, number> {
  const n = nodes.length;
  const score = new Map<string, number>();
  if (n === 0) return score;
  const idx = new Map<string, number>();
  nodes.forEach((id, i) => idx.set(id, i));
  const outbound: number[][] = Array.from({ length: n }, () => []);
  for (const [from, to] of edges) {
    const a = idx.get(from);
    const b = idx.get(to);
    if (a === undefined || b === undefined || a === b) continue;
    outbound[a].push(b);
  }
  let rank = new Array<number>(n).fill(1 / n);
  for (let iter = 0; iter < RANK_ITERS; iter++) {
    const next = new Array<number>(n).fill((1 - DAMPING) / n);
    for (let i = 0; i < n; i++) {
      const outs = outbound[i];
      if (!outs.length) {
        const share = (DAMPING * rank[i]) / n;
        for (let j = 0; j < n; j++) next[j] += share;
        continue;
      }
      const share = (DAMPING * rank[i]) / outs.length;
      for (const j of outs) next[j] += share;
    }
    rank = next;
  }
  nodes.forEach((id, i) => score.set(id, rank[i]));
  return score;
}

function definitionIndex(symbols: SymbolInfo[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const s of symbols) {
    if (s.kind === "call" || s.kind === "import") continue;
    const keys = [s.name];
    if (s.container) keys.push(`${s.container}.${s.name}`);
    for (const key of keys) {
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(s.path);
    }
  }
  return map;
}

function buildEdges(symbols: SymbolInfo[]): Array<[string, string]> {
  const defs = definitionIndex(symbols);
  const edges: Array<[string, string]> = [];
  for (const s of symbols) {
    if (s.kind !== "call" && s.kind !== "import") continue;
    if (s.kind === "call" && isNoiseCall(s.name)) continue;
    const targets = defs.get(s.name);
    if (!targets) continue;
    for (const dest of targets) {
      if (dest !== s.path) edges.push([s.path, dest]);
    }
  }
  return edges;
}

const MAP_KINDS = new Set<SymbolKind>(["function", "class", "method", "interface", "module"]);
const MAX_IMPORTS_PER_FILE = 8;
const MAX_CALLS_PER_FILE = 10;
const MAX_SYMBOLS_PER_FILE = 20;
const SIGNATURE_CHARS = 100;
const KIND_RANK: Record<string, number> = {
  class: 0,
  interface: 1,
  module: 2,
  function: 3,
  method: 4,
};

const NOISE_CALLS = new Set([
  "object",
  "type",
  "super",
  "isinstance",
  "issubclass",
  "len",
  "str",
  "int",
  "bool",
  "dict",
  "list",
  "set",
  "tuple",
  "print",
  "range",
  "enumerate",
  "zip",
  "map",
  "filter",
  "sorted",
  "reversed",
  "iter",
  "next",
  "open",
  "getattr",
  "setattr",
  "hasattr",
  "callable",
  "repr",
  "format",
  "min",
  "max",
  "sum",
  "any",
  "all",
  "abs",
  "id",
  "hash",
  "hex",
  "bin",
  "oct",
  "ord",
  "chr",
  "bytes",
  "bytearray",
  "Exception",
  "ValueError",
  "TypeError",
  "KeyError",
  "RuntimeError",
  "NotImplementedError",
  "AttributeError",
  "ImportError",
  "OSError",
  "TypeVar",
  "Generic",
  "Protocol",
  "cast",
  "overload",
  "abstractmethod",
  "staticmethod",
  "classmethod",
  "property",
  "dataclass",
  "NamedTuple",
  "TypedDict",
  "Optional",
  "Union",
  "List",
  "Dict",
  "Set",
  "Tuple",
  "Callable",
  "ClassVar",
  "Final",
  "Literal",
  "Any",
  "Self",
  "t",
  "f",
  "fn",
  "func",
  "callback",
  "require",
  "console",
  "Error",
  "Promise",
  "Array",
  "Object",
  "String",
  "Number",
  "Boolean",
  "Map",
  "Set",
  "WeakMap",
  "Symbol",
  "undefined",
  "Some",
  "Ok",
  "Err",
  "unwrap",
  "expect",
  "into",
  "from",
  "clone",
  "default",
  "new",
  "ok",
  "err",
  "vec",
  "format",
]);

function isNoiseCall(name: string): boolean {
  return NOISE_CALLS.has(name) || name.startsWith("_") || name.length <= 1;
}

function renderEntry(
  path: string,
  fileSymbols: SymbolInfo[],
  fileScore: number,
): MapEntry {
  const imports: string[] = [];
  const calls: Array<{ from: string; to: string }> = [];
  const mapped: MapSymbol[] = [];
  const seenImport = new Set<string>();
  const seenCall = new Set<string>();

  for (const s of fileSymbols) {
    if (s.kind === "import") {
      const line = s.signature || s.name;
      if (!seenImport.has(line) && imports.length < MAX_IMPORTS_PER_FILE) {
        seenImport.add(line);
        imports.push(line);
      }
      continue;
    }
    if (s.kind === "call") {
      if (isNoiseCall(s.name)) continue;
      const from = s.container ? `${s.container}.${s.name}` : s.name;
      const key = `${from}->${s.name}`;
      if (!seenCall.has(key) && calls.length < MAX_CALLS_PER_FILE) {
        seenCall.add(key);
        calls.push({ from, to: s.name });
      }
      continue;
    }
    if (!MAP_KINDS.has(s.kind)) continue;
    const sig = (s.signature || s.name).slice(0, SIGNATURE_CHARS);
    mapped.push({
      name: s.name,
      kind: s.kind,
      signature: sig,
      startLine: s.startLine,
      endLine: s.endLine,
      score: fileScore,
      container: s.container,
    });
  }

  mapped.sort((a, b) => {
    const kr = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
    if (kr !== 0) return kr;
    return a.startLine - b.startLine;
  });
  return {
    path,
    symbols: mapped.slice(0, MAX_SYMBOLS_PER_FILE),
    imports,
    calls,
    score: fileScore,
  };
}

function entryCost(entry: MapEntry): number {
  const bits = [
    entry.path,
    ...entry.symbols.map((s) => s.signature),
    ...entry.imports,
    ...entry.calls.map((c) => `${c.from}->${c.to}`),
  ];
  return estimateTokens(bits.join("\n"));
}

/**
 * Rank extracted files and trim to tokenBudget.
 * Requires initTreeSitter(); empty if WASM is not ready.
 */
export function buildRepoMapFromSymbols(symbols: SymbolInfo[], tokenBudget = DEFAULT_TOKEN_BUDGET): MapEntry[] {
  if (!symbols.length) return [];

  const paths = [...new Set(symbols.map((s) => s.path))];
  const edges = buildEdges(symbols);
  const scores = pageRank(paths, edges);
  const byPath = new Map<string, SymbolInfo[]>();
  for (const s of symbols) {
    const list = byPath.get(s.path) ?? [];
    list.push(s);
    byPath.set(s.path, list);
  }

  const ranked = paths
    .map((path) => renderEntry(path, byPath.get(path) ?? [], scores.get(path) ?? 0))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const budget = Math.max(200, tokenBudget);
  const out: MapEntry[] = [];
  let used = 0;
  for (const entry of ranked) {
    if (!entry.symbols.length && !entry.imports.length && !entry.calls.length) continue;
    const cost = entryCost(entry);
    if (out.length > 0 && used + cost > budget) break;
    out.push(entry);
    used += cost;
  }
  return out;
}

export function buildRepoMap(files: SourceFile[], tokenBudget = DEFAULT_TOKEN_BUDGET): MapEntry[] {
  return buildRepoMapFromSymbols(extractMany(files), tokenBudget);
}

export interface RepoMapResult {
  entries: MapEntry[];
  tokenBudget: number;
  fileCount: number;
  symbolCount: number;
  degraded: boolean;
  reason?: string;
}

/** Project-root helper for the repo_map tool hook. Does not register the tool. */
export async function computeRepoMap(
  root: string,
  opts: { tokenBudget?: number; excludeGlobs?: string[] } = {},
): Promise<RepoMapResult> {
  await initTreeSitter();
  const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  if (!isTreeSitterReady()) {
    return {
      entries: [],
      tokenBudget,
      fileCount: 0,
      symbolCount: 0,
      degraded: true,
      reason: treeSitterInitError() ?? "tree-sitter not ready",
    };
  }
  const exclude = opts.excludeGlobs ?? ["tests", "test", "examples", "docs", "benchmarks"];
  const extracted = await extractProjectCached(root, { excludeGlobs: exclude });
  const entries = buildRepoMapFromSymbols(extracted.symbols, tokenBudget);
  const symbolCount = entries.reduce((n, e) => n + e.symbols.length, 0);
  return {
    entries,
    tokenBudget,
    fileCount: extracted.stats.files,
    symbolCount,
    degraded: entries.length === 0,
    reason: entries.length === 0 ? "no symbols extracted" : undefined,
  };
}

export function formatRepoMapText(entries: MapEntry[], maxLines = 200): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (lines.length >= maxLines) break;
    lines.push(`${entry.path}  score=${entry.score.toFixed(4)}`);
    for (const sym of entry.symbols) {
      if (lines.length >= maxLines) break;
      if (sym.kind === "import") continue;
      lines.push(`  ${sym.signature}`);
    }
    for (const imp of entry.imports.slice(0, 12)) {
      if (lines.length >= maxLines) break;
      lines.push(`  import ${imp}`);
    }
    for (const call of entry.calls.slice(0, 12)) {
      if (lines.length >= maxLines) break;
      lines.push(`  call ${call.from} -> ${call.to}`);
    }
  }
  return lines.join("\n");
}
