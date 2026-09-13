import { isAbsolute } from "node:path";
export const HEADROOM_UPSTREAM_VERSION = "0.37.0";
export const HEADROOM_SETTINGS_ENV = "PIPIUI_EXT_SETTINGS_PIPIUI_HEADROOM";
const PROTECTED_TOOLS = Object.freeze([
    "read",
    "edit",
    "write",
    "apply_patch",
    "ask",
    "todo",
    "headroom_retrieve",
    "recall_folded",
    "unfold",
    "context_manage",
]);
export const DEFAULT_CONFIG = Object.freeze({
    baseUrl: "http://127.0.0.1:8787",
    managed: false,
    managedEngineVersion: HEADROOM_UPSTREAM_VERSION,
    managedStartupTimeoutMs: 5 * 60_000,
    minContextTokens: 20_000,
    minResultChars: 4_000,
    protectRecentToolResults: 2,
    protectedTools: PROTECTED_TOOLS,
    maxCacheBytes: 64 * 1024 * 1024,
    healthTimeoutMs: 1_500,
    // Headroom's local Kompress fallback has a 20s per-candidate time budget.
    // Keep the adapter deadline outside that window so Headroom can return its
    // own fail-open passthrough result instead of racing a shorter client abort.
    requestTimeoutMs: 30_000,
});
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function normalizeLoopbackUrl(value) {
    if (typeof value !== "string")
        return undefined;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if ((url.protocol !== "http:" && url.protocol !== "https:") || !["127.0.0.1", "localhost", "::1"].includes(host)) {
            return undefined;
        }
        if (url.username || url.password || url.search || url.hash)
            return undefined;
        return url.toString().replace(/\/$/, "");
    }
    catch {
        return undefined;
    }
}
function integer(input, key, fallback, warnings, allowZero = false) {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (Number.isInteger(value) && (allowZero ? value >= 0 : value > 0))
        return value;
    warnings.push(`${key} 必须是${allowZero ? "非负" : "正"}整数，已使用 ${fallback}`);
    return fallback;
}
export function loadHeadroomConfig(env = process.env) {
    const warnings = [];
    let input = {};
    const raw = env[HEADROOM_SETTINGS_ENV];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (isRecord(parsed))
                input = parsed;
            else
                warnings.push("Headroom 项目设置不是 JSON 对象，已使用默认值");
        }
        catch {
            warnings.push("Headroom 项目设置无法解析，已使用默认值");
        }
    }
    const configuredUrl = input["ext.pipiui-headroom.baseUrl"];
    const baseUrl = configuredUrl === undefined ? DEFAULT_CONFIG.baseUrl : normalizeLoopbackUrl(configuredUrl);
    if (!baseUrl)
        warnings.push("Headroom 地址必须是本机回环 HTTP(S) URL，已使用 127.0.0.1:8787");
    const managed = input["ext.pipiui-headroom.managed"] === true;
    const rawManagedState = input["ext.pipiui-headroom.managedState"];
    const managedState = ["installing", "starting", "ready", "failed", "stopped"].includes(String(rawManagedState))
        ? rawManagedState
        : undefined;
    const rawStatePath = input["ext.pipiui-headroom.managedStatePath"];
    const managedStatePath = typeof rawStatePath === "string" && isAbsolute(rawStatePath) ? rawStatePath : undefined;
    if (managed && !managedStatePath)
        warnings.push("PipiUI 托管的 Headroom 状态路径缺失；context-fold 将保持工作");
    const rawEngineVersion = input["ext.pipiui-headroom.managedEngineVersion"];
    const managedEngineVersion = typeof rawEngineVersion === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(rawEngineVersion)
        ? rawEngineVersion
        : HEADROOM_UPSTREAM_VERSION;
    if (managed && rawEngineVersion !== undefined && managedEngineVersion !== rawEngineVersion) {
        warnings.push(`PipiUI 托管的 Headroom 版本无效；已使用 ${HEADROOM_UPSTREAM_VERSION}`);
    }
    return {
        config: {
            baseUrl: baseUrl ?? DEFAULT_CONFIG.baseUrl,
            managed,
            ...(managedState ? { managedState } : {}),
            ...(managedStatePath ? { managedStatePath } : {}),
            managedEngineVersion,
            managedStartupTimeoutMs: DEFAULT_CONFIG.managedStartupTimeoutMs,
            minContextTokens: integer(input, "ext.pipiui-headroom.minContextTokens", DEFAULT_CONFIG.minContextTokens, warnings),
            minResultChars: integer(input, "ext.pipiui-headroom.minResultChars", DEFAULT_CONFIG.minResultChars, warnings),
            protectRecentToolResults: integer(input, "ext.pipiui-headroom.protectRecentToolResults", DEFAULT_CONFIG.protectRecentToolResults, warnings, true),
            protectedTools: [...DEFAULT_CONFIG.protectedTools],
            maxCacheBytes: integer(input, "ext.pipiui-headroom.maxCacheBytes", DEFAULT_CONFIG.maxCacheBytes, warnings),
            healthTimeoutMs: DEFAULT_CONFIG.healthTimeoutMs,
            requestTimeoutMs: DEFAULT_CONFIG.requestTimeoutMs,
        },
        warnings,
    };
}
