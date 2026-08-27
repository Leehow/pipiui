/**
 * DeepSeek API client: Chat Completions + Responses.
 *
 * Both endpoints are stateless — every call replays the full conversation.
 * Do not send `previous_response_id`. Image + JSON rewrites run before POST.
 */
import { resolveBaseUrl, resolveDeepSeekConfig } from "./config.js";
import { defaultFileIdCache } from "./files/cache.js";
import { FilesImageChannel } from "./files/channel.js";
import { DeepSeekFilesClient } from "./files/client.js";
import { assertRequestBodySize, rewritePayloadImages, rewritePayloadImagesAsync, } from "./images.js";
import { rewriteJsonOutput } from "./json-output.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function chatCompletionsUrl(baseUrl) {
    return `${resolveBaseUrl(baseUrl)}/chat/completions`;
}
export function responsesUrl(baseUrl) {
    return `${resolveBaseUrl(baseUrl)}/responses`;
}
/** Drop stateful Responses fields so every request is a full replay. */
export function withoutStatefulFields(body) {
    if (!("previous_response_id" in body))
        return body;
    const next = { ...body };
    delete next.previous_response_id;
    return next;
}
/** Official DeepSeek Responses built-in tool: server-executed web search. */
export const DEEPSEEK_WEB_SEARCH_BUILTIN = Object.freeze({ type: "web_search" });
/**
 * Local tools whose job is taken over by the hosted built-in: the PipiUI
 * generic web search plus the browser-search route. Mirrors host-api's
 * `NATIVE_SEARCH_EXCLUDED_LOCAL_TOOLS` (kept there for spawn argv / UI
 * catalogs); enforced here so the outbound payload is clean even when a
 * session was spawned before those tools were hidden.
 */
const LOCAL_SEARCH_FUNCTION_TOOL_NAMES = new Set([
    "web_search",
    "browser_search",
    "browser_fetch",
]);
function isBuiltinWebSearchTool(tool) {
    return isRecord(tool) && tool.type === "web_search" && !isRecord(tool.function);
}
/**
 * True only for function tools whose exact name is a local search tool, in
 * either Responses shape (`{type:"function", name}`) or Chat Completions
 * shape (`{type:"function", function:{name}}`). Anything that is not a
 * function tool — built-ins (`type` only) and other typed tools such as
 * `{type:"custom", name:"web_search"}` — is never matched, however its name
 * reads; merely similar names (e.g. `web_search_preview`) never match either.
 */
function isLocalSearchFunctionTool(tool) {
    if (!isRecord(tool) || tool.type !== "function")
        return false;
    if (typeof tool.name === "string")
        return LOCAL_SEARCH_FUNCTION_TOOL_NAMES.has(tool.name);
    if (isRecord(tool.function)) {
        const { name } = tool.function;
        return typeof name === "string" && LOCAL_SEARCH_FUNCTION_TOOL_NAMES.has(name);
    }
    return false;
}
/**
 * Capability-gated enablement of DeepSeek server-native search on the Responses
 * path: inject the official built-in `{type:"web_search"}` exactly once, strip
 * every local search function tool (`web_search`, `browser_search`,
 * `browser_fetch`) so a stale spawn's tool list can never leak them to the
 * wire, and preserve every other tool. Unsupported models are returned
 * untouched — search support is never pretended.
 */
