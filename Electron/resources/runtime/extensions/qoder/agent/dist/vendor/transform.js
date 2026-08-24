export function getContentText(msg) {
    if (typeof msg.content === "string")
        return msg.content;
    if (Array.isArray(msg.content)) {
        return msg.content
            .map((c) => {
            if (c.type === "text")
                return c.text;
            if (c.type === "thinking")
                return c.thinking;
            return "";
        })
            .join("");
    }
    return "";
}
/** The image blocks of a message, in order. Empty when there are none. */
export function getContentImages(msg) {
    if (!Array.isArray(msg.content))
        return [];
    return msg.content.filter((c) => c.type === "image");
}
export function transformTools(tools) {
    return tools.map((t) => ({
        type: "function",
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));
}
export function transformMessagesForQoder(messages) {
    const normalizedMessages = [];
    for (const msg of messages) {
        // Skip error or aborted messages
        if (msg.role === "assistant" &&
            (msg.stopReason === "error" || msg.stopReason === "aborted")) {
            continue;
        }
        if (msg.role === "user") {
            let content = "";
            if (typeof msg.content === "string") {
                content = msg.content;
            }
            else if (Array.isArray(msg.content)) {
                const hasImage = msg.content.some((c) => c.type === "image");
                if (hasImage) {
                    content = msg.content
                        .map((c) => {
                        if (c.type === "text") {
                            return { type: "text", text: c.text };
                        }
                        if (c.type === "image") {
                            const img = c;
                            return {
                                type: "image_url",
                                image_url: {
                                    url: `data:${img.mimeType};base64,${img.data}`,
                                },
                            };
                        }
                        return null;
                    })
                        .filter((p) => p !== null);
                }
                else {
                    content = getContentText(msg);
                }
            }
            normalizedMessages.push({
                role: "user",
                content,
            });
        }
        else if (msg.role === "assistant") {
            const am = msg;
            let content = "";
            const toolCalls = [];
            if (Array.isArray(am.content)) {
                for (const block of am.content) {
                    if (block.type === "text") {
                        content += block.text;
                    }
                    else if (block.type === "thinking") {
                        // Include thinking tags if reasoning is on
                        content += `<thinking>${block.thinking}</thinking>\n\n`;
                    }
                    else if (block.type === "toolCall") {
                        const tc = block;
                        toolCalls.push({
                            id: tc.id,
                            type: "function",
                            function: {
                                name: tc.name,
                                arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
                            },
                        });
                    }
                }
            }
            else {
                content = am.content || "";
            }
            // Qoder's gateway drops assistant messages whose content is null, which
            // orphans the following tool_result and makes dmodel/ultimate upstreams
            // reject the request ("tool must follow a message with tool_calls").
            // When an assistant turn has tool calls but no text/thinking, inject a
            // single-space placeholder so the gateway keeps the message.
            const mapped = {
                role: "assistant",
                content: content || (toolCalls.length > 0 ? " " : null),
            };
            if (toolCalls.length > 0) {
                mapped.tool_calls = toolCalls;
            }
            normalizedMessages.push(mapped);
        }
        else if (msg.role === "toolResult") {
            const tr = msg;
            normalizedMessages.push({
                role: "tool",
                tool_call_id: tr.toolCallId,
                content: getContentText(tr),
            });
            // A tool result may carry images — pi's `read` tool returns a text note
            // plus an `image` block for png/jpg/gif/webp/bmp, and screenshot tools do
            // the same. getContentText() maps every non-text block to "", so those
            // images were dropped silently: the TUI rendered the picture while the
            // model received only "Read image file [image/png]" and reported that it
            // could not see images.
            //
            // The OpenAI-shaped `tool` role has nowhere to put them — its content is
            // a plain string — so they follow as a separate user message, the same
            // shape the user branch above already builds. The leading label keeps the
            // model from reading a bare image as something the human just sent.
            const images = getContentImages(tr);
            if (images.length > 0) {
                normalizedMessages.push({
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `[${images.length} image${images.length === 1 ? "" : "s"} returned by the previous tool call]`,
                        },
                        ...images.map((img) => ({
                            type: "image_url",
                            image_url: { url: `data:${img.mimeType};base64,${img.data}` },
                        })),
                    ],
                });
            }
        }
    }
    return normalizedMessages;
}
