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

export const NATIVE_SEARCH_TOOLS = ["web_search", "x_search"] as const;
export type NativeSearchToolName = (typeof NATIVE_SEARCH_TOOLS)[number];

export type NativeSearchDomainPolicy = {
  allow?: readonly string[];
  deny?: readonly string[];
};

export type NativeSearchCapability = {
  tools: readonly NativeSearchToolName[];
  domains?: NativeSearchDomainPolicy;
};

export const GROK_BUILD_NATIVE_SEARCH: NativeSearchCapability = {
  tools: ["web_search", "x_search"],
};

/** Official Responses cap for web_search domain lists. */
export const WEB_SEARCH_DOMAIN_LIMIT = 5;

export type HostedWebSearchTool = {
  type: "web_search";
  filters?: {
    allowed_domains?: string[];
    excluded_domains?: string[];
  };
};

export type HostedXSearchTool = { type: "x_search" };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueTrimmed(list: readonly string[] | undefined, limit: number): string[] | undefined {
  if (!list) return undefined;
  const next = [...new Set(list.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
  return next.length ? next : undefined;
}

export function nativeSearchFromUnknown(value: unknown): NativeSearchCapability | undefined {
  if (Array.isArray(value)) {
    const tools = value.filter((item): item is NativeSearchToolName =>
      item === "web_search" || item === "x_search",
    );
    const unique = [...new Set(tools)];
    return unique.length ? { tools: unique } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const rawTools = Array.isArray(value.tools) ? value.tools : undefined;
  if (!rawTools) return undefined;
  const tools = rawTools.filter((item): item is NativeSearchToolName =>
    item === "web_search" || item === "x_search",
  );
  const unique = [...new Set(tools)];
  if (!unique.length) return undefined;
  const capability: NativeSearchCapability = { tools: unique };
  if (isRecord(value.domains)) {
    const allow = uniqueTrimmed(
      Array.isArray(value.domains.allow)
        ? value.domains.allow.filter((item): item is string => typeof item === "string")
        : undefined,
      WEB_SEARCH_DOMAIN_LIMIT,
    );
    const deny = uniqueTrimmed(
      Array.isArray(value.domains.deny)
        ? value.domains.deny.filter((item): item is string => typeof item === "string")
        : undefined,
      WEB_SEARCH_DOMAIN_LIMIT,
    );
    if (allow || deny) capability.domains = { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}) };
  }
  return capability;
}

export function nativeSearchOfModel(model: { capabilities?: unknown } | undefined): NativeSearchCapability | undefined {
  if (!isRecord(model?.capabilities)) return undefined;
  return nativeSearchFromUnknown(model.capabilities.nativeSearch)
    ?? nativeSearchFromUnknown(model.capabilities.hostedTools);
}

export function hidesGenericWebSearch(capability: NativeSearchCapability | undefined): boolean {
  return capability?.tools.includes("web_search") === true;
}

export function hostedWebSearchTool(domains?: NativeSearchDomainPolicy): HostedWebSearchTool {
  const allow = uniqueTrimmed(domains?.allow ? [...domains.allow] : undefined, WEB_SEARCH_DOMAIN_LIMIT);
  const deny = uniqueTrimmed(domains?.deny ? [...domains.deny] : undefined, WEB_SEARCH_DOMAIN_LIMIT);
  if (!allow && !deny) return { type: "web_search" };
  return {
    type: "web_search",
    filters: {
      ...(allow ? { allowed_domains: allow } : {}),
      ...(deny ? { excluded_domains: deny } : {}),
    },
  };
}

export function hostedSearchToolsOf(capability: NativeSearchCapability | undefined): HostedSearchTool[] {
  if (!capability) return [];
  const tools: HostedSearchTool[] = [];
  if (capability.tools.includes("web_search")) {
    tools.push(hostedWebSearchTool(capability.domains));
  }
  if (capability.tools.includes("x_search")) {
    tools.push({ type: "x_search" });
  }
  return tools;
}

function isClientNamedTool(tool: Record<string, unknown>, name: string): boolean {
  if (tool.type === name && tool.function === undefined && (typeof tool.name !== "string" || tool.name === name)) {
    return false;
  }
  if (typeof tool.name === "string" && tool.name === name) return true;
  if (tool.type === "function") {
    const fn = isRecord(tool.function) ? tool.function : undefined;
    return typeof fn?.name === "string" && fn.name === name;
  }
  return false;
}

function isHostedTool(tool: Record<string, unknown>, type: NativeSearchToolName): boolean {
  return tool.type === type && tool.function === undefined && (typeof tool.name !== "string" || tool.name === type);
}

export function mergeHostedSearchTools(
  existing: unknown,
  capability: NativeSearchCapability | undefined,
): unknown[] {
  const current = Array.isArray(existing) ? [...existing] : [];
  const hosted = hostedSearchToolsOf(capability);
  const dropWeb = hidesGenericWebSearch(capability);
  const filtered = current.filter((tool) => {
    if (!isRecord(tool)) return true;
    if (dropWeb && isClientNamedTool(tool, "web_search")) return false;
    if (hosted.some((item) => isHostedTool(tool, item.type))) return false;
    return true;
  });
  return [...filtered, ...hosted];
}

export function applyHostedSearchToPayload(
  payload: Record<string, unknown>,
  capability: NativeSearchCapability | undefined,
): Record<string, unknown> {
  const next = { ...payload };
  if (Object.prototype.hasOwnProperty.call(next, "search_parameters")) {
    delete next.search_parameters;
  }
  if (capability) next.tools = mergeHostedSearchTools(next.tools, capability);
  return next;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeResponsesUsage(usage: unknown): NormalizedUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : undefined;
  const cached = numberOf(inputDetails?.cached_tokens);
  const cacheWrite = numberOf(inputDetails?.cache_write_tokens);
  const inputTokens = numberOf(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = numberOf(usage.output_tokens ?? usage.completion_tokens);
  const serverSide = isRecord(usage.server_side_tool_usage)
    ? Object.fromEntries(
      Object.entries(usage.server_side_tool_usage).filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ),
    )
    : undefined;
  return {
    input: Math.max(0, inputTokens - cached - cacheWrite),
    output: outputTokens,
    cacheRead: cached,
    cacheWrite,
    reasoning: numberOf(outputDetails?.reasoning_tokens),
    totalTokens: numberOf(usage.total_tokens) || inputTokens + outputTokens,
    ...(serverSide && Object.keys(serverSide).length ? { serverSideToolUsage: serverSide } : {}),
  };
}

function redactSecrets(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\b(at|rt)-[A-Za-z0-9._-]+/g, "[redacted]");
}

