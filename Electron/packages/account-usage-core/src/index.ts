export type UsageWindow = {
  id: string;
  usedPercent: number;
  resetsAt?: number;
  label: string;
  title: string;
};

export type AccountBalance = { amount: number; currency: string };

export type AccountUsageSnapshot = {
  provider: string;
  accountLabel: string;
  windows: UsageWindow[];
  balance?: AccountBalance;
  source: "subscription" | "prepaid" | "local";
};

export type LocalUsageRow = { createdMs: number; cost: number };

/** Host-owned I/O. The core never imports Electron, Pi, React, SwiftUI, SQLite, or filesystem APIs. */
export type AccountUsageCapabilities = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** Parsed JSON or raw JSON from the host's credential stores. */
  readAuth?: (store: "pi" | "codex" | "grok" | "opencode") => Promise<unknown>;
  /** Optional browser-cookie capability. Values are never returned in snapshots/errors. */
  readCookie?: (provider: "kimi" | "qwen-token-plan") => Promise<string | undefined>;
  /** Persists a cookie that just produced a successful fetch. Browser session
   *  cookies (e.g. the aliyun login ticket) do not survive an app restart, so
   *  the host caches the last-known-good value (Swift persistCookie parity). */
  persistCookie?: (provider: "qwen-token-plan", cookie: string) => Promise<void> | void;
  /** Optional key-file reader (CodexBar-style files such as `~/.coding-relay/glm-api-key`).
   *  Paths are home-relative; the host resolves them and returns the first usable line. */
  readKeyFile?: (paths: string[]) => Promise<string | undefined>;
  /** Optional local-database capability; the host owns SQLite access. */
  readLocalUsage?: (provider: "opencode-go") => Promise<LocalUsageRow[] | undefined>;
  now?: () => number;
  timeoutMs?: number;
};

export type AccountUsageContext = Required<Pick<AccountUsageCapabilities, "fetch" | "now" | "timeoutMs">> & AccountUsageCapabilities;

export type AccountUsageAdapter = {
  id: string;
  kind: "subscription" | "prepaid";
  priority?: number;
  matches(provider: string): boolean;
  load(ctx: AccountUsageContext): Promise<AccountUsageSnapshot | undefined>;
};

export type AccountUsageResult =
  | { status: "ready"; snapshot: AccountUsageSnapshot; stale: boolean }
  | { status: "no-data"; reason: "unsupported" | "missing-capability" | "missing-credential" | "empty-response" }
  | { status: "error"; code: "timeout" | "http" | "malformed" | "network"; detail?: string; staleSnapshot?: AccountUsageSnapshot };

export const ACCOUNT_USAGE_STALE_AFTER_MS = 3 * 60 * 1000;

const clean = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  let result = value.trim();
  if ((result.startsWith("\"") && result.endsWith("\"")) || (result.startsWith("'") && result.endsWith("'"))) result = result.slice(1, -1).trim();
  return result || undefined;
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const number = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clamp = (value: number) => Math.min(100, Math.max(0, value));
const json = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
};
const authEntry = (root: unknown, ...ids: string[]) => {
  const r = record(json(root));
  for (const id of ids) {
    const entry = record(r?.[id]);
    if (entry) return entry;
  }
};
const token = (entry: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) { const value = clean(entry?.[key]); if (value) return value; }
};
const resetMs = (value: unknown): number | undefined => {
  const n = number(value);
  if (n !== undefined) return n > 10_000_000_000 ? n : n * 1000;
  if (typeof value === "string") { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined; }
};
const envToken = (ctx: AccountUsageContext, ...names: string[]) => {
  for (const name of names) { const value = clean(ctx.env?.[name]); if (value) return value; }
};

export class UsageError extends Error {
  constructor(readonly code: "timeout" | "http" | "malformed" | "network", message: string) { super(message); }
}
class NoDataError extends Error {
  constructor(readonly reason: "missing-capability" | "missing-credential" | "empty-response") { super(reason); }
}

