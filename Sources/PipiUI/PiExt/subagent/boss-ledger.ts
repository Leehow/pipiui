/**
 * Boss ledger: the seed template plus the runtime-owned `## Tasks` table.
 *
 * The boss used to hand-write those rows, and the orchestration layer told it to do so *before*
 * dispatching. Two things went wrong with that. Every new user task began with a file write and
 * a `pending` row — a queue in exactly the place the fan-out layer says a queue must never form
 * — and the hand-kept table drifted anyway: duplicate ids, a row still `pending` next to a
 * `done` row for the same work, a stray blank line splitting the table in half.
 *
 * Dispatch and completion events already carry every column this table holds, so the runtime
 * writes it and the boss only reads it. What stays with the boss is the half no event can
 * carry: Decisions, Done, Risks & open questions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

let seededLedger = false;

/** Runtime task states. There is deliberately no `pending`: a row exists once someone owns it. */
export type LedgerTaskStatus = "in-flight" | "done" | "failed" | "aborted" | "interrupted";

const TASKS_HEADING = "## Tasks";
const TASKS_HEADER_ROW = "| ID | title | role | wave | status | notes |";
const TASKS_DIVIDER_ROW = "| -- | ----- | ---- | ---- | ------ | ----- |";

/**
 * One wave is one `subagent` tool invocation, however many tasks it carries. The counter is
 * per-process and advisory: it exists so a reader can see at a glance which rows went out
 * together, which is the distinction the fan-out layer is built around.
 */
let waveCounter = 0;

/** Called once at the top of the subagent tool, before any task in this call is dispatched. */
export function beginWave(): void {
	waveCounter += 1;
}

/** Exported so the Boss's own note tool writes to exactly the file the runtime maintains. */
export function ledgerPath(mainCwd: string, sessionKey: string | undefined): string {
	const key = sessionKey?.trim() || "terminal";
	return path.join(mainCwd, ".pi", "boss", `ledger-${key}.md`);
}

/**
 * The seeded layout. Exported because `ledger_note` may be the first thing that touches a
 * session's ledger — a Boss that records a decision before it dispatches must not end up
 * with a file whose headings the runtime's own upserts cannot find.
 */
export const LEDGER_TEMPLATE = [
	"# Ledger",
	"<one-line session goal>",
	"",
	"## Decisions",
	"<!-- user mid-course changes / additions / cancellations: time + content + affected task IDs -->",
	"",
	TASKS_HEADING,
	"<!-- Runtime-owned: written from real dispatch and completion events. Do not hand-edit. -->",
	TASKS_HEADER_ROW,
	TASKS_DIVIDER_ROW,
	"",
	"## Done",
	"<!-- one line per finished task: conclusion + key evidence (file paths / command results) -->",
	"",
	"## Risks & open questions",
	"",
	"## Closeout dispositions",
	"| item | disposition | evidence/reason |",
	"| ---- | ----------- | --------------- |",
	"<!-- disposition: cleaned | retained | needs-fixer | needs-user -->",
	"",
].join("\n");

/**
 * Seed the boss ledger the first time this session actually dispatches.
 *
 * The layout used to live in the system prompt — roughly 380 tokens of template resident on
 * every turn so that it would be correct on the few turns that write it. Creating the file
 * with its sections already laid out puts the format where it is used and costs nothing per
 * turn. Never overwrites: an existing ledger is the session's own state.
 */
export function seedBossLedger(mainCwd: string | undefined, sessionKey: string | undefined): void {
	if (seededLedger || !mainCwd) return;
	seededLedger = true;
	const file = ledgerPath(mainCwd, sessionKey);
	try {
		if (fs.existsSync(file)) return;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, LEDGER_TEMPLATE, "utf-8");
	} catch {
		// The boss can still create it itself; never fail a dispatch over bookkeeping.
	}
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

/** Markdown table cells cannot carry a pipe or a newline, and stay short enough to scan. */
function cell(value: string | undefined, cap: number): string {
	const flat = (value ?? "")
		.replace(/\r?\n/g, " ")
		.replace(/\|/g, "/")
		.trim();
	return flat.length > cap ? `${flat.slice(0, cap - 1)}…` : flat;
}

