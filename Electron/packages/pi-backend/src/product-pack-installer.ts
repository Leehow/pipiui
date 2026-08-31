import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  installLocalExtensionPackage,
  readExtensionSlotSnapshot,
  restoreExtensionSlotSnapshot,
  type ExtensionSlotSnapshot,
  type LocalExtensionPackageInstallResult,
} from "./extension-update-engine.js";
import { EXTENSION_MANIFEST_FILENAME, parseExtensionManifestJson } from "./extension-manifest.js";
import {
  PRODUCT_PROFILE_MANIFEST_FILENAME,
  parseProductProfileManifestJson,
  type ProductProfileManifest,
} from "./profile-manifest.js";
import {
  PRODUCT_PACK_MANIFEST_FILENAME,
  parseProductPackManifestJson,
  type ProductPackManifest,
} from "./product-pack-manifest.js";

export const PROJECT_PRODUCT_PACKS_DIRNAME = "product-packs";
export const PRODUCT_PACK_RECEIPT_FILENAME = "receipt.json";
export const PRODUCT_PACK_RECEIPT_SCHEMA_VERSION = 1 as const;

export type ProductPackInstallReceipt = {
  schemaVersion: typeof PRODUCT_PACK_RECEIPT_SCHEMA_VERSION;
  pack: { id: string; name: string };
  profile: { id: string };
  extensions: Array<{ id: string; version: string; contentHash: string; bytes: number }>;
  installedAt: string;
};

export type InstallLocalProductPackOptions<TActivation> = {
  /** User-selected absolute Product Pack directory. */
  sourceDirectory: string;
  /** Shared App-profile content-addressed extension store. */
  storeRoot: string;
  /** This project's isolated `.pi/agent` home. */
  projectAgentDir: string;
  /** Activates only after all extension slots and the normalized Profile exist. */
  activateProfile: (profileId: string) => Promise<TActivation>;
  /** Restores the exact pre-install project activation if a later commit fails. */
  restoreProjectActivation: () => Promise<void>;
  now?: () => number;
};

export type LocalProductPackInstallResult<TActivation> = {
  activation: TActivation;
  receipt: ProductPackInstallReceipt;
};

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function assertRealDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  return realpath(path);
}

