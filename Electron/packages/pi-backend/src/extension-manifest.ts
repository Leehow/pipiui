import type {
  ExtensionOrigin,
  ExtensionDependencies,
  ExtensionDependencyRequirement,
  ExtensionSettingsManifest,
  ExtensionSettingsMigration,
  ExtensionSettingsSchema,
} from "./extension-registry.js";
import { CORE_CAPABILITY_EXTENSION_IDS } from "./extension-registry.js";
import { parseExtensionMigrations } from "./extension-migrations.js";
import {
  parseExtensionAuthContribution,
  type ExtensionAuthContribution,
} from "./extension-provider-contract.js";
import {
  parseExtensionUpdateComponents,
  parseExtensionUpdateSource,
  type ExtensionUpdateComponent,
  type ExtensionUpdateComponentSource,
} from "./extension-update-components.js";

/** Spec D2. */
export const EXTENSION_MANIFEST_FILENAME = "pipiui-extension.json";
export const EXTENSION_ID_RE = /^[a-z][a-z0-9-]*$/;
/** User-facing catalogue groups. Optional for legacy packages; UI renders those under Other. */
export const EXTENSION_CATEGORIES = [
  "foundation",
  "workflow",
  "coding",
  "knowledge",
  "automation",
  "integration",
  "developer",
] as const;
export type ExtensionCategory = (typeof EXTENSION_CATEGORIES)[number];

/** Optional top-level manifest `description` length cap (user-facing list summary). */
export const EXTENSION_DESCRIPTION_MAX_LENGTH = 200;

/** Spec D8 first-version capability enum (L0/L1). */
export const EXTENSION_CAPABILITIES = [
  "settings.read",
  "settings.write",
  "bridge.emit",
  "invoke.agent",
  "stream.render",
  "terminal.read",
  "notifications",
  /** Read the project-relative files this package declares in `app.data.read`. */
  "data.read",
  /**
   * Replace files under `app.data.write`.
   *
   * A panel with this can leave a request where something that already had the power to
   * act will find it -- switch what a collector polls, ask for one expensive read -- with
   * no live session. It is a separate capability from `data.read` because reading a log
   * and changing a project's files are different permissions, and separately declared so
   * the grant names the directory.
   */
  "data.write",
  /** Run this package's declared `host.worker` for as long as its project is open. */
  "host.worker",
] as const;
/** Spec D11 L2 host privileges — recognized so they can be refused, never granted. */
export const EXTENSION_L2_CAPABILITIES = ["host.main", "host.decorator", "host.api", "native.driver"] as const;
export type ExtensionCapability =
  | (typeof EXTENSION_CAPABILITIES)[number]
  | (typeof EXTENSION_L2_CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>([...EXTENSION_CAPABILITIES, ...EXTENSION_L2_CAPABILITIES]);

/**
 * Host API level of the running host (contract wave: extensions declare which
 * range they load against; the updater refuses artifacts outside the range).
 */
export const EXTENSION_HOST_API_VERSION = "1.0.0";

/**
 * First-version permission enum. Each value maps to a concrete host surface:
 * `net.request` outbound network, `browser.session` host WebView session,
 * `native.exec` host-managed native resources, `memory.read` memory broker
 * read-only tools. Unknown permissions are errors, never silent grants.
 */
export const EXTENSION_PERMISSIONS = ["net.request", "browser.session", "native.exec", "memory.read"] as const;
export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];

/** Platforms a native resource may target (matches the CUA driver slice scheme). */
export const EXTENSION_NATIVE_RESOURCE_PLATFORMS = ["darwin-universal", "darwin-arm64", "darwin-x64"] as const;
export type ExtensionNativeResourcePlatform = (typeof EXTENSION_NATIVE_RESOURCE_PLATFORMS)[number];

/** Declared per-platform native artifact shipped inside the extension package. */
export type ExtensionNativeResource = {
  /** Semantic slug, unique within the manifest. */
  id: string;
  /** Extension-relative path. Existence/realpath is the loader's job. */
  entry: string;
  /** Defaults to every platform when omitted. */
  platforms?: ExtensionNativeResourcePlatform[];
};

/**
 * Extension artifact update metadata (host-side only; never fetched by
 * validation). The updater downloads from the same closed source union as
 * `updateComponents`, verifies SHA-256/bytes/arch/signature, then swaps the
 * App-profile content-addressed slot. First version: official `stable` channel,
 * ed25519 signatures only.
 */
export type ExtensionUpdateMetadata = {
  /** Where the updater discovers artifacts. Optional at the manifest layer
   *  (decided with the official release plumbing); required before download. */
  source?: ExtensionUpdateComponentSource;
  channel?: "stable";
  signature?: "ed25519";
};

const SEMVER_COMPARATOR_RE = /^(>=|<=|>|<|=|\^|~)?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Simple semver range: space/comma-separated comparators (`>=`, `>`, `<=`, `<`,
 * `=`, `^`, `~`, or bare exact), each with a full `X.Y.Z` version. OR (`||`)
 * ranges and wildcards are not part of the first-version contract.
 */
export function isValidExtensionHostApiRange(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return false;
  return trimmed.split(/[\s,]+/).every((part) => SEMVER_COMPARATOR_RE.test(part));
}

/** Spec D2 / D7: first version only `toolPanel`. Unknown slots are errors, never silent skips. */
export const EXTENSION_PANEL_SLOTS = ["toolPanel"] as const;
export type ExtensionPanelSlot = (typeof EXTENSION_PANEL_SLOTS)[number];

/** `icon` is a package-relative SVG silhouette for the tool rail (optional). */
export type ExtensionUiPanel = { slot: ExtensionPanelSlot; id: string; title: string; entry?: string; icon?: string };
export type ExtensionUiToolRenderer = { tool: string; entry?: string };
/** Controlled chat-header action declared by `app.ui.headerActions`. */
export type ExtensionUiHeaderAction = { id: string; entry: string; order?: number };

/**
 * Manifest `app.ui.documentRenderers[]` item (document renderer contract v1).
 * Declaring + enabling the contribution is the authorization; there is no
 * `document.preview` capability. Matching is static manifest data only.
 */
