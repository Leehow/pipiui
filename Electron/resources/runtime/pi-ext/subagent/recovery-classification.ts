/**
 * Structured recovery classification at a terminal worker-failure boundary.
 *
 * Two very different deaths land in the same `failed` state today. One is an ordinary
 * implementation/test failure: the worker made real decisions, some were wrong, and its
 * stored conversation is exactly who should debug them — continuity wins. The other is a
 * provider stall or a giant poisoned context: the worker produced no wrong answer because
 * it produced no answer, replaying the same conversation repeats both the cost and the
 * failure (one reviewer run burned four episodes / ~384 calls / 212 reads this way), and
 * the right move is a bounded checkpoint plus a FRESH semantic episode.
 *
 * This module draws that line using only what the runtime can observe at the boundary:
 * abort flags, the terminal error text, attestable verify results, accumulated context
 * size, and the message history's tool-call record. It never asks a stalled provider for
 * a summary and never invents conclusions — where evidence is absent the checkpoint is
 * simply not written.
 *
 * Fresh routing additionally REQUIRES poisoned-broad-recon evidence from an ephemeral
 * worker, combined with a NON-verify provider/context failure. A writable worker keeps
 * its stored conversation even during a read/search-only phase: lack of edits does not
 * make its research disposable. An attestable verify failure outranks every other
 * attribution — even when the worker ALSO carries read-heavy recon evidence and a huge
 * context — because an implementation/test problem must be debugged by the conversation
 * that produced it. Size alone never sends an ordinary implementation or verify failure
 * to a fresh agent either; size without poisoned-recon evidence fails safe to same-agent
 * continuity, honestly labelled.
 *
 * Route is advisory-to-orchestration, not automatic action: nothing here aborts, discards
 * a worktree, or mints ids. A fresh episode means the Boss dispatches under a NEW semantic
 * agentId whose brief names the persisted checkpoint; a preserved worktree stays recorded
 * in that checkpoint instead of being cleaned up behind the Boss's back.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { findingsFileName, findingsPath } from "./findings-artifact.ts";

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Continue the same named slice (ordinary failure or interruption). */
export type ContinueSliceRoute = "continue-slice";
/** Persist a bounded checkpoint and start a fresh semantic episode. */
export type CheckpointFreshRoute = "checkpoint-fresh-episode";

export type RecoveryRoute = ContinueSliceRoute | CheckpointFreshRoute;

export type RecoveryKind =
	/** Explicit abort/watchdog interruption — not a failure at all. */
	| "aborted"
	/** Attestable verify ran and failed/timed out: implementation problem, not context. */
	| "verify-failure"
	/** Terminal error carries a provider-stall signature; the resume budget is spent. */
	| "provider-stall"
	/** Died with a saturated context; replaying the conversation reproduces the death. */
	| "context-overflow"
	// NOTE: kind only ever means "context was saturated at death". Whether it routes fresh is
	// decided separately by poisoned-recon evidence; oversized ordinary failures keep continuity.
	/** Retryable errors exhausted at ordinary context; continuity still applies. */
	| "retry-exhausted"
	/** No recognizable signature; Boss judges semantically per the continuity rules. */
	| "unclassified";

export interface RecoveryObservation {
	wasAborted: boolean;
	/** Raw terminal `errorMessage` plus a stderr tail — matched for signatures only. */
	errorText: string;
	stopReason?: string;
	/** An attestable `verify` command ran and did not pass (non-zero exit or timeout). */
	verifyFailure: boolean;
	/** Context tokens reported by the final attempt. */
	contextTokens: number;
	/** Same-model auto-resumes this episode already consumed (advisory metadata only). */
	sameModelResumeCount: number;
	/** Dispatched agent-definition name (e.g. "explore", "general-purpose", "reviewer"). */
	role?: string;
	/** Runtime's own read-only bookkeeping for this episode. */
	readOnly?: boolean;
	/** Observed footprint of the terminal history (see {@link extractReconFootprint}). */
	footprint?: ReconFootprint;
}

export interface RecoveryDecision {
	route: RecoveryRoute;
	kind: RecoveryKind;
	/** k tokens rounded; present for context-sized kinds. */
	contextK?: number;
}

