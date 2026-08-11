import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AccountBalance, QuotaSnapshot, QuotaWindow } from "@pipi/host-api";

/**
 * Account-quota + prepaid-balance sources for the Electron host (port of the
 * Swift app's per-provider QuotaMonitors and BalanceMonitors). The mapping and
 * Codex fetch mirror the existing model-to-provider mapping and Codex billing
 * behavior; the DeepSeek balance fetch mirrors Swift `BalanceBilling`.
 *
 * Codex plan windows and the DeepSeek prepaid balance are wired; other
 * providers resolve `null` until their fetcher lands — same "no pill"
 * semantics as a silent Swift monitor failure.
 */

export type QuotaProviderKind = "grok" | "glm" | "claude" | "codex" | "kimi" | "qoder" | "qwenTokenPlan" | "opencodeGo";

/** Mirrors Swift `QuotaProvider.accountLabel` for the popover title. */
export const QUOTA_ACCOUNT_LABELS: Record<QuotaProviderKind, string> = {
  grok: "Grok 账号额度",
  glm: "GLM 账号额度",
  claude: "Claude 账号额度",
  codex: "Codex 账号额度",
  kimi: "Kimi 账号额度",
  qoder: "Qoder 账号额度",
  qwenTokenPlan: "Qwen Token Plan 额度",
  opencodeGo: "OpenCode Go 本机用量"
};

/** Mirrors Swift `ModelInfo.quotaProvider`: relay providers and unknowns stay nil (no pill). */
export function quotaProviderFor(provider: string): QuotaProviderKind | undefined {
  if (provider.toLowerCase().includes("relay")) return undefined;
  const p = provider.toLowerCase();
  if (p === "xai" || p.includes("grok")) return "grok";
  if (p.includes("zai") || p.includes("zhipu") || p.includes("bigmodel")) return "glm";
  if (p === "anthropic" || p.includes("claude")) return "claude";
  if (p.includes("openai") || p.includes("codex")) return "codex";
  if (p.includes("kimi")) return "kimi";
  if (p.includes("qoder")) return "qoder";
  // Substring match is intentional — other qwen models must NOT map here.
  if (p.includes("qwen-token-plan")) return "qwenTokenPlan";
  // Only the Go plan has 5h/week/month caps; bare `opencode` stays unmapped.
  if (p.includes("opencode-go")) return "opencodeGo";
  return undefined;
}

// MARK: - Balance routing (mirrors Swift balanceProvider(for:))

/**
 * Pay-per-token providers that expose a prepaid-balance endpoint. Swift maps
 * moonshot/siliconflow/openrouter too, but only DeepSeek has an Electron
 * fetcher today — unknown kinds resolve `undefined` and stay pill-less.
 */
export type BalanceProviderKind = "deepseek";

/** Mirrors Swift `balanceProvider(for:)`: relay providers and unknowns stay undefined. */
export function balanceProviderFor(provider: string): BalanceProviderKind | undefined {
  if (provider.toLowerCase().includes("relay")) return undefined;
  if (provider.toLowerCase().includes("deepseek")) return "deepseek";
  return undefined;
}

/** Swift balance popover title (`账户余额`), reused as the snapshot account label. */
export const BALANCE_ACCOUNT_LABEL = "账户余额";

// MARK: - DeepSeek key resolution (mirrors Swift BalanceAuthStore)

/**
 * Parses the `~/.pi/agent/.env` subset EnvFileStore supports: `KEY=VALUE`
 * lines, `#` comments, blank lines, optional single/double quotes, later
 * duplicates win (shell behavior).
 */
export function parseDotEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = rawLine.indexOf("=");
    if (eq < 0) continue;
    const key = rawLine.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = rawLine.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function cleanedKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.length ? s : undefined;
}

function defaultReadDeepSeekEnvFile(agentDir: string): () => Promise<string | undefined> {
  return async () => {
    try { return await fs.readFile(join(agentDir, ".env"), "utf8"); } catch { return undefined; }
  };
}

function defaultReadDeepSeekAuth(agentDir: string): () => Promise<string | undefined> {
  return async () => {
    try { return await fs.readFile(join(agentDir, "auth.json"), "utf8"); } catch { return undefined; }
  };
}