interface TaskRow {
	agentId: string;
	title: string;
	role: string;
	wave: string;
	status: LedgerTaskStatus;
	notes: string;
}

function renderRow(row: TaskRow): string {
	return `| ${cell(row.agentId, 40)} | ${cell(row.title, 60)} | ${cell(row.role, 20)} | ${cell(row.wave, 6)} | ${row.status} | ${cell(row.notes, 80)} |`;
}

/** The id cell of an existing row, or undefined when the line is not a task row. */
function rowId(line: string): string | undefined {
	if (!line.startsWith("|")) return undefined;
	const first = line.slice(1).split("|")[0]?.trim();
	if (!first || first === "ID" || /^-+$/.test(first)) return undefined;
	return first;
}

/** Column 4 of an existing row, so a terminal update keeps the wave its dispatch assigned. */
function rowWave(line: string): string | undefined {
	const cells = line.split("|");
	// ["", id, title, role, wave, status, notes, ""]
	return cells.length >= 6 ? cells[4]?.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Replace the row for `agentId`, or append one. Best-effort by design: a ledger that is
 * missing, hand-mangled, or has no `## Tasks` heading is left exactly as it is rather than
 * repaired, because guessing at a damaged table is how the old hand-written one got worse.
 */
function upsertTaskRow(content: string, row: TaskRow): string | undefined {
	const lines = content.split("\n");
	const headingIndex = lines.findIndex((l) => l.trim() === TASKS_HEADING);
	if (headingIndex === -1) return undefined;

	// The section runs to the next heading; the table is the run of `|` lines inside it.
	let end = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) {
			end = i;
			break;
		}
	}

	// Only ever write into a table this code laid out. Ledgers seeded before the runtime owned
	// this section carry a different, wider header, and appending our narrower rows to one — or
	// reading its `agent` column as our `wave` — would corrupt a file the boss still relies on.
	let lastRowIndex = -1;
	let sawOurHeader = false;
	for (let i = headingIndex + 1; i < end; i++) {
		if (!lines[i].startsWith("|")) continue;
		if (lines[i].trim() === TASKS_HEADER_ROW) sawOurHeader = true;
		lastRowIndex = i;
		if (sawOurHeader && rowId(lines[i]) === row.agentId) {
			lines[i] = renderRow({ ...row, wave: row.wave || rowWave(lines[i]) || "" });
			return lines.join("\n");
		}
	}

	if (lastRowIndex === -1 || !sawOurHeader) return undefined;
	lines.splice(lastRowIndex + 1, 0, renderRow(row));
	return lines.join("\n");
}

async function writeTaskRow(
	mainCwd: string | undefined,
	sessionKey: string | undefined,
	row: TaskRow,
): Promise<void> {
	if (!mainCwd) return;
	const file = ledgerPath(mainCwd, sessionKey);
	try {
		// Parallel waves dispatch concurrently; without the queue two rows race and one is lost.
		await withFileMutationQueue(file, async () => {
			if (!fs.existsSync(file)) return;
			const content = fs.readFileSync(file, "utf-8");
			const updated = upsertTaskRow(content, row);
			if (updated === undefined || updated === content) return;
			fs.writeFileSync(file, updated, "utf-8");
		});
	} catch {
		// Bookkeeping never fails a dispatch or a completion.
	}
}

/** Record a dispatch the moment it happens. Called after the worker is actually launched. */
export function recordTaskDispatch(input: {
	mainCwd: string | undefined;
	sessionKey: string | undefined;
	agentId: string;
	title: string | undefined;
	task: string;
	role: string;
	blockedBy?: string[];
}): void {
	const blocked = input.blockedBy?.length ? `blocked-by: ${input.blockedBy.join(", ")}` : "";
	void writeTaskRow(input.mainCwd, input.sessionKey, {
		agentId: input.agentId,
		title: input.title?.trim() || input.task,
		role: input.role,
		wave: String(waveCounter || 1),
		status: "in-flight",
		notes: blocked,
	});
}

