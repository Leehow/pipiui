// DeepSeek hosted search runs on the Responses API as `{ type: "web_search" }`.
// Docs: https://api-docs.deepseek.com/zh-cn/api/create-response/
//
// Unlike the xAI sibling, DeepSeek has no prompt_cache_key / conv-id pin:
// caching is automatic and prefix-based. This file remaps the deepseek
// catalog onto openai-responses (session_start), rewrites Completions
// bodies + /chat/completions URLs onto /responses, injects hosted
// web_search, and tees the Responses stream so citations reach the host.
import { writeSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isLocalSearchFunctionTool } from "./hosted-search-exclusion.ts";

export type Citation = {
  url: string;
  title?: string;
  startIndex?: number;
  endIndex?: number;
  type?: string;
};

const INLINE_CITATION_RE = /\[\[(\d+)\]\]\((https?:\/\/[^\s)]+)\)/g;

const DEEPSEEK_WEB_SEARCH_TOOL = { type: "web_search" } as const;
const DEEPSEEK_RESPONSES_API = "openai-responses";
const ORIGINAL_FETCH = Symbol.for("pipiui.deepseek.originalFetch");
const FORCE_WEB_SEARCH_CHOICE = { type: "web_search" } as const;
const FORCE_SETTING_KEYS = ["ext.deepseek.forceWebSearch", "ext.deepseek.toolChoice"] as const;
const INPUT_ITEM_TYPES = new Set([
  "message",
  "function_call",
  "function_call_output",
  "web_search_call",
  "reasoning",
  "custom_tool_call",
  "custom_tool_call_output",
]);

export type DeepSeekRewriteOptions = {
  forceWebSearch?: boolean;
};

export type ProviderPayload = {
  model?: string;
  input?: unknown;
  messages?: unknown;
  instructions?: unknown;
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

const DEEPSEEK_HOSTED_SEARCH_PROVIDERS = new Set(["deepseek", "deepseek-extended"]);

export function isDeepSeekProvider(model: { provider?: string } | undefined): boolean {
  return DEEPSEEK_HOSTED_SEARCH_PROVIDERS.has((model?.provider || "").toLowerCase());
}

export function isResponsesPayload(payload: unknown): payload is ProviderPayload {
  return isRecord(payload) && Array.isArray(payload.input);
}

export function isChatCompletionsPayload(payload: unknown): payload is ProviderPayload {
  return isRecord(payload) && Array.isArray(payload.messages) && !Array.isArray(payload.input);
}

function isHostedWebSearchTool(tool: Record<string, unknown>): boolean {
  return tool.type === "web_search" && tool.function === undefined && (typeof tool.name !== "string" || tool.name === "web_search");
}

function flattenFunctionTool(tool: Record<string, unknown>): Record<string, unknown> {
  if (tool.type !== "function" || !isRecord(tool.function)) return tool;
  const fn = tool.function;
  const name = stringOf(fn.name);
  if (!name) return tool;
  const next: Record<string, unknown> = { type: "function", name };
  if (typeof fn.description === "string") next.description = fn.description;
  if (fn.parameters !== undefined) next.parameters = fn.parameters;
  return next;
}

/** Drop local search function tools and ensure a single hosted `{ type: "web_search" }`. */
export function mergeHostedWebSearch(existing: unknown): unknown[] {
  const current = Array.isArray(existing) ? existing : [];
  const filtered: unknown[] = [];
  let hasHosted = false;
  for (const tool of current) {
    if (!isRecord(tool)) {
      filtered.push(tool);
      continue;
    }
    if (isHostedWebSearchTool(tool)) {
      if (!hasHosted) {
        filtered.push({ ...DEEPSEEK_WEB_SEARCH_TOOL });
        hasHosted = true;
      }
      continue;
    }
    // Hosted exclusivity: strip every PipiUI local search function tool
    // (web_search, browser_search, browser_fetch) so the hosted built-in is
    // the only search channel; keep every other tool.
    if (isLocalSearchFunctionTool(tool)) continue;
    filtered.push(flattenFunctionTool(tool));
  }
  if (!hasHosted) filtered.push({ ...DEEPSEEK_WEB_SEARCH_TOOL });
  return filtered;
}

function coerceForceWebSearch(value: unknown): boolean {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === "web_search") return true;
  return isRecord(value) && value.type === "web_search";
}

