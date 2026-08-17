import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  ACCOUNT_USAGE_STALE_AFTER_MS,
  AccountUsageMonitor,
  AccountUsageRegistry,
  builtinAccountUsageAdapters,
  codexWindowLabel,
  parseCodexWindows,
  parseDeepSeekBalance,
  type AccountUsageCapabilities,
  type AccountUsageSnapshot,
} from "@pipi/account-usage-core";
import type { AccountBalance, QuotaSnapshot, QuotaWindow } from "@pipi/host-api";

export type QuotaProviderKind = "grok" | "glm" | "claude" | "codex" | "cursor" | "kimi" | "qoder" | "qwenTokenPlan" | "opencodeGo";
export type BalanceProviderKind = "deepseek" | "moonshot" | "siliconflow" | "openrouter";

export const QUOTA_ACCOUNT_LABELS: Record<QuotaProviderKind, string> = {
  grok: "Grok 账号额度", glm: "GLM 账号额度", claude: "Claude 账号额度", codex: "Codex 账号额度",
  cursor: "Cursor 账号额度", kimi: "Kimi 账号额度", qoder: "Qoder 账号额度", qwenTokenPlan: "Qwen Token Plan 额度", opencodeGo: "OpenCode Go 本机用量",
};
export const BALANCE_ACCOUNT_LABEL = "账户余额";
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
export const QUOTA_STALE_AFTER_MS = ACCOUNT_USAGE_STALE_AFTER_MS;
export { codexWindowLabel, parseDeepSeekBalance };

export function quotaProviderFor(provider: string): QuotaProviderKind | undefined {
  const normalized = provider.toLowerCase();
  if (!normalized.includes("relay") && (normalized === "xai" || normalized.includes("grok"))) return "grok";
  const id = new AccountUsageRegistry(builtinAccountUsageAdapters.filter(adapter => adapter.kind === "subscription")).resolve(provider)?.id;
  return id as QuotaProviderKind | undefined;
}
export function balanceProviderFor(provider: string): BalanceProviderKind | undefined {
  const id = new AccountUsageRegistry(builtinAccountUsageAdapters.filter(adapter => adapter.kind === "prepaid")).resolve(provider)?.id;
  return id as BalanceProviderKind | undefined;
}

export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim(); if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = rawLine.indexOf("="); if (eq < 0) continue;
    const key = rawLine.slice(0, eq).trim(); if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = rawLine.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

const clean = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  let result = value.trim();
  if ((result.startsWith("\"") && result.endsWith("\"")) || (result.startsWith("'") && result.endsWith("'"))) result = result.slice(1, -1).trim();
  return result || undefined;
};
const object = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const parsed = (raw: string | undefined): unknown => { if (!raw) return undefined; try { return JSON.parse(raw); } catch { return undefined; } };

export type CodexCredentials = { accessToken: string; accountId?: string };
export function parseCodexAuth(raw: string): CodexCredentials | undefined {
  const root = object(parsed(raw)); const tokens = object(root?.tokens);
  const accessToken = clean(tokens?.access_token) ?? clean(tokens?.accessToken) ?? clean(root?.OPENAI_API_KEY);
  if (!accessToken) return;
  const accountId = clean(tokens?.account_id) ?? clean(tokens?.accountId);
  return accountId ? { accessToken, accountId } : { accessToken };
}
export function parseCodexUsageWindows(body: unknown): QuotaWindow[] { return parseCodexWindows(body); }

export type QuotaFetchDeps = {
  fetch?: typeof fetch;
  agentDir?: string;
  readCodexAuth?: () => Promise<string | undefined>;
  readDeepSeekEnvFile?: () => Promise<string | undefined>;
  readDeepSeekAuth?: () => Promise<string | undefined>;
  readPiAuth?: () => Promise<string | undefined>;
  readGrokAuth?: () => Promise<string | undefined>;
  readOpenCodeAuth?: () => Promise<string | undefined>;
  openCodeDatabasePath?: string;
  readGrokRateLimits?: () => Promise<string | undefined>;
  readCookie?: AccountUsageCapabilities["readCookie"];
  readCursorAuth?: AccountUsageCapabilities["readCursorAuth"];
  persistCookie?: AccountUsageCapabilities["persistCookie"];
  readKeyFile?: AccountUsageCapabilities["readKeyFile"];
  readLocalUsage?: AccountUsageCapabilities["readLocalUsage"];
  now?: () => number;
  timeoutMs?: number;
};

