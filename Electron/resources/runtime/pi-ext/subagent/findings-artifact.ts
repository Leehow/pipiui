/**
 * The worker report, on disk, so the next worker does not rediscover it.
 *
 * A worker's full text has always existed — it is stored on the job and pulled with
 * `subagent_status full:true`. But the only path from that text to the *next* worker ran
 * through the Boss: pull the report into the Boss's context, then retype the parts that
 * matter into the next brief. Fan-out forbids the first half of that (the wave's raw output
 * must not reach the Boss), so in practice the Boss briefs from the injected TLDR alone —
 * about 2500 characters — and the implementer re-greps everything the explore agent already
 * found. Three roles, one repeated search.
 *
 * So the report is also written where a worker can simply read it. The Boss passes a path,
 * which costs one line of its context; the next worker reads the file, which costs a
 * disposable context that was going to be spent on grep anyway. Nothing about the Boss's
 * clean-context contract changes — the detail never passes through it.
 *
 * Keyed by `agentId`, not by run: the id is the Boss-chosen name of a job, re-dispatching
 * that name continues the same work, and the newest report for a name is the one that
 * describes the current state. Old runs are not history worth keeping here; the session
 * JSONL already is that.
 *
 * Failure is always silent-but-reported: an artifact that cannot be written must never stop
 * a completion from being delivered. The done message simply omits the line.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Keep one report bounded; a runaway worker must not write an unreadable file. */
export const FINDINGS_MAX_CHARS = 200_000;

/** The brief is context for the report, not the point of the file. */
export const FINDINGS_MAX_BRIEF_CHARS = 4_000;

function truncateBrief(text: string, cap: number): string {
	return text.length <= cap ? text : `${text.slice(0, cap)}\n[…brief truncated]`;
}

/**
 * A fence longer than any backtick run inside the text.
 *
 * Briefs routinely contain fenced code, and a three-backtick wrapper around one of those ends
 * the block early — the rest of the brief then renders as the document, and the reader cannot
 * tell where the quoted brief stopped.
 */
function fenceFor(text: string): string {
	const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
	return "`".repeat(Math.max(3, longest + 1));
}

/** Directory name under `.pi/`, alongside the Boss's own `boss/` ledgers. */
const FINDINGS_DIR = "findings";

/**
 * Reduce a Boss-chosen agent id to one safe path segment.
 *
 * Ids are model-authored (`quota-pill`, `auth-refactor`), so they are usually already
 * clean — but "usually" is not a filesystem guarantee, and `../` in a name must not become
 * a write outside the directory. Anything outside the allowed set becomes `-`, and an id
 * that reduces to nothing is rejected by the caller rather than silently renamed.
 */
export function findingsFileName(agentId: string): string | undefined {
	const safe = agentId.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
	return safe.length > 0 ? `${safe}.md` : undefined;
}

export function findingsPath(mainCwd: string, agentId: string): string | undefined {
	const name = findingsFileName(agentId);
	return name ? path.join(mainCwd, ".pi", FINDINGS_DIR, name) : undefined;
}

export interface FindingsArtifactInput {
	/** App-owned session root. Workers in isolated worktrees inherit it, so all roles agree on one path. */
	mainCwd: string | undefined;
	agentId: string | undefined;
	agentName: string;
	runId?: string;
	title?: string;
	task?: string;
	/** The worker's full final text — the same string the done message samples for its TLDR. */
	text: string;
}

export interface FindingsArtifactResult {
	ok: boolean;
	file?: string;
	problem?: string;
}

/** The brief, quoted so it cannot be mistaken for the report, and collapsed so it stays out of the way. */
function briefBlock(brief: string): string[] {
	const fence = fenceFor(brief);
	return ["<details><summary>Brief this worker was given</summary>", "", fence, brief, fence, "", "</details>", ""];
}

