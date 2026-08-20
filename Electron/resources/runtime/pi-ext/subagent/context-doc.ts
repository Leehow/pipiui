/**
 * The shared half of N briefs, written once.
 *
 * Briefs must stand alone — a worker cannot see the Boss's context — and the orchestration
 * layer therefore tells the Boss to put everything a worker needs into the brief itself. That
 * is right for the half of a brief that is specific to one worker. It is waste for the half
 * that is identical across a wave: the shared architecture, the conventions, the decision that
 * every worker in this goal must respect. Retyping that into six briefs costs six copies of
 * the Boss's output, and the sixth copy is the one that quietly disagrees with the first.
 *
 * So that half moves to a document the Boss owns and briefs point at. The brief keeps the
 * per-worker instruction and adds one line naming this file; the worker reads it in a context
 * that was disposable anyway. Nothing about the standalone-brief rule changes — the worker
 * still receives everything it needs without seeing the Boss's context. It just receives the
 * shared part by reference.
 *
 * Single writer, deliberately. The Boss is the only role that may write here, and it is depth
 * 0, one process, one turn at a time. A wave of workers editing one document is the blackboard
 * problem: isolated worktrees, concurrent appends, lost updates, and a document that ends up
 * describing no one's design. Workers already have the two write paths they need — their own
 * worktree, and their report, which the runtime persists for them (findings-artifact.ts).
 *
 * Sections rather than an append-only log, because a shared design gets revised. A decision
 * that changed must be able to REPLACE what it changed; an append-only document forces the
 * reader to work out which of three contradictory paragraphs is current, and workers read this
 * file precisely because they cannot make that judgement.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { makeStrictJsonSchema } from "./strict-json-schema.ts";

/** One shared document per session, named like the ledger it sits beside. */
export function contextDocPath(mainCwd: string, sessionKey: string | undefined): string {
	const key = sessionKey?.trim() || "terminal";
	return path.join(mainCwd, ".pi", "context", `context-${key}.md`);
}

export const CONTEXT_DOC_TEMPLATE = [
	"# Shared context",
	"",
	"Written by the Boss, read by workers. Briefs name this file instead of restating what is",
	"here. If a section contradicts your brief, the brief wins for your task — say so in your",
	"report so the Boss can correct this file.",
	"",
].join("\n");

/** Section names are Boss-chosen: what is shared differs per goal. Keep them addressable. */
export function normalizeSectionName(raw: string): string | undefined {
	// Collapsing whitespace already flattens a multi-line name into a usable heading, so only
	// `#` — which would nest a heading inside this one — is worth refusing outright.
	const name = raw.trim().replace(/\s+/g, " ");
	if (!name || name.length > 80) return undefined;
	if (name.includes("#")) return undefined;
	return name;
}

export type ContextDocMode = "set" | "append";

/**
 * Replace or extend one `## <section>` block, creating it at the end when absent.
 *
 * `set` swaps the whole body under the heading — this is what makes a revised decision able to
 * erase the one it replaced. `append` adds to the end of the section for genuinely cumulative
 * notes. Both keep the surrounding sections untouched, so two edits in one turn never collide.
 */
export function upsertSection(content: string, section: string, body: string, mode: ContextDocMode): string {
	const heading = `## ${section}`;
	const lines = content.split("\n");
	const start = lines.findIndex((line) => line.trim() === heading);

	if (start === -1) {
		const base = content.replace(/\s+$/, "");
		return `${base}\n\n${heading}\n\n${body}\n`;
	}

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) { end = i; break; }
	}

	const existing = lines.slice(start + 1, end).join("\n").trim();
	const merged = mode === "append" && existing ? `${existing}\n\n${body}` : body;
	const rebuilt = [...lines.slice(0, start + 1), "", merged, "", ...lines.slice(end)];
	return rebuilt.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

/** Read the section names currently in the document, so a caller can list without parsing. */
export function listSections(content: string): string[] {
	const names: string[] = [];
	for (const line of content.split("\n")) {
		if (line.startsWith("## ")) names.push(line.slice(3).trim());
	}
	return names;
}

export interface ContextDocInput {
	mainCwd: string | undefined;
	sessionKey: string | undefined;
	section: string;
	body: string;
	mode: ContextDocMode;
}

export interface ContextDocResult {
	ok: boolean;
	file?: string;
	section?: string;
	sections?: string[];
	problem?: string;
}

