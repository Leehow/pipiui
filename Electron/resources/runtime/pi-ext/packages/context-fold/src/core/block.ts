/*
 * block.ts — the harness-agnostic block model + the message↔block bridge.
 *
 * The atomic unit is a BLOCK: a typed slice of a single message. One assistant message
 * explodes into several blocks (its thinking, its reply text, each tool call). A tool call
 * and the tool result that answers it are SEPARATE blocks — shown together but folded
 * independently, because their value to the agent decays at very different rates.
 *
 * This file is PURE and has ZERO harness dependencies. It models only the structural shape
 * of a provider message (`AgentMessage`) — the exact fields `linearize`/`foldOne`
 * read. A harness adapter casts its real message array to `AgentMessage[]` at the boundary;
 * that cast is the documented seam (see adapters/pi/index.ts, the `context` hook).
 *
 * Block ids are durable and content-anchored — identical whether derived now or after the
 * message array shifts position:
 *   • user          → `u:<timestamp>`
 *   • assistant part j (thinking/text/tool_call) → `a:<responseId ?? "t"+timestamp>:p<j>`
 *   • tool_result   → `r:<toolCallId>`
 *   • summary/other → `s:<timestamp>`
 * Fallback (missing anchor): positional `m<i>:…` — NOT durable, never folded.
 *
 * Ported from Accordion `engine/types.ts`, `live/protocol.ts`, and `live/mapping.ts`
 * (pinned commit 0c22434), stripped of Svelte/reactive state.
 */
import { estTokens, BLOCK_OVERHEAD } from "./tokens";

// ── Block kinds & fold-state vocabulary ──────────────────────────────────────

export type BlockKind =
	| "user" // the human's instruction/intent — highest durable value
	| "text" // an assistant reply / conclusion
	| "thinking" // ephemeral assistant reasoning
	| "tool_call" // WHAT the agent did (tiny, durable record of an action)
	| "tool_result"; // WHAT the agent saw (often huge, decays fast)

/**
 * The minimal content surface the digest functions read. `WireBlock` satisfies it, so digests
 * can be computed without converting. (Keyed by object identity in the digest WeakMap cache —
 * see digest.ts.)
 */
export interface DigestBlock {
	id: string;
	kind: BlockKind;
	text: string;
	tokens: number;
	toolName?: string;
	isError?: boolean;
}

// ── Wire types (the lowered fold plan applyPlan consumes) ────────────────────

/** A serialisable block — the wire form of a Block minus the mutable fold state. */
export interface WireBlock {
	id: string;
	kind: BlockKind;
	turn: number;
	order: number;
	text: string;
	tokens: number;
	toolName?: string;
	callId?: string;
	model?: string;
	isError?: boolean;
	/** The block's message carries non-text parts (e.g. an image) that linearize cannot see —
	 *  folding it would silently drop them from the view, so it is never foldable. */
	opaque?: boolean;
}

/** One fold instruction: replace block `id`'s content with `digestText` (carries the {#code} tag). */
export interface FoldOp {
	id: string;
	digestText: string;
}

// ── Structural model of a provider message (the harness seam) ────────────────

export interface TextPart {
	type: "text";
	text: string;
}
export interface ThinkingPart {
	type: "thinking";
	thinking: string;
}
export interface ToolCallPart {
	type: "toolCall";
	id: string;
	name: string;
	arguments?: Record<string, unknown>;
}
export type MessagePart = TextPart | ThinkingPart | ToolCallPart | { type: string; [k: string]: unknown };

/**
 * The structural shape of one provider message — only the fields the bridge reads. A harness
 * adapter casts its real message array to `AgentMessage[]`; this interface is intentionally
 * permissive so that cast is total.
 */
export interface AgentMessage {
	role: string;
	content?: string | MessagePart[] | Array<{ type: string; text?: string }>;
	model?: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	summary?: string;
	/** Set once at message creation; primary anchor for user/summary/assistant-fallback ids. */
	timestamp?: number;
	/** Provider-assigned response id; preferred anchor for assistant-message part ids. */
	responseId?: string;
}

