import { realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { resolveProjectFile } from "./read-spans.js";
import type { UnassignedHit } from "./types.js";

export type SearchScope = { path?: string; glob?: string; excludeGlobs: string[] };

export function relativeSearchPath(root: string, path: string): string | undefined {
  const rel = relative(root, resolve(root, path)).replace(/\\/g, "/");
  return rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? undefined : rel;
}

function matchGlob(path: string, pattern: string): boolean {
  return posix.matchesGlob(path, pattern)
    || (!pattern.includes("/") && posix.matchesGlob(posix.basename(path), pattern));
}

/** Directory exclusions apply to descendants too; include globs still address files. */
export function matchesSearchScope(path: string, scope: SearchScope): boolean {
  const prefix = scope.path?.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (prefix && prefix !== "." && path !== prefix && !path.startsWith(`${prefix}/`)) return false;
  if (scope.glob && !matchGlob(path, scope.glob)) return false;
  const parts = path.split("/");
  return !scope.excludeGlobs.some((raw) => {
    const pattern = raw.replace(/^!/, "").replace(/\/$/, "");
    for (let n = 1; n <= parts.length; n++) if (matchGlob(parts.slice(0, n).join("/"), pattern)) return true;
    return false;
  });
}

/** Wide recall revalidates index hits as well as filesystem fallback hits. */
export async function filterScopedHits(
  hits: UnassignedHit[],
  args: SearchScope & { projectRoot: string; signal?: AbortSignal },
): Promise<UnassignedHit[]> {
  const rootReal = await realpath(args.projectRoot);
  const prefix = args.path ? relativeSearchPath(args.projectRoot, args.path) : undefined;
  if (args.path && prefix === undefined) return [];
  const out: UnassignedHit[] = [];
  for (const hit of hits) {
    args.signal?.throwIfAborted();
    const path = relativeSearchPath(args.projectRoot, hit.path);
    if (path === undefined || !matchesSearchScope(path, { ...args, path: prefix })) continue;
    const absolute = await resolveProjectFile(args.projectRoot, hit.path);
    if (!absolute) continue;
    const physical = relative(rootReal, absolute).replace(/\\/g, "/");
    if (!matchesSearchScope(physical, { ...args, path: undefined })) continue;
    out.push({ ...hit, path });
  }
  args.signal?.throwIfAborted();
  return out;
}