export function interpretResponsesError(event: unknown): HostedSearchError | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type === "error") {
    const message = typeof event.message === "string" && event.message.trim()
      ? event.message
      : "Unknown Responses error";
    return {
      ...(typeof event.code === "string" && event.code ? { code: event.code } : {}),
      message: redactSecrets(message),
    };
  }
  if (event.type === "response.failed") {
    const response = isRecord(event.response) ? event.response : undefined;
    const error = isRecord(response?.error) ? response.error : undefined;
    const details = isRecord(response?.incomplete_details) ? response.incomplete_details : undefined;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return {
        ...(typeof error.code === "string" && error.code ? { code: error.code } : {}),
        message: redactSecrets(error.message),
      };
    }
    if (typeof details?.reason === "string" && details.reason.trim()) {
      return { code: "incomplete", message: redactSecrets(details.reason) };
    }
    return { message: "Unknown error (no error details in response)" };
  }
  return undefined;
}

const SEARCH_EVENT_RE =
  /^response\.(web_search|x_search|x_keyword_search)_call\.(in_progress|searching|completed|failed)$/;
const INLINE_CITATION_RE = /\[\[(\d+)\]\]\((https?:\/\/[^\s)]+)\)/g;

function hostedKindOf(value: unknown): HostedSearchCall["kind"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "web_search" || normalized === "web_search_call") return "web_search";
  if (
    normalized === "x_search"
    || normalized === "x_search_call"
    || normalized === "x_keyword_search"
    || normalized === "x_keyword_search_call"
  ) return "x_search";
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function queryOf(record: Record<string, unknown>, item?: Record<string, unknown>): string | undefined {
  const action = isRecord(record.action) ? record.action : isRecord(item?.action) ? item.action : undefined;
  return firstString(
    record.query,
    action?.query,
    action?.q,
    item?.query,
    isRecord(record.arguments) ? record.arguments.query : undefined,
  );
}

function sourceFromUnknown(value: unknown): HostedSearchSource | undefined {
  if (typeof value === "string") {
    const url = value.trim();
    return /^https?:\/\//i.test(url) ? { url } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const url = firstString(value.url, value.uri, value.link);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  const title = firstString(value.title, value.name);
  const snippet = firstString(value.snippet, value.text, value.description);
  return { url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) };
}

function sourcesOf(record: Record<string, unknown>, item?: Record<string, unknown>): HostedSearchSource[] | undefined {
  const action = isRecord(record.action) ? record.action : isRecord(item?.action) ? item.action : undefined;
  const raw = [record.sources, action?.sources, item?.sources, record.results, action?.results]
    .find((value) => Array.isArray(value));
  if (!raw) return undefined;
  const sources = raw.map(sourceFromUnknown).filter((source): source is HostedSearchSource => Boolean(source));
  return sources.length ? sources : undefined;
}

