/**
 * Catalog policy: what is effective right now, and when to go get a new one.
 *
 * Split from `catalog.ts` (pure fetch + merge) and `catalog-cache.ts` (disk) so
 * that the parts needing neither network nor filesystem stay testable on their
 * own. This module is the only place that reads credentials.
 */
import { type FetchLike } from "./catalog.js";
import { type DeepSeekConversationModel } from "./models.js";
export declare function resolveRefreshApiKey(input?: {
    agentDir?: string;
}): string | undefined;
/**
 * The catalog to register right now, synchronously.
 *
 * A stale cache still beats the floor: it describes the account, the floor only
 * describes what shipped in this build. Age decides whether to refresh, never
 * whether to use.
 */
export declare function effectiveCatalog(input?: {
    baseUrl?: string;
    cachePath?: string;
}): DeepSeekConversationModel[];
export type RefreshOutcome = {
    status: "written";
    models: DeepSeekConversationModel[];
} | {
    status: "skipped";
    reason: "fresh" | "no-key";
} | {
    status: "failed";
    reason: string;
};
/**
 * One refresh attempt. Never throws: a failure leaves whatever cache exists in
 * place, so the worst case is that the catalog stays as stale as it already was.
 */
export declare function refreshDeepSeekCatalog(input?: {
    fetchImpl?: FetchLike;
    baseUrl?: string;
    cachePath?: string;
    agentDir?: string;
    maxAgeMs?: number;
    force?: boolean;
    now?: number;
    onWarn?: (message: string) => void;
}): Promise<RefreshOutcome>;
/**
 * Fire-and-forget refresh for extension start-up. Deliberately not awaited by
 * the caller: provider registration is synchronous and must not block on a
 * network call.
 */
export declare function scheduleCatalogRefresh(input?: Parameters<typeof refreshDeepSeekCatalog>[0]): void;
