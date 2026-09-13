/**
 * On-disk catalog cache shared by both halves of the extension.
 *
 * The host loader calls `createAuthProvider()` synchronously and does not await
 * it (`pi-backend/src/extension-auth-providers.ts`), so registration can never
 * wait on a network round trip. The cache is what bridges that: registration
 * reads the last known catalog synchronously, and a background refresh writes
 * the next one. A refresh therefore lands in the picker on the next launch.
 *
 * The file is untrusted input — another process, a half-finished write or an
 * older build could have produced it — so transport fields are re-stamped from
 * `models.ts` on read and never taken from disk.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEEPSEEK_FAMILY_DEFAULTS, } from "./models.js";
export const CATALOG_CACHE_VERSION = 1;
const CACHE_FILE = `deepseek-catalog-v${CATALOG_CACHE_VERSION}.json`;
/** Default max age before a background refresh is attempted. */
export const CATALOG_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Redirects the cache; set by tests so a suite never reads a developer's own. */
export const CATALOG_CACHE_PATH_ENV = "PIPIUI_DEEPSEEK_CATALOG_CACHE";
/**
 * Root for the cache, derived from where this very module was loaded from.
 *
 * Both halves of the extension — the Pi agent entry and the host's
 * `createAuthProvider` — are loaded out of the same installed extension
 * directory, so deriving the path from `import.meta.url` is the one anchor they
 * agree on without the host having to hand `agentDir` down through the generic
 * provider loader. It also isolates by product and by profile for free: an
 * install under `.../@pipiui/electron/runtime/extensions/` and one under
 * `.../Pipi/<profile>/pi-coc/agent/extensions/` resolve to different roots
 * instead of sharing one file in the home directory.
 *
 * The cache is written beside the managed `extensions/` tree, never inside it:
 * a runtime re-install stage-swaps that tree and would take the cache with it.
 */
function installRootFromModule() {
    let dir;
    try {
        dir = dirname(fileURLToPath(import.meta.url));
    }
    catch {
        return undefined;
    }
    const { root } = parse(dir);
    // Layouts differ (`extensions/deepseek/agent/dist/` here, `extensions/deepseek/agent/`
    // once vendored and bundled), so walk up to the marker instead of counting.
    while (dir && dir !== root) {
        if (dir.endsWith(`${sep}extensions`))
            return dirname(dir);
        dir = dirname(dir);
    }
    return undefined;
}
export function defaultCatalogCachePath() {
    const override = process.env[CATALOG_CACHE_PATH_ENV];
    if (override?.trim())
        return override.trim();
    const installRoot = installRootFromModule();
    if (installRoot)
        return join(installRoot, "ext-cache", CACHE_FILE);
    // Running from a source checkout rather than an install: keep the catalog out
    // of the repo.
    return join(homedir(), ".pipiui-electron", "ext-cache", CACHE_FILE);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positiveInt(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback;
}
function nonNegative(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function readSource(value) {
    return value === "curated" || value === "models.dev" || value === "family-default"
        ? value
        : undefined;
}
/**
 * Rebuild one row from cached data, forcing every transport field back to the
 * compiled-in values. A row without a usable id or a complete cost is dropped
 * rather than repaired with invented numbers.
 */
function normalizeRow(raw) {
    if (!isRecord(raw))
        return undefined;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id)
        return undefined;
    const cost = isRecord(raw.cost) ? raw.cost : undefined;
    const input = nonNegative(cost?.input);
    const output = nonNegative(cost?.output);
    if (input === undefined || output === undefined)
        return undefined;
    const modalities = Array.isArray(raw.input)
        ? raw.input.filter((item) => item === "text" || item === "image")
        : [];
    const source = readSource(raw.metadataSource);
    return {
        id,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
        api: DEEPSEEK_FAMILY_DEFAULTS.api,
        reasoning: typeof raw.reasoning === "boolean" ? raw.reasoning : DEEPSEEK_FAMILY_DEFAULTS.reasoning,
        input: modalities.length ? modalities : [...DEEPSEEK_FAMILY_DEFAULTS.input],
        cost: {
            input,
            output,
            cacheRead: nonNegative(cost?.cacheRead) ?? 0,
            cacheWrite: nonNegative(cost?.cacheWrite) ?? 0,
        },
        contextWindow: positiveInt(raw.contextWindow, DEEPSEEK_FAMILY_DEFAULTS.contextWindow),
        maxTokens: positiveInt(raw.maxTokens, DEEPSEEK_FAMILY_DEFAULTS.maxTokens),
        thinkingLevelMap: { ...DEEPSEEK_FAMILY_DEFAULTS.thinkingLevelMap },
        compat: { ...DEEPSEEK_FAMILY_DEFAULTS.compat },
        capabilities: {
            hostedTools: { tools: [...DEEPSEEK_FAMILY_DEFAULTS.capabilities.hostedTools.tools] },
            structuredOutputs: true,
            nativeSearch: { tools: [...DEEPSEEK_FAMILY_DEFAULTS.capabilities.nativeSearch.tools] },
        },
        ...(source ? { metadataSource: source } : {}),
    };
}
/** Synchronous, total: any unreadable or empty cache reads as "no cache". */
export function readCatalogCache(path = defaultCatalogCachePath()) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return undefined;
    }
    if (!isRecord(parsed) || parsed.version !== CATALOG_CACHE_VERSION)
        return undefined;
    if (!Array.isArray(parsed.models))
        return undefined;
    const models = parsed.models
        .map((row) => normalizeRow(row))
        .filter((row) => row !== undefined);
    if (!models.length)
        return undefined;
    return {
        version: CATALOG_CACHE_VERSION,
        fetchedAt: typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        models,
    };
}
/** Atomic replace so a synchronous reader never observes a partial file. */
export function writeCatalogCache(cache, path = defaultCatalogCachePath()) {
    const payload = { version: CATALOG_CACHE_VERSION, ...cache };
    const staging = `${path}.${process.pid}.tmp`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(staging, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(staging, path);
}
/** A cache built for a different base URL describes a different account. */
export function isCatalogFresh(cache, input) {
    if (!cache)
        return false;
    if (cache.baseUrl && cache.baseUrl !== input.baseUrl)
        return false;
    const age = (input.now ?? Date.now()) - cache.fetchedAt;
    return age >= 0 && age < (input.maxAgeMs ?? CATALOG_MAX_AGE_MS);
}