async function fetchResponse(ctx: AccountUsageContext, url: string, init: RequestInit): Promise<Response> {
  try {
    return await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(ctx.timeoutMs) });
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") throw new UsageError("timeout", "request timed out");
    throw new UsageError("network", "request failed");
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new UsageError("malformed", "invalid JSON response"); }
}

async function fetchJson(ctx: AccountUsageContext, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchResponse(ctx, url, init);
  if (!response.ok) throw new UsageError("http", `HTTP ${response.status}`);
  return responseJson(response);
}

async function fetchBytes(ctx: AccountUsageContext, url: string, init: RequestInit): Promise<Uint8Array> {
  const response = await fetchResponse(ctx, url, init);
  if (!response.ok) throw new UsageError("http", `HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function bearer(value: string): Record<string, string> { return { Authorization: `Bearer ${value}`, Accept: "application/json" }; }
function window(id: string, usedPercent: number, label: string, title: string, resetsAt?: number): UsageWindow {
  return { id, usedPercent: clamp(usedPercent), resetsAt, label, title };
}

export function codexWindowLabel(seconds?: number): string {
  if (!seconds || seconds <= 0) return "额度";
  const hours = seconds / 3600;
  if (hours >= 4.5 && hours <= 5.5) return "5h";
  const days = Math.round(seconds / 86400);
  if (days >= 4 && days <= 12) return "周";
  if (days >= 20 && days <= 45) return "月";
  return "额度";
}

export function parseCodexWindows(body: unknown): UsageWindow[] {
  const rate = record(record(body)?.rate_limit);
  if (!rate) return [];
  const out: UsageWindow[] = [];
  for (const [id, raw] of [["primary_window", rate.primary_window], ["secondary_window", rate.secondary_window]] as const) {
    const value = record(raw); const used = number(value?.used_percent); if (used === undefined) continue;
    const label = codexWindowLabel(number(value?.limit_window_seconds));
    out.push(window(id, used, label, label === "额度" ? "额度" : `${label}额度`, resetMs(value?.reset_at)));
  }
  return out.map((item, index) => out.length > 1 ? { ...item, id: `window${index}` } : item);
}

export function parseDeepSeekBalance(body: unknown): AccountBalance | undefined {
  const root = record(body); if (!root || root.is_available === false || !Array.isArray(root.balance_infos)) return;
  const first = record(root.balance_infos[0]); const amount = number(first?.total_balance); if (amount === undefined) return;
  return { amount, currency: clean(first?.currency)?.toUpperCase() ?? "CNY" };
}
export function parseMoonshotBalance(body: unknown): AccountBalance | undefined {
  const root = record(body); const code = root?.code; if (code !== undefined && String(code) !== "0") return;
  const amount = number(record(root?.data)?.available_balance); return amount === undefined ? undefined : { amount, currency: "CNY" };
}
export function parseSiliconFlowBalance(body: unknown): AccountBalance | undefined {
  const amount = number(record(record(body)?.data)?.totalBalance); return amount === undefined ? undefined : { amount, currency: "CNY" };
}
export function parseOpenRouterBalance(body: unknown): AccountBalance | undefined {
  const data = record(record(body)?.data); const credits = number(data?.total_credits); const used = number(data?.total_usage);
  return credits === undefined || used === undefined ? undefined : { amount: credits - used, currency: "USD" };
}

export function parseGlmWindows(body: unknown): UsageWindow[] {
  const root = record(body); const ok = root?.success === true || number(root?.code) === 200; if (!ok) return [];
  const limits = record(root?.data)?.limits; if (!Array.isArray(limits)) return [];
  const seen = new Set<string>(); const out: UsageWindow[] = [];
  for (const raw of limits) {
    const item = record(raw); const kind = clean(item?.type); if (!item || !kind || !["TIME_LIMIT", "TOKENS_LIMIT"].includes(kind)) continue;
    const unit = number(item.unit) ?? 0, count = number(item.number) ?? 0, total = number(item.usage) ?? number(item.limit) ?? 0;
    const remaining = number(item.remaining), current = number(item.current_value) ?? number(item.currentValue), fallback = number(item.percentage);
    const used = total > 0 && (remaining !== undefined || current !== undefined)
      ? clamp(Math.max(remaining === undefined ? 0 : total - remaining, current ?? 0) / total * 100)
      : fallback === undefined ? undefined : clamp(fallback);
    if (used === undefined) continue;
    const minutes = unit === 1 ? count * 1440 : unit === 3 ? count * 60 : unit === 5 ? count : unit === 6 ? count * 10080 : 0;
    const key = `${kind}:${minutes}`; if (seen.has(key)) continue; seen.add(key);
    const label = codexWindowLabel(minutes * 60);
    out.push(window(key, used, label, label === "额度" ? "额度" : `${label}额度`, resetMs(item.nextResetTime ?? item.next_reset_time)));
  }
  return out;
}

export function parseClaudeWindows(body: unknown): UsageWindow[] {
  const root = record(body); if (!root) return [];
  const out: UsageWindow[] = [];
  for (const [key, id, label] of [["five_hour", "fiveHour", "5h"], ["seven_day", "sevenDay", "周"]] as const) {
    const value = record(root[key]); const used = number(value?.utilization); if (used === undefined) continue;
    out.push(window(id, used, label, `${label}额度`, resetMs(value?.resets_at)));
  }
  return out;
}

function kimiDetail(raw: unknown, id: string, label: string, title: string): UsageWindow | undefined {
  const detail = record(raw); const limit = number(detail?.limit); if (!detail || !limit || limit <= 0) return;
  const remaining = number(detail.remaining); const used = number(detail.used) ?? (remaining === undefined ? 0 : Math.max(0, limit - remaining));
  return window(id, used / limit * 100, label, title, resetMs(detail.resetTime ?? detail.resetAt ?? detail.reset_time ?? detail.reset_at));
}
export function parseKimiWindows(body: unknown): UsageWindow[] {
  const root = record(body); if (!root) return [];
  const out: UsageWindow[] = [];
  const weekly = kimiDetail(root.usage, "weekly", "周", "周额度"); if (weekly) out.push(weekly);
  const limits = root.limits; if (Array.isArray(limits)) { const five = kimiDetail(record(limits[0])?.detail, "fiveHour", "5h", "5小时额度"); if (five) out.push(five); }
  return out;
}

export function parseQoderWindows(body: unknown): UsageWindow[] {
  const root = record(body), user = record(root?.userQuota); if (!root || !user) return [];
  const add = record(root.addOnQuota); const used = (number(user.used) ?? 0) + (number(add?.used) ?? 0); const total = (number(user.total) ?? 0) + (number(add?.total) ?? 0);
  if (total <= 0) return []; const fraction = number(root.totalUsagePercentage) ?? used / total;
  return [window("credits", fraction * 100, "额", "订阅额度", resetMs(root.expiresAt))];
}

export function parseQwenWindows(body: unknown): UsageWindow[] {
  const payload = record(record(record(record(record(body)?.data)?.DataV2)?.data)?.data); if (!payload) return [];
  return [
    window("fiveHour", (number(payload.per5HourPercentage) ?? 0) * 100, "5h", "5小时额度", resetMs(payload.per5HourResetTime)),
    window("weekly", (number(payload.per1WeekPercentage) ?? 0) * 100, "周", "周额度", resetMs(payload.per1WeekResetTime)),
  ];
}

function qwenRequestBody(): string {
  const params = {
    Api: "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage",
    V: "1.0",
    Data: { cornerstoneParam: { feTraceId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`, feURL: "https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal", protocol: "V2", console: "ONE_CONSOLE", productCode: "p_efm", switchUserType: 3, domain: "bailian.console.aliyun.com", consoleSite: "BAILIAN_ALIYUN", userNickName: "", userPrincipalName: "", xsp_lang: "en-US" } },
  };
  return new URLSearchParams({ product: "sfm_bailian", action: "BroadScopeAspnGateway", region: "cn-beijing", language: "en-US", params: JSON.stringify(params) }).toString();
}

