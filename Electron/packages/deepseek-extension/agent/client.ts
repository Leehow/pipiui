/**
 * DeepSeek API client: Chat Completions + Responses.
 *
 * Both endpoints are stateless — every call replays the full conversation.
 * Do not send `previous_response_id`. Image + JSON rewrites run before POST.
 */

import { resolveBaseUrl, resolveDeepSeekConfig } from "./config.js";
import { defaultFileIdCache, FileIdCache } from "./files/cache.js";
import { FilesImageChannel } from "./files/channel.js";
import { DeepSeekFilesClient } from "./files/client.js";
import {
  assertRequestBodySize,
  rewritePayloadImages,
  rewritePayloadImagesAsync,
  type ImageSizeLimits,
} from "./images.js";
import { rewriteJsonOutput } from "./json-output.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${resolveBaseUrl(baseUrl)}/chat/completions`;
}

export function responsesUrl(baseUrl: string): string {
  return `${resolveBaseUrl(baseUrl)}/responses`;
}

/** Drop stateful Responses fields so every request is a full replay. */
export function withoutStatefulFields<T extends Record<string, unknown>>(body: T): T {
  if (!("previous_response_id" in body)) return body;
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
const LOCAL_SEARCH_FUNCTION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "web_search",
  "browser_search",
  "browser_fetch",
]);

function isBuiltinWebSearchTool(tool: unknown): boolean {
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
function isLocalSearchFunctionTool(tool: unknown): boolean {
  if (!isRecord(tool) || tool.type !== "function") return false;
  if (typeof tool.name === "string") return LOCAL_SEARCH_FUNCTION_TOOL_NAMES.has(tool.name);
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
export function mergeHostedWebSearchTool<T>(payload: T, supported: boolean): T {
  if (!supported || !isRecord(payload)) return payload;
  if (!Array.isArray(payload.tools)) {
    return { ...payload, tools: [{ ...DEEPSEEK_WEB_SEARCH_BUILTIN }] };
  }
  const tools: unknown[] = [];
  let hasBuiltin = false;
  for (const tool of payload.tools) {
    if (isLocalSearchFunctionTool(tool)) continue;
    if (isBuiltinWebSearchTool(tool)) {
      if (!hasBuiltin) {
        tools.push({ ...DEEPSEEK_WEB_SEARCH_BUILTIN });
        hasBuiltin = true;
      }
      continue;
    }
    tools.push(tool);
  }
  if (!hasBuiltin) tools.push({ ...DEEPSEEK_WEB_SEARCH_BUILTIN });
  return { ...payload, tools };
}

export function rewriteDeepSeekPayload<T>(payload: T): T {
  const withImages = rewritePayloadImages(payload);
  const withJson = rewriteJsonOutput(withImages);
  const next = isRecord(withJson) ? withoutStatefulFields(withJson) : withJson;
  assertRequestBodySize(next);
  return next as T;
}

function filesChannelFrom(options: FilesRewriteOptions & { apiKey?: string; baseUrl?: string }): FilesImageChannel {
  if (options.files) return options.files;
  const client =
    options.filesClient ??
    new DeepSeekFilesClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
    });
  return new FilesImageChannel(client, options.fileCache ?? defaultFileIdCache());
}

export async function rewriteDeepSeekPayloadAsync<T>(
  payload: T,
  options: FilesRewriteOptions & { apiKey?: string; baseUrl?: string } = {},
): Promise<T> {
  const withImages = await rewritePayloadImagesAsync(payload, {
    files: options.files,
    limits: options.limits,
    signal: options.signal,
    resolveFiles: () => filesChannelFrom(options),
  });
  const withJson = rewriteJsonOutput(withImages);
  const next = isRecord(withJson) ? withoutStatefulFields(withJson) : withJson;
  assertRequestBodySize(next);
  return next as T;
}

function requireModelId(model: string): string {
  const id = model.trim();
  if (!id) throw new Error("缺少 DeepSeek 模型 id");
  return id;
}

function rawChatCompletionsBody(input: {
  model: string;
  messages: unknown;
  stream?: boolean;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    model: requireModelId(input.model),
    messages: input.messages,
    stream: input.stream ?? true,
    ...(input.extra ?? {}),
  };
}

function rawResponsesBody(input: {
  model: string;
  input: unknown;
  instructions?: string;
  stream?: boolean;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    model: requireModelId(input.model),
    input: input.input,
    stream: input.stream ?? true,
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    ...(input.extra ?? {}),
  };
}