async function confinedSource(root: string, relativePath: string, label: string, kind: "file" | "directory"): Promise<string> {
  const candidate = resolve(root, relativePath);
  if (!isInside(root, candidate)) throw new Error(`${label} escapes Product Pack root`);
  const info = await lstat(candidate);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symlink`);
  if (kind === "file" ? !info.isFile() : !info.isDirectory()) throw new Error(`${label} must be a ${kind}`);
  const real = await realpath(candidate);
  if (!isInside(root, real)) throw new Error(`${label} escapes Product Pack root`);
  return real;
}

async function writeJsonAtomic(path: string, body: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readPack(sourceDirectory: string): Promise<{ root: string; pack: ProductPackManifest; profile: ProductProfileManifest; extensionDirectories: Array<{ id: string; directory: string }> }> {
  const root = await assertRealDirectory(sourceDirectory, "Product Pack sourceDirectory");
  const packManifestPath = await confinedSource(root, PRODUCT_PACK_MANIFEST_FILENAME, "Product Pack manifest", "file");
  const parsedPack = parseProductPackManifestJson(
    await readFile(packManifestPath, "utf8"),
  );
  if (!parsedPack.ok) throw new Error(`Product Pack manifest invalid: ${parsedPack.errors.join("; ")}`);
  const profilePath = await confinedSource(root, parsedPack.pack.profile, "Product Pack profile", "file");
  const parsedProfile = parseProductProfileManifestJson(await readFile(profilePath, "utf8"));
  if (!parsedProfile.ok) throw new Error(`Product Profile manifest invalid: ${parsedProfile.errors.join("; ")}`);

  const extensionDirectories: Array<{ id: string; directory: string }> = [];
  for (const extension of parsedPack.pack.extensions) {
    const directory = await confinedSource(root, extension.path, `Product Pack extension '${extension.id}'`, "directory");
    const manifestPath = await confinedSource(directory, EXTENSION_MANIFEST_FILENAME, `Product Pack extension '${extension.id}' manifest`, "file");
    const parsed = parseExtensionManifestJson(await readFile(manifestPath, "utf8"));
    if (!parsed.ok) throw new Error(`Product Pack extension '${extension.id}' manifest invalid: ${parsed.errors.join("; ")}`);
    if (parsed.manifest.id !== extension.id) {
      throw new Error(`Product Pack extension entry '${extension.id}' does not match package id '${parsed.manifest.id}'`);
    }
    extensionDirectories.push({ id: extension.id, directory });
  }
  return { root, pack: parsedPack.pack, profile: parsedProfile.profile, extensionDirectories };
}

/**
 * Transactionally import a locally selected Product Pack. Immutable objects and
 * their receipts may remain after a failed attempt, like the existing update
 * engine; mutable extension slots, the project Profile, activation, and Pack
 * receipt are restored to their exact pre-install shape.
 */
export async function installLocalProductPack<TActivation>(
  options: InstallLocalProductPackOptions<TActivation>,
): Promise<LocalProductPackInstallResult<TActivation>> {
  const { pack, profile, extensionDirectories } = await readPack(options.sourceDirectory);
  const projectAgentDir = await assertRealDirectory(options.projectAgentDir, "projectAgentDir");
  const profilesRoot = join(projectAgentDir, "profiles");
  const profileDestination = join(profilesRoot, profile.id);
  const packsRoot = join(projectAgentDir, PROJECT_PRODUCT_PACKS_DIRNAME);
  const packDestination = join(packsRoot, pack.id);
  if (existsSync(profileDestination)) throw new Error(`Product Profile already installed: ${profile.id}`);
  if (existsSync(packDestination)) throw new Error(`Product Pack already installed: ${pack.id}`);

  const slotSnapshots = new Map<string, ExtensionSlotSnapshot>();
  for (const extension of extensionDirectories) {
    slotSnapshots.set(extension.id, await readExtensionSlotSnapshot(options.storeRoot, extension.id));
  }

  const profileStaging = join(profilesRoot, `.${profile.id}-${process.pid}-${Date.now()}.staging`);
  let profileCreated = false;
  let profileActivated = false;
  const installed: LocalExtensionPackageInstallResult[] = [];
  try {
    await mkdir(profilesRoot, { recursive: true });
    await mkdir(profileStaging, { recursive: false });
    await writeFile(
      join(profileStaging, PRODUCT_PROFILE_MANIFEST_FILENAME),
      `${JSON.stringify(profile, null, 2)}\n`,
      "utf8",
    );
    await rename(profileStaging, profileDestination);
    profileCreated = true;

    for (const extension of extensionDirectories) {
      installed.push(await installLocalExtensionPackage({
        extensionId: extension.id,
        sourceDirectory: extension.directory,
        packId: pack.id,
      }, { storeRoot: options.storeRoot, now: options.now }));
    }
    const activation = await options.activateProfile(profile.id);
    profileActivated = true;
    const now = options.now ?? Date.now;
    const receipt: ProductPackInstallReceipt = {
      schemaVersion: PRODUCT_PACK_RECEIPT_SCHEMA_VERSION,
      pack: { id: pack.id, name: pack.name },
      profile: { id: profile.id },
      extensions: installed
        .map(item => ({ id: item.extensionId, version: item.version, contentHash: item.contentHash, bytes: item.bytes }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      installedAt: new Date(now()).toISOString(),
    };
    await writeJsonAtomic(join(packDestination, PRODUCT_PACK_RECEIPT_FILENAME), receipt);
    return { activation, receipt };
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (profileActivated) {
      try {
        await options.restoreProjectActivation();
      } catch (rollback) {
        rollbackErrors.push(`activation: ${rollback instanceof Error ? rollback.message : String(rollback)}`);
      }
    }
    for (const [id, snapshot] of [...slotSnapshots.entries()].reverse()) {
      try {
        await restoreExtensionSlotSnapshot(options.storeRoot, id, snapshot);
      } catch (rollback) {
        rollbackErrors.push(`${id}: ${rollback instanceof Error ? rollback.message : String(rollback)}`);
      }
    }
    if (profileCreated) await rm(profileDestination, { recursive: true, force: true }).catch(rollback => {
      rollbackErrors.push(`profile: ${rollback instanceof Error ? rollback.message : String(rollback)}`);
    });
    await rm(packDestination, { recursive: true, force: true }).catch(rollback => {
      rollbackErrors.push(`receipt: ${rollback instanceof Error ? rollback.message : String(rollback)}`);
    });
    await rm(profileStaging, { recursive: true, force: true }).catch(() => undefined);
    if (rollbackErrors.length) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; Product Pack rollback failed: ${rollbackErrors.join("; ")}`);
    }
    throw error;
  }
}
