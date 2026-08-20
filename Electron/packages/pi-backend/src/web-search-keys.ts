import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SEARCH_ROUTING } from "./web-search-defaults.js";

export const WEB_SEARCH_CONFIG_NAME = "web-search.json";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

export function webSearchConfigPath(agentDir: string): string {
  return join(agentDir, WEB_SEARCH_CONFIG_NAME);
}

async function readWebSearchConfig(agentDir: string): Promise<JsonObject> {
  try {
    const parsed = JSON.parse(await readFile(webSearchConfigPath(agentDir), "utf8"));
    return asObject(parsed) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeWebSearchConfigAtomic(agentDir: string, next: JsonObject): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const path = webSearchConfigPath(agentDir);
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

const API_KEY_SUFFIX = "ApiKey";

function isApiKeyField(key: string): boolean {
  return key.endsWith(API_KEY_SUFFIX) && key.length > API_KEY_SUFFIX.length;
}

/**
 * Read which `*ApiKey` fields are configured in the project's web-search.json.
 * Values are never returned — only `true` for non-empty string keys.
 * Returns {} when the file does not exist.
 */
export async function readWebSearchApiKeys(agentDir: string): Promise<Record<string, boolean>> {
  const config = await readWebSearchConfig(agentDir);
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isApiKeyField(key) && typeof value === "string" && value.trim() !== "") {
      result[key] = true;
    }
  }
  return result;
}

function providerFromKeyField(field: string): string {
  if (field === "cloudflareApiKey") return "gemini";
  return field.slice(0, -"ApiKey".length);
}

/**
 * Reorder `searchRouting.providers` so providers with non-empty API keys
 * come first, preserving their relative order from the default list.
 * Returns the reordered array, or null if there are no keyed providers
 * (meaning the caller should not modify searchRouting).
 *
 * Only providers that appear in DEFAULT_SEARCH_ROUTING.providers are
 * considered; explicit-only providers (anysearch, xai, brightdata, serpbase)
 * are not added to the routing list.
 */
function reorderProvidersForKeyPriority(config: JsonObject): string[] | null {
  const keyedProviders = new Set<string>();
  for (const [key, value] of Object.entries(config)) {
    if (isApiKeyField(key) && typeof value === "string" && value.trim() !== "") {
      keyedProviders.add(providerFromKeyField(key));
    }
  }

  if (keyedProviders.size === 0) return null;

  const defaultList = DEFAULT_SEARCH_ROUTING.providers as readonly string[];
  const withKeys: string[] = [];
  const withoutKeys: string[] = [];
  for (const provider of defaultList) {
    if (keyedProviders.has(provider)) {
      withKeys.push(provider);
    } else {
      withoutKeys.push(provider);
    }
  }
  return [...withKeys, ...withoutKeys];
}

/**
 * Merge the given keys into web-search.json atomically.
 * - Non-empty values are set (overwriting existing).
 * - Empty strings delete the field.
 * - All other fields in the config are preserved (passed through untouched).
 * - After merging, if at least one non-empty ApiKey exists, reorders
 *   `searchRouting.providers` so keyed providers come first (relative order
 *   from DEFAULT_SEARCH_ROUTING preserved). If no keys are present, leaves
 *   searchRouting untouched.
 * Returns the list of configured (non-empty) ApiKey field names.
 */
export async function writeWebSearchApiKeys(
  agentDir: string,
  keys: Record<string, string>,
): Promise<string[]> {
  const current = await readWebSearchConfig(agentDir);
  const next: JsonObject = { ...current };

  for (const [key, value] of Object.entries(keys)) {
    if (!isApiKeyField(key)) continue; // 只允许 *ApiKey 字段
    if (typeof value !== "string") continue;
    if (value.trim() === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  // Reorder searchRouting.providers based on key priority
  const reordered = reorderProvidersForKeyPriority(next);
  if (reordered !== null) {
    const existingRouting = asObject(next.searchRouting);
    if (existingRouting) {
      next.searchRouting = { ...existingRouting, providers: reordered };
    } else {
      next.searchRouting = {
        providers: reordered,
        fallbackOn: [...(DEFAULT_SEARCH_ROUTING.fallbackOn as readonly string[])],
      };
    }
  }

  await writeWebSearchConfigAtomic(agentDir, next);

  const configured: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (isApiKeyField(key) && typeof value === "string" && value.trim() !== "") {
      configured.push(key);
    }
  }
  return configured;
}