export type ExtensionUiDocumentRenderer = {
  id: string;
  entry: string;
  /** Host document kinds claimed (opaque strings to the validator). */
  kinds?: string[];
  /** File extensions with a leading dot, normalized lowercase. */
  extensions?: string[];
  mimeTypes?: string[];
  /** Higher wins; ties break on id, then extension id. */
  priority?: number;
};
export type ExtensionUiSettingsSection = { id: string; title: string; entry?: string };
export type ExtensionUiSlashCommand = { name: string; description?: string };
export const EXTENSION_WORKBENCH_LOCATIONS = [
  "primarySidebar",
  "center",
  "auxiliarySidebar",
  "statusBar",
  "overlay",
] as const;
export type ExtensionWorkbenchLocation = (typeof EXTENSION_WORKBENCH_LOCATIONS)[number];
export type ExtensionUiViewContainer = {
  id: string;
  location: ExtensionWorkbenchLocation;
  title: string;
  icon?: string;
  order?: number;
};
export type ExtensionUiView = {
  id: string;
  container: string;
  entry: string;
  activation: "visible";
};

/**
 * `app.data.read`: project-relative files or directories a panel may read.
 *
 * A panel's only data channels are the session-scoped ones (`ext.emit`, `invoke`), so a
 * dashboard shows nothing until a conversation happens to be running. Declared data paths
 * give it a session-independent source: read-only, confined to the project, size-capped.
 */
export type ExtensionDataSummary = { read: string[]; write?: string[] };

/** Cap on declared data paths; a package that needs more is doing something else. */
export const EXTENSION_DATA_PATH_MAX = 8;

/**
 * `host.worker`: a package-relative module the host runs once per open project.
 *
 * The agent half lives only inside a session and the app half only inside the renderer, so
 * nothing an extension owns can keep running while the app is merely open. This is that
 * third lifetime — and it is why it needs its own capability.
 */
export type ExtensionHostSummary = { worker: string };

export type ExtensionUiSummary = {
  panels?: ExtensionUiPanel[];
  toolRenderers?: ExtensionUiToolRenderer[];
  documentRenderers?: ExtensionUiDocumentRenderer[];
  settingsSections?: ExtensionUiSettingsSection[];
  slashCommands?: ExtensionUiSlashCommand[];
  viewContainers?: ExtensionUiViewContainer[];
  views?: ExtensionUiView[];
  headerActions?: ExtensionUiHeaderAction[];
  composerActions?: ExtensionUiHeaderAction[];
  /** Theme pack entries pass through verbatim; per-theme content validation is
   *  fail-closed in the renderer theme registry (see ThemeContribution). */
  themes?: unknown[];
};

/** Max contributed AGENT.md paths in one manifest. */
export const EXTENSION_AGENT_CONTRIBUTION_MAX = 32;
/** Max agent patches in one manifest. */
export const EXTENSION_AGENT_PATCH_MAX = 32;
/** Max addTools/removeTools names on one patch. */
export const EXTENSION_AGENT_PATCH_TOOLS_MAX = 32;
/** Max characters for a retained relative path. */
export const EXTENSION_AGENT_PATH_MAX = 256;
/** Semantic agent / patch-target name. */
export const EXTENSION_AGENT_NAME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,62}$/;
/** Tool names requested by a patch (host or extension-supplied). */
export const EXTENSION_AGENT_TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

const AGENT_MANIFEST_KEYS = new Set(["extension", "skills", "agents", "agentPatches"]);
const AGENT_PATCH_KEYS = new Set([
  "target",
  "appendPrompt",
  "replacePrompt",
  "addTools",
  "removeTools",
]);
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const CONTRIBUTION_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/**
 * Incremental patch against an already-discovered agent.
 * Prompt fields are extension-relative file paths (not inline bodies).
 * `appendPrompt` and `replacePrompt` are mutually exclusive.
 */
export type ExtensionAgentPatch = {
  target: string;
  appendPrompt?: string;
  replacePrompt?: string;
  addTools?: string[];
  removeTools?: string[];
};

/** Validated agent-half contribution snapshot — transport must not re-parse raw JSON. */
export type ExtensionAgentContributions = {
  /** Extension-relative schema:1 `AGENT.md` paths. Existence/realpath is the loader's job. */
  agents?: string[];
  agentPatches?: ExtensionAgentPatch[];
};

export type ValidatedExtensionManifest = ExtensionAgentContributions & {
  id: string;
  name: string;
  version: string;
  /** Optional host product allowlist; absent makes the package visible to every product. */
  products?: string[];
  /** Optional initial enablement; absent retains the origin's legacy default. */
  defaultEnabled?: boolean;
  /** One-line package summary shown in the extension list. */
  description?: string;
  /** Optional catalogue category; omitted legacy packages remain visible as Other. */
  category?: ExtensionCategory;
  capabilities: ExtensionCapability[];
  settings?: ExtensionSettingsManifest;
  ui?: ExtensionUiSummary;
  /** `app.data.read`: project-relative paths a panel may read without a session. */
  data?: ExtensionDataSummary;
  /** `host.worker`: package-relative module run per open project. */
  host?: ExtensionHostSummary;
  agentExtension?: string;
  agentSkills?: string[];
  /** Optional stable host library entry for cross-host consumers (e.g. pi-coc);
   *  content hash is pinned by the bundled sync receipt. */
  hostEntry?: string;
  /** Declarative auth/provider contribution. Models use the Pi provider shape. */
  auth?: ExtensionAuthContribution;
  /** Declared open-source update components (metadata only; checks stay host-side). */
  updateComponents?: ExtensionUpdateComponent[];
  /** Host API versions this package loads against (required for core-capability ids). */
  hostApi?: string;
  /** Declared host-surface permissions (closed first-version enum). */
  permissions?: ExtensionPermission[];
  /** Declared per-platform native artifacts shipped in the package. */
  nativeResources?: ExtensionNativeResource[];
  /** Extension artifact update discovery (metadata only; the updater acts on it). */
  update?: ExtensionUpdateMetadata;
  /** Product Profile v2 dependency graph. Empty groups are retained for deterministic snapshots. */
  dependencies?: ExtensionDependencies;
};

