/**
 * Name-based call graph (spec D4 / D6, stage 3).
 *
 * Edges are caller → callee at a call site. Resolution is symbol name +
 * definition location — not a type system. Same-named defs return every
 * name-matching candidate and set `incomplete`.
 *
 * The assembled graph is not persisted. Per-file call sites live in the
 * content-hash symbol cache; a query rebuilds the cross-file index from
 * the current cached union. A dirty file re-parses only itself; incoming
 * and outgoing edges update because the definition index is rebuilt.
 */

import { findDefinition } from "./extract.js";
import {
  lastNameSegment,
  type CodeNavHit,
  type SymbolInfo,
} from "./types.js";

const DEFAULT_LIMIT = 80;

/** Builtins / type-constructor noise — not underscore-prefixed project helpers. */
const NOISE = new Set([
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
  "panic",
  "todo",
  "unreachable",
  "assert",
  "assert_eq",
  "assert_ne",
]);

export interface CallGraphQuery {
  name: string;
  path?: string;
  line?: number;
  limit?: number;
}

export interface CallGraphLookup {
  hits: CodeNavHit[];
  incomplete: boolean;
  reason?: string;
}

export interface CallEdgeRecord {
  caller?: string;
  callee: string;
  path: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  lang: SymbolInfo["lang"];
}

export interface CallGraph {
  edges: CallEdgeRecord[];
  defsByName: Map<string, SymbolInfo[]>;
}

function isNoiseCallee(name: string): boolean {
  return NOISE.has(name) || name.length <= 1;
}

function qualifiedName(s: SymbolInfo): string {
  return s.container ? `${s.container}.${s.name}` : s.name;
}

function pathMatches(symbolPath: string, want?: string): boolean {
  if (!want) return true;
  return symbolPath === want || symbolPath.endsWith(want);
}

function callNameMatches(call: SymbolInfo, query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (call.name === q) return true;
  const tail = lastNameSegment(q);
  return call.name === tail;
}

function callerMatchesDef(caller: string, def: SymbolInfo): boolean {
  if (caller === def.name) return true;
  if (caller === qualifiedName(def)) return true;
  if (def.container && (caller === `${def.container}::${def.name}` || caller === `${def.container}.${def.name}`)) {
    return true;
  }
  return lastNameSegment(caller) === def.name;
}

function callInsideDef(call: SymbolInfo, def: SymbolInfo): boolean {
  if (call.path !== def.path) return false;
  return call.startLine >= def.startLine && call.endLine <= def.endLine;
}

function toCallHit(call: SymbolInfo, symbol: string, signature: string): CodeNavHit {
  return {
    path: call.path,
    startLine: call.startLine,
    endLine: call.endLine,
    symbol,
    kind: "call",
    signature,
  };
}

function indexDefs(symbols: SymbolInfo[]): Map<string, SymbolInfo[]> {
  const map = new Map<string, SymbolInfo[]>();
  const add = (key: string, s: SymbolInfo) => {
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  };
  for (const s of symbols) {
    if (s.kind === "call" || s.kind === "import") continue;
    add(s.name, s);
    if (s.container) {
      add(`${s.container}.${s.name}`, s);
      add(`${s.container}::${s.name}`, s);
    }
  }
  return map;
}

/** Build the in-memory call-edge list from extracted symbols (query-time). */
export function buildCallGraph(symbols: SymbolInfo[]): CallGraph {
  const defsByName = indexDefs(symbols);
  const edges: CallEdgeRecord[] = [];
  for (const s of symbols) {
    if (s.kind !== "call") continue;
    edges.push({
      caller: s.caller,
      callee: s.name,
      path: s.path,
      startLine: s.startLine,
      endLine: s.endLine,
      startColumn: s.startColumn,
      endColumn: s.endColumn,
      lang: s.lang,
    });
  }
  return { edges, defsByName };
}

