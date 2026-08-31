import {
  PROJECT_EXTENSION_ENABLED_FILE,
  DEFAULT_PRODUCT_PROFILE_ID,
  projectActivationOverlay,
  projectProductActivationPath,
  readProjectProductActivation,
  writeProjectProductActivation,
} from "./profile-store.js";
import type { ExtensionCategory } from "./extension-manifest.js";

export { PROJECT_EXTENSION_ENABLED_FILE } from "./profile-store.js";

/** Spec D4/D6 error codes. Duplicated locally so this package typechecks against frozen host-api. */
export type ExtInvokeErrorCode =
  | "not_found"
  | "disabled"
  | "no_session"
  | "capability_denied"
  | "agent_error"
  | "timeout";

/** D9 lifecycle. `unloaded` is omitted from list snapshots (registry has no residual). */
export type ExtensionLifecycleState =
  | "discovered"
  | "loaded"
  | "enabled"
  | "disabled"
  | "unloaded"
  | "error";

export type ExtensionOrigin = "builtin" | "app" | "project";
export type ExtensionEnableScope = "app" | "project";

export type ExtensionSettingsSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ExtensionSettingsMigration = {
  from: number;
  to: number;
  map: Record<string, string>;
};

export type ExtensionSettingsManifest = {
  scope: ExtensionEnableScope;
  schema: ExtensionSettingsSchema;
  settingsVersion?: number;
  migrations?: ExtensionSettingsMigration[];
};

export type ExtensionDependencyRequirement = {
  id: string;
  version: string;
};

export type ExtensionDependencies = {
  required: ExtensionDependencyRequirement[];
  optional: ExtensionDependencyRequirement[];
  conflicts: string[];
};

export type ExtensionDescriptor = {
  id: string;
  name: string;
  version: string;
  /** One-line package summary shown in the extension list. */
  description?: string;
  category?: ExtensionCategory;
  origin: ExtensionOrigin;
  /** Bundled runtime layer name (D13). */
  layer?: string;
  defaultEnabled?: boolean;
  uninstallable?: boolean;
  /** Spec D8 capability strings, e.g. `bridge.emit`. */
  capabilities?: readonly string[];
  settings?: ExtensionSettingsManifest;
  dependencies?: ExtensionDependencies;
};

export type ExtensionRecord = {
  id: string;
  name: string;
  version: string;
  /** One-line package summary shown in the extension list. */
  description?: string;
  category?: ExtensionCategory;
  origin: ExtensionOrigin;
  state: ExtensionLifecycleState;
  uninstallable: boolean;
  defaultEnabled: boolean;
  error?: string;
};

export const EXTENSION_LIFECYCLE_STATES: readonly ExtensionLifecycleState[] = [
  "discovered",
  "loaded",
  "enabled",
  "disabled",
  "unloaded",
  "error",
];

/** Legal edges from D9. Error is a sink except explicit unload (no residual). */
export const LEGAL_TRANSITIONS: Readonly<Record<ExtensionLifecycleState, readonly ExtensionLifecycleState[]>> = {
  discovered: ["loaded", "error"],
  loaded: ["enabled", "disabled", "error"],
  enabled: ["disabled", "error"],
  disabled: ["enabled", "unloaded", "error"],
  unloaded: [],
  error: ["unloaded"],
};

const ID_RE = /^[a-z][a-z0-9-]*$/;

/** Spec § D13 / brief: bundled runtime layers as first-class builtin packages. */
export const BUILTIN_EXTENSION_PACKAGES: readonly ExtensionDescriptor[] = [
  { id: "pi-ext", name: "Pi Ext", version: "1.0.0", description: "PipiUI 宿主编排扩展", category: "foundation", origin: "builtin", layer: "pi-ext", defaultEnabled: true, uninstallable: false },
  { id: "pi-philosophy", name: "Pi Philosophy", version: "1.0.0", description: "哲学层系统提示", category: "workflow", origin: "builtin", layer: "pi-philosophy", defaultEnabled: true, uninstallable: false },
  { id: "pi-goal", name: "Pi Goal", version: "1.0.0", description: "目标层系统提示", category: "workflow", origin: "builtin", layer: "pi-goal", defaultEnabled: true, uninstallable: false },
  { id: "built-in-skills", name: "Built-in Skills", version: "1.0.0", description: "内置技能集", category: "foundation", origin: "builtin", layer: "built-in-skills", defaultEnabled: true, uninstallable: false },
];