export type ManifestValidationOk = { ok: true; manifest: ValidatedExtensionManifest };
export type ManifestValidationErr = { ok: false; errors: string[]; fallbackId?: string };
export type ManifestValidation = ManifestValidationOk | ManifestValidationErr;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Array of non-empty strings, or push one deterministic error. `undefined` = not declared. */
function collectNonEmptyStrings(
  value: unknown,
  label: string,
  errors: string[],
  normalize?: (item: string) => string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must be an array of non-empty strings`);
    return undefined;
  }
  const out = (value as string[]).map((item) => (normalize ? normalize(item) : item.trim()));
  return out.length ? out : undefined;
}

/** Extension allowlist entries: non-empty, leading dot, lowercase. */
function collectDocumentExtensions(value: unknown, label: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must be an array of non-empty strings`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of value as string[]) {
    const normalized = item.trim().toLowerCase();
    if (!normalized.startsWith(".")) {
      errors.push(`${label} entries must start with a dot (e.g. '.svg')`);
      return undefined;
    }
    out.push(normalized);
  }
  return out.length ? out : undefined;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
  errors: string[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`unknown field '${key}' in ${label}`);
  }
}

/** Manifest-layer relative path: keep the string; loader owns realpath / existence. */
function collectRelativePath(
  value: unknown,
  label: string,
  errors: string[],
  options?: { requireAgentMd?: boolean },
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty path string`);
    return undefined;
  }
  const path = value.trim();
  if (CONTROL_CHAR_RE.test(path)) {
    errors.push(`${label} must not contain control characters`);
    return undefined;
  }
  if (path.length > EXTENSION_AGENT_PATH_MAX) {
    errors.push(`${label} must be at most ${EXTENSION_AGENT_PATH_MAX} characters`);
    return undefined;
  }
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("~")) {
    errors.push(`${label} must be a relative path`);
    return undefined;
  }
  if (path.includes("\\")) {
    errors.push(`${label} must use forward slashes`);
    return undefined;
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`${label} must not contain empty, '.', or '..' segments`);
    return undefined;
  }
  if (options?.requireAgentMd && segments[segments.length - 1] !== "AGENT.md") {
    errors.push(`${label} must be a schema:1 AGENT.md relative path`);
    return undefined;
  }
  return path;
}

function collectToolNames(value: unknown, label: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must be an array of non-empty strings`);
    return undefined;
  }
  if (value.length > EXTENSION_AGENT_PATCH_TOOLS_MAX) {
    errors.push(`${label} must have at most ${EXTENSION_AGENT_PATCH_TOOLS_MAX} entries`);
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value as string[]) {
    const name = item.trim();
    if (!EXTENSION_AGENT_TOOL_NAME_RE.test(name)) {
      errors.push(`${label} contains invalid tool name '${name}'`);
      continue;
    }
    if (seen.has(name)) {
      errors.push(`${label} contains duplicate tool name '${name}'`);
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out.length ? out : undefined;
}

function collectAgentPaths(value: unknown, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push("agent.agents must be an array of AGENT.md relative paths");
    return undefined;
  }
  if (value.length > EXTENSION_AGENT_CONTRIBUTION_MAX) {
    errors.push(`agent.agents must have at most ${EXTENSION_AGENT_CONTRIBUTION_MAX} entries`);
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const path = collectRelativePath(item, `agent.agents[${index}]`, errors, { requireAgentMd: true });
    if (!path) continue;
    if (seen.has(path)) {
      errors.push(`duplicate agent path '${path}'`);
      continue;
    }
    seen.add(path);
    out.push(path);
  }
  return out.length ? out : undefined;
}

function collectAgentPatches(value: unknown, errors: string[]): ExtensionAgentPatch[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push("agent.agentPatches must be an array");
    return undefined;
  }
  if (value.length > EXTENSION_AGENT_PATCH_MAX) {
    errors.push(`agent.agentPatches must have at most ${EXTENSION_AGENT_PATCH_MAX} entries`);
    return undefined;
  }
  const patches: ExtensionAgentPatch[] = [];
  const seenTargets = new Set<string>();
  for (const [index, item] of value.entries()) {
    const label = `agent.agentPatches[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknownKeys(item, AGENT_PATCH_KEYS, label, errors);
    const target = asNonEmptyString(item.target);
    if (!target) {
      errors.push(`${label}.target must be a non-empty agent name`);
      continue;
    }
    if (!EXTENSION_AGENT_NAME_RE.test(target)) {
      errors.push(`${label}.target is not a valid agent name`);
      continue;
    }
    if (seenTargets.has(target)) {
      errors.push(`duplicate agent patch target '${target}'`);
    } else {
      seenTargets.add(target);
    }

    const hasAppend = Object.prototype.hasOwnProperty.call(item, "appendPrompt");
    const hasReplace = Object.prototype.hasOwnProperty.call(item, "replacePrompt");
    if (hasAppend && hasReplace) {
      errors.push(`${label} cannot declare both appendPrompt and replacePrompt`);
    }
    const appendPrompt = hasAppend
      ? collectRelativePath(item.appendPrompt, `${label}.appendPrompt`, errors)
      : undefined;
    const replacePrompt = hasReplace
      ? collectRelativePath(item.replacePrompt, `${label}.replacePrompt`, errors)
      : undefined;
    const addTools = collectToolNames(item.addTools, `${label}.addTools`, errors);
    const removeTools = collectToolNames(item.removeTools, `${label}.removeTools`, errors);
    if (addTools && removeTools) {
      const overlap = addTools.filter((name) => removeTools.includes(name));
      if (overlap.length) {
        errors.push(`${label} cannot add and remove the same tool (${overlap.join(", ")})`);
      }
    }
    if (!appendPrompt && !replacePrompt && !addTools?.length && !removeTools?.length) {
      errors.push(
        `${label} must declare at least one of appendPrompt, replacePrompt, addTools, removeTools`,
      );
    }
    const patch: ExtensionAgentPatch = { target };
    if (appendPrompt) patch.appendPrompt = appendPrompt;
    if (replacePrompt) patch.replacePrompt = replacePrompt;
    if (addTools?.length) patch.addTools = addTools;
    if (removeTools?.length) patch.removeTools = removeTools;
    patches.push(patch);
  }
  return patches.length ? patches : undefined;
}

const NATIVE_RESOURCE_KEYS = new Set(["id", "entry", "platforms"]);
const UPDATE_METADATA_KEYS = new Set(["source", "channel", "signature"]);
const UPDATE_CHANNEL_VALUES = new Set(["stable"]);
const UPDATE_SIGNATURE_VALUES = new Set(["ed25519"]);

function collectNativeResources(value: unknown, errors: string[]): ExtensionNativeResource[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push("nativeResources must be an array");
    return undefined;
  }
  const out: ExtensionNativeResource[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const label = `nativeResources[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknownKeys(item, NATIVE_RESOURCE_KEYS, label, errors);
    const id = asNonEmptyString(item.id);
    if (!id) errors.push(`${label} missing id`);
    else if (!EXTENSION_ID_RE.test(id)) errors.push(`${label} invalid id '${id}': must match [a-z][a-z0-9-]*`);
    const entry = collectRelativePath(item.entry, `${label}.entry`, errors);
    let platforms: ExtensionNativeResourcePlatform[] | undefined;
    if (item.platforms !== undefined) {
      if (!Array.isArray(item.platforms) || item.platforms.some((platform) => typeof platform !== "string")) {
        errors.push(`${label}.platforms must be an array of platform strings`);
      } else {
        const normalized = [...new Set(item.platforms as string[])];
        for (const platform of normalized) {
          if (!(EXTENSION_NATIVE_RESOURCE_PLATFORMS as readonly string[]).includes(platform)) {
            errors.push(
              `${label}.platforms unknown platform '${platform}': not in ${EXTENSION_NATIVE_RESOURCE_PLATFORMS.join(", ")}`,
            );
          }
        }
        if (!errors.some((error) => error.startsWith(`${label}.platforms`))) {
          platforms = normalized as ExtensionNativeResourcePlatform[];
        }
      }
    }
    if (id && seen.has(id)) errors.push(`duplicate native resource id '${id}'`);
    if (id) seen.add(id);
    if (id && entry && EXTENSION_ID_RE.test(id)) {
      const resource: ExtensionNativeResource = { id, entry };
      if (platforms) resource.platforms = platforms;
      out.push(resource);
    }
  }
  return out.length ? out : undefined;
}

