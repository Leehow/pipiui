import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { putSecret, type VaultSecretMeta } from "./secret-vault.js";
import type { ExtInvokeErrorCode, ExtensionSettingsManifest } from "./extension-registry.js";

export type ExtInvokeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ExtInvokeErrorCode; message: string } };

export const PROJECT_EXTENSION_SETTINGS_DIR = "ext-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectExtensionSettingsPath(projectAgentDir: string, id: string): string {
  return join(projectAgentDir, PROJECT_EXTENSION_SETTINGS_DIR, `${id}.json`);
}

export function secretPropertyKeys(schema: ExtensionSettingsManifest["schema"] | undefined): Set<string> {
  const keys = new Set<string>();
  const properties = schema?.properties;
  if (!isRecord(properties)) return keys;
  for (const [key, spec] of Object.entries(properties)) {
    if (isRecord(spec) && spec.format === "secret") keys.add(key);
  }
  return keys;
}

function propertySpec(
  schema: ExtensionSettingsManifest["schema"] | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const properties = schema?.properties;
  if (!isRecord(properties)) return undefined;
  const spec = properties[key];
  return isRecord(spec) ? spec : undefined;
}

function typeOk(spec: Record<string, unknown>, value: unknown): boolean {
  const expected = spec.type;
  if (typeof expected !== "string") return true;
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "string") return typeof value === "string";
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "object") return isRecord(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "null") return value === null;
  return true;
}

export function validateExtensionSettingsPatch(
  id: string,
  schema: ExtensionSettingsManifest["schema"] | undefined,
  patch: Record<string, unknown>,
): { ok: true; values: Record<string, unknown>; secrets: Record<string, string> } | { ok: false; code: ExtInvokeErrorCode; message: string } {
  const properties = isRecord(schema?.properties) ? schema!.properties! : undefined;
  const secrets: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const prefix = `ext.${id}.`;
  for (const [key, value] of Object.entries(patch)) {
    if (!properties || !Object.prototype.hasOwnProperty.call(properties, key)) {
      return { ok: false, code: "capability_denied", message: `unknown settings key ${key}` };
    }
    if (!key.startsWith(prefix)) {
      return { ok: false, code: "capability_denied", message: `settings key must be namespaced ${prefix}*` };
    }
    const spec = propertySpec(schema, key) ?? {};
    if (spec.format === "secret") {
      if (typeof value !== "string") {
        return { ok: false, code: "capability_denied", message: `secret field ${key} must be a string` };
      }
      secrets[key] = value;
      continue;
    }
    if (!typeOk(spec, value)) {
      return { ok: false, code: "capability_denied", message: `invalid type for ${key}` };
    }
    values[key] = value;
  }
  return { ok: true, values, secrets };
}

export function readAppExtensionSettingsValues(
  settings: Record<string, unknown>,
  id: string,
  secretKeys: Set<string>,
): Record<string, unknown> {
  const slot = isRecord(settings.extensions) ? settings.extensions[id] : undefined;
  if (!isRecord(slot)) return {};
  const stored = isRecord(slot.settings) ? slot.settings : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (secretKeys.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function writeAppExtensionSettingsValues(
  settings: Record<string, unknown>,
  id: string,
  values: Record<string, unknown>,
  settingsVersion?: number,
): void {
  const slot = isRecord(settings.extensions) ? { ...settings.extensions } : {};
  const current = isRecord(slot[id]) ? { ...slot[id] } : {};
  current.settings = { ...values };
  if (settingsVersion !== undefined) current.settingsVersion = settingsVersion;
  slot[id] = current;
  settings.extensions = slot;
}

export async function readProjectExtensionSettingsValues(
  projectAgentDir: string,
  id: string,
  secretKeys: Set<string>,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(projectExtensionSettingsPath(projectAgentDir, id), "utf8"));
    const stored = isRecord(parsed) && isRecord(parsed.settings) ? parsed.settings : isRecord(parsed) ? parsed : {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (key === "settingsVersion" || secretKeys.has(key)) continue;
      out[key] = value;
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeProjectExtensionSettingsValues(
  projectAgentDir: string,
  id: string,
  values: Record<string, unknown>,
  settingsVersion?: number,
): Promise<void> {
  const document: Record<string, unknown> = { settings: { ...values } };
  if (settingsVersion !== undefined) document.settingsVersion = settingsVersion;
  await atomicWriteJson(projectExtensionSettingsPath(projectAgentDir, id), document);
}

export function secretEnvName(key: string): string {
  const raw = key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  const name = raw.length === 0 ? "EXT_SECRET" : raw.slice(0, 64);
  return /^[A-Z]/.test(name) ? name : `E${name.slice(0, 63)}`;
}

export async function putExtensionSecrets(
  vaultDir: string,
  secrets: Record<string, string>,
): Promise<VaultSecretMeta[]> {
  const written: VaultSecretMeta[] = [];
  for (const [key, value] of Object.entries(secrets)) {
    written.push(await putSecret(vaultDir, { name: key, envName: secretEnvName(key), value }));
  }
  return written;
}

export function settingsDenied(code: ExtInvokeErrorCode, message: string): ExtInvokeResult<Record<string, unknown>> {
  return { ok: false, error: { code, message } };
}
