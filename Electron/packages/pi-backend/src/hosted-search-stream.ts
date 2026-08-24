import type { StreamEvent, TranscriptCitation, TranscriptFileSource } from "@pipi/host-api";

export type HostedSearchKind = "web_search" | "x_search";
export type HostedSearchPhase = "in_progress" | "searching" | "completed" | "failed";

export type HostedAssistantEvent =
  | {
    type: "hosted_search";
    callId?: string;
    kind?: HostedSearchKind;
    phase?: HostedSearchPhase;
    query?: string;
    sources?: Array<{ url: string; title?: string; snippet?: string }>;
    error?: { code?: string; message: string };
    outputIndex?: number;
    itemId?: string;
  }
  | {
    type: "hosted_code_interpreter";
    callId?: string;
    phase?: "queued" | "in_progress" | "interpreting" | "completed" | "failed";
    code?: string;
    outputs?: Array<{ type: "logs"; text: string }>;
    files?: Array<{ filename?: string; mimeType?: string; size?: number; url?: string }>;
    error?: { code?: string; message: string };
    outputIndex?: number;
    itemId?: string;
  }
  | { type: "citations"; citations?: TranscriptCitation[] }
  | { type: "input_file_sources"; sources?: TranscriptFileSource[] }
  | {
    type: "server_side_usage";
    usage?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      reasoning: number;
      totalTokens: number;
      serverSideToolUsage?: Record<string, number>;
    };
  };

const INLINE_CITATION_RE = /\[\[(\d+)\]\]\((https?:\/\/[^\s)]+)\)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostedKindOf(value: unknown): HostedSearchKind | undefined {
  if (value === "web_search" || value === "x_search") return value;
  return undefined;
}

function phaseOf(value: unknown): HostedSearchPhase | undefined {
  return value === "in_progress" || value === "searching" || value === "completed" || value === "failed"
    ? value
    : undefined;
}

const FILE_SOURCE_NAME_MAX = 200;

function looksLikeLocalPath(value: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/)|file:)/i.test(value) || value.includes("\\");
}

function sanitizeProjectedFileName(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim();
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\.+/, "");
  const clipped = cleaned.slice(0, FILE_SOURCE_NAME_MAX).trim();
  return clipped || undefined;
}

function sanitizeProjectedHttpsUrl(value: unknown): string | undefined {
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

function sanitizeProjectedFileSource(value: unknown): TranscriptFileSource | undefined {
  if (!isRecord(value)) return undefined;
  const name = sanitizeProjectedFileName(value.name);
  if (!name) return undefined;
  const url = sanitizeProjectedHttpsUrl(value.url);
  return {
    name,
    ...(url ? { url } : {}),
  };
}

const FILE_CITATION_TYPES = new Set(["file_citation", "input_file", "file"]);
const URL_CITATION_TYPES = new Set(["url_citation", "url", "web_citation"]);

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function fileIdOf(value: Record<string, unknown>): string | undefined {
  return firstString(value.file_id, value.fileId);
}

function fileNameOf(value: Record<string, unknown>): string | undefined {
  return firstString(value.filename, value.file_name, value.fileName, value.name);
}

function citationTypeOf(value: Record<string, unknown>): string {
  return (typeof value.type === "string" ? value.type : "").trim().toLowerCase();
}

function isExplicitFileCitation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = citationTypeOf(value);
  if (URL_CITATION_TYPES.has(type)) return false;
  if (FILE_CITATION_TYPES.has(type)) return true;
  return !type && Boolean(fileIdOf(value) && fileNameOf(value));
}

const FALLBACK_FILE_NAME = "已上传文件";

function fileSourceFromUnknown(value: unknown): TranscriptFileSource | undefined {
  if (!isRecord(value) || !isExplicitFileCitation(value)) return undefined;
  const name = sanitizeProjectedFileName(fileNameOf(value)) ?? FALLBACK_FILE_NAME;
  const url = sanitizeProjectedHttpsUrl(value.url ?? value.uri ?? value.link);
  return {
    name,
    ...(url ? { url } : {}),
  };
}

