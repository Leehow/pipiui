/**
 * Grok / xAI Responses hosted code interpreter protocol.
 *
 * Official request form is `{ type: "code_interpreter" }` plus
 * `include: ["code_interpreter_call.outputs"]` (xAI Agent Tools /
 * OpenAI-compatible Responses). Execution is always server-side — this module
 * never runs local Python. Inject only when `hostedTools.code_interpreter` is
 * declared; never infer from provider id or native search.
 *
 * Stream items are `code_interpreter_call` with official statuses
 * queued / in_progress / interpreting / completed / failed (plus OpenAI
 * `incomplete`, mapped to failed).
 */
export declare const HOSTED_CODE_INTERPRETER_TOOL: {
    readonly type: "code_interpreter";
};
export declare const HOSTED_CODE_INTERPRETER_INCLUDE: "code_interpreter_call.outputs";
export type HostedCodeInterpreterTool = typeof HOSTED_CODE_INTERPRETER_TOOL;
export type HostedCodeInterpreterPhase = "queued" | "in_progress" | "interpreting" | "completed" | "failed";
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
export declare function redactSecrets(message: string): string;
/** `true`/`false` when `hostedTools` is declared; otherwise `undefined` (do not infer). */
export declare function codeInterpreterFromCapabilities(capabilities: unknown): boolean | undefined;
export declare function modelHasCodeInterpreter(model: {
    capabilities?: unknown;
} | undefined): boolean;
export declare function mergeCodeInterpreterTool(existing: unknown): unknown[];
export declare function mergeCodeInterpreterInclude(existing: unknown): unknown[];
export declare function applyCodeInterpreterToPayload(payload: Record<string, unknown>, enabled: boolean): Record<string, unknown>;
export declare function interpretCodeInterpreterEvent(event: unknown): HostedCodeInterpreterCall | undefined;
export declare function hostedCodeInterpreterCallId(call: HostedCodeInterpreterCall): string;
export declare function codeInterpreterToolDelta(call: HostedCodeInterpreterCall): string;
export declare function collectCodeInterpreterStream(events: readonly unknown[]): {
    calls: HostedCodeInterpreterCall[];
    error?: HostedCodeInterpreterError;
};
export declare function extractHistoryCodeInterpreter(message: Record<string, unknown>): HostedCodeInterpreterCall[];
