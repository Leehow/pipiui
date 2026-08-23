import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
