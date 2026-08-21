import { existsSync, lstatSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { EXTENSION_ID_RE } from "./extension-manifest.js";
import { EXTENSIONS_DIRNAME, projectExtensionsRoot } from "./extension-loader.js";
import type { ExtensionOrigin } from "./extension-registry.js";
import { projectPiAgentDir } from "./project-pi-home.js";

export class ExtensionUninstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionUninstallError";
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function realpathOrResolve(path: string): string {
  try {
    if (existsSync(path)) return realpathSync(path);
  } catch {
    /* fall through */
  }
  return resolve(path);
}

export function assertUninstallableExtensionId(id: string): string {
  const trimmed = id.trim();
  if (!EXTENSION_ID_RE.test(trimmed)) {
    throw new ExtensionUninstallError(`invalid extension id '${id}'`);
  }
  return trimmed;
}

export function uninstallJail(input: { origin: ExtensionOrigin; appRoot: string; projectRoot?: string }): string {
  if (input.origin === "builtin") {
    throw new ExtensionUninstallError("builtin extensions cannot be uninstalled");
  }
  if (input.origin === "app") return resolve(input.appRoot);
  if (!input.projectRoot) {
    throw new ExtensionUninstallError("project-scoped uninstall requires a project");
  }
  return resolve(projectExtensionsRoot(input.projectRoot));
}

/**
 * Delete a user/project package directory. Refuses builtins and any path that
 * escapes the origin jail (id shape + realpath prefix).
 */
export async function removeExtensionPackageDirectory(input: {
  id: string;
  origin: ExtensionOrigin;
  directory: string;
  appRoot: string;
  projectRoot?: string;
}): Promise<void> {
  const id = assertUninstallableExtensionId(input.id);
  if (input.origin === "builtin") {
    throw new ExtensionUninstallError("builtin extensions cannot be uninstalled");
  }
  const jail = uninstallJail(input);
  const outer =
    input.origin === "project" && input.projectRoot
      ? realpathOrResolve(projectPiAgentDir(input.projectRoot))
      : realpathOrResolve(jail);
  const realJail = realpathOrResolve(jail);
  if (!isInside(outer, realJail) && realJail !== outer) {
    throw new ExtensionUninstallError(`install jail escapes project home for ${id}`);
  }
  const packageDir = join(jail, id);
  const reported = resolve(input.directory);
  let reportedReal = reported;
  try {
    if (existsSync(reported)) reportedReal = realpathSync(reported);
  } catch {
    throw new ExtensionUninstallError(`unable to resolve extension directory for ${id}`);
  }
  if (!isInside(realJail, reportedReal) || reportedReal === realJail) {
    throw new ExtensionUninstallError(`extension directory escapes install jail for ${id}`);
  }
  if (basename(reportedReal) !== id) {
    throw new ExtensionUninstallError(`extension directory does not match id ${id}`);
  }
  const deleteTarget = existsSync(packageDir) ? packageDir : reported;
  if (existsSync(deleteTarget) && lstatSync(deleteTarget).isSymbolicLink()) {
    const linkTarget = realpathSync(deleteTarget);
    if (!isInside(realJail, linkTarget) || linkTarget === realJail) {
      throw new ExtensionUninstallError(`extension directory escapes install jail for ${id}`);
    }
  }
  const deleteReal = realpathOrResolve(deleteTarget);
  if (!isInside(realJail, deleteReal) || deleteReal === realJail || basename(deleteReal) === EXTENSIONS_DIRNAME) {
    throw new ExtensionUninstallError(`refusing to delete path outside package jail for ${id}`);
  }
  await rm(deleteTarget, { recursive: true, force: true });
}
