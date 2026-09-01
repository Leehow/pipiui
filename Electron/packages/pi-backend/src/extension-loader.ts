import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  EXTENSION_L2_CAPABILITIES,
  EXTENSION_ID_RE,
  EXTENSION_MANIFEST_FILENAME,
  originPrecedence,
  parseExtensionManifestJson,
  type ExtensionAgentPatch,
  type ExtensionUiSummary,
  type ManifestValidation,
  type ValidatedExtensionManifest,
} from "./extension-manifest.js";
import {
  type ContributionClaim,
  type ExtensionAuthContribution,
} from "./extension-provider-contract.js";
import {
  type ExtensionGrantSeed,
  seedProjectExtensionGrantsSync,
} from "./extension-grants.js";
import {
  CORE_CAPABILITY_EXTENSION_IDS,
  type ExtensionDescriptor,
  type ExtensionEnableScope,
  type ExtensionLifecycleState,
  type ExtensionOrigin,
  type ExtensionRecord,
  type ExtensionRegistry,
  type ExtensionSettingsManifest,
} from "./extension-registry.js";
import type { ExtensionUpdateComponent } from "./extension-update-components.js";
import { projectPiAgentDir } from "./project-pi-home.js";
import type {
  SpawnAgentContribution,
  SpawnAgentContributionPatch,
  SpawnContributionDiagnostic,
  SpawnRegisteredExtension,
} from "./spawn-assembly.js";
import type { InstalledProfileExtension } from "./profile-resolver.js";

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
  /** Declared host-surface permissions (closed first-version enum; host capability gate input). */
  permissions?: readonly string[];
  ui?: ExtensionUiSummary;
  /** Declarative contributions surfaced to the renderer (Extensions-tab schema forms). */
  contributions?: {
    settings?: { scope?: ExtensionEnableScope; schema?: ExtensionSettingsManifest["schema"] };
    settingsSections?: ExtensionUiSummary["settingsSections"];
    auth?: ExtensionAuthContribution;
  };
  /** Package install directory; app-half `entry` paths resolve against this. */
  directory?: string;
  grantedCapabilities?: readonly string[];
  /** Declared open-source update components (metadata only; checks stay host-side). */
  updateComponents?: ExtensionUpdateComponent[];
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

const EXTENSION_UI_ENTRY_MAX_BYTES = 2 * 1024 * 1024;

function declaredUiEntryPaths(ui: ExtensionUiSummary | undefined): Set<string> {
  if (!ui) return new Set();
  const entries = [
    ...(ui.panels ?? []).map(item => item.entry),
    ...(ui.toolRenderers ?? []).map(item => item.entry),
    ...(ui.documentRenderers ?? []).map(item => item.entry),
    ...(ui.settingsSections ?? []).map(item => item.entry),
    ...(ui.views ?? []).map(item => item.entry),
    ...(ui.headerActions ?? []).map(item => item.entry),
  ].filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()));
  return new Set(entries.map(entry => entry.trim()));
}

/** Matches runtime prompt-file cap so oversized prompts never enter the snapshot. */
const EXTENSION_CONTRIB_PROMPT_MAX_BYTES = 64 * 1024;

function contribDiagnostic(
  extensionId: string,
  code: string,
  message: string,
  agentName?: string,
): SpawnContributionDiagnostic {
  return {
    severity: "error",
    code,
    message,
    extensionId,
    ...(agentName ? { agentName } : {}),
  };
}