/** Record the terminal state of a run. `verified` is the runtime's own attestation, not a claim. */
export function recordTaskTerminal(input: {
	mainCwd: string | undefined;
	sessionKey: string | undefined;
	agentId: string;
	title: string | undefined;
	task: string;
	role: string;
	status: LedgerTaskStatus;
	verified?: "pass" | "fail" | "none";
}): void {
	const verified = input.verified && input.verified !== "none" ? `verified=${input.verified}` : "";
	void writeTaskRow(input.mainCwd, input.sessionKey, {
		agentId: input.agentId,
		title: input.title?.trim() || input.task,
		role: input.role,
		// Empty means "keep whatever the dispatch row already recorded".
		wave: "",
		status: input.status,
		notes: verified,
	});
}

// ---------------------------------------------------------------------------
// Closeout dispositions
// ---------------------------------------------------------------------------

const CLOSEOUT_HEADING = "## Closeout dispositions";
const CLOSEOUT_HEADER_ROW = "| item | disposition | evidence/reason |";

/** The ledger's disposition vocabulary. Same words the Swift mirror has always written. */
export type LedgerCloseoutDisposition = "cleaned" | "retained" | "needs-fixer" | "needs-user";

/**
 * Upsert one closeout row. Deliberately a near-copy of the task-row upsert rather than a shared
 * generic: the two tables have different shapes and different owners, and one clever helper
 * covering both would have to guess which it is looking at.
 */
function upsertCloseoutRow(
	content: string,
	item: string,
	disposition: LedgerCloseoutDisposition,
	evidence: string,
): string | undefined {
	const lines = content.split("\n");
	const headingIndex = lines.findIndex((l) => l.trim() === CLOSEOUT_HEADING);
	if (headingIndex === -1) return undefined;

	let end = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) {
			end = i;
			break;
		}
	}

	const rendered = `| ${cell(item, 40)} | ${disposition} | ${cell(evidence, 120)} |`;
	let lastRowIndex = -1;
	let sawHeader = false;
	for (let i = headingIndex + 1; i < end; i++) {
		if (!lines[i].startsWith("|")) continue;
		if (lines[i].trim() === CLOSEOUT_HEADER_ROW) sawHeader = true;
		lastRowIndex = i;
		if (sawHeader && rowId(lines[i]) === item) {
			lines[i] = rendered;
			return lines.join("\n");
		}
	}
	if (lastRowIndex === -1 || !sawHeader) return undefined;
	lines.splice(lastRowIndex + 1, 0, rendered);
	return lines.join("\n");
}

/**
 * Record how one agent's work was disposed of.
 *
 * Other hosts may mirror this from their own Git lifecycle. pi writes it only when pi
 * is the finalizer, so exactly one process owns the row and the two can never both append.
 */
export function recordCloseoutDisposition(input: {
	mainCwd: string | undefined;
	sessionKey: string | undefined;
	agentId: string;
	disposition: LedgerCloseoutDisposition;
	reason: string;
}): void {
	const { mainCwd } = input;
	if (!mainCwd) return;
	const file = ledgerPath(mainCwd, input.sessionKey);
	const evidence = `${input.reason.trim()} ${new Date().toISOString()}`.trim();
	void (async () => {
		try {
			await withFileMutationQueue(file, async () => {
				if (!fs.existsSync(file)) return;
				const content = fs.readFileSync(file, "utf-8");
				const updated = upsertCloseoutRow(content, input.agentId, input.disposition, evidence);
				if (updated === undefined || updated === content) return;
				fs.writeFileSync(file, updated, "utf-8");
			});
		} catch {
			// Bookkeeping never fails a finalization.
		}
	})();
}

/** Test seam: the wave counter and seed latch are process state. */
export function __resetBossLedgerStateForTests(): void {
	seededLedger = false;
	waveCounter = 0;
}

/** Exported for tests so the row format has exactly one definition. */
export const __ledgerInternals = { upsertTaskRow, renderRow, TASKS_HEADING, TASKS_HEADER_ROW };
