/**
 * Shared tree-sitter init + background symbol-cache warmup.
 *
 * Lives outside index.ts so tool implementations (map-tool.ts) and the
 * extension entry can share one in-flight init without a module cycle; the
 * evaluator imports ensureTreeSitter from dist/index.js, which re-exports here.
 */

import { extractProjectCached } from "./symbol/cache.js";
import { initTreeSitter, isTreeSitterReady } from "./symbol/treesitter.js";
import { loadRetrievalSettings } from "./settings.js";

let tsInitPromise: Promise<void> | null = null;
let warmupRoot = "";
let warmupPromise: Promise<void> | null = null;

/** Shared in-flight tree-sitter init. Concurrent callers wait on the same promise. */
export function ensureTreeSitter(): Promise<void> {
  if (!tsInitPromise) {
    tsInitPromise = initTreeSitter().catch(() => {
      // symbol layer stays degraded; callers fall back per spec D8
    });
  }
  return tsInitPromise;
}

/**
 * Background symbol-cache warmup. Never throws. Same projectRoot reuses the
 * in-flight (or already-settled) promise so session_start cannot double-parse.
 */
export function startSymbolWarmup(projectRoot: string): Promise<void> {
  const root = projectRoot;
  if (warmupPromise && warmupRoot === root) return warmupPromise;
  warmupRoot = root;
  warmupPromise = runSymbolWarmup(root);
  return warmupPromise;
}

async function runSymbolWarmup(projectRoot: string): Promise<void> {
  try {
    await ensureTreeSitter();
    if (!isTreeSitterReady()) return;
    const settings = await loadRetrievalSettings(projectRoot);
    await extractProjectCached(projectRoot, { excludeGlobs: settings.excludeGlobs });
  } catch {
    // D8: wasm missing / init / extract failure must not affect session load.
  }
}
