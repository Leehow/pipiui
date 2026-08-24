import { writeSync } from "node:fs";
import {
  collectCodeInterpreterStream,
  interpretAndEmitCodeInterpreter,
  toHostedCodeInterpreterEvent,
  type HostedCodeInterpreterAssistantEvent,
  type HostedCodeInterpreterCall,
} from "./hosted-code-interpreter-events.ts";

/**
 * Production Responses hosted-search / citation / usage normalizer.
 *
 * Pi's openai-responses streamer ignores unknown SSE types, so hosted
 * `web_search` / `x_search` lifecycle and annotations never become
 * message_update events. This module is the live seam: parse raw
 * Responses events (or an SSE body), emit normalized assistant events,
 * and never invent sources or execute hosted search as a local tool.
 */

export type NativeSearchKind = "web_search" | "x_search";
export type HostedSearchPhase = "in_progress" | "searching" | "completed" | "failed";

export type HostedSearchError = {
  code?: string;
  message: string;
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

export type InputFileSource = {
  name: string;
  url?: string;
};

export type NormalizedUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
  serverSideToolUsage?: Record<string, number>;
};

export type HostedSearchCall = {
  kind: NativeSearchKind;
  phase: HostedSearchPhase;
  itemId?: string;
  outputIndex?: number;
  query?: string;
  sources?: HostedSearchSource[];
  error?: HostedSearchError;
};

export type HostedAssistantEvent =
  | {
    type: "hosted_search";
    callId: string;
    kind: NativeSearchKind;
    phase: HostedSearchPhase;
    query?: string;
    sources?: HostedSearchSource[];
    error?: HostedSearchError;
    outputIndex?: number;
  }
  | HostedCodeInterpreterAssistantEvent
  | { type: "citations"; citations: Citation[] }
  | { type: "input_file_sources"; sources: InputFileSource[] }
  | { type: "server_side_usage"; usage: NormalizedUsage };

export type HostedSearchSink = (event: HostedAssistantEvent) => void;

const SEARCH_EVENT_RE =
  /^response\.(web_search|x_search|x_keyword_search)_call\.(in_progress|searching|completed|failed)$/;
const INLINE_CITATION_RE = /\[\[(\d+)\]\]\((https?:\/\/[^\s)]+)\)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function redactSecrets(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\b(at|rt)-[A-Za-z0-9._-]+/g, "[redacted]");
}

export function hostedKindOf(value: unknown): NativeSearchKind | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "web_search" || normalized === "web_search_call") return "web_search";
  if (
    normalized === "x_search"
    || normalized === "x_search_call"
    || normalized === "x_keyword_search"
    || normalized === "x_keyword_search_call"
  ) {
    return "x_search";
  }
  return undefined;
}

function phaseOf(value: unknown): HostedSearchPhase | undefined {
  return value === "in_progress" || value === "searching" || value === "completed" || value === "failed"
    ? value
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const next = stringOf(value);
    if (next) return next;
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
  const title = stringOf(value.title) ?? stringOf(value.name);
  const snippet = stringOf(value.snippet) ?? stringOf(value.text) ?? stringOf(value.description);
  return {
    url,
    ...(title ? { title } : {}),
    ...(snippet ? { snippet } : {}),
  };
}

function sourcesOf(record: Record<string, unknown>, item?: Record<string, unknown>): HostedSearchSource[] | undefined {
  const action = isRecord(record.action) ? record.action : isRecord(item?.action) ? item.action : undefined;
  const raw = [record.sources, action?.sources, item?.sources, record.results, action?.results]
    .find((value) => Array.isArray(value));
  if (!raw) return undefined;
  const sources = raw.map(sourceFromUnknown).filter((source): source is HostedSearchSource => Boolean(source));
  return sources.length ? sources : undefined;
}

const FILE_SOURCE_NAME_MAX = 200;
const FALLBACK_FILE_NAME = "已上传文件";
const FILE_CITATION_TYPES = new Set(["file_citation", "input_file", "file"]);
const URL_CITATION_TYPES = new Set(["url_citation", "url", "web_citation"]);

type ExtractedFileSource = InputFileSource & { fileId?: string };

function looksLikeLocalPath(value: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/)|file:)/i.test(value) || value.includes("\\");
}

function httpsFileUrlOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed) || looksLikeLocalPath(trimmed)) return undefined;
  if (
    !/[?&](?:token|access_token|sig|signature|key|auth|authorization)=/i.test(trimmed)
    && !/[?&](?:access|container|file|download)[_-]?token=/i.test(trimmed)
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|sig|signature|key|auth/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function sanitizeInputFileSourceName(raw: unknown): string {
  if (typeof raw !== "string") return FALLBACK_FILE_NAME;
  const trimmed = raw.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim();
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\.+/, "");
  const clipped = cleaned.slice(0, FILE_SOURCE_NAME_MAX).trim();
  return clipped || FALLBACK_FILE_NAME;
}

function fileIdOf(value: Record<string, unknown>): string | undefined {
  return firstString(value.file_id, value.fileId);
}

function fileNameOf(value: Record<string, unknown>): string | undefined {
  return firstString(value.filename, value.file_name, value.fileName, value.name);
}

function citationTypeOf(value: Record<string, unknown>): string {
  return (stringOf(value.type) ?? "").trim().toLowerCase();
}

export function isExplicitFileCitation(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const type = citationTypeOf(value);
  if (URL_CITATION_TYPES.has(type)) return false;
  if (FILE_CITATION_TYPES.has(type)) return true;
  return !type && Boolean(fileIdOf(value) && fileNameOf(value));
}

function publicFileSource(source: ExtractedFileSource): InputFileSource {
  return {
    name: source.name,
    ...(source.url ? { url: source.url } : {}),
  };
}

function fileSourceKey(source: ExtractedFileSource): string {
  if (source.fileId) return `fileid:${source.fileId}`;
  return `file:${source.name}\0${source.url ?? ""}`;
}

function fileSourceFromUnknown(value: unknown): ExtractedFileSource | undefined {
  if (!isExplicitFileCitation(value)) return undefined;
  const name = sanitizeInputFileSourceName(fileNameOf(value));
  const url = httpsFileUrlOf(value.url ?? value.uri ?? value.link);
  const fileId = fileIdOf(value);
  return {
    name,
    ...(url ? { url } : {}),
    ...(fileId ? { fileId } : {}),
  };
}

function fileSourcesFromMessageItem(item: Record<string, unknown>): ExtractedFileSource[] {
  const collected: ExtractedFileSource[] = [];
  const push = (value: unknown) => {
    const source = fileSourceFromUnknown(value);
    if (source) collected.push(source);
  };
  push(item);
  if (Array.isArray(item.annotations)) {
    for (const annotation of item.annotations) push(annotation);
  }
  if (Array.isArray(item.citations)) {
    for (const citation of item.citations) push(citation);
  }
  const content = Array.isArray(item.content) ? item.content : [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    push(part);
    if (Array.isArray(part.annotations)) {
      for (const annotation of part.annotations) push(annotation);
    }
    if (Array.isArray(part.citations)) {
      for (const citation of part.citations) push(citation);
    }
  }
  return collected;
}