function readVarint(bytes: Uint8Array, offset: number): [number, number] | undefined {
  let value = 0, shift = 0;
  for (let index = offset; index < bytes.length && shift <= 49; index++, shift += 7) {
    const byte = bytes[index]; value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, index + 1];
  }
}
type ProtobufNumberField = { path: number[]; value: number; order: number };
type ProtobufScan = { percents: ProtobufNumberField[]; timestamps: ProtobufNumberField[]; nextOrder: number };
function scanProtobuf(bytes: Uint8Array, depth = 0, path: number[] = [], order = 0): ProtobufScan {
  const result: ProtobufScan = { percents: [], timestamps: [], nextOrder: order }; let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset); if (!key) break; offset = key[1];
    const wire = key[0] & 7, fieldNumber = Math.floor(key[0] / 8); if (fieldNumber <= 0) break;
    const fieldPath = [...path, fieldNumber], fieldOrder = result.nextOrder++;
    if (wire === 0) { const value = readVarint(bytes, offset); if (!value) break; offset = value[1]; if (value[0] >= 1_700_000_000 && value[0] <= 2_100_000_000) result.timestamps.push({ path: fieldPath, value: value[0] * 1000, order: fieldOrder }); }
    else if (wire === 5) { if (offset + 4 > bytes.length) break; const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true); offset += 4; if (Number.isFinite(value) && value >= 0 && value <= 100) result.percents.push({ path: fieldPath, value, order: fieldOrder }); }
    else if (wire === 2) { const size = readVarint(bytes, offset); if (!size) break; offset = size[1]; const end = offset + size[0]; if (end > bytes.length) break; if (depth < 6) { const nested = scanProtobuf(bytes.subarray(offset, end), depth + 1, fieldPath, result.nextOrder); result.percents.push(...nested.percents); result.timestamps.push(...nested.timestamps); result.nextOrder = nested.nextOrder; } offset = end; }
    else if (wire === 1) offset += 8;
    else break;
  }
  return result;
}
function grpcWebDataFrames(input: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = []; let offset = 0;
  while (offset < input.length) {
    if (offset + 5 > input.length) return [];
    const flags = input[offset], length = new DataView(input.buffer, input.byteOffset + offset + 1, 4).getUint32(0, false);
    const start = offset + 5, end = start + length; if (end > input.length) return [];
    if ((flags & 0x80) === 0) frames.push(input.subarray(start, end));
    offset = end;
  }
  return frames;
}
function looksLikeProtobuf(input: Uint8Array): boolean {
  if (!input.length) return false;
  const field = input[0] >> 3, wire = input[0] & 7;
  return field > 0 && [0, 1, 2, 5].includes(wire);
}
/** Isolated parser for Grok's undocumented gRPC-web payload; merges data frames and ignores trailers. */
export function parseGrokWindows(input: Uint8Array, now = Date.now()): UsageWindow[] {
  let payloads = grpcWebDataFrames(input);
  if (!payloads.length && looksLikeProtobuf(input)) payloads = [input];
  const scan: ProtobufScan = { percents: [], timestamps: [], nextOrder: 0 };
  for (const payload of payloads) {
    const nested = scanProtobuf(payload, 0, [], scan.nextOrder);
    scan.percents.push(...nested.percents); scan.timestamps.push(...nested.timestamps); scan.nextOrder = nested.nextOrder;
  }
  const used = scan.percents
    .filter(field => field.path.at(-1) === 1)
    .sort((a, b) => a.path.length === b.path.length ? a.order - b.order : a.path.length - b.path.length)[0]?.value;
  if (used === undefined) return [];
  const future = scan.timestamps.filter(field => field.value > now);
  const reset = future.filter(field => field.path.join(",") === "1,5,1").sort((a, b) => a.value - b.value)[0]?.value
    ?? future.sort((a, b) => a.value - b.value)[0]?.value;
  const label = reset ? codexWindowLabel(Math.max(0, (reset - now) / 1000)) : "额";
  return [window("credits", used, label === "额度" ? "额" : label, label === "额度" || label === "额" ? "额度" : `${label}额度`, reset)];
}

