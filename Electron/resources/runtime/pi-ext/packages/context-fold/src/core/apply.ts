/*
 * apply.ts — the load-bearing fold-plan applier.
 *
 *   applyPlan(messages, ops) → messages   (the wire rewrites; provider-safe)
 *
 * Content substitution, never structural removal: a folded block stays in the array and keeps its
 * callId, and no message is ever added or removed. Provider-safety is therefore STRUCTURAL rather
 * than enforced — a tool_call/tool_result pair cannot orphan when the message count never changes.
 *
 * Returns a NEW array (touched messages cloned; untouched passed by reference). Pure: the
 * caller's array is never mutated. Ported from Accordion `live/mapping.ts:applyPlan`/`foldOne`
 * (pinned commit 0c22434).
 */
import { createHash } from "node:crypto";
import type { AgentMessage, FoldOp } from "./block";
import { blockId, isDurableId } from "./block";
import { foldCode } from "./digest";

/**
 * Apply one message's in-place FoldOps. Returns the same message by reference when nothing
 * folds; clones lazily otherwise. Kind-guarded so a mis-mapped id can never fold the wrong part:
 * only text-only tool results and allowlisted subagent arguments can change.
 */
function foldOne(m: AgentMessage, i: number, byId: Map<string, FoldOp>, mark: () => void): AgentMessage {
	// Assistant text and provider-signed thinking/reasoning are immutable. The sole assistant-side
	// exception is an allowlisted subagent toolCall's arguments object; every sibling part and every
	// signature-bearing field is retained byte-for-byte/by reference.
	if (m.role === "assistant" && Array.isArray(m.content)) {
		let changed = false;
		const content = (m.content as any[]).map((part, partIndex) => {
			if (part?.type !== "toolCall" || part.name !== "subagent") return part;
			const id = blockId(m, i, partIndex);
			const op = byId.get(id);
			const receipt = op ? parseToolCallReceipt(op.digestText, id, part.arguments) : null;
			if (!receipt) return part;
			changed = true;
			return { ...part, arguments: receipt };
		});
		if (changed) {
			mark();
			return { ...m, content: content as any };
		}
		return m;
	}
	if (m.role === "toolResult") {
		const op = byId.get(blockId(m, i));
		if (op && op.digestText) {
			mark();
			return { ...m, content: [{ type: "text", text: op.digestText }] as any };
		}
		return m;
	}
	return m; // user / other: never folded
}

/** The foldable positions' ids for one message — the exact set foldOne would look up. */
function foldableIdsOf(m: AgentMessage, i: number): string[] {
	if (m.role === "assistant" && Array.isArray(m.content)) {
		return (m.content as any[])
			.map((part, partIndex) => (part?.type === "toolCall" && part.name === "subagent" ? blockId(m, i, partIndex) : null))
			.filter((id): id is string => id !== null);
	}
	if (m.role === "toolResult") return [blockId(m, i)];
	return [];
}

function parseToolCallReceipt(text: string, id: string, originalArgs: unknown): Record<string, unknown> | null {
	try {
		const value = JSON.parse(text) as Record<string, unknown>;
		const original = JSON.stringify(originalArgs ?? {});
		if (
			value?._contextFold !== "historical subagent arguments folded" ||
			value.code !== foldCode(id) ||
			typeof value.hash !== "string" ||
			value.hash !== createHash("sha256").update(original, "utf8").digest("hex") ||
			value.originalChars !== original.length ||
			typeof value.preview !== "string"
		) return null;
		return value;
	} catch {
		return null;
	}
}

/**
 * Apply a fold plan to the messages and return a NEW array. Every op is an in-place content
 * substitution, kind-guarded. On ANY doubt a message passes through untouched; the output is
 * never structurally invalid (no orphaned tool pair, no emptied message).
 */
export function applyPlan(messages: AgentMessage[], ops: FoldOp[]): AgentMessage[] {
	// Defense in depth: refuse any op whose id is NOT durable or whose digest is empty. Cannot
	// trust the caller's SHAPE, not just its values.
	const safeOps = (ops ?? []).filter(
		(o) => o && typeof o.id === "string" && isDurableId(o.id) && typeof o.digestText === "string" && o.digestText,
	);
	if (!safeOps.length) return messages;

	// Refuse any op whose id resolves to MORE than one position. Timestamp-fallback anchors can
	// collide (two messages, no responseId, same millisecond), and an op applied by id would then
	// rewrite every collider with one block's digest. An ambiguous id is not durably re-identifiable,
	// so it is never folded — the blocks render raw, which is the fail-open direction.
	const seen = new Set<string>();
	const ambiguous = new Set<string>();
	messages.forEach((m, i) => {
		for (const id of foldableIdsOf(m, i)) {
			if (seen.has(id)) ambiguous.add(id);
			else seen.add(id);
		}
	});
	const applicable = ambiguous.size ? safeOps.filter((o) => !ambiguous.has(o.id)) : safeOps;
	if (!applicable.length) return messages;

	const byId = new Map(applicable.map((o) => [o.id, o] as const));

	let changed = false;
	const mark = () => {
		changed = true;
	};
	const out = messages.map((m, i) => foldOne(m, i, byId, mark));
	return changed ? out : messages;
}