function resolveConfinedContributionFile(
  jail: string,
  rel: string,
  kind: "agent" | "prompt",
): { path?: string; code?: string; message?: string } {
  const joined = confinedJoin(jail, rel);
  if (!joined) {
    return { code: "contribution-path-escape", message: `Contribution ${kind} path escaped the extension root: ${rel}` };
  }
  if (!existsSync(joined)) {
    return { code: "contribution-missing-file", message: `Contribution ${kind} path is missing: ${rel}` };
  }
  const real = confinedRealpath(joined, jail);
  if (!real) {
    return { code: "contribution-path-escape", message: `Contribution ${kind} path escaped the extension root: ${rel}` };
  }
  try {
    const stat = lstatSync(real);
    if (!stat.isFile()) {
      return { code: "contribution-missing-file", message: `Contribution ${kind} path is not a file: ${rel}` };
    }
    if (kind === "prompt" && stat.size > EXTENSION_CONTRIB_PROMPT_MAX_BYTES) {
      return {
        code: "contribution-prompt-invalid",
        message: `Contribution prompt file exceeds ${EXTENSION_CONTRIB_PROMPT_MAX_BYTES} bytes: ${rel}`,
      };
    }
  } catch {
    return { code: "contribution-missing-file", message: `Contribution ${kind} path is missing: ${rel}` };
  }
  return { path: real };
}

function isL2RefusedOrigin(origin: ExtensionOrigin, capabilities: readonly string[]): boolean {
  if (origin === "builtin") return false;
  return capabilities.some((cap) => (EXTENSION_L2_CAPABILITIES as readonly string[]).includes(cap));
}

type RememberedAgentContribution = {
  agents: string[];
  patches: SpawnAgentContributionPatch[];
};

type RememberedAgent = {
  extensionPath?: string;
  extensionIdentity?: string;
  skillRoots: string[];
  root: string;
  contribution?: RememberedAgentContribution;
  contributionDiagnostics?: SpawnContributionDiagnostic[];
  mountDiagnostics?: SpawnContributionDiagnostic[];
};

function agentExtensionIdentity(stat: { dev: number; ino: number }): string {
  return `${stat.dev}:${stat.ino}`;
}

/**
 * `agent.extension` must be a regular file inside the canonical extension root.
 * The entry itself and every root→entry path component must not be a symlink.
 */
function resolveUnaliasedAgentExtension(
  root: string,
  rel: string,
): { path?: string; identity?: string; missing?: boolean; code?: string; message?: string } {
  const joined = confinedJoin(root, rel);
  if (!joined) {
    return { missing: true, code: "agent-extension-escape", message: `agent.extension does not exist: ${rel}` };
  }
  const rootResolved = resolve(root);
  const relFromRoot = relative(rootResolved, joined);
  if (!relFromRoot || relFromRoot.startsWith("..") || isAbsolute(relFromRoot)) {
    return { missing: true, code: "agent-extension-escape", message: `agent.extension does not exist: ${rel}` };
  }
  let current = rootResolved;
  const parts = relFromRoot.split(/[/\\]/).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return { missing: true, code: "agent-extension-missing", message: `agent.extension does not exist: ${rel}` };
    }
    if (stat.isSymbolicLink()) {
      return { code: "agent-extension-symlink", message: "agent.extension is not a regular unaliased file" };
    }
    const last = index === parts.length - 1;
    if (last) {
      if (!stat.isFile()) {
        return { code: "agent-extension-symlink", message: "agent.extension is not a regular unaliased file" };
      }
      return { path: current, identity: agentExtensionIdentity(stat) };
    }
    if (!stat.isDirectory()) {
      return { missing: true, code: "agent-extension-missing", message: `agent.extension does not exist: ${rel}` };
    }
  }
  return { missing: true, code: "agent-extension-missing", message: `agent.extension does not exist: ${rel}` };
}