/**
 * Error-text signatures of a terminal provider stall. Reaching a terminal finalize with one
 * of these means every resume/model-switch lever for that signature is already exhausted —
 * otherwise the auto-resume loop would have continued the run instead of finalizing it.
 */
const PROVIDER_STALL_MARKERS = [
	"provider_stall_timeout",
	"provider stall",
];

/** Default above which a final failure is treated as context-saturated, mirroring index.ts. */
export const RECOVERY_CONTEXT_HINT_TOKENS_DEFAULT = 100_000;

function isStallShaped(text: string): boolean {
	const t = (text || "").toLowerCase();
	return PROVIDER_STALL_MARKERS.some((marker) => t.includes(marker));
}

// ---------------------------------------------------------------------------
// Poisoned-broad-recon evidence — the gate every fresh route must pass
// ---------------------------------------------------------------------------

/** Dispatched roles whose definition IS broad recon/review work. */
const BROAD_RECON_ROLES = new Set(["explore", "reviewer"]);
/** Tool calls that mutate the tree or run its build/tests — implementation work, not recon. */
const MUTATION_TOOL_NAMES = new Set(["edit", "write", "multiedit", "apply_patch", "notebookedit"]);
/** Minimum observed read+search calls before a writable episode's footprint counts as recon-shaped. */
export const RECON_FOOTPRINT_MIN_RECON_CALLS = 8;
/** Read+search share (%) above which a mutation-free footprint is a broad recon/reviewer trajectory. */
export const RECON_FOOTPRINT_RECON_SHARE_MIN_PCT = 70;

export function hasBroadReconTrajectoryEvidence(
	input: Pick<RecoveryObservation, "role" | "readOnly" | "footprint">,
): boolean {
	const role = (input.role ?? "").trim().toLowerCase();
	if (BROAD_RECON_ROLES.has(role)) return true;
	if (input.readOnly === true) return true;
	const fp = input.footprint;
	if (!fp || fp.toolCallsObserved <= 0) return false;
	// Any observed mutation marks an implementation slice — its death is an ordinary code/test
	// problem regardless of how big the context got.
	if (fp.mutationCalls > 0) return false;
	const reconCalls = fp.readCalls + fp.searchCalls;
	if (reconCalls < RECON_FOOTPRINT_MIN_RECON_CALLS) return false;
	return reconCalls * 100 >= fp.toolCallsObserved * RECON_FOOTPRINT_RECON_SHARE_MIN_PCT;
}

/**
 * Classify one terminal failure into a recovery route.
 *
 * Precedence (highest first): abort → attestable verify failure → provider-stall signature →
 * saturated context → unclassified. An attestable verify failure ALWAYS keeps same-agent
 * continuity: an ordinary implementation/test problem is debugged by the conversation that
 * produced it, even when that conversation also carries poisoned-recon evidence and a
 * ≥hint-token context. Provider/context failures become the FRESH route only for an
 * ephemeral worker with poisoned-recon evidence ({@link hasBroadReconTrajectoryEvidence}).
 * Writable roles always keep continuity, including before their first edit. Without
 * sufficient evidence, fail safe to continue-slice rather than minting a new identity.
 */
export function classifyWorkerRecovery(
	input: RecoveryObservation,
	options?: { contextHintTokens?: number },
): RecoveryDecision {
	if (input.wasAborted) return { route: "continue-slice", kind: "aborted" };
	// Attestable verify outcome outranks every other attribution: an ordinary
	// implementation/test/verify failure stays with the worker that caused it, regardless of
	// context size, recon-shaped footprints, stall signatures, or threshold checks below.
	if (input.verifyFailure) return { route: "continue-slice", kind: "verify-failure" };
	const hint = options?.contextHintTokens ?? RECOVERY_CONTEXT_HINT_TOKENS_DEFAULT;
	// Read-heavy preparation is still part of a stateful implementation slice. A provider
	// outage or large context does not prove its saved conversation is unusable.
	const statefulWorker = input.readOnly === false
		|| (input.readOnly === undefined && (input.role ?? "").trim().toLowerCase() === "general-purpose");
	const poisonedRecon = !statefulWorker && hasBroadReconTrajectoryEvidence(input);
	if (isStallShaped(`${input.errorText}\n${input.stopReason ?? ""}`)) {
		return poisonedRecon
			? { route: "checkpoint-fresh-episode", kind: "provider-stall" }
			: { route: "continue-slice", kind: "provider-stall" };
	}
	if (input.contextTokens >= hint) {
		if (poisonedRecon) {
			return {
				route: "checkpoint-fresh-episode",
				kind: "context-overflow",
				contextK: Math.round(input.contextTokens / 1000),
			};
		}
		return {
			route: "continue-slice",
			kind: "context-overflow",
			contextK: Math.round(input.contextTokens / 1000),
		};
	}
	return { route: "continue-slice", kind: "unclassified" };
}

