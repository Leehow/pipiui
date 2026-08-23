/**
 * Content-hash symbol cache (spec D2).
 * Safe to delete: `{project}/.pi/agent/code-retrieval/symbol-cache/`.
 * Unchanged files reuse extracted symbols; only dirty files are re-parsed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { extractSymbols } from "./extract.js";
import { collectSourceEntries, type SourceEntry } from "./files.js";
import type { SourceFile, SymbolInfo } from "./types.js";

/** Bump when extract queries / SymbolInfo shape change. */
export const CACHE_SCHEMA = 1;
const PARSE_BATCH = 6;

export interface CachedExtractStats {
  files: number;
  cacheHits: number;
  cacheMisses: number;
  memoryHits: number;
  diskHits: number;
  symbols: number;
  elapsedMs: number;
  cacheDir: string;
}

export interface CachedExtractResult {
  symbols: SymbolInfo[];
  stats: CachedExtractStats;
}

interface CachePayload {
  v: number;
  path: string;
  sha: string;
  symbols: SymbolInfo[];
}

const memory = new Map<string, SymbolInfo[]>();
const inflightExtracts = new Map<string, Promise<CachedExtractResult>>();
let lastStats: CachedExtractStats | null = null;
let extractRunStarts = 0;
let parseDirtyCount = 0;

export function lastCachedExtractStats(): CachedExtractStats | null {
  return lastStats;
}

export function symbolExtractRunStarts(): number {
  return extractRunStarts;
}

export function symbolParseDirtyCount(): number {
  return parseDirtyCount;
}

export function resetSymbolExtractCounters(): void {
  extractRunStarts = 0;
  parseDirtyCount = 0;
}

export function clearSymbolMemoryCache(): void {
  memory.clear();
}

export function symbolCacheDir(projectRoot: string): string {
  return join(projectRoot, ".pi", "agent", "code-retrieval", "symbol-cache");
}

function sha256Bytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function entryKey(relPath: string, contentSha: string): string {
  return createHash("sha256").update(`${relPath}\n${contentSha}`).digest("hex");
}

function memKey(projectRoot: string, relPath: string, contentSha: string): string {
  return `${projectRoot}\0${relPath}\0${contentSha}`;
}

function cacheFilePath(cacheDir: string, key: string): string {
  return join(cacheDir, key.slice(0, 2), `${key}.json`);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function readDisk(cacheDir: string, relPath: string, contentSha: string): SymbolInfo[] | null {
  const file = cacheFilePath(cacheDir, entryKey(relPath, contentSha));
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as CachePayload;
    if (raw.v !== CACHE_SCHEMA) return null;
    if (raw.path !== relPath || raw.sha !== contentSha) return null;
    if (!Array.isArray(raw.symbols)) return null;
    return raw.symbols;
  } catch {
    return null;
  }
}

function writeDisk(cacheDir: string, relPath: string, contentSha: string, symbols: SymbolInfo[]): void {
  const key = entryKey(relPath, contentSha);
  const dir = join(cacheDir, key.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const payload: CachePayload = { v: CACHE_SCHEMA, path: relPath, sha: contentSha, symbols };
  writeFileSync(cacheFilePath(cacheDir, key), JSON.stringify(payload));
}

function lookup(
  projectRoot: string,
  cacheDir: string,
  relPath: string,
  contentSha: string,
  stats: CachedExtractStats,
): SymbolInfo[] | null {
  const mk = memKey(projectRoot, relPath, contentSha);
  const fromMem = memory.get(mk);
  if (fromMem) {
    stats.memoryHits += 1;
    stats.cacheHits += 1;
    return fromMem;
  }
  const fromDisk = readDisk(cacheDir, relPath, contentSha);
  if (fromDisk) {
    memory.set(mk, fromDisk);
    stats.diskHits += 1;
    stats.cacheHits += 1;
    return fromDisk;
  }
  return null;
}

function store(
  projectRoot: string,
  cacheDir: string,
  relPath: string,
  contentSha: string,
  symbols: SymbolInfo[],
): void {
  memory.set(memKey(projectRoot, relPath, contentSha), symbols);
  try {
    writeDisk(cacheDir, relPath, contentSha, symbols);
  } catch {
    // Rebuildable; never fail the query because cache write failed (D2).
  }
}

function parseDirty(
  projectRoot: string,
  cacheDir: string,
  file: SourceFile,
  contentSha: string,
): SymbolInfo[] {
  parseDirtyCount += 1;
  const symbols = extractSymbols(file.path, file.source, file.lang);
  store(projectRoot, cacheDir, file.path, contentSha, symbols);
  return symbols;
}

/**
 * Incremental extract: hash each source file, reuse cache, parse only dirty files.
 * Yields the event loop between parse batches so a first full scan cannot pin Node.
 * Concurrent callers for the same projectRoot wait on one in-flight run (no double parse).
 */
export async function extractProjectCached(
  root: string,
  opts: { excludeGlobs?: string[]; maxFiles?: number } = {},
): Promise<CachedExtractResult> {
  const key = resolve(root);
  const existing = inflightExtracts.get(key);
  if (existing) return existing;
  extractRunStarts += 1;
  const run = runExtractProjectCached(root, opts).finally(() => {
    if (inflightExtracts.get(key) === run) inflightExtracts.delete(key);
  });
  inflightExtracts.set(key, run);
  return run;
}

async function runExtractProjectCached(
  root: string,
  opts: { excludeGlobs?: string[]; maxFiles?: number },
): Promise<CachedExtractResult> {
  const started = Date.now();
  const cacheDir = symbolCacheDir(root);
  const stats: CachedExtractStats = {
    files: 0,
    cacheHits: 0,
    cacheMisses: 0,
    memoryHits: 0,
    diskHits: 0,
    symbols: 0,
    elapsedMs: 0,
    cacheDir,
  };

  const entries: SourceEntry[] = collectSourceEntries(root, opts.excludeGlobs ?? [], opts.maxFiles ?? 4000);
  stats.files = entries.length;
  const all: SymbolInfo[] = [];
  let dirtyInBatch = 0;

  for (const entry of entries) {
    let buf: Buffer;
    try {
      buf = readFileSync(entry.absPath);
    } catch {
      continue;
    }
    const sha = sha256Bytes(buf);
    const cached = lookup(root, cacheDir, entry.path, sha, stats);
    if (cached) {
      all.push(...cached);
      continue;
    }
    const source = buf.toString("utf8");
    const symbols = parseDirty(root, cacheDir, { path: entry.path, source, lang: entry.lang }, sha);
    stats.cacheMisses += 1;
    all.push(...symbols);
    dirtyInBatch += 1;
    if (dirtyInBatch >= PARSE_BATCH) {
      dirtyInBatch = 0;
      await yieldEventLoop();
    }
  }

  stats.symbols = all.length;
  stats.elapsedMs = Date.now() - started;
  lastStats = stats;
  return { symbols: all, stats };
}