/** Resolve validated relative contribution paths. Invalid items are dropped with diagnostics; valid items are kept. */
function resolveRememberedContribution(
  root: string,
  manifest: ValidatedExtensionManifest,
  extensionId: string,
): { contribution?: RememberedAgentContribution; diagnostics: SpawnContributionDiagnostic[] } {
  const declaredAgents = manifest.agents ?? [];
  const declaredPatches = manifest.agentPatches ?? [];
  if (!declaredAgents.length && !declaredPatches.length) return { diagnostics: [] };

  const diagnostics: SpawnContributionDiagnostic[] = [];
  const agents: string[] = [];
  for (const rel of declaredAgents) {
    const resolved = resolveConfinedContributionFile(root, rel, "agent");
    if (resolved.path) {
      agents.push(resolved.path);
      continue;
    }
    diagnostics.push(contribDiagnostic(
      extensionId,
      resolved.code ?? "contribution-missing-file",
      `Extension \`${extensionId}\` ${resolved.message ?? `contribution agent path is invalid: ${rel}`}`,
    ));
  }

  const patches: SpawnAgentContributionPatch[] = [];
  for (const patch of declaredPatches) {
    const resolved = resolveRememberedPatch(root, patch, extensionId);
    if (resolved.patch) patches.push(resolved.patch);
    if (resolved.diagnostic) diagnostics.push(resolved.diagnostic);
  }
  const contribution = agents.length || patches.length ? { agents, patches } : undefined;
  return { contribution, diagnostics };
}

