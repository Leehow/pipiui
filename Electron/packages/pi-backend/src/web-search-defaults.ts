import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Host-owned pi-web-access defaults for the isolated Electron profile.
 *
 * Exa MCP keyless first (`https://mcp.exa.ai/mcp`, no key). A 429 is a `quota`
 * error, so `searchRouting` falls through to SearXNG → OpenAI → Firecrawl →
 * the rest of the auto chain. `workflow: "none"` returns results immediately —
 * no curator page.
 *
 * Clash / Surge TUN + fake-IP resolves public hosts into `198.18.0.0/15`.
 * pi-web-access blocks that range unless `ssrf.allowRanges` opts in.
 *
 * User-set `provider` / `searchProvider` / `workflow` / `firecrawlBaseUrl` / `ssrf` win.
 * The managed snapshot only refreshes fields that are missing or still equal
 * to the last value this host wrote.
 */
export const DEFAULT_WEB_SEARCH_WORKFLOW = "none";
export const WEB_SEARCH_DEFAULTS_MARKER = ".pipiui-web-search-defaults-v1.json";
export const DEFAULT_SSRF = Object.freeze({
  allowRanges: Object.freeze(["198.18.0.0/15"]),
});

export const DEFAULT_SEARCH_ROUTING = Object.freeze({
  providers: Object.freeze([
    "exa",
    "searxng",
    "openai",
    "firecrawl",
    "brave",
    "parallel",
    "tinyfish",
    "search1api",
    "searchinfinity",
    "querit",
    "tavily",
    "jina",
    "serpdive",
    "kagi",
    "bocha",
    "ollama",
    "perplexity",
    "gemini",
  ]),
  fallbackOn: Object.freeze(["quota", "transient", "network", "invalid-response"]),
});

type JsonObject = Record<string, unknown>;

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value as JsonObject;
}

function hasPinnedProvider(config: JsonObject): boolean {
  return Object.hasOwn(config, "provider") || Object.hasOwn(config, "searchProvider");
}

function cloneRouting(): JsonObject {
  return {
    providers: [...DEFAULT_SEARCH_ROUTING.providers],
    fallbackOn: [...DEFAULT_SEARCH_ROUTING.fallbackOn],
  };
}

function cloneSsrf(): JsonObject {
  return { allowRanges: [...DEFAULT_SSRF.allowRanges] };
}

export function applyWebSearchDefaults(
  current: JsonObject | undefined,
  previousManaged: JsonObject | undefined,
): { next: JsonObject; managed: JsonObject } {
  const next: JsonObject = { ...(current ?? {}) };
  const managed: JsonObject = {};
  const previous = previousManaged ?? {};

  const take = (key: string, value: unknown) => {
    if (next[key] === undefined || equalJson(next[key], previous[key])) next[key] = value;
    if (equalJson(next[key], value)) managed[key] = value;
  };

  take("workflow", DEFAULT_WEB_SEARCH_WORKFLOW);
  take("ssrf", cloneSsrf());
  if (equalJson(next.firecrawlBaseUrl, previous.firecrawlBaseUrl)) delete next.firecrawlBaseUrl;

  if (hasPinnedProvider(next)) {
    if (equalJson(next.searchRouting, previous.searchRouting)) delete next.searchRouting;
  } else {
    take("searchRouting", cloneRouting());
  }

  return { next, managed };
}

async function readJsonObject(path: string, label: string): Promise<JsonObject | undefined> {
  try {
    return objectValue(JSON.parse(await readFile(path, "utf8")), label);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function ensureWebSearchDefaults(
  agentDir: string,
): Promise<"created" | "updated" | "unchanged"> {
  await mkdir(agentDir, { recursive: true });
  const configPath = join(agentDir, "web-search.json");
  const markerPath = join(agentDir, WEB_SEARCH_DEFAULTS_MARKER);
  const current = await readJsonObject(configPath, "web-search.json");
  const marker = await readJsonObject(markerPath, WEB_SEARCH_DEFAULTS_MARKER);
  const previousManaged = marker && marker.version === 1 && marker.managed && typeof marker.managed === "object" && !Array.isArray(marker.managed)
    ? marker.managed as JsonObject
    : undefined;
  const { next, managed } = applyWebSearchDefaults(current, previousManaged);
  const nextMarker = { version: 1 as const, managed };
  if (current !== undefined && equalJson(current, next) && equalJson(marker, nextMarker)) return "unchanged";
  await writeJsonAtomic(configPath, next);
  await writeJsonAtomic(markerPath, nextMarker);
  return current === undefined ? "created" : "updated";
}
