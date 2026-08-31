import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  PRODUCT_PROFILE_ID_RE,
  PRODUCT_PROFILE_MANIFEST_FILENAME,
  PRODUCT_PROFILE_SCHEMA_VERSION,
  parseProductProfileManifestJson,
  type ProductProfileManifest,
  type ProductProfileExtensionRequirement,
} from "./profile-manifest.js";

const CUSTOM_PROFILE_ID_FALLBACK = "custom-pack";
const CUSTOM_PROFILE_LAYOUT = {
  primarySidebar: "pipi.sessions",
  center: "pipi.conversation",
  activity: ["pipi.sessions"],
} as const;
const CUSTOM_PROFILE_REQUIRED_EXTENSIONS: ProductProfileExtensionRequirement[] = [
  { id: "skill-loader-extension", version: "^1.0.0" },
];

export type EditableProfileExtension = {
  id: string;
  version: string;
};

function profilesRoot(projectAgentDir: string): string {
  return join(projectAgentDir, "profiles");
}

function profilePath(projectAgentDir: string, profileId: string): string {
  return join(profilesRoot(projectAgentDir), profileId, PRODUCT_PROFILE_MANIFEST_FILENAME);
}

function profileSlug(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const candidate = normalized || CUSTOM_PROFILE_ID_FALLBACK;
  return /^[a-z]/.test(candidate) ? candidate : `pack-${candidate}`;
}

async function allocateProfileId(projectAgentDir: string, name: string): Promise<string> {
  const root = profilesRoot(projectAgentDir);
  let existing: string[] = [];
  try {
    existing = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const used = new Set(existing);
  const base = profileSlug(name);
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("unable to allocate a semantic custom Profile id");
}

async function writeProfileAtomic(projectAgentDir: string, profile: ProductProfileManifest, create = false): Promise<void> {
  const directory = join(profilesRoot(projectAgentDir), profile.id);
  await mkdir(profilesRoot(projectAgentDir), { recursive: true });
  await mkdir(directory, { recursive: !create });
  const path = join(directory, PRODUCT_PROFILE_MANIFEST_FILENAME);
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (create) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function extensionRequirements(extensions: readonly EditableProfileExtension[]): ProductProfileExtensionRequirement[] {
  const seen = new Set<string>();
  const out: ProductProfileExtensionRequirement[] = [];
  for (const extension of [...extensions].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!PRODUCT_PROFILE_ID_RE.test(extension.id)) throw new Error(`invalid extension id '${extension.id}'`);
    if (seen.has(extension.id)) throw new Error(`duplicate extension '${extension.id}'`);
    seen.add(extension.id);
    out.push({ id: extension.id, version: extension.version });
  }
  return out;
}

export async function createCustomProductProfile(
  projectAgentDir: string,
  nameValue: string,
): Promise<ProductProfileManifest> {
  const name = nameValue.trim();
  if (!name) throw new Error("扩展包名称不能为空");
  if (name.length > 80) throw new Error("扩展包名称不能超过 80 个字符");
  const id = await allocateProfileId(projectAgentDir, name);
  const profile: ProductProfileManifest = {
    schemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    id,
    name,
    description: "项目自定义扩展包",
    customizable: true,
    extensions: { required: CUSTOM_PROFILE_REQUIRED_EXTENSIONS.map(item => ({ ...item })), recommended: [] },
    layout: { ...CUSTOM_PROFILE_LAYOUT, activity: [...CUSTOM_PROFILE_LAYOUT.activity] },
  };
  await writeProfileAtomic(projectAgentDir, profile, true);
  return profile;
}

export async function updateCustomProductProfileExtensions(
  projectAgentDir: string,
  profileId: string,
  extensions: readonly EditableProfileExtension[],
): Promise<ProductProfileManifest> {
  if (!PRODUCT_PROFILE_ID_RE.test(profileId)) throw new Error("扩展包 id 必须是语义 slug");
  const path = profilePath(projectAgentDir, profileId);
  const parsed = parseProductProfileManifestJson(await readFile(path, "utf8"));
  if (!parsed.ok) throw new Error(`Product Profile ${profileId} is invalid: ${parsed.errors.join("; ")}`);
  if (!parsed.profile.customizable) throw new Error(`Product Profile ${profileId} is not customizable`);
  const requiredIds = new Set(parsed.profile.extensions.required.map(item => item.id));
  const duplicateRequired = extensions.find(extension => requiredIds.has(extension.id));
  if (duplicateRequired) throw new Error(`extension '${duplicateRequired.id}' is already required by this Profile`);
  const next: ProductProfileManifest = {
    ...parsed.profile,
    extensions: {
      required: parsed.profile.extensions.required.map(item => ({ ...item })),
      recommended: extensionRequirements(extensions),
    },
  };
  await writeProfileAtomic(projectAgentDir, next);
  return next;
}
