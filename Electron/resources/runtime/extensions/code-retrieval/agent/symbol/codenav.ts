/**
 * code_nav (D4 / D6).
 * definition / references / implementations / workspace_symbols use the symbol graph.
 * callers / callees use the name-based tree-sitter call graph (stage 3).
 * Miss → empty + degraded + fallbackExact (caller may exact-search).
 */

import { findCallees, findCallers } from "./callgraph.js";
import { extractProjectCached } from "./cache.js";
import { extractMany, findDefinition, findReferences } from "./extract.js";
import { initTreeSitter, isTreeSitterReady, treeSitterInitError } from "./treesitter.js";
import {
  lastNameSegment,
  type CodeNavHit,
  type CodeNavRequest,
  type CodeNavResult,
  type SourceFile,
  type SymbolInfo,
} from "./types.js";

function toHit(s: SymbolInfo): CodeNavHit {
  return {
    path: s.path,
    startLine: s.startLine,
    endLine: s.endLine,
    symbol: s.container ? `${s.container}.${s.name}` : s.name,
    kind: s.kind,
    signature: s.signature,
  };
}

function miss(operation: CodeNavRequest["operation"], reason: string): CodeNavResult {
  return {
    operation,
    hits: [],
    degraded: true,
    fallbackExact: true,
    reason,
  };
}

function ok(operation: CodeNavRequest["operation"], hits: CodeNavHit[], extra?: Partial<CodeNavResult>): CodeNavResult {
  if (!hits.length) return miss(operation, extra?.reason ?? "no symbol hits");
  return { operation, hits, degraded: false, ...extra };
}

function atPosition(symbols: SymbolInfo[], path: string, line: number, column?: number): SymbolInfo | undefined {
  const here = symbols.filter((s) => {
    if (s.path !== path && !s.path.endsWith(path)) return false;
    if (s.startLine > line || s.endLine < line) return false;
    if (column === undefined) return s.kind !== "call";
    return s.startColumn <= column && column <= s.endColumn;
  });
  here.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine));
  return here[0];
}

function implementations(name: string, symbols: SymbolInfo[]): SymbolInfo[] {
  const tail = lastNameSegment(name);
  return symbols.filter((s) => {
    if (s.kind === "class" || s.kind === "interface" || s.kind === "method") {
      return s.name === tail || s.name === name;
    }
    return false;
  });
}

function workspaceSymbols(query: string, symbols: SymbolInfo[], limit = 40): SymbolInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const defs = symbols.filter((s) => s.kind !== "call" && s.kind !== "import");
  const scored = defs
    .map((s) => {
      const n = s.name.toLowerCase();
      const qual = (s.container ? `${s.container}.${s.name}` : s.name).toLowerCase();
      let score = 0;
      if (n === q || qual === q) score = 3;
      else if (n.startsWith(q) || qual.startsWith(q)) score = 2;
      else if (n.includes(q) || qual.includes(q)) score = 1;
      return { s, score };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.s.path.localeCompare(b.s.path));
  return scored.slice(0, limit).map((x) => x.s);
}

/** In-memory nav over an already extracted symbol list. */
export function navigateSymbols(req: CodeNavRequest, symbols: SymbolInfo[]): CodeNavResult {
  let name = req.symbol?.trim() ?? "";
  if (!name && req.path && req.line !== undefined) {
    const at = atPosition(symbols, req.path, req.line, req.column);
    if (at) name = at.container ? `${at.container}.${at.name}` : at.name;
  }
  if (!name) return miss(req.operation, "symbol name required");

  if (req.operation === "callers") {
    const found = findCallers({ name, path: req.path, line: req.line }, symbols);
    if (!found.hits.length) return miss("callers", found.reason ?? "no callers");
    return {
      operation: "callers",
      hits: found.hits,
      degraded: false,
      incomplete: found.incomplete,
      reason: found.reason,
    };
  }
  if (req.operation === "callees") {
    const found = findCallees({ name, path: req.path, line: req.line }, symbols);
    if (!found.hits.length) return miss("callees", found.reason ?? "no callees");
    return {
      operation: "callees",
      hits: found.hits,
      degraded: false,
      incomplete: found.incomplete,
      reason: found.reason,
    };
  }

  if (req.operation === "definition") {
    return ok("definition", findDefinition(name, symbols).map(toHit));
  }
  if (req.operation === "references") {
    return ok("references", findReferences(name, symbols).map(toHit));
  }
  if (req.operation === "implementations") {
    const hits = implementations(name, symbols).map(toHit);
    if (!hits.length) return miss("implementations", "no name-based implementations");
    return {
      operation: "implementations",
      hits,
      degraded: false,
      incomplete: true,
      reason: "name-based only — tree-sitter is not a type system (D4)",
    };
  }
  if (req.operation === "workspace_symbols") {
    return ok("workspace_symbols", workspaceSymbols(name, symbols).map(toHit));
  }
  return miss(req.operation, "unknown operation");
}

export async function navigateProject(
  root: string,
  req: CodeNavRequest,
  opts: { excludeGlobs?: string[] } = {},
): Promise<CodeNavResult> {
  await initTreeSitter();
  if (!isTreeSitterReady()) {
    return {
      operation: req.operation,
      hits: [],
      degraded: true,
      fallbackExact: true,
      reason: treeSitterInitError() ?? "tree-sitter not ready",
    };
  }
  const { symbols } = await extractProjectCached(root, { excludeGlobs: opts.excludeGlobs ?? [] });
  return navigateSymbols(req, symbols);
}

/** Alias kept for the index.ts hook name in the brief. */
export async function navigate(
  root: string,
  req: CodeNavRequest,
  opts?: { excludeGlobs?: string[] },
): Promise<CodeNavResult> {
  return navigateProject(root, req, opts);
}

export function navigateFiles(req: CodeNavRequest, files: SourceFile[]): CodeNavResult {
  return navigateSymbols(req, extractMany(files));
}