export function openCodeGoWindows(rows: LocalUsageRow[], now: number): UsageWindow[] {
  const fiveStart = now - 5 * 3600_000;
  const date = new Date(now); const day = (date.getUTCDay() + 6) % 7;
  const weekStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1), monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const fiveRows = rows.filter(row => row.createdMs >= fiveStart && row.createdMs < now);
  const sum = (selected: LocalUsageRow[]) => selected.reduce((total, row) => total + (Number.isFinite(row.cost) && row.cost >= 0 ? row.cost : 0), 0);
  const oldest = Math.min(now, ...fiveRows.map(row => row.createdMs));
  return [
    window("fiveHour", sum(fiveRows) / 12 * 100, "5h", "5小时本机用量", oldest + 5 * 3600_000),
    window("weekly", sum(rows.filter(row => row.createdMs >= weekStart && row.createdMs < weekStart + 7 * 86400_000)) / 30 * 100, "周", "周本机用量", weekStart + 7 * 86400_000),
    window("monthly", sum(rows.filter(row => row.createdMs >= monthStart && row.createdMs < monthEnd)) / 60 * 100, "月", "月本机用量", monthEnd),
  ];
}

const isRelay = (provider: string) => provider.toLowerCase().includes("relay");
const includes = (...values: string[]) => (provider: string) => !isRelay(provider) && values.some(value => provider.toLowerCase().includes(value));

