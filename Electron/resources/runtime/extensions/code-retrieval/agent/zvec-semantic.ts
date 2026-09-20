/**
 * Local zvec semantic layer for code_search (D6 stage 4).
 *
 * Uses @zvec/zvec (Alibaba) for BM25 + HNSW. Embeddings are a local bag-of-tokens
 * hash (no remote API, no transformers.js). Missing native bindings degrade
 * honestly — exact grep / lexical fallback stay in charge.
 *
 * Index lives at {project}/.pi/agent/code-retrieval/zvec/ — never ~/.zvec-grep
 * and never a repo-root .zvec-grep.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { retrievalHome } from "./paths.js";
import type { UnassignedHit } from "./types.js";

const DIMENSION = 256;
const WINDOW_LINES = 50;
const WINDOW_OVERLAP = 10;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 4000;
const MAX_CHUNKS = 24_000;
const VECTOR_MIN_SCORE = 0.28;
const RRF_K = 60;
const SCHEMA_VERSION = 1;
const EMBEDDER_ID = "hash-v1";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".pi",
  ".worktrees",
  "target",
  "__pycache__",
  ".venv",
  ".zvec-grep",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".md",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".vue",
  ".svelte",
  ".txt",
  ".sh",
]);

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "how",
  "why",
  "what",
  "when",
  "where",
  "which",
  "who",
  "does",
  "do",
  "did",
  "can",
  "this",
  "that",
  "and",
  "or",
  "but",
  "if",
  "with",
  "from",
  "by",
  "as",
  "it",
  "its",
  "we",
  "you",
  "i",
  "export",
  "import",
  "return",
  "const",
  "let",
  "var",
  "function",
  "class",
  "async",
]);

export type SemanticOutcome = {
  available: boolean;
  hits: UnassignedHit[];
  provider?: "zvec";
  reason?: string;
};

export type SemanticSearchArgs = {
  query: string;
  projectRoot: string;
  path?: string;
  glob?: string;
  topK?: number;
  /** Internal opt-in only; ordinary calls retain the historical 50-hit ceiling. */
  wideRecall?: boolean;
  excludeGlobs?: string[];
  signal?: AbortSignal;
};

type SemanticSearchFn = (args: SemanticSearchArgs) => Promise<SemanticOutcome>;

let testOverride: SemanticSearchFn | null = null;
const builds = new Map<string, Promise<boolean>>();

export function setSemanticSearchForTests(fn: SemanticSearchFn | null): void {
  testOverride = fn;
}

export function zvecIndexDir(projectRoot: string): string {
  return join(retrievalHome(projectRoot), "zvec");
}

function collectionPath(projectRoot: string): string {
  return join(zvecIndexDir(projectRoot), "collection");
}

function metaPath(projectRoot: string): string {
  return join(zvecIndexDir(projectRoot), "meta.json");
}

type ZvecModule = typeof import("@zvec/zvec");
type ZvecCollection = import("@zvec/zvec").ZVecCollection;

let zvecMod: ZvecModule | null | undefined;
let zvecInit = false;

async function loadZvec(): Promise<ZvecModule | null> {
  if (zvecMod !== undefined) return zvecMod;
  if (process.env.PIPIUI_CODE_RETRIEVAL_ZVEC === "0") {
    zvecMod = null;
    return null;
  }
  try {
    zvecMod = await import("@zvec/zvec");
    return zvecMod;
  } catch {
    zvecMod = null;
    return null;
  }
}

function ensureInit(mod: ZvecModule): void {
  if (zvecInit) return;
  mod.ZVecInitialize({ logLevel: mod.ZVecLogLevel.WARN });
  zvecInit = true;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const raw of lower.split(/[^a-z0-9_\u3400-\u9fff$]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(raw);
    if (out.length >= 64) break;
  }
  return out;
}

