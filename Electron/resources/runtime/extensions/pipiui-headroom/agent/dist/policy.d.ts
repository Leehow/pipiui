import { type Candidate, type HeadroomConfig, type PreparedEntry } from "./types.js";
type ContextMessage = {
    role: string;
};
export interface ToolResultMessageLike extends ContextMessage {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: Array<{
        type: string;
        text?: string;
    }>;
    details?: unknown;
    isError: boolean;
    timestamp: number;
}
export declare function candidateFromToolResult(message: ToolResultMessageLike, config: Readonly<HeadroomConfig>): Candidate | undefined;
export declare function protectedToolResultIndexes(messages: readonly ContextMessage[], count: number): Set<number>;
export declare function transformContext<TMessage extends ContextMessage>(messages: readonly TMessage[], config: Readonly<HeadroomConfig>, lookup: (key: string) => PreparedEntry | undefined, enqueue: (candidate: Candidate) => void, onSubstitution?: (entry: PreparedEntry) => void, canSubstitute?: (candidate: Candidate, entry: PreparedEntry) => boolean): TMessage[] | undefined;
export {};