function citationFromUnknown(value: unknown): Citation | undefined {
  if (typeof value === "string") {
    const url = value.trim();
    return /^https?:\/\//i.test(url) ? { url } : undefined;
  }
  if (!isRecord(value) || isExplicitFileCitation(value)) return undefined;
  const url = firstString(value.url, value.uri, value.link);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  const title = stringOf(value.title) ?? stringOf(value.name);
  const startIndex = typeof value.start_index === "number" ? value.start_index : typeof value.startIndex === "number" ? value.startIndex : undefined;
  const endIndex = typeof value.end_index === "number" ? value.end_index : typeof value.endIndex === "number" ? value.endIndex : undefined;
  const type = stringOf(value.type);
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

function itemRecord(event: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(event.item) ? event.item : undefined;
}

function hostedKindFromItem(item: Record<string, unknown> | undefined): NativeSearchKind | undefined {
  if (!item) return undefined;
  return hostedKindOf(item.type) ?? hostedKindOf(item.name);
}

export function interpretHostedSearchEvent(event: unknown): HostedSearchCall | undefined {
  if (!isRecord(event) || typeof event.type !== "string") return undefined;
  const match = event.type.match(SEARCH_EVENT_RE);
  if (match) {
    const kind = hostedKindOf(match[1]);
    const phase = phaseOf(match[2]);
    if (!kind || !phase) return undefined;
    const item = itemRecord(event);
    return {
      kind,
      phase,
      ...(typeof event.item_id === "string" ? { itemId: event.item_id } : stringOf(item?.id) ? { itemId: stringOf(item.id) } : {}),
      ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
      ...(queryOf(event, item) ? { query: queryOf(event, item) } : {}),
      ...(sourcesOf(event, item) ? { sources: sourcesOf(event, item) } : {}),
    };
  }

  if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
    const item = itemRecord(event);
    const kind = hostedKindFromItem(item);
    if (!kind || !item) return undefined;
    const phase: HostedSearchPhase = event.type === "response.output_item.done"
      ? (item.status === "failed" ? "failed" : "completed")
      : "in_progress";
    return {
      kind,
      phase,
      ...(stringOf(item.id) ? { itemId: stringOf(item.id) } : {}),
      ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
      ...(queryOf(event, item) ? { query: queryOf(event, item) } : {}),
      ...(sourcesOf(event, item) ? { sources: sourcesOf(event, item) } : {}),
    };
  }

  if (
    event.type === "response.custom_tool_call_input.done"
    || event.type === "response.custom_tool_call_input.delta"
  ) {
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

export function interpretCitations(event: unknown): Citation[] {
  if (!isRecord(event) || typeof event.type !== "string") return [];
  if (event.type === "response.output_text.annotation.added") {
    return citationsFromUnknown(event.annotation ?? event);
  }
  if (event.type === "response.output_item.done") {
    const item = itemRecord(event);
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

export function interpretInputFileSources(event: unknown): ExtractedFileSource[] {
  if (!isRecord(event) || typeof event.type !== "string") return [];
  if (event.type === "response.output_text.annotation.added") {
    const source = fileSourceFromUnknown(event.annotation ?? event);
    return source ? [source] : [];
  }
  if (event.type === "response.output_item.done") {
    const item = itemRecord(event);
    return item ? fileSourcesFromMessageItem(item) : [];
  }
  if (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete") {
    const response = isRecord(event.response) ? event.response : undefined;
    const fromResponse = (Array.isArray(response?.citations) ? response.citations : Array.isArray(event.citations) ? event.citations : [])
      .flatMap((item) => {
        const source = fileSourceFromUnknown(item);
        return source ? [source] : [];
      });
    const output = Array.isArray(response?.output) ? response.output : [];
    const fromOutput = output.flatMap((item) => isRecord(item) ? fileSourcesFromMessageItem(item) : []);
    return [...fromResponse, ...fromOutput];
  }
  return [];
}

export function interpretResponsesUsageEvent(event: unknown): NormalizedUsage | undefined {
  if (!isRecord(event)) return undefined;
  if (event.type !== "response.completed" && event.type !== "response.done" && event.type !== "response.incomplete") {
    return undefined;
  }
  const response = isRecord(event.response) ? event.response : undefined;
  return normalizeResponsesUsage(response?.usage ?? event.usage);
}

export function hostedCallId(call: HostedSearchCall): string {
  if (call.itemId) return call.itemId;
  if (typeof call.outputIndex === "number") return `hosted-${call.kind}-${call.outputIndex}`;
  return `hosted-${call.kind}`;
}

export function toHostedAssistantEvent(call: HostedSearchCall): HostedAssistantEvent {
  return {
    type: "hosted_search",
    callId: hostedCallId(call),
    kind: call.kind,
    phase: call.phase,
    ...(call.query ? { query: call.query } : {}),
    ...(call.sources ? { sources: call.sources } : {}),
    ...(call.error ? { error: call.error } : {}),
    ...(typeof call.outputIndex === "number" ? { outputIndex: call.outputIndex } : {}),
  };
}

export function hostedSearchToolDelta(event: Extract<HostedAssistantEvent, { type: "hosted_search" }>): string {
  const payload: Record<string, unknown> = { phase: event.phase };
  if (event.query) payload.query = event.query;
  if (event.sources?.length) {
    payload.sources = event.sources.map((source) => ({
      url: source.url,
      ...(source.title ? { title: source.title } : {}),
    }));
  }
  if (event.error?.message) payload.error = event.error.message;
  return JSON.stringify(payload);
}

function citationSourceKey(citation: Citation): string {
  return citation.url;
}

function keepCitation(citation: Citation, seenUrls: Set<string>, into: Citation[]): void {
  const key = citationSourceKey(citation);
  if (seenUrls.has(key)) return;
  seenUrls.add(key);
  into.push(citation);
}

export function collectResponsesStream(events: readonly unknown[]): {
  searches: HostedSearchCall[];
  codeCalls: HostedCodeInterpreterCall[];
  citations: Citation[];
  fileSources: InputFileSource[];
  error?: HostedSearchError;
  usage?: NormalizedUsage;
} {
  const searches: HostedSearchCall[] = [];
  const citations: Citation[] = [];
  const fileSources: InputFileSource[] = [];
  const seenCitations = new Set<string>();
  const seenFileSources = new Set<string>();
  let error: HostedSearchError | undefined;
  let usage: NormalizedUsage | undefined;
  for (const event of events) {
    const search = interpretHostedSearchEvent(event);
    if (search) searches.push(search);
    for (const citation of interpretCitations(event)) {
      keepCitation(citation, seenCitations, citations);
    }
    for (const source of interpretInputFileSources(event)) {
      const key = fileSourceKey(source);
      if (seenFileSources.has(key)) continue;
      seenFileSources.add(key);
      fileSources.push(publicFileSource(source));
    }
    const nextError = interpretResponsesError(event);
    if (nextError && !error) error = nextError;
    const nextUsage = interpretResponsesUsageEvent(event);
    if (nextUsage) usage = nextUsage;
  }
  const collectedCode = collectCodeInterpreterStream(events);
  return {
    searches,
    codeCalls: collectedCode.calls,
    citations,
    fileSources,
    ...(error ? { error } : {}),
    ...(usage ? { usage } : {}),
  };
}

export async function* tapResponsesStream<T>(
  events: AsyncIterable<T> | Iterable<T>,
  onEvent: (event: T) => void,
): AsyncGenerator<T> {
  const iterable = Symbol.asyncIterator in Object(events)
    ? events as AsyncIterable<T>
    : (async function* emitSync() {
      for (const event of events as Iterable<T>) yield event;
    })();
  for await (const event of iterable) {
    onEvent(event);
    yield event;
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

export function parseResponsesSseChunk(chunk: string, pending = ""): { events: unknown[]; rest: string } {
  const text = `${pending}${chunk}`.replace(/\r\n/g, "\n");
  const parts = text.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: unknown[] = [];
  for (const part of parts) {
    const parsed = parseSseFrame(part);
    if (parsed !== undefined) events.push(parsed);
  }
  const trailing = parseSseFrame(rest.trim());
  if (trailing !== undefined) {
    events.push(trailing);
    return { events, rest: "" };
  }
  return { events, rest };
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "";
}

export function isResponsesRequest(input: RequestInfo | URL): boolean {
  const url = requestUrlOf(input);
  try {
    const parsed = new URL(url, "https://invalid.local");
    return /\/responses\/?$/.test(parsed.pathname);
  } catch {
    return /\/responses(?:\?|$)/.test(url);
  }
}

export function projectCollectedEvents(collected: ReturnType<typeof collectResponsesStream>): HostedAssistantEvent[] {
  const events: HostedAssistantEvent[] = [];
  const latestById = new Map<string, HostedSearchCall>();
  for (const search of collected.searches) latestById.set(hostedCallId(search), search);
  for (const search of collected.searches) events.push(toHostedAssistantEvent(search));
  if (collected.error) {
    const failed = [...latestById.values()].at(-1);
    events.push(toHostedAssistantEvent({
      kind: failed?.kind ?? "web_search",
      phase: "failed",
      itemId: failed?.itemId,
      outputIndex: failed?.outputIndex,
      query: failed?.query,
      error: collected.error,
    }));
  }
  for (const call of collected.codeCalls) events.push(toHostedCodeInterpreterEvent(call));
  if (collected.citations.length) events.push({ type: "citations", citations: collected.citations });
  if (collected.fileSources.length) events.push({ type: "input_file_sources", sources: collected.fileSources });
  if (collected.usage) events.push({ type: "server_side_usage", usage: collected.usage });
  return events;
}

export function interpretAndEmit(event: unknown, sink: HostedSearchSink, seenCitationKeys: Set<string>): void {
  interpretAndEmitCodeInterpreter(event, sink);
  const search = interpretHostedSearchEvent(event);
  if (search) sink(toHostedAssistantEvent(search));
  for (const citation of interpretCitations(event)) {
    const key = `cite:${citationSourceKey(citation)}`;
    if (seenCitationKeys.has(key)) continue;
    seenCitationKeys.add(key);
    sink({ type: "citations", citations: [citation] });
  }
  for (const source of interpretInputFileSources(event)) {
    const key = fileSourceKey(source);
    if (seenCitationKeys.has(key)) continue;
    seenCitationKeys.add(key);
    sink({ type: "input_file_sources", sources: [publicFileSource(source)] });
  }
  const usage = interpretResponsesUsageEvent(event);
  if (usage) sink({ type: "server_side_usage", usage });
  const error = interpretResponsesError(event);
  if (error && search) {
    sink(toHostedAssistantEvent({ ...search, phase: "failed", error }));
  } else if (error && isRecord(event) && event.type === "response.failed") {
    sink(toHostedAssistantEvent({
      kind: "web_search",
      phase: "failed",
      error,
    }));
  }
}

async function consumeSseStream(body: ReadableStream<Uint8Array>, sink: HostedSearchSink): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const seenCitationKeys = new Set<string>();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const parsed = parseResponsesSseChunk(decoder.decode(value, { stream: true }), pending);
      pending = parsed.rest;
      for (const event of parsed.events) interpretAndEmit(event, sink, seenCitationKeys);
    }
    if (pending.trim()) {
      const parsed = parseResponsesSseChunk("\n\n", pending);
      for (const event of parsed.events) interpretAndEmit(event, sink, seenCitationKeys);
    }
  } catch {
    /* capture must never break the provider stream */
  }
}

export function wrapFetchForHostedSearch(
  fetchImpl: typeof fetch,
  sink: HostedSearchSink,
): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!isResponsesRequest(input) || !response.body) return response;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const [forClient, forUs] = response.body.tee();
      void consumeSseStream(forUs, sink);
      return new Response(forClient, response);
    }
    if (contentType.includes("application/json")) {
      try {
        const cloned = response.clone();
        const body = await cloned.json();
        const events = Array.isArray(body)
          ? body
          : [{ type: "response.completed", response: body }];
        const seen = new Set<string>();
        for (const event of events) interpretAndEmit(event, sink, seen);
      } catch {
        /* ignore non-JSON bodies */
      }
    }
    return response;
  };
}

