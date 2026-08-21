import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

export type ExtensionSettingsManifest = {
  scope: ExtensionEnableScope;
  schema: ExtensionSettingsSchema;
  settingsVersion?: number;
};

export type ExtensionDescriptor = {
  id: string;
  name: string;
  version: string;
  origin: ExtensionOrigin;
  /** Bundled runtime layer name (D13). */
  layer?: string;
  defaultEnabled?: boolean;
  uninstallable?: boolean;
  /** Spec D8 capability strings, e.g. `bridge.emit`. */
  capabilities?: readonly string[];
  settings?: ExtensionSettingsManifest;
};

export type ExtensionRecord = {
  id: string;
  name: string;
  version: string;
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
  { id: "pi-ext", name: "Pi Ext", version: "1.0.0", origin: "builtin", layer: "pi-ext", defaultEnabled: true, uninstallable: false },
  { id: "pi-philosophy", name: "Pi Philosophy", version: "1.0.0", origin: "builtin", layer: "pi-philosophy", defaultEnabled: true, uninstallable: false },
  { id: "pi-goal", name: "Pi Goal", version: "1.0.0", origin: "builtin", layer: "pi-goal", defaultEnabled: true, uninstallable: false },
  { id: "built-in-skills", name: "Built-in Skills", version: "1.0.0", origin: "builtin", layer: "built-in-skills", defaultEnabled: true, uninstallable: false },
];

/** Project-home enable overlay. Not a pi `settings.json` key (those are stripped). */
export const PROJECT_EXTENSION_ENABLED_FILE = "ext-enabled.json";

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
  const out: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") out[id] = enabled;
  }
  return out;
}

export function projectExtensionEnabledPath(projectAgentDir: string): string {
  return join(projectAgentDir, PROJECT_EXTENSION_ENABLED_FILE);
}

export async function readProjectExtensionEnabled(projectAgentDir: string): Promise<Record<string, boolean>> {
  try {
    return parseProjectExtensionEnabled(JSON.parse(await readFile(projectExtensionEnabledPath(projectAgentDir), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeProjectExtensionEnabled(
  projectAgentDir: string,
  id: string,
  enabled: boolean,
): Promise<Record<string, boolean>> {
  const current = await readProjectExtensionEnabled(projectAgentDir);
  const next = { ...current, [id]: enabled };
  await mkdir(projectAgentDir, { recursive: true });
  const path = projectExtensionEnabledPath(projectAgentDir);
  const tmp = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return next;
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
    if (to === "unloaded" && !entry.uninstallable) {
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

  mountSession(sessionId: string, extensionIds: readonly string[]): void {
    const set = this.sessionMounts.get(sessionId) ?? new Set<string>();
    for (const extensionId of extensionIds) set.add(extensionId);
    this.sessionMounts.set(sessionId, set);
  }

  unmountSession(sessionId: string): void {
    this.sessionMounts.delete(sessionId);
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
