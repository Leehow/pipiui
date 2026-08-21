import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  EXTENSION_MANIFEST_FILENAME,
  originPrecedence,
  parseExtensionManifestJson,
  type ExtensionUiSummary,
  type ManifestValidation,
  type ValidatedExtensionManifest,
} from "./extension-manifest.js";
import {
  type ExtensionDescriptor,
  type ExtensionLifecycleState,
  type ExtensionOrigin,
  type ExtensionRecord,
  type ExtensionRegistry,
} from "./extension-registry.js";
import { projectPiAgentDir } from "./project-pi-home.js";
import type { SpawnRegisteredExtension } from "./spawn-assembly.js";

export const EXTENSIONS_DIRNAME = "extensions";

export type DiscoveredExtensionPackage = {
  origin: ExtensionOrigin;
  directory: string;
  manifestPath: string;
  directoryName: string;
};

export type ExtensionListItem = ExtensionRecord & {
  source: ExtensionOrigin;
  capabilities: readonly string[];
  ui?: ExtensionUiSummary;
  /** Package install directory; app-half `entry` paths resolve against this. */
  directory?: string;
  grantedCapabilities?: readonly string[];
};

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".DS_Store"]);

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function confinedJoin(root: string, rel: string): string | undefined {
  if (!rel.trim()) return undefined;
  const candidate = resolve(root, rel);
  return isInside(root, candidate) ? candidate : undefined;
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

function readDirSafe(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** Scan `{root}/<id>/pipiui-extension.json`. Entries that escape `jail` are skipped. */
export function scanExtensionDirectory(root: string, origin: ExtensionOrigin, jail = root): DiscoveredExtensionPackage[] {
  if (!root || !existsSync(root)) return [];
  const confinedRoot = confinedRealpath(root, jail);
  if (!confinedRoot) return [];
  const out: DiscoveredExtensionPackage[] = [];
  for (const name of readDirSafe(confinedRoot)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const candidate = join(confinedRoot, name);
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch {
      continue;
    }
    const directory = confinedRealpath(candidate, jail);
    if (!directory) continue;
    try {
      if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
      if (!lstatSync(directory).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(directory, EXTENSION_MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) continue;
    const confinedManifest = confinedRealpath(manifestPath, jail);
    if (!confinedManifest) continue;
    out.push({ origin, directory, manifestPath: confinedManifest, directoryName: basename(directory) });
  }
  return out.sort((a, b) => a.directoryName.localeCompare(b.directoryName));
}

export function builtinExtensionsRoot(runtimeRoot: string): string {
  return join(runtimeRoot, EXTENSIONS_DIRNAME);
}

export function appExtensionsRoot(agentDir: string): string {
  return join(agentDir, EXTENSIONS_DIRNAME);
}

export function projectExtensionsRoot(projectRoot: string): string {
  return join(projectPiAgentDir(projectRoot), EXTENSIONS_DIRNAME);
}

/**
 * Scan three install locations (D10). `projectRoot` is the opened project directory;
 * only `{project}/.pi/agent/extensions` is read — never another project's home.
 */
export function scanExtensionLocations(input: {
  builtinRoot?: string;
  appRoot?: string;
  projectRoot?: string;
}): DiscoveredExtensionPackage[] {
  const found: DiscoveredExtensionPackage[] = [];
  if (input.builtinRoot) found.push(...scanExtensionDirectory(input.builtinRoot, "builtin"));
  if (input.appRoot) found.push(...scanExtensionDirectory(input.appRoot, "app"));
  if (input.projectRoot) {
    const jail = projectPiAgentDir(input.projectRoot);
    found.push(...scanExtensionDirectory(projectExtensionsRoot(input.projectRoot), "project", jail));
  }
  return found;
}

/**
 * Same id: project > app > builtin for instance selection.
 * Builtin files are never replaced on disk; a builtin instance already in the registry wins.
 */
export function resolveExtensionInstances(
  packages: readonly DiscoveredExtensionPackage[],
  reservedBuiltinIds?: ReadonlySet<string>,
): DiscoveredExtensionPackage[] {
  const chosen = new Map<string, DiscoveredExtensionPackage>();
  const order: ExtensionOrigin[] = ["builtin", "app", "project"];
  const sorted = [...packages].sort((a, b) => order.indexOf(a.origin) - order.indexOf(b.origin));
  for (const pkg of sorted) {
    let parsed: ManifestValidation;
    try {
      parsed = parseExtensionManifestJson(readFileSync(pkg.manifestPath, "utf8"));
    } catch {
      parsed = { ok: false, errors: ["unreadable manifest"] };
    }
    const id = (parsed.ok ? parsed.manifest.id : parsed.fallbackId) ?? pkg.directoryName;
    if (reservedBuiltinIds?.has(id) && pkg.origin !== "builtin") continue;
    const current = chosen.get(id);
    if (!current || originPrecedence(pkg.origin) >= originPrecedence(current.origin)) {
      chosen.set(id, pkg);
    }
  }
  return [...chosen.values()];
}

function readPackage(pkg: DiscoveredExtensionPackage): { validation: ManifestValidation; textError?: string } {
  try {
    return { validation: parseExtensionManifestJson(readFileSync(pkg.manifestPath, "utf8")) };
  } catch (error) {
    return {
      validation: {
        ok: false,
        errors: [`unable to read manifest: ${error instanceof Error ? error.message : String(error)}`],
        fallbackId: pkg.directoryName,
      },
    };
  }
}

function descriptorFrom(
  pkg: DiscoveredExtensionPackage,
  manifest: ValidatedExtensionManifest | undefined,
  fallbackId: string,
): ExtensionDescriptor {
  const id = manifest?.id ?? fallbackId;
  return {
    id,
    name: manifest?.name ?? pkg.directoryName,
    version: manifest?.version ?? "0.0.0",
    origin: pkg.origin,
    uninstallable: pkg.origin !== "builtin",
    defaultEnabled: pkg.origin === "builtin",
    capabilities: manifest?.capabilities ?? [],
    settings: manifest?.settings,
  };
}

function unloadSafe(registry: ExtensionRegistry, id: string): void {
  const rec = registry.get(id);
  if (!rec || rec.origin === "builtin") return;
  if (rec.state === "error") {
    registry.unload(id);
    return;
  }
  if (rec.state === "enabled" || rec.state === "loaded" || rec.state === "discovered") {
    if (rec.state === "discovered") registry.enterError(id, "replaced");
    else registry.disable(id);
  }
  if (registry.get(id)) registry.unload(id);
}

function packageId(pkg: DiscoveredExtensionPackage): string {
  const { validation } = readPackage(pkg);
  return (validation.ok ? validation.manifest.id : validation.fallbackId) ?? pkg.directoryName;
}

export type ExtensionLoaderOptions = {
  registry: ExtensionRegistry;
  builtinRoot: string;
  appRoot: string;
};

export class ExtensionLoader {
  private readonly registry: ExtensionRegistry;
  private readonly builtinRoot: string;
  private readonly appRoot: string;
  private readonly ui = new Map<string, ExtensionUiSummary>();
  private readonly directories = new Map<string, string>();
  private readonly agent = new Map<string, { extensionPath?: string; skillRoots: string[] }>();
  private readonly reservedBuiltinIds: Set<string>;
  private loadedProjectRoot?: string;

  constructor(options: ExtensionLoaderOptions) {
    this.registry = options.registry;
    this.builtinRoot = options.builtinRoot;
    this.appRoot = options.appRoot;
    this.reservedBuiltinIds = new Set(
      options.registry.list().filter((item) => item.origin === "builtin").map((item) => item.id),
    );
  }

  /**
   * Rescan. Pass a project directory to include that project's extensions home only.
   * Omitting project unloads project-origin instances so they cannot leak across projects.
   */
  scan(projectRoot?: string): ExtensionRecord[] {
    const discovered = scanExtensionLocations({
      builtinRoot: this.builtinRoot,
      appRoot: this.appRoot,
      projectRoot,
    });
    const resolved = resolveExtensionInstances(discovered, this.reservedBuiltinIds);
    const desired = new Set(resolved.map((pkg) => packageId(pkg)));

    for (const rec of this.registry.list()) {
      if (rec.origin !== "project") continue;
      if (!projectRoot || !desired.has(rec.id)) this.drop(rec.id);
    }

    const records: ExtensionRecord[] = [];
    for (const pkg of resolved) records.push(this.loadOne(pkg));
    this.loadedProjectRoot = projectRoot ? resolve(projectRoot) : undefined;
    return records;
  }

  private drop(id: string): void {
    unloadSafe(this.registry, id);
    this.ui.delete(id);
    this.directories.delete(id);
    this.agent.delete(id);
  }

  private rememberAgent(id: string, directory: string, manifest?: ValidatedExtensionManifest): void {
    if (!manifest) {
      this.agent.delete(id);
      return;
    }
    const extensionPath = manifest.agentExtension ? confinedJoin(directory, manifest.agentExtension) : undefined;
    const skillRoots = (manifest.agentSkills ?? [])
      .map((rel) => confinedJoin(directory, rel))
      .filter((path): path is string => Boolean(path));
    this.agent.set(id, extensionPath ? { extensionPath, skillRoots } : { skillRoots });
  }

  /** Overlay-aware agent-half mounts for a new session spawn (D3 / D9: not hot-mounted). */
  spawnPackages(overlay?: Record<string, boolean>): SpawnRegisteredExtension[] {
    const out: SpawnRegisteredExtension[] = [];
    for (const record of this.registry.list(overlay)) {
      const info = this.agent.get(record.id);
      const item: SpawnRegisteredExtension = { id: record.id, enabled: record.state === "enabled" };
      if (info?.extensionPath) item.extensionPath = info.extensionPath;
      if (info?.skillRoots.length) item.skillRoots = info.skillRoots;
      out.push(item);
    }
    return out;
  }

  private loadOne(pkg: DiscoveredExtensionPackage): ExtensionRecord {
    const { validation } = readPackage(pkg);
    const fallbackId = (validation.ok ? validation.manifest.id : validation.fallbackId) ?? pkg.directoryName;
    const manifest = validation.ok ? validation.manifest : undefined;
    const descriptor = descriptorFrom(pkg, manifest, fallbackId);
    const existing = this.registry.get(descriptor.id);
    if (pkg.origin !== "builtin" && this.reservedBuiltinIds.has(descriptor.id)) {
      if (existing) return existing;
    }
    if (existing && this.directories.get(descriptor.id) === pkg.directory) {
      if (!validation.ok && existing.state !== "error") {
        this.rememberAgent(descriptor.id, pkg.directory, undefined);
        return this.registry.enterError(descriptor.id, validation.errors.join("; "));
      }
      if (manifest?.ui) this.ui.set(descriptor.id, manifest.ui);
      this.rememberAgent(descriptor.id, pkg.directory, manifest);
      return existing;
    }
    if (existing) this.drop(descriptor.id);
    const record = this.registry.ingest(descriptor);
    this.directories.set(descriptor.id, pkg.directory);
    if (manifest?.ui) this.ui.set(descriptor.id, manifest.ui);
    else this.ui.delete(descriptor.id);
    if (!validation.ok) {
      this.rememberAgent(descriptor.id, pkg.directory, undefined);
      return this.registry.enterError(descriptor.id, validation.errors.join("; "));
    }
    this.rememberAgent(descriptor.id, pkg.directory, manifest);
    return record;
  }

  loadedProject(): string | undefined {
    return this.loadedProjectRoot;
  }

  directoryOf(id: string): string | undefined {
    return this.directories.get(id);
  }

  forget(id: string): void {
    this.drop(id);
  }

  list(overlay?: Record<string, boolean>): ExtensionListItem[] {
    return this.registry.list(overlay).map((record) => this.summarize(record));
  }

  private summarize(record: ExtensionRecord): ExtensionListItem {
    const ui = this.ui.get(record.id);
    let capabilities: readonly string[] = [];
    try {
      capabilities = this.registry.capabilities(record.id);
    } catch {
      capabilities = [];
    }
    const item: ExtensionListItem = {
      ...record,
      source: record.origin,
      capabilities,
    };
    if (ui) item.ui = ui;
    const directory = this.directories.get(record.id);
    if (directory) item.directory = directory;
    return item;
  }
}

export function createExtensionLoader(options: ExtensionLoaderOptions): ExtensionLoader {
  return new ExtensionLoader(options);
}

export type { ExtensionLifecycleState };