// ---------------------------------------------------------------------------
// Observed recon footprint — the only honest input to a checkpoint body
// ---------------------------------------------------------------------------

/** Bounded entries per family; a runaway sweep must not produce an unreadable file. */
export const CHECKPOINT_MAX_FILE_FAMILIES = 12;
export const CHECKPOINT_MAX_SEARCH_DIMENSIONS = 8;
export const CHECKPOINT_TASK_CHARS = 600;
export const CHECKPOINT_MAX_CHARS = 8_000;

export interface ReconFootprint {
	toolCallsObserved: number;
	/** Per-call family counters backing {@link hasBroadReconTrajectoryEvidence}. */
	readCalls: number;
	searchCalls: number;
	mutationCalls: number;
	/** Read-target paths (deduped, most-read first, capped). */
	fileFamilies: Array<{ target: string; hits: number }>;
	/** Search arguments actually swept (deduped, capped): what dimensions were covered. */
	searchDimensions: Array<{ pattern: string; hits: number }>;
}

const READ_TOOL_NAMES = new Set(["read"]);
const SEARCH_TOOL_NAMES = new Set([
	"grep",
	"find",
	"ls",
	"code_search",
	"code_nav",
	"repo_map",
	"glob",
]);

interface CounterEntry {
	value: string;
	hits: number;
	firstSeen: number;
}

class BoundedCounter {
	private entries = new Map<string, CounterEntry>();
	private seen = 0;

	note(value: unknown): void {
		if (typeof value !== "string") return;
		const v = value.trim();
		if (!v || v.length > 500) return;
		this.seen += 1;
		const existing = this.entries.get(v);
		if (existing) existing.hits += 1;
		else this.entries.set(v, { value: v, hits: 1, firstSeen: this.seen });
	}

	top(cap: number): Array<{ value: string; hits: number }> {
		return [...this.entries.values()]
			.sort((a, b) => b.hits - a.hits || a.firstSeen - b.firstSeen)
			.slice(0, cap)
			.map((e) => ({ value: e.value, hits: e.hits }));
	}

	get size(): number {
		return this.entries.size;
	}
}

function firstStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

/**
 * Extract what the dead episode actually looked at, from assistant `toolCall` blocks only.
 * Defensive by construction: a malformed message history yields an empty footprint, and an
 * empty footprint yields NO checkpoint — absence of evidence must not become invented state.
 */
export function extractReconFootprint(messages: unknown[]): ReconFootprint {
	const files = new BoundedCounter();
	const searches = new BoundedCounter();
	let toolCallsObserved = 0;
	let readCalls = 0;
	let searchCalls = 0;
	let mutationCalls = 0;

	for (const entry of messages) {
		const content = (entry as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const typed = block as { type?: unknown; name?: unknown; arguments?: unknown };
			if (typed.type !== "toolCall" || typeof typed.name !== "string") continue;
			toolCallsObserved += 1;
			const args =
				typed.arguments && typeof typed.arguments === "object"
					? (typed.arguments as Record<string, unknown>)
					: {};
			const name = typed.name.toLowerCase();
			if (READ_TOOL_NAMES.has(name)) {
				readCalls += 1;
				files.note(firstStringArg(args, ["path", "file", "filePath", "file_path"]));
				const paths = args.paths;
				if (Array.isArray(paths)) for (const p of paths) files.note(p);
			} else if (SEARCH_TOOL_NAMES.has(name)) {
				searchCalls += 1;
				searches.note(firstStringArg(args, ["pattern", "query", "regex", "glob"]));
			} else if (MUTATION_TOOL_NAMES.has(name)) {
				mutationCalls += 1;
			}
		}
	}

	return {
		toolCallsObserved,
		readCalls,
		searchCalls,
		mutationCalls,
		fileFamilies: files.top(CHECKPOINT_MAX_FILE_FAMILIES),
		searchDimensions: searches.top(CHECKPOINT_MAX_SEARCH_DIMENSIONS),
	};
}

