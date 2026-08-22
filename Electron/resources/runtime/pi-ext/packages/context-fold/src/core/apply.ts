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
import type { AgentMessage, FoldOp } from "./block";
import { blockId, isDurableId } from "./block";

/**
 * Apply one message's in-place FoldOps. Returns the same message by reference when nothing
 * folds; clones lazily otherwise. Kind-guarded so a mis-mapped id can never fold the wrong part:
 * tool_call and any other kind are never folded.
 */
function foldOne(m: AgentMessage, i: number, byId: Map<string, FoldOp>, mark: () => void): AgentMessage {
	// PipiUI folds tool observations only. Assistant text and provider-signed thinking/reasoning
	// are immutable here: rewriting their bytes while retaining provider signatures is invalid,
	// and stripping signatures would destroy replay semantics.
	if (m.role === "assistant") return m;
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
	if (m.role === "toolResult") return [blockId(m, i)];
	return [];
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
