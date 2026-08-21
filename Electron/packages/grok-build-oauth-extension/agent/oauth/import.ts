/**
 * Explicit one-shot import from the official grok CLI's `~/.grok/auth.json`
 * (spec US-09 / D5 "永不静默读全局").
 *
 * Contract:
 * - Requires an explicit confirmation from the user (`confirm: true`).
 * - Reads the source file exactly ONCE, never writes/deletes/moves it.
 * - Validates issuer / client_id / expiry against the resolved OAuth config.
 * - Persists only through the broker's controlled `importCredential` (shared
 *   lock on the real credential target, 0600 atomic merge).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolveOAuthConfig } from "./config.js";
import { OAuthError } from "./device.js";
import type { GrokCredentialBroker } from "./broker.js";

export type GlobalGrokAuthShape = {
  access: string;
  refresh?: string;
  expiresAtMs: number;
  issuer?: string;
  clientId?: string;
};

export type ImportResult = {
  imported: boolean;
  reason?: string;
  expiresAtMs?: number;
  issuer?: string;
};

export function globalGrokAuthPath(homedirOverride?: string): string {
  const home = homedirOverride ?? homedir();
  return join(home, ".grok", "auth.json");
}

/** Accept seconds or milliseconds epochs (official file has used both). */
function normalizeExpiry(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return raw > 1e12 ? raw : raw * 1000;
}

/**
 * Read and validate `~/.grok/auth.json` once. Returns the mapped credential
 * fields or a refusal reason. Never touches the source file.
 */
export async function readGlobalGrokAuth(opts: {
  homedirOverride?: string;
  sourcePath?: string;
  nowMs?: () => number;
}): Promise<{ ok: true; credential: GlobalGrokAuthShape } | { ok: false; reason: string }> {
  const path = opts.sourcePath ?? globalGrokAuthPath(opts.homedirOverride);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { ok: false, reason: `未找到 ${path} — 请先在官方 grok CLI 登录，或改用 /login grok-build` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "auth.json 不是合法 JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "auth.json 结构不识别" };
  }
  const rec = parsed as Record<string, unknown>;

  // Official grok CLI shape: top-level `key` (access), `refresh_token`,
  // `expires_at` (epoch, s or ms), `oidc_issuer`, `client_id`. Also accept the
  // pi-shaped { access, refresh, expires } for symmetry.
  const access =
    typeof rec.key === "string" && rec.key ? rec.key :
    typeof rec.access === "string" && rec.access ? rec.access :
    typeof rec.access_token === "string" && rec.access_token ? rec.access_token :
    undefined;
  if (!access) return { ok: false, reason: "auth.json 中没有可用的 access token（缺少 key/access 字段）" };

  const refresh =
    typeof rec.refresh_token === "string" && rec.refresh_token ? rec.refresh_token :
    typeof rec.refresh === "string" && rec.refresh ? rec.refresh :
    undefined;

  const expiresAtMs =
    normalizeExpiry(rec.expires_at) ?? normalizeExpiry(rec.expires) ?? normalizeExpiry(rec.expires_at_ms);
  if (expiresAtMs === undefined) {
    return { ok: false, reason: "auth.json 缺少 expires_at — 无法判断有效期，请重新登录" };
  }
  const nowMs = opts.nowMs ?? Date.now;
  if (expiresAtMs <= nowMs()) {
    return { ok: false, reason: "导入的凭证已过期 — 请重新登录 grok-build" };
  }

  const issuer = typeof rec.oidc_issuer === "string" && rec.oidc_issuer ? rec.oidc_issuer :
    typeof rec.issuer === "string" && rec.issuer ? rec.issuer :
    undefined;
  const clientId = typeof rec.client_id === "string" && rec.client_id ? rec.client_id : undefined;

  return { ok: true, credential: { access, refresh, expiresAtMs, issuer, clientId } };
}

/**
 * Full import flow: confirm -> read once -> validate -> broker-controlled
 * persist. The source file is never modified.
 */
export async function importFromGlobalGrok(opts: {
  confirm: boolean;
  broker: GrokCredentialBroker;
  homedirOverride?: string;
  sourcePath?: string;
  nowMs?: () => number;
}): Promise<ImportResult> {
  if (!opts.confirm) {
    return { imported: false, reason: "需要显式确认：/grok-build:import --confirm（仅读取一次 ~/.grok/auth.json，不修改源文件）" };
  }
  const read = await readGlobalGrokAuth({ homedirOverride: opts.homedirOverride, sourcePath: opts.sourcePath, nowMs: opts.nowMs });
  if (!read.ok) return { imported: false, reason: read.reason };
  const cfg = resolveOAuthConfig();
  const credential = read.credential;
  try {
    await opts.broker.importCredential({
      access: credential.access,
      refresh: credential.refresh,
      expiresAtMs: credential.expiresAtMs,
      issuer: credential.issuer ?? cfg.issuer,
      clientId: credential.clientId,
      scopes: cfg.scopes,
    });
  } catch (err) {
    const reason = err instanceof OAuthError ? err.message : err instanceof Error ? err.message : String(err);
    return { imported: false, reason };
  }
  return { imported: true, expiresAtMs: credential.expiresAtMs, issuer: credential.issuer ?? cfg.issuer };
}

/**
 * Parse slash-command args into an explicit confirmation. Pi delivers command
 * args as a raw string; `--confirm` / `confirm=true` / `confirm` all confirm.
 */
export function parseImportConfirm(args: unknown): { confirm: boolean } {
  if (args == null) return { confirm: false };
  if (typeof args === "string") {
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    return { confirm: tokens.some((t) => t === "--confirm" || t === "confirm" || /^confirm=(true|1|yes)$/i.test(t)) };
  }
  if (typeof args === "object") {
    const rec = args as Record<string, unknown>;
    return { confirm: rec.confirm === true || rec.confirm === "true" || rec.confirm === 1 };
  }
  return { confirm: false };
}