function fileSourceKey(value: Record<string, unknown>, source: TranscriptFileSource): string {
  const fileId = fileIdOf(value);
  if (fileId) return `fileid:${fileId}`;
  return `file:${source.name}\0${source.url ?? ""}`;
}

function pushHistoryFileSource(
  value: unknown,
  into: TranscriptFileSource[],
  seen: Set<string>,
): void {
  if (!isRecord(value) || !isExplicitFileCitation(value)) return;
  const source = fileSourceFromUnknown(value);
  if (!source) return;
  const key = fileSourceKey(value, source);
  if (seen.has(key)) return;
  seen.add(key);
  into.push(source);
}

function collectHistoryFileSourcesFromItem(
  item: Record<string, unknown>,
  into: TranscriptFileSource[],
  seen: Set<string>,
): void {
  pushHistoryFileSource(item, into, seen);
  if (Array.isArray(item.annotations)) {
    for (const annotation of item.annotations) pushHistoryFileSource(annotation, into, seen);
  }
  if (Array.isArray(item.citations)) {
    for (const citation of item.citations) pushHistoryFileSource(citation, into, seen);
  }
  const content = Array.isArray(item.content) ? item.content : [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    pushHistoryFileSource(part, into, seen);
    if (Array.isArray(part.annotations)) {
      for (const annotation of part.annotations) pushHistoryFileSource(annotation, into, seen);
    }
    if (Array.isArray(part.citations)) {
      for (const citation of part.citations) pushHistoryFileSource(citation, into, seen);
    }
  }
}

export function isHostedAssistantEvent(value: unknown): value is HostedAssistantEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  return value.type === "hosted_search" || value.type === "hosted_code_interpreter" || value.type === "citations" || value.type === "input_file_sources" || value.type === "server_side_usage";
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

function codeInterpreterPhaseOf(
  value: unknown,
): Extract<StreamEvent, { type: "hosted_code_interpreter" }> ["phase"] | undefined {
  return value === "queued" || value === "in_progress" || value === "interpreting" || value === "completed" || value === "failed"
    ? value
    : undefined;
}

export function hostedCodeInterpreterToolDelta(event: Extract<HostedAssistantEvent, { type: "hosted_code_interpreter" }>): string {
  const payload: Record<string, unknown> = { phase: event.phase };
  if (event.code) payload.code = event.code;
  if (event.outputs?.length) payload.outputs = event.outputs;
  if (event.files?.length) payload.files = event.files;
  if (event.error?.message) payload.error = event.error.message;
  return JSON.stringify(payload);
}

