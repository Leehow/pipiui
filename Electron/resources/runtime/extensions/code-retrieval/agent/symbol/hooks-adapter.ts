/**
 * Adapters matching agent/hooks.ts SymbolLayer.
 * This module does not import hooks.ts (their file must stay free of extractors).
 * Wire from the tools half with:
 *   import { installSymbolLayer } from "./symbol/hooks-adapter.js";
 *   installSymbolLayer(setSymbolLayer);
 * or assign: symbolLayer.repoMap = repoMapHook; …
 */

import { extractMany, findDefinition } from "./extract.js";
import { collectSourceFiles } from "./files.js";
import { computeRepoMap } from "./repomap.js";
import { navigateProject } from "./codenav.js";
import { initTreeSitter, isTreeSitterReady } from "./treesitter.js";
import type { CodeNavOperation } from "./types.js";

export type UnassignedHit = {
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  score?: number;
  text?: string;
};

export async function repoMapHook(args: {
  tokenBudget?: number;
  projectRoot: string;
}): Promise<UnassignedHit[]> {
  const map = await computeRepoMap(args.projectRoot, { tokenBudget: args.tokenBudget });
  const hits: UnassignedHit[] = [];
  for (const entry of map.entries) {
    for (const sym of entry.symbols) {
      hits.push({
        path: entry.path,
        startLine: sym.startLine,
        endLine: sym.endLine,
        symbol: sym.container ? `${sym.container}.${sym.name}` : sym.name,
        score: entry.score,
        text: sym.signature,
      });
    }
    for (const call of entry.calls) {
      hits.push({
        path: entry.path,
        startLine: 1,
        endLine: 1,
        symbol: `${call.from}->${call.to}`,
        score: entry.score,
        text: `call ${call.from} -> ${call.to}`,
      });
    }
  }
  return hits;
}

export async function codeNavHook(args: {
  operation: CodeNavOperation;
  symbol?: string;
  path?: string;
  line?: number;
  column?: number;
  projectRoot: string;
}): Promise<{
  hits: UnassignedHit[];
  degraded?: boolean;
  reason?: string;
  incomplete?: boolean;
  unsupported?: boolean;
}> {
  const result = await navigateProject(args.projectRoot, {
    operation: args.operation,
    symbol: args.symbol,
    path: args.path,
    line: args.line,
    column: args.column,
  });
  return {
    hits: result.hits.map((h) => ({
      path: h.path,
      startLine: h.startLine,
      endLine: h.endLine,
      symbol: h.symbol,
      text: h.signature,
    })),
    degraded: result.degraded,
    reason: result.reason,
    incomplete: result.incomplete,
    unsupported: result.unsupported,
  };
}

export async function searchSymbolsHook(args: {
  query: string;
  path?: string;
  glob?: string;
  topK?: number;
  projectRoot: string;
}): Promise<UnassignedHit[]> {
  const nav = await navigateProject(args.projectRoot, {
    operation: "workspace_symbols",
    symbol: args.query,
    path: args.path,
  });
  const topK = args.topK ?? 20;
  return nav.hits.slice(0, topK).map((h) => ({
    path: h.path,
    startLine: h.startLine,
    endLine: h.endLine,
    symbol: h.symbol,
    text: h.signature,
  }));
}

export async function resolveSymbolBodyHook(args: {
  path: string;
  symbol: string;
  projectRoot: string;
}): Promise<{ startLine: number; endLine: number } | undefined> {
  await initTreeSitter();
  if (!isTreeSitterReady()) return undefined;
  const files = collectSourceFiles(args.projectRoot).filter(
    (f) => f.path === args.path || f.path.endsWith(args.path),
  );
  const defs = findDefinition(args.symbol, extractMany(files));
  const hit = defs[0];
  if (!hit) return undefined;
  return { startLine: hit.startLine, endLine: hit.endLine };
}

export function symbolLayerPartial(): {
  searchSymbols: typeof searchSymbolsHook;
  repoMap: typeof repoMapHook;
  codeNav: typeof codeNavHook;
  resolveSymbolBody: typeof resolveSymbolBodyHook;
} {
  return {
    searchSymbols: searchSymbolsHook,
    repoMap: repoMapHook,
    codeNav: codeNavHook,
    resolveSymbolBody: resolveSymbolBodyHook,
  };
}

export function installSymbolLayer(setSymbolLayer: (partial: {
  searchSymbols?: typeof searchSymbolsHook;
  repoMap?: typeof repoMapHook;
  codeNav?: typeof codeNavHook;
  resolveSymbolBody?: typeof resolveSymbolBodyHook;
}) => void): void {
  setSymbolLayer(symbolLayerPartial());
}
