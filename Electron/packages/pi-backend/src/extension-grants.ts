import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXTENSION_L2_CAPABILITIES } from "./extension-manifest.js";

/** Project-home capability grants. Not a pi `settings.json` key. */
export const PROJECT_EXTENSION_GRANTS_FILE = "ext-grants.json";

export type ExtensionGrantRecord = {
  grantedCapabilities: string[];
  grantedAt: string;
};

export type ExtensionCapabilityGrant = {
  id: string;
  grantedCapabilities: string[];
  grantedAt?: string;
  needsConfirmation: boolean;
  refused: boolean;
  refusedCapabilities?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isL2Capability(capability: string): boolean {
  return (EXTENSION_L2_CAPABILITIES as readonly string[]).includes(capability);
}

export function l2CapabilitiesOf(capabilities: readonly string[]): string[] {
  return capabilities.filter(isL2Capability);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}

export function parseGrantRecord(value: unknown): ExtensionGrantRecord | undefined {
  if (!isRecord(value)) return undefined;
  const grantedCapabilities = asStringArray(value.grantedCapabilities);
  if (!grantedCapabilities) return undefined;
  const grantedAt = typeof value.grantedAt === "string" && value.grantedAt.trim() ? value.grantedAt : undefined;
  return { grantedCapabilities, grantedAt: grantedAt ?? new Date(0).toISOString() };
}

/** App-profile grants inside `pipiui-settings.json` `extensions[id]`. */
export function readAppExtensionGrant(settings: Record<string, unknown>, id: string): ExtensionGrantRecord | undefined {
  const slot = isRecord(settings.extensions) ? settings.extensions[id] : undefined;
  return parseGrantRecord(slot);
}

export function writeAppExtensionGrant(
  settings: Record<string, unknown>,
  id: string,
  grant: ExtensionGrantRecord,
): void {
  const slot = isRecord(settings.extensions) ? { ...settings.extensions } : {};
  const current = isRecord(slot[id]) ? { ...slot[id] } : {};
  current.grantedCapabilities = [...grant.grantedCapabilities];
  current.grantedAt = grant.grantedAt;
  slot[id] = current;
  settings.extensions = slot;
}

export function parseProjectExtensionGrants(value: unknown): Record<string, ExtensionGrantRecord> {
  if (!isRecord(value)) return {};
  const out: Record<string, ExtensionGrantRecord> = {};
  for (const [id, record] of Object.entries(value)) {
    const parsed = parseGrantRecord(record);
    if (parsed) out[id] = parsed;
  }
  return out;
}

export function projectExtensionGrantsPath(projectAgentDir: string): string {
  return join(projectAgentDir, PROJECT_EXTENSION_GRANTS_FILE);
}

export async function readProjectExtensionGrants(projectAgentDir: string): Promise<Record<string, ExtensionGrantRecord>> {
  try {
    return parseProjectExtensionGrants(JSON.parse(await readFile(projectExtensionGrantsPath(projectAgentDir), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeProjectExtensionGrant(
  projectAgentDir: string,
  id: string,
  grant: ExtensionGrantRecord,
): Promise<Record<string, ExtensionGrantRecord>> {
  const current = await readProjectExtensionGrants(projectAgentDir);
  const next = { ...current, [id]: grant };
  await mkdir(projectAgentDir, { recursive: true });
  const path = projectExtensionGrantsPath(projectAgentDir);
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

function setContainsAll(granted: readonly string[], declared: readonly string[]): boolean {
  const have = new Set(granted);
  return declared.every((item) => have.has(item));
}

export function evaluateCapabilityGrant(input: {
  id: string;
  origin: string;
  declared: readonly string[];
  stored?: ExtensionGrantRecord;
}): ExtensionCapabilityGrant {
  const refusedCapabilities = l2CapabilitiesOf(input.declared);
  const grantedCapabilities = input.stored?.grantedCapabilities ?? [];
  const builtin = input.origin === "builtin";
  if (!builtin && refusedCapabilities.length > 0) {
    const grant: ExtensionCapabilityGrant = {
      id: input.id,
      grantedCapabilities,
      needsConfirmation: false,
      refused: true,
      refusedCapabilities,
    };
    if (input.stored?.grantedAt) grant.grantedAt = input.stored.grantedAt;
    return grant;
  }
  const l0 = input.declared.length === 0;
  const needsConfirmation = !builtin && !l0 && !setContainsAll(grantedCapabilities, input.declared);
  const grant: ExtensionCapabilityGrant = {
    id: input.id,
    grantedCapabilities,
    needsConfirmation,
    refused: false,
  };
  if (input.stored?.grantedAt) grant.grantedAt = input.stored.grantedAt;
  return grant;
}

export function grantFromConfirmation(capabilities: readonly string[], at = new Date().toISOString()): ExtensionGrantRecord {
  return {
    grantedCapabilities: [...capabilities],
    grantedAt: at,
  };
}

/** One default-grant candidate (decision A): extension id + manifest-declared permissions. */
export type ExtensionGrantSeed = {
  id: string;
  permissions: readonly string[];
};

/**
 * Pure decision-A seed delta: an extension with no stored grant record receives
 * exactly its manifest-declared permissions. A record that already exists is
 * never rewritten (user revocation wins), ids without declared permissions are
 * never seeded, and unrelated store entries pass through untouched (removal
 * never cleans history). Returns undefined when nothing needs to be written.
 */
export function projectExtensionGrantSeed(
  current: Record<string, ExtensionGrantRecord>,
  seeds: readonly ExtensionGrantSeed[],
  at = new Date().toISOString(),
): Record<string, ExtensionGrantRecord> | undefined {
  let changed = false;
  const next = { ...current };
  for (const seed of seeds) {
    if (!seed.permissions.length) continue;
    if (next[seed.id]) continue;
    next[seed.id] = { grantedCapabilities: [...seed.permissions], grantedAt: at };
    changed = true;
  }
  return changed ? next : undefined;
}

export function readProjectExtensionGrantsSync(projectAgentDir: string): Record<string, ExtensionGrantRecord> {
  try {
    return parseProjectExtensionGrants(JSON.parse(readFileSync(projectExtensionGrantsPath(projectAgentDir), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Sync counterpart of `writeProjectExtensionGrant` for the synchronous scan path. */
export function writeProjectExtensionGrantsSync(
  projectAgentDir: string,
  grants: Record<string, ExtensionGrantRecord>,
): void {
  mkdirSync(projectAgentDir, { recursive: true });
  const path = projectExtensionGrantsPath(projectAgentDir);
  const tmp = `${path}.${process.pid}-${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(grants, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Decision-A default grants on the scan path: a bundled core-capability extension
 * ships usable by default, so its first sight in a project seeds exactly the
 * permissions its manifest declares into `{project}/.pi/agent/ext-grants.json`.
 * Existing records always win (revocation is never overwritten); nothing beyond
 * the declared set is ever granted.
 */
export function seedProjectExtensionGrantsSync(
  projectAgentDir: string,
  seeds: readonly ExtensionGrantSeed[],
): Record<string, ExtensionGrantRecord> {
  const current = readProjectExtensionGrantsSync(projectAgentDir);
  const next = projectExtensionGrantSeed(current, seeds);
  if (!next) return current;
  writeProjectExtensionGrantsSync(projectAgentDir, next);
  return next;
}