async function optionalFile(path: string): Promise<string | undefined> {
  try { return await fs.readFile(path, "utf8"); } catch { return undefined; }
}

const OPEN_CODE_MESSAGE_USAGE_SQL = `
  SELECT
    CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
    CAST(json_extract(data, '$.cost') AS REAL) AS cost
  FROM message
  WHERE json_valid(data)
    AND json_extract(data, '$.providerID') = 'opencode-go'
    AND json_extract(data, '$.role') = 'assistant'
    AND json_type(data, '$.cost') IN ('integer', 'real')
`;
const OPEN_CODE_MESSAGE_AND_PART_USAGE_SQL = `
  WITH provider_messages AS (
    SELECT
      id AS messageID,
      CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
      CAST(json_extract(data, '$.cost') AS REAL) AS cost,
      json_type(data, '$.cost') IN ('integer', 'real') AS hasCost
    FROM message
    WHERE json_valid(data)
      AND json_extract(data, '$.providerID') = 'opencode-go'
      AND json_extract(data, '$.role') = 'assistant'
  )
  SELECT
    CAST(COALESCE(json_extract(p.data, '$.time.created'), p.time_created, m.createdMs) AS INTEGER) AS createdMs,
    CAST(json_extract(p.data, '$.cost') AS REAL) AS cost
  FROM part p
  JOIN provider_messages m ON m.messageID = p.message_id
  WHERE json_valid(p.data)
    AND json_extract(p.data, '$.type') = 'step-finish'
    AND json_type(p.data, '$.cost') IN ('integer', 'real')
  UNION ALL
  SELECT createdMs, cost
  FROM provider_messages m
  WHERE hasCost
    AND NOT EXISTS (
      SELECT 1
      FROM part p
      WHERE p.message_id = m.messageID
        AND json_valid(p.data)
        AND json_extract(p.data, '$.type') = 'step-finish'
        AND json_type(p.data, '$.cost') IN ('integer', 'real')
    )
`;

async function readOpenCodeGoUsageRows(databasePath: string): Promise<Array<{ createdMs: number; cost: number }> | undefined> {
  try { await fs.access(databasePath); } catch { return undefined; }
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 250 });
  try {
    const hasPart = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get("part") !== undefined;
    const rows = database.prepare(hasPart ? OPEN_CODE_MESSAGE_AND_PART_USAGE_SQL : OPEN_CODE_MESSAGE_USAGE_SQL).all() as Array<Record<string, unknown>>;
    return rows.flatMap(row => {
      const createdMs = Number(row.createdMs), cost = Number(row.cost);
      return createdMs > 0 && Number.isFinite(createdMs) && cost >= 0 && Number.isFinite(cost) ? [{ createdMs, cost }] : [];
    });
  } finally {
    database.close();
  }
}
function codexHome(env: NodeJS.ProcessEnv): string {
  const custom = env.CODEX_HOME?.trim(); return custom ? custom.replace(/^~(?=\/|$)/, homedir()) : join(homedir(), ".codex");
}

async function mergedEnvironment(env: NodeJS.ProcessEnv, agentDir: string, deps: QuotaFetchDeps): Promise<Record<string, string | undefined>> {
  const file = await (deps.readDeepSeekEnvFile ?? (() => optionalFile(join(agentDir, ".env"))))();
  return { ...(file ? parseDotEnv(file) : {}), ...env };
}

function hostSnapshot(snapshot: AccountUsageSnapshot): QuotaSnapshot {
  return { provider: snapshot.provider, accountLabel: snapshot.accountLabel, windows: snapshot.windows, ...(snapshot.balance ? { balance: snapshot.balance } : {}) };
}

