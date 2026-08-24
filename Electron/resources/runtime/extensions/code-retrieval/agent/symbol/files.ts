import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { langFromPath } from "./treesitter.js";
import type { SourceFile, SupportedLang } from "./types.js";

export interface SourceEntry {
  path: string;
  absPath: string;
  lang: SupportedLang;
  size: number;
}

/** Directory names skipped by default. Matched as a single path segment only. */
export const DEFAULT_SKIP_DIRS = [
  ".git",
  ".hg",
  ".svn",
  ".pi",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "out",
  "dist",
  "build",
  "release",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "vendor",
  ".tox",
  ".eggs",
] as const;

const DEFAULT_SKIP = new Set<string>(DEFAULT_SKIP_DIRS);

const MAX_FILE_BYTES = 512 * 1024;

/** Below this, a JS file is never treated as a generated single-file bundle. */
const GENERATED_BUNDLE_MIN_BYTES = 128 * 1024;

/** One bounded prefix read; enough for Electron/index.js hashed chunk at ~64 KiB. */
const BUNDLE_SAMPLE_BYTES = 128 * 1024;

/** esbuild/rollup/vite CJS interop: Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" }) */
const BUNDLER_MODULE_TAG_RE =
  /Object\.defineProperty\s*\(\s*exports\s*,\s*Symbol\.toStringTag\s*,\s*\{[\s\S]{0,80}["']Module["']/;

/** esbuild/rollup helper identifiers / calls. */
const BUNDLER_HELPER_RE =
  /\b(?:__toESM|__commonJS|__toCommonJS|__exportAll|__copyProps|__reExport)\s*\(|\bvar __defProp\s*=\s*Object\.defineProperty\b/;

/** Sibling chunk: require("./index-CAG480R2.js") or import("./chunk-a1b2c3d4.js"). */
const HASHED_CHUNK_RE =
  /(?:require|import)\s*\(\s*["']\.\/[^"'\n]+-([A-Za-z0-9]{6,12})\.[cm]?js["']\s*\)/g;

function readFilePrefix(absPath: string, maxBytes: number): string {
  const fd = openSync(absPath, "r");
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function hasHashedSiblingChunk(sample: string): boolean {
  for (const match of sample.matchAll(HASHED_CHUNK_RE)) {
    const token = match[1];
    if (token && /\d/.test(token) && /[A-Za-z]/.test(token)) return true;
  }
  return false;
}

/**
 * Conservative generated-bundle detector. Conjunction only:
 * JS family + size >= 128 KiB + at least two independent structural signals
 * (module-tag wrapper, bundler helpers, hashed sibling chunk).
 * Never filters by basename, git status, or a single string/size alone.
 */
function isLikelyGeneratedBundle(absPath: string, size: number, lang: SupportedLang): boolean {
  if (lang !== "javascript") return false;
  if (size < GENERATED_BUNDLE_MIN_BYTES) return false;
  let sample: string;
  try {
    sample = readFilePrefix(absPath, Math.min(size, BUNDLE_SAMPLE_BYTES));
  } catch {
    return false;
  }
  let signals = 0;
  if (BUNDLER_MODULE_TAG_RE.test(sample)) signals += 1;
  if (BUNDLER_HELPER_RE.test(sample)) signals += 1;
  if (hasHashedSiblingChunk(sample)) signals += 1;
  return signals >= 2;
}

function pathSegments(relPath: string): string[] {
  return relPath.split(sep).join("/").split("/").filter(Boolean);
}

function skippedDir(name: string): boolean {
  return DEFAULT_SKIP.has(name) || name.startsWith(".");
}

function matchesExclude(relPath: string, globs: string[]): boolean {
  const norm = relPath.split(sep).join("/");
  const segs = pathSegments(relPath);
  for (const raw of globs) {
    const g = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!g) continue;
    if (g.includes("*")) {
      const escaped = g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*");
      if (new RegExp(`^${escaped}$`).test(norm) || new RegExp(escaped).test(norm)) return true;
    } else if (g.includes("/")) {
      if (norm === g || norm.startsWith(`${g}/`)) return true;
    } else if (segs.includes(g)) {
      return true;
    }
  }
  return false;
}

export function collectSourceEntries(
  root: string,
  excludeGlobs: string[] = [],
  maxFiles = 4000,
): SourceEntry[] {
  const files: SourceEntry[] = [];
  if (!existsSync(root)) return files;

  const walk = (dir: string): void => {
    if (files.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (files.length >= maxFiles) return;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (skippedDir(name)) continue;
        const relDir = relative(root, full);
        if (matchesExclude(relDir, excludeGlobs)) continue;
        walk(full);
        continue;
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const lang = langFromPath(full);
      if (!lang) continue;
      const rel = relative(root, full).split(sep).join("/");
      if (matchesExclude(rel, excludeGlobs)) continue;
      if (isLikelyGeneratedBundle(full, st.size, lang)) continue;
      files.push({ path: rel, absPath: full, lang, size: st.size });
    }
  };

  walk(root);
  return files;
}

export function collectSourceFiles(
  root: string,
  excludeGlobs: string[] = [],
  maxFiles = 4000,
): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of collectSourceEntries(root, excludeGlobs, maxFiles)) {
    try {
      out.push({ path: entry.path, source: readFileSync(entry.absPath, "utf8"), lang: entry.lang });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}
