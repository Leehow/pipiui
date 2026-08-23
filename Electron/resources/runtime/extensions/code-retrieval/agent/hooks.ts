/**
 * Symbol-layer hooks (repo_map / code_nav / optional symbol search).
 *
 * The parallel symbol-layer worker replaces these implementations without
 * touching protocol / code_search / read_spans. Call `setSymbolLayer({...})`
 * from a side-effect module, or assign onto the exported `symbolLayer` object.
 *
 * This file must not import agent/sidecar/ symbol extractors.
 */

import type { UnassignedHit } from "./types.js";

export type SymbolSearchArgs = {
  query: string;
  path?: string;
  glob?: string;
  topK?: number;
  projectRoot: string;
};

export type RepoMapArgs = {
  tokenBudget?: number;
  projectRoot: string;
};

export type CodeNavArgs = {
  operation:
    | "definition"
    | "references"
    | "implementations"
    | "workspace_symbols"
    | "callers"
    | "callees";
  symbol?: string;
  path?: string;
  line?: number;
  column?: number;
  projectRoot: string;
};

export type SymbolSearchFn = (args: SymbolSearchArgs) => Promise<UnassignedHit[]>;
export type RepoMapFn = (args: RepoMapArgs) => Promise<UnassignedHit[]>;
export type CodeNavFn = (args: CodeNavArgs) => Promise<UnassignedHit[]>;
export type SymbolBodyFn = (args: {
  path: string;
  symbol: string;
  projectRoot: string;
}) => Promise<{ startLine: number; endLine: number } | undefined>;

export type SymbolLayer = {
  searchSymbols?: SymbolSearchFn;
  repoMap?: RepoMapFn;
  codeNav?: CodeNavFn;
  resolveSymbolBody?: SymbolBodyFn;
};

/** Mutable hook table. Symbol-layer worker may replace fields in place. */
export const symbolLayer: SymbolLayer = {};

export function getSymbolLayer(): SymbolLayer {
  return symbolLayer;
}

export function setSymbolLayer(partial: Partial<SymbolLayer>): void {
  Object.assign(symbolLayer, partial);
}

export function createDefaultSymbolHooks(): SymbolLayer {
  return {};
}