function collectUpdateMetadata(value: unknown, errors: string[]): ExtensionUpdateMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push("update must be an object");
    return undefined;
  }
  rejectUnknownKeys(value, UPDATE_METADATA_KEYS, "update", errors);
  // Source stays optional at the manifest layer (scaffolds precede a decided
  // official release source); the updater requires it before any download.
  let source: ExtensionUpdateComponentSource | undefined;
  if (value.source !== undefined) {
    source = parseExtensionUpdateSource(value.source, "update", errors);
  }
  let channel: ExtensionUpdateMetadata["channel"];
  if (value.channel !== undefined) {
    if (typeof value.channel !== "string" || !UPDATE_CHANNEL_VALUES.has(value.channel)) {
      errors.push(
        `update.channel must be one of ${[...UPDATE_CHANNEL_VALUES].join(", ")} (first version ships official signed extensions only)`,
      );
    } else {
      channel = value.channel as ExtensionUpdateMetadata["channel"];
    }
  }
  let signature: ExtensionUpdateMetadata["signature"];
  if (value.signature !== undefined) {
    if (typeof value.signature !== "string" || !UPDATE_SIGNATURE_VALUES.has(value.signature)) {
      errors.push(`update.signature must be one of ${[...UPDATE_SIGNATURE_VALUES].join(", ")}`);
    } else {
      signature = value.signature as ExtensionUpdateMetadata["signature"];
    }
  }
  if (!source && !channel && !signature) return undefined;
  const metadata: ExtensionUpdateMetadata = {};
  if (source) metadata.source = source;
  if (channel) metadata.channel = channel;
  if (signature) metadata.signature = signature;
  return metadata;
}

function settingsPrefix(id: string): string {
  return `ext.${id}.`;
}

function isNamespacedSettingsKey(id: string, key: string): boolean {
  const prefix = settingsPrefix(id);
  return key.startsWith(prefix) && key.length > prefix.length;
}

const DEPENDENCY_KEYS = new Set(["required", "optional", "conflicts"]);