// ── Durable, content-anchored ids ────────────────────────────────────────────

/**
 * Compute a durable, content-anchored block id that is IDENTICAL regardless of where the
 * message sits in the array. Both `linearize` and `applyPlan` MUST call this — never inline
 * the formula — so the two can never drift.
 */
export function blockId(m: AgentMessage, i: number, partIndex?: number): string {
	switch (m.role) {
		case "user":
			return m.timestamp != null ? `u:${m.timestamp}` : `m${i}:u`;
		case "assistant": {
			if (partIndex == null) return `m${i}:p?`; // defensive only
			const anchor = m.responseId != null ? m.responseId : m.timestamp != null ? `t${m.timestamp}` : null;
			return anchor != null ? `a:${anchor}:p${partIndex}` : `m${i}:p${partIndex}`;
		}
		case "toolResult":
			return m.toolCallId != null ? `r:${m.toolCallId}` : `m${i}:r`;
		default:
			return m.timestamp != null ? `s:${m.timestamp}` : `m${i}:s`;
	}
}

/**
 * Is `id` a durable, content-anchored id (vs a positional fallback)? Positional `m<i>:…` ids
 * encode the current array index, which is NOT stable once folding makes the array
 * non-append-only — so we must never fold a block we can't durably re-identify. Kept in
 * lockstep with the formats `blockId` produces.
 */
export function isDurableId(id: string): boolean {
	return id.startsWith("u:") || id.startsWith("a:") || id.startsWith("r:") || id.startsWith("s:");
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.filter((b): b is { type: string; text: string } => !!b && (b as any).type === "text" && typeof (b as any).text === "string")
			.map((b) => b.text)
			.join("\n");
	return "";
}

const tokensFor = (text: string): number => estTokens(text) + BLOCK_OVERHEAD;

/**
 * Linearize a provider message array into wire blocks. Pure, deterministic: same messages →
 * same blocks/ids. One assistant message explodes into per-part blocks; user, tool_result,
 * summary each → one block. `order` = global 0-based counter; `turn` increments on each user
 * message. Empty non-result parts are dropped (parity with the on-disk parser).
 */
export function linearize(messages: AgentMessage[]): WireBlock[] {
	const out: WireBlock[] = [];
	let order = 0;
	let turn = 0;

	const push = (
		id: string,
		kind: WireBlock["kind"],
		text: string,
		extra: Partial<Pick<WireBlock, "toolName" | "callId" | "model" | "isError" | "opaque">> = {},
	) => {
		if (!text && kind !== "tool_result") return; // drop empty non-results
		out.push({ id, kind, turn, order: order++, text, tokens: tokensFor(text), ...extra });
	};

	messages.forEach((m, i) => {
		switch (m.role) {
			case "user": {
				turn += 1;
				push(blockId(m, i), "user", textOf(m.content));
				break;
			}
			case "assistant": {
				const parts = Array.isArray(m.content) ? (m.content as MessagePart[]) : [];
				parts.forEach((b, j) => {
					if (b?.type === "thinking") push(blockId(m, i, j), "thinking", (b as ThinkingPart).thinking || "", { model: m.model });
					else if (b?.type === "text") push(blockId(m, i, j), "text", (b as TextPart).text || "", { model: m.model });
					else if (b?.type === "toolCall") {
						const c = b as ToolCallPart;
						push(blockId(m, i, j), "tool_call", `${c.name} ${JSON.stringify(c.arguments ?? {})}`, {
							toolName: c.name,
							callId: c.id,
							model: m.model,
						});
					}
				});
				break;
			}
			case "toolResult": {
				const hasNonText = Array.isArray(m.content) && (m.content as any[]).some((b) => b && (b as any).type !== "text");
				push(blockId(m, i), "tool_result", textOf(m.content), {
					toolName: m.toolName || "tool",
					callId: m.toolCallId,
					isError: !!m.isError,
					...(hasNonText ? { opaque: true } : {}),
				});
				break;
			}
			default: {
				if (typeof m.summary === "string" && m.summary) push(blockId(m, i), "text", m.summary);
			}
		}
	});

	return out;
}
