/** Official Grok Build catalog, shared by the host and session provider factories. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBroker } from "./oauth/broker.js";
import { tryResolveAgentHome } from "./oauth/home.js";
import { GROK_BUILD_CAPABILITIES, GROK_BUILD_CHAT_API, GROK_BUILD_CONVERSATION_MODELS, type GrokBuildConversationModel } from "./models.js";

export const GROK_BUILD_CATALOG_URL = "https://cli-chat-proxy.grok.com/v1/models";
export const CATALOG_MAX_AGE_MS = 15 * 60 * 1000;
export const CATALOG_TIMEOUT_MS = 3_000;
type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Only model metadata is accepted remotely. Transport and tool capabilities stay local. */
export function parseGrokBuildCatalog(value: unknown): GrokBuildConversationModel[] {
  if (!record(value) || !Array.isArray(value.data)) throw new Error("Invalid Grok Build catalog");
  const models = new Map<string, GrokBuildConversationModel>();
  for (const row of value.data) {
    if (!record(row) || row.hidden === true) continue;
    const id = row.model ?? row.id;
    if (typeof id !== "string" || !/^grok-[a-zA-Z0-9._-]+$/.test(id)
      || row.api_backend !== "responses" || !positive(row.context_window)) continue;
    const reasoning = row.supports_reasoning_effort === true;
    const thinkingLevelMap: GrokBuildConversationModel["thinkingLevelMap"] = {};
    if (reasoning) {
      for (const level of levels) thinkingLevelMap[level] = null;
      for (const effort of Array.isArray(row.reasoning_efforts) ? row.reasoning_efforts : []) {
        if (record(effort) && levels.includes(effort.id as typeof levels[number]) && typeof effort.value === "string") {
          thinkingLevelMap[effort.id as typeof levels[number]] = effort.value;
        }
      }
      if (!Object.values(thinkingLevelMap).some((v) => typeof v === "string")) continue;
    }
    models.set(id, {
      id, name: typeof row.name === "string" && row.name.trim() ? row.name : id,
      api: GROK_BUILD_CHAT_API, reasoning, input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: row.context_window,
      maxTokens: positive(row.max_completion_tokens) ? row.max_completion_tokens : 16384,
      ...(reasoning ? { thinkingLevelMap, compat: { supportsReasoningEffort: true } } : {}),
      capabilities: {
        ...GROK_BUILD_CAPABILITIES,
        hostedTools: { tools: row.supports_backend_search === true ? ["web_search", "x_search", "code_interpreter"] : ["code_interpreter"] },
        nativeSearch: { tools: row.supports_backend_search === true ? ["web_search", "x_search"] : [] },
      },
    });
  }
  if (!models.size) throw new Error("Empty or unsupported Grok Build catalog");
  return [...models.values()];
}

type Cache = { scope: string; fetchedAt: number; data: unknown };
const memory = new Map<string, Cache>();
const pending = new Map<string, Promise<GrokBuildConversationModel[]>>();
export type CatalogOptions = {
  authPath?: string;
  /** Session caches stay in the project home. Host auth helpers use memory only. */
  cacheDir?: string | null;
  fetchImpl?: typeof fetch;
  force?: boolean;
};

function credentialScope(access: string): string {
  let identity = access;
  try {
    const claims = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString());
    // Only a cache namespace, never an authentication decision.
    if (typeof claims.sub === "string" && typeof claims.iss === "string") {
      identity = JSON.stringify([claims.iss, claims.sub, claims.client_id, claims.tier]);
    }
  } catch { /* Non-JWT credentials are isolated by token hash. */ }
  return createHash("sha256").update(identity).digest("hex");
}

const fallback = () => GROK_BUILD_CONVERSATION_MODELS.map((m) => structuredClone(m));

export async function loadGrokBuildCatalog(options: CatalogOptions = {}): Promise<GrokBuildConversationModel[]> {
  const home = tryResolveAgentHome();
  const authPath = options.authPath ?? (home ? join(home, "auth.json") : undefined);
  if (!authPath) return fallback();
  let scope: string;
  try {
    const credential = JSON.parse(await readFile(authPath, "utf8"))["grok-build"];
    if (credential?.type !== "oauth" || typeof credential.access !== "string" || !credential.access) return fallback();
    scope = credentialScope(credential.access);
  } catch { return fallback(); }
  const cacheDir = options.cacheDir === undefined ? home : options.cacheDir;
  const cachePath = cacheDir ? join(cacheDir, "grok-build-models.json") : undefined;
  const key = `${authPath}\0${cachePath ?? "memory"}\0${scope}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const job = (async () => {
    let cached = memory.get(key);
    let current = fallback();
    try {
      cached ??= cachePath ? JSON.parse(await readFile(cachePath, "utf8")) : undefined;
      if (cached?.scope !== scope || !Number.isFinite(cached.fetchedAt)) cached = undefined;
      if (cached) current = parseGrokBuildCatalog(cached.data);
    } catch { cached = undefined; }
    if (process.env.PI_OFFLINE !== undefined) return current;
    if (!options.force && cached && Date.now() - cached.fetchedAt >= 0 && Date.now() - cached.fetchedAt < CATALOG_MAX_AGE_MS) return current;
    const signal = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
    try {
      const broker = createBroker({ authPath, fetchImpl: options.fetchImpl, refreshTimeoutMs: CATALOG_TIMEOUT_MS });
      const data = await broker.with401Retry(async (token) => {
        const response = await (options.fetchImpl ?? fetch)(GROK_BUILD_CATALOG_URL, {
          headers: { authorization: `Bearer ${token}`, "X-XAI-Token-Auth": "xai-grok-cli", accept: "application/json" },
          signal, redirect: "error",
        });
        if (!response.ok) throw Object.assign(new Error(`Grok Build catalog HTTP ${response.status}`), { status: response.status });
        return response.json() as Promise<unknown>;
      }, signal);
      const models = parseGrokBuildCatalog(data);
      // Do not publish a catalog for credentials replaced while the request was running.
      const live = JSON.parse(await readFile(authPath, "utf8"))["grok-build"];
      if (typeof live?.access !== "string" || credentialScope(live.access) !== scope) return fallback();
      // Persist only parsed metadata, never unknown server fields or credentials.
      const safeData = { data: models.map((m) => ({
        model: m.id, name: m.name, api_backend: "responses", context_window: m.contextWindow,
        max_completion_tokens: m.maxTokens, supports_reasoning_effort: m.reasoning,
        reasoning_efforts: Object.entries(m.thinkingLevelMap ?? {}).filter(([, v]) => v !== null).map(([id, value]) => ({ id, value })),
        supports_backend_search: !!m.capabilities?.nativeSearch.tools.length,
      })) };
      const next = { scope, fetchedAt: Date.now(), data: safeData };
      memory.set(key, next);
      if (cachePath && cacheDir) {
        const tmp = `${cachePath}.${randomUUID()}.tmp`;
        try {
          await mkdir(cacheDir, { recursive: true });
          await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
          await rename(tmp, cachePath);
        } catch { /* A read-only cache must not hide a successful refresh. */ }
        finally { await rm(tmp, { force: true }).catch(() => {}); }
      }
      return models;
    } catch { return current; }
  })();
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}