export function mergeHostedWebSearchTool(payload, supported) {
    if (!supported || !isRecord(payload))
        return payload;
    if (!Array.isArray(payload.tools)) {
        return { ...payload, tools: [{ ...DEEPSEEK_WEB_SEARCH_BUILTIN }] };
    }
    const tools = [];
    let hasBuiltin = false;
    for (const tool of payload.tools) {
        if (isLocalSearchFunctionTool(tool))
            continue;
        if (isBuiltinWebSearchTool(tool)) {
            if (!hasBuiltin) {
                tools.push({ ...DEEPSEEK_WEB_SEARCH_BUILTIN });
                hasBuiltin = true;
            }
            continue;
        }
        tools.push(tool);
    }
    if (!hasBuiltin)
        tools.push({ ...DEEPSEEK_WEB_SEARCH_BUILTIN });
    return { ...payload, tools };
}
export function rewriteDeepSeekPayload(payload) {
    const withImages = rewritePayloadImages(payload);
    const withJson = rewriteJsonOutput(withImages);
    const next = isRecord(withJson) ? withoutStatefulFields(withJson) : withJson;
    assertRequestBodySize(next);
    return next;
}
function filesChannelFrom(options) {
    if (options.files)
        return options.files;
    const client = options.filesClient ??
        new DeepSeekFilesClient({
            baseUrl: options.baseUrl,
            apiKey: options.apiKey,
            fetchImpl: options.fetchImpl,
        });
    return new FilesImageChannel(client, options.fileCache ?? defaultFileIdCache());
}
export async function rewriteDeepSeekPayloadAsync(payload, options = {}) {
    const withImages = await rewritePayloadImagesAsync(payload, {
        files: options.files,
        limits: options.limits,
        signal: options.signal,
        resolveFiles: () => filesChannelFrom(options),
    });
    const withJson = rewriteJsonOutput(withImages);
    const next = isRecord(withJson) ? withoutStatefulFields(withJson) : withJson;
    assertRequestBodySize(next);
    return next;
}
function requireModelId(model) {
    const id = model.trim();
    if (!id)
        throw new Error("缺少 DeepSeek 模型 id");
    return id;
}
function rawChatCompletionsBody(input) {
    return {
        model: requireModelId(input.model),
        messages: input.messages,
        stream: input.stream ?? true,
        ...(input.extra ?? {}),
    };
}
function rawResponsesBody(input) {
    return {
        model: requireModelId(input.model),
        input: input.input,
        stream: input.stream ?? true,
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.extra ?? {}),
    };
}
export function buildChatCompletionsBody(input) {
    return rewriteDeepSeekPayload(rawChatCompletionsBody(input));
}
export async function buildChatCompletionsBodyAsync(input) {
    return rewriteDeepSeekPayloadAsync(rawChatCompletionsBody(input), input);
}
export function buildResponsesBody(input) {
    return rewriteDeepSeekPayload(rawResponsesBody(input));
}
export async function buildResponsesBodyAsync(input) {
    return rewriteDeepSeekPayloadAsync(rawResponsesBody(input), input);
}
const MISSING_KEY = "未配置 DeepSeek API key — 请先 /login deepseek 或在设置中填写 ext.deepseek.apiKey";
function requireApiKey(apiKey) {
    const key = apiKey.trim();
    if (!key)
        throw new Error(MISSING_KEY);
    return key;
}
function requestEnvelope(input) {
    const apiKey = requireApiKey(input.apiKey);
    const baseUrl = resolveBaseUrl(input.baseUrl);
    return {
        url: input.endpoint === "responses" ? responsesUrl(baseUrl) : chatCompletionsUrl(baseUrl),
        headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
        },
        body: input.body,
    };
}
export function buildDeepSeekRequest(input) {
    const body = input.endpoint === "responses"
        ? buildResponsesBody({
            model: input.model,
            input: input.input ?? input.messages ?? [],
            instructions: input.instructions,
            stream: input.stream,
            extra: input.extra,
        })
        : buildChatCompletionsBody({
            model: input.model,
            messages: input.messages ?? input.input ?? [],
            stream: input.stream,
            extra: input.extra,
        });
    return requestEnvelope({ endpoint: input.endpoint, apiKey: input.apiKey, baseUrl: input.baseUrl, body });
}
export async function buildDeepSeekRequestAsync(input) {
    const filesOpts = {
        files: input.files,
        filesClient: input.filesClient,
        fileCache: input.fileCache,
        limits: input.limits,
        fetchImpl: input.fetchImpl,
        signal: input.signal,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
    };
    const body = input.endpoint === "responses"
        ? await buildResponsesBodyAsync({
            model: input.model,
            input: input.input ?? input.messages ?? [],
            instructions: input.instructions,
            stream: input.stream,
            extra: input.extra,
            ...filesOpts,
        })
        : await buildChatCompletionsBodyAsync({
            model: input.model,
            messages: input.messages ?? input.input ?? [],
            stream: input.stream,
            extra: input.extra,
            ...filesOpts,
        });
    return requestEnvelope({ endpoint: input.endpoint, apiKey: input.apiKey, baseUrl: input.baseUrl, body });
}
export class DeepSeekClient {
    baseUrl;
    apiKey;
    fetchImpl;
    filesClient;
    fileCache;
    constructor(options = {}) {
        const cfg = resolveDeepSeekConfig({ baseUrl: options.baseUrl, apiKey: options.apiKey });
        this.baseUrl = cfg.baseUrl;
        this.apiKey = cfg.apiKey;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.filesClient = options.filesClient;
        this.fileCache = options.fileCache ?? defaultFileIdCache();
    }
    request(input) {
        return buildDeepSeekRequest({
            ...input,
            apiKey: input.apiKey ?? this.apiKey ?? "",
            baseUrl: this.baseUrl,
        });
    }
    async requestAsync(input, signal) {
        return buildDeepSeekRequestAsync({
            ...input,
            apiKey: input.apiKey ?? this.apiKey ?? "",
            baseUrl: this.baseUrl,
            fetchImpl: this.fetchImpl,
            filesClient: this.filesClient,
            fileCache: this.fileCache,
            signal,
        });
    }
    async post(input, signal) {
        const req = await this.requestAsync(input, signal);
        return this.fetchImpl(req.url, {
            method: "POST",
            headers: req.headers,
            body: JSON.stringify(req.body),
            signal,
        });
    }
}
