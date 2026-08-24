import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
export declare const THINKING_TAG_VARIANTS: Array<{
    open: string;
    close: string;
}>;
/**
 * Remove every thinking/reasoning tag variant (open and close) from `text`.
 *
 * Qoder's backend sometimes routes a literal `<thinking>` opener into the
 * `reasoning_content` channel (and the matching `</thinking>` closer into the
 * `content` channel). Stripping these artifacts keeps the thinking block clean,
 * matching the SDK's `ContentBlock` model. Best-effort per chunk: a tag split
 * across stream deltas is not caught here (the ThinkingTagParser handles the
 * content-channel side with cross-delta buffering).
 */
export declare function stripThinkingTags(text: string): string;
export declare class ThinkingTagParser {
    private output;
    private stream;
    private textBuffer;
    private inThinking;
    private thinkingExtracted;
    private thinkingBlockIndex;
    private textBlockIndex;
    private lastTextBlockIndex;
    private activeEndTag;
    constructor(output: AssistantMessage, stream: AssistantMessageEventStream);
    processChunk(chunk: string): void;
    finalize(): void;
    getTextBlockIndex(): number | null;
    private processBeforeThinking;
    private processInsideThinking;
    private processAfterThinking;
    private emitText;
    private emitThinking;
}