export function embedHash(text: string): number[] {
  const vec = new Float32Array(DIMENSION);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vec);
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const a = digest.readUInt16BE(0) % DIMENSION;
    const b = digest.readUInt16BE(2) % DIMENSION;
    vec[a] += 1;
    vec[b] += 0.5;
  }
  let norm = 0;
  for (const value of vec) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(DIMENSION);
  for (let i = 0; i < DIMENSION; i++) out[i] = vec[i]! / norm;
  return out;
}

function posixRel(root: string, file: string): string {
  return relative(root, file).split("\\").join("/");
}

function globToRegExp(glob: string): RegExp | undefined {
  if (!glob.trim()) return undefined;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    return new RegExp(`^${escaped}$`);
  } catch {
    return undefined;
  }
}

function excluded(rel: string, globs: string[]): boolean {
  for (const glob of globs) {
    if (!glob || glob.startsWith("!")) continue;
    if (glob.endsWith("/**") && rel.startsWith(glob.slice(0, -3))) return true;
    const re = globToRegExp(glob);
    if (re?.test(rel)) return true;
    if (rel === glob || rel.startsWith(`${glob}/`)) return true;
  }
  return false;
}

async function listFiles(
  root: string,
  dir: string,
  acc: string[],
  excludeGlobs: string[],
): Promise<void> {
  if (acc.length >= MAX_FILES) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) return;
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") {
      if (SKIP_DIRS.has(entry.name)) continue;
    }
    const full = join(dir, entry.name);
    const rel = posixRel(root, full);
    if (SKIP_DIRS.has(entry.name) || excluded(rel, excludeGlobs)) continue;
    if (entry.isDirectory()) {
      await listFiles(root, full, acc, excludeGlobs);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXT.has(extname(entry.name).toLowerCase())) continue;
    acc.push(full);
  }
}

type Chunk = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
};

function chunkFile(rel: string, content: string): Chunk[] {
  const lines = content.split(/\n/);
  if (lines.length === 0) return [];
  const chunks: Chunk[] = [];
  const step = Math.max(1, WINDOW_LINES - WINDOW_OVERLAP);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + WINDOW_LINES);
    const slice = lines.slice(start, end).join("\n");
    if (!slice.trim()) {
      if (end >= lines.length) break;
      continue;
    }
    chunks.push({
      id: createHash("sha1").update(`${rel}:${start + 1}:${end}`).digest("hex"),
      path: rel,
      startLine: start + 1,
      endLine: end,
      text: slice.slice(0, 8000),
    });
    if (end >= lines.length) break;
  }
  return chunks;
}

function schema(mod: ZvecModule) {
  return new mod.ZVecCollectionSchema({
    name: "pipiui_semantic",
    fields: [
      {
        name: "path",
        dataType: mod.ZVecDataType.STRING,
        indexParams: { indexType: mod.ZVecIndexType.INVERT },
      },
      {
        name: "text",
        dataType: mod.ZVecDataType.STRING,
        indexParams: {
          indexType: mod.ZVecIndexType.FTS,
          tokenizerName: "standard",
          filters: ["lowercase"],
        },
      },
      { name: "start_line", dataType: mod.ZVecDataType.INT32 },
      { name: "end_line", dataType: mod.ZVecDataType.INT32 },
    ],
    vectors: {
      name: "embedding",
      dataType: mod.ZVecDataType.VECTOR_FP32,
      dimension: DIMENSION,
      indexParams: {
        indexType: mod.ZVecIndexType.HNSW,
        metricType: mod.ZVecMetricType.COSINE,
      },
    },
  });
}

async function collectChunks(
  projectRoot: string,
  excludeGlobs: string[],
  pathPrefix?: string,
): Promise<Chunk[]> {
  const startDir = pathPrefix ? join(projectRoot, pathPrefix) : projectRoot;
  const files: string[] = [];
  await listFiles(projectRoot, startDir, files, excludeGlobs);
  const chunks: Chunk[] = [];
  for (const file of files) {
    if (chunks.length >= MAX_CHUNKS) break;
    let st;
    try {
      st = await stat(file);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE_BYTES) continue;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const rel = posixRel(projectRoot, file);
    for (const chunk of chunkFile(rel, text)) {
      chunks.push(chunk);
      if (chunks.length >= MAX_CHUNKS) break;
    }
  }
  return chunks;
}