export function forceWebSearchFromSettings(settings: unknown): boolean {
  if (!isRecord(settings)) return false;
  const getter = typeof settings.get === "function" ? settings.get.bind(settings) : undefined;
  for (const key of FORCE_SETTING_KEYS) {
    const value = getter ? getter(key) : settings[key];
    if (coerceForceWebSearch(value)) return true;
  }
  return false;
}

export function forceWebSearchFromContext(ctx: unknown): boolean {
  if (isRecord(ctx) && forceWebSearchFromSettings(ctx.settings)) return true;
  return coerceForceWebSearch(process.env.PIPIUI_DEEPSEEK_FORCE_WEB_SEARCH);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      return stringOf(part.text) ?? stringOf(part.output) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function mapContentParts(content: unknown, role: string): unknown[] {
  const asOutput = role === "assistant";
  const textType = asOutput ? "output_text" : "input_text";
  if (typeof content === "string") {
    return content ? [{ type: textType, text: content }] : [];
  }
  if (!Array.isArray(content)) {
    if (content == null) return [];
    return [{ type: textType, text: String(content) }];
  }
  const parts: unknown[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part) parts.push({ type: textType, text: part });
      continue;
    }
    if (!isRecord(part)) continue;
    const type = typeof part.type === "string" ? part.type : "";
    if (type === "input_text" || type === "output_text" || type === "input_image" || type === "output_image") {
      parts.push(part);
      continue;
    }
    if (type === "text" || type === "input_text" || part.text !== undefined && !type) {
      const text = stringOf(part.text);
      if (text) parts.push({ type: textType, text });
      continue;
    }
    if (type === "image" || type === "image_url" || type === "input_image") {
      // Files API file_id is out of scope this phase; only URL / data-URL images.
      let imageUrl = typeof part.image_url === "string"
        ? part.image_url
        : isRecord(part.image_url)
          ? stringOf(part.image_url.url)
          : stringOf(part.url);
      if (!imageUrl && type === "image" && typeof part.data === "string") {
        const mime = stringOf(part.mimeType) || "image/png";
        const raw = part.data.trim();
        imageUrl = raw.startsWith("data:") ? raw : `data:${mime};base64,${raw}`;
      }
      if (!imageUrl) continue;
      const image: Record<string, unknown> = { type: "input_image", image_url: imageUrl };
      const detail = isRecord(part.image_url) ? stringOf(part.image_url.detail) : stringOf(part.detail);
      if (detail) image.detail = detail;
      parts.push(image);
    }
  }
  return parts;
}

function parseQuery(argumentsJson: unknown): string | undefined {
  if (typeof argumentsJson !== "string") return undefined;
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return isRecord(parsed) ? stringOf(parsed.query) ?? stringOf(parsed.q) : undefined;
  } catch {
    return undefined;
  }
}

function mapToolCall(call: unknown): Record<string, unknown> | undefined {
  if (!isRecord(call)) return undefined;
  const fn = isRecord(call.function) ? call.function : call;
  const name = stringOf(fn.name) ?? stringOf(call.name);
  const callId = stringOf(call.call_id) ?? stringOf(call.id) ?? stringOf(fn.id);
  if (!name) return undefined;
  const args = typeof fn.arguments === "string"
    ? fn.arguments
    : typeof call.arguments === "string"
      ? call.arguments
      : fn.arguments !== undefined
        ? JSON.stringify(fn.arguments)
        : "{}";
  if (name === "web_search") {
    const query = parseQuery(args);
    return {
      type: "web_search_call",
      ...(callId ? { id: callId } : {}),
      status: "completed",
      action: {
        type: "search",
        ...(query ? { query } : {}),
      },
    };
  }
  return {
    type: "function_call",
    ...(callId ? { call_id: callId } : {}),
    name,
    arguments: args,
  };
}

