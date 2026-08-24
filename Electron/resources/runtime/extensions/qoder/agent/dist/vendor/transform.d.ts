import type { ImageContent, Message, Tool } from "@earendil-works/pi-ai";
/** OpenAI-style tool definition sent to the Qoder API. */
interface QoderTool {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: unknown;
    };
}
/** OpenAI-style tool call within an assistant message. */
interface QoderToolCall {
    id?: string;
    type: "function";
    function: {
        name?: string;
        arguments: string;
    };
}
type QoderTextPart = {
    type: "text";
    text: string;
};
type QoderImagePart = {
    type: "image_url";
    image_url: {
        url: string;
    };
};
type QoderContent = string | Array<QoderTextPart | QoderImagePart>;
/** OpenAI-style message sent to the Qoder API. */
interface QoderMessage {
    role: "user" | "assistant" | "tool" | "system";
    content: QoderContent | null;
    tool_calls?: QoderToolCall[];
    tool_call_id?: string;
}
export declare function getContentText(msg: Message): string;
/** The image blocks of a message, in order. Empty when there are none. */
export declare function getContentImages(msg: Message): ImageContent[];
export declare function transformTools(tools: Tool[]): QoderTool[];
export declare function transformMessagesForQoder(messages: Message[]): QoderMessage[];
export {};