async function writeMeta(projectRoot: string, chunkCount: number): Promise<void> {
  await writeFile(
    metaPath(projectRoot),
    JSON.stringify({
      version: SCHEMA_VERSION,
      embedder: EMBEDDER_ID,
      dimension: DIMENSION,
      chunkCount,
      builtAt: Date.now(),
    }),
    "utf8",
  );
}

function metaFresh(projectRoot: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(metaPath(projectRoot), "utf8")) as {
      version?: number;
      embedder?: string;
    };
    return raw.version === SCHEMA_VERSION && raw.embedder === EMBEDDER_ID && existsSync(collectionPath(projectRoot));
  } catch {
    return false;
  }
}

async function buildIndex(
  projectRoot: string,
  excludeGlobs: string[],
  signal?: AbortSignal,
): Promise<boolean> {
  const mod = await loadZvec();
  if (!mod) return false;
  if (signal?.aborted) return false;
  ensureInit(mod);
  const dir = zvecIndexDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const dest = collectionPath(projectRoot);
  if (existsSync(dest)) {
    await rm(dest, { recursive: true, force: true });
  }
  const collection = mod.ZVecCreateAndOpen(dest, schema(mod));
  try {
    const chunks = await collectChunks(projectRoot, excludeGlobs);
    const batch: import("@zvec/zvec").ZVecDocInput[] = [];
    const flush = () => {
      if (batch.length === 0) return;
      const statuses = collection.upsertSync(batch.splice(0, batch.length));
      const failed = statuses.find((status) => !status.ok);
      if (failed) throw new Error(failed.message || failed.code);
    };
    for (const chunk of chunks) {
      if (signal?.aborted) break;
      batch.push({
        id: chunk.id,
        vectors: { embedding: embedHash(`${chunk.path}\n${chunk.text}`) },
        fields: {
          path: chunk.path,
          text: chunk.text,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
        },
      });
      if (batch.length >= 256) flush();
    }
    flush();
    collection.optimizeSync();
    await writeMeta(projectRoot, chunks.length);
    return true;
  } finally {
    collection.closeSync();
  }
}

