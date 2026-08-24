/**
 * Production Responses hosted code-interpreter normalizer.
 *
 * Pi's openai-responses streamer ignores unknown SSE types, so
 * `code_interpreter_call` never becomes a local tool. Parse official
 * Responses events and emit `hosted_code_interpreter` assistant events.
 * Never execute Python locally.
 */

export type HostedCodeInterpreterPhase =
  | "queued"
  | "in_progress"
  | "interpreting"
  | "completed"
  | "failed";

export type HostedCodeInterpreterError = {
  code?: string;
  message: string;
};

export type HostedCodeInterpreterTextOutput = {
  type: "logs";
  text: string;
};

export type HostedCodeInterpreterFile = {
  filename?: string;
  mimeType?: string;
  size?: number;
  url?: string;
};

export type HostedCodeInterpreterCall = {
  phase: HostedCodeInterpreterPhase;
  itemId?: string;
  outputIndex?: number;
  code?: string;
  outputs?: HostedCodeInterpreterTextOutput[];
  files?: HostedCodeInterpreterFile[];
  error?: HostedCodeInterpreterError;
};

export type HostedCodeInterpreterAssistantEvent = {
  type: "hosted_code_interpreter";
  callId: string;
  phase: HostedCodeInterpreterPhase;
  code?: string;
  outputs?: HostedCodeInterpreterTextOutput[];
  files?: HostedCodeInterpreterFile[];
  error?: HostedCodeInterpreterError;
  outputIndex?: number;
};

const PHASES = new Set<HostedCodeInterpreterPhase>([
  "queued",
  "in_progress",
  "interpreting",
  "completed",
  "failed",
]);

const CODE_EVENT_RE =
  /^response\.code_interpreter_call(?:_code)?\.(queued|in_progress|interpreting|completed|failed|incomplete|delta|done)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function redactCodeInterpreterSecrets(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\b(at|rt)-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\b(?:access|container|file|download)[_-]?token=([^&\s]+)/gi, (full, token: string) =>
      full.replace(token, "[redacted]"),
    );
}

function phaseOf(value: unknown): HostedCodeInterpreterPhase | undefined {
  if (value === "incomplete") return "failed";
  return typeof value === "string" && PHASES.has(value as HostedCodeInterpreterPhase)
    ? value as HostedCodeInterpreterPhase
    : undefined;
}

function isCodeInterpreterItem(item: Record<string, unknown> | undefined): boolean {
  if (!item) return false;
  const type = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
  const name = typeof item.name === "string" ? item.name.trim().toLowerCase() : "";
  return type === "code_interpreter_call"
    || type === "code_interpreter"
    || name === "code_interpreter_call";
}

