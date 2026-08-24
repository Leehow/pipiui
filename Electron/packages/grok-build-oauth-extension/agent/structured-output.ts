/**
 * Grok / xAI Responses structured outputs — a request contract, never a tool.
 *
 * Official payload is Responses `text.format` with `type: "json_schema"`.
 * Apply only when model capability `structuredOutputs` is explicitly on.
 * Ordinary text requests (no option) leave the payload untouched.
 */

export const STRUCTURED_OUTPUT_SCHEMA_MAX_CHARS = 64 * 1024;
export const STRUCTURED_OUTPUT_NAME_MAX = 64;

export type StructuredOutputRequest = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  description?: string;
};

export type StructuredOutputTextFormat = {
  type: "json_schema";
  name: string;
  schema: Record<string, unknown>;
  strict: boolean;
  description?: string;
};

export type StructuredOutputResult =
  | { kind: "valid_json"; name?: string; value: unknown; text: string }
  | { kind: "refusal"; name?: string; message: string }
  | { kind: "invalid"; name?: string; message: string; text?: string }
  | { kind: "incomplete"; name?: string; message: string; text?: string }
  | { kind: "provider_error"; name?: string; message: string; code?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactStructuredOutputDiagnostics(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\b(at|rt)-[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/\bfile-[A-Za-z0-9]+/g, "[file_id]")
    .replace(/data:[^\s"';]+;base64,[A-Za-z0-9+/=]+/gi, "[base64]")
    .replace(/(?:[A-Za-z]:)?(?:\/|\\)(?:Users|home|private|var|tmp)[^\s"'`]+/gi, "[path]");
}

/** Tag consumed by PipiUI `emitBeforeProviderRequest` fail-closed propagation. */
export const PIPIUI_FATAL_HOOK_ERROR = "PipiUIFatalHookError";

export function isPipiUIFatalHookError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; pipiuiFatalHook?: unknown };
  return value.pipiuiFatalHook === true || value.name === PIPIUI_FATAL_HOOK_ERROR;
}

export function fatalStructuredOutputError(cause: unknown): Error {
  if (isPipiUIFatalHookError(cause) && cause instanceof Error) return cause;
  const raw = typeof cause === "string"
    ? cause
    : cause instanceof Error
      ? cause.message
      : "无法应用 Structured Output 请求，拒绝静默退化为普通发送";
  const message = redactStructuredOutputDiagnostics(raw).trim()
    || "无法应用 Structured Output 请求，拒绝静默退化为普通发送";
  const error = new Error(message);
  error.name = PIPIUI_FATAL_HOOK_ERROR;
  (error as Error & { pipiuiFatalHook: true }).pipiuiFatalHook = true;
  return error;
}

/** `true` / object = declared; absent / false / non-object = off. Never infer. */
export function structuredOutputsEnabled(capabilities: unknown): boolean {
  if (!isRecord(capabilities)) return false;
  const flag = capabilities.structuredOutputs;
  if (flag === true) return true;
  if (!isRecord(flag)) return false;
  return flag.jsonSchema !== false;
}

export function normalizeStructuredOutputRequest(request: unknown): StructuredOutputRequest {
  if (!isRecord(request)) {
    throw new Error("structured output 请求无效");
  }
  const name = typeof request.name === "string" ? request.name.trim() : "";
  if (!name) {
    throw new Error("structured output 名称不能为空");
  }
  if (name.length > STRUCTURED_OUTPUT_NAME_MAX) {
    throw new Error("structured output 名称明显超限");
  }
  if (request.strict !== undefined && typeof request.strict !== "boolean") {
    throw new Error("structured output strict 必须是布尔值");
  }
  if (request.description !== undefined && typeof request.description !== "string") {
    throw new Error("structured output description 必须是字符串");
  }
  const description = typeof request.description === "string" ? request.description.trim() : "";
  return {
    name,
    schema: assertJsonSchemaObject(request.schema),
    strict: request.strict ?? true,
    ...(description ? { description } : {}),
  };
}

function assertJsonSchemaObject(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    throw new Error("structured output schema 必须是 JSON 对象");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(schema, (_key, value) => {
      if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
        throw new Error("structured output schema 不可序列化");
      }
      return value;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("不可序列化")) throw error;
    if (/circular|cyclic/i.test(message)) {
      throw new Error("structured output schema 包含循环引用");
    }
    throw new Error("structured output schema 不可序列化");
  }
  if (typeof serialized !== "string") {
    throw new Error("structured output schema 不可序列化");
  }
  if (serialized.length > STRUCTURED_OUTPUT_SCHEMA_MAX_CHARS) {
    throw new Error("structured output schema 明显超限");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function toResponsesTextFormat(request: StructuredOutputRequest): StructuredOutputTextFormat {
  return {
    type: "json_schema",
    name: request.name,
    schema: request.schema,
    strict: request.strict ?? true,
    ...(request.description ? { description: request.description } : {}),
  };
}

/**
 * Compose `text.format` onto a Responses-shaped payload.
 * Never writes `tools`. Leaves `input` / `stream` / existing tools intact.
 * Missing option returns the same payload reference.
 */
export function applyStructuredOutput(
  payload: Record<string, unknown>,
  request: StructuredOutputRequest | null | undefined,
  capabilities?: unknown,
): Record<string, unknown> {
  if (request == null) return payload;
  if (!structuredOutputsEnabled(capabilities)) {
    throw new Error("该模型未声明 structuredOutputs 能力");
  }
  const normalized = normalizeStructuredOutputRequest(request);
  const prevText = isRecord(payload.text) ? payload.text : {};
  return {
    ...payload,
    text: {
      ...prevText,
      format: toResponsesTextFormat(normalized),
    },
  };
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function collectOutputItems(response: Record<string, unknown>): Record<string, unknown>[] {
  const buckets: unknown[] = [];
  if (Array.isArray(response.output)) buckets.push(...response.output);
  if (Array.isArray(response.choices)) buckets.push(...response.choices);
  const items: Record<string, unknown>[] = [];
  for (const item of buckets) {
    if (!isRecord(item)) continue;
    items.push(item);
    if (isRecord(item.message)) items.push(item.message);
    if (isRecord(item.item)) items.push(item.item);
  }
  return items;
}

function collectContent(response: Record<string, unknown>): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [];
  if (Array.isArray(response.content)) {
    for (const part of response.content) {
      if (isRecord(part)) content.push(part);
    }
  }
  for (const item of collectOutputItems(response)) {
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (isRecord(part)) content.push(part);
      }
    }
  }
  return content;
}

function refusalOf(response: Record<string, unknown>): string | undefined {
  const direct = stringOf(response.refusal);
  if (direct) return redactStructuredOutputDiagnostics(direct);
  for (const item of collectOutputItems(response)) {
    const message = stringOf(item.refusal);
    if (message) return redactStructuredOutputDiagnostics(message);
  }
  for (const part of collectContent(response)) {
    const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
    if (type === "refusal") {
      const message = stringOf(part.refusal) ?? stringOf(part.text);
      if (message) return redactStructuredOutputDiagnostics(message);
    }
  }
  return undefined;
}

function rawTextOf(response: Record<string, unknown>): string | undefined {
  if (typeof response.output_text === "string" && response.output_text.length) {
    return response.output_text;
  }
  const chunks: string[] = [];
  for (const part of collectContent(response)) {
    const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
    if (type === "refusal") continue;
    const text = stringOf(part.text) ?? stringOf(part.output_text);
    if (text) chunks.push(text);
  }
  if (!chunks.length) {
    for (const item of collectOutputItems(response)) {
      if (typeof item.content === "string" && item.content) chunks.push(item.content);
    }
  }
  return chunks.length ? chunks.join("") : undefined;
}

function parsedOf(response: Record<string, unknown>): unknown {
  if (response.output_parsed !== undefined) return response.output_parsed;
  if (response.parsed !== undefined) return response.parsed;
  for (const item of collectOutputItems(response)) {
    if (item.parsed !== undefined) return item.parsed;
    if (item.output_parsed !== undefined) return item.output_parsed;
  }
  for (const part of collectContent(response)) {
    if (part.parsed !== undefined) return part.parsed;
  }
  return undefined;
}

function providerErrorOf(response: Record<string, unknown>): { message: string; code?: string } | undefined {
  const raw = response.error;
  if (typeof raw === "string" && raw.trim()) {
    return { message: redactStructuredOutputDiagnostics(raw) };
  }
  if (isRecord(raw)) {
    const message = stringOf(raw.message) ?? stringOf(raw.error) ?? "provider error";
    return {
      message: redactStructuredOutputDiagnostics(message),
      ...(typeof raw.code === "string" && raw.code ? { code: raw.code } : {}),
    };
  }
  if (response.status === "failed") {
    return { message: "structured output 提供方失败" };
  }
  return undefined;
}

function incompleteReason(response: Record<string, unknown>): string | undefined {
  if (response.status === "incomplete") {
    const details = isRecord(response.incomplete_details) ? response.incomplete_details : undefined;
    return stringOf(details?.reason) ?? "incomplete";
  }
  for (const item of collectOutputItems(response)) {
    if (item.finish_reason === "length" || item.status === "incomplete") {
      return stringOf(item.finish_reason) ?? "incomplete";
    }
  }
  return undefined;
}

export function normalizeStructuredOutputResult(
  response: unknown,
  expectedName?: string,
): StructuredOutputResult {
  const name = typeof expectedName === "string" && expectedName.trim() ? expectedName.trim() : undefined;
  if (!isRecord(response)) {
    return { kind: "provider_error", ...(name ? { name } : {}), message: "无效的结构化输出响应" };
  }
  const error = providerErrorOf(response);
  if (error) {
    return { kind: "provider_error", ...(name ? { name } : {}), ...error };
  }
  const refusal = refusalOf(response);
  if (refusal) {
    return { kind: "refusal", ...(name ? { name } : {}), message: refusal };
  }
  const incomplete = incompleteReason(response);
  const text = rawTextOf(response);
  const parsed = parsedOf(response);
  if (incomplete) {
    return {
      kind: "incomplete",
      ...(name ? { name } : {}),
      message: redactStructuredOutputDiagnostics(incomplete),
      ...(text !== undefined ? { text } : {}),
    };
  }
  if (parsed !== undefined) {
    return {
      kind: "valid_json",
      ...(name ? { name } : {}),
      value: parsed,
      text: text ?? JSON.stringify(parsed),
    };
  }
  if (text !== undefined) {
    try {
      return {
        kind: "valid_json",
        ...(name ? { name } : {}),
        value: JSON.parse(text),
        text,
      };
    } catch {
      return {
        kind: "invalid",
        ...(name ? { name } : {}),
        message: "structured output 不是合法 JSON",
        text,
      };
    }
  }
  return {
    kind: "invalid",
    ...(name ? { name } : {}),
    message: "structured output 响应缺少 JSON",
  };
}