const ORIGINAL_FETCH = Symbol.for("pipiui.hostedSearch.originalFetch");
let defaultSink: HostedSearchSink | undefined;

export function setHostedSearchSink(sink: HostedSearchSink | undefined): void {
  defaultSink = sink;
}

function activeSink(event: HostedAssistantEvent): void {
  defaultSink?.(event);
}

type FetchTarget = { fetch: typeof fetch } & Record<PropertyKey, unknown>;

export function emitHostedAssistantEvent(event: HostedAssistantEvent): void {
  const line = `${JSON.stringify({ type: "message_update", assistantMessageEvent: event })}\n`;
  try {
    // Pi RPC mode replaces process.stdout.write (it redirects to stderr).
    // fd 1 is still the real stdout the host parses as JSONL.
    writeSync(1, line);
  } catch {
    try {
      process.stdout.write(line);
    } catch {
      /* best-effort */
    }
  }
}

export function installHostedSearchCapture(options?: {
  fetchImpl?: typeof fetch;
  sink?: HostedSearchSink;
  target?: { fetch: typeof fetch };
}): () => void {
  const target = (options?.target ?? globalThis) as FetchTarget;
  if (options?.sink) defaultSink = options.sink;
  else if (!defaultSink) defaultSink = emitHostedAssistantEvent;
  if (target[ORIGINAL_FETCH]) return uninstallHostedSearchCapture;
  const originalFetch = target.fetch;
  target[ORIGINAL_FETCH] = originalFetch;
  const fetchImpl = options?.fetchImpl ?? originalFetch.bind(target);
  target.fetch = wrapFetchForHostedSearch(fetchImpl, activeSink);
  return uninstallHostedSearchCapture;
}

export function uninstallHostedSearchCapture(target: { fetch: typeof fetch } = globalThis): void {
  const host = target as FetchTarget;
  const originalFetch = host[ORIGINAL_FETCH] as typeof fetch | undefined;
  if (originalFetch) host.fetch = originalFetch;
  delete host[ORIGINAL_FETCH];
}