function safeHttpsUrl(value: unknown): string | undefined {
  const url = stringOf(value);
  if (!url || !/^https:\/\//i.test(url)) return undefined;
  if (/[?&](?:token|access_token|sig|signature|key)=/i.test(url)) {
    try {
      const parsed = new URL(url);
      for (const key of [...parsed.searchParams.keys()]) {
        if (/token|sig|signature|key|auth/i.test(key)) parsed.searchParams.delete(key);
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }
  return url;
}

function fileFromUnknown(value: unknown): HostedCodeInterpreterFile | undefined {
  if (!isRecord(value)) return undefined;
  const filename = stringOf(value.filename) ?? stringOf(value.name) ?? stringOf(value.path);
  const mimeType = stringOf(value.mimeType) ?? stringOf(value.mime_type) ?? stringOf(value.content_type);
  const size = numberOf(value.size) ?? numberOf(value.bytes);
  const url = safeHttpsUrl(value.url) ?? safeHttpsUrl(value.uri);
  if (!filename && !mimeType && size === undefined && !url) return undefined;
  return {
    ...(filename ? { filename } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(url ? { url } : {}),
  };
}

function outputsAndFiles(record: Record<string, unknown>): {
  outputs?: HostedCodeInterpreterTextOutput[];
  files?: HostedCodeInterpreterFile[];
} {
  const raw = [record.outputs, record.results, record.output]
    .find((value) => Array.isArray(value)) as unknown[] | undefined;
  if (!raw?.length) return {};
  const outputs: HostedCodeInterpreterTextOutput[] = [];
  const files: HostedCodeInterpreterFile[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      outputs.push({ type: "logs", text: redactCodeInterpreterSecrets(item) });
      continue;
    }
    if (!isRecord(item)) continue;
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    const text = stringOf(item.logs) ?? stringOf(item.text) ?? stringOf(item.content) ?? stringOf(item.output);
    if (type === "logs" || type === "text" || (text && type !== "image" && type !== "file" && type !== "files")) {
      if (text) outputs.push({ type: "logs", text: redactCodeInterpreterSecrets(text) });
    }
    if (type === "image" || type === "file" || type === "files") {
      if (type === "files" && Array.isArray(item.files)) {
        for (const file of item.files) {
          const next = fileFromUnknown(file);
          if (next) files.push(next);
        }
      } else {
        const next = fileFromUnknown(item);
        if (next) files.push(next);
      }
    } else {
      const next = fileFromUnknown(item);
      if (next && (next.filename || next.url || next.mimeType)) files.push(next);
    }
  }
  return {
    ...(outputs.length ? { outputs } : {}),
    ...(files.length ? { files } : {}),
  };
}

function errorOf(record: Record<string, unknown>, item?: Record<string, unknown>): HostedCodeInterpreterError | undefined {
  const raw = isRecord(record.error) ? record.error : isRecord(item?.error) ? item.error : undefined;
  const message = stringOf(raw?.message) ?? (typeof record.error === "string" ? record.error : undefined)
    ?? (typeof item?.error === "string" ? item.error : undefined);
  if (!message) return undefined;
  return {
    ...(typeof raw?.code === "string" && raw.code ? { code: raw.code } : {}),
    message: redactCodeInterpreterSecrets(message),
  };
}

function codeOf(record: Record<string, unknown>, item?: Record<string, unknown>): string | undefined {
  const code = stringOf(record.code) ?? stringOf(item?.code) ?? stringOf(record.delta);
  return code ? redactCodeInterpreterSecrets(code) : undefined;
}

export function interpretCodeInterpreterEvent(event: unknown): HostedCodeInterpreterCall | undefined {
  if (!isRecord(event) || typeof event.type !== "string") return undefined;
  const item = isRecord(event.item) ? event.item : undefined;
  const match = event.type.match(CODE_EVENT_RE);
  if (match) {
    const suffix = match[1];
    const phase = suffix === "delta" || suffix === "done"
      ? (phaseOf(item?.status) ?? "in_progress")
      : phaseOf(suffix);
    if (!phase) return undefined;
    const produced = outputsAndFiles(event);
    const fromItem = item ? outputsAndFiles(item) : {};
    const itemId = typeof event.item_id === "string" ? event.item_id : stringOf(item?.id);
    return {
      phase,
      ...(itemId ? { itemId } : {}),
      ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
      ...(codeOf(event, item) ? { code: codeOf(event, item) } : {}),
      ...(produced.outputs ?? fromItem.outputs ? { outputs: produced.outputs ?? fromItem.outputs } : {}),
      ...(produced.files ?? fromItem.files ? { files: produced.files ?? fromItem.files } : {}),
      ...(errorOf(event, item) ? { error: errorOf(event, item) } : {}),
    };
  }

  if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
    if (!isCodeInterpreterItem(item) || !item) return undefined;
    const produced = outputsAndFiles(item);
    const failed = item.status === "failed" || item.status === "incomplete" || Boolean(errorOf(event, item));
    return {
      phase: event.type === "response.output_item.done"
        ? (failed ? "failed" : phaseOf(item.status) ?? "completed")
        : (phaseOf(item.status) ?? "queued"),
      ...(stringOf(item.id) ? { itemId: stringOf(item.id) } : {}),
      ...(typeof event.output_index === "number" ? { outputIndex: event.output_index } : {}),
      ...(codeOf(event, item) ? { code: codeOf(event, item) } : {}),
      ...produced,
      ...(errorOf(event, item) ? { error: errorOf(event, item) } : {}),
    };
  }

  return undefined;
}

export function hostedCodeInterpreterCallId(call: HostedCodeInterpreterCall): string {
  if (call.itemId) return call.itemId;
  if (typeof call.outputIndex === "number") return `hosted-code_interpreter-${call.outputIndex}`;
  return "hosted-code_interpreter";
}

export function toHostedCodeInterpreterEvent(call: HostedCodeInterpreterCall): HostedCodeInterpreterAssistantEvent {
  return {
    type: "hosted_code_interpreter",
    callId: hostedCodeInterpreterCallId(call),
    phase: call.phase,
    ...(call.code ? { code: call.code } : {}),
    ...(call.outputs ? { outputs: call.outputs } : {}),
    ...(call.files ? { files: call.files } : {}),
    ...(call.error ? { error: call.error } : {}),
    ...(typeof call.outputIndex === "number" ? { outputIndex: call.outputIndex } : {}),
  };
}

const codeBuffers = new WeakMap<HostedSearchLikeSink, Map<string, string>>();

type HostedSearchLikeSink = (event: HostedCodeInterpreterAssistantEvent) => void;

export function mergeCodeInterpreterCall(
  event: unknown,
  call: HostedCodeInterpreterCall,
  codeById: Map<string, string>,
): HostedCodeInterpreterCall {
  const id = hostedCodeInterpreterCallId(call);
  if (call.code) {
    const prev = codeById.get(id) ?? "";
    const next = isRecord(event) && typeof event.type === "string" && event.type.endsWith(".delta")
      ? `${prev}${call.code}`
      : call.code;
    codeById.set(id, next);
    call.code = next;
  } else if (codeById.has(id)) {
    call.code = codeById.get(id);
  }
  return call;
}

export function collectCodeInterpreterStream(events: readonly unknown[]): {
  calls: HostedCodeInterpreterCall[];
  error?: HostedCodeInterpreterError;
} {
  const calls: HostedCodeInterpreterCall[] = [];
  const codeById = new Map<string, string>();
  let error: HostedCodeInterpreterError | undefined;
  for (const event of events) {
    const call = interpretCodeInterpreterEvent(event);
    if (!call) continue;
    mergeCodeInterpreterCall(event, call, codeById);
    if (call.error && !error) error = call.error;
    calls.push(call);
  }
  return { calls, ...(error ? { error } : {}) };
}

export function interpretAndEmitCodeInterpreter(
  event: unknown,
  sink: HostedSearchLikeSink,
): boolean {
  const call = interpretCodeInterpreterEvent(event);
  if (!call) return false;
  let buffers = codeBuffers.get(sink);
  if (!buffers) {
    buffers = new Map();
    codeBuffers.set(sink, buffers);
  }
  mergeCodeInterpreterCall(event, call, buffers);
  sink(toHostedCodeInterpreterEvent(call));
  return true;
}
