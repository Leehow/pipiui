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
export declare const JSON_OBJECT_FORMAT: {
    readonly type: "json_object";
};
/** Must contain the literal letters JSON (DeepSeek hard requirement). */
export declare const JSON_CONSTRAINT_TEXT = "Your response must be valid JSON.";
export type JsonObjectFormat = {
    type: "json_object";
};
export type JsonRewriteResult<T> = {
    payload: T;
    applied: boolean;
    injectedConstraint: boolean;
};
/** True when the caller already asked for JSON object output (not json_schema). */
export declare function isStructuredOutputRequest(payload: unknown): boolean;
/**
 * True when messages / input / instructions already mention "JSON" / "json".
 */
export declare function payloadMentionsJson(payload: unknown): boolean;
/**
 * Inject DeepSeek JSON Output fields and the required "JSON" prompt sentence.
 * Pure: returns a shallow-copied payload; input is never mutated.
 */
export declare function applyJsonOutputConstraint<T>(payload: T): JsonRewriteResult<T>;
/** Convenience wrapper that returns only the rewritten payload. */
export declare function rewriteJsonOutput<T>(payload: T): T;
