import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  lstatSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const AMBIENT_RESOURCE_SETTINGS = [
  "packages",
  "extensions",
  "skills",
  "prompts",
  "promptTemplates",
  "themes",
] as const;

const SHARED_CREDENTIAL_FILES = [".env", "auth.json"] as const;
const COPIED_PROJECT_FILES = ["models-store.json"] as const;
const SHARED_MODELS_MANIFEST = ".pipiui-shared-models-migration-v1.json";

type JsonObject = Record<string, unknown>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SharedModelsMigrationManifest {
  version: 1;
  canonical: {
    path: string;
    sourceSha256: string | null;
    resultSha256: string;
    backupPath: string | null;
  };
  projects: Array<{
    path: string;
    sourceSha256: string | null;
    resultSha256: string;
    backupPath: string | null;
  }>;
  conflictJsonPaths: string[];
}

/** Coding Pi home for one opened project. Never `~/.pi/agent`. */
export function projectPiAgentDir(projectRoot: string): string {
  return join(resolve(projectRoot), ".pi", "agent");
}

export function projectPiSessionsDir(projectRoot: string): string {
  return join(projectPiAgentDir(projectRoot), "sessions");
}

interface VerifiedDirectory {
  path: string;
  stat: Stats;
}

interface PreparedProjectHome {
  projectRoot: VerifiedDirectory;
  piDir: VerifiedDirectory;
  agentDir: VerifiedDirectory;
}

async function verifiedExistingDirectory(path: string, label: string): Promise<VerifiedDirectory> {
  const stat = await lstat(path);
  if (!stat.isDirectory()) throw new Error(`Refusing unsafe ${label} type at ${path}`);
  const actual = await realpath(path);
  if (actual !== path) throw new Error(`Refusing escaped ${label} at ${path}`);
  const confirmed = await lstat(path);
  if (!confirmed.isDirectory() || confirmed.dev !== stat.dev || confirmed.ino !== stat.ino) {
    throw new Error(`Refusing changed ${label} at ${path}`);
  }
  return { path, stat: confirmed };
}

async function prepareDirectoryComponent(
  parent: VerifiedDirectory,
  name: string,
  label: string,
  parentLabel: string,
): Promise<VerifiedDirectory> {
  await assertVerifiedDirectory(parent, parentLabel);
  const path = join(parent.path, name);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return verifiedExistingDirectory(path, label);
}

async function assertVerifiedDirectory(directory: VerifiedDirectory, label: string): Promise<void> {
  const stat = await lstat(directory.path);
  if (!stat.isDirectory() || stat.dev !== directory.stat.dev || stat.ino !== directory.stat.ino) {
    throw new Error(`Refusing changed ${label} at ${directory.path}`);
  }
  if (await realpath(directory.path) !== directory.path) {
    throw new Error(`Refusing escaped ${label} at ${directory.path}`);
  }
}

async function prepareProjectHome(projectRoot: string): Promise<PreparedProjectHome> {
  const realProjectRoot = await realpath(resolve(projectRoot));
  const root = await verifiedExistingDirectory(realProjectRoot, "project root");
  const piDir = await prepareDirectoryComponent(root, ".pi", "project .pi", "project root");
  await assertVerifiedDirectory(root, "project root");
  const agentDir = await prepareDirectoryComponent(piDir, "agent", "project .pi/agent", "project .pi");
  await assertVerifiedDirectory(root, "project root");
  await assertVerifiedDirectory(piDir, "project .pi");
  await assertVerifiedDirectory(agentDir, "project .pi/agent");
  return { projectRoot: root, piDir, agentDir };
}

async function assertPreparedProjectHome(home: PreparedProjectHome): Promise<void> {
  await assertVerifiedDirectory(home.projectRoot, "project root");
  await assertVerifiedDirectory(home.piDir, "project .pi");
  await assertVerifiedDirectory(home.agentDir, "project .pi/agent");
}