function citationFromUnknown(value: unknown): Citation | undefined {
  if (typeof value === "string") {
    const url = value.trim();
    return /^https?:\/\//i.test(url) ? { url } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const url = firstString(value.url, value.uri, value.link);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  const title = firstString(value.title, value.name);
  const startIndex = typeof value.start_index === "number" ? value.start_index : typeof value.startIndex === "number" ? value.startIndex : undefined;
  const endIndex = typeof value.end_index === "number" ? value.end_index : typeof value.endIndex === "number" ? value.endIndex : undefined;
  const type = firstString(value.type);
  return {
    url,
    ...(title ? { title } : {}),
    ...(startIndex !== undefined ? { startIndex } : {}),
    ...(endIndex !== undefined ? { endIndex } : {}),
    ...(type ? { type } : {}),
  };
}

export function extractInlineCitations(text: unknown): Citation[] {
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

export function citationsFromUnknown(value: unknown): Citation[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(citationFromUnknown).filter((item): item is Citation => Boolean(item));
  }
  const single = citationFromUnknown(value);
  return single ? [single] : [];
}

function citationsFromMessageItem(item: Record<string, unknown>): Citation[] {
  const content = Array.isArray(item.content) ? item.content : [];
  const collected: Citation[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (Array.isArray(part.annotations)) collected.push(...citationsFromUnknown(part.annotations));
    collected.push(...extractInlineCitations(part.text));
  }
  return collected;
}

export function interpretCitations(event: unknown): Citation[] {
  if (!isRecord(event) || typeof event.type !== "string") return [];
  if (event.type === "response.output_text.annotation.added") {
    return citationsFromUnknown(event.annotation ?? event);
  }
  if (event.type === "response.output_item.done") {
    const item = isRecord(event.item) ? event.item : undefined;
    return item ? citationsFromMessageItem(item) : [];
  }
  if (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete") {
    const response = isRecord(event.response) ? event.response : undefined;
    const fromResponse = citationsFromUnknown(response?.citations ?? event.citations);
    const output = Array.isArray(response?.output) ? response.output : [];
    const fromOutput = output.flatMap((item) => isRecord(item) ? citationsFromMessageItem(item) : []);
    return [...fromResponse, ...fromOutput];
  }
  return [];
}

export function interpretHostedSearchEvent(event: unknown): HostedSearchCall | undefined {
  if (!isRecord(event) || typeof event.type !== "string") return undefined;
  const match = event.type.match(SEARCH_EVENT_RE);
  if (match) {
    const kind = hostedKindOf(match[1]);
    const phase = match[2] as HostedSearchCall["phase"];
    if (!kind) return undefined;
    const item = isRecord(event.item) ? event.item : undefined;
    return {
      kind,
      phase,
      ...(typeof event.item_id === "string" ? { itemId: event.item_id } : firstString(item?.id) ? { itemId: firstString(item?.id) } : {}),
      ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
      ...(queryOf(event, item) ? { query: queryOf(event, item) } : {}),
      ...(sourcesOf(event, item) ? { sources: sourcesOf(event, item) } : {}),
    };
  }

  if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
    const item = isRecord(event.item) ? event.item : undefined;
    const kind = hostedKindOf(item?.type) ?? hostedKindOf(item?.name);
    if (!kind || !item) return undefined;
    return {
      kind,
      phase: event.type === "response.output_item.done"
        ? (item.status === "failed" ? "failed" : "completed")
        : "in_progress",
      ...(firstString(item.id) ? { itemId: firstString(item.id) } : {}),
      ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
      ...(queryOf(event, item) ? { query: queryOf(event, item) } : {}),
      ...(sourcesOf(event, item) ? { sources: sourcesOf(event, item) } : {}),
    };
  }

  if (event.type === "response.custom_tool_call_input.done" || event.type === "response.custom_tool_call_input.delta") {
    const kind = hostedKindOf(event.name);
    if (!kind) return undefined;
    return {
      kind,
      phase: event.type.endsWith(".done") ? "completed" : "in_progress",
      ...(typeof event.item_id === "string" ? { itemId: event.item_id } : {}),
      ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
      ...(queryOf(event) ? { query: queryOf(event) } : {}),
    };
  }

  return undefined;
}

export function collectResponsesStream(events: readonly unknown[]): {
  searches: HostedSearchCall[];
  citations: Citation[];
  error?: HostedSearchError;
  usage?: NormalizedUsage;
} {
  const searches: HostedSearchCall[] = [];
  const citations: Citation[] = [];
  const seenCitations = new Set<string>();
  let error: HostedSearchError | undefined;
  let usage: NormalizedUsage | undefined;
  for (const event of events) {
    const search = interpretHostedSearchEvent(event);
    if (search) searches.push(search);
    for (const citation of interpretCitations(event)) {
      const exact = `${citation.url}\0${citation.startIndex ?? ""}\0${citation.endIndex ?? ""}`;
      if (seenCitations.has(exact) || seenCitations.has(citation.url)) continue;
      if (citation.startIndex === undefined && citation.endIndex === undefined && citations.some((item) => item.url === citation.url)) continue;
      seenCitations.add(exact);
      seenCitations.add(citation.url);
      citations.push(citation);
    }
    const nextError = interpretResponsesError(event);
    if (nextError && !error) error = nextError;
    if (isRecord(event) && (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete")) {
      const response = isRecord(event.response) ? event.response : undefined;
      const nextUsage = normalizeResponsesUsage(response?.usage ?? event.usage);
      if (nextUsage) usage = nextUsage;
    }
  }
  return { searches, citations, ...(error ? { error } : {}), ...(usage ? { usage } : {}) };
}
