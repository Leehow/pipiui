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
  link,
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
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

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

async function openNoFollow(path: string, flags: number) {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  try {
    return await open(path, flags | noFollow);
  } catch (error) {
    // O_NOFOLLOW is not implemented on every Electron target. The fallback still fstats
    // before reading, so a path swapped to a symlink cannot expose its target bytes.
    if (!noFollow || !["EINVAL", "ENOTSUP"].includes(errnoCode(error) ?? "")) throw error;
    return await open(path, flags);
  }
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
      if (options.allowMissing && errnoCode(error) === "ENOENT") return null;
      throw error;
    }
  }
  if (!before.isFile()) throw new Error(`Refusing unsafe ${label} type at ${path}`);

  let handle;
  try {
    handle = await openNoFollow(path, fsConstants.O_RDONLY);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`Refusing changed ${label} at ${path}`);
    }
    return { source: await handle.readFile(), stat: opened };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensureRegularFileMode(path: string, mode: number, label: string): Promise<void> {
  let handle;
  try {
    handle = await openNoFollow(path, fsConstants.O_RDONLY);
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error(`Refusing unsafe ${label} type at ${path}`);
    await handle.chmod(mode);
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

interface RegularFileSnapshot {
  path: string;
  source: Buffer;
  sourceSha256: string;
  dev: number;
  ino: number;
  mode: number;
}

type ProjectModelsKind = "regular" | "missing" | "already-linked" | "alias-link" | "stale-temp-link";

function resolveLinkTarget(linkPath: string, target: string): string {
  return resolve(dirname(linkPath), target);
}

function snapshotFromRegular(path: string, regular: { source: Buffer; stat: Stats }): RegularFileSnapshot {
  return {
    path,
    source: regular.source,
    sourceSha256: sha256(regular.source),
    dev: regular.stat.dev,
    ino: regular.stat.ino,
    mode: regular.stat.mode,
  };
}

function sameIdentity(left: { dev: number; ino: number; mode: number }, right: { dev: number; ino: number; mode: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function assertSnapshotUnchanged(snapshot: RegularFileSnapshot, label: string): Promise<void> {
  const current = await lstat(snapshot.path);
  if (!current.isFile() || !sameIdentity(current, snapshot)) {
    throw new Error(`Refusing changed ${label} at ${snapshot.path}`);
  }
  const regular = await readStableRegularFile(snapshot.path, label, { expectedStat: current });
  if (
    !regular
    || !sameIdentity(regular.stat, snapshot)
    || sha256(regular.source) !== snapshot.sourceSha256
    || !regular.source.equals(snapshot.source)
  ) {
    throw new Error(`Refusing changed ${label} at ${snapshot.path}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

/** Restore `from` onto a vacant `to` without replacing an unknown occupant. */
async function exclusiveRestoreRegular(from: string, to: string): Promise<boolean> {
  try {
    await link(from, to);
    return true;
  } catch (error) {
    if (errnoCode(error) === "EEXIST") return false;
    throw error;
  }
}

async function exclusiveSymlink(target: string, path: string): Promise<void> {
  try {
    await symlink(target, path);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw new Error(`Refusing to overwrite concurrent models.json at ${path}`);
    }
    throw error;
  }
}

async function exclusiveLink(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw new Error(`Refusing to overwrite concurrent models.json at ${to}`);
    }
    throw error;
  }
}

interface FileIdentity {
  dev: number;
  ino: number;
  sourceSha256: string;
}

async function writeModelsTemp(directory: string, source: Buffer): Promise<string> {
  const temporary = join(directory, `.models-${randomUUID()}.tmp`);
  await exclusiveWrite(temporary, source, 0o600);
  return temporary;
}

async function readFileIdentity(path: string, label: string): Promise<FileIdentity> {
  const regular = await readStableRegularFile(path, label);
  if (!regular) throw new Error(`Missing ${label} at ${path}`);
  return {
    dev: regular.stat.dev,
    ino: regular.stat.ino,
    sourceSha256: sha256(regular.source),
  };
}

function samePublishedIdentity(regular: { source: Buffer; stat: Stats }, identity: FileIdentity): boolean {
  return regular.stat.dev === identity.dev
    && regular.stat.ino === identity.ino
    && sha256(regular.source) === identity.sourceSha256;
}

async function hardlinkOrCopyBackup(path: string, expectedSha: string): Promise<string> {
  const backup = `${path}.pipiui-shared-v1.${expectedSha}.${randomUUID()}.bak`;
  try {
    await link(path, backup);
  } catch {
    const regular = await readStableRegularFile(path, "canonical models.json");
    if (!regular) throw new Error(`Missing canonical models.json at ${path}`);
    await exclusiveWrite(backup, regular.source, 0o600);
  }
  await ensureRegularFileMode(backup, 0o600, "canonical models.json backup");
  const copied = await readStableRegularFile(backup, "canonical models.json backup");
  if (!copied || sha256(copied.source) !== expectedSha) {
    throw new Error(`Refusing changed canonical models.json backup at ${backup}`);
  }
  return backup;
}

async function rollbackPublishedCanonical(options: {
  canonicalPath: string;
  publishedIdentity: FileIdentity | null;
  restoreFrom: string | null;
}): Promise<void> {
  const current = await readStableRegularFile(options.canonicalPath, "canonical models.json", { allowMissing: true });
  const ours = Boolean(current && options.publishedIdentity && samePublishedIdentity(current, options.publishedIdentity));
  if (current && !ours) {
    throw new Error(`Refusing to overwrite concurrent models.json at ${options.canonicalPath}`);
  }
  if (!options.restoreFrom) return;
  if (ours) {
    const aside = `${options.canonicalPath}.pipiui-rollback-${randomUUID()}.tmp`;
    await rename(options.canonicalPath, aside);
    const restored = await exclusiveRestoreRegular(options.restoreFrom, options.canonicalPath);
    if (restored) {
      await rm(aside, { force: true });
      return;
    }
    await rm(aside, { force: true }).catch(() => undefined);
    throw new Error(`Refusing to overwrite concurrent models.json at ${options.canonicalPath}`);
  }
  if (!current) {
    const restored = await exclusiveRestoreRegular(options.restoreFrom, options.canonicalPath);
    if (!restored) {
      throw new Error(`Refusing to overwrite concurrent models.json at ${options.canonicalPath}`);
    }
  }
}

async function quarantineRegularFile(snapshot: RegularFileSnapshot, label: string): Promise<string> {
  const backup = `${snapshot.path}.pipiui-shared-v1.${snapshot.sourceSha256}.${randomUUID()}.bak`;
  await rename(snapshot.path, backup);
  try {
    const moved = await readStableRegularFile(backup, `${label} backup`);
    if (
      !moved
      || moved.stat.dev !== snapshot.dev
      || moved.stat.ino !== snapshot.ino
      || sha256(moved.source) !== snapshot.sourceSha256
      || !moved.source.equals(snapshot.source)
    ) {
      throw new Error(`Refusing changed ${label} after quarantine at ${snapshot.path}`);
    }
    await ensureRegularFileMode(backup, 0o600, `${label} backup`);
    return backup;
  } catch (error) {
    const restored = await exclusiveRestoreRegular(backup, snapshot.path);
    if (restored) await unlink(backup).catch(() => undefined);
    throw error;
  }
}

function wrapMigrationError(error: unknown, rollbackErrors: unknown[]): Error {
  if (rollbackErrors.length === 0) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const primary = error instanceof Error ? error.message : String(error);
  const details = rollbackErrors.map((item) => (item instanceof Error ? item.message : String(item))).join("; ");
  const wrapped = new Error(`${primary}; rollback failed: ${details}`);
  if (error instanceof Error) wrapped.cause = error;
  return wrapped;
}

interface ProjectModelsSource {
  projectRoot: string;
  home: PreparedProjectHome;
  path: string;
  kind: ProjectModelsKind;
  source: Buffer | null;
  sourceSha256: string | null;
  snapshot: RegularFileSnapshot | null;
  expectedLinkTarget: string | null;
  backupPath: string | null;
  symlinkQuarantinePath: string | null;
  linked: boolean;
}

type SharedModelsMigrationStep =
  | { name: "sources-read" }
  | { name: "snapshots-verified" }
  | { name: "backups-created" }
  | { name: "before-canonical-publish" }
  | { name: "after-canonical-quarantine" }
  | { name: "canonical-written" }
  | { name: "before-project-link"; projectModelsPath: string; index: number }
  | { name: "project-link-installed"; projectModelsPath: string; index: number }
  | { name: "before-manifest-write" };

/**
 * Deterministically merge project-local model catalogs into the App canonical catalog,
 * then atomically replace project catalogs with links to it. The optional hook exists
 * only to make every mutation boundary fault-injectable in temp-fixture tests.
 */
function emptyProjectSource(
  projectRoot: string,
  home: PreparedProjectHome,
  path: string,
  kind: ProjectModelsKind,
  extra: Partial<ProjectModelsSource> = {},
): ProjectModelsSource {
  return {
    projectRoot,
    home,
    path,
    kind,
    source: null,
    sourceSha256: null,
    snapshot: null,
    expectedLinkTarget: null,
    backupPath: null,
    symlinkQuarantinePath: null,
    linked: false,
    ...extra,
  };
}

function isStaleCanonicalTemp(
  target: string,
  canonicalAgentDir: string,
  canonicalAgentInput: string,
): boolean {
  const targetName = basename(target);
  return (dirname(target) === canonicalAgentDir || dirname(target) === canonicalAgentInput)
    && targetName.startsWith(".")
    && targetName.endsWith(".tmp");
}

async function assertProjectUnchanged(project: ProjectModelsSource): Promise<void> {
  if (project.kind === "regular" && project.snapshot) {
    await assertSnapshotUnchanged(project.snapshot, "project models.json");
    return;
  }
  if (project.kind === "missing") {
    if (await pathExists(project.path)) {
      throw new Error(`Refusing changed project models.json at ${project.path}`);
    }
    return;
  }
  if (project.kind === "alias-link" || project.kind === "stale-temp-link") {
    const current = await lstat(project.path);
    if (!current.isSymbolicLink()) {
      throw new Error(`Refusing changed project models.json at ${project.path}`);
    }
    if (await readlink(project.path) !== project.expectedLinkTarget) {
      throw new Error(`Refusing changed project models.json symlink at ${project.path}`);
    }
  }
}

async function installProjectCanonicalLink(
  project: ProjectModelsSource,
  canonicalPath: string,
): Promise<void> {
  if (project.kind === "regular" || project.kind === "missing") {
    await exclusiveSymlink(canonicalPath, project.path);
    project.linked = true;
    return;
  }

  const current = await lstat(project.path);
  if (!current.isSymbolicLink()) {
    throw new Error(`Refusing changed project models.json at ${project.path}`);
  }
  const rawTarget = await readlink(project.path);
  if (rawTarget === canonicalPath) {
    project.linked = true;
    return;
  }
  if (rawTarget !== project.expectedLinkTarget) {
    throw new Error(`Refusing changed project models.json symlink at ${project.path}`);
  }

  const quarantine = join(dirname(project.path), `.models-alias-${randomUUID()}.tmp`);
  await rename(project.path, quarantine);
  project.symlinkQuarantinePath = quarantine;
  try {
    await exclusiveSymlink(canonicalPath, project.path);
    project.linked = true;
  } catch (error) {
    if (!await pathExists(project.path)) {
      try {
        await exclusiveSymlink(rawTarget, project.path);
      } catch (restoreError) {
        throw wrapMigrationError(error, [restoreError]);
      }
    }
    throw error;
  }
}

async function rollbackProjectModels(
  project: ProjectModelsSource,
  canonicalPath: string,
): Promise<void> {
  await assertPreparedProjectHome(project.home);
  const current = await pathExists(project.path) ? await lstat(project.path) : null;
  const currentTarget = current?.isSymbolicLink() ? await readlink(project.path) : null;

  if (project.linked && current?.isSymbolicLink() && currentTarget === canonicalPath) {
    await unlink(project.path);
  }

  if (project.kind === "regular" && project.backupPath) {
    if (await pathExists(project.path)) return;
    await exclusiveRestoreRegular(project.backupPath, project.path);
    return;
  }

  if (project.symlinkQuarantinePath && !await pathExists(project.path)) {
    const previous = await readlink(project.symlinkQuarantinePath);
    await exclusiveSymlink(previous, project.path);
  }
}

async function cleanupProjectSymlinkQuarantine(project: ProjectModelsSource): Promise<void> {
  if (!project.symlinkQuarantinePath) return;
  await rm(project.symlinkQuarantinePath, { force: true });
  project.symlinkQuarantinePath = null;
}

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

  let canonicalRegular = await readStableRegularFile(canonicalPath, "canonical models.json", { allowMissing: true });
  if (canonicalRegular) {
    await ensureRegularFileMode(canonicalPath, 0o600, "canonical models.json");
    canonicalRegular = await readStableRegularFile(canonicalPath, "canonical models.json");
  }
  const canonicalSource = canonicalRegular?.source ?? null;
  const canonicalSourceSha = canonicalSource ? sha256(canonicalSource) : null;
  const canonicalValue: JsonValue = canonicalSource ? parseModels(canonicalSource, canonicalPath) : { providers: {} };
  let merged: JsonValue = structuredClone(canonicalValue);

  const canonicalRoots: string[] = [];
  for (const candidate of options.projectRoots) {
    try {
      canonicalRoots.push(await realpath(resolve(candidate)));
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
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
        const rawTarget = readlinkSync(path);
        if (rawTarget === canonicalPath) {
          projects.push(emptyProjectSource(projectRoot, home, path, "already-linked", { expectedLinkTarget: rawTarget }));
          continue;
        }
        const resolvedTarget = resolveLinkTarget(path, rawTarget);
        const aliasOfCanonical = rawTarget === canonicalInputPath
          || resolvedTarget === canonicalInputPath
          || resolvedTarget === canonicalPath;
        if (aliasOfCanonical) {
          projects.push(emptyProjectSource(projectRoot, home, path, "alias-link", { expectedLinkTarget: rawTarget }));
          continue;
        }
        // Repair only the exact class of link left by the interrupted legacy migration:
        // a hidden, same-canonical-directory temp target. Never follow or read that target.
        if (!isStaleCanonicalTemp(resolvedTarget, canonicalAgentDir, canonicalAgentInput)) {
          throw new Error(`Refusing untrusted project models.json symlink at ${path}`);
        }
        projects.push(emptyProjectSource(projectRoot, home, path, "stale-temp-link", { expectedLinkTarget: rawTarget }));
        continue;
      }
      const regular = await readStableRegularFile(path, "project models.json", { expectedStat: stat });
      const snapshot = snapshotFromRegular(path, regular!);
      merged = mergeMissing(merged, parseModels(snapshot.source, path), [], conflicts);
      projects.push(emptyProjectSource(projectRoot, home, path, "regular", {
        source: snapshot.source,
        sourceSha256: snapshot.sourceSha256,
        snapshot,
      }));
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      projects.push(emptyProjectSource(projectRoot, home, path, "missing"));
    }
  }

  const canonicalNeedsWrite = !canonicalSource || !equalJson(canonicalValue, merged);
  const result = canonicalNeedsWrite
    ? Buffer.from(`${JSON.stringify(merged, null, 2)}\n`)
    : canonicalSource!;
  const resultSha = sha256(result);
  const projectsToLink = projects.filter((project) => project.kind !== "already-linked");
  if (!canonicalNeedsWrite && projectsToLink.length === 0) {
    if (canonicalRegular) await ensureRegularFileMode(canonicalPath, 0o600, "canonical models.json");
    return null;
  }

  for (const project of projects) await assertPreparedProjectHome(project.home);
  await options.onMigrationStep?.({ name: "sources-read" });
  for (const project of projectsToLink) await assertProjectUnchanged(project);
  await options.onMigrationStep?.({ name: "snapshots-verified" });

  let canonicalBackup: string | null = null;
  let canonicalQuarantinePath: string | null = null;
  let canonicalReplaced = false;
  let publishedIdentity: FileIdentity | null = null;
  let publishTemp: string | null = null;
  const manifestPath = join(canonicalAgentDir, SHARED_MODELS_MANIFEST);
  const discardPublishTemp = async () => {
    if (!publishTemp) return;
    await rm(publishTemp, { force: true }).catch(() => undefined);
    publishTemp = null;
  };
  try {
    // With no initial canonical, no-replace-publish the merged catalog before any project
    // mutation. Once this stable pathname exists it is deliberately not part of rollback:
    // coordinated readers must never observe ENOENT after the first successful publish.
    if (!canonicalSource) {
      publishTemp = await writeModelsTemp(canonicalAgentDir, result);
      await options.onMigrationStep?.({ name: "before-canonical-publish" });
      try {
        await exclusiveLink(publishTemp, canonicalPath);
      } catch (error) {
        await discardPublishTemp();
        throw error;
      }
      await discardPublishTemp();
      publishedIdentity = await readFileIdentity(canonicalPath, "canonical models.json");
      await ensureRegularFileMode(canonicalPath, 0o600, "canonical models.json");
      await options.onMigrationStep?.({ name: "canonical-written" });
    }

    if (projectsToLink.some((project) => project.source !== null) && canonicalSource) {
      canonicalBackup = await hardlinkOrCopyBackup(canonicalPath, canonicalSourceSha!);
    }
    for (const project of projectsToLink) {
      await assertPreparedProjectHome(project.home);
      await assertProjectUnchanged(project);
      if (project.kind === "regular" && project.snapshot) {
        project.backupPath = await quarantineRegularFile(project.snapshot, "project models.json");
      }
    }

    await options.onMigrationStep?.({ name: "backups-created" });
    if (canonicalNeedsWrite && canonicalSource && canonicalRegular) {
      const snapshot = snapshotFromRegular(canonicalPath, canonicalRegular);
      await assertSnapshotUnchanged(snapshot, "canonical models.json");
      if (!canonicalBackup) {
        canonicalBackup = await hardlinkOrCopyBackup(canonicalPath, canonicalSourceSha!);
      }
      publishTemp = await writeModelsTemp(canonicalAgentDir, result);
      await options.onMigrationStep?.({ name: "before-canonical-publish" });
      await assertSnapshotUnchanged(snapshot, "canonical models.json");
      canonicalQuarantinePath = `${canonicalPath}.pipiui-shared-v1.${canonicalSourceSha}.${randomUUID()}.quarantine`;
      await rename(canonicalPath, canonicalQuarantinePath);
      try {
        const moved = await readStableRegularFile(canonicalQuarantinePath, "canonical models.json quarantine");
        if (
          !moved
          || moved.stat.dev !== snapshot.dev
          || moved.stat.ino !== snapshot.ino
          || sha256(moved.source) !== snapshot.sourceSha256
          || !moved.source.equals(snapshot.source)
        ) {
          throw new Error(`Refusing changed canonical models.json after quarantine at ${canonicalPath}`);
        }
        await options.onMigrationStep?.({ name: "after-canonical-quarantine" });
        await exclusiveLink(publishTemp, canonicalPath);
      } catch (error) {
        await discardPublishTemp();
        if (!await pathExists(canonicalPath)) {
          const restored = await exclusiveRestoreRegular(canonicalQuarantinePath, canonicalPath);
          if (!restored) {
            throw wrapMigrationError(error, [
              new Error(`Refusing to overwrite concurrent models.json at ${canonicalPath}`),
            ]);
          }
        }
        throw error;
      }
      await discardPublishTemp();
      publishedIdentity = await readFileIdentity(canonicalPath, "canonical models.json");
      await ensureRegularFileMode(canonicalPath, 0o600, "canonical models.json");
      canonicalReplaced = true;
      await options.onMigrationStep?.({ name: "canonical-written" });
    }
    for (let index = 0; index < projectsToLink.length; index += 1) {
      const project = projectsToLink[index];
      await assertPreparedProjectHome(project.home);
      await options.onMigrationStep?.({ name: "before-project-link", projectModelsPath: project.path, index });
      await installProjectCanonicalLink(project, canonicalPath);
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
    await ensureRegularFileMode(canonicalPath, 0o600, "canonical models.json");
    for (const project of projectsToLink) await cleanupProjectSymlinkQuarantine(project);
    if (canonicalQuarantinePath && canonicalQuarantinePath !== canonicalBackup) {
      await rm(canonicalQuarantinePath, { force: true });
    }
    return manifest;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const project of [...projectsToLink].reverse()) {
      try {
        await rollbackProjectModels(project, canonicalPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (canonicalReplaced) {
      try {
        await rollbackPublishedCanonical({
          canonicalPath,
          publishedIdentity,
          restoreFrom: canonicalQuarantinePath ?? canonicalBackup,
        });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    await discardPublishTemp();
    throw wrapMigrationError(error, rollbackErrors);
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
}): Promise<{ agentDir: string; sessionsDir: string; realProjectRoot: string }> {
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
  return { agentDir, sessionsDir, realProjectRoot: home.projectRoot.path };
}