export function sanitizePiSettings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { theme: "light" };
  const settings = { ...(raw as Record<string, unknown>) };
  for (const key of AMBIENT_RESOURCE_SETTINGS) delete settings[key];
  return settings;
}

async function readStableRegularFile(
  path: string,
  label: string,
  options: { allowMissing?: boolean; expectedStat?: Stats } = {},
): Promise<{ source: Buffer; stat: Stats } | null> {
  let before = options.expectedStat;
  if (!before) {
    try {
      before = await lstat(path);
    } catch (error) {
      if (options.allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  if (!before.isFile()) throw new Error(`Refusing unsafe ${label} type at ${path}`);

  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    try {
      handle = await open(path, fsConstants.O_RDONLY | noFollow);
    } catch (error) {
      // O_NOFOLLOW is not implemented on every Electron target. The fallback still fstats
      // before reading, so a path swapped to a symlink cannot expose its target bytes.
      if (!noFollow || !["EINVAL", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      handle = await open(path, fsConstants.O_RDONLY);
    }
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`Refusing changed ${label} at ${path}`);
    }
    return { source: await handle.readFile(), stat: opened };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseSettings(source: Buffer): unknown {
  try {
    return JSON.parse(source.toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function sanitizePiSettingsFile(path: string): Promise<boolean> {
  const regular = await readStableRegularFile(path, "project settings.json", { allowMissing: true });
  if (!regular) return false;
  const parsed = parseSettings(regular.source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const dirty = AMBIENT_RESOURCE_SETTINGS.some((key) => key in parsed);
  if (!dirty) return false;
  await atomicWrite(path, `${JSON.stringify(sanitizePiSettings(parsed), null, 2)}\n`);
  return true;
}

async function copyRegularFileIfMissing(sourceDir: string | undefined, destDir: string, name: string): Promise<void> {
  const dest = join(destDir, name);
  const existing = await readStableRegularFile(dest, `project ${name}`, { allowMissing: true });
  if (existing) return;
  if (!sourceDir) return;
  const source = await readStableRegularFile(join(sourceDir, name), `App profile ${name}`, { allowMissing: true });
  if (!source) return;
  await atomicWrite(dest, source.source);
}

/**
 * Login identity lives in the host profile. Every opened project points at the
 * same regular file so an OAuth refresh in one session is visible in all of them.
 * A seed that is itself a symlink is left untouched.
 */
function linkSharedCredential(sourceDir: string | undefined, destDir: string, name: string): void {
  if (!sourceDir) return;
  const source = resolve(sourceDir, name);
  const dest = resolve(destDir, name);
  try {
    if (!lstatSync(source).isFile()) return;
  } catch {
    return;
  }
  try {
    const destStat = lstatSync(dest);
    if (destStat.isSymbolicLink() && readlinkSync(dest) === source) return;
    unlinkSync(dest);
  } catch {
    /* dest missing */
  }
  symlinkSync(source, dest);
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonPointer(parts: string[]): string {
  return parts.length ? `/${parts.map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}` : "";
}

function equalJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Fill only absent values. Existing (higher-priority) values always win. */
function mergeMissing(
  target: JsonValue,
  source: JsonValue,
  parts: string[],
  conflicts: Set<string>,
): JsonValue {
  if (isObject(target) && isObject(source)) {
    const merged = structuredClone(target);
    for (const [key, sourceValue] of Object.entries(source)) {
      if (!(key in merged)) {
        merged[key] = structuredClone(sourceValue);
      } else if (key === "models" && parts.length === 2 && parts[0] === "providers"
        && Array.isArray(merged[key]) && Array.isArray(sourceValue)) {
        merged[key] = mergeModels(merged[key] as JsonValue[], sourceValue, [...parts, key], conflicts);
      } else {
        merged[key] = mergeMissing(merged[key], sourceValue, [...parts, key], conflicts);
      }
    }
    return merged;
  }
  if (!equalJson(target, source)) conflicts.add(jsonPointer(parts));
  return target;
}

function mergeModels(
  target: JsonValue[],
  source: JsonValue[],
  parts: string[],
  conflicts: Set<string>,
): JsonValue[] {
  const merged = structuredClone(target);
  const byId = new Map<string, number>();
  for (let index = 0; index < merged.length; index += 1) {
    const item = merged[index];
    if (isObject(item) && typeof item.id === "string" && !byId.has(item.id)) byId.set(item.id, index);
  }
  for (const item of source) {
    if (!isObject(item) || typeof item.id !== "string") {
      if (!merged.some((existing) => equalJson(existing, item))) conflicts.add(jsonPointer(parts));
      continue;
    }
    const index = byId.get(item.id);
    if (index === undefined) {
      byId.set(item.id, merged.length);
      merged.push(structuredClone(item));
    } else {
      merged[index] = mergeMissing(merged[index], item, [...parts, item.id], conflicts);
    }
  }
  return merged;
}

function parseModels(source: Buffer, path: string): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(source.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid models.json at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`models.json at ${path} must contain a JSON object`);
  }
  return value as JsonValue;
}

function sha256(source: Buffer): string {
  return createHash("sha256").update(source).digest("hex");
}

async function exclusiveWrite(path: string, source: Buffer | string, mode = 0o600): Promise<void> {
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(source);
    await handle.chmod(mode);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

async function atomicWrite(path: string, source: Buffer | string, mode = 0o600): Promise<void> {
  const temporary = join(resolve(path, ".."), `.${randomUUID()}.tmp`);
  try {
    await exclusiveWrite(temporary, source, mode);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function immutableBackup(path: string, source: Buffer, sha: string): Promise<string> {
  const backup = `${path}.pipiui-shared-v1.${sha}.${randomUUID()}.bak`;
  await exclusiveWrite(backup, source);
  return backup;
}

async function atomicLink(
  canonicalPath: string,
  projectPath: string,
  temporaryCreated?: (temporaryPath: string) => void | Promise<void>,
): Promise<void> {
  const temporary = join(resolve(projectPath, ".."), `.models-link-${randomUUID()}.tmp`);
  try {
    // Only the link filename is temporary. Its target is always the stable canonical path;
    // linking a canonical temp/backup can strand projects when that transient file disappears.
    await symlink(canonicalPath, temporary);
    await temporaryCreated?.(temporary);
    await rename(temporary, projectPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

interface ProjectModelsSource {
  projectRoot: string;
  home: PreparedProjectHome;
  path: string;
  source: Buffer | null;
  sourceSha256: string | null;
  alreadyLinked: boolean;
  backupPath: string | null;
}

type SharedModelsMigrationStep =
  | { name: "backups-created" }
  | { name: "canonical-written" }
  | { name: "temporary-project-link-created"; projectModelsPath: string; temporaryPath: string; index: number }
  | { name: "project-link-installed"; projectModelsPath: string; index: number }
  | { name: "before-manifest-write" };

/**
 * Deterministically merge project-local model catalogs into the App canonical catalog,
 * then atomically replace project catalogs with links to it. The optional hook exists
 * only to make every mutation boundary fault-injectable in temp-fixture tests.
 */
export async function migrateSharedProjectModels(options: {
  canonicalAgentDir: string;
  projectRoots: string[];
  onMigrationStep?: (step: SharedModelsMigrationStep) => void | Promise<void>;
}): Promise<SharedModelsMigrationManifest | null> {
  const canonicalAgentInput = resolve(options.canonicalAgentDir);
  await mkdir(canonicalAgentInput, { recursive: true });
  const canonicalAgentDir = await realpath(canonicalAgentInput);
  const canonicalPath = join(canonicalAgentDir, "models.json");
  const canonicalInputPath = join(canonicalAgentInput, "models.json");

  const canonicalRegular = await readStableRegularFile(canonicalPath, "canonical models.json", { allowMissing: true });
  const canonicalSource = canonicalRegular?.source ?? null;
  const canonicalSourceSha = canonicalSource ? sha256(canonicalSource) : null;
  const canonicalValue: JsonValue = canonicalSource ? parseModels(canonicalSource, canonicalPath) : { providers: {} };
  let merged: JsonValue = structuredClone(canonicalValue);

  const canonicalRoots: string[] = [];
  for (const candidate of options.projectRoots) {
    try {
      canonicalRoots.push(await realpath(resolve(candidate)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const roots = [...new Set(canonicalRoots)].sort();
  const projects: ProjectModelsSource[] = [];
  const conflicts = new Set<string>();

  for (const projectRoot of roots) {
    const home = await prepareProjectHome(projectRoot);
    const agentDir = home.agentDir.path;
    const path = join(agentDir, "models.json");
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        const target = resolve(agentDir, readlinkSync(path));
        const linked = target === canonicalPath || target === canonicalInputPath;
        if (linked) {
          projects.push({ projectRoot, home, path, source: null, sourceSha256: null, alreadyLinked: true, backupPath: null });
          continue;
        }
        // Repair only the exact class of link left by the interrupted legacy migration:
        // a hidden, same-canonical-directory temp target. Never follow or read that target.
        const targetName = basename(target);
        const staleCanonicalTemp = (dirname(target) === canonicalAgentDir || dirname(target) === canonicalAgentInput)
          && targetName.startsWith(".")
          && targetName.endsWith(".tmp");
        if (!staleCanonicalTemp) throw new Error(`Refusing untrusted project models.json symlink at ${path}`);
        projects.push({ projectRoot, home, path, source: null, sourceSha256: null, alreadyLinked: false, backupPath: null });
        continue;
      }
      const regular = await readStableRegularFile(path, "project models.json", { expectedStat: stat });
      const source = regular!.source;
      merged = mergeMissing(merged, parseModels(source, path), [], conflicts);
      projects.push({ projectRoot, home, path, source, sourceSha256: sha256(source), alreadyLinked: false, backupPath: null });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      projects.push({ projectRoot, home, path, source: null, sourceSha256: null, alreadyLinked: false, backupPath: null });
    }
  }

  const canonicalNeedsWrite = !canonicalSource || !equalJson(canonicalValue, merged);
  const result = canonicalNeedsWrite
    ? Buffer.from(`${JSON.stringify(merged, null, 2)}\n`)
    : canonicalSource!;
  const resultSha = sha256(result);
  const projectsToLink = projects.filter((project) => !project.alreadyLinked);
  if (!canonicalNeedsWrite && projectsToLink.length === 0) return null;

  for (const project of projects) await assertPreparedProjectHome(project.home);

  // With no initial canonical, publish the fully merged catalog before any project mutation.
  // Once this stable pathname exists it is deliberately not part of rollback: readers must
  // never observe ENOENT, even if a later backup/link/manifest step fails.
  if (!canonicalSource) {
    await atomicWrite(canonicalPath, result);
    await options.onMigrationStep?.({ name: "canonical-written" });
  }

  let canonicalBackup: string | null = null;
  if (projectsToLink.some((project) => project.source !== null) && canonicalSource) {
    canonicalBackup = await immutableBackup(canonicalPath, canonicalSource, canonicalSourceSha!);
  }
  for (const project of projectsToLink) {
    await assertPreparedProjectHome(project.home);
    if (project.source) project.backupPath = await immutableBackup(project.path, project.source, project.sourceSha256!);
  }

  const replaced: ProjectModelsSource[] = [];
  let canonicalReplaced = false;
  const manifestPath = join(canonicalAgentDir, SHARED_MODELS_MANIFEST);
  try {
    await options.onMigrationStep?.({ name: "backups-created" });
    if (canonicalNeedsWrite && canonicalSource) {
      // The canonical is never moved aside. Atomic rename over its stable pathname means
      // concurrent readers observe either the complete old file or the complete new file.
      await atomicWrite(canonicalPath, result);
      canonicalReplaced = true;
      await options.onMigrationStep?.({ name: "canonical-written" });
    }
    for (let index = 0; index < projectsToLink.length; index += 1) {
      const project = projectsToLink[index];
      await assertPreparedProjectHome(project.home);
      await atomicLink(canonicalPath, project.path, async (temporaryPath) => {
        await options.onMigrationStep?.({
          name: "temporary-project-link-created",
          projectModelsPath: project.path,
          temporaryPath,
          index,
        });
      });
      replaced.push(project);
      await options.onMigrationStep?.({ name: "project-link-installed", projectModelsPath: project.path, index });
    }
    const manifest: SharedModelsMigrationManifest = {
      version: 1,
      canonical: {
        path: canonicalPath,
        sourceSha256: canonicalSourceSha,
        resultSha256: resultSha,
        backupPath: canonicalBackup,
      },
      projects: projects.map((project) => ({
        path: project.path,
        sourceSha256: project.sourceSha256,
        resultSha256: resultSha,
        backupPath: project.backupPath,
      })),
      conflictJsonPaths: [...conflicts].sort(),
    };
    await options.onMigrationStep?.({ name: "before-manifest-write" });
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } catch (error) {
    for (const project of replaced.reverse()) {
      try {
        await assertPreparedProjectHome(project.home);
        if (project.source && project.backupPath) {
          await atomicWrite(project.path, project.source);
        } else {
          await rm(project.path, { force: true });
        }
      } catch {
        // Never traverse a project-home ancestor that changed during migration.
      }
    }
    if (canonicalReplaced && canonicalSource) {
      await atomicWrite(canonicalPath, canonicalSource).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Create `{project}/.pi/agent` for PipiUI coding sessions. App-level `.env`,
 * `auth.json`, and `models.json` are canonical; settings and models-store stay
 * project-local. Trust is never seeded, preserving any existing project decision.
 */
export async function ensureProjectPiHome(options: {
  projectRoot: string;
  credentialSeedDir?: string;
  deferModelsMigration?: boolean;
}): Promise<{ agentDir: string; sessionsDir: string }> {
  const home = await prepareProjectHome(options.projectRoot);
  const agentDir = home.agentDir.path;
  const sessions = await prepareDirectoryComponent(home.agentDir, "sessions", "project sessions", "project .pi/agent");
  const sessionsDir = sessions.path;
  await assertPreparedProjectHome(home);

  const settingsPath = join(agentDir, "settings.json");
  const existingSettings = await readStableRegularFile(settingsPath, "project settings.json", { allowMissing: true });
  if (existingSettings) {
    await sanitizePiSettingsFile(settingsPath);
  } else {
    let source: unknown = { theme: "light" };
    if (options.credentialSeedDir) {
      const seedSettings = await readStableRegularFile(
        join(options.credentialSeedDir, "settings.json"),
        "App profile settings.json",
        { allowMissing: true },
      );
      if (seedSettings) source = parseSettings(seedSettings.source) ?? source;
    }
    await atomicWrite(settingsPath, `${JSON.stringify(sanitizePiSettings(source), null, 2)}\n`);
  }

  await assertPreparedProjectHome(home);
  for (const name of SHARED_CREDENTIAL_FILES) linkSharedCredential(options.credentialSeedDir, agentDir, name);
  await assertPreparedProjectHome(home);
  for (const name of COPIED_PROJECT_FILES) await copyRegularFileIfMissing(options.credentialSeedDir, agentDir, name);
  await assertPreparedProjectHome(home);
  if (options.credentialSeedDir && !options.deferModelsMigration) {
    await migrateSharedProjectModels({
      canonicalAgentDir: options.credentialSeedDir,
      projectRoots: [options.projectRoot],
    });
  }
  return { agentDir, sessionsDir };
}