function mapChatMessage(message: unknown): unknown[] {
  if (!isRecord(message)) return [];
  if (typeof message.type === "string" && INPUT_ITEM_TYPES.has(message.type)) {
    return [message];
  }
  const role = typeof message.role === "string" ? message.role : "user";
  if (role === "tool") {
    const callId = stringOf(message.tool_call_id) ?? stringOf(message.call_id);
    return [{
      type: "function_call_output",
      ...(callId ? { call_id: callId } : {}),
      output: contentText(message.content),
    }];
  }
  const items: unknown[] = [];
  const parts = mapContentParts(message.content, role);
  if (parts.length) {
    items.push({
      type: "message",
      role,
      content: parts,
    });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    const mapped = mapToolCall(call);
    if (mapped) items.push(mapped);
  }
  return items;
}

/**
 * Lift leading system/developer turns into `instructions` so the cached
 * prefix stays a stable blob. Later system turns stay in `input`.
 */
export function mapChatCompletionsToResponses(payload: ProviderPayload): ProviderPayload {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const input: unknown[] = [];
  const instructionParts: string[] = [];
  let lifting = !stringOf(payload.instructions);

  for (const message of messages) {
    if (isRecord(message) && typeof message.type === "string" && INPUT_ITEM_TYPES.has(message.type)) {
      lifting = false;
      input.push(message);
      continue;
    }
    const role = isRecord(message) && typeof message.role === "string" ? message.role : "";
    if (lifting && (role === "system" || role === "developer")) {
      const text = contentText(isRecord(message) ? message.content : undefined);
      if (text) instructionParts.push(text);
      continue;
    }
    lifting = false;
    input.push(...mapChatMessage(message));
  }

  const next: ProviderPayload = { ...payload, input };
  delete next.messages;

  const instructions = stringOf(payload.instructions) ?? (instructionParts.length ? instructionParts.join("\n\n") : undefined);
  if (instructions) next.instructions = instructions;

  if (next.max_output_tokens === undefined && typeof next.max_tokens === "number") {
    next.max_output_tokens = next.max_tokens;
  }
  delete next.max_tokens;

  if (!isRecord(next.text) && isRecord(next.response_format)) {
    next.text = { format: next.response_format };
  }
  delete next.response_format;

  if (isRecord(next.tool_choice) && isRecord(next.tool_choice.function) && next.tool_choice.type === "function") {
    const name = stringOf(next.tool_choice.function.name);
    next.tool_choice = name ? { type: "function", name } : next.tool_choice;
  }

  return next;
}