async function piAuth(ctx: AccountUsageContext) { return ctx.readAuth?.("pi"); }
async function apiKey(ctx: AccountUsageContext, providerIds: string[], envNames: string[]) {
  const fromEnv = envToken(ctx, ...envNames); if (fromEnv) return fromEnv;
  const entry = authEntry(await piAuth(ctx), ...providerIds); return token(entry, "key", "access", "access_token");
}
async function prepaid(ctx: AccountUsageContext, id: string, label: string, url: string, providerIds: string[], envNames: string[], parse: (body: unknown) => AccountBalance | undefined): Promise<AccountUsageSnapshot | undefined> {
  const key = await apiKey(ctx, providerIds, envNames); if (!key) return;
  const balance = parse(await fetchJson(ctx, url, { method: "GET", headers: bearer(key) }));
  return balance ? { provider: id, accountLabel: label, windows: [], balance, source: "prepaid" } : undefined;
}

export type QoderCredentials = { region: "qoder-cn" | "qoder"; access?: string; accessExpiresAt?: number; pat?: string };
export function qoderPatFromRefresh(refresh: unknown): string | undefined {
  const raw = clean(refresh); if (!raw) return;
  const parts = raw.split("|"); if (parts.length < 2 || parts[0] !== "pat") return;
  return clean(parts[1]);
}
export function parseQoderCredentials(raw: unknown): QoderCredentials | undefined {
  const root = record(json(raw)); if (!root) return;
  for (const region of ["qoder-cn", "qoder"] as const) {
    const entry = record(root[region]); if (!entry) continue;
    const access = token(entry, "access", "access_token"), pat = qoderPatFromRefresh(entry.refresh);
    if (!access && !pat) continue;
    return { region, ...(access ? { access } : {}), ...(resetMs(entry.expires) !== undefined ? { accessExpiresAt: resetMs(entry.expires) } : {}), ...(pat ? { pat } : {}) };
  }
}

