/**
 * The Boss's only write.
 *
 * With the main session read-only (`bossReadOnly` in the host's spawn features), `write` and
 * `edit` are gone from the Boss's tool set. One write it genuinely owns survives that: the
 * judgement half of its own ledger — Decisions, Done, Risks & open questions — which no
 * dispatch or completion event can carry and which is exactly what a compaction would
 * otherwise erase.
 *
 * So the capability is restored as a tool that can reach nothing else. It appends a line to
 * one of three named sections of this session's `.pi/boss/ledger-<key>.md`. There is no path
 * parameter, no arbitrary content placement, and no way to address another session's ledger.
 * That is strictly narrower than the `write` it replaces, which is the point: the Boss did
 * not need general file writes to do bookkeeping, it needed bookkeeping.
 *
 * The runtime-owned `## Tasks` and `## Closeout dispositions` tables are deliberately not
 * addressable here. They are written from real events, and a hand-written row there is a
 * second copy of state the runtime already holds — the copy that goes stale.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { LEDGER_TEMPLATE, ledgerPath } from "./boss-ledger.ts";

/** The three headings whose content is the Boss's judgement rather than a runtime event. */
export const BOSS_LEDGER_SECTIONS = Object.freeze({
	decisions: "## Decisions",
	done: "## Done",
	risks: "## Risks & open questions",
});

export type BossLedgerSection = keyof typeof BOSS_LEDGER_SECTIONS;

export function isBossLedgerSection(value: unknown): value is BossLedgerSection {
	return typeof value === "string" && Object.hasOwn(BOSS_LEDGER_SECTIONS, value);
}

/** One note is one line: a ledger is scanned, not read. Newlines would break that. */
function flatten(note: string): string {
	return note.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Insert `line` at the end of `heading`'s section, before the next `## ` heading.
 *
 * Appending at the end of the section rather than directly under the heading keeps the
 * sections in chronological order, which is how they are read back after a compaction.
 * Returns undefined when the heading is absent, so a hand-mangled ledger is left alone
 * rather than repaired by guesswork.
 */
export function insertUnderHeading(content: string, heading: string, line: string): string | undefined {
	const lines = content.split("\n");
	const headingIndex = lines.findIndex((l) => l.trim() === heading);
	if (headingIndex === -1) return undefined;

	let end = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) { end = i; break; }
	}
	// Trailing blank lines belong to the gap before the next heading, not to this section.
	let insertAt = end;
	while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;

	lines.splice(insertAt, 0, line);
	return lines.join("\n");
}

export interface LedgerNoteInput {
	mainCwd: string | undefined;
	sessionKey: string | undefined;
	section: BossLedgerSection;
	note: string;
}

export interface LedgerNoteResult {
	ok: boolean;
	file?: string;
	problem?: string;
}

/**
 * Append one note. Unlike the runtime's own row upserts — which are bookkeeping that must
 * never fail a dispatch — this one reports its errors: the Boss called it deliberately and a
 * silently dropped decision is worse than a visible failure.
 */
export async function appendLedgerNote(input: LedgerNoteInput): Promise<LedgerNoteResult> {
	if (!input.mainCwd) return { ok: false, problem: "No main project directory is known for this session (PIPIUI_MAIN_CWD is unset), so there is no ledger to write to." };
	const heading = BOSS_LEDGER_SECTIONS[input.section];
	const line = `- ${flatten(input.note)}`;
	if (line === "- ") return { ok: false, problem: "note is empty after whitespace normalization." };

	const file = ledgerPath(input.mainCwd, input.sessionKey);
	try {
		return await withFileMutationQueue(file, async () => {
			if (!fs.existsSync(file)) {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, LEDGER_TEMPLATE, "utf-8");
			}
			const content = fs.readFileSync(file, "utf-8");
			const updated = insertUnderHeading(content, heading, line);
			if (updated === undefined) {
				return { ok: false, file, problem: `The ledger has no \`${heading}\` heading. It was hand-edited or predates this layout; nothing was written.` };
			}
			fs.writeFileSync(file, updated, "utf-8");
			return { ok: true, file };
		});
	} catch (error) {
		return { ok: false, file, problem: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The `ledger_note` tool definition, built here rather than at the registration site so the
 * schema, the section vocabulary and the failure text can be tested without loading the
 * whole subagent extension.
 */
export function bossLedgerNoteTool(session: { mainCwd: string | undefined; sessionKey: string | undefined }) {
	const sections = Object.keys(BOSS_LEDGER_SECTIONS).join(" | ");
	const text = (value: string, isError = false) => ({
		content: [{ type: "text" as const, text: value }],
		details: null,
		...(isError ? { isError: true } : {}),
	});
	return {
		name: "ledger_note",
		label: "Ledger Note",
		description: [
			`Append one line to a Boss-owned section of this session's ledger (.pi/boss/): ${sections}.`,
			"This is the Boss's only write. Use it for the judgement no dispatch or completion event carries — why a route was chosen, what a result actually means, what is still unknown — so it survives context compaction.",
			"The runtime-owned Tasks and Closeout tables are not writable here: they are maintained from real dispatch and completion events, and a hand-written row is the copy that goes stale. Read them with the read tool.",
			"Never blocks a dispatch: record after dispatching, never before.",
		].join(" "),
		promptSnippet: "Record a decision / outcome / risk in the boss ledger",
		parameters: Type.Object({
			section: Type.String({ description: `One of: ${sections}` }),
			note: Type.String({ minLength: 1, maxLength: 2_000, description: "One line. Newlines are collapsed to spaces." }),
		}, { additionalProperties: false }),
		async execute(_toolCallId: string, params: { section: string; note: string }) {
			if (!isBossLedgerSection(params.section)) {
				return text(`Unknown section "${params.section}". Valid sections: ${Object.keys(BOSS_LEDGER_SECTIONS).join(", ")}.`, true);
			}
			const outcome = await appendLedgerNote({ ...session, section: params.section, note: params.note });
			return outcome.ok
				? text(`Recorded under ${BOSS_LEDGER_SECTIONS[params.section]} in ${outcome.file}.`)
				: text(`Ledger note not written: ${outcome.problem}`, true);
		},
	};
}