export async function writeContextSection(input: ContextDocInput): Promise<ContextDocResult> {
	if (!input.mainCwd) {
		return { ok: false, problem: "No main project directory is known for this session (PIPIUI_MAIN_CWD is unset), so there is nowhere to write shared context." };
	}
	const section = normalizeSectionName(input.section);
	if (!section) {
		return { ok: false, problem: "Section must be non-empty plain text without `#`, at most 80 characters." };
	}
	const body = input.body.replace(/\s+$/, "");
	if (!body.trim()) return { ok: false, problem: "body is empty." };

	const file = contextDocPath(input.mainCwd, input.sessionKey);
	try {
		return await withFileMutationQueue(file, async () => {
			if (!fs.existsSync(file)) {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, CONTEXT_DOC_TEMPLATE, "utf-8");
			}
			const updated = upsertSection(fs.readFileSync(file, "utf-8"), section, body, input.mode);
			fs.writeFileSync(file, updated, "utf-8");
			return { ok: true, file, section, sections: listSections(updated) };
		});
	} catch (error) {
		return { ok: false, file, problem: error instanceof Error ? error.message : String(error) };
	}
}

const CONTEXT_DOC_MAX_BODY = 8_000;

/**
 * The `context_doc` tool definition. Like `ledger_note`, it is built here rather than at the
 * registration site so the schema and the failure text stay testable on their own.
 */
export function contextDocTool(session: { mainCwd: string | undefined; sessionKey: string | undefined }) {
	const text = (value: string, isError = false) => ({
		content: [{ type: "text" as const, text: value }],
		details: null,
		...(isError ? { isError: true } : {}),
	});
	return {
		name: "context_doc",
		label: "Shared Context",
		description: [
			"Write one named section of this goal's shared context document (.pi/context/), which workers read and you do not have to restate.",
			"Use it for what is identical across a wave — the shared architecture, the conventions, the decision every worker must respect — then name the file's path in each brief instead of retyping that half of the brief.",
			"`set` replaces the section (use it when a decision changes, so the superseded version is gone); `append` extends it.",
			"You are the only writer: workers read this file, never edit it. Per-worker instructions still belong in the brief itself, and worker findings are written for you at .pi/findings/<agentId>.md.",
			"Never blocks a dispatch: write the shared section before dispatching the wave that depends on it.",
		].join(" "),
		promptSnippet: "Write shared context workers can read instead of re-briefing",
		parameters: makeStrictJsonSchema(Type.Object({
			section: Type.String({ minLength: 1, maxLength: 80, description: "Short section name without `#`, e.g. `Shared architecture` or `Naming conventions`." }),
			body: Type.String({ minLength: 1, maxLength: CONTEXT_DOC_MAX_BODY, description: "Markdown body for the section. Multi-line is fine." }),
			mode: Type.Optional(Type.String({ description: "`set` (default) replaces the section; `append` extends it." })),
		}, { additionalProperties: false })),
		async execute(_toolCallId: string, params: { section: string; body: string; mode?: string }) {
			const mode: ContextDocMode = params.mode === "append" ? "append" : "set";
			if (params.mode !== undefined && params.mode !== "append" && params.mode !== "set") {
				return text(`Unknown mode "${params.mode}". Use "set" or "append".`, true);
			}
			const outcome = await writeContextSection({ ...session, section: params.section, body: params.body, mode });
			if (!outcome.ok) return text(`Shared context not written: ${outcome.problem}`, true);
			return text([
				`Wrote "${outcome.section}" (${mode}) to ${outcome.file}.`,
				`Sections now: ${outcome.sections?.join(", ") || "(none)"}.`,
				`Put this line in each brief that needs it: "Shared context: ${outcome.file} — read it first; it is authoritative for this goal."`,
			].join("\n"));
		},
	};
}

/**
 * Noticing the moment shared context is worth writing, instead of asking the Boss to foresee it.
 *
 * `context_doc` went unused in its first days on real traffic, and the reason is structural
 * rather than a missing prompt line. The ledger and the findings artifact both hook onto
 * something that has already happened — a decision made, a worker finished. This tool asks for
 * foresight: "the six briefs I am about to write will repeat the same architecture, so I should
 * write it once first." That is a prediction, made before the wave, and a rule that needs
 * predicting is a rule that gets skipped.
 *
 * The condition is trivially detectable after the fact, though: the second brief in a turn that
 * repeats a chunk of the first IS the case the tool exists for. So the runtime measures it and
 * says so at the dispatch where it becomes true — the same non-blocking nudge channel the
 * dispatch-shape validator already uses. The Boss does not have to remember anything; it has to
 * read a line that appears exactly when the line is worth reading.
 *
 * Deliberately advisory. The shared half cannot be extracted automatically without mangling
 * briefs whose overlap is coincidental, and a wave already in flight is not worth blocking over
 * a bookkeeping improvement.
 */