/**
 * Frozen core-capability extension packages (shared-architecture wave).
 *
 * CUA / Web Access / WebView browser / memory migrate into extensions whose tool
 * names and schemas are a frozen wire contract: web_search, fetch_content,
 * source_check, get_search_content, browser_search, browser_fetch, browser,
 * computer, open_application, memory_query, memory_status. This list freezes the
 * id → owned-tools ownership map in the shared registry; it deliberately does
 * NOT add them to `BUILTIN_EXTENSION_PACKAGES` (they have no pi runtime layer,
 * and a registry builtin whose id is also discovered from the builtinRoot tree
 * would crash `ExtensionLoader.scan` on ingest). Discovery comes from each
 * package's `pipiui-extension.json` under the runtime extensions tree.
 */
export type CoreCapabilityExtensionPackage = ExtensionDescriptor & {
  /** Tool names this extension alone owns. Names + schemas must not change. */
  ownedTools: readonly string[];
};

export const CORE_CAPABILITY_EXTENSION_PACKAGES: readonly CoreCapabilityExtensionPackage[] = [
  {
    id: "web-access-extension",
    name: "PipiUI Web Access",
    version: "0.1.0",
    description: "Web search, page fetch, source checking, and retrieval continuation.",
    origin: "builtin",
    defaultEnabled: true,
    uninstallable: false,
    ownedTools: ["web_search", "fetch_content", "source_check", "get_search_content"],
  },
  {
    id: "webview-browser-extension",
    name: "PipiUI WebView Browser",
    version: "0.1.0",
    description: "Managed browser sessions: search/fetch plus full browser automation.",
    origin: "builtin",
    defaultEnabled: true,
    uninstallable: false,
    ownedTools: ["browser_search", "browser_fetch", "browser"],
  },
  {
    id: "cua-extension",
    name: "PipiUI CUA",
    version: "0.1.0",
    description: "Computer use via the host CuaDriverHost, plus application launching.",
    origin: "builtin",
    defaultEnabled: true,
    uninstallable: false,
    ownedTools: ["computer", "open_application"],
  },
  {
    id: "memory-extension",
    name: "PipiUI Memory",
    version: "0.1.0",
    description: "Project-scoped durable memory reads via the loopback memory broker.",
    origin: "builtin",
    defaultEnabled: true,
    uninstallable: false,
    ownedTools: ["memory_query", "memory_status"],
  },
];

/** Core-capability extension ids (manifest validation enforces their extra fields). */
export const CORE_CAPABILITY_EXTENSION_IDS: ReadonlySet<string> = new Set(
  CORE_CAPABILITY_EXTENSION_PACKAGES.map((pkg) => pkg.id),
);

/** Frozen id → owned tool names map (the registry-side pin of the wire contract). */
export const CORE_CAPABILITY_TOOL_CONTRACT: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(CORE_CAPABILITY_EXTENSION_PACKAGES.map((pkg) => [pkg.id, Object.freeze([...pkg.ownedTools])])),
);

/** Every frozen core-capability tool name, in ownership order (no duplicates by construction). */
export const FROZEN_CORE_CAPABILITY_TOOL_NAMES: readonly string[] = Object.freeze(
  CORE_CAPABILITY_EXTENSION_PACKAGES.flatMap((pkg) => pkg.ownedTools),
);

/** Project-home enable overlay. Not a pi `settings.json` key (those are stripped). */
export class ExtensionLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionLifecycleError";
  }
}