async function capabilities(env: NodeJS.ProcessEnv, deps: QuotaFetchDeps): Promise<AccountUsageCapabilities> {
  const agentDir = deps.agentDir ?? join(homedir(), ".pi", "agent");
  const readPi = deps.readPiAuth ?? deps.readDeepSeekAuth ?? (() => optionalFile(join(agentDir, "auth.json")));
  const readOpenCode = deps.readOpenCodeAuth ?? (() => optionalFile(join(homedir(), ".local", "share", "opencode", "auth.json")));
  return {
    fetch: deps.fetch,
    env: await mergedEnvironment(env, agentDir, deps),
    now: deps.now,
    timeoutMs: deps.timeoutMs,
    readCookie: deps.readCookie,
    readCursorAuth: deps.readCursorAuth,
    persistCookie: deps.persistCookie,
    readKeyFile: deps.readKeyFile ?? (async paths => {
      for (const relative of paths) {
        const resolved = relative.startsWith("~/") ? join(homedir(), relative.slice(2)) : join(homedir(), relative);
        const firstLine = clean((await optionalFile(resolved))?.split(/\r?\n/)[0]);
        if (firstLine) return firstLine;
      }
    }),
    // The credential gate lives in the adapter (env OPENCODE_API_KEY or opencode-go
    // auth entry); the host default only owns SQLite access.
    readLocalUsage: deps.readLocalUsage ?? (async provider => {
      if (provider !== "opencode-go") return;
      return readOpenCodeGoUsageRows(deps.openCodeDatabasePath ?? join(homedir(), ".local", "share", "opencode", "opencode.db"));
    }),
    readAuth: async store => {
      const raw = store === "pi" ? await readPi()
        : store === "codex" ? await (deps.readCodexAuth ?? (() => optionalFile(join(codexHome(env), "auth.json"))))()
        : store === "grok" ? await (deps.readGrokAuth ?? (() => optionalFile(join(homedir(), ".grok", "auth.json"))) )()
        : await readOpenCode();
      return parsed(raw);
    },
    // Written by the pipiui-xai-server-tools extension from live api.x.ai response headers.
    readGrokRateLimits: () => (deps.readGrokRateLimits ?? (() => optionalFile(join(agentDir, "grok-rate-limits.json"))))(),
  };
}

export async function deepSeekApiKey(env: NodeJS.ProcessEnv, deps: QuotaFetchDeps = {}): Promise<string | undefined> {
  const caps = await capabilities(env, deps); const fromEnv = clean(caps.env?.DEEPSEEK_API_KEY); if (fromEnv) return fromEnv;
  const auth = object(await caps.readAuth?.("pi")); const entry = object(auth?.deepseek);
  return clean(entry?.key) ?? clean(entry?.access) ?? clean(entry?.access_token);
}

export async function fetchCodexQuota(env: NodeJS.ProcessEnv = process.env, deps: QuotaFetchDeps = {}): Promise<QuotaWindow[] | undefined> {
  const caps = await capabilities(env, deps);
  if (deps.readCodexAuth) {
    const original = caps.readAuth;
    caps.readAuth = store => store === "pi" ? Promise.resolve({}) : original?.(store) ?? Promise.resolve(undefined);
  }
  const result = await new AccountUsageMonitor(caps).snapshot("openai-codex", true);
  if (result.status === "error") throw new Error(result.detail ?? result.code);
  return result.status === "ready" ? result.snapshot.windows : undefined;
}
export async function fetchDeepSeekBalance(env: NodeJS.ProcessEnv = process.env, deps: QuotaFetchDeps = {}): Promise<AccountBalance | undefined> {
  const result = await new AccountUsageMonitor(await capabilities(env, deps)).snapshot("deepseek", true);
  if (result.status === "error") throw new Error(result.detail ?? result.code);
  return result.status === "ready" ? result.snapshot.balance : undefined;
}

/** Thin Node host facade over the UI-independent account-usage monitor. */
export class QuotaStore {
  private monitor?: Promise<AccountUsageMonitor>;
  private readonly hostSnapshots = new WeakMap<AccountUsageSnapshot, QuotaSnapshot>();
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly deps: QuotaFetchDeps = {}) {}
  private core(): Promise<AccountUsageMonitor> {
    return this.monitor ??= capabilities(this.env, this.deps).then(value => new AccountUsageMonitor(value));
  }
  async snapshot(modelProvider: string, force = false): Promise<QuotaSnapshot | null> {
    const result = await (await this.core()).snapshot(modelProvider, force);
    const mapped = (value: AccountUsageSnapshot) => {
      const existing = this.hostSnapshots.get(value); if (existing) return existing;
      const created = hostSnapshot(value); this.hostSnapshots.set(value, created); return created;
    };
    if (result.status === "ready") return mapped(result.snapshot);
    if (result.status === "error" && result.staleSnapshot) return mapped(result.staleSnapshot);
    return null;
  }
}
