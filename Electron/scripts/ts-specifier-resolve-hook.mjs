/**
 * Resolve a relative specifier to the TypeScript source it means, when no emitted file
 * matches it.
 *
 * Our runtime sources address each other the way Pi's own loader accepts: `./x.js` (the
 * TypeScript-ESM convention, correct once `tsc` has emitted) and bare `./x` (extensionless,
 * which Node ESM never resolves). Node's type stripping rewrites neither, so loading an
 * unbuilt source tree dies at the first relative import. That is why `pi-goal` and
 * `context-fold` sat in `check-boss-tool-policy`'s "not covered" list: every tool they
 * register was invisible to the check that exists to prove tools get introduced.
 *
 * A resolve hook rather than a different loader, deliberately. The alternative is tsx, which
 * loads these files as CommonJS — and under CommonJS the extensions importing
 * `@earendil-works/pi-ai` fail instead, because that package's export map has no `require`
 * condition. Rewriting the specifier keeps Node's ESM semantics and its type stripping.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RELATIVE = /^\.{1,2}\//;

/** Candidate rewrites, in the order Pi's own resolution would consider them. */
function candidates(specifier) {
  if (specifier.endsWith(".js")) return [`${specifier.slice(0, -3)}.ts`];
  if (/\.[cm]?[jt]sx?$/.test(specifier)) return [];
  return [`${specifier}.ts`, `${specifier}/index.ts`];
}

const onDisk = (specifier, parentURL) => {
  try {
    return existsSync(fileURLToPath(new URL(specifier, parentURL)));
  } catch {
    // A specifier that will not form a file URL is not ours to rewrite.
    return false;
  }
};

export async function resolve(specifier, context, nextResolve) {
  if (RELATIVE.test(specifier) && context.parentURL?.startsWith("file:")) {
    // Only when the specifier as written is genuinely absent: a built tree must keep
    // resolving to its own output, or this hook would quietly check something else.
    if (!onDisk(specifier, context.parentURL)) {
      for (const candidate of candidates(specifier)) {
        if (onDisk(candidate, context.parentURL)) return nextResolve(candidate, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
