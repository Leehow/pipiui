import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { clearSymbolMemoryCache, extractProjectCached } from "./symbol/cache.js";
import { initTreeSitter } from "./symbol/treesitter.js";
import type { SymbolInfo } from "./symbol/types.js";

/** Enough files for ≥2 yield batches (PARSE_BATCH is 6) so timers can fire mid-loop. */
const FILE_COUNT = 24;

function fingerprint(symbols: SymbolInfo[]): string[] {
  return symbols
    .map((s) => `${s.path}\0${s.name}\0${s.kind}\0${s.startLine}\0${s.endLine}`)
    .sort();
}

test("hot cache hits yield so setImmediate/short timer run before extract returns", async () => {
  await initTreeSitter();
  const root = await mkdtemp(join(tmpdir(), "cr-deep-cache-yield-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await Promise.all(
      Array.from({ length: FILE_COUNT }, (_, i) => {
        const n = String(i).padStart(2, "0");
        return writeFile(
          join(root, "src", `f${n}.ts`),
          `export function yieldFn${n}() {\n  return ${i};\n}\n`,
          "utf8",
        );
      }),
    );

    const cold = await extractProjectCached(root);
    assert.equal(cold.stats.files, FILE_COUNT);
    assert.equal(cold.stats.cacheMisses, FILE_COUNT, "cold extract should parse every file");
    assert.equal(cold.stats.cacheHits, 0);

    let immediateDuring = false;
    let timeoutDuring = false;
    setImmediate(() => {
      immediateDuring = true;
    });
    setTimeout(() => {
      timeoutDuring = true;
    }, 0);

    const hot = await extractProjectCached(root);

    assert.equal(immediateDuring, true, "setImmediate must run during hot hits, not only after return");
    assert.equal(timeoutDuring, true, "short timer must run during hot hits, not only after return");
    assert.equal(hot.stats.files, FILE_COUNT);
    assert.equal(hot.stats.cacheHits, FILE_COUNT, "second extract should be all cache hits");
    assert.equal(hot.stats.cacheMisses, 0);
    assert.equal(hot.stats.memoryHits, FILE_COUNT);
    assert.deepEqual(fingerprint(hot.symbols), fingerprint(cold.symbols));
  } finally {
    clearSymbolMemoryCache();
    await rm(root, { recursive: true, force: true });
  }
});
