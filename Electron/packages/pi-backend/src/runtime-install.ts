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
const SKIP_ENTRIES = new Set(["node_modules", ".git", ".DS_Store", "out", "dist", "release", "target", ".cua-driver-cache"]);
/**
 * Bundled manifest extensions whose compiled agent/app halves live in `dist/`
 * (spec D10: builtins live in the Bundled runtime extensions tree). They are
 * re-synced with `keepDist` after the generic `extensions` pass so their build
 * artifacts survive both the signature and the copy.
 *
 * `pdf-extension` additionally keeps its owned vendored dependency tree
 * (`vendor/pdf-inspector/node_modules`, see BUNDLED_KEEP_NODE_MODULES) so its
 * compiled agent resolves the pdf-inspector native/WASM engine relative to
 * itself instead of through a host path contract.
 */
export const BUNDLED_MANIFEST_EXTENSIONS: readonly string[] = ["grok-build-oauth", "code-retrieval", "git-capability", "deepseek", "qoder", "pipiui-headroom", "office-extension", "pdf-extension", "vision-routing", "web-search-keys", "external-session-scan", "pipiui-theme-pack"];
/** Bundled manifest extensions that ship an owned `node_modules` inside their mirrored tree. */
const BUNDLED_KEEP_NODE_MODULES: ReadonlySet<string> = new Set(["pdf-extension"]);
/** Optional packaging-time selection of dist/node_modules-heavy runtime assets. */
export const RUNTIME_BUNDLE_MANIFEST_FILENAME = "pipiui-runtime-manifest.json";
export const RUNTIME_BUNDLE_MANIFEST_SCHEMA_VERSION = 1 as const;
const SIGNATURE_FILE = ".pipiui-install.json";
let stagingSeq = 0;

export type InstallReport = { installed: string[]; unchanged: string[]; failures: string[] };

const emptyReport = (): InstallReport => ({ installed: [], unchanged: [], failures: [] });

type RuntimeBundleSelection = {
  bundledExtensions: readonly string[];
  includeAnydoc: boolean;
};

/**
 * Older development trees have no bundle manifest and retain the historical
 * full Coding payload. A packaged base edition supplies an explicit empty list,
 * so omitted optional artifacts are not reported as failed Kernel assets.
 */
function readRuntimeBundleSelection(sourceRoot: string, report: InstallReport): RuntimeBundleSelection {
  const manifestPath = join(sourceRoot, RUNTIME_BUNDLE_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return { bundledExtensions: BUNDLED_MANIFEST_EXTENSIONS, includeAnydoc: true };
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schemaVersion?: unknown;
      bundledExtensions?: unknown;
      includeAnydoc?: unknown;
    };
    if (parsed.schemaVersion !== RUNTIME_BUNDLE_MANIFEST_SCHEMA_VERSION) {
      throw new Error(`schemaVersion must be ${RUNTIME_BUNDLE_MANIFEST_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(parsed.bundledExtensions) || parsed.bundledExtensions.some(id => typeof id !== "string")) {
      throw new Error("bundledExtensions must be string[]");
    }
    if (typeof parsed.includeAnydoc !== "boolean") {
      throw new Error("includeAnydoc must be boolean");
    }
    const known = new Set(BUNDLED_MANIFEST_EXTENSIONS);
    const unknown = parsed.bundledExtensions.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`bundledExtensions contains unknown ids: ${unknown.join(", ")}`);
    return {
      bundledExtensions: [...new Set(parsed.bundledExtensions)].sort(),
      includeAnydoc: parsed.includeAnydoc,
    };
  } catch (error) {
    report.failures.push(`${manifestPath}: invalid runtime bundle manifest: ${error instanceof Error ? error.message : String(error)}`);
    return { bundledExtensions: [], includeAnydoc: false };
  }
}

/**
 * Content signature of a source tree: relative path + size + mtime.
 * Cheap enough to run on every launch and precise enough that an untouched tree is never
 * recopied, so a no-op refresh never churns a live session's mounted tree.
 */
export function treeSignature(root: string, options: { keepNodeModules?: boolean; keepDist?: boolean } = {}): string {
  const skip = new Set(SKIP_ENTRIES);
  if (options.keepNodeModules) skip.delete("node_modules");
  if (options.keepDist) skip.delete("dist");
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
export function syncTree(source: string, dest: string, report: InstallReport = emptyReport(), options: { keepNodeModules?: boolean; keepDist?: boolean } = {}): InstallReport {
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
    if (options.keepDist) skip.delete("dist");
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
  /** Canonical source layout: Kernel runtime, extensions, Product Profiles, browser-dom, and auth. */
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
  for (const name of ["pi-core-prompt", "pi-ext", "pi-philosophy", "extensions", "built-in-skills", "pi-goal", "profiles"] as const)
    syncTree(join(assets.sourceRoot, name), join(runtimeRoot, name), report);
  // Second pass: bundled manifest extensions ship compiled `dist/` halves that the
  // generic extensions sync strips. Re-sync each one over its stripped copy; a missing
  // source directory is a reported failure like any other missing asset.
  const selection = readRuntimeBundleSelection(assets.sourceRoot, report);
  for (const id of selection.bundledExtensions)
    syncTree(join(assets.sourceRoot, "extensions", id), join(runtimeRoot, "extensions", id), report,
      { keepDist: true, ...(BUNDLED_KEEP_NODE_MODULES.has(id) ? { keepNodeModules: true } : {}) });
  if (selection.includeAnydoc) {
    syncTree(join(assets.sourceRoot, "anydoc"), join(runtimeRoot, "anydoc"), report, { keepNodeModules: true });
  }
  return report;
}