/** Below this, a repeated line is boilerplate coincidence, not shared briefing. */
const REPEAT_MIN_LINE_CHARS = 25;
/**
 * Enough repetition that writing it once is cheaper than repeating it again.
 *
 * Set low on purpose. The costs are asymmetric: a false positive is five advisory lines in one
 * tool result, while a false negative is this detector never firing — which is the failure it
 * exists to fix. Four pasted lines of shared briefing land near 400 characters, so the bar sits
 * below that; the ratio gate below is what actually rejects coincidental overlap.
 */
export const REPEAT_MIN_SHARED_CHARS = 300;
export const REPEAT_MIN_RATIO = 0.25;

function significantLines(brief: string): Map<string, number> {
	const lines = new Map<string, number>();
	for (const raw of brief.split("\n")) {
		const line = raw.trim().replace(/\s+/g, " ");
		if (line.length < REPEAT_MIN_LINE_CHARS) continue;
		lines.set(line, line.length);
	}
	return lines;
}

export interface RepeatedBriefMatch {
	/** The earlier dispatch in this turn whose brief this one repeats. */
	againstAgentId: string;
	sharedChars: number;
	/** Share of the smaller brief that is repeated, 0..1. */
	ratio: number;
}

export interface DispatchedBrief {
	/** The Boss-chosen id, when it gave one. Undefined dispatches are never "the same worker". */
	agentId?: string;
	/** What to call it in the nudge; falls back to a title or a placeholder. */
	label: string;
	brief: string;
}

/**
 * Compare one brief against the briefs already dispatched this turn.
 *
 * Line-level rather than token-level on purpose: a brief's shared half is pasted, so it repeats
 * whole lines, while two independently written briefs about the same subsystem share vocabulary
 * but not lines. Short lines are ignored so that bullets and headings cannot manufacture a match.
 */
export function detectRepeatedBrief(
	current_: DispatchedBrief,
	earlier: readonly DispatchedBrief[],
): RepeatedBriefMatch | undefined {
	const current = significantLines(current_.brief);
	if (current.size === 0) return undefined;
	const currentChars = [...current.values()].reduce((sum, n) => sum + n, 0);

	let best: RepeatedBriefMatch | undefined;
	for (const previous of earlier) {
		// Re-dispatching one agentId is continuation — the orchestration layer asks for it by
		// name, and the second brief repeating the first is what continuing looks like, not two
		// workers sharing a preamble. Observed firing on exactly this in real traffic
		// (`model-label` dispatched twice, 100% match), where the advice was simply wrong.
		// Both ids must be present: two unnamed dispatches are not "the same worker".
		if (current_.agentId && previous.agentId && current_.agentId === previous.agentId) continue;
		const other = significantLines(previous.brief);
		let sharedChars = 0;
		for (const [line, length] of current) if (other.has(line)) sharedChars += length;
		if (sharedChars < REPEAT_MIN_SHARED_CHARS) continue;
		const otherChars = [...other.values()].reduce((sum, n) => sum + n, 0);
		const ratio = sharedChars / Math.max(1, Math.min(currentChars, otherChars));
		if (ratio < REPEAT_MIN_RATIO) continue;
		if (!best || sharedChars > best.sharedChars) {
			best = { againstAgentId: previous.label, sharedChars, ratio };
		}
	}
	return best;
}

/** The nudge body, in the same shape as the dispatch-shape validator's. */
export function formatRepeatedBriefNudge(match: RepeatedBriefMatch, contextDocFile: string): string {
	return [
		`[shared-context] This brief repeats ~${Math.round(match.ratio * 100)}% of \`${match.againstAgentId}\`'s (${match.sharedChars} chars of identical lines).`,
		"That repeated half is the same briefing typed twice, and the copies drift: write it once with",
		`context_doc({section, body}), then name ${contextDocFile} in each brief instead of restating it.`,
		"Workers read that file; per-worker goal, scope and acceptance still belong in the brief itself.",
		"",
	].join("\n");
}
