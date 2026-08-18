import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WEB_SEARCH_CONFIG_NAME = "web-search.json";
export const FIRECRAWL_API_KEY_FIELD = "firecrawlApiKey";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

export function webSearchConfigPath(agentDir: string): string {
  return join(agentDir, WEB_SEARCH_CONFIG_NAME);
}

export function firecrawlApiKeyFromConfig(value: unknown): string | undefined {
  const object = asObject(value);
  const raw = object?.[FIRECRAWL_API_KEY_FIELD];
  if (typeof raw !== "string") return undefined;
  const key = raw.trim();
  return key || undefined;
}

export async function readWebSearchConfig(agentDir: string): Promise<JsonObject> {
  try {
    const parsed = JSON.parse(await readFile(webSearchConfigPath(agentDir), "utf8"));
    return asObject(parsed) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function readFirecrawlApiKey(agentDir: string): Promise<string | undefined> {
  return firecrawlApiKeyFromConfig(await readWebSearchConfig(agentDir));
}

export async function firecrawlPdfHasKey(agentDir: string): Promise<boolean> {
  return Boolean(await readFirecrawlApiKey(agentDir));
}

async function writeWebSearchConfigAtomic(agentDir: string, next: JsonObject): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const path = webSearchConfigPath(agentDir);
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Persist or clear `firecrawlApiKey` without touching other web-search fields. */
export async function writeFirecrawlApiKey(agentDir: string, key: string | null): Promise<boolean> {
  const current = await readWebSearchConfig(agentDir);
  const next = { ...current };
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (trimmed) next[FIRECRAWL_API_KEY_FIELD] = trimmed;
  else delete next[FIRECRAWL_API_KEY_FIELD];
  await writeWebSearchConfigAtomic(agentDir, next);
  return Boolean(trimmed);
}
