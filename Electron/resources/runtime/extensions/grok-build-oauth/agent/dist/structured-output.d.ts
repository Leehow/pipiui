/**
 * Grok / xAI Responses structured outputs — a request contract, never a tool.
 *
 * Official payload is Responses `text.format` with `type: "json_schema"`.
 * Apply only when model capability `structuredOutputs` is explicitly on.
 * Ordinary text requests (no option) leave the payload untouched.
 */
export declare const STRUCTURED_OUTPUT_SCHEMA_MAX_CHARS: number;
export declare const STRUCTURED_OUTPUT_NAME_MAX = 64;
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
export type StructuredOutputResult = {
    kind: "valid_json";
    name?: string;
    value: unknown;
    text: string;
} | {
    kind: "refusal";
    name?: string;
    message: string;
} | {
    kind: "invalid";
    name?: string;
    message: string;
    text?: string;
} | {
    kind: "incomplete";
    name?: string;
    message: string;
    text?: string;
} | {
    kind: "provider_error";
    name?: string;
    message: string;
    code?: string;
};
export declare function redactStructuredOutputDiagnostics(message: string): string;
/** Tag consumed by PipiUI `emitBeforeProviderRequest` fail-closed propagation. */
export declare const PIPIUI_FATAL_HOOK_ERROR = "PipiUIFatalHookError";
export declare function isPipiUIFatalHookError(error: unknown): boolean;
export declare function fatalStructuredOutputError(cause: unknown): Error;
/** `true` / object = declared; absent / false / non-object = off. Never infer. */
export declare function structuredOutputsEnabled(capabilities: unknown): boolean;
export declare function normalizeStructuredOutputRequest(request: unknown): StructuredOutputRequest;
export declare function toResponsesTextFormat(request: StructuredOutputRequest): StructuredOutputTextFormat;
/**
 * Compose `text.format` onto a Responses-shaped payload.
 * Never writes `tools`. Leaves `input` / `stream` / existing tools intact.
 * Missing option returns the same payload reference.
 */
export declare function applyStructuredOutput(payload: Record<string, unknown>, request: StructuredOutputRequest | null | undefined, capabilities?: unknown): Record<string, unknown>;
export declare function normalizeStructuredOutputResult(response: unknown, expectedName?: string): StructuredOutputResult;
