import { isValidExtensionHostApiRange } from "./extension-manifest.js";

export const PRODUCT_PROFILE_MANIFEST_FILENAME = "pipiui-profile.json";
export const PRODUCT_PROFILE_SCHEMA_VERSION = 1 as const;
export const PRODUCT_PROFILE_ID_RE = /^[a-z][a-z0-9-]*$/;

export type ProductProfileExtensionRequirement = {
  id: string;
  version: string;
};

export type ProductProfileLayout = {
  primarySidebar?: string;
  center?: string;
  auxiliarySidebar?: string;
  activity?: string[];
};

export type ProductProfileManifest = {
  schemaVersion: typeof PRODUCT_PROFILE_SCHEMA_VERSION;
  id: string;
  name: string;
  description?: string;
  /** Project-local profiles created in Settings may edit their extension membership. */
  customizable?: boolean;
  extensions: {
    required: ProductProfileExtensionRequirement[];
    recommended: ProductProfileExtensionRequirement[];
  };
  layout: ProductProfileLayout;
};

export type ProductProfileManifestValidation =
  | { ok: true; profile: ProductProfileManifest }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requirements(value: unknown, label: string, errors: string[]): ProductProfileExtensionRequirement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  const out: ProductProfileExtensionRequirement[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`${label}[${index}] must be an object`);
      continue;
    }
    const id = string(item.id);
    const version = string(item.version);
    if (!id || !PRODUCT_PROFILE_ID_RE.test(id)) {
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

function layout(value: unknown, errors: string[]): ProductProfileLayout {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    errors.push("layout must be an object");
    return {};
  }
  const out: ProductProfileLayout = {};
  for (const key of ["primarySidebar", "center", "auxiliarySidebar"] as const) {
    if (value[key] === undefined) continue;
    const id = string(value[key]);
    if (!id) errors.push(`layout.${key} must be a non-empty contribution id`);
    else out[key] = id;
  }
  if (value.activity !== undefined) {
    if (!Array.isArray(value.activity) || value.activity.some(item => !string(item))) {
      errors.push("layout.activity must be an array of contribution ids");
    } else {
      out.activity = value.activity.map(item => string(item)!);
    }
  }
  return out;
}

export function parseProductProfileManifest(value: unknown): ProductProfileManifestValidation {
  if (!isRecord(value)) return { ok: false, errors: ["profile manifest must be an object"] };
  const errors: string[] = [];
  if (value.schemaVersion !== PRODUCT_PROFILE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${PRODUCT_PROFILE_SCHEMA_VERSION}`);
  }
  const id = string(value.id);
  if (!id || !PRODUCT_PROFILE_ID_RE.test(id)) errors.push("id must be a semantic slug");
  const name = string(value.name);
  if (!name) errors.push("name must be a non-empty string");
  const description = value.description === undefined ? undefined : string(value.description);
  if (value.description !== undefined && !description) errors.push("description must be a non-empty string");
  const customizable = value.customizable === undefined
    ? undefined
    : typeof value.customizable === "boolean"
      ? value.customizable
      : undefined;
  if (value.customizable !== undefined && customizable === undefined) errors.push("customizable must be a boolean");
  const extensionRecord = isRecord(value.extensions) ? value.extensions : undefined;
  if (!extensionRecord) errors.push("extensions must be an object");
  const required = requirements(extensionRecord?.required, "extensions.required", errors);
  const recommended = requirements(extensionRecord?.recommended, "extensions.recommended", errors);
  const overlap = required.find(item => recommended.some(other => other.id === item.id));
  if (overlap) errors.push(`extension '${overlap.id}' cannot be both required and recommended`);
  const resolvedLayout = layout(value.layout, errors);
  if (errors.length || !id || !name) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      schemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
      id,
      name,
      ...(description ? { description } : {}),
      ...(customizable !== undefined ? { customizable } : {}),
      extensions: { required, recommended },
      layout: resolvedLayout,
    },
  };
}

export function parseProductProfileManifestJson(text: string): ProductProfileManifestValidation {
  try {
    return parseProductProfileManifest(JSON.parse(text));
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
