/**
 * DeepSeek extension config: settings snapshot + base URL / API-key fallback.
 *
 * Secrets never leave the Pi credential store (`auth.json`). This module only
 * reads non-secret `ext.deepseek.baseUrl` and the settings-key fallback
 * `ext.deepseek.apiKey`. The provider never writes the store itself.
 */

import { DEEPSEEK_BASE_URL } from "./models.js";

export const EXTENSION_ID = "deepseek";
export const SETTINGS_API_KEY = "ext.deepseek.apiKey";
export const SETTINGS_BASE_URL = "ext.deepseek.baseUrl";

const SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_DEEPSEEK";

export function settingsSnapshot(): Record<string, unknown> | undefined {
  const raw = process.env[SETTINGS_ENV];
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

function settingString(...keys: string[]): string | undefined {
  const snap = settingsSnapshot();
  if (!snap) return undefined;
  for (const key of keys) {
    const value = snap[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Settings-only API key fallback. Empty when the user has not set one. */
export function resolveSettingsApiKey(): string | undefined {
  return settingString(SETTINGS_API_KEY, "apiKey");
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("DeepSeek baseUrl 不能为空");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`非法的 DeepSeek baseUrl: ${trimmed}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`DeepSeek 请求仅允许 HTTPS（收到 ${url.protocol}）`);
  }
  return trimmed.replace(/\/+$/, "");
}

/** Default `https://api.deepseek.com`; `ext.deepseek.baseUrl` overrides. */
export function resolveBaseUrl(override?: string): string {
  if (override?.trim()) return normalizeBaseUrl(override);
  const fromSettings = settingString(SETTINGS_BASE_URL, "baseUrl");
  if (fromSettings) return normalizeBaseUrl(fromSettings);
  return DEEPSEEK_BASE_URL;
}

export type DeepSeekConfig = {
  baseUrl: string;
  /** Settings fallback only — Pi stored credentials win at request time. */
  apiKey?: string;
};

export function resolveDeepSeekConfig(options: { baseUrl?: string; apiKey?: string } = {}): DeepSeekConfig {
  const apiKey = options.apiKey?.trim() || resolveSettingsApiKey();
  return {
    baseUrl: resolveBaseUrl(options.baseUrl),
    ...(apiKey ? { apiKey } : {}),
  };
}