function resolveRememberedPatch(
  root: string,
  patch: ExtensionAgentPatch,
  extensionId: string,
): { patch?: SpawnAgentContributionPatch; diagnostic?: SpawnContributionDiagnostic } {
  const resolved: SpawnAgentContributionPatch = { target: patch.target };
  if (patch.appendPrompt) {
    const file = resolveConfinedContributionFile(root, patch.appendPrompt, "prompt");
    if (!file.path) {
      return {
        diagnostic: contribDiagnostic(
          extensionId,
          file.code ?? "contribution-missing-file",
          `Extension \`${extensionId}\` ${file.message ?? `contribution appendPrompt is invalid: ${patch.appendPrompt}`}`,
        ),
      };
    }
    resolved.appendPrompt = file.path;
  }
  if (patch.replacePrompt) {
    const file = resolveConfinedContributionFile(root, patch.replacePrompt, "prompt");
    if (!file.path) {
      return {
        diagnostic: contribDiagnostic(
          extensionId,
          file.code ?? "contribution-missing-file",
          `Extension \`${extensionId}\` ${file.message ?? `contribution replacePrompt is invalid: ${patch.replacePrompt}`}`,
        ),
      };
    }
    resolved.replacePrompt = file.path;
  }
  if (patch.addTools?.length) resolved.addTools = [...patch.addTools];
  if (patch.removeTools?.length) resolved.removeTools = [...patch.removeTools];
  return { patch: resolved };
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

/**
 * Discover App-profile content-addressed packages selected by their active
 * slot. The store is trusted only as far as a pointer resolves to a regular
 * package tree inside its own objects root; malformed pointers and escaped
 * paths are ignored fail-closed.
 *
 * This is intentionally a discovery adapter, not a second extension format:
 * after resolving the object directory, the normal manifest parser and
 * registry own every subsequent validation and lifecycle decision.
 */
export function scanActiveSharedExtensionStore(storeRoot: string): DiscoveredExtensionPackage[] {
  if (!storeRoot || !existsSync(storeRoot)) return [];
  const objectsRoot = join(storeRoot, "objects");
  const slotsRoot = join(storeRoot, "extensions");
  const objectsJail = confinedRealpath(objectsRoot, storeRoot);
  const slotsJail = confinedRealpath(slotsRoot, storeRoot);
  if (!objectsJail || !slotsJail) return [];
  const out: DiscoveredExtensionPackage[] = [];

  for (const extensionId of readDirSafe(slotsJail)) {
    if (!EXTENSION_ID_RE.test(extensionId)) continue;
    const slotDir = confinedRealpath(join(slotsJail, extensionId), slotsJail);
    if (!slotDir) continue;
    for (const slot of ["active.json", "previous.json"]) {
      let contentHash: string | undefined;
      try {
        const pointer = JSON.parse(readFileSync(join(slotDir, slot), "utf8")) as { contentHash?: unknown };
        if (typeof pointer.contentHash === "string" && /^[0-9a-f]{64}$/.test(pointer.contentHash)) {
          contentHash = pointer.contentHash;
        }
      } catch {
        /* missing/corrupt slot falls through to the previous recovery slot */
      }
      if (!contentHash) continue;
      const directory = confinedRealpath(join(objectsJail, contentHash), objectsJail);
      if (!directory) continue;
      try {
        if (!lstatSync(directory).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifestPath = confinedRealpath(join(directory, EXTENSION_MANIFEST_FILENAME), directory);
      if (!manifestPath) continue;
      try {
        const parsed = parseExtensionManifestJson(readFileSync(manifestPath, "utf8"));
        if (!parsed.ok || parsed.manifest.id !== extensionId) continue;
      } catch {
        continue;
      }
      out.push({ origin: "app", directory, manifestPath, directoryName: extensionId });
      break;
    }
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
  /** App-profile content-addressed objects addressed by active/previous slots. */
  sharedStoreRoot?: string;
  projectRoot?: string;
}): DiscoveredExtensionPackage[] {
  const found: DiscoveredExtensionPackage[] = [];
  if (input.builtinRoot) found.push(...scanExtensionDirectory(input.builtinRoot, "builtin"));
  if (input.appRoot) found.push(...scanExtensionDirectory(input.appRoot, "app"));
  if (input.sharedStoreRoot) found.push(...scanActiveSharedExtensionStore(input.sharedStoreRoot));
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
    description: manifest?.description,
    category: manifest?.category,
    origin: pkg.origin,
    uninstallable: pkg.origin !== "builtin",
    // Project-origin packages (scaffold-install bridge) default to enabled; the
    // enable overlay (writeAppExtensionEnabled / project activation) still wins
    // whenever an explicit record exists (extension-registry effectiveEnabled).
    defaultEnabled: pkg.origin === "builtin" || pkg.origin === "project",
    capabilities: manifest?.capabilities ?? [],
    settings: manifest?.settings,
    dependencies: manifest?.dependencies,
  };
}

function unloadSafe(registry: ExtensionRegistry, id: string): void {
  const rec = registry.get(id);
  if (!rec) return;
  if (rec.origin === "builtin") {
    if (rec.state === "error") registry.unload(id);
    return;
  }
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

function invalidateConflictingAgentExtensions(
  packages: SpawnRegisteredExtension[],
  remembered: ReadonlyMap<string, RememberedAgent>,
): void {
  const groups = new Map<string, SpawnRegisteredExtension[]>();
  for (const pkg of packages) {
    if (!pkg.enabled || !pkg.extensionPath) continue;
    const identity = remembered.get(pkg.id)?.extensionIdentity ?? `path:${resolve(pkg.extensionPath)}`;
    const list = groups.get(identity) ?? [];
    list.push(pkg);
    groups.set(identity, list);
  }
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const ids = [...new Set(items.map((item) => item.id))].sort();
    const label = ids.map((id) => "`" + id + "`").join(", ");
    for (const item of items) {
      item.extensionPath = undefined;
      const diagnostic = contribDiagnostic(
        item.id,
        "agent-extension-alias-conflict",
        `Extension \`${item.id}\` agent.extension identity collides with ${label}; agent-half ownership is disabled.`,
      );
      item.contributionDiagnostics = [...(item.contributionDiagnostics ?? []), diagnostic];
    }
  }
}

export type ExtensionLoaderOptions = {
  registry: ExtensionRegistry;
  builtinRoot: string;
  appRoot: string;
  /** App-profile content-addressed store; active slots overlay the app extension root. */
  sharedStoreRoot?: string;
};

export class ExtensionLoader {
  private readonly registry: ExtensionRegistry;
  private readonly builtinRoot: string;
  private readonly appRoot: string;
  private readonly sharedStoreRoot?: string;
  private readonly ui = new Map<string, ExtensionUiSummary>();
  private readonly settings = new Map<string, ExtensionSettingsManifest>();
  private readonly auth = new Map<string, ExtensionAuthContribution>();
  private readonly updateComponents = new Map<string, ExtensionUpdateComponent[]>();
  private readonly permissions = new Map<string, readonly string[]>();
  private readonly directories = new Map<string, string>();
  private readonly agent = new Map<string, RememberedAgent>();
  private readonly reservedBuiltinIds: Set<string>;
  private loadedProjectRoot?: string;

  constructor(options: ExtensionLoaderOptions) {
    this.registry = options.registry;
    this.builtinRoot = options.builtinRoot;
    this.appRoot = options.appRoot;
    this.sharedStoreRoot = options.sharedStoreRoot;
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
      sharedStoreRoot: this.sharedStoreRoot,
      projectRoot,
    });
    const resolved = resolveExtensionInstances(discovered, this.reservedBuiltinIds);
    const desired = new Set(resolved.map((pkg) => packageId(pkg)));

    for (const rec of this.registry.list()) {
      // Builtin layers are host-owned. Every non-builtin package, including a
      // content-addressed shared-store object, must converge to the current
      // scan result so a failed Pack rollback cannot leave a ghost extension
      // registered in memory.
      if (rec.origin === "builtin") continue;
      // A registry supplied by the host/test may contain entries this loader
      // never discovered. Only scanner-owned directory records participate in
      // scan convergence; injected entries remain owned by their caller.
      if (!this.directories.has(rec.id)) continue;
      if (!desired.has(rec.id)) this.drop(rec.id);
    }

    const records: ExtensionRecord[] = [];
    for (const pkg of resolved) records.push(this.loadOne(pkg));
    if (projectRoot) this.seedCoreCapabilityGrants(projectRoot);
    this.loadedProjectRoot = projectRoot ? resolve(projectRoot) : undefined;
    return records;
  }

  /**
   * Decision A (capability ships with the App, usability first): bundled
   * core-capability extensions get their manifest-declared permissions seeded
   * into the project grant store on first sight. Existing grant records are
   * never rewritten (user revocation wins); non-builtin instances of a core id
   * are never seeded; extension removal never cleans grants up. Best-effort —
   * a failed seed never breaks the scan, and the capability gate stays fail-closed.
   */
  private seedCoreCapabilityGrants(projectRoot: string): void {
    const seeds: ExtensionGrantSeed[] = [];
    for (const record of this.registry.list()) {
      if (record.origin !== "builtin" || !CORE_CAPABILITY_EXTENSION_IDS.has(record.id)) continue;
      const permissions = this.permissions.get(record.id);
      if (!permissions?.length) continue;
      seeds.push({ id: record.id, permissions });
    }
    if (!seeds.length) return;
    try {
      seedProjectExtensionGrantsSync(projectPiAgentDir(projectRoot), seeds);
    } catch {
      /* default seeding is best-effort; nothing here may block loading */
    }
  }

  private drop(id: string): void {
    unloadSafe(this.registry, id);
    this.ui.delete(id);
    this.settings.delete(id);
    this.auth.delete(id);
    this.updateComponents.delete(id);
    this.permissions.delete(id);
    this.directories.delete(id);
    this.agent.delete(id);
  }

  private rememberAgent(id: string, directory: string, manifest?: ValidatedExtensionManifest): string | undefined {
    if (!manifest) {
      this.agent.delete(id);
      return undefined;
    }
    const declared = manifest.agentExtension;
    const skillRoots = (manifest.agentSkills ?? [])
      .map((rel) => confinedJoin(directory, rel))
      .filter((path): path is string => Boolean(path));
    const root = confinedRealpath(directory, directory) ?? directory;
    const remembered: RememberedAgent = { skillRoots, root };
    if (declared) {
      const resolvedEntry = resolveUnaliasedAgentExtension(root, declared);
      if (resolvedEntry.missing) {
        this.agent.set(id, remembered);
        return resolvedEntry.message ?? `agent.extension does not exist: ${declared}`;
      }
      if (resolvedEntry.path && resolvedEntry.identity) {
        remembered.extensionPath = resolvedEntry.path;
        remembered.extensionIdentity = resolvedEntry.identity;
      } else {
        remembered.mountDiagnostics = [contribDiagnostic(
          id,
          resolvedEntry.code ?? "agent-extension-symlink",
          `Extension \`${id}\` agent.extension is not a regular unaliased file.`,
        )];
      }
    }
    const resolved = resolveRememberedContribution(root, manifest, id);
    if (resolved.contribution) remembered.contribution = resolved.contribution;
    if (resolved.diagnostics.length) remembered.contributionDiagnostics = resolved.diagnostics;
    this.agent.set(id, remembered);
    return undefined;
  }

  private contributionRefused(record: ExtensionRecord): boolean {
    try {
      return isL2RefusedOrigin(record.origin, this.registry.capabilities(record.id));
    } catch {
      return true;
    }
  }

  /** Overlay-aware agent-half mounts for a new session spawn (D3 / D9: not hot-mounted). */
  spawnPackages(overlay?: Record<string, boolean>): SpawnRegisteredExtension[] {
    const out: SpawnRegisteredExtension[] = [];
    for (const record of this.registry.list(overlay)) {
      const info = this.agent.get(record.id);
      const item: SpawnRegisteredExtension = { id: record.id, version: record.version, enabled: record.state === "enabled" };
      if (info?.extensionPath) item.extensionPath = info.extensionPath;
      if (info?.skillRoots.length) item.skillRoots = info.skillRoots;
      if (item.enabled && info && !this.contributionRefused(record)) {
        if (info.contribution) {
          const agentContribution: SpawnAgentContribution = {
            id: record.id,
            origin: record.origin,
            root: info.root,
            agents: info.contribution.agents,
            patches: info.contribution.patches,
          };
          item.agentContribution = agentContribution;
        }
        const mountAndContribution = [
          ...(info.mountDiagnostics ?? []),
          ...(info.contributionDiagnostics ?? []),
        ];
        if (mountAndContribution.length) item.contributionDiagnostics = mountAndContribution;
      } else if (info?.mountDiagnostics?.length) {
        item.contributionDiagnostics = info.mountDiagnostics;
      }
      out.push(item);
    }
    invalidateConflictingAgentExtensions(out, this.agent);
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
    if (existing && this.directories.get(descriptor.id) === pkg.directory && existing.state !== "error") {
      if (!validation.ok) {
        this.rememberAgent(descriptor.id, pkg.directory, undefined);
        return this.registry.enterError(descriptor.id, validation.errors.join("; "));
      }
      if (manifest?.ui) this.ui.set(descriptor.id, manifest.ui);
      else this.ui.delete(descriptor.id);
      if (manifest?.settings) this.settings.set(descriptor.id, manifest.settings);
      if (manifest?.auth) this.auth.set(descriptor.id, manifest.auth);
      else this.auth.delete(descriptor.id);
      if (manifest?.updateComponents) this.updateComponents.set(descriptor.id, manifest.updateComponents);
      else this.updateComponents.delete(descriptor.id);
      if (manifest?.permissions) this.permissions.set(descriptor.id, manifest.permissions);
      else this.permissions.delete(descriptor.id);
      const missingAgent = this.rememberAgent(descriptor.id, pkg.directory, manifest);
      if (missingAgent) {
        return this.registry.enterError(descriptor.id, missingAgent);
      }
      return existing;
    }
    if (existing) this.drop(descriptor.id);
    const record = this.registry.ingest(descriptor);
    this.directories.set(descriptor.id, pkg.directory);
    if (manifest?.ui) this.ui.set(descriptor.id, manifest.ui);
    else this.ui.delete(descriptor.id);
    if (manifest?.settings) this.settings.set(descriptor.id, manifest.settings);
    else this.settings.delete(descriptor.id);
    if (manifest?.auth) this.auth.set(descriptor.id, manifest.auth);
    else this.auth.delete(descriptor.id);
    if (manifest?.updateComponents) this.updateComponents.set(descriptor.id, manifest.updateComponents);
    else this.updateComponents.delete(descriptor.id);
    if (manifest?.permissions) this.permissions.set(descriptor.id, manifest.permissions);
    else this.permissions.delete(descriptor.id);
    if (!validation.ok) {
      this.rememberAgent(descriptor.id, pkg.directory, undefined);
      return this.registry.enterError(descriptor.id, validation.errors.join("; "));
    }
    const missingAgent = this.rememberAgent(descriptor.id, pkg.directory, manifest);
    if (missingAgent) return this.registry.enterError(descriptor.id, missingAgent);
    return record;
  }

  loadedProject(): string | undefined {
    return this.loadedProjectRoot;
  }

  directoryOf(id: string): string | undefined {
    return this.directories.get(id);
  }

  /** Read only an entry declared by this extension's validated app.ui manifest. */
  readUiEntrySource(id: string, entry: string): string {
    const relativeEntry = entry.trim();
    if (!relativeEntry || !declaredUiEntryPaths(this.ui.get(id)).has(relativeEntry)) {
      throw new Error(`extension ${id} has no declared UI entry '${relativeEntry || entry}'`);
    }
    const directory = this.directories.get(id);
    const candidate = directory ? confinedJoin(directory, relativeEntry) : undefined;
    const real = candidate && directory ? confinedRealpath(candidate, directory) : undefined;
    if (!real) throw new Error(`extension ${id} UI entry is unavailable`);
    try {
      const stat = lstatSync(real);
      if (!stat.isFile()) throw new Error("not a regular file");
      if (stat.size > EXTENSION_UI_ENTRY_MAX_BYTES) throw new Error("entry is too large");
      return readFileSync(real, "utf8");
    } catch {
      throw new Error(`extension ${id} UI entry is unavailable`);
    }
  }

  authContribution(id: string): ExtensionAuthContribution | undefined {
    return this.auth.get(id);
  }

  contributionClaims(overlay?: Record<string, boolean>): ContributionClaim[] {
    const claims: ContributionClaim[] = [];
    for (const record of this.registry.list(overlay)) {
      const contribution = this.auth.get(record.id);
      if (!contribution) continue;
      claims.push({
        extensionId: record.id,
        enabled: record.state === "enabled",
        contribution,
      });
    }
    return claims;
  }

  forget(id: string): void {
    this.drop(id);
  }

  list(overlay?: Record<string, boolean>): ExtensionListItem[] {
    return this.registry.list(overlay).map((record) => this.summarize(record));
  }

  profileExtensions(): InstalledProfileExtension[] {
    return this.registry.list().map(record => {
      const dependencies = this.registry.dependencies(record.id);
      return {
        id: record.id,
        version: record.version,
        ...(dependencies ? { dependencies } : {}),
      };
    });
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
    const settings = this.settings.get(record.id);
    const settingsSections = ui?.settingsSections;
    const auth = this.auth.get(record.id);
    if (settings || settingsSections || auth) {
      item.contributions = {
        ...(settings ? { settings: { scope: settings.scope, schema: settings.schema } } : {}),
        ...(settingsSections ? { settingsSections } : {}),
        ...(auth ? { auth } : {}),
      };
    }
    const directory = this.directories.get(record.id);
    if (directory) item.directory = directory;
    const updateComponents = this.updateComponents.get(record.id);
    if (updateComponents) item.updateComponents = updateComponents;
    const permissions = this.permissions.get(record.id);
    if (permissions) item.permissions = permissions;
    return item;
  }
}

export function createExtensionLoader(options: ExtensionLoaderOptions): ExtensionLoader {
  return new ExtensionLoader(options);
}

export type { ExtensionLifecycleState };
