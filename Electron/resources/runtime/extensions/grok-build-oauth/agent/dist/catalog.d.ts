import { type GrokBuildConversationModel } from "./models.js";
export declare const GROK_BUILD_CATALOG_URL = "https://cli-chat-proxy.grok.com/v1/models";
export declare const CATALOG_MAX_AGE_MS: number;
export declare const CATALOG_TIMEOUT_MS = 3000;
/** Only model metadata is accepted remotely. Transport and tool capabilities stay local. */
export declare function parseGrokBuildCatalog(value: unknown): GrokBuildConversationModel[];
export type CatalogOptions = {
    authPath?: string;
    /** Session caches stay in the project home. Host auth helpers use memory only. */
    cacheDir?: string | null;
    fetchImpl?: typeof fetch;
    force?: boolean;
};
export declare function loadGrokBuildCatalog(options?: CatalogOptions): Promise<GrokBuildConversationModel[]>;