/** ISO to the minute: enough to tell two runs apart, short enough to read. */
function stamp(now: Date): string {
	return now.toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * Write one worker's report to `.pi/findings/<agentId>.md`, replacing any older report for
 * the same id. Returns the path so the caller can name it in the done message.
 */
export function writeFindingsArtifact(
	input: FindingsArtifactInput,
	now: Date = new Date(),
): FindingsArtifactResult {
	if (!input.mainCwd) return { ok: false, problem: "no main project directory (PIPIUI_MAIN_CWD unset)" };
	if (!input.agentId) return { ok: false, problem: "no agentId" };
	const body = input.text.trim();
	if (!body) return { ok: false, problem: "empty report" };

	const file = findingsPath(input.mainCwd, input.agentId);
	if (!file) return { ok: false, problem: `agentId "${input.agentId}" has no safe file name` };

	// The brief travels with the report: a reader must be able to judge what the evidence
	// below does and does not cover without going back to the dispatch that produced it.
	const brief = input.task?.trim();
	const header = [
		`# ${input.title?.trim() || input.agentId}`,
		"",
		`- agent: \`${input.agentName}\` (agentId \`${input.agentId}\`${input.runId ? `, run \`${input.runId}\`` : ""})`,
		`- written: ${stamp(now)}`,
		"",
		"> Written by the runtime from this worker's final report. Read it before exploring the",
		"> same ground: the file:line evidence below was already established once.",
		"",
		...(brief ? briefBlock(truncateBrief(brief, FINDINGS_MAX_BRIEF_CHARS)) : []),
		"---",
		"",
	].join("\n");

	const capped = body.length > FINDINGS_MAX_CHARS
		? `${body.slice(0, FINDINGS_MAX_CHARS)}\n\n[Report truncated: ${body.length - FINDINGS_MAX_CHARS} chars omitted.]`
		: body;

	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${header}${capped}\n`, "utf-8");
		return { ok: true, file };
	} catch (error) {
		return { ok: false, file, problem: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The done-message line that turns the artifact into a handoff.
 *
 * It is addressed at the Boss's next dispatch decision rather than at the Boss's
 * understanding: the Boss is explicitly told not to read this file, because reading it is
 * exactly the context spend fan-out exists to avoid. Its job is to copy one path into the
 * next brief.
 */
export function formatFindingsLine(file: string): string {
	return `Findings: ${file} — this worker's full report, on disk. Do NOT read it yourself; put this exact path in the next worker's brief ("read <path> first; it is the recon for this task, do not re-explore") so the implementer starts from the evidence instead of re-deriving it.`;
}

/**
 * The safety net: tell a worker what is already on disk, without waiting to be told.
 *
 * Forwarding a findings path is the Boss's job and the precise one — a brief that names the
 * file says "this is YOUR recon", which no generic list can say. But it is also a rule the
 * Boss has to remember at dispatch time, several turns after the completion that produced the
 * file, and possibly across a compaction that erased it. Leaving the whole benefit on that
 * one thread of discipline reproduces the original problem: information sitting in a place
 * nobody is required to look.
 *
 * So the worker is also told, at startup, which reports exist. Titles only — enough to decide
 * whether one covers ground the task needs, not enough to be worth skipping the read. The
 * brief's explicit pointer stays the primary path; this is what catches the dispatch where it
 * was not passed.
 *
 * Deliberately small and deliberately not a summary. A digest would be a second copy of the
 * evidence that goes stale; a list of titles cannot go stale in a way that misleads, because
 * acting on it means opening the file.
 */

/** Enough to choose, few enough that scanning them is cheaper than one redundant grep. */
export const FINDINGS_INDEX_MAX_ENTRIES = 8;
export const FINDINGS_INDEX_MAX_CHARS = 1_200;
/** Past this, a report describes a repository that has moved on; the noise outweighs it. */
export const FINDINGS_INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface FindingsIndexEntry {
	file: string;
	agentId: string;
	title: string;
	ageMs: number;
}

/** Read the `# Title` line without loading a whole report into memory. */
function readTitle(file: string, fallback: string): string {
	try {
		const head = fs.readFileSync(file, "utf-8").slice(0, 400);
		const line = head.split("\n").find((l) => l.startsWith("# "));
		return line ? line.slice(2).trim() || fallback : fallback;
	} catch {
		return fallback;
	}
}

/**
 * List the reports on disk, newest first, excluding `selfAgentId` — a worker's own prior
 * report is either its own continued conversation (which it already has) or the file it is
 * about to overwrite.
 */
export function listFindings(
	mainCwd: string | undefined,
	selfAgentId: string | undefined,
	now: number = Date.now(),
): FindingsIndexEntry[] {
	if (!mainCwd) return [];
	const dir = path.join(mainCwd, ".pi", FINDINGS_DIR);
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return [];
	}
	const selfName = selfAgentId ? findingsFileName(selfAgentId) : undefined;
	const entries: FindingsIndexEntry[] = [];
	for (const name of names) {
		if (!name.endsWith(".md") || name === selfName) continue;
		const file = path.join(dir, name);
		let ageMs: number;
		try {
			ageMs = now - fs.statSync(file).mtimeMs;
		} catch {
			continue;
		}
		if (ageMs > FINDINGS_INDEX_MAX_AGE_MS) continue;
		const agentId = name.slice(0, -3);
		entries.push({ file, agentId, title: readTitle(file, agentId), ageMs });
	}
	entries.sort((a, b) => a.ageMs - b.ageMs);
	return entries.slice(0, FINDINGS_INDEX_MAX_ENTRIES);
}

function formatAge(ageMs: number): string {
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/**
 * The system-prompt block appended for a dispatched worker. Empty string when there is
 * nothing to list, so a first worker on a clean project pays nothing.
 */
export function formatFindingsIndexBlock(entries: readonly FindingsIndexEntry[]): string {
	if (entries.length === 0) return "";
	const lines: string[] = [];
	let budget = FINDINGS_INDEX_MAX_CHARS;
	for (const entry of entries) {
		const line = `- \`${entry.file}\` — ${entry.title} (${formatAge(entry.ageMs)})`;
		if (line.length > budget) break;
		budget -= line.length;
		lines.push(line);
	}
	if (lines.length === 0) return "";
	return [
		"## Reports already on disk",
		"",
		"Earlier workers on this project left full reports here. If your brief names one, read",
		"that one first — it is the recon for your task. Otherwise open one only when its title",
		"covers ground your task would otherwise have to find for itself; searching for a file",
		"is the expensive part, and these already paid it. Do not read them all, and do not",
		"treat a title as a finding: only the file's contents are evidence.",
		"",
		...lines,
	].join("\n");
}
