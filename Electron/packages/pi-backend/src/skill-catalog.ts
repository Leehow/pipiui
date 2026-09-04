import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SkillCatalogItem, SkillCatalogOrigin } from "@pipi/host-api";

const WALK_MAX_DEPTH = 4;
const ORIGIN_ORDER: Record<SkillCatalogOrigin, number> = { builtin: 0, extension: 1, project: 2 };

export type SkillCatalogSource = {
  origin: SkillCatalogOrigin;
  sourceId: string;
  sourceName: string;
  root: string;
  available: boolean;
};

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function confinedRealpath(path: string, jail: string): string | undefined {
  try {
    const real = realpathSync(path);
    let realJail = resolve(jail);
    try {
      if (existsSync(jail)) realJail = realpathSync(jail);
    } catch {
      /* keep resolved jail */
    }
    if (!isInside(realJail, real)) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

function frontmatterOf(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

/** A directory holding SKILL.md is a skill and is not recursed into. */
function walkForSkills(dir: string, jail: string, out: string[], depth = 0): void {
  if (depth > WALK_MAX_DEPTH) return;
  const confined = confinedRealpath(dir, jail);
  if (!confined) return;
  let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  try {
    entries = readdirSync(confined, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((entry) => entry.name === "SKILL.md" && !entry.isDirectory())) {
    const skillFile = join(confined, "SKILL.md");
    if (confinedRealpath(skillFile, jail)) out.push(skillFile);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(confined, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDir) walkForSkills(full, jail, out, depth + 1);
  }
}

function readSkillFile(file: string): { name: string; description: string; userInvoked: boolean } | undefined {
  let text: string;
  try {
    if (!lstatSync(file).isFile()) return undefined;
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const fm = frontmatterOf(text);
  const name = (fm.name || basename(dirname(file))).trim();
  const description = (fm.description || "").trim();
  if (!name || !description) return undefined;
  return {
    name,
    description,
    userInvoked: fm["disable-model-invocation"] === "true",
  };
}

/**
 * Flatten skill roots into a renderer-safe catalog. Duplicate names in the same
 * source are first-file-wins; the same name from different sources is kept.
 */
export function collectSkillCatalog(sources: readonly SkillCatalogSource[]): SkillCatalogItem[] {
  const items: SkillCatalogItem[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source.root || !existsSync(source.root)) continue;
    try {
      if (!statSync(source.root).isDirectory()) continue;
    } catch {
      continue;
    }
    const files: string[] = [];
    walkForSkills(source.root, source.root, files);
    for (const file of files) {
      const parsed = readSkillFile(file);
      if (!parsed) continue;
      const key = `${source.origin}\0${source.sourceId}\0${parsed.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        name: parsed.name,
        description: parsed.description,
        userInvoked: parsed.userInvoked,
        origin: source.origin,
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        available: source.available,
      });
    }
  }
  return items.sort((left, right) => {
    const origin = ORIGIN_ORDER[left.origin] - ORIGIN_ORDER[right.origin];
    if (origin !== 0) return origin;
    const source = left.sourceName.localeCompare(right.sourceName) || left.sourceId.localeCompare(right.sourceId);
    if (source !== 0) return source;
    if (left.userInvoked !== right.userInvoked) return left.userInvoked ? 1 : -1;
    return left.name.localeCompare(right.name);
  });
}