/**
 * Resolves the DeepSeek API key using the same layers as Swift
 * `BalanceAuthStore`: process env + `~/.pi/agent/.env` (process wins), then
 * the `deepseek` entry of `~/.pi/agent/auth.json`. Reuses the same auth.json
 * file and reader pattern the Codex path already uses — no new credential
 * mechanism. Returns undefined when no key is present.
 */
export async function deepSeekApiKey(env: NodeJS.ProcessEnv, deps: QuotaFetchDeps = {}): Promise<string | undefined> {
  const agentDir = deps.agentDir ?? join(homedir(), ".pi", "agent");
  const readEnvFile = deps.readDeepSeekEnvFile ?? defaultReadDeepSeekEnvFile(agentDir);
  const rawEnvFile = await readEnvFile();
  const envFileValues = rawEnvFile === undefined ? {} : parseDotEnv(rawEnvFile);
  // Process env wins over .env, mirroring QuotaEnvFallback.merged.
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(envFileValues)) merged[key] = value;
  for (const [key, value] of Object.entries(env ?? {})) if (value !== undefined) merged[key] = value;
  const fromEnv = cleanedKey(merged["DEEPSEEK_API_KEY"]);
  if (fromEnv) return fromEnv;

  const readAuth = deps.readDeepSeekAuth ?? defaultReadDeepSeekAuth(agentDir);
  const rawAuth = await readAuth();
  if (rawAuth === undefined) return undefined;
  let root: unknown;
  try { root = JSON.parse(rawAuth); } catch { return undefined; }
  if (typeof root !== "object" || root === null) return undefined;
  const entry = (root as Record<string, unknown>)["deepseek"];
  if (typeof entry !== "object" || entry === null) return undefined;
  const e = entry as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : "";
  if (type === "api_key") return cleanedKey(e.key as string | undefined);
  // Unknown/oauth-ish shapes: try common key fields without logging values.
  return cleanedKey(e.key as string | undefined)
    ?? cleanedKey(e.access as string | undefined)
    ?? cleanedKey(e.access_token as string | undefined);
}

// MARK: - DeepSeek fetch + parse (mirrors BalanceBilling.parseDeepSeek)

export const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

/**
 * Parses `GET /user/balance`. `is_available == false` → undefined (treated as
 * no balance, not an error); `total_balance` accepts string or number;
 * `currency` defaults to `CNY` when absent, uppercased.
 */
export function parseDeepSeekBalance(body: unknown): AccountBalance | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const root = body as Record<string, unknown>;
  // Require is_available == true when present; missing key is tolerated.
  if (root.is_available === false) return undefined;
  const infos = root.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) return undefined;
  const first = infos[0];
  if (typeof first !== "object" || first === null) return undefined;
  const amount = asNumber((first as Record<string, unknown>).total_balance);
  if (amount === undefined) return undefined;
  const rawCurrency = (first as Record<string, unknown>).currency;
  const currency = typeof rawCurrency === "string" && rawCurrency.trim() ? rawCurrency.toUpperCase() : "CNY";
  return { amount, currency };
}

/**
 * Fetches the DeepSeek prepaid balance. Returns `undefined` (never throws)
 * when no key is configured or the body has no usable balance; HTTP/network
 * failures throw so the store can keep the last good cache.
 */