export async function rebuildZvecIndex(
  projectRoot: string,
  options: { excludeGlobs?: string[]; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const ok = await buildIndex(projectRoot, options.excludeGlobs ?? [], options.signal);
    return ok ? { ok: true } : { ok: false, reason: "@zvec/zvec is not available" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function ensureIndex(projectRoot: string, excludeGlobs: string[], signal?: AbortSignal): Promise<boolean> {
  if (metaFresh(projectRoot)) return true;
  let pending = builds.get(projectRoot);
  if (!pending) {
    pending = buildIndex(projectRoot, excludeGlobs, signal).finally(() => {
      builds.delete(projectRoot);
    });
    builds.set(projectRoot, pending);
  }
  try {
    return await pending;
  } catch {
    return false;
  }
}

function hitFromDoc(doc: import("@zvec/zvec").ZVecDoc): UnassignedHit | undefined {
  const path = typeof doc.fields.path === "string" ? doc.fields.path : "";
  const startLine = Number(doc.fields.start_line);
  const endLine = Number(doc.fields.end_line);
  if (!path || !Number.isFinite(startLine) || !Number.isFinite(endLine)) return undefined;
  const text = typeof doc.fields.text === "string" ? doc.fields.text : undefined;
  return { path, startLine, endLine, score: doc.score, ...(text ? { text } : {}) };
}

function rrf(lists: UnassignedHit[][], topK: number): UnassignedHit[] {
  const scores = new Map<string, { hit: UnassignedHit; score: number }>();
  for (const list of lists) {
    list.forEach((hit, index) => {
      const key = `${hit.path}:${hit.startLine}:${hit.endLine}`;
      const add = 1 / (RRF_K + index + 1);
      const prev = scores.get(key);
      if (prev) prev.score += add;
      else scores.set(key, { hit, score: add });
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((row) => ({ ...row.hit, score: row.score }));
}

function openCollection(mod: ZvecModule, projectRoot: string): ZvecCollection | null {
  const dest = collectionPath(projectRoot);
  if (!existsSync(dest)) return null;
  ensureInit(mod);
  try {
    return mod.ZVecOpen(dest, { readOnly: true });
  } catch {
    try {
      return mod.ZVecOpen(dest);
    } catch {
      return null;
    }
  }
}

export function semanticCandidateLimit(args: Pick<SemanticSearchArgs, "topK" | "wideRecall">): number {
  const requested = Number.isFinite(args.topK) ? Math.floor(args.topK!) : 20;
  return Math.max(1, Math.min(requested, args.wideRecall ? 100 : 50));
}

async function searchZvec(args: SemanticSearchArgs): Promise<SemanticOutcome> {
  args.signal?.throwIfAborted();
  const mod = await loadZvec();
  args.signal?.throwIfAborted();
  if (!mod) return { available: false, hits: [], reason: "@zvec/zvec native bindings are not loaded" };
  const ready = await ensureIndex(args.projectRoot, args.excludeGlobs ?? [], args.signal);
  args.signal?.throwIfAborted();
  if (!ready) return { available: false, hits: [], reason: "zvec index failed to build" };
  const collection = openCollection(mod, args.projectRoot);
  if (!collection) return { available: false, hits: [], reason: "zvec collection missing" };
  const topK = semanticCandidateLimit(args);
  try {
    const ftsDocs = collection.querySync({
      fieldName: "text",
      fts: { matchString: args.query },
      topk: topK,
      includeVector: false,
    });
    const vecDocs = collection.querySync({
      fieldName: "embedding",
      vector: embedHash(args.query),
      topk: topK,
      includeVector: false,
    });
    const ftsHits = ftsDocs
      .filter((doc) => doc.score > 0)
      .map(hitFromDoc)
      .filter((hit): hit is UnassignedHit => Boolean(hit));
    const vecHits = vecDocs
      .filter((doc) => doc.score >= VECTOR_MIN_SCORE)
      .map(hitFromDoc)
      .filter((hit): hit is UnassignedHit => Boolean(hit));
    const prefix = args.path?.replace(/\\/g, "/").replace(/^\.\//, "");
    const globRe = args.glob ? globToRegExp(args.glob) : undefined;
    const scoped = (hits: UnassignedHit[]) =>
      hits.filter((hit) => {
        if (prefix && hit.path !== prefix && !hit.path.startsWith(`${prefix.replace(/\/$/, "")}/`)) return false;
        if (globRe && !globRe.test(hit.path.split("/").pop() ?? hit.path) && !globRe.test(hit.path)) return false;
        return true;
      });
    const fts = scoped(ftsHits);
    const vec = scoped(vecHits);
    // HNSW on a tiny collection scores arbitrary neighbors as 1. BM25 is recall;
    // vectors only rerank FTS hits until a real embedding model is wired.
    const merged = fts.length === 0 ? [] : rrf([fts, vec], topK);
    return { available: true, hits: merged, provider: merged.length > 0 ? "zvec" : undefined };
  } catch (error) {
    return {
      available: false,
      hits: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    collection.closeSync();
  }
}

export async function searchSemantic(args: SemanticSearchArgs): Promise<SemanticOutcome> {
  args.signal?.throwIfAborted();
  if (testOverride) return testOverride(args);
  try {
    return await searchZvec(args);
  } catch (error) {
    return {
      available: false,
      hits: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function zvecAvailable(): Promise<boolean> {
  return (await loadZvec()) !== null;
}