// ---------------------------------------------------------------------------
// Checkpoint artifact
// ---------------------------------------------------------------------------

export interface RecoveryCheckpointInput {
	mainCwd: string | undefined;
	agentId: string | undefined;
	runId?: string;
	title?: string;
	task?: string;
	decision: RecoveryDecision;
	messages: unknown[];
	worktreePath?: string;
	worktreeBranch?: string;
	now?: Date;
}

export interface RecoveryCheckpointResult {
	ok: boolean;
	file?: string;
	problem?: string;
	/** Set when the artifact was intentionally skipped for lack of evidence. */
	skipped?: boolean;
}

function section(lines: string[], heading: string, entries: Array<{ value: string; hits: number }>): void {
	lines.push("", `## ${heading}`, "");
	for (const entry of entries) lines.push(`- ${entry.value}${entry.hits > 1 ? ` ×${entry.hits}` : ""}`);
}

/**
 * Write `.pi/checkpoints/<agentId>.md` for a classified fresh-episode boundary.
 *
 * Every section is derived from something the runtime observed: the tool-call record, the
 * dispatch brief, a preserved worktree location, or an earlier findings artifact for the
 * same agentId. If NONE of those exist — the worker died before touching anything — no file
 * is written ("insufficient-evidence"); an empty scaffold pretending to know file families
 * would send the next episode hunting ghosts.
 *
 * Keyed by the slugified agentId exactly like `.pi/findings/` — deterministic, semantic,
 * never a generated id. Overwritten wholesale by the next boundary for the same id.
 */