export async function fetchDeepSeekBalance(env: NodeJS.ProcessEnv = process.env, deps: QuotaFetchDeps = {}): Promise<AccountBalance | undefined> {
  const apiKey = await deepSeekApiKey(env, deps);
  if (!apiKey) return undefined;
  const doFetch = deps.fetch ?? fetch;
  const response = await doFetch(DEEPSEEK_BALANCE_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseDeepSeekBalance(await response.json());
}

// MARK: - Codex credentials (mirrors CodexAuthStore)

export type CodexCredentials = { accessToken: string; accountId?: string };

/** Parses `~/.codex/auth.json` in both token and API-key shapes. */
export function parseCodexAuth(raw: string): CodexCredentials | undefined {
  let root: unknown;
  try { root = JSON.parse(raw); } catch { return undefined; }
  if (typeof root !== "object" || root === null) return undefined;
  const record = root as Record<string, unknown>;
  const tokens = record.tokens;
  if (typeof tokens === "object" && tokens !== null) {
    const t = tokens as Record<string, unknown>;
    const access = (typeof t.access_token === "string" ? t.access_token : undefined) ?? (typeof t.accessToken === "string" ? t.accessToken : undefined);
    if (!access) return undefined;
    const accountId = (typeof t.account_id === "string" ? t.account_id : undefined) ?? (typeof t.accountId === "string" ? t.accountId : undefined);
    return accountId ? { accessToken: access, accountId } : { accessToken: access };
  }
  if (typeof record.OPENAI_API_KEY === "string" && record.OPENAI_API_KEY) {
    return { accessToken: record.OPENAI_API_KEY };
  }
  return undefined;
}

// MARK: - Codex /wham/usage (mirrors CodexWebBilling)

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

/** Mirrors Swift `CodexRateWindow.label`: derive 5h / 周 / 月 / 额度 from the window length. */
export function codexWindowLabel(windowSeconds: number | undefined): string {
  if (!windowSeconds || windowSeconds <= 0) return "额度";
  const hours = windowSeconds / 3600;
  if (hours >= 4.5 && hours <= 5.5) return "5h";
  const days = Math.round(windowSeconds / 86400);
  if (days >= 4 && days <= 12) return "周";
  if (days >= 20 && days <= 45) return "月";
  return "额度";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}

/** Parses every rate-limit window present (primary + secondary) — mirrors `parseWindows`. */
export function parseCodexUsageWindows(body: unknown): QuotaWindow[] {
  if (typeof body !== "object" || body === null) return [];
  const rateLimit = (body as Record<string, unknown>).rate_limit;
  if (typeof rateLimit !== "object" || rateLimit === null) return [];
  const windows: QuotaWindow[] = [];
  for (const key of ["primary_window", "secondary_window"] as const) {
    const dict = (rateLimit as Record<string, unknown>)[key];
    if (typeof dict !== "object" || dict === null) continue;
    const d = dict as Record<string, unknown>;
    const used = asNumber(d.used_percent);
    if (used === undefined) continue;
    // reset_at is either epoch seconds or an ISO-8601 string.
    let resetsAt: number | undefined;
    const reset = d.reset_at;
    if (typeof reset === "number" && Number.isFinite(reset)) resetsAt = reset * 1000;
    else if (typeof reset === "string") { const parsed = Date.parse(reset); if (Number.isFinite(parsed)) resetsAt = parsed; }
    const label = codexWindowLabel(asNumber(d.limit_window_seconds));
    windows.push({ id: key, usedPercent: Math.min(100, Math.max(0, used)), resetsAt, label, title: label === "额度" ? "额度" : `${label}额度` });
  }
  // ids distinguish primary/secondary even when labels coincide.
  return windows.map((w, index) => windows.length > 1 ? { ...w, id: `window${index}` } : w);
}

export type QuotaFetchDeps = {
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to reading `$CODEX_HOME || ~/.codex`/auth.json. */
  readCodexAuth?: () => Promise<string | undefined>;
  /** DeepSeek balance: `~/.pi/agent` dir holding `.env` + `auth.json` (default `~/.pi/agent`). */
  agentDir?: string;
  /** DeepSeek balance: injectable `~/.pi/agent/.env` reader; tests never touch the real file. */
  readDeepSeekEnvFile?: () => Promise<string | undefined>;
  /** DeepSeek balance: injectable `~/.pi/agent/auth.json` reader; tests never touch the real file. */
  readDeepSeekAuth?: () => Promise<string | undefined>;
  now?: () => number;
};

function defaultReadCodexAuth(env: NodeJS.ProcessEnv): () => Promise<string | undefined> {
  return async () => {
    const custom = env.CODEX_HOME?.trim();
    const codexHome = custom ? custom.replace(/^~(?=\/|$)/, homedir()) : join(homedir(), ".codex");
    try { return await fs.readFile(join(codexHome, "auth.json"), "utf8"); } catch { return undefined; }
  };
}

/**
 * Fetches the Codex plan windows. Returns `undefined` (never throws) when the
 * credential is missing — "no pill", exactly like the Swift monitor.
 */
export async function fetchCodexQuota(env: NodeJS.ProcessEnv = process.env, deps: QuotaFetchDeps = {}): Promise<QuotaWindow[] | undefined> {
  const readAuth = deps.readCodexAuth ?? defaultReadCodexAuth(env);
  const raw = await readAuth();
  if (raw === undefined) return undefined;
  const credentials = parseCodexAuth(raw);
  if (!credentials) return undefined;
  const doFetch = deps.fetch ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.accessToken}`,
    Accept: "application/json",
    "User-Agent": "CodexBar"
  };
  if (credentials.accountId) headers["ChatGPT-Account-Id"] = credentials.accountId;
  const response = await doFetch(CODEX_USAGE_URL, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseCodexUsageWindows(await response.json());
}

// MARK: - Throttled per-provider snapshot cache (mirrors QuotaMonitorCore cadence)

export const QUOTA_STALE_AFTER_MS = 3 * 60 * 1000;

export class QuotaStore {
  private cache = new Map<QuotaProviderKind, { snapshot: QuotaSnapshot; fetchedAt: number }>();
  private inFlight = new Map<QuotaProviderKind, Promise<QuotaSnapshot | null>>();
  private balanceCache = new Map<BalanceProviderKind, { snapshot: QuotaSnapshot; fetchedAt: number }>();
  private balanceInFlight = new Map<BalanceProviderKind, Promise<QuotaSnapshot | null>>();
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly deps: QuotaFetchDeps = {}) {}

  /**
   * Returns the snapshot for the provider backing `modelProvider`, refreshing
   * it when stale. `null` = no credential / fetch failed / not implemented →
   * the UI hides the capsule. Failures keep the last good cache when one
   * exists. Subscription quota wins over prepaid balance (Swift parity): when
   * the provider maps to a quota kind, only the quota path runs.
   */
  async snapshot(modelProvider: string, force = false): Promise<QuotaSnapshot | null> {
    const quotaKind = quotaProviderFor(modelProvider);
    if (quotaKind) return this.quotaSnapshot(quotaKind, force);
    const balanceKind = balanceProviderFor(modelProvider);
    if (balanceKind) return this.balanceSnapshot(balanceKind, force);
    return null;
  }

  private async quotaSnapshot(kind: QuotaProviderKind, force: boolean): Promise<QuotaSnapshot | null> {
    const now = (this.deps.now ?? Date.now)();
    const cached = this.cache.get(kind);
    if (cached && !force && now - cached.fetchedAt < QUOTA_STALE_AFTER_MS) return cached.snapshot;
    const pending = this.inFlight.get(kind);
    if (pending && !force) return pending;
    const task = (async (): Promise<QuotaSnapshot | null> => {
      try {
        // Only Codex has a fetcher today; others stay pill-less until ported.
        if (kind !== "codex") return cached?.snapshot ?? null;
        const windows = await fetchCodexQuota(this.env, this.deps);
        if (!windows || windows.length === 0) return cached?.snapshot ?? null;
        const snapshot: QuotaSnapshot = { provider: kind, accountLabel: QUOTA_ACCOUNT_LABELS[kind], windows };
        this.cache.set(kind, { snapshot, fetchedAt: (this.deps.now ?? Date.now)() });
        return snapshot;
      } catch {
        return cached?.snapshot ?? null;
      } finally {
        this.inFlight.delete(kind);
      }
    })();
    this.inFlight.set(kind, task);
    return task;
  }

  private async balanceSnapshot(kind: BalanceProviderKind, force: boolean): Promise<QuotaSnapshot | null> {
    const now = (this.deps.now ?? Date.now)();
    const cached = this.balanceCache.get(kind);
    if (cached && !force && now - cached.fetchedAt < QUOTA_STALE_AFTER_MS) return cached.snapshot;
    const pending = this.balanceInFlight.get(kind);
    if (pending && !force) return pending;
    const task = (async (): Promise<QuotaSnapshot | null> => {
      try {
        // Only DeepSeek has a balance fetcher today; others stay pill-less until ported.
        if (kind !== "deepseek") return cached?.snapshot ?? null;
        const balance = await fetchDeepSeekBalance(this.env, this.deps);
        if (!balance) return cached?.snapshot ?? null;
        const snapshot: QuotaSnapshot = { provider: kind, accountLabel: BALANCE_ACCOUNT_LABEL, balance, windows: [] };
        this.balanceCache.set(kind, { snapshot, fetchedAt: (this.deps.now ?? Date.now)() });
        return snapshot;
      } catch {
        return cached?.snapshot ?? null;
      } finally {
        this.balanceInFlight.delete(kind);
      }
    })();
    this.balanceInFlight.set(kind, task);
    return task;
  }
}
