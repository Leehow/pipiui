/**
 * In-memory, session-scoped one-shot Structured Output requests.
 * Never writes session/resource/settings/logs. Schema lives only in this Map.
 */
import { type StructuredOutputRequest } from "./structured-output.js";
export declare function safeStructuredOutputSessionId(raw: string): string;
export declare class StructuredOutputController {
    private readonly pending;
    set(sessionId: string, request: unknown): StructuredOutputRequest | undefined;
    peek(sessionId: string): StructuredOutputRequest | undefined;
    take(sessionId: string): StructuredOutputRequest | undefined;
    clear(sessionId: string): void;
    clearAll(): void;
}
export declare function createStructuredOutputController(): StructuredOutputController;