export function rewriteChatCompletionsUrlToResponses(url: unknown): string | undefined {
  if (typeof url !== "string" || !url.trim()) return undefined;
  try {
    const parsed = new URL(url);
    if (!/\/chat\/completions\/?$/.test(parsed.pathname)) return undefined;
    parsed.pathname = parsed.pathname.replace(/\/chat\/completions\/?$/, "/responses");
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

export function isResponsesRequestUrl(input: RequestInfo | URL | string): boolean {
  const url = typeof input === "string" || input instanceof URL || (typeof Request !== "undefined" && input instanceof Request)
    ? requestUrlOf(input)
    : "";
  try {
    return /\/responses\/?$/.test(new URL(url, "https://invalid.local").pathname);
  } catch {
    return /\/responses(?:\?|$)/.test(url);
  }
}

function remapDeepSeekModelsToResponses(models: unknown[]): unknown[] {
  return models.map((model) => {
    if (!isRecord(model)) return model;
    return { ...model, api: DEEPSEEK_RESPONSES_API };
  });
}

async function applyDeepSeekResponsesApi(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const registry = ctx.modelRegistry;
  if (!registry?.getProvider) return;
  const provider = registry.getProvider("deepseek");
  const models = provider?.getModels ? provider.getModels() : [];
  if (!Array.isArray(models) || models.length === 0) return;
  pi.registerProvider("deepseek", {
    api: DEEPSEEK_RESPONSES_API,
    models: remapDeepSeekModelsToResponses(models),
  });
}

let citationSink: ((citations: Citation[]) => void) | undefined;

function emitDeepSeekCitations(citations: Citation[]): void {
  if (!citations.length) return;
  if (citationSink) {
    citationSink(citations);
    return;
  }
  const line = `${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "citations", citations } })}\n`;
  try {
    writeSync(1, line);
  } catch {
    try {
      process.stdout.write(line);
    } catch {
      /* best-effort */
    }
  }
}

function parseSseFrame(part: string): unknown | undefined {
  const dataLines: string[] = [];
  for (const line of part.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return undefined;
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function parseResponsesSseChunk(chunk: string, pending = ""): { events: unknown[]; rest: string } {
  const text = `${pending}${chunk}`.replace(/\r\n/g, "\n");
  const parts = text.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: unknown[] = [];
  for (const part of parts) {
    const parsed = parseSseFrame(part);
    if (parsed !== undefined) events.push(parsed);
  }
  return { events, rest };
}

async function consumeCitationStream(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const seen = new Set<string>();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const parsed = parseResponsesSseChunk(decoder.decode(value, { stream: true }), pending);
      pending = parsed.rest;
      for (const event of parsed.events) {
        for (const citation of mapDeepSeekCitations(event)) {
          const key = `${citation.url}\0${citation.startIndex ?? ""}\0${citation.endIndex ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          emitDeepSeekCitations([citation]);
        }
      }
    }
  } catch {
    /* capture must never break the provider stream */
  }
}

export function installDeepSeekCitationCapture(
  target: { fetch: typeof fetch } = globalThis,
  sink?: (citations: Citation[]) => void,
): () => void {
  if (sink) citationSink = sink;
  const host = target as { fetch: typeof fetch } & Record<PropertyKey, unknown>;
  if (host[ORIGINAL_FETCH]) {
    return () => {
      const original = host[ORIGINAL_FETCH] as typeof fetch | undefined;
      if (original) host.fetch = original;
      delete host[ORIGINAL_FETCH];
      if (sink) citationSink = undefined;
    };
  }
  const originalFetch = host.fetch.bind(host);
  host[ORIGINAL_FETCH] = originalFetch;
  host.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const nextInput = typeof input === "string"
      ? (rewriteChatCompletionsUrlToResponses(input) ?? input)
      : input;
    const response = await originalFetch(nextInput, init);
    if (!isResponsesRequestUrl(nextInput) || !response.body) return response;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const [forClient, forUs] = response.body.tee();
      void consumeCitationStream(forUs);
      return new Response(forClient, response);
    }
    if (contentType.includes("application/json")) {
      try {
        emitDeepSeekCitations(mapDeepSeekCitations(await response.clone().json()));
      } catch {
        /* ignore non-JSON bodies */
      }
    }
    return response;
  }) as typeof fetch;
  return () => {
    host.fetch = originalFetch;
    delete host[ORIGINAL_FETCH];
    if (sink) citationSink = undefined;
  };
}

export function rewriteDeepSeekRequest(
  payload: unknown,
  options: DeepSeekRewriteOptions = {},
): ProviderPayload | undefined {
  if (!isRecord(payload)) return undefined;
  const base = isChatCompletionsPayload(payload)
    ? mapChatCompletionsToResponses(payload)
    : isResponsesPayload(payload)
      ? { ...payload }
      : undefined;
  if (!base) return undefined;

  const next: ProviderPayload = {
    ...base,
    tools: mergeHostedWebSearch(base.tools),
  };
  if (options.forceWebSearch) {
    next.tool_choice = { ...FORCE_WEB_SEARCH_CHOICE };
  }
  return next;
}

function citationFromUnknown(value: unknown): Citation | undefined {
  if (typeof value === "string") {
    const url = value.trim();
    return /^https?:\/\//i.test(url) ? { url } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const url = stringOf(value.url) ?? stringOf(value.uri) ?? stringOf(value.link);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  const title = stringOf(value.title) ?? stringOf(value.name);
  const startIndex = typeof value.start_index === "number"
    ? value.start_index
    : typeof value.startIndex === "number"
      ? value.startIndex
      : undefined;
  const endIndex = typeof value.end_index === "number"
    ? value.end_index
    : typeof value.endIndex === "number"
      ? value.endIndex
      : undefined;
  const type = stringOf(value.type);
  return {
    url,
    ...(title ? { title } : {}),
    ...(startIndex !== undefined ? { startIndex } : {}),
    ...(endIndex !== undefined ? { endIndex } : {}),
    ...(type ? { type } : {}),
  };
}

function citationsFromSources(value: unknown): Citation[] {
  if (!Array.isArray(value)) {
    const single = citationFromUnknown(value);
    return single ? [single] : [];
  }
  return value.map(citationFromUnknown).filter((item): item is Citation => Boolean(item));
}

function extractInlineCitations(text: unknown): Citation[] {
  if (typeof text !== "string" || !text.includes("[[")) return [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  INLINE_CITATION_RE.lastIndex = 0;
  for (const match of text.matchAll(INLINE_CITATION_RE)) {
    const url = match[2];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({ url, type: "url_citation" });
  }
  return citations;
}

function citationsFromMessageItem(item: Record<string, unknown>): Citation[] {
  const content = Array.isArray(item.content) ? item.content : [];
  const collected: Citation[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (Array.isArray(part.annotations)) collected.push(...citationsFromSources(part.annotations));
    collected.push(...extractInlineCitations(part.text));
  }
  return collected;
}

function citationsFromWebSearchItem(item: Record<string, unknown>): Citation[] {
  const action = isRecord(item.action) ? item.action : undefined;
  return [
    ...citationsFromSources(item.sources),
    ...citationsFromSources(item.results),
    ...citationsFromSources(action?.sources),
    ...citationsFromSources(action?.results),
  ];
}

function responseRecord(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body)) return undefined;
  if (Array.isArray(body.output) || body.object === "response" || Array.isArray(body.citations)) return body;
  if (isRecord(body.response)) return body.response;
  return undefined;
}

/** Map a DeepSeek Responses body (or SSE event list) onto pi `Citation`s. */
export function mapDeepSeekCitations(body: unknown): Citation[] {
  if (!body) return [];
  const events = Array.isArray(body) ? body : [body];
  const collected: Citation[] = [];
  for (const event of events) {
    const response = responseRecord(event);
    if (response) {
      collected.push(...citationsFromSources(response.citations));
      const output = Array.isArray(response.output) ? response.output : [];
      for (const item of output) {
        if (!isRecord(item)) continue;
        if (item.type === "web_search_call") collected.push(...citationsFromWebSearchItem(item));
        else collected.push(...citationsFromMessageItem(item));
      }
      continue;
    }
    if (!isRecord(event)) continue;
    if (event.type === "response.output_text.annotation.added") {
      collected.push(...citationsFromSources(event.annotation ?? event));
    }
    if (isRecord(event.item)) {
      if (event.item.type === "web_search_call") collected.push(...citationsFromWebSearchItem(event.item));
      else collected.push(...citationsFromMessageItem(event.item));
    }
  }
  const seen = new Set<string>();
  const merged: Citation[] = [];
  for (const citation of collected) {
    const key = `${citation.url}\0${citation.startIndex ?? ""}\0${citation.endIndex ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(citation);
  }
  return merged;
}

export function mapResponsesToChatCompletions(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body)) return undefined;
  const output = Array.isArray(body.output) ? body.output : [];
  const textParts: string[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === "message") {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const part of content) {
        if (isRecord(part) && (part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }
    if (item.type === "function_call") {
      const name = stringOf(item.name);
      const callId = stringOf(item.call_id) ?? stringOf(item.id);
      if (!name) continue;
      toolCalls.push({
        id: callId ?? `call_${toolCalls.length}`,
        type: "function",
        function: {
          name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
        },
      });
    }
  }
  const citations = mapDeepSeekCitations(body);
  const usage = isRecord(body.usage) ? body.usage : undefined;
  const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
  const cached = isRecord(usage?.input_tokens_details) && typeof usage.input_tokens_details.cached_tokens === "number"
    ? usage.input_tokens_details.cached_tokens
    : undefined;
  return {
    id: body.id,
    object: "chat.completion",
    model: body.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: textParts.join("") || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        ...(citations.length ? { citations } : {}),
      },
      finish_reason: toolCalls.length ? "tool_calls" : body.status === "incomplete" ? "length" : "stop",
    }],
    ...(usage
      ? {
        usage: {
          prompt_tokens: inputTokens ?? 0,
          completion_tokens: outputTokens ?? 0,
          total_tokens: typeof usage.total_tokens === "number"
            ? usage.total_tokens
            : (inputTokens ?? 0) + (outputTokens ?? 0),
          ...(cached !== undefined ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
        },
      }
      : {}),
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    return applyDeepSeekResponsesApi(pi, ctx).catch((error) => {
      console.error(
        `[pipiui-deepseek-server-tools] failed to remap DeepSeek models onto Responses: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!isDeepSeekProvider(ctx.model) || !isRecord(event.payload)) return;
    installDeepSeekCitationCapture();
    const next = rewriteDeepSeekRequest(event.payload, {
      forceWebSearch: forceWebSearchFromContext(ctx),
    });
    if (!next) return;
    const eventUrl = (event as { url?: unknown }).url;
    const rewrittenUrl = rewriteChatCompletionsUrlToResponses(eventUrl);
    if (rewrittenUrl) (event as { url?: string }).url = rewrittenUrl;
    return next;
  });

  pi.on("after_provider_response", (event, ctx) => {
    if (!isDeepSeekProvider(ctx.model)) return;
    installDeepSeekCitationCapture();
    const body = isRecord(event) ? event.body ?? event.response : undefined;
    const citations = mapDeepSeekCitations(body);
    emitDeepSeekCitations(citations);
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!isDeepSeekProvider(ctx.model)) return;
    const heading = "## DeepSeek server tools";
    if (event.systemPrompt.includes(heading)) return;
    const tip = [
      "",
      heading,
      "When the active model is any `deepseek` provider channel, DeepSeek Responses hosted search is enabled on every request:",
      "- `web_search` — live web search executed on DeepSeek (prefer over bash/curl and over client/pi-web-access web_search)",
      "Keep using local `read`/`bash`/`edit`/`write` for the workspace.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}${tip}` };
  });

  pi.registerCommand("deepseek-tools", {
    description: "Show whether DeepSeek hosted web_search is active",
    handler: async (_args, ctx) => {
      const model = ctx.model;
      const active = isDeepSeekProvider(model);
      const forced = forceWebSearchFromContext(ctx);
      const lines = [
        `model: ${model ? `${model.provider}/${model.id}` : "(none)"}`,
        `api: ${model?.api ?? "(none)"}`,
        active
          ? `DeepSeek server tools: ENABLED (Responses hosted web_search${forced ? ", tool_choice forced" : ""}).`
          : "inactive (need provider=deepseek)",
      ];
      ctx.ui.notify(lines.join("\n"), active ? "info" : "warning");
    },
  });
}
