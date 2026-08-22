/*
 * helpers.ts — fixture builders + provider-safety assertions for the tests. Builds AgentMessage
 * arrays in the exact structural shape Pi uses (verified against Pi's types).
 */
import type { AgentMessage } from "../src/core/block";
import { linearize } from "../src/core/block";

let ts = 1_000;
const nextTs = () => ts++;

export function user(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: nextTs() };
}

export function assistantText(text: string, responseId = `r${nextTs()}`): AgentMessage {
	return { role: "assistant", content: [{ type: "text", text }], responseId, model: "test", timestamp: nextTs() };
}

/** An assistant message with one or more parallel tool calls (+ optional leading text/thinking). */
export function assistantWithCalls(
	calls: { id: string; name: string; args?: Record<string, unknown> }[],
	opts: { text?: string; thinking?: string; responseId?: string } = {},
): AgentMessage {
	const content: any[] = [];
	if (opts.thinking) content.push({ type: "thinking", thinking: opts.thinking });
	if (opts.text) content.push({ type: "text", text: opts.text });
	for (const c of calls) content.push({ type: "toolCall", id: c.id, name: c.name, arguments: c.args ?? {} });
	return { role: "assistant", content, responseId: opts.responseId ?? `r${nextTs()}`, model: "test", timestamp: nextTs() };
}

export function toolResult(toolCallId: string, text: string, toolName = "read", isError = false): AgentMessage {
	return { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: nextTs() };
}

/** A big tool result (lots of lines) to drive token pressure. */
export function bigResult(toolCallId: string, lines: number, toolName = "read"): AgentMessage {
	const body = Array.from({ length: lines }, (_, i) => `line ${i}: ${"x".repeat(40)}`).join("\n");
	return toolResult(toolCallId, body, toolName);
}

// ── provider-safety assertions ───────────────────────────────────────────────

/** Collect tool_call ids and tool_result ids present in a message array. */
export function toolPairIds(messages: AgentMessage[]): { calls: Set<string>; results: Set<string> } {
	const calls = new Set<string>();
	const results = new Set<string>();
	for (const m of messages) {
		if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const p of m.content as any[]) if (p?.type === "toolCall" && p.id) calls.add(p.id);
		} else if (m.role === "toolResult" && m.toolCallId) {
			results.add(m.toolCallId);
		}
	}
	return { calls, results };
}

/** True iff every tool_call has a matching tool_result and vice versa (the provider invariant). */
export function isBalanced(messages: AgentMessage[]): boolean {
	const { calls, results } = toolPairIds(messages);
	for (const c of calls) if (!results.has(c)) return false;
	for (const r of results) if (!calls.has(r)) return false;
	return true;
}

/** Total estimated tokens of a message array (re-linearize and sum block tokens). */
export function liveTokensOf(messages: AgentMessage[]): number {
	return linearize(messages).reduce((n, b) => n + b.tokens, 0);
}
