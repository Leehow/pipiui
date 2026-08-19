import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Install pi's extension tree into the runtime root this host mounts from.
 *
 * The source is one Electron-owned tree. Its directories are stage-swapped independently so
 * managed npm packages living beside them survive refreshes and a failed copy preserves the
 * previously installed runtime.
 */
/** Dev-only build artifacts. The shipped tree carries none of them (`pi-ext` is ~1.5 MB). */
const SKIP_ENTRIES = new Set(["node_modules", ".git", ".DS_Store", "out", "dist", "release", ".cua-driver-cache"]);
const SIGNATURE_FILE = ".pipiui-install.json";
let stagingSeq = 0;

export type InstallReport = { installed: string[]; unchanged: string[]; failures: string[] };

const emptyReport = (): InstallReport => ({ installed: [], unchanged: [], failures: [] });

/**
 * Content signature of a source tree: relative path + size + mtime.
 * Cheap enough to run on every launch and precise enough that an untouched tree is never
 * recopied, so a no-op refresh never churns a live session's mounted tree.
 */
export function treeSignature(root: string, options: { keepNodeModules?: boolean } = {}): string {
  const skip = new Set(SKIP_ENTRIES);
  if (options.keepNodeModules) skip.delete("node_modules");
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skip.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const stat = statSync(path);
      parts.push(`${relative(root, path)}#${stat.size}#${Math.round(stat.mtimeMs)}`);
    }
  };
  walk(root);
  return parts.join(";");
}

const storedSignature = (dest: string): string | undefined => {
  try { return JSON.parse(readFileSync(join(dest, SIGNATURE_FILE), "utf8")).signature } catch { return undefined }
};

/**
 * Signature-gated stage-and-swap copy.
 *
 * The swap window is one `rename` rather than the whole copy because this tree is what live
 * sessions resolve `-e` paths against: a half-copied `pi-ext` would take a session down with an
 * unreadable extension. A failed copy leaves the previous tree exactly as it was.
 */
export function syncTree(source: string, dest: string, report: InstallReport = emptyReport(), options: { keepNodeModules?: boolean } = {}): InstallReport {
  if (!existsSync(source)) { report.failures.push(`${dest}: source missing at ${source}`); return report }
  const signature = treeSignature(source, options);
  if (existsSync(dest) && storedSignature(dest) === signature) { report.unchanged.push(dest); return report }
  // Unique per call, not just per process: two sessions can spawn at once, and both refresh the
  // tree before assembling their paths.
  const staging = `${dest}.staging-${process.pid}-${(stagingSeq += 1)}`;
  try {
    rmSync(staging, { recursive: true, force: true });
    const skip = new Set(SKIP_ENTRIES);
    if (options.keepNodeModules) skip.delete("node_modules");
    cpSync(source, staging, { recursive: true, filter: path => {
      const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
      return !skip.has(name) && !name.endsWith(".tsbuildinfo");
    } });
    writeFileSync(join(staging, SIGNATURE_FILE), JSON.stringify({ signature, installedAt: new Date().toISOString() }), "utf8");
    rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
    report.installed.push(dest);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    report.failures.push(`${dest}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}

export type RuntimeAssets = {
  /** Canonical source layout: pi-ext, pi-philosophy, extensions, built-in-skills, browser-dom, auth. */
  sourceRoot?: string;
};

/**
 * One call that brings a runtime root up to the shipped sources.
 *
 * Every missing asset is a reported failure, never a silent skip: the whole reason this gap
 * survived so long is that the old installers returned `undefined` when their source was absent,
 * so an Electron session ran with no philosophy and no subagent and said nothing about it.
 */
export function installRuntimeTree(assets: RuntimeAssets, runtimeRoot: string): InstallReport {
  const report = emptyReport();
  mkdirSync(runtimeRoot, { recursive: true });
  if (!assets.sourceRoot) {
    report.failures.push("runtime source root: no source path resolved");
    return report;
  }
  for (const name of ["pi-ext", "pi-philosophy", "extensions", "built-in-skills", "pi-goal"] as const)
    syncTree(join(assets.sourceRoot, name), join(runtimeRoot, name), report);
  syncTree(join(assets.sourceRoot, "pdf-inspector"), join(runtimeRoot, "pdf-inspector"), report, { keepNodeModules: true });
  return report;
}
