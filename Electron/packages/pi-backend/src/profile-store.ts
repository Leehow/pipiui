import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PRODUCT_PROFILE_ID_RE } from "./profile-manifest.js";

export const PROJECT_EXTENSION_ENABLED_FILE = "ext-enabled.json";
export const PROJECT_PRODUCT_ACTIVATION_SCHEMA_VERSION = 2 as const;
/**
 * Two-SKU product model (user-confirmed 2026-08-31): the shipping product is the
 * Coding edition and new projects open its full bundled set. `base` is the strict
 * minimal profile (skill-loader + built-in-skills) that the future basic-only
 * edition ships with; it stays selectable here as the explicit minimal workspace.
 */
export const CODING_PRODUCT_PROFILE_ID = "coding";
export const DEFAULT_PRODUCT_PROFILE_ID = "base";
/** A legacy boolean extension table describes the historical Coding product. */
export const LEGACY_PRODUCT_PROFILE_ID = CODING_PRODUCT_PROFILE_ID;
/** Pre-release v2 name retained only for migration; it becomes the base product. */
export const DEPRECATED_EMPTY_PROFILE_ID = "empty";

export type ProjectExtensionOverride = "enabled" | "disabled";

export type ProjectProductActivation = {
  schemaVersion: typeof PROJECT_PRODUCT_ACTIVATION_SCHEMA_VERSION;
  profile: string;
  overrides: Record<string, ProjectExtensionOverride>;
};

export type ReadProjectProductActivationOptions = {
  defaultProfileId?: string;
  /** Legacy boolean `ext-enabled.json` must preserve its historical Coding semantics. */
  legacyProfileId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertProfileId(value: string): void {
  if (!PRODUCT_PROFILE_ID_RE.test(value)) throw new Error("defaultProfileId must be a semantic slug");
}

function parseOverrides(value: unknown): Record<string, ProjectExtensionOverride> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, ProjectExtensionOverride> = {};
  for (const [id, state] of Object.entries(value)) {
    if (!PRODUCT_PROFILE_ID_RE.test(id) || (state !== "enabled" && state !== "disabled")) return undefined;
    out[id] = state;
  }
  return out;
}

function parseV2(value: unknown): ProjectProductActivation | undefined {
  if (!isRecord(value) || value.schemaVersion !== PROJECT_PRODUCT_ACTIVATION_SCHEMA_VERSION) return undefined;
  if (typeof value.profile !== "string" || !PRODUCT_PROFILE_ID_RE.test(value.profile)) {
    throw new Error("project Product Profile id must be a semantic slug");
  }
  const overrides = parseOverrides(value.overrides);
  if (!overrides) throw new Error("project Product Profile overrides are invalid");
  return {
    schemaVersion: PROJECT_PRODUCT_ACTIVATION_SCHEMA_VERSION,
    profile: value.profile,
    overrides,
  };
}

function parseLegacy(value: unknown, defaultProfileId: string): ProjectProductActivation | undefined {
  if (!isRecord(value)) return undefined;
  const overrides: Record<string, ProjectExtensionOverride> = {};
  for (const [id, enabled] of Object.entries(value)) {
    if (typeof enabled !== "boolean") return undefined;
    if (!PRODUCT_PROFILE_ID_RE.test(id)) return undefined;
    overrides[id] = enabled ? "enabled" : "disabled";
  }
  return {
    schemaVersion: PROJECT_PRODUCT_ACTIVATION_SCHEMA_VERSION,
    profile: defaultProfileId,
    overrides,
  };
}

export function projectProductActivationPath(projectAgentDir: string): string {
  return join(projectAgentDir, PROJECT_EXTENSION_ENABLED_FILE);
}

export function projectActivationOverlay(activation: ProjectProductActivation): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(activation.overrides).map(([id, state]) => [id, state === "enabled"]),
  );
}

export async function writeProjectProductActivation(
  projectAgentDir: string,
  activation: ProjectProductActivation,
): Promise<ProjectProductActivation> {
  const parsed = parseV2(activation);
  if (!parsed) throw new Error("project Product Profile activation must use schemaVersion 2");
  await mkdir(projectAgentDir, { recursive: true });
  const path = projectProductActivationPath(projectAgentDir);
  const tmp = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return parsed;
}

export async function readProjectProductActivation(
  projectAgentDir: string,
  options: ReadProjectProductActivationOptions,
): Promise<ProjectProductActivation> {
  const defaultProfileId = options.defaultProfileId ?? DEFAULT_PRODUCT_PROFILE_ID;
  assertProfileId(defaultProfileId);
  const path = projectProductActivationPath(projectAgentDir);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        schemaVersion: PROJECT_PRODUCT_ACTIVATION_SCHEMA_VERSION,
        profile: defaultProfileId,
        overrides: {},
      };
    }
    throw error;
  }
  const current = parseV2(raw);
  if (current) {
    if (current.profile === DEPRECATED_EMPTY_PROFILE_ID && defaultProfileId === DEFAULT_PRODUCT_PROFILE_ID) {
      return writeProjectProductActivation(projectAgentDir, { ...current, profile: DEFAULT_PRODUCT_PROFILE_ID });
    }
    return current;
  }
  const migrated = parseLegacy(raw, options.legacyProfileId ?? LEGACY_PRODUCT_PROFILE_ID);
  if (!migrated) throw new Error("project extension activation file is invalid");
  return writeProjectProductActivation(projectAgentDir, migrated);
}
