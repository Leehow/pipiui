/**
 * Public hook surface for pipiui-code-retrieval agent/index.ts.
 * This file does not register tools. Callers wire execute() themselves.
 */

export {
  initTreeSitter,
  isTreeSitterReady,
  treeSitterInitError,
  sidecarAssetStatus,
  resolveSidecarDir,
  langFromPath,
} from "./treesitter.js";

export {
  extractSymbols,
  extractFile,
  extractMany,
  findDefinition,
  findReferences,
} from "./extract.js";

export { buildRepoMap, buildRepoMapFromSymbols, computeRepoMap, formatRepoMapText } from "./repomap.js";
export { navigate, navigateProject, navigateSymbols, navigateFiles } from "./codenav.js";
export { buildCallGraph, findCallers, findCallees } from "./callgraph.js";
export { collectSourceFiles, collectSourceEntries, DEFAULT_SKIP_DIRS } from "./files.js";
export {
  extractProjectCached,
  lastCachedExtractStats,
  clearSymbolMemoryCache,
  symbolCacheDir,
  symbolExtractRunStarts,
  symbolParseDirtyCount,
  resetSymbolExtractCounters,
  CACHE_SCHEMA,
} from "./cache.js";
export {
  repoMapHook,
  codeNavHook,
  searchSymbolsHook,
  resolveSymbolBodyHook,
  symbolLayerPartial,
  installSymbolLayer,
} from "./hooks-adapter.js";

export type {
  SupportedLang,
  SymbolKind,
  SymbolInfo,
  MapEntry,
  MapSymbol,
  CallEdge,
  SourceFile,
  CodeNavOperation,
  CodeNavRequest,
  CodeNavHit,
  CodeNavResult,
} from "./types.js";

export { DEFAULT_TOKEN_BUDGET, estimateTokens } from "./types.js";