export function canTransition(from: ExtensionLifecycleState, to: ExtensionLifecycleState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function assertLegalTransition(from: ExtensionLifecycleState, to: ExtensionLifecycleState): void {
  if (!canTransition(from, to)) {
    throw new ExtensionLifecycleError(`illegal extension transition: ${from} → ${to}`);
  }
}

export function validateExtensionDescriptor(descriptor: ExtensionDescriptor): string | undefined {
  if (typeof descriptor.id !== "string" || !ID_RE.test(descriptor.id)) {
    return "invalid extension id";
  }
  if (typeof descriptor.name !== "string" || !descriptor.name.trim()) {
    return "invalid extension name";
  }
  if (typeof descriptor.version !== "string" || !descriptor.version.trim()) {
    return "invalid extension version";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** App-profile enable table inside `pipiui-settings.json` `extensions` slot. */
export function readAppExtensionEnabled(settings: Record<string, unknown>): Record<string, boolean> {
  const slot = settings.extensions;
  if (!isRecord(slot)) return {};
  const out: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(slot)) {
    if (typeof value === "boolean") out[id] = value;
    else if (isRecord(value) && typeof value.enabled === "boolean") out[id] = value.enabled;
  }
  return out;
}

export function writeAppExtensionEnabled(
  settings: Record<string, unknown>,
  id: string,
  enabled: boolean,
): void {
  const slot = isRecord(settings.extensions) ? { ...settings.extensions } : {};
  const current = slot[id];
  if (isRecord(current)) slot[id] = { ...current, enabled };
  else slot[id] = { enabled };
  settings.extensions = slot;
}

export function parseProjectExtensionEnabled(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  if (value.schemaVersion === 2 && isRecord(value.overrides)) {
    const out: Record<string, boolean> = {};
    for (const [id, state] of Object.entries(value.overrides)) {
      if (state === "enabled") out[id] = true;
      else if (state === "disabled") out[id] = false;
    }
    return out;
  }
  const out: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") out[id] = enabled;
  }
  return out;
}

export function projectExtensionEnabledPath(projectAgentDir: string): string {
  return projectProductActivationPath(projectAgentDir);
}

export async function readProjectExtensionEnabled(projectAgentDir: string): Promise<Record<string, boolean>> {
  return projectActivationOverlay(await readProjectProductActivation(projectAgentDir, { defaultProfileId: DEFAULT_PRODUCT_PROFILE_ID }));
}

export async function writeProjectExtensionEnabled(
  projectAgentDir: string,
  id: string,
  enabled: boolean,
): Promise<Record<string, boolean>> {
  const current = await readProjectProductActivation(projectAgentDir, { defaultProfileId: DEFAULT_PRODUCT_PROFILE_ID });
  const next = await writeProjectProductActivation(projectAgentDir, {
    ...current,
    overrides: { ...current.overrides, [id]: enabled ? "enabled" : "disabled" },
  });
  return projectActivationOverlay(next);
}

type Entry = ExtensionRecord & {
  descriptor: ExtensionDescriptor;
  capabilities: readonly string[];
  settings?: ExtensionSettingsManifest;
};

function snapshot(entry: Entry): ExtensionRecord {
  const record: ExtensionRecord = {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    origin: entry.origin,
    state: entry.state,
    uninstallable: entry.uninstallable,
    defaultEnabled: entry.defaultEnabled,
  };
  if (entry.description) record.description = entry.description;
  if (entry.category) record.category = entry.category;
  if (entry.error) record.error = entry.error;
  return record;
}

function effectiveEnabled(entry: Entry, overlay: Record<string, boolean> | undefined): boolean {
  if (overlay && Object.prototype.hasOwnProperty.call(overlay, entry.id)) return overlay[entry.id]!;
  return entry.defaultEnabled;
}

function withOverlay(entry: Entry, overlay: Record<string, boolean> | undefined): ExtensionRecord {
  const record = snapshot(entry);
  if (record.state === "error" || record.state === "discovered" || record.state === "unloaded") return record;
  record.state = effectiveEnabled(entry, overlay) ? "enabled" : "disabled";
  return record;
}

export type ExtEmitAuth =
  | { ok: true }
  | { ok: false; error: string; errorCode: ExtInvokeErrorCode };

export class ExtensionRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly disposers = new Map<string, Array<() => void>>();
  private readonly sessionMounts = new Map<string, Set<string>>();

  constructor(builtins: readonly ExtensionDescriptor[] = BUILTIN_EXTENSION_PACKAGES) {
    for (const descriptor of builtins) this.ingest(descriptor);
  }

  /** Discover → validate → loaded; builtins then default-enable. Invalid descriptors enter error and never write. */
  ingest(descriptor: ExtensionDescriptor): ExtensionRecord {
    const existing = this.entries.get(descriptor.id);
    if (existing && existing.state !== "unloaded") {
      throw new ExtensionLifecycleError(`extension already registered: ${descriptor.id}`);
    }
    const uninstallable = descriptor.origin === "builtin" ? false : descriptor.uninstallable !== false;
    const defaultEnabled = descriptor.origin === "builtin" ? descriptor.defaultEnabled !== false : Boolean(descriptor.defaultEnabled);
    const entry: Entry = {
      id: descriptor.id,
      name: descriptor.name,
      version: descriptor.version,
      description: descriptor.description,
      category: descriptor.category,
      origin: descriptor.origin,
      state: "discovered",
      uninstallable,
      defaultEnabled,
      descriptor,
      capabilities: descriptor.capabilities ? [...descriptor.capabilities] : [],
      settings: descriptor.settings,
    };
    this.entries.set(descriptor.id, entry);
    const invalid = validateExtensionDescriptor(descriptor);
    if (invalid) {
      this.enterError(descriptor.id, invalid);
      return snapshot(entry);
    }
    this.transition(descriptor.id, "loaded");
    if (defaultEnabled) this.transition(descriptor.id, "enabled");
    return snapshot(entry);
  }

  get(id: string): ExtensionRecord | undefined {
    const entry = this.entries.get(id);
    if (!entry || entry.state === "unloaded") return undefined;
    return snapshot(entry);
  }

  /** Overlay is display-only (App vs project enable tables). Unloaded entries are omitted. */
  list(overlay?: Record<string, boolean>): ExtensionRecord[] {
    const out: ExtensionRecord[] = [];
    for (const entry of this.entries.values()) {
      if (entry.state === "unloaded") continue;
      out.push(withOverlay(entry, overlay));
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  transition(id: string, to: ExtensionLifecycleState): ExtensionRecord {
    const entry = this.require(id);
    assertLegalTransition(entry.state, to);
    if (to === "unloaded" && !entry.uninstallable && entry.state !== "error") {
      throw new ExtensionLifecycleError(`builtin extensions cannot be unloaded: ${id}`);
    }
    if (to === "disabled" || to === "unloaded") this.disposeAll(id);
    entry.state = to;
    if (to !== "error") delete entry.error;
    if (to === "unloaded") {
      this.entries.delete(id);
      this.disposers.delete(id);
      return { ...snapshot(entry), state: "unloaded" };
    }
    return snapshot(entry);
  }

  enable(id: string): ExtensionRecord {
    const entry = this.require(id);
    if (entry.state === "error") throw new ExtensionLifecycleError(`extension ${id} is in error; not retrying`);
    if (entry.state === "enabled") return snapshot(entry);
    return this.transition(id, "enabled");
  }

  disable(id: string): ExtensionRecord {
    const entry = this.require(id);
    if (entry.state === "error") throw new ExtensionLifecycleError(`extension ${id} is in error; not retrying`);
    if (entry.state === "disabled") {
      this.disposeAll(id);
      return snapshot(entry);
    }
    return this.transition(id, "disabled");
  }

  unload(id: string): void {
    const entry = this.require(id);
    if (entry.state === "enabled") {
      throw new ExtensionLifecycleError(`illegal extension transition: enabled → unloaded`);
    }
    if (entry.state !== "disabled" && entry.state !== "error") {
      assertLegalTransition(entry.state, "unloaded");
    }
    this.transition(id, "unloaded");
  }

  /**
   * Validation / migration failure. Visible on the record; callers must not persist
   * enablement or partial settings (D9: 不自动重试写盘).
   */
  enterError(id: string, reason: string): ExtensionRecord {
    const entry = this.require(id);
    if (entry.state !== "error") assertLegalTransition(entry.state, "error");
    this.disposeAll(id);
    entry.state = "error";
    entry.error = reason;
    return snapshot(entry);
  }

  /**
   * Run a migration. On throw, enter error and do not invoke `commit`
   * (no partial write, no retry).
   */
  applyMigration(id: string, migrate: () => void, commit: () => void): ExtensionRecord {
    const entry = this.require(id);
    if (entry.state === "error") {
      throw new ExtensionLifecycleError(`extension ${id} is in error; not retrying`);
    }
    try {
      migrate();
    } catch (error) {
      return this.enterError(id, error instanceof Error ? error.message : String(error));
    }
    commit();
    return snapshot(this.require(id));
  }

  /** D7: register returns a disposer; disable/unload disposes the whole group. */
  register(extId: string, dispose: () => void): () => void {
    this.require(extId);
    const list = this.disposers.get(extId) ?? [];
    list.push(dispose);
    this.disposers.set(extId, list);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.disposers.get(extId);
      if (!current) return;
      this.disposers.set(extId, current.filter((item) => item !== dispose));
    };
  }

  hasResiduals(id: string): boolean {
    return (this.disposers.get(id)?.length ?? 0) > 0 || this.entries.has(id);
  }

  capabilities(id: string): readonly string[] {
    return this.require(id).capabilities;
  }

  hasCapability(id: string, capability: string): boolean {
    return this.require(id).capabilities.includes(capability);
  }

  settingsManifest(id: string): ExtensionSettingsManifest | undefined {
    return this.require(id).settings;
  }

  dependencies(id: string): ExtensionDependencies | undefined {
    const value = this.require(id).descriptor.dependencies;
    return value ? {
      required: value.required.map(item => ({ ...item })),
      optional: value.optional.map(item => ({ ...item })),
      conflicts: [...value.conflicts],
    } : undefined;
  }

  /**
   * Record one session's authoritative mount snapshot for its current child
   * process. Replacement, never union: every spawn registration describes a new
   * child's full extension set, so a same-ID respawn under changed enablement
   * must not inherit mounts from the dead child. An empty list clears.
   */
  mountSession(sessionId: string, extensionIds: readonly string[]): void {
    this.sessionMounts.set(sessionId, new Set(extensionIds));
  }

  unmountSession(sessionId: string): void {
    this.sessionMounts.delete(sessionId);
  }

  /** Explicit lifecycle diagnostics and host-shutdown seam. */
  hasSessionMount(sessionId: string): boolean {
    return this.sessionMounts.has(sessionId);
  }

  mountedSessionIds(): string[] {
    return [...this.sessionMounts.keys()];
  }

  unmountAllSessions(): void {
    this.sessionMounts.clear();
  }

  isMounted(sessionId: string, extensionId: string): boolean {
    return this.sessionMounts.get(sessionId)?.has(extensionId) === true;
  }

  private require(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || entry.state === "unloaded") {
      throw new ExtensionLifecycleError(`unknown extension ${id}`);
    }
    return entry;
  }

  private disposeAll(id: string): void {
    const list = this.disposers.get(id) ?? [];
    this.disposers.delete(id);
    for (const dispose of list) {
      try {
        dispose();
      } catch {
        /* dispose must not block disable/unload */
      }
    }
  }
}

