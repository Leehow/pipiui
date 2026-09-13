/**
 * Catalog policy: what is effective right now, and when to go get a new one.
 *
 * Split from `catalog.ts` (pure fetch + merge) and `catalog-cache.ts` (disk) so
 * that the parts needing neither network nor filesystem stay testable on their
 * own. This module is the only place that reads credentials.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBaseUrl, resolveSettingsApiKey } from "./config.js";
import { apiKeyFromCredentials } from "./conversation.js";
import { floorCatalog, refreshCatalog, type FetchLike } from "./catalog.js";
import {
  CATALOG_MAX_AGE_MS,
  defaultCatalogCachePath,
  isCatalogFresh,
  readCatalogCache,
  writeCatalogCache,
} from "./catalog-cache.js";
import { DEEPSEEK_PROVIDER_ID, type DeepSeekConversationModel } from "./models.js";

/** Set by the host on every spawned pi process (`assemblePiSpawn`). */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/**
 * The extension authenticates as `deepseek-extended`, but a user who logged in
 * before the split — or through the official provider — has the same key filed
 * under `deepseek`. Both are the same secret for the same endpoint.
 */
const CREDENTIAL_IDS = [DEEPSEEK_PROVIDER_ID, "deepseek"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the Pi credential store directly. The refresh runs outside a provider
 * request, so no credential is handed to us. The key is used only to call
 * DeepSeek's own `/models` — the same secret going to the same host — and is
 * never logged, cached or returned to callers.
 */
function apiKeyFromStore(agentDir: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  for (const id of CREDENTIAL_IDS) {
    const entry = parsed[id];
    if (entry === undefined) continue;
    try {
      return apiKeyFromCredentials(entry);
    } catch {
      /* try the next id */
    }
  }
  return undefined;
}

export function resolveRefreshApiKey(input: { agentDir?: string } = {}): string | undefined {
  const fromSettings = resolveSettingsApiKey();
  if (fromSettings) return fromSettings;
  const agentDir = input.agentDir ?? process.env[AGENT_DIR_ENV];
  return agentDir ? apiKeyFromStore(agentDir) : undefined;
}

/**
 * The catalog to register right now, synchronously.
 *
 * A stale cache still beats the floor: it describes the account, the floor only
 * describes what shipped in this build. Age decides whether to refresh, never
 * whether to use.
 */
export function effectiveCatalog(input: { baseUrl?: string; cachePath?: string } = {}): DeepSeekConversationModel[] {
  const baseUrl = input.baseUrl ?? resolveBaseUrl();
  const cache = readCatalogCache(input.cachePath);
  if (cache && (!cache.baseUrl || cache.baseUrl === baseUrl)) return cache.models;
  return floorCatalog();
}

export type RefreshOutcome =
  | { status: "written"; models: DeepSeekConversationModel[] }
  | { status: "skipped"; reason: "fresh" | "no-key" }
  | { status: "failed"; reason: string };

/**
 * One refresh attempt. Never throws: a failure leaves whatever cache exists in
 * place, so the worst case is that the catalog stays as stale as it already was.
 */
export async function refreshDeepSeekCatalog(input: {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  cachePath?: string;
  agentDir?: string;
  maxAgeMs?: number;
  force?: boolean;
  now?: number;
  onWarn?: (message: string) => void;
} = {}): Promise<RefreshOutcome> {
  const baseUrl = input.baseUrl ?? resolveBaseUrl();
  const cachePath = input.cachePath ?? defaultCatalogCachePath();
  const maxAgeMs = input.maxAgeMs ?? CATALOG_MAX_AGE_MS;
  const now = input.now ?? Date.now();

  if (!input.force) {
    const cached = readCatalogCache(cachePath);
    if (isCatalogFresh(cached, { baseUrl, now, maxAgeMs })) return { status: "skipped", reason: "fresh" };
  }

  const apiKey = resolveRefreshApiKey(input.agentDir ? { agentDir: input.agentDir } : {});
  if (!apiKey) return { status: "skipped", reason: "no-key" };

  const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return { status: "failed", reason: "no fetch implementation available" };

  try {
    const { models } = await refreshCatalog({
      baseUrl,
      apiKey,
      fetchImpl,
      ...(input.onWarn ? { onWarn: input.onWarn } : {}),
    });
    writeCatalogCache({ fetchedAt: now, baseUrl, models }, cachePath);
    return { status: "written", models };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fire-and-forget refresh for extension start-up. Deliberately not awaited by
 * the caller: provider registration is synchronous and must not block on a
 * network call.
 */
export function scheduleCatalogRefresh(
  input: Parameters<typeof refreshDeepSeekCatalog>[0] = {},
): void {
  void refreshDeepSeekCatalog(input).then((outcome) => {
    if (outcome.status === "failed") {
      input.onWarn?.(`DeepSeek 模型目录刷新失败：${outcome.reason}`);
    }
  });
}