export function writeRecoveryCheckpoint(input: RecoveryCheckpointInput): RecoveryCheckpointResult {
	if (!input.mainCwd) return { ok: false, problem: "no main project directory" };
	if (!input.agentId) return { ok: false, problem: "no agentId" };
	if (input.decision.route !== "checkpoint-fresh-episode") {
		return { ok: false, problem: "not a fresh-episode boundary" };
	}
	const name = findingsFileName(input.agentId);
	if (!name) return { ok: false, problem: `agentId "${input.agentId}" has no safe file name` };

	const footprint = extractReconFootprint(input.messages);
	let findingsReference: string | undefined;
	const candidateFindings = findingsPath(input.mainCwd, input.agentId);
	if (candidateFindings) {
		try {
			if (fs.statSync(candidateFindings).isFile()) findingsReference = candidateFindings;
		} catch {
			/* absent findings file is the normal case */
		}
	}

	const hasEvidence =
		footprint.fileFamilies.length > 0 ||
		footprint.searchDimensions.length > 0 ||
		findingsReference !== undefined ||
		Boolean(input.worktreePath);
	if (!hasEvidence) return { ok: false, skipped: true, problem: "insufficient-evidence" };

	const task = (input.task ?? "").trim().slice(0, CHECKPOINT_TASK_CHARS);
	const lines: string[] = [
		`# Recovery checkpoint — ${input.agentId}`,
		"",
		`- written: ${(input.now ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z")}`,
		`- classification: route=${input.decision.route} kind=${input.decision.kind}` +
			(input.decision.contextK !== undefined ? ` (~${input.decision.contextK}k tokens at death)` : ""),
		input.runId ? `- boundary run: \`${input.runId}\`` : "",
		task ? ["", "<details><summary>Task brief</summary>", "", task, "", "</details>"].join("\n") : "",
		input.worktreePath
			? `- worktree preserved (do NOT auto-discard): \`${input.worktreePath}\`${input.worktreeBranch ? ` on branch \`${input.worktreeBranch}\`` : ""}`
			: "",
		findingsReference ? `- strongest prior findings: \`${findingsReference}\`` : "",
	].filter((line): line is string => line !== "");

	if (footprint.fileFamilies.length > 0) {
		section(lines, `Known file families (observed reads${footprint.toolCallsObserved ? `, ${footprint.toolCallsObserved} tool calls total` : ""})`, footprint.fileFamilies.map((f) => ({ value: f.value, hits: f.hits })));
	}
	if (footprint.searchDimensions.length > 0) {
		section(lines, "Covered search dimensions (patterns already swept)", footprint.searchDimensions.map((s) => ({ value: `\`${s.value}\``, hits: s.hits })));
	}
	if (findingsReference) {
		lines.push(
			"",
			"## Unresolved questions",
			"",
			"The prior episodes never delivered a report, so open questions live only in the",
			"conversation being abandoned. Start from the findings file above; re-derive only",
			"what it does not settle.",
		);
	} else {
		lines.push(
			"",
			"## Unresolved questions",
			"",
			"Not recorded — the episode died without a report and the runtime cannot infer its",
			"open questions. Establishing them is part of the next episode's work.",
		);
	}

	lines.push(
		"",
		"> Derived mechanically from the observed tool-call record at the failure boundary.",
		"> Entries are leads this episode already examined, not conclusions. The replacement",
		"> episode runs under a NEW semantic agentId; blind-resuming the dead conversation",
		"> replays both the failure and the cost that produced this boundary.",
	);

	const body = lines.join("\n").slice(0, CHECKPOINT_MAX_CHARS);
	const file = path.join(input.mainCwd, ".pi", "checkpoints", name);
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${body}\n`, "utf-8");
		return { ok: true, file };
	} catch (error) {
		return { ok: false, file, problem: error instanceof Error ? error.message : String(error) };
	}
}

// ---------------------------------------------------------------------------
// Machine-readable + human-facing formatting
// ---------------------------------------------------------------------------

/**
 * One parseable header line plus short guidance addressed at the Boss's next dispatch.
 * `resumeAgain=false` is the whole point of the fresh route: repeated resume must never be
 * the silently-defaulted interpretation of a `failed` state.
 */
export function formatRecoveryReport(input: {
	agentId: string;
	runId?: string;
	decision: RecoveryDecision;
	checkpointFile?: string;
}): string {
	const d = input.decision;
	const fresh = d.route === "checkpoint-fresh-episode";
	const head = [
		"[subagent-recovery]",
		`agentId=${input.agentId}`,
		input.runId ? `runId=${input.runId}` : undefined,
		`route=${d.route}`,
		`kind=${d.kind}`,
		d.contextK !== undefined ? `contextK=${d.contextK}` : undefined,
		`resumeAgain=${fresh ? "false" : "true"}`,
		input.checkpointFile ? `checkpoint=${input.checkpointFile}` : "checkpoint=-",
	]
		.filter((part): part is string => Boolean(part))
		.join(" ");
	const guidance = fresh
		? `上下文/供应商即为故障源（且侦查轨迹毒化证据成立）：不要原样重放该会话。请用新的语义 agentId 派发新 episode，并在 brief 中让新 worker 先读取上面的 checkpoint 文件；已记录的 worktree 一并交代，不得自动丢弃。`
		: d.kind === "aborted"
			? "中断不是失败：按既有规则沿用同名 agentId 续接即可。"
			: d.kind === "context-overflow"
				? `终态时上下文较大不代表必须丢弃已有会话：重新派发同一 agentId 继续，不要传 fresh:true；请缩小任务范围、使用小窗口读取，必要时压缩上下文。`
				: d.kind === "provider-stall"
					? `供应商停滞不等于会话损坏：重新派发同一 agentId 续接该切片，不要传 fresh:true；如需换模型也保留同一 agentId。`
					: `普通实现/测试失败，与上下文无关：按连续性规则重新派发同一 agentId 继续该切片。`;
	return `${head}\n[pipiui] ${guidance}`;
}

/**
 * Replacement middle lines for `[subagent-interrupted-reminder]` when the job carries a
 * fresh-route classification. Exported pure so the reminder regression lives in unit tests
 * rather than against the extension surface.
 */
export function formatFreshEpisodeReminderLines(checkpointFile: string | undefined): string[] {
	const pointer = checkpointFile
		? `A recovery checkpoint for what this episode had already established is at ${checkpointFile}. Do not blindly re-dispatch this same agentId: start a fresh episode under a NEW semantic agentId whose brief reads that checkpoint first.`
		: "Do not blindly re-dispatch this same agentId: the context/provider signature says a fresh episode under a NEW semantic agentId is the default (the runtime could not synthesize a trustworthy checkpoint).";
	return [pointer];
}
