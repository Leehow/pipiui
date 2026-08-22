/*
 * unfold-tool.ts — the agent-facing reversibility surface.
 *
 * Two tools, modeled on Accordion's `unfold`/`recall` split:
 *   • recall(codes) — return the ORIGINAL full content of folded blocks AS a tool result THIS
 *     turn, WITHOUT changing standing context (the blocks stay folded). A read, not a state change.
 *   • unfold(codes) — re-expand folded blocks in the view from the next turn on (sticky). The
 *     content reaches the model at the next `context` hook; we don't echo it here.
 *
 * The agent reads the short `code` from a `{#<code> FOLDED}` tag in its context and passes it back.
 */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ContextFoldEngine, CodeMatch, CodeError } from "./store";

const CODES_PARAMS = Type.Object({
	codes: Type.Array(Type.String(), {
		description: "One or more fold codes from {#<code> FOLDED} tags in your context (bare code or the full tag).",
	}),
});

/** recall also takes optional partial-retrieval params — query a large folded result, don't dump it. */
const RECALL_PARAMS = Type.Object({
	codes: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Fold codes from {#<code> FOLDED} tags in your context (bare code or the full tag). Omit when using `search` to sweep every folded block at once.",
		}),
	),
	grep: Type.Optional(
		Type.String({
			description: "Return only lines containing this text (case-insensitive). Ideal for pulling one detail out of a large folded result.",
		}),
	),
	lines: Type.Optional(
		Type.String({
			description: 'Return only a line range, 1-based inclusive, e.g. "40-80".',
		}),
	),
	search: Type.Optional(
		Type.String({
			description:
				"Pointer lookup: find WHICH folded block holds a known identifier (one bounded sweep, matching lines grouped by code). Use before guessing codes; follow up with a grep/lines slice.",
		}),
	),
});

function summarize(matches: CodeMatch[], missing: string[], errors: CodeError[] = []): string {
	const lines: string[] = [];
	for (const m of matches) lines.push(`✓ ${m.code} — ${m.label}${m.note ? ` · ${m.note}` : ""}`);
	for (const e of errors) lines.push(`⚠ ${e.code} — ${e.message}`);
	for (const code of missing) lines.push(`✗ ${code} — no folded block with that code`);
	return lines.join("\n");
}

export function registerFoldTools(pi: ExtensionAPI, engine: ContextFoldEngine, onUnfold?: (ids: string[]) => void): void {
	pi.registerTool({
		name: "recall_folded",
		label: "Recall folded context",
		description:
			"FALLBACK: read back a folded context block when its {#<code> FOLDED} marker hides a detail " +
			"the CURRENT step needs. Output is bounded: whole reads are token-capped; slice with " +
			"grep=<term> / lines=<a-b>. search=<term> (no codes) is a pointer lookup — it names which " +
			"folded block holds a known identifier. Read-only: blocks stay folded. If the information " +
			"is cheaply available another way (rerun the command, read the file), do that instead.",
		promptSnippet: "fallback read of folded content when a {#code FOLDED} pointer blocks the current step.",
		promptGuidelines: [
			"recall_folded is a fallback, not a browsing tool. Know the identifier but not which pointer holds it? recall_folded search=<term> names the folded block(s); then slice with grep=<term> or lines=<a-b>.",
			"If you need most of a broad shell result, rerun a narrower command instead of paging it through many recall_folded calls.",
		],
		parameters: RECALL_PARAMS,
		async execute(_toolCallId, params) {
			type RecallDetails = { recalled?: string[]; missing?: string[]; errors?: string[]; searched?: string; hits?: string[] };
			const codes = params.codes ?? [];
			if (params.search && codes.length === 0) {
				const { hits, note } = engine.searchFolded(params.search);
				const body = hits.map((h) => `=== ${h.code} (${h.label}) ===\n${h.lines.join("\n")}`).join("\n\n");
				const text = hits.length
					? `search "${params.search}" — ${note}\n\n${body}`
					: `search "${params.search}" — no matching lines in any folded block (${note})`;
				const details: RecallDetails = { searched: params.search, hits: hits.map((h) => h.code) };
				return { content: [{ type: "text" as const, text }], details };
			}
			if (codes.length === 0) {
				const details: RecallDetails = {};
				return {
					content: [{ type: "text" as const, text: "No codes provided (pass codes, or search=<term> to sweep all folded blocks)." }],
					details,
				};
			}
			// codes + search but no grep: treat search as the slice term for those codes.
			const grep = params.grep ?? params.search;
			const { matches, missing, errors } = engine.resolveRecall(codes, { grep, lines: params.lines });
			const body = matches.map((m) => `=== ${m.code} (${m.label})${m.note ? ` — ${m.note}` : ""} ===\n${m.text}`).join("\n\n");
			const header = summarize(matches, missing, errors);
			const text = matches.length ? `${header}\n\n${body}` : header || "No codes provided.";
			const details: RecallDetails = { recalled: matches.map((m) => m.code), missing, errors: errors.map((e) => e.code) };
			return { content: [{ type: "text" as const, text }], details };
		},
	});

	pi.registerTool({
		name: "unfold",
		label: "Unfold context",
		description:
			"Re-expand one or more folded context blocks back to full content, identified by the short " +
			"code in their {#<code> FOLDED} tag. The full content returns to your context from your next " +
			"turn on (sticky). Use recall_folded instead for a one-time read.",
		promptSnippet: "permanently re-expand folded blocks back to full content.",
		promptGuidelines: [
			"Unfold only a block your ongoing work keeps needing. It re-expands permanently and costs its full token weight every turn after.",
		],
		parameters: CODES_PARAMS,
		async execute(_toolCallId, params) {
			const { matches, missing, compacted } = engine.markUnfold(params.codes);
			onUnfold?.(matches.flatMap((m) => m.ids)); // persist the unfold so it survives resume
			// A compacted code is real but un-expandable: its raw message left live history at hard
			// compaction. Point at recall, which still serves the spooled content.
			const compactedLines = compacted.map(
				(c) => `⚠ ${c} — compacted out of live history; nothing to re-expand. Use recall_folded ${c} (grep=<term> / lines=<a-b>) to read it.`,
			);
			const header = [summarize(matches, missing), ...compactedLines].filter(Boolean).join("\n");
			const text = matches.length
				? `${header}\n\nExpanded ${matches.length} block(s); full content returns on your next turn.`
				: header || "No codes provided.";
			return { content: [{ type: "text", text }], details: { unfolded: matches.map((m) => m.code), missing, compacted } };
		},
	});
}
