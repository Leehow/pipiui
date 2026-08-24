/**
 * Grok / xAI Responses hosted-search protocol.
 *
 * Upstream Agent Tools on `/v1/responses` accept raw hosted entries
 * `{ type: "web_search" }` and `{ type: "x_search" }`. Domain policy maps
 * onto official `filters.allowed_domains` / `filters.excluded_domains`
 * (max 5 each) and applies only when native `web_search` is declared.
 *
 * This module is the testable seam. Live injection lives in the generalized
 * `pipiui-xai-server-tools` hook so we do not fork the request rewrite.
 */
export declare const NATIVE_SEARCH_TOOLS: readonly ["web_search", "x_search"];
export type NativeSearchToolName = (typeof NATIVE_SEARCH_TOOLS)[number];
export type NativeSearchDomainPolicy = {
    allow?: readonly string[];
    deny?: readonly string[];
};
export type NativeSearchCapability = {
    tools: readonly NativeSearchToolName[];
    domains?: NativeSearchDomainPolicy;
};
export declare const GROK_BUILD_NATIVE_SEARCH: NativeSearchCapability;
/** Official Responses cap for web_search domain lists. */
export declare const WEB_SEARCH_DOMAIN_LIMIT = 5;
export type HostedWebSearchTool = {
    type: "web_search";
    filters?: {
        allowed_domains?: string[];
        excluded_domains?: string[];
    };
};
export type HostedXSearchTool = {
    type: "x_search";
};
export type HostedSearchTool = HostedWebSearchTool | HostedXSearchTool;
export type NormalizedUsage = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    totalTokens: number;
    serverSideToolUsage?: Record<string, number>;
};
export type HostedSearchSource = {
    url: string;
    title?: string;
    snippet?: string;
};
export type Citation = {
    url: string;
    title?: string;
    startIndex?: number;
    endIndex?: number;
    type?: string;
};
export type HostedSearchCall = {
    kind: "web_search" | "x_search";
    phase: "in_progress" | "searching" | "completed" | "failed";
    itemId?: string;
    outputIndex?: number;
    query?: string;
    sources?: HostedSearchSource[];
    error?: HostedSearchError;
};
export type HostedSearchError = {
    code?: string;
    message: string;
};
export declare function nativeSearchFromUnknown(value: unknown): NativeSearchCapability | undefined;
export declare function nativeSearchOfModel(model: {
    capabilities?: unknown;
} | undefined): NativeSearchCapability | undefined;
export declare function hidesGenericWebSearch(capability: NativeSearchCapability | undefined): boolean;
export declare function hostedWebSearchTool(domains?: NativeSearchDomainPolicy): HostedWebSearchTool;
export declare function hostedSearchToolsOf(capability: NativeSearchCapability | undefined): HostedSearchTool[];
export declare function mergeHostedSearchTools(existing: unknown, capability: NativeSearchCapability | undefined): unknown[];
export declare function applyHostedSearchToPayload(payload: Record<string, unknown>, capability: NativeSearchCapability | undefined): Record<string, unknown>;
export declare function normalizeResponsesUsage(usage: unknown): NormalizedUsage | undefined;
export declare function interpretResponsesError(event: unknown): HostedSearchError | undefined;
export declare function extractInlineCitations(text: unknown): Citation[];
export declare function citationsFromUnknown(value: unknown): Citation[];
export declare function interpretCitations(event: unknown): Citation[];
export declare function interpretHostedSearchEvent(event: unknown): HostedSearchCall | undefined;
export declare function collectResponsesStream(events: readonly unknown[]): {
    searches: HostedSearchCall[];
    citations: Citation[];
    error?: HostedSearchError;
    usage?: NormalizedUsage;
};