export function projectHostedAssistantEvent(
  sessionId: string,
  event: HostedAssistantEvent,
  segment?: number,
): StreamEvent[] {
  if (event.type === "hosted_code_interpreter") {
    const phase = codeInterpreterPhaseOf(event.phase);
    if (!phase) return [];
    const callId = typeof event.callId === "string" && event.callId
      ? event.callId
      : typeof event.itemId === "string" && event.itemId
        ? event.itemId
        : "hosted-code_interpreter";
    const hosted: Extract<StreamEvent, { type: "hosted_code_interpreter" }> = {
      type: "hosted_code_interpreter",
      sessionId,
      callId,
      phase,
      ...(event.code ? { code: event.code } : {}),
      ...(event.outputs?.length ? { outputs: event.outputs } : {}),
      ...(event.files?.length ? { files: event.files } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(typeof event.outputIndex === "number" ? { outputIndex: event.outputIndex } : {}),
      ...(segment !== undefined ? { segment } : {}),
    };
    const status = phase === "completed" || phase === "failed" ? phase : "running";
    const toolCall: Extract<StreamEvent, { type: "tool_call" }> = {
      type: "tool_call",
      sessionId,
      toolCallId: callId,
      name: "code_interpreter",
      delta: hostedCodeInterpreterToolDelta(event),
      status,
      ...(typeof event.outputIndex === "number" ? { contentIndex: event.outputIndex } : {}),
      ...(segment !== undefined ? { segment } : {}),
    };
    return [hosted, toolCall];
  }
  if (event.type === "citations") {
    const citations = (event.citations ?? []).filter((item) => typeof item?.url === "string" && /^https?:\/\//i.test(item.url));
    return citations.length ? [{ type: "citations", sessionId, citations }] : [];
  }
  if (event.type === "input_file_sources") {
    const sources = (event.sources ?? []).flatMap((item) => {
      const source = sanitizeProjectedFileSource(item);
      return source ? [source] : [];
    });
    return sources.length ? [{ type: "input_file_sources", sessionId, sources }] : [];
  }
  if (event.type === "server_side_usage") {
    return event.usage ? [{ type: "server_side_usage", sessionId, usage: event.usage }] : [];
  }
  const kind = hostedKindOf(event.kind);
  const phase = phaseOf(event.phase);
  if (!kind || !phase) return [];
  const callId = typeof event.callId === "string" && event.callId
    ? event.callId
    : typeof event.itemId === "string" && event.itemId
      ? event.itemId
      : `hosted-${kind}`;
  const hosted: Extract<StreamEvent, { type: "hosted_search" }> = {
    type: "hosted_search",
    sessionId,
    callId,
    kind,
    phase,
    ...(event.query ? { query: event.query } : {}),
    ...(event.sources?.length ? { sources: event.sources } : {}),
    ...(event.error ? { error: event.error } : {}),
    ...(typeof event.outputIndex === "number" ? { outputIndex: event.outputIndex } : {}),
    ...(segment !== undefined ? { segment } : {}),
  };
  const status = phase === "completed" || phase === "failed" ? phase : "running";
  const toolCall: Extract<StreamEvent, { type: "tool_call" }> = {
    type: "tool_call",
    sessionId,
    toolCallId: callId,
    name: kind,
    delta: hostedSearchToolDelta(event),
    status,
    ...(typeof event.outputIndex === "number" ? { contentIndex: event.outputIndex } : {}),
    ...(segment !== undefined ? { segment } : {}),
  };
  return [hosted, toolCall];
}

export function extractHistoryCodeInterpreter(message: Record<string, unknown>): HistoryToolLike[] {
  const buckets: unknown[] = [];
  if (Array.isArray(message.output)) buckets.push(...message.output);
  if (Array.isArray(message.content)) buckets.push(...message.content);
  const tools: HistoryToolLike[] = [];
  for (const item of buckets) {
    if (!isRecord(item)) continue;
    const type = typeof item.type === "string" ? item.type : "";
    if (type !== "code_interpreter_call" && type !== "code_interpreter") continue;
    const id = typeof item.id === "string" && item.id ? item.id : `hosted-code_interpreter-${tools.length}`;
    const payload: Record<string, unknown> = {
      phase: item.status === "failed" || item.status === "incomplete" ? "failed" : item.status === "in_progress" || item.status === "queued" || item.status === "interpreting" ? item.status : "completed",
    };
    if (typeof item.code === "string" && item.code) payload.code = item.code;
    const outputs = Array.isArray(item.outputs) ? item.outputs : Array.isArray(item.results) ? item.results : [];
    const logs = outputs.flatMap((part) => {
      if (typeof part === "string" && part.trim()) return [{ type: "logs", text: part }];
      if (!isRecord(part)) return [];
      const text = typeof part.logs === "string" ? part.logs : typeof part.text === "string" ? part.text : undefined;
      return text ? [{ type: "logs", text }] : [];
    });
    const files = outputs.flatMap((part) => {
      if (!isRecord(part)) return [];
      const partType = typeof part.type === "string" ? part.type : "";
      if (partType !== "image" && partType !== "file" && partType !== "files") return [];
      const filename = typeof part.filename === "string" ? part.filename : typeof part.name === "string" ? part.name : undefined;
      const mimeType = typeof part.mimeType === "string" ? part.mimeType : typeof part.mime_type === "string" ? part.mime_type : undefined;
      const size = typeof part.size === "number" ? part.size : undefined;
      const url = typeof part.url === "string" && /^https:\/\//i.test(part.url) ? part.url : undefined;
      if (!filename && !mimeType && size === undefined && !url) return [];
      return [{ ...(filename ? { filename } : {}), ...(mimeType ? { mimeType } : {}), ...(size !== undefined ? { size } : {}), ...(url ? { url } : {}) }];
    });
    if (logs.length) payload.outputs = logs;
    if (files.length) payload.files = files;
    if (isRecord(item.error) && typeof item.error.message === "string") payload.error = item.error.message;
    tools.push({ id, name: "code_interpreter", input: JSON.stringify(payload) });
  }
  return tools;
}

type HistoryToolLike = { id: string; name: string; input: string };

export function extractHistoryCitations(message: Record<string, unknown>, text: string): TranscriptCitation[] {
  const collected: TranscriptCitation[] = [];
  const seen = new Set<string>();
  const push = (citation: TranscriptCitation | undefined) => {
    if (!citation?.url || !/^https?:\/\//i.test(citation.url)) return;
    const key = citation.url;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(citation);
  };
  if (Array.isArray(message.citations)) {
    for (const item of message.citations) {
      if (isExplicitFileCitation(item)) continue;
      if (typeof item === "string") push({ url: item });
      else if (isRecord(item) && typeof item.url === "string") {
        push({
          url: item.url,
          ...(typeof item.title === "string" ? { title: item.title } : {}),
          ...(typeof item.startIndex === "number" ? { startIndex: item.startIndex } : typeof item.start_index === "number" ? { startIndex: item.start_index } : {}),
          ...(typeof item.endIndex === "number" ? { endIndex: item.endIndex } : typeof item.end_index === "number" ? { endIndex: item.end_index } : {}),
          ...(typeof item.type === "string" ? { type: item.type } : {}),
        });
      }
    }
  }
  const content = message.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part) || !Array.isArray(part.annotations)) continue;
      for (const annotation of part.annotations) {
        if (!isRecord(annotation) || isExplicitFileCitation(annotation) || typeof annotation.url !== "string") continue;
        push({
          url: annotation.url,
          ...(typeof annotation.title === "string" ? { title: annotation.title } : {}),
          ...(typeof annotation.start_index === "number" ? { startIndex: annotation.start_index } : {}),
          ...(typeof annotation.end_index === "number" ? { endIndex: annotation.end_index } : {}),
          ...(typeof annotation.type === "string" ? { type: annotation.type } : {}),
        });
      }
    }
  }
  INLINE_CITATION_RE.lastIndex = 0;
  for (const match of text.matchAll(INLINE_CITATION_RE)) {
    if (match[2]) push({ url: match[2], type: "url_citation" });
  }
  return collected;
}

export function extractHistoryFileSources(message: Record<string, unknown>): TranscriptFileSource[] {
  const sources: TranscriptFileSource[] = [];
  const seen = new Set<string>();
  if (Array.isArray(message.citations)) {
    for (const item of message.citations) pushHistoryFileSource(item, sources, seen);
  }
  if (Array.isArray(message.annotations)) {
    for (const item of message.annotations) pushHistoryFileSource(item, sources, seen);
  }
  if (Array.isArray(message.content) || isRecord(message.content)) {
    collectHistoryFileSourcesFromItem(
      Array.isArray(message.content) ? { content: message.content } : message.content,
      sources,
      seen,
    );
  }
  if (Array.isArray(message.output)) {
    for (const item of message.output) {
      if (isRecord(item)) collectHistoryFileSourcesFromItem(item, sources, seen);
    }
  }
  return sources;
}