const QODER_ACCESS_BUFFER_MS = 5 * 60 * 1000;
const QODER_TOKEN_FALLBACK_MS = 24 * 60 * 60 * 1000;
const qoderBase = (region: QoderCredentials["region"]) => region === "qoder-cn" ? "https://openapi.qoder.com.cn" : "https://openapi.qoder.sh";
async function exchangeQoderPat(ctx: AccountUsageContext, credentials: QoderCredentials): Promise<{ token: string; expiresAt: number } | undefined> {
  if (!credentials.pat) return;
  const response = await fetchResponse(ctx, `${qoderBase(credentials.region)}/api/v1/jobToken/exchange`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ personal_token: credentials.pat }),
  });
  if (!response.ok) return;
  let root: Record<string, unknown> | undefined;
  try { root = record(await response.json()); } catch { return; }
  const fresh = token(root, "token"); if (!fresh) return;
  const absolute = resetMs(root?.expires_at), expiresIn = number(root?.expires_in);
  const expiresAt = absolute ?? (expiresIn !== undefined && expiresIn > 0 ? ctx.now() + expiresIn : ctx.now() + QODER_TOKEN_FALLBACK_MS);
  return { token: fresh, expiresAt };
}
async function fetchQoderWindows(ctx: AccountUsageContext, credentials: QoderCredentials, access: string): Promise<{ unauthorized: boolean; windows?: UsageWindow[] }> {
  const response = await fetchResponse(ctx, `${qoderBase(credentials.region)}/api/v2/quota/usage`, { method: "GET", headers: bearer(access) });
  if (response.status === 401 || response.status === 403) return { unauthorized: true };
  if (!response.ok) throw new UsageError("http", `HTTP ${response.status}`);
  return { unauthorized: false, windows: parseQoderWindows(await responseJson(response)) };
}
export function createQoderAdapter(): AccountUsageAdapter {
  let cached: { token: string; expiresAt: number; pat: string } | undefined;
  return {
    id: "qoder", kind: "subscription", matches: includes("qoder"), async load(ctx) {
      const credentials = parseQoderCredentials(await piAuth(ctx)); if (!credentials) return;
      let access = cached && cached.pat === credentials.pat && cached.expiresAt > ctx.now() + QODER_ACCESS_BUFFER_MS ? cached.token : undefined;
      if (!access && credentials.access && (credentials.accessExpiresAt === undefined || credentials.accessExpiresAt > ctx.now() + QODER_ACCESS_BUFFER_MS)) access = credentials.access;
      if (!access && credentials.pat) {
        const fresh = await exchangeQoderPat(ctx, credentials);
        if (fresh) { access = fresh.token; cached = { ...fresh, pat: credentials.pat }; }
      }
      if (!access) return;
      let result = await fetchQoderWindows(ctx, credentials, access);
      if (result.unauthorized) {
        const fresh = await exchangeQoderPat(ctx, credentials);
        if (!fresh) throw new UsageError("http", "HTTP 401");
        cached = { ...fresh, pat: credentials.pat! };
        result = await fetchQoderWindows(ctx, credentials, fresh.token);
        if (result.unauthorized) throw new UsageError("http", "HTTP 401");
      }
      const windows = result.windows ?? [];
      return windows.length ? { provider: "qoder", accountLabel: "Qoder 账号额度", windows, source: "subscription" } : undefined;
    },
  };
}

