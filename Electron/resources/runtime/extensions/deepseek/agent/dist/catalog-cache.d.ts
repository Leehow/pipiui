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
import { type DeepSeekConversationModel } from "./models.js";
export declare const CATALOG_CACHE_VERSION = 1;
/** Default max age before a background refresh is attempted. */
export declare const CATALOG_MAX_AGE_MS: number;
export type CatalogCache = {
    version: number;
    fetchedAt: number;
    baseUrl: string;
    models: DeepSeekConversationModel[];
};
/** Redirects the cache; set by tests so a suite never reads a developer's own. */
export declare const CATALOG_CACHE_PATH_ENV = "PIPIUI_DEEPSEEK_CATALOG_CACHE";
export declare function defaultCatalogCachePath(): string;
/** Synchronous, total: any unreadable or empty cache reads as "no cache". */
export declare function readCatalogCache(path?: string): CatalogCache | undefined;
/** Atomic replace so a synchronous reader never observes a partial file. */
export declare function writeCatalogCache(cache: Omit<CatalogCache, "version">, path?: string): void;
/** A cache built for a different base URL describes a different account. */
export declare function isCatalogFresh(cache: CatalogCache | undefined, input: {
    baseUrl: string;
    now?: number;
    maxAgeMs?: number;
}): cache is CatalogCache;