export function createExtensionRegistry(
  builtins: readonly ExtensionDescriptor[] = BUILTIN_EXTENSION_PACKAGES,
): ExtensionRegistry {
  return new ExtensionRegistry(builtins);
}

export function projectExtensionEnabledFile(projectAgentDir: string): string {
  return projectExtensionEnabledPath(projectAgentDir);
}

/** D4 emit auth after HostBridge has already accepted the minted sessionCapability. */
export function authorizeExtEmit(
  registry: ExtensionRegistry,
  sessionId: string,
  extensionId: string,
): ExtEmitAuth {
  if (typeof extensionId !== "string" || !ID_RE.test(extensionId)) {
    return { ok: false, error: "unknown extension", errorCode: "not_found" };
  }
  const record = registry.get(extensionId);
  if (!record) return { ok: false, error: "unknown extension", errorCode: "not_found" };
  if (record.state === "disabled" || record.state === "error") {
    return { ok: false, error: "extension disabled", errorCode: "disabled" };
  }
  if (!registry.isMounted(sessionId, extensionId)) {
    return { ok: false, error: "extension not mounted", errorCode: "capability_denied" };
  }
  if (!registry.hasCapability(extensionId, "bridge.emit")) {
    return { ok: false, error: "capability_denied", errorCode: "capability_denied" };
  }
  return { ok: true };
}
