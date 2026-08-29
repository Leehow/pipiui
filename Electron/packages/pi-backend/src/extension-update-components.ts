/**
 * Generic extension update-component declaration contract.
 * Manifests declare which open-source components they bundle (installed
 * version + where the version checker must look). Sources are a closed union
 * over fixed registry/API endpoints — never arbitrary URLs, so a manifest
 * cannot form an SSRF surface. This phase declares metadata only: update
 * checks stay host-side and never install anything.
 */

/** Max declared components in one manifest (mirror sibling contribution caps). */
export const EXTENSION_UPDATE_COMPONENTS_MAX = 32;

/** Semantic component slug (same shape as extension / provider ids). */
export const EXTENSION_COMPONENT_ID_RE = /^[a-z][a-z0-9-]*$/;

export const EXTENSION_UPDATE_SOURCE_TYPES = ["npm", "pypi", "githubReleases"] as const;
export type ExtensionUpdateSourceType = (typeof EXTENSION_UPDATE_SOURCE_TYPES)[number];

/**
 * Closed version-check source union. `npm`/`pypi` resolve a package/project
 * name on the fixed registry; `githubReleases` resolves an owner/repo on the
 * fixed GitHub Releases API. No URL or host field exists by construction.
 */
export type ExtensionUpdateComponentSource =
  | { type: "npm"; packageName: string }
  | { type: "pypi"; packageName: string }
  | { type: "githubReleases"; owner: string; repo: string };

/** Owner-neutral declared open-source component bundled by an extension. */
export type ExtensionUpdateComponent = {
  id: string;
  name: string;
  /** Installed/bundled version at declaration time (display + drift checks). */
  version: string;
  source: ExtensionUpdateComponentSource;
  /** Human-facing upstream project page. Display only — never fetched. */
  upstream?: string;
  /** License label (e.g. `MIT`). Display only. */
  license?: string;
};

export type UpdateComponentsValidation =
  | { ok: true; components: ExtensionUpdateComponent[] }
  | { ok: false; errors: string[] };

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

const NPM_PACKAGE_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const PYPI_PROJECT_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const GITHUB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const SOURCE_KEYS: Record<ExtensionUpdateSourceType, Set<string>> = {
  npm: new Set(["type", "packageName"]),
  pypi: new Set(["type", "packageName"]),
  githubReleases: new Set(["type", "owner", "repo"]),
};

const COMPONENT_KEYS = new Set(["id", "name", "version", "source", "upstream", "license"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
  errors: string[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`unknown field '${key}' in ${label}`);
  }
}

function parseSource(
  value: unknown,
  label: string,
  errors: string[],
): ExtensionUpdateComponentSource | undefined {
  if (!isRecord(value)) {
    errors.push(`${label}.source must be an object`);
    return undefined;
  }
  const type = value.type;
  if (typeof type !== "string" || !(EXTENSION_UPDATE_SOURCE_TYPES as readonly string[]).includes(type)) {
    errors.push(
      `${label}.source.type must be one of ${EXTENSION_UPDATE_SOURCE_TYPES.join(", ")}`,
    );
    return undefined;
  }
  const sourceType = type as ExtensionUpdateSourceType;
  rejectUnknownKeys(value, SOURCE_KEYS[sourceType], `${label}.source`, errors);
  if (sourceType === "githubReleases") {
    const owner = asNonEmptyString(value.owner);
    const repo = asNonEmptyString(value.repo);
    if (!owner) errors.push(`${label}.source.owner must be a non-empty GitHub owner`);
    else if (!GITHUB_NAME_RE.test(owner)) {
      errors.push(`${label}.source.owner is not a valid GitHub owner '${owner}'`);
    }
    if (!repo) errors.push(`${label}.source.repo must be a non-empty GitHub repository name`);
    else if (!GITHUB_NAME_RE.test(repo)) {
      errors.push(`${label}.source.repo is not a valid GitHub repository name '${repo}'`);
    }
    if (owner && repo && GITHUB_NAME_RE.test(owner) && GITHUB_NAME_RE.test(repo)) {
      return { type: sourceType, owner, repo };
    }
    return undefined;
  }
  const packageName = asNonEmptyString(value.packageName);
  if (!packageName) {
    errors.push(`${label}.source.packageName must be a non-empty string`);
    return undefined;
  }
  const nameRe = sourceType === "npm" ? NPM_PACKAGE_NAME_RE : PYPI_PROJECT_NAME_RE;
  if (!nameRe.test(packageName)) {
    errors.push(
      `${label}.source.packageName is not a valid ${sourceType === "npm" ? "npm package" : "PyPI project"} name '${packageName}'`,
    );
    return undefined;
  }
  return { type: sourceType, packageName };
}

/**
 * Same closed source union as `updateComponents[].source`, exported for the
 * manifest-level `update` metadata block (extension artifact discovery).
 * Collects into `errors` and returns `undefined` on failure.
 */
export function parseExtensionUpdateSource(
  value: unknown,
  label: string,
  errors: string[],
): ExtensionUpdateComponentSource | undefined {
  return parseSource(value, label, errors);
}

/**
 * Parse a manifest `updateComponents` array. Missing field is not an error
 * (no declared components). Malformed entries collect per-item errors; the
 * manifest fails validation when any error is present.
 */
export function parseExtensionUpdateComponents(
  value: unknown,
): UpdateComponentsValidation | undefined {
  if (value === undefined || value === null) return undefined;
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    return { ok: false, errors: ["updateComponents must be an array"] };
  }
  if (value.length > EXTENSION_UPDATE_COMPONENTS_MAX) {
    errors.push(`updateComponents must have at most ${EXTENSION_UPDATE_COMPONENTS_MAX} entries`);
  }
  const components: ExtensionUpdateComponent[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const label = `updateComponents[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    rejectUnknownKeys(raw, COMPONENT_KEYS, label, errors);
    const id = asNonEmptyString(raw.id);
    if (!id) errors.push(`${label} missing id`);
    else if (!EXTENSION_COMPONENT_ID_RE.test(id)) {
      errors.push(`${label} invalid id '${id}': must match [a-z][a-z0-9-]*`);
    }
    const name = asNonEmptyString(raw.name);
    if (!name) errors.push(`${label} missing name`);
    const version = asNonEmptyString(raw.version);
    if (!version) errors.push(`${label} missing version`);

    let upstream: string | undefined;
    if (raw.upstream !== undefined) {
      const declared = asNonEmptyString(raw.upstream);
      if (!declared || CONTROL_CHAR_RE.test(declared)) {
        errors.push(`${label}.upstream must be an https:// URL`);
      } else {
        try {
          const url = new URL(declared);
          if (url.protocol !== "https:") errors.push(`${label}.upstream must be an https:// URL`);
          else upstream = declared;
        } catch {
          errors.push(`${label}.upstream must be an https:// URL`);
        }
      }
    }

    let license: string | undefined;
    if (raw.license !== undefined) {
      license = asNonEmptyString(raw.license);
      if (!license) errors.push(`${label}.license must be a non-empty string`);
    }

    const source = parseSource(raw.source, label, errors);
    if (id && seen.has(id)) errors.push(`duplicate update component id '${id}'`);
    if (id) seen.add(id);

    if (!id || !name || !version || !source) continue;
    const component: ExtensionUpdateComponent = { id, name, version, source };
    if (upstream) component.upstream = upstream;
    if (license) component.license = license;
    components.push(component);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, components };
}