function resolveTargetDefs(query: CallGraphQuery, symbols: SymbolInfo[]): SymbolInfo[] {
  const name = query.name.trim();
  if (!name) return [];
  if (query.path && query.line !== undefined) {
    const here = symbols.filter((s) => {
      if (s.kind === "call" || s.kind === "import") return false;
      if (!pathMatches(s.path, query.path)) return false;
      if (s.startLine > query.line! || s.endLine < query.line!) return false;
      return s.name === name || s.name === lastNameSegment(name) || qualifiedName(s) === name;
    });
    here.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine));
    if (here[0]) return [here[0]];
  }
  const opts = query.path ? { path: query.path } : {};
  const hits = findDefinition(name, symbols, opts);
  if (hits.length) return hits;
  return findDefinition(name, symbols);
}

function annotateCallee(call: SymbolInfo, defsByName: Map<string, SymbolInfo[]>): { signature: string; ambiguous: boolean } {
  const caller = call.caller || "<module>";
  const defs = defsByName.get(call.name) ?? [];
  if (defs.length === 1) {
    const d = defs[0]!;
    return { signature: `${caller} -> ${call.name}  @ ${d.path}:${d.startLine}`, ambiguous: false };
  }
  if (defs.length > 1) {
    return { signature: `${caller} -> ${call.name}  [ambiguous: ${defs.length} defs]`, ambiguous: true };
  }
  return { signature: `${caller} -> ${call.name}`, ambiguous: false };
}

/**
 * Who calls `name`? Hits are call sites; `symbol` is the enclosing caller.
 * Multiple same-named definitions → all name-matching sites, `incomplete`.
 */
export function findCallers(query: CallGraphQuery, symbols: SymbolInfo[]): CallGraphLookup {
  const name = query.name.trim();
  const limit = query.limit ?? DEFAULT_LIMIT;
  if (!name) return { hits: [], incomplete: false, reason: "symbol name required" };

  const defs = resolveTargetDefs(query, symbols);
  const calls = symbols.filter((s) => s.kind === "call" && callNameMatches(s, name));
  calls.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

  const hits: CodeNavHit[] = [];
  for (const call of calls) {
    if (hits.length >= limit) break;
    const caller = call.caller || "<module>";
    const extra = defs.length > 1 ? `  [ambiguous: ${defs.length} defs]` : "";
    hits.push(toCallHit(call, caller, `${caller} -> ${call.name}${extra}`));
  }

  if (!hits.length) {
    return { hits: [], incomplete: false, reason: `no callers for ${name}` };
  }

  const incomplete = defs.length > 1;
  return {
    hits,
    incomplete,
    reason: incomplete
      ? `name-based call graph; tree-sitter is not a type system (D4). ${defs.length} same-named definitions; all name-matching call sites returned.`
      : undefined,
  };
}

/**
 * What does `name` call? Hits are outgoing call sites inside the resolved
 * function(s). Builtin noise is dropped; project helpers (including `_foo`) stay.
 */
export function findCallees(query: CallGraphQuery, symbols: SymbolInfo[]): CallGraphLookup {
  const name = query.name.trim();
  const limit = query.limit ?? DEFAULT_LIMIT;
  if (!name) return { hits: [], incomplete: false, reason: "symbol name required" };

  const defs = resolveTargetDefs(query, symbols);
  const defsByName = indexDefs(symbols);
  const targets = defs.length ? defs : [];

  const calls = symbols.filter((s) => {
    if (s.kind !== "call") return false;
    if (isNoiseCallee(s.name)) return false;
    if (targets.length) {
      return targets.some((def) => {
        if (s.caller) return callerMatchesDef(s.caller, def);
        return callInsideDef(s, def);
      });
    }
    // No definition: still answer from caller-name match (honest, incomplete).
    if (!s.caller) return false;
    return s.caller === name || lastNameSegment(s.caller) === lastNameSegment(name);
  });
  calls.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine);

  const hits: CodeNavHit[] = [];
  let ambiguous = targets.length > 1;
  for (const call of calls) {
    if (hits.length >= limit) break;
    const ann = annotateCallee(call, defsByName);
    if (ann.ambiguous) ambiguous = true;
    hits.push(toCallHit(call, call.name, ann.signature));
  }

  if (!hits.length) {
    return { hits: [], incomplete: false, reason: `no callees for ${name}` };
  }

  return {
    hits,
    incomplete: ambiguous,
    reason: ambiguous
      ? `name-based call graph; tree-sitter is not a type system (D4). Same-named symbols are not overload-resolved; multiple candidates kept.`
      : undefined,
  };
}