export const builtinAccountUsageAdapters: AccountUsageAdapter[] = [
  {
    id: "grok", kind: "subscription", matches: provider => !isRelay(provider) && (provider.toLowerCase() === "xai" || provider.toLowerCase().includes("grok")), async load(ctx) {
      const root = record(json(await ctx.readAuth?.("grok"))); if (!root) return;
      const entries = Object.entries(root).filter(([, value]) => record(value));
      const preferred = entries.find(([scope]) => scope.startsWith("https://auth.x.ai::")) ?? entries.find(([scope]) => scope.includes("/sign-in"));
      const access = token(record(preferred?.[1]), "key"); if (!access) return;
      const windows = parseGrokWindows(await fetchBytes(ctx, "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig", { method: "POST", headers: { Authorization: `Bearer ${access}`, Origin: "https://grok.com", Referer: "https://grok.com/?_s=usage", Accept: "*/*", "Content-Type": "application/grpc-web+proto", "x-grpc-web": "1" }, body: new Uint8Array(5) }), ctx.now());
      return windows.length ? { provider: "grok", accountLabel: "Grok 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  {
    id: "codex", kind: "subscription", matches: includes("openai", "codex"), async load(ctx) {
      const raw = await ctx.readAuth?.("codex"); const root = record(json(raw)); const tokens = record(root?.tokens);
      const access = token(tokens, "access_token", "accessToken") ?? token(root, "OPENAI_API_KEY") ?? token(authEntry(await piAuth(ctx), "openai-codex"), "access", "access_token");
      if (!access) return; const accountId = token(tokens, "account_id", "accountId");
      const headers = bearer(access); if (accountId) headers["ChatGPT-Account-Id"] = accountId;
      const windows = parseCodexWindows(await fetchJson(ctx, "https://chatgpt.com/backend-api/wham/usage", { method: "GET", headers }));
      return windows.length ? { provider: "codex", accountLabel: "Codex 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  {
    id: "claude", kind: "subscription", matches: includes("anthropic", "claude"), async load(ctx) {
      const entry = authEntry(await piAuth(ctx), "anthropic"); const access = token(entry, "access", "access_token"); if (!access) return;
      const windows = parseClaudeWindows(await fetchJson(ctx, "https://api.anthropic.com/api/oauth/usage", { method: "GET", headers: { ...bearer(access), "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code/2.1.0" } }));
      return windows.length ? { provider: "claude", accountLabel: "Claude 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  {
    id: "glm", kind: "subscription", matches: includes("zai", "zhipu", "bigmodel", "glm"), async load(ctx) {
      let key = await apiKey(ctx, ["zai-coding-cn", "zai", "glm"], ["Z_AI_API_KEY", "ZAI_CODING_CN_API_KEY", "BIGMODEL_API_KEY", "ZHIPU_API_KEY", "ZHIPUAI_API_KEY", "ZAI_API_KEY", "GLM_API_KEY"]);
      // CodexBar-style key files keep working when no env/auth key is configured.
      if (!key && ctx.readKeyFile) key = await ctx.readKeyFile([".coding-relay/glm-api-key", ".config/bigmodel/api_key", ".config/zhipu/api_key"]);
      if (!key) return;
      const host = clean(ctx.env?.Z_AI_API_HOST) ?? ("https://open.bigmodel.cn");
      const windows = parseGlmWindows(await fetchJson(ctx, `${host.replace(/\/$/, "")}/api/monitor/usage/quota/limit`, { method: "GET", headers: bearer(key) }));
      return windows.length ? { provider: "glm", accountLabel: "GLM 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  {
    id: "kimi", kind: "subscription", matches: includes("kimi-coding", "kimi"), async load(ctx) {
      const key = await apiKey(ctx, ["kimi-coding"], ["KIMI_CODE_API_KEY", "KIMI_API_KEY"]); if (!key) return;
      const windows = parseKimiWindows(await fetchJson(ctx, "https://api.kimi.com/coding/v1/usages", { method: "GET", headers: bearer(key) }));
      return windows.length ? { provider: "kimi", accountLabel: "Kimi 账号额度", windows, source: "subscription" } : undefined;
    },
  },
  createQoderAdapter(),
  {
    id: "qwenTokenPlan", kind: "subscription", matches: includes("qwen-token-plan"), async load(ctx) {
      if (!ctx.readCookie) throw new NoDataError("missing-capability");
      const cookie = await ctx.readCookie("qwen-token-plan"); if (!cookie) return;
      const windows = parseQwenWindows(await fetchJson(ctx, "https://bailian-cs.console.aliyun.com/data/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage&_v=undefined", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Origin: "https://bailian.console.aliyun.com", Referer: "https://bailian.console.aliyun.com" }, body: qwenRequestBody() }));
      if (!windows.length) return;
      // Only a genuinely successful fetch updates the host's cookie cache; a
      // NotLogined/failed response keeps the last-known-good session intact.
      await ctx.persistCookie?.("qwen-token-plan", cookie);
      return { provider: "qwenTokenPlan", accountLabel: "Qwen Token Plan 额度", windows, source: "subscription" };
    },
  },
  {
    id: "opencodeGo", kind: "subscription", matches: includes("opencode-go"), async load(ctx) {
      if (!ctx.readLocalUsage) throw new NoDataError("missing-capability");
      // Credential gate mirrors the Swift client: an OPENCODE_API_KEY in env/.env or an
      // opencode-go auth entry marks the Go plan as configured; usage is local-only.
      const configured = Boolean(envToken(ctx, "OPENCODE_API_KEY")) || Boolean(token(authEntry(await ctx.readAuth?.("opencode"), "opencode-go"), "key"));
      if (!configured) return;
      const rows = await ctx.readLocalUsage("opencode-go"); if (!rows) return;
      return { provider: "opencodeGo", accountLabel: "OpenCode Go 本机用量", windows: openCodeGoWindows(rows, ctx.now()), source: "local" };
    },
  },
  { id: "deepseek", kind: "prepaid", matches: includes("deepseek"), load: ctx => prepaid(ctx, "deepseek", "账户余额", "https://api.deepseek.com/user/balance", ["deepseek"], ["DEEPSEEK_API_KEY"], parseDeepSeekBalance) },
  { id: "moonshot", kind: "prepaid", matches: includes("moonshot", "moonshotai"), load: ctx => prepaid(ctx, "moonshot", "账户余额", "https://api.moonshot.cn/v1/users/me/balance", ["moonshot", "moonshotai"], ["MOONSHOT_API_KEY", "KIMI_API_KEY"], parseMoonshotBalance) },
  { id: "siliconflow", kind: "prepaid", matches: includes("siliconflow"), load: ctx => prepaid(ctx, "siliconflow", "账户余额", "https://api.siliconflow.cn/v1/user/info", ["siliconflow"], ["SILICONFLOW_API_KEY"], parseSiliconFlowBalance) },
  { id: "openrouter", kind: "prepaid", matches: includes("openrouter"), load: ctx => prepaid(ctx, "openrouter", "账户余额", "https://openrouter.ai/api/v1/credits", ["openrouter"], ["OPENROUTER_API_KEY"], parseOpenRouterBalance) },
];

export class AccountUsageRegistry {
  constructor(readonly adapters: readonly AccountUsageAdapter[] = builtinAccountUsageAdapters) {}
  resolve(provider: string): AccountUsageAdapter | undefined {
    if (isRelay(provider)) return;
    return this.adapters
      .filter(adapter => adapter.matches(provider))
      .sort((a, b) => (a.kind === b.kind ? (b.priority ?? 0) - (a.priority ?? 0) : a.kind === "subscription" ? -1 : 1))[0];
  }
}

export class AccountUsageMonitor {
  private cache = new Map<string, { snapshot: AccountUsageSnapshot; fetchedAt: number }>();
  private inFlight = new Map<string, Promise<AccountUsageResult>>();
  readonly registry: AccountUsageRegistry;
  readonly ctx: AccountUsageContext;
  constructor(capabilities: AccountUsageCapabilities = {}, registry = new AccountUsageRegistry()) {
    this.registry = registry;
    this.ctx = { ...capabilities, fetch: capabilities.fetch ?? fetch, now: capabilities.now ?? Date.now, timeoutMs: capabilities.timeoutMs ?? 15_000 };
  }
  async snapshot(provider: string, force = false): Promise<AccountUsageResult> {
    const adapter = this.registry.resolve(provider); if (!adapter) return { status: "no-data", reason: "unsupported" };
    const cached = this.cache.get(adapter.id), now = this.ctx.now();
    if (cached && !force && now - cached.fetchedAt < ACCOUNT_USAGE_STALE_AFTER_MS) return { status: "ready", snapshot: cached.snapshot, stale: false };
    const pending = this.inFlight.get(adapter.id); if (pending) return pending;
    const task = (async (): Promise<AccountUsageResult> => {
      try {
        const snapshot = await adapter.load(this.ctx);
        if (!snapshot) return cached ? { status: "ready", snapshot: cached.snapshot, stale: true } : { status: "no-data", reason: "missing-credential" };
        this.cache.set(adapter.id, { snapshot, fetchedAt: this.ctx.now() });
        return { status: "ready", snapshot, stale: false };
      } catch (error) {
        if (error instanceof NoDataError) return { status: "no-data", reason: error.reason };
        const code = error instanceof UsageError ? error.code : "network";
        return { status: "error", code, ...(error instanceof UsageError ? { detail: error.message } : {}), ...(cached ? { staleSnapshot: cached.snapshot } : {}) };
      } finally { this.inFlight.delete(adapter.id); }
    })();
    this.inFlight.set(adapter.id, task);
    return task;
  }
}
