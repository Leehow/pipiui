/**
 * DeepSeek JSON Output rewrite (pure).
 *
 * Chat Completions requires `response_format: { type: "json_object" }` AND the
 * word "JSON" / "json" somewhere in the prompt. Responses API uses
 * `text.format: { type: "json_object" }` with the same prompt constraint.
 *
 * Structured-output requests are detected from an existing `response_format`
 * or `text.format` (any json_* type). Non-structured payloads are left alone.
 */

export const JSON_OBJECT_FORMAT = { type: "json_object" } as const;

/** Must contain the literal letters JSON (DeepSeek hard requirement). */
export const JSON_CONSTRAINT_TEXT = "Your response must be valid JSON.";

const JSON_WORD = /json/i;

export type JsonObjectFormat = { type: "json_object" };

export type JsonRewriteResult<T> = {
  payload: T;
  applied: boolean;
  injectedConstraint: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatType(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.type === "string" ? value.type : undefined;
}

function isJsonObjectType(type: string | undefined): boolean {
  return type === "json_object";
}

/** True when the caller already asked for JSON object output (not json_schema). */
export function isStructuredOutputRequest(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (isJsonObjectType(formatType(payload.response_format))) return true;
  const text = payload.text;
  return isRecord(text) && isJsonObjectType(formatType(text.format));
}

function collectText(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, into);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.text === "string") into.push(value.text);
  if (typeof value.content === "string") into.push(value.content);
  if (value.content !== undefined) collectText(value.content, into);
  if (Array.isArray(value.parts)) collectText(value.parts, into);
}

/**
 * True when messages / input / instructions already mention "JSON" / "json".
 */
export function payloadMentionsJson(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const chunks: string[] = [];
  collectText(payload.messages, chunks);
  collectText(payload.input, chunks);
  collectText(payload.instructions, chunks);
  return chunks.some((text) => JSON_WORD.test(text));
}

function appendTextToContent(content: unknown, text: string): unknown {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? `${content}\n${text}` : text;
  }
  if (Array.isArray(content)) {
    return [...content, { type: "text", text }];
  }
  if (content == null) return text;
  return content;
}

function withConstraintOnMessages(messages: unknown[]): unknown[] {
  const next = messages.map((item) => (isRecord(item) ? { ...item } : item));
  const systemIndex = next.findIndex((item) => isRecord(item) && item.role === "system");
  if (systemIndex >= 0) {
    const system = next[systemIndex] as Record<string, unknown>;
    next[systemIndex] = { ...system, content: appendTextToContent(system.content, JSON_CONSTRAINT_TEXT) };
    return next;
  }
  return [{ role: "system", content: JSON_CONSTRAINT_TEXT }, ...next];
}

function withConstraintOnInput(
  payload: Record<string, unknown>,
): { input?: unknown; instructions?: unknown } {
  if (typeof payload.instructions === "string") {
    const trimmed = payload.instructions.trim();
    return { instructions: trimmed ? `${payload.instructions}\n${JSON_CONSTRAINT_TEXT}` : JSON_CONSTRAINT_TEXT };
  }
  if (Array.isArray(payload.input)) {
    return { input: withConstraintOnMessages(payload.input) };
  }
  return { instructions: JSON_CONSTRAINT_TEXT };
}

/**
 * Inject DeepSeek JSON Output fields and the required "JSON" prompt sentence.
 * Pure: returns a shallow-copied payload; input is never mutated.
 */
export function applyJsonOutputConstraint<T>(payload: T): JsonRewriteResult<T> {
  if (!isStructuredOutputRequest(payload) || !isRecord(payload)) {
    return { payload, applied: false, injectedConstraint: false };
  }

  const next: Record<string, unknown> = { ...payload };
  const hasMessages = Array.isArray(next.messages);
  const hasInput = Array.isArray(next.input);
  const hasText = isRecord(next.text);

  if (hasMessages || next.response_format !== undefined) {
    next.response_format = { ...JSON_OBJECT_FORMAT };
  }
  if (hasInput || hasText || next.instructions !== undefined) {
    const text = isRecord(next.text) ? { ...next.text } : {};
    text.format = { ...JSON_OBJECT_FORMAT };
    next.text = text;
  }

  let injectedConstraint = false;
  if (!payloadMentionsJson(next)) {
    injectedConstraint = true;
    if (hasMessages) {
      next.messages = withConstraintOnMessages(next.messages as unknown[]);
    } else {
      Object.assign(next, withConstraintOnInput(next));
    }
  }

  return { payload: next as T, applied: true, injectedConstraint };
}

/** Convenience wrapper that returns only the rewritten payload. */
export function rewriteJsonOutput<T>(payload: T): T {
  return applyJsonOutputConstraint(payload).payload;
}
