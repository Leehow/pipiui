/**
 * M4 — Images config resolution.
 *
 * Priority (per spec §D6): env > extension settings > build defaults.
 * - baseUrl:   XAI_API_BASE_URL > ext.grok-build-oauth.xaiApiBaseUrl > https://api.x.ai/v1
 * - model:     GROK_IMAGINE_MODEL > ext.grok-build-oauth.defaultModel > grok-imagine-image-quality
 * - sessionId: ext.grok-build-oauth.sessionId > GROK_SESSION_ID > persisted
 *   `<agentHome>/grok-build-session-id` (generated once, reused).
 * - tier:      GROK_TIER > ext.grok-build-oauth.tier (advisory gate only).
 * - compatFallback: ext.grok-build-oauth.compatFallback (default false).
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_BASE_URL, DEFAULT_EDIT_MODEL, DEFAULT_MODEL } from "./client.js";
import { tryResolveAgentHome } from "../oauth/home.js";

export function settingsSnapshot(): Record<string, unknown> | undefined {
  const raw = process.env.PIPIUI_EXT_SETTINGS_GROK_BUILD_OAUTH;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function settingString(key: string): string | undefined {
  const v = settingsSnapshot()?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Agent home — `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`; never the global
 * `~/.pi/agent` (fail closed per spec §D9). Returns undefined when unset so
 * non-critical helpers (session id persistence) can degrade gracefully.
 */
export function agentHome(): string | undefined {
  return tryResolveAgentHome();
}

/** Stable x-grok-session-id: settings > env > persisted generated UUID. */
export function resolveSessionId(): string {
  const fromSettings = settingString("ext.grok-build-oauth.sessionId");
  if (fromSettings) return fromSettings;
  const fromEnv = process.env.GROK_SESSION_ID?.trim();
  if (fromEnv) return fromEnv;
  const home = agentHome();
  // No resolved home -> transient id (never falls back to a global ~/.pi dir).
  if (!home) return randomUUID();
  const file = join(home, "grok-build-session-id");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // fall through to generate
  }
  const id = randomUUID();
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(file, `${id}\n`, { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch {}
  } catch {
    // best-effort persistence; id still returned for this process
  }
  return id;
}

export type ImagesConfig = {
  baseUrl: string;
  model: string;
  editModel: string;
  sessionId: string;
  tier?: string;
  compatFallback: boolean;
};

export function resolveImagesConfig(): ImagesConfig {
  const settings = settingsSnapshot();
  const baseUrl =
    process.env.XAI_API_BASE_URL?.trim() ||
    settingString("ext.grok-build-oauth.xaiApiBaseUrl") ||
    DEFAULT_BASE_URL;
  const model =
    process.env.GROK_IMAGINE_MODEL?.trim() ||
    settingString("ext.grok-build-oauth.defaultModel") ||
    DEFAULT_MODEL;
  // Tier: an explicitly configured value is preserved as-is — including the
  // EMPTY string, which US-22 gates as the free tier. Only an unset value
  // stays undefined (fail-open, server is authoritative).
  const tierRaw = process.env.GROK_TIER !== undefined
    ? process.env.GROK_TIER
    : typeof settings?.["ext.grok-build-oauth.tier"] === "string"
      ? (settings["ext.grok-build-oauth.tier"] as string)
      : undefined;
  const tier = typeof tierRaw === "string" ? tierRaw : undefined;
  const compatFallback = settings?.["ext.grok-build-oauth.compatFallback"] === true;
  return {
    baseUrl,
    model,
    editModel: DEFAULT_EDIT_MODEL,
    sessionId: resolveSessionId(),
    tier,
    compatFallback,
  };
}

/**
 * Deprecated legacy PipiUI loopback relay. Used ONLY when
 * `ext.grok-build-oauth.compatFallback === true` and neither OAuth nor
 * XAI_API_KEY credentials are present (spec §D6 / US-27).
 */
export function legacyRelayBase(): string {
  return process.env.PIPIUI_GROK_RELAY?.trim() || "http://127.0.0.1:18891/v1";
}
