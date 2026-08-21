/** Spec D6: settingsVersion + migrations[] key mapping. Compute in memory, then one write. */

export type ExtensionSettingsMigration = {
  from: number;
  to: number;
  map: Record<string, string>;
};

export type MigrationResult =
  | { ok: true; settings: Record<string, unknown>; settingsVersion: number; changed: boolean }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, mapped] of Object.entries(value)) {
    if (typeof mapped !== "string" || !mapped) return undefined;
    out[key] = mapped;
  }
  return out;
}

/** Parse manifest `migrations[]`. Invalid entries return an error string. */
export function parseExtensionMigrations(value: unknown): { ok: true; migrations: ExtensionSettingsMigration[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, migrations: [] };
  if (!Array.isArray(value)) return { ok: false, error: "migrations must be an array" };
  const migrations: ExtensionSettingsMigration[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return { ok: false, error: `migrations[${index}] must be an object` };
    if (typeof item.from !== "number" || !Number.isFinite(item.from) || typeof item.to !== "number" || !Number.isFinite(item.to)) {
      return { ok: false, error: `migrations[${index}] must declare numeric from and to` };
    }
    if (item.to <= item.from) {
      return { ok: false, error: `migrations[${index}] to must be greater than from` };
    }
    const rawMap = item.map ?? item.rename ?? item.keys ?? {};
    const map = stringMap(rawMap);
    if (!map) return { ok: false, error: `migrations[${index}] map must be string-to-string` };
    migrations.push({ from: item.from, to: item.to, map });
  }
  return { ok: true, migrations: migrations.sort((a, b) => a.from - b.from || a.to - b.to) };
}

function applyKeyMap(settings: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...settings };
  for (const [fromKey, toKey] of Object.entries(map)) {
    if (!Object.prototype.hasOwnProperty.call(next, fromKey)) continue;
    next[toKey] = next[fromKey];
    if (fromKey !== toKey) delete next[fromKey];
  }
  return next;
}

/**
 * Walk `from→to` until disk version reaches the manifest target.
 * On any gap or failure, return ok:false and leave the caller's disk untouched.
 */
export function migrateExtensionSettings(input: {
  diskVersion: number;
  targetVersion: number;
  migrations: readonly ExtensionSettingsMigration[];
  settings: Record<string, unknown>;
}): MigrationResult {
  const target = input.targetVersion;
  const disk = input.diskVersion;
  if (!Number.isFinite(target) || target < 1) return { ok: false, error: "invalid manifest settingsVersion" };
  if (!Number.isFinite(disk) || disk < 1) return { ok: false, error: "invalid disk settingsVersion" };
  if (disk > target) return { ok: false, error: `disk settingsVersion ${disk} is newer than manifest ${target}` };
  if (disk === target) {
    return { ok: true, settings: { ...input.settings }, settingsVersion: disk, changed: false };
  }

  let current = disk;
  let values = { ...input.settings };
  const used = new Set<number>();
  while (current < target) {
    const step = input.migrations.find((item) => item.from === current && !used.has(item.from));
    if (!step) {
      return { ok: false, error: `missing migration from ${current} to ${target}` };
    }
    used.add(step.from);
    if (step.to <= current) {
      return { ok: false, error: `non-increasing migration ${current} → ${step.to}` };
    }
    values = applyKeyMap(values, step.map);
    current = step.to;
  }
  if (current !== target) {
    return { ok: false, error: `migrations ended at ${current}, expected ${target}` };
  }
  return { ok: true, settings: values, settingsVersion: current, changed: true };
}
