import { PRODUCT_PROFILE_ID_RE } from "./profile-manifest.js";

export const PRODUCT_PACK_MANIFEST_FILENAME = "pipiui-product-pack.json";
export const PRODUCT_PACK_SCHEMA_VERSION = 1 as const;

export type ProductPackExtension = {
  id: string;
  path: string;
};

/** Pure Product Pack assembly data. It contains no executable settings or secrets. */
export type ProductPackManifest = {
  schemaVersion: typeof PRODUCT_PACK_SCHEMA_VERSION;
  id: string;
  name: string;
  profile: string;
  extensions: ProductPackExtension[];
};

export type ProductPackManifestValidation =
  | { ok: true; pack: ProductPackManifest }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Paths are declarative, portable package-relative names — no absolute, parent, or empty segments. */
export function isProductPackRelativePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[A-Za-z]:[\\/]/.test(value)
    && !value.split(/[\\/]/).some(segment => !segment || segment === "." || segment === "..");
}

export function parseProductPackManifest(value: unknown): ProductPackManifestValidation {
  if (!isRecord(value)) return { ok: false, errors: ["Product Pack manifest must be an object"] };
  const errors: string[] = [];
  if (value.schemaVersion !== PRODUCT_PACK_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PRODUCT_PACK_SCHEMA_VERSION}`);
  }
  const id = string(value.id);
  if (!id || !PRODUCT_PROFILE_ID_RE.test(id)) errors.push("id must be a semantic slug");
  const name = string(value.name);
  if (!name) errors.push("name must be a non-empty string");
  const profile = string(value.profile);
  if (!profile || !isProductPackRelativePath(profile)) {
    errors.push("profile must be a package-relative path");
  }
  if (!Array.isArray(value.extensions)) {
    errors.push("extensions must be an array");
  }
  const extensions: ProductPackExtension[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.extensions)) {
    for (const [index, item] of value.extensions.entries()) {
      if (!isRecord(item)) {
        errors.push(`extensions[${index}] must be an object`);
        continue;
      }
      const extensionId = string(item.id);
      const path = string(item.path);
      if (!extensionId || !PRODUCT_PROFILE_ID_RE.test(extensionId)) {
        errors.push(`extensions[${index}].id must be a semantic slug`);
        continue;
      }
      if (seen.has(extensionId)) {
        errors.push(`extensions contains duplicate extension '${extensionId}'`);
        continue;
      }
      seen.add(extensionId);
      if (!path || !isProductPackRelativePath(path)) {
        errors.push(`extensions[${index}].path must be a package-relative path`);
        continue;
      }
      extensions.push({ id: extensionId, path });
    }
  }
  if (errors.length || !id || !name || !profile) return { ok: false, errors };
  return {
    ok: true,
    pack: {
      schemaVersion: PRODUCT_PACK_SCHEMA_VERSION,
      id,
      name,
      profile,
      extensions,
    },
  };
}

export function parseProductPackManifestJson(text: string): ProductPackManifestValidation {
  try {
    return parseProductPackManifest(JSON.parse(text));
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