function collectDependencyRequirements(
  value: unknown,
  label: string,
  errors: string[],
): ExtensionDependencyRequirement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const out: ExtensionDependencyRequirement[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`${label}[${index}] must be an object`);
      continue;
    }
    rejectUnknownKeys(item, new Set(["id", "version"]), `${label}[${index}]`, errors);
    const id = asNonEmptyString(item.id);
    const version = asNonEmptyString(item.version);
    if (!id || !EXTENSION_ID_RE.test(id)) {
      errors.push(`${label}[${index}].id must be a semantic slug`);
      continue;
    }
    if (!version || !isValidExtensionHostApiRange(version)) {
      errors.push(`${label}[${index}].version must be a valid semver range`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${label} contains duplicate extension '${id}'`);
      continue;
    }
    seen.add(id);
    out.push({ id, version });
  }
  return out;
}

function collectExtensionDependencies(
  value: unknown,
  ownerId: string | undefined,
  errors: string[],
): ExtensionDependencies | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push("dependencies must be an object");
    return undefined;
  }
  rejectUnknownKeys(value, DEPENDENCY_KEYS, "dependencies", errors);
  const required = collectDependencyRequirements(value.required, "dependencies.required", errors);
  const optional = collectDependencyRequirements(value.optional, "dependencies.optional", errors);
  const conflicts = collectNonEmptyStrings(value.conflicts, "dependencies.conflicts", errors) ?? [];
  const seenConflicts = new Set<string>();
  for (const id of conflicts) {
    if (!EXTENSION_ID_RE.test(id)) errors.push(`dependencies.conflicts id '${id}' must be a semantic slug`);
    if (seenConflicts.has(id)) errors.push(`dependencies.conflicts contains duplicate extension '${id}'`);
    seenConflicts.add(id);
  }
  const requiredIds = new Set(required.map(item => item.id));
  for (const item of optional) {
    if (requiredIds.has(item.id)) errors.push(`extension '${item.id}' cannot be both required and optional`);
  }
  for (const id of [...requiredIds, ...optional.map(item => item.id)]) {
    if (seenConflicts.has(id)) errors.push(`extension '${id}' cannot be both a dependency and a conflict`);
  }
  if (ownerId && (requiredIds.has(ownerId) || optional.some(item => item.id === ownerId) || seenConflicts.has(ownerId))) {
    errors.push(`extension '${ownerId}' cannot depend on or conflict with itself`);
  }
  return { required, optional, conflicts };
}

function collectSchema(value: unknown): ExtensionSettingsSchema | undefined {
  if (!isRecord(value)) return undefined;
  const schema: ExtensionSettingsSchema = {};
  if (typeof value.type === "string") schema.type = value.type;
  if (isRecord(value.properties)) schema.properties = value.properties;
  if (Array.isArray(value.required) && value.required.every((item) => typeof item === "string")) {
    schema.required = value.required;
  }
  if (typeof value.additionalProperties === "boolean") schema.additionalProperties = value.additionalProperties;
  return schema;
}

/**
 * Validate a parsed `pipiui-extension.json` (spec D2).
 * Failures are user-readable; callers put the package in `error` with these reasons.
 */
export function validateExtensionManifest(value: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  const rawId = value.id;
  const id = asNonEmptyString(rawId);
  if (rawId === undefined || rawId === null || (typeof rawId === "string" && !rawId.trim())) {
    errors.push("missing required field id");
  } else if (typeof rawId !== "string" || !EXTENSION_ID_RE.test(rawId)) {
    errors.push(`invalid extension id '${String(rawId)}': must match [a-z][a-z0-9-]*`);
  }

  const name = asNonEmptyString(value.name);
  if (!name) errors.push("missing required field name");

  const version = asNonEmptyString(value.version);
  if (!version) errors.push("missing required field version");

  let products: string[] | undefined;
  if (value.products !== undefined) {
    if (!Array.isArray(value.products) || value.products.length === 0 || value.products.some(
      (item) => typeof item !== "string" || item !== item.trim() || !EXTENSION_ID_RE.test(item),
    ) || new Set(value.products).size !== value.products.length) {
      errors.push("products must be a non-empty array of unique product id slugs ([a-z][a-z0-9-]*)");
    } else {
      products = [...value.products];
    }
  }

  let description: string | undefined;
  if (value.description !== undefined && value.description !== null) {
    if (typeof value.description !== "string") {
      errors.push("description must be a string");
    } else {
      const trimmedDescription = value.description.trim();
      if (trimmedDescription.length > EXTENSION_DESCRIPTION_MAX_LENGTH) {
        errors.push(`description must be at most ${EXTENSION_DESCRIPTION_MAX_LENGTH} characters`);
      } else if (trimmedDescription) {
        description = trimmedDescription;
      }
    }
  }

  let category: ExtensionCategory | undefined;
  if (value.category !== undefined && value.category !== null) {
    if (typeof value.category !== "string" || !(EXTENSION_CATEGORIES as readonly string[]).includes(value.category)) {
      errors.push("category is unsupported");
    } else {
      category = value.category as ExtensionCategory;
    }
  }

  let capabilities: ExtensionCapability[] = [];
  if (!Object.prototype.hasOwnProperty.call(value, "capabilities")) {
    errors.push("missing required field capabilities");
  } else if (!Array.isArray(value.capabilities)) {
    errors.push("capabilities must be an array of strings");
  } else {
    for (const item of value.capabilities) {
      if (typeof item !== "string") {
        errors.push("capabilities must be an array of strings");
        break;
      }
      if (!CAPABILITY_SET.has(item)) {
        errors.push(`unknown capability '${item}': not in the first-version enum`);
      }
    }
    if (!errors.some((error) => error.includes("capabilities") || error.startsWith("unknown capability"))) {
      capabilities = value.capabilities as ExtensionCapability[];
    }
  }

  // Frozen core-capability contract: hostApi range, permissions,
  // nativeResources, and artifact update metadata. hostApi is REQUIRED for
  // core-capability ids; every other manifest stays back-compat (validated
  // only when present).
  const isCoreCapability = typeof id === "string" && CORE_CAPABILITY_EXTENSION_IDS.has(id);
  let hostApi: string | undefined;
  if (value.hostApi !== undefined && value.hostApi !== null) {
    if (!isValidExtensionHostApiRange(value.hostApi)) {
      errors.push("hostApi must be a semver range like '>=1.0.0 <2.0.0' or '^1.0.0'");
    } else {
      hostApi = (value.hostApi as string).trim();
    }
  } else if (isCoreCapability) {
    errors.push(`core-capability extension '${id}' must declare a hostApi version range`);
  }

  let permissions: ExtensionPermission[] | undefined;
  if (value.permissions !== undefined) {
    if (!Array.isArray(value.permissions) || value.permissions.some((item) => typeof item !== "string")) {
      errors.push("permissions must be an array of strings");
    } else {
      const unknown = (value.permissions as string[]).filter(
        (item) => !(EXTENSION_PERMISSIONS as readonly string[]).includes(item),
      );
      for (const item of unknown) {
        errors.push(`unknown permission '${item}': not in the first-version enum`);
      }
      if (!unknown.length) permissions = [...new Set(value.permissions as ExtensionPermission[])];
    }
  }

  const nativeResources = collectNativeResources(value.nativeResources, errors);
  const update = collectUpdateMetadata(value.update, errors);
  const dependencies = collectExtensionDependencies(value.dependencies, id, errors);

  let settings: ExtensionSettingsManifest | undefined;
  const app = value.app;
  if (app !== undefined && app !== null && !isRecord(app)) {
    errors.push("app must be an object");
  }
  const appRecord = isRecord(app) ? app : undefined;
  const appSettings = appRecord?.settings;
  if (appSettings !== undefined && appSettings !== null) {
    if (!isRecord(appSettings)) {
      errors.push("app.settings must be an object");
    } else {
      const scope = appSettings.scope;
      if (scope !== "app" && scope !== "project") {
        errors.push("app.settings.scope must be 'app' or 'project'");
      }
      const schema = collectSchema(appSettings.schema);
      if (!isRecord(appSettings.schema)) {
        errors.push("app.settings.schema is required when settings are declared");
      } else if (id && isRecord(schema?.properties)) {
        for (const key of Object.keys(schema!.properties!)) {
          if (!isNamespacedSettingsKey(id, key)) {
            errors.push(`settings key '${key}' must be namespaced ${settingsPrefix(id)}*`);
          }
        }
      }
      const topVersion = value.settingsVersion;
      const nestedVersion = appSettings.settingsVersion;
      const settingsVersion = typeof topVersion === "number" ? topVersion : nestedVersion;
      if (typeof settingsVersion !== "number" || !Number.isFinite(settingsVersion) || settingsVersion < 1) {
        errors.push("settingsVersion is required (number ≥ 1) when settings are declared");
      }
      const rawMigrations = value.migrations ?? appSettings.migrations;
      const parsedMigrations = parseExtensionMigrations(rawMigrations);
      let migrations: ExtensionSettingsMigration[] | undefined;
      if (!parsedMigrations.ok) {
        errors.push(parsedMigrations.error);
      } else if (parsedMigrations.migrations.length) {
        migrations = parsedMigrations.migrations;
      }
      if (scope === "app" || scope === "project") {
        settings = {
          scope,
          schema: schema ?? {},
          settingsVersion: typeof settingsVersion === "number" ? settingsVersion : undefined,
        };
        if (migrations) settings.migrations = migrations;
      }
    }
  }

  let data: ExtensionDataSummary | undefined;
  const appData = appRecord?.data;
  if (appData !== undefined && appData !== null) {
    if (!isRecord(appData)) {
      errors.push("app.data must be an object");
    } else {
      rejectUnknownKeys(appData, new Set(["read", "write"]), "app.data", errors);
      const collectPaths = (declared: unknown, field: string): string[] | undefined => {
        if (declared === undefined) return undefined;
        if (!Array.isArray(declared)) {
          errors.push(`${field} must be an array of project-relative paths`);
          return undefined;
        }
        if (declared.length > EXTENSION_DATA_PATH_MAX) {
          errors.push(`${field} must have at most ${EXTENSION_DATA_PATH_MAX} entries`);
          return undefined;
        }
        const paths: string[] = [];
        for (const [index, item] of declared.entries()) {
          const path = collectRelativePath(item, `${field}[${index}]`, errors);
          if (path && !paths.includes(path)) paths.push(path);
        }
        return paths.length ? paths : undefined;
      };
      const read = collectPaths(appData.read, "app.data.read");
      const write = collectPaths(appData.write, "app.data.write");
      if (read || write) {
        data = { read: read ?? [] };
        if (write) data.write = write;
      }
    }
  }

  let ui: ExtensionUiSummary | undefined;
  const appUi = appRecord?.ui;
  if (appUi !== undefined && appUi !== null) {
    if (!isRecord(appUi)) {
      errors.push("app.ui must be an object");
    } else {
      const summary: ExtensionUiSummary = {};
      if (appUi.viewContainers !== undefined) {
        if (!Array.isArray(appUi.viewContainers)) {
          errors.push("app.ui.viewContainers must be an array");
        } else {
          const containers: ExtensionUiViewContainer[] = [];
          const seen = new Set<string>();
          for (const [index, item] of appUi.viewContainers.entries()) {
            if (!isRecord(item)) {
              errors.push(`app.ui.viewContainers[${index}] must be an object`);
              continue;
            }
            const itemId = asNonEmptyString(item.id);
            const title = asNonEmptyString(item.title);
            const location = item.location;
            if (!itemId || !CONTRIBUTION_ID_RE.test(itemId)) {
              errors.push(`app.ui.viewContainers[${index}].id must be a semantic contribution id`);
              continue;
            }
            if (seen.has(itemId)) {
              errors.push(`duplicate view container id '${itemId}'`);
              continue;
            }
            seen.add(itemId);
            if (!(EXTENSION_WORKBENCH_LOCATIONS as readonly unknown[]).includes(location)) {
              errors.push(`app.ui.viewContainers[${index}].location is unsupported`);
              continue;
            }
            if (!title) {
              errors.push(`app.ui.viewContainers[${index}].title must be a non-empty string`);
              continue;
            }
            const icon = item.icon === undefined
              ? undefined
              : collectRelativePath(item.icon, `app.ui.viewContainers[${index}].icon`, errors);
            let order: number | undefined;
            if (item.order !== undefined) {
              if (typeof item.order !== "number" || !Number.isFinite(item.order)) {
                errors.push(`app.ui.viewContainers[${index}].order must be a finite number`);
              } else order = item.order;
            }
            containers.push({
              id: itemId,
              location: location as ExtensionWorkbenchLocation,
              title,
              ...(icon ? { icon } : {}),
              ...(order !== undefined ? { order } : {}),
            });
          }
          if (containers.length) summary.viewContainers = containers;
        }
      }
      if (appUi.views !== undefined) {
        if (!Array.isArray(appUi.views)) {
          errors.push("app.ui.views must be an array");
        } else {
          const views: ExtensionUiView[] = [];
          const seen = new Set<string>();
          for (const [index, item] of appUi.views.entries()) {
            if (!isRecord(item)) {
              errors.push(`app.ui.views[${index}] must be an object`);
              continue;
            }
            const viewId = asNonEmptyString(item.id);
            const container = asNonEmptyString(item.container);
            const entry = asNonEmptyString(item.entry);
            const activation = item.activation ?? "visible";
            if (!viewId || !CONTRIBUTION_ID_RE.test(viewId)) {
              errors.push(`app.ui.views[${index}].id must be a semantic contribution id`);
              continue;
            }
            if (seen.has(viewId)) {
              errors.push(`duplicate view id '${viewId}'`);
              continue;
            }
            seen.add(viewId);
            if (!container || !CONTRIBUTION_ID_RE.test(container)) {
              errors.push(`app.ui.views[${index}].container must be a semantic contribution id`);
              continue;
            }
            if (!entry) {
              errors.push(`app.ui.views[${index}].entry must be a path string`);
              continue;
            }
            if (activation !== "visible") {
              errors.push(`app.ui.views[${index}].activation must be 'visible'`);
              continue;
            }
            views.push({ id: viewId, container, entry, activation: "visible" });
          }
          if (views.length) summary.views = views;
        }
      }
      if (appUi.headerActions !== undefined) {
        if (!Array.isArray(appUi.headerActions)) {
          errors.push("app.ui.headerActions must be an array");
        } else {
          const actions: ExtensionUiHeaderAction[] = [];
          const seen = new Set<string>();
          for (const [index, item] of appUi.headerActions.entries()) {
            const label = `app.ui.headerActions[${index}]`;
            if (!isRecord(item)) {
              errors.push(`${label} must be an object`);
              continue;
            }
            const actionId = asNonEmptyString(item.id);
            if (!actionId || !CONTRIBUTION_ID_RE.test(actionId)) {
              errors.push(`${label}.id must be a semantic contribution id`);
              continue;
            }
            if (seen.has(actionId)) {
              errors.push(`duplicate header action id '${actionId}'`);
              continue;
            }
            seen.add(actionId);
            const entry = collectRelativePath(item.entry, `${label}.entry`, errors);
            let order: number | undefined;
            if (item.order !== undefined) {
              if (typeof item.order !== "number" || !Number.isFinite(item.order)) {
                errors.push(`${label}.order must be a finite number`);
              } else order = item.order;
            }
            if (entry) actions.push({ id: actionId, entry, ...(order !== undefined ? { order } : {}) });
          }
          if (actions.length) summary.headerActions = actions;
        }
      }
      if (appUi.composerActions !== undefined) {
        if (!Array.isArray(appUi.composerActions)) {
          errors.push("app.ui.composerActions must be an array");
        } else {
          const actions: ExtensionUiHeaderAction[] = [];
          const seen = new Set<string>();
          for (const [index, item] of appUi.composerActions.entries()) {
            const label = `app.ui.composerActions[${index}]`;
            if (!isRecord(item)) {
              errors.push(`${label} must be an object`);
              continue;
            }
            const actionId = asNonEmptyString(item.id);
            if (!actionId || !CONTRIBUTION_ID_RE.test(actionId)) {
              errors.push(`${label}.id must be a semantic contribution id`);
              continue;
            }
            if (seen.has(actionId)) {
              errors.push(`duplicate composer action id '${actionId}'`);
              continue;
            }
            seen.add(actionId);
            const entry = collectRelativePath(item.entry, `${label}.entry`, errors);
            let order: number | undefined;
            if (item.order !== undefined) {
              if (typeof item.order !== "number" || !Number.isFinite(item.order)) {
                errors.push(`${label}.order must be a finite number`);
              } else order = item.order;
            }
            if (entry) actions.push({ id: actionId, entry, ...(order !== undefined ? { order } : {}) });
          }
          if (actions.length) summary.composerActions = actions;
        }
      }
      if (appUi.panels !== undefined) {
        if (!Array.isArray(appUi.panels)) {
          errors.push("app.ui.panels must be an array");
        } else {
          const panels: ExtensionUiPanel[] = [];
          for (const [index, panel] of appUi.panels.entries()) {
            if (!isRecord(panel)) {
              errors.push(`app.ui.panels[${index}] must be an object`);
              continue;
            }
            const slot = panel.slot;
            if (slot !== "toolPanel") {
              errors.push(
                `unknown panel slot '${String(slot ?? "")}': first version only allows toolPanel`,
              );
              continue;
            }
            const panelId = asNonEmptyString(panel.id);
            const title = asNonEmptyString(panel.title);
            if (!panelId) errors.push(`app.ui.panels[${index}] missing id`);
            if (!title) errors.push(`app.ui.panels[${index}] missing title`);
            if (panelId && title) {
              const entry = asNonEmptyString(panel.entry);
              const icon =
                panel.icon === undefined
                  ? undefined
                  : collectRelativePath(panel.icon, `app.ui.panels[${index}].icon`, errors);
              panels.push({
                slot,
                id: panelId,
                title,
                ...(entry ? { entry } : {}),
                ...(icon ? { icon } : {}),
              });
            }
          }
          if (panels.length) summary.panels = panels;
        }
      }
      if (appUi.toolRenderers !== undefined) {
        if (!Array.isArray(appUi.toolRenderers)) {
          errors.push("app.ui.toolRenderers must be an array");
        } else {
          const toolRenderers: ExtensionUiToolRenderer[] = [];
          for (const [index, renderer] of appUi.toolRenderers.entries()) {
            if (!isRecord(renderer) || !asNonEmptyString(renderer.tool)) {
              errors.push(`app.ui.toolRenderers[${index}] must declare tool`);
              continue;
            }
            const entry = asNonEmptyString(renderer.entry);
            toolRenderers.push(entry ? { tool: renderer.tool as string, entry } : { tool: renderer.tool as string });
          }
          if (toolRenderers.length) summary.toolRenderers = toolRenderers;
        }
      }
      if (appUi.settingsSections !== undefined) {
        if (!Array.isArray(appUi.settingsSections)) {
          errors.push("app.ui.settingsSections must be an array");
        } else {
          const settingsSections: ExtensionUiSettingsSection[] = [];
          for (const [index, section] of appUi.settingsSections.entries()) {
            if (!isRecord(section)) {
              errors.push(`app.ui.settingsSections[${index}] must be an object`);
              continue;
            }
            const sectionId = asNonEmptyString(section.id);
            const title = asNonEmptyString(section.title);
            if (!sectionId || !title) {
              errors.push(`app.ui.settingsSections[${index}] must declare id and title`);
              continue;
            }
            const entry = asNonEmptyString(section.entry);
            settingsSections.push(entry ? { id: sectionId, title, entry } : { id: sectionId, title });
          }
          if (settingsSections.length) summary.settingsSections = settingsSections;
        }
      }
      if (appUi.documentRenderers !== undefined) {
        if (!Array.isArray(appUi.documentRenderers)) {
          errors.push("app.ui.documentRenderers must be an array");
        } else {
          const documentRenderers: ExtensionUiDocumentRenderer[] = [];
          const seenRendererIds = new Set<string>();
          for (const [index, renderer] of appUi.documentRenderers.entries()) {
            if (!isRecord(renderer)) {
              errors.push(`app.ui.documentRenderers[${index}] must be an object`);
              continue;
            }
            const rendererId = asNonEmptyString(renderer.id);
            const entry = asNonEmptyString(renderer.entry);
            if (!rendererId) errors.push(`app.ui.documentRenderers[${index}] missing id`);
            if (!entry) errors.push(`app.ui.documentRenderers[${index}] missing entry`);
            const kinds = collectNonEmptyStrings(
              renderer.kinds,
              `app.ui.documentRenderers[${index}].kinds`,
              errors,
            );
            const extensions = collectDocumentExtensions(
              renderer.extensions,
              `app.ui.documentRenderers[${index}].extensions`,
              errors,
            );
            const mimeTypes = collectNonEmptyStrings(
              renderer.mimeTypes,
              `app.ui.documentRenderers[${index}].mimeTypes`,
              errors,
              (item) => item.trim().toLowerCase(),
            );
            let priority: number | undefined;
            if (renderer.priority !== undefined) {
              if (typeof renderer.priority !== "number" || !Number.isFinite(renderer.priority)) {
                errors.push(`app.ui.documentRenderers[${index}].priority must be a finite number`);
              } else {
                priority = renderer.priority;
              }
            }
            if (rendererId && seenRendererIds.has(rendererId)) {
              errors.push(`duplicate document renderer id '${rendererId}'`);
            }
            if (!kinds?.length && !extensions?.length && !mimeTypes?.length) {
              errors.push(
                `app.ui.documentRenderers[${index}] must declare at least one of kinds, extensions, mimeTypes`,
              );
            }
            if (rendererId) seenRendererIds.add(rendererId);
            if (rendererId && entry && (kinds?.length || extensions?.length || mimeTypes?.length)) {
              const item: ExtensionUiDocumentRenderer = { id: rendererId, entry };
              if (kinds?.length) item.kinds = kinds;
              if (extensions?.length) item.extensions = extensions;
              if (mimeTypes?.length) item.mimeTypes = mimeTypes;
              if (priority !== undefined) item.priority = priority;
              documentRenderers.push(item);
            }
          }
          if (documentRenderers.length) summary.documentRenderers = documentRenderers;
        }
      }
      if (appUi.slashCommands !== undefined) {
        if (!Array.isArray(appUi.slashCommands)) {
          errors.push("app.ui.slashCommands must be an array");
        } else {
          const slashCommands: ExtensionUiSlashCommand[] = [];
          for (const [index, command] of appUi.slashCommands.entries()) {
            if (!isRecord(command) || !asNonEmptyString(command.name)) {
              errors.push(`app.ui.slashCommands[${index}] must declare name`);
              continue;
            }
            const description = asNonEmptyString(command.description);
            slashCommands.push(description ? { name: command.name as string, description } : { name: command.name as string });
          }
          if (slashCommands.length) summary.slashCommands = slashCommands;
        }
      }
      if (appUi.themes !== undefined && !Array.isArray(appUi.themes)) errors.push("app.ui.themes must be an array");
      if (Array.isArray(appUi.themes) && appUi.themes.length > 0) summary.themes = appUi.themes;
      if (appUi.statusBar !== undefined && !Array.isArray(appUi.statusBar)) errors.push("app.ui.statusBar must be an array");
      if (Object.keys(summary).length) ui = summary;
    }
  }

  let agentExtension: string | undefined;
  let agentSkills: string[] | undefined;
  let agents: string[] | undefined;
  let agentPatches: ExtensionAgentPatch[] | undefined;
  if (value.agent !== undefined && value.agent !== null) {
    if (!isRecord(value.agent)) {
      errors.push("agent must be an object");
    } else {
      rejectUnknownKeys(value.agent, AGENT_MANIFEST_KEYS, "agent", errors);
      if (value.agent.extension !== undefined) {
        const path = asNonEmptyString(value.agent.extension);
        if (!path) errors.push("agent.extension must be a path string");
        else agentExtension = path;
      }
      if (value.agent.skills !== undefined) {
        if (!Array.isArray(value.agent.skills) || !value.agent.skills.every((item) => typeof item === "string" && item.trim())) {
          errors.push("agent.skills must be an array of paths");
        } else {
          agentSkills = value.agent.skills.map((item) => String(item));
        }
      }
      agents = collectAgentPaths(value.agent.agents, errors);
      agentPatches = collectAgentPatches(value.agent.agentPatches, errors);
    }
  }

  const fallbackId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : undefined;

  // Optional stable host library entry (cross-host consumers, e.g. pi-coc).
  // Declared in the manifest; its content hash is pinned by the bundled sync
  // receipt (`pipiui-host-receipt.json`) so resolvers can verify both hosts
  // consume the same build artifact.
  let hostEntry: string | undefined;
  let host: ExtensionHostSummary | undefined;
  if (value.host !== undefined && value.host !== null) {
    if (!isRecord(value.host)) {
      errors.push("host must be an object");
    } else {
      // `entry` 是给跨宿主消费者的库入口；`worker` 是随项目跑的后台。两者含义不同，
      // 但都属于"这个包的宿主侧"，所以并在同一个对象里，各自可选、互不排斥。
      // `description` 是既有已发布包在用的说明字段，不能因为收紧这里而把它们判成非法。
      rejectUnknownKeys(value.host, new Set(["entry", "worker", "description"]), "host", errors);
      if (value.host.entry !== undefined) {
        const entry = asNonEmptyString(value.host.entry);
        if (!entry) errors.push("host.entry must be a path string");
        else hostEntry = entry;
      }
      if (value.host.worker !== undefined) {
        const worker = collectRelativePath(value.host.worker, "host.worker", errors);
        if (worker) host = { worker };
      }
      if (value.host.entry === undefined && value.host.worker === undefined) {
        errors.push("host must declare entry or worker");
      }
    }
  }

  let auth: ExtensionAuthContribution | undefined;
  const parsedAuth = parseExtensionAuthContribution(value.auth);
  if (parsedAuth) {
    if (!parsedAuth.ok) errors.push(...parsedAuth.errors);
    else auth = parsedAuth.contribution;
  }

  let updateComponents: ExtensionUpdateComponent[] | undefined;
  const parsedComponents = parseExtensionUpdateComponents(value.updateComponents);
  if (parsedComponents) {
    if (!parsedComponents.ok) errors.push(...parsedComponents.errors);
    else if (parsedComponents.components.length) updateComponents = parsedComponents.components;
  }

  if (value.defaultEnabled !== undefined && typeof value.defaultEnabled !== "boolean") {
    errors.push("defaultEnabled must be a boolean");
  }
  if (errors.length) return { ok: false, errors, fallbackId };

  const manifest: ValidatedExtensionManifest = {
    id: id!,
    name: name!,
    version: version!,
    capabilities,
  };
  if (products) manifest.products = products;
  if (typeof value.defaultEnabled === "boolean") manifest.defaultEnabled = value.defaultEnabled;
  if (description) manifest.description = description;
  if (category) manifest.category = category;
  if (settings) manifest.settings = settings;
  if (ui) manifest.ui = ui;
  if (data) manifest.data = data;
  if (host) manifest.host = host;
  if (agentExtension) manifest.agentExtension = agentExtension;
  if (agentSkills) manifest.agentSkills = agentSkills;
  if (agents) manifest.agents = agents;
  if (agentPatches) manifest.agentPatches = agentPatches;
  if (hostEntry) manifest.hostEntry = hostEntry;
  if (auth) manifest.auth = auth;
  if (updateComponents) manifest.updateComponents = updateComponents;
  if (hostApi) manifest.hostApi = hostApi;
  if (permissions) manifest.permissions = permissions;
  if (nativeResources) manifest.nativeResources = nativeResources;
  if (update) manifest.update = update;
  if (dependencies) manifest.dependencies = dependencies;
  return { ok: true, manifest };
}

export function parseExtensionManifestJson(text: string): ManifestValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  return validateExtensionManifest(parsed);
}

export function originPrecedence(origin: ExtensionOrigin): number {
  if (origin === "project") return 3;
  if (origin === "app") return 2;
  return 1;
}
