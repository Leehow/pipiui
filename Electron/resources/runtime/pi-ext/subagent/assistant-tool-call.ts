/**
 * Normalize assistant tool-call parts and JSON-mode execution events.
 *
 * Pi-ai persists `{ type: "toolCall", name, arguments }`. JSON mode also
 * forwards provider-shaped parts (`tool_call` / `tool_use`) and official
 * `tool_execution_*` events. Skill loader tools are ordinary registerTool()
 * tools — they must take the same path as bash/read.
 */

import { projectToolResultMessageForParent } from "./rpc-stream.ts";

export type AssistantToolCall = {
	id?: string;
	name: string;
	arguments: Record<string, unknown>;
};

const TOOL_CALL_TYPES = new Set(["toolCall", "tool_call", "tool_use", "functionCall"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function asName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const name = value.trim();
	return name ? name : undefined;
}

function asArgs(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return asRecord(parsed) ?? {};
		} catch {
			return {};
		}
	}
	return asRecord(value) ?? {};
}

export function readAssistantToolCall(part: unknown): AssistantToolCall | undefined {
	const rec = asRecord(part);
	if (!rec) return undefined;
	const nested = asRecord(rec.toolCall) ?? asRecord(rec.functionCall) ?? asRecord(rec.function);
	const type = typeof rec.type === "string" ? rec.type : "";
	if (type && !TOOL_CALL_TYPES.has(type) && !nested) return undefined;
	if (!type && !nested) return undefined;
	const name =
		asName(rec.name)
		?? asName(nested?.name)
		?? asName(rec.toolName);
	if (!name) return undefined;
	const idRaw = rec.id ?? rec.toolCallId ?? nested?.id;
	const id = typeof idRaw === "string" && idRaw ? idRaw : undefined;
	const args = asArgs(rec.arguments ?? rec.input ?? rec.args ?? nested?.arguments ?? nested?.input ?? nested?.args);
	return { ...(id ? { id } : {}), name, arguments: args };
}

/** Map JSON-mode tool result events onto the legacy `tool_result_end.message` shape. */
export function toolResultMessageFromEvent(event: unknown): Record<string, unknown> | undefined {
	const rec = asRecord(event);
	if (!rec) return undefined;
	if (rec.type === "tool_result_end") {
		const message = asRecord(rec.message);
		return message ? { ...message } : undefined;
	}
	if (rec.type !== "tool_execution_end") return undefined;
	const result = rec.result;
	const resultRec = asRecord(result);
	const content = Array.isArray(resultRec?.content)
		? resultRec.content
		: Array.isArray((result as { content?: unknown } | undefined)?.content)
			? (result as { content: unknown[] }).content
			: typeof result === "string"
				? [{ type: "text", text: result }]
				: typeof resultRec?.content === "string"
					? [{ type: "text", text: resultRec.content }]
					: [];
	return {
		toolCallId: rec.toolCallId,
		toolName: rec.toolName,
		isError: !!rec.isError,
		content,
	};
}

export type ResultEventProjectionDeps = {
	/** Host activity bookkeeping: the run's tool window closed. */
	noteAgentToolEnd: () => void;
	/** Provider-wait bookkeeping keyed by toolCallId. */
	noteToolResult: (toolCallId: string) => void;
	/** Mark the in-flight tool finished (id preferred, name fallback). */
	finishActiveTool: (ref: { toolCallId?: string; name?: string }) => void;
	/** Emit one terminal `kind:"log"` batch to the host (UI toolResult row). */
	reportLog: (items: Array<Record<string, unknown>>) => void;
	/** emitUpdate + pipiuiUpdate after the projection. */
	onProjected?: () => void;
	/** Optional runtime policy observer for the same authoritative projected result. */
	onResult?: (result: { toolCallId: string; toolName?: string; isError: boolean }) => void;
};

/**
 * Project one JSON-mode tool-result event.
 *
 * pi 0.84+ delivers the authoritative tool result as its own `message_end`
 * (role "toolResult"), which the message_end handler already appends to the
 * run's history — appending a synthetic copy here would duplicate it in the
 * parent-visible message list. `tool_execution_end` therefore stays a pure
 * UI/progress projection; only the legacy `tool_result_end` event carried the
 * authoritative message itself and still appends.
 */
export function applyToolResultEvent(
	event: unknown,
	state: { messages: unknown[] },
	deps: ResultEventProjectionDeps,
): void {
	const resultEventMessage = toolResultMessageFromEvent(event);
	if (!resultEventMessage) return;
	deps.noteAgentToolEnd();
	const resultMsg: any = projectToolResultMessageForParent(resultEventMessage);
	if ((event as { type?: unknown })?.type === "tool_result_end") {
		state.messages.push(resultMsg);
	}
	deps.noteToolResult(String(resultMsg.toolCallId ?? ""));
	const endedId = typeof resultMsg.toolCallId === "string" && resultMsg.toolCallId
		? resultMsg.toolCallId
		: undefined;
	const endedName = typeof resultMsg.toolName === "string" && resultMsg.toolName
		? resultMsg.toolName
		: undefined;
	deps.onResult?.({
		toolCallId: endedId ?? "",
		...(endedName ? { toolName: endedName } : {}),
		isError: resultMsg.isError === true,
	});
	deps.finishActiveTool({ ...(endedId ? { toolCallId: endedId } : {}), ...(endedName ? { name: endedName } : {}) });
	const resultText = (
		Array.isArray(resultMsg.content)
			? resultMsg.content
				.filter((c: any) => c?.type === "text")
				.map((c: any) => c.text)
				.join("\n")
			: ""
	).slice(-1500);
	deps.reportLog([
		{
			itemType: "toolResult",
			name: resultMsg.toolName ?? "",
			isError: !!resultMsg.isError,
			text: resultText,
			...(endedId ? { toolCallId: endedId } : {}),
		},
	]);
	deps.onProjected?.();
}