export function buildChatCompletionsBody(input: {
  model: string;
  messages: unknown;
  stream?: boolean;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return rewriteDeepSeekPayload(rawChatCompletionsBody(input));
}

export async function buildChatCompletionsBodyAsync(
  input: {
    model: string;
    messages: unknown;
    stream?: boolean;
    extra?: Record<string, unknown>;
  } & FilesRewriteOptions & { apiKey?: string; baseUrl?: string },
): Promise<Record<string, unknown>> {
  return rewriteDeepSeekPayloadAsync(rawChatCompletionsBody(input), input);
}

export function buildResponsesBody(input: {
  model: string;
  input: unknown;
  instructions?: string;
  stream?: boolean;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return rewriteDeepSeekPayload(rawResponsesBody(input));
}

export async function buildResponsesBodyAsync(
  input: {
    model: string;
    input: unknown;
    instructions?: string;
    stream?: boolean;
    extra?: Record<string, unknown>;
  } & FilesRewriteOptions & { apiKey?: string; baseUrl?: string },
): Promise<Record<string, unknown>> {
  return rewriteDeepSeekPayloadAsync(rawResponsesBody(input), input);
}

export type DeepSeekRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

const MISSING_KEY = "未配置 DeepSeek API key — 请先 /login deepseek 或在设置中填写 ext.deepseek.apiKey";

function requireApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) throw new Error(MISSING_KEY);
  return key;
}

function requestEnvelope(input: {
  endpoint: DeepSeekEndpoint;
  apiKey: string;
  baseUrl?: string;
  body: Record<string, unknown>;
}): DeepSeekRequest {
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

export function buildDeepSeekRequest(input: {
  endpoint: DeepSeekEndpoint;
  model: string;
  apiKey: string;
  baseUrl?: string;
  messages?: unknown;
  input?: unknown;
  instructions?: string;
  stream?: boolean;
  extra?: Record<string, unknown>;
}): DeepSeekRequest {
  const body =
    input.endpoint === "responses"
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

export async function buildDeepSeekRequestAsync(
  input: {
    endpoint: DeepSeekEndpoint;
    model: string;
    apiKey: string;
    baseUrl?: string;
    messages?: unknown;
    input?: unknown;
    instructions?: string;
    stream?: boolean;
    extra?: Record<string, unknown>;
  } & FilesRewriteOptions,
): Promise<DeepSeekRequest> {
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
  const body =
    input.endpoint === "responses"
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
  readonly baseUrl: string;
  readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly filesClient?: DeepSeekFilesClient;
  private readonly fileCache: FileIdCache;

  constructor(options: DeepSeekClientOptions = {}) {
    const cfg = resolveDeepSeekConfig({ baseUrl: options.baseUrl, apiKey: options.apiKey });
    this.baseUrl = cfg.baseUrl;
    this.apiKey = cfg.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.filesClient = options.filesClient;
    this.fileCache = options.fileCache ?? defaultFileIdCache();
  }

  request(input: {
    endpoint: DeepSeekEndpoint;
    model: string;
    apiKey?: string;
    messages?: unknown;
    input?: unknown;
    instructions?: string;
    stream?: boolean;
    extra?: Record<string, unknown>;
  }): DeepSeekRequest {
    return buildDeepSeekRequest({
      ...input,
      apiKey: input.apiKey ?? this.apiKey ?? "",
      baseUrl: this.baseUrl,
    });
  }

  async requestAsync(
    input: {
      endpoint: DeepSeekEndpoint;
      model: string;
      apiKey?: string;
      messages?: unknown;
      input?: unknown;
      instructions?: string;
      stream?: boolean;
      extra?: Record<string, unknown>;
      limits?: ImageSizeLimits;
    },
    signal?: AbortSignal,
  ): Promise<DeepSeekRequest> {
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

  async post(
    input: {
      endpoint: DeepSeekEndpoint;
      model: string;
      apiKey?: string;
      messages?: unknown;
      input?: unknown;
      instructions?: string;
      stream?: boolean;
      extra?: Record<string, unknown>;
      limits?: ImageSizeLimits;
    },
    signal?: AbortSignal,
  ): Promise<Response> {
    const req = await this.requestAsync(input, signal);
    return this.fetchImpl(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal,
    });
  }
}
