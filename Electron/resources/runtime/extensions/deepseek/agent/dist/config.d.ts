/**
 * DeepSeek extension config: settings snapshot + base URL / API-key fallback.
 *
 * Secrets never leave the Pi credential store (`auth.json`). This module only
 * reads non-secret `ext.deepseek.baseUrl` and the settings-key fallback
 * `ext.deepseek.apiKey`. The provider never writes the store itself.
 */
export declare const EXTENSION_ID = "deepseek";
export declare const SETTINGS_API_KEY = "ext.deepseek.apiKey";
export declare const SETTINGS_BASE_URL = "ext.deepseek.baseUrl";
export declare function settingsSnapshot(): Record<string, unknown> | undefined;
/** Settings-only API key fallback. Empty when the user has not set one. */
export declare function resolveSettingsApiKey(): string | undefined;
export declare function normalizeBaseUrl(raw: string): string;
/** Default `https://api.deepseek.com`; `ext.deepseek.baseUrl` overrides. */
export declare function resolveBaseUrl(override?: string): string;
export type DeepSeekConfig = {
    baseUrl: string;
    /** Settings fallback only — Pi stored credentials win at request time. */
    apiKey?: string;
};
export declare function resolveDeepSeekConfig(options?: {
    baseUrl?: string;
    apiKey?: string;
}): DeepSeekConfig;
