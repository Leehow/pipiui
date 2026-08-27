/**
 * DeepSeek API client: Chat Completions + Responses.
 *
 * Both endpoints are stateless — every call replays the full conversation.
 * Do not send `previous_response_id`. Image + JSON rewrites run before POST.
 */
import { FileIdCache } from "./files/cache.js";
import { FilesImageChannel } from "./files/channel.js";
import { DeepSeekFilesClient } from "./files/client.js";
import { type ImageSizeLimits } from "./images.js";
export type DeepSeekEndpoint = "chat.completions" | "responses";
export type FilesRewriteOptions = {
    files?: FilesImageChannel;
    filesClient?: DeepSeekFilesClient;
    fileCache?: FileIdCache;
    limits?: ImageSizeLimits;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
};
export type DeepSeekClientOptions = {
    baseUrl?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    filesClient?: DeepSeekFilesClient;
    fileCache?: FileIdCache;
};
export type ConversationTurn = {
    role: string;
    content: unknown;
    [key: string]: unknown;
};
export declare function chatCompletionsUrl(baseUrl: string): string;
export declare function responsesUrl(baseUrl: string): string;
/** Drop stateful Responses fields so every request is a full replay. */
export declare function withoutStatefulFields<T extends Record<string, unknown>>(body: T): T;
/** Official DeepSeek Responses built-in tool: server-executed web search. */
export declare const DEEPSEEK_WEB_SEARCH_BUILTIN: Readonly<{
    type: "web_search";
}>;
/**
 * Capability-gated enablement of DeepSeek server-native search on the Responses
 * path: inject the official built-in `{type:"web_search"}` exactly once, strip
 * every local search function tool (`web_search`, `browser_search`,
 * `browser_fetch`) so a stale spawn's tool list can never leak them to the
 * wire, and preserve every other tool. Unsupported models are returned
 * untouched — search support is never pretended.
 */
export declare function mergeHostedWebSearchTool<T>(payload: T, supported: boolean): T;
export declare function rewriteDeepSeekPayload<T>(payload: T): T;
export declare function rewriteDeepSeekPayloadAsync<T>(payload: T, options?: FilesRewriteOptions & {
    apiKey?: string;
    baseUrl?: string;
}): Promise<T>;
export declare function buildChatCompletionsBody(input: {
    model: string;
    messages: unknown;
    stream?: boolean;
    extra?: Record<string, unknown>;
}): Record<string, unknown>;
export declare function buildChatCompletionsBodyAsync(input: {
    model: string;
    messages: unknown;
    stream?: boolean;
    extra?: Record<string, unknown>;
} & FilesRewriteOptions & {
    apiKey?: string;
    baseUrl?: string;
}): Promise<Record<string, unknown>>;
export declare function buildResponsesBody(input: {
    model: string;
    input: unknown;
    instructions?: string;
    stream?: boolean;
    extra?: Record<string, unknown>;
}): Record<string, unknown>;
export declare function buildResponsesBodyAsync(input: {
    model: string;
    input: unknown;
    instructions?: string;
    stream?: boolean;
    extra?: Record<string, unknown>;
} & FilesRewriteOptions & {
    apiKey?: string;
    baseUrl?: string;
}): Promise<Record<string, unknown>>;
export type DeepSeekRequest = {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
};
export declare function buildDeepSeekRequest(input: {
    endpoint: DeepSeekEndpoint;
    model: string;
    apiKey: string;
    baseUrl?: string;
    messages?: unknown;
    input?: unknown;
    instructions?: string;
    stream?: boolean;
    extra?: Record<string, unknown>;
}): DeepSeekRequest;
export declare function buildDeepSeekRequestAsync(input: {
    endpoint: DeepSeekEndpoint;
    model: string;
    apiKey: string;
    baseUrl?: string;
    messages?: unknown;
    input?: unknown;
    instructions?: string;
    stream?: boolean;
    extra?: Record<string, unknown>;
} & FilesRewriteOptions): Promise<DeepSeekRequest>;
export declare class DeepSeekClient {
    readonly baseUrl: string;
    readonly apiKey?: string;
    private readonly fetchImpl;
    private readonly filesClient?;
    private readonly fileCache;
    constructor(options?: DeepSeekClientOptions);
    request(input: {
        endpoint: DeepSeekEndpoint;
        model: string;
        apiKey?: string;
        messages?: unknown;
        input?: unknown;
        instructions?: string;
        stream?: boolean;
        extra?: Record<string, unknown>;
    }): DeepSeekRequest;
    requestAsync(input: {
        endpoint: DeepSeekEndpoint;
        model: string;
        apiKey?: string;
        messages?: unknown;
        input?: unknown;
        instructions?: string;
        stream?: boolean;
        extra?: Record<string, unknown>;
        limits?: ImageSizeLimits;
    }, signal?: AbortSignal): Promise<DeepSeekRequest>;
    post(input: {
        endpoint: DeepSeekEndpoint;
        model: string;
        apiKey?: string;
        messages?: unknown;
        input?: unknown;
        instructions?: string;
        stream?: boolean;
        extra?: Record<string, unknown>;
        limits?: ImageSizeLimits;
    }, signal?: AbortSignal): Promise<Response>;
}
