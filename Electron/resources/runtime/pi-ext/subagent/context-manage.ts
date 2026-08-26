/**
 * Boss-only context_manage tool + idle-fold nudge (P3).
 *
 * inspect: bounded token/age/category manifest + Top-N fold candidates. Zero LLM.
 * fold: machine-execute fold-by-id through the live context-fold engine (spool + recall).
 *
 * Worker processes never see this tool (PIPIUI_DEPTH !== 0). The idle-fold timer
 * injects at most one nudge turn per idle epoch; deterministic fold remains the fallback.
 */

import { makeStrictJsonSchema, omitNulls } from "./strict-json-schema.ts";
import {
	IDLE_FOLD_LOW_WATERMARK_DEFAULT,
	type IdleFoldFireInfo,
} from "./idle-fold-timer.ts";

export const CONTEXT_MANAGE_MAX_CANDIDATES_DEFAULT = 20;
export const CONTEXT_MANAGE_MAX_FOLD_IDS_DEFAULT = 20;
export const CONTEXT_MANAGE_SUMMARY_CHARS_DEFAULT = 160;
export const CONTEXT_FOLD_MANAGE_KEY = Symbol.for("pipiui.contextFold.manage");
export const CONTEXT_OPTIMIZER_STATE_KEY = Symbol.for("pipiui.contextOptimizer.state.v1");
export const CONTEXT_MANAGE_NUDGE_CUSTOM_TYPE = "pipiui-context-manage-nudge";

/** Authoritative plan tools from extensions/pipiui-plan.ts (plan_publish / _task_update / _approve / _cancel). */
export const PLAN_TOOL_NAMES = new Set([
	"plan_publish",
	"plan_task_update",
	"plan_approve",
	"plan_cancel",
]);
/** Worker / desktop tools whose un-externalized results are evidence, never inspect candidates. */
export const WORKER_TOOL_NAMES = new Set([
	"subagent",
	"subagent_status",
	"subagent_chain",
	"subagent_abort",
	"subagent_resolve",
	"subagent_manage",
	"computer_task",
]);

export interface ContextManageConfig {
	maxCandidates: number;
	maxFoldIds: number;
	summaryChars: number;
}

export interface ContextManageBlock {
	id: string;
	kind: string;
	tokens: number;
	foldedTokens?: number;
	turn?: number;
	order?: number;
	toolName?: string;
	agentId?: string;
	externalized?: boolean;
	protected?: boolean;
	held?: boolean;
	frozen?: boolean;
	folded?: boolean;
	text?: string;
	callId?: string;
}

export interface ContextManageView {
	blocks: ContextManageBlock[];
	liveTokens: number;
	reportedTokens?: number;
	contextWindow: number | null;
}

export interface ContextManageCandidate {
	id: string;
	category: string;
	tokens: number;
	ageTurns: number;
	externalized: boolean;
	summary: string;
}

export interface ContextManifest {
	usedTokens: number;
	contextWindow: number | null;
	byCategory: Record<string, { count: number; tokens: number }>;
	byAge: Array<{ bucket: string; tokens: number; count: number }>;
	candidates: ContextManageCandidate[];
}

export interface FoldSkip {
	id: string;
	reason: string;
}

export interface FoldByIdsResult {
	messages: unknown[];
	foldedIds: string[];
	skipped: FoldSkip[];
}

export interface ContextFoldManageApi {
	viewFor(messages: readonly unknown[], context?: { tokens?: number | null; contextWindow?: number | null } | null): ContextManageView;
	foldByIds(
		messages: readonly unknown[],
		ids: readonly string[],
		context?: { tokens?: number | null; contextWindow?: number | null } | null,
	): FoldByIdsResult;
}

export interface ContextManageDeps {
	sessionKey?: string;
	getMessages: () => readonly unknown[] | undefined;
	getUsage?: () => { tokens?: number | null; contextWindow?: number | null } | undefined;
	manage?: ContextFoldManageApi;
	maxCandidates?: number;
	maxFoldIds?: number;
	summaryChars?: number;
	/** Called after at least one id was actually folded so the idle timer can cancel fallback. */
	onSuccessfulFold?: (foldedIds: readonly string[]) => void;
}

function envPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
	const raw = Number.parseInt(env[name] || "", 10);
	if (!Number.isFinite(raw) || raw < 1) return fallback;
	return Math.min(raw, max);
}

export function contextManageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ContextManageConfig {
	return {
		maxCandidates: envPositiveInt(env, "PIPIUI_CONTEXT_MANAGE_MAX_CANDIDATES", CONTEXT_MANAGE_MAX_CANDIDATES_DEFAULT, 20),
		maxFoldIds: envPositiveInt(env, "PIPIUI_CONTEXT_MANAGE_MAX_FOLD_IDS", CONTEXT_MANAGE_MAX_FOLD_IDS_DEFAULT, 20),
		summaryChars: envPositiveInt(env, "PIPIUI_CONTEXT_MANAGE_SUMMARY_CHARS", CONTEXT_MANAGE_SUMMARY_CHARS_DEFAULT, 200),
	};
}

export function shouldRegisterContextManageTool(depth: number, mainCwd: string | undefined): boolean {
	return depth === 0 && Boolean(mainCwd);
}

export function getLiveContextFoldManage(): ContextFoldManageApi | undefined {
	const registered = (globalThis as Record<string | symbol, unknown>)[CONTEXT_FOLD_MANAGE_KEY];
	if (!registered || typeof registered !== "object") return undefined;
	const api = registered as Partial<ContextFoldManageApi>;
	if (typeof api.viewFor !== "function" || typeof api.foldByIds !== "function") return undefined;
	return api as ContextFoldManageApi;
}

/** Process-local lease check shared with context-fold and pipiui-headroom. */
export function contextFoldIsStandby(): boolean {
	const value = (globalThis as Record<string | symbol, unknown>)[CONTEXT_OPTIMIZER_STATE_KEY];
	if (typeof value !== "object" || value === null || (value as { version?: unknown }).version !== 1) return false;
	const state = value as { primaryOwner?: unknown; fallbackOwner?: unknown };
	return typeof state.primaryOwner === "string" && state.primaryOwner.length > 0 && !state.fallbackOwner;
}

export function isPlanToolName(toolName: string | undefined): boolean {
	if (!toolName) return false;
	return PLAN_TOOL_NAMES.has(toolName) || toolName.startsWith("plan_");
}

function isPlanBlock(block: ContextManageBlock): boolean {
	if (isPlanToolName(block.toolName)) return true;
	if (block.kind === "text" && /(?:^|\n)#+\s*plan\b/i.test(block.text ?? "")) return true;
	return false;
}

function isUnexternalizedEvidence(block: ContextManageBlock): boolean {
	if (block.externalized) return false;
	if (block.agentId) return true;
	if (block.toolName && WORKER_TOOL_NAMES.has(block.toolName)) return true;
	if ((block.text ?? "").includes("[subagent-done]")) return true;
	return false;
}

/** Tool-level candidate guard. User / plan / un-externalized worker evidence never appear. */
export function candidateRejection(block: ContextManageBlock): string | undefined {
	if (block.kind === "user") return "user_message";
	if (isPlanBlock(block)) return "plan";
	if (block.kind !== "tool_result") return "not_tool_result";
	if (block.protected) return "protected_tail";
	if (block.held) return "held";
	if (block.frozen || block.folded) return "already_folded";
	if (typeof block.foldedTokens === "number" && block.foldedTokens >= block.tokens) return "no_savings";
	if (isUnexternalizedEvidence(block)) return "unexternalized_evidence";
	return undefined;
}

export function isContextManageCandidate(block: ContextManageBlock): boolean {
	return candidateRejection(block) === undefined;
}

function oneLineSummary(text: string | undefined, maxChars: number): string {
	const first = (text ?? "").split("\n").find((line) => line.trim()) ?? "";
	const flat = first.replace(/\s+/g, " ").trim();
	if (flat.length <= maxChars) return flat;
	return `${flat.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function categoryOf(block: ContextManageBlock): string {
	if (isPlanBlock(block)) return "plan";
	if (block.externalized) return "externalized";
	if (block.kind === "tool_result") return "tool_result";
	if (block.kind === "tool_call") return "tool_call";
	if (block.kind === "user") return "user";
	if (block.kind === "thinking") return "thinking";
	if (block.kind === "text") return "text";
	return block.kind || "other";
}

function ageTurnsOf(block: ContextManageBlock, newestTurn: number): number {
	const turn = typeof block.turn === "number" ? block.turn : 0;
	return Math.max(0, newestTurn - turn);
}

function ageBucket(ageTurns: number): string {
	if (ageTurns <= 0) return "current";
	if (ageTurns <= 2) return "recent";
	if (ageTurns <= 8) return "mid";
	return "old";
}

function bump(
	map: Record<string, { count: number; tokens: number }>,
	key: string,
	tokens: number,
): void {
	const row = map[key] ?? (map[key] = { count: 0, tokens: 0 });
	row.count += 1;
	row.tokens += tokens;
}

export function buildBoundedManifest(
	view: ContextManageView,
	opts: { limit?: number; summaryChars?: number } = {},
): ContextManifest {
	const limit = Math.min(Math.max(opts.limit ?? CONTEXT_MANAGE_MAX_CANDIDATES_DEFAULT, 1), 20);
	const summaryChars = Math.min(Math.max(opts.summaryChars ?? CONTEXT_MANAGE_SUMMARY_CHARS_DEFAULT, 1), 200);
	const usedTokens = view.reportedTokens ?? view.liveTokens;
	const newestTurn = view.blocks.reduce((max, block) => Math.max(max, block.turn ?? 0), 0);

	const byCategory: Record<string, { count: number; tokens: number }> = {};
	const ageMap = new Map<string, { bucket: string; tokens: number; count: number }>();
	for (const block of view.blocks) {
		bump(byCategory, categoryOf(block), block.tokens);
		const bucket = ageBucket(ageTurnsOf(block, newestTurn));
		const row = ageMap.get(bucket) ?? { bucket, tokens: 0, count: 0 };
		row.tokens += block.tokens;
		row.count += 1;
		ageMap.set(bucket, row);
	}

	const ranked = view.blocks
		.filter(isContextManageCandidate)
		.map((block) => ({
			id: block.id,
			category: categoryOf(block),
			tokens: block.tokens,
			ageTurns: ageTurnsOf(block, newestTurn),
			externalized: block.externalized === true,
			summary: oneLineSummary(block.text, summaryChars),
			order: block.order ?? 0,
		}))
		.sort((a, b) => {
			if (a.externalized !== b.externalized) return a.externalized ? -1 : 1;
			if (a.ageTurns !== b.ageTurns) return b.ageTurns - a.ageTurns;
			if (a.tokens !== b.tokens) return b.tokens - a.tokens;
			return a.order - b.order;
		})
		.slice(0, limit)
		.map(({ order: _order, ...candidate }) => candidate);

	return {
		usedTokens,
		contextWindow: view.contextWindow,
		byCategory,
		byAge: ["current", "recent", "mid", "old"]
			.map((bucket) => ageMap.get(bucket))
			.filter((row): row is { bucket: string; tokens: number; count: number } => row !== undefined),
		candidates: ranked,
	};
}

function emptyView(usage?: { tokens?: number | null; contextWindow?: number | null }): ContextManageView {
	return {
		blocks: [],
		liveTokens: typeof usage?.tokens === "number" ? usage.tokens : 0,
		reportedTokens: typeof usage?.tokens === "number" ? usage.tokens : undefined,
		contextWindow: typeof usage?.contextWindow === "number" ? usage.contextWindow : null,
	};
}

export function inspectContext(deps: ContextManageDeps, limit?: number): ContextManifest {
	const cfg = contextManageConfigFromEnv();
	const messages = deps.getMessages() ?? [];
	const usage = deps.getUsage?.();
	const manage = deps.manage ?? getLiveContextFoldManage();
	const view = manage && messages.length > 0
		? manage.viewFor(messages, usage)
		: emptyView(usage);
	return buildBoundedManifest(view, {
		limit: limit ?? deps.maxCandidates ?? cfg.maxCandidates,
		summaryChars: deps.summaryChars ?? cfg.summaryChars,
	});
}

export function foldContextByIds(deps: ContextManageDeps, ids: readonly string[]): {
	foldedIds: string[];
	skipped: FoldSkip[];
	problem?: string;
} {
	const cfg = contextManageConfigFromEnv();
	const maxIds = deps.maxFoldIds ?? cfg.maxFoldIds;
	const requested = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
	if (requested.length === 0) return { foldedIds: [], skipped: [], problem: "fold requires a non-empty ids list." };
	if (contextFoldIsStandby()) {
		return {
			foldedIds: [],
			skipped: requested.map((id) => ({ id, reason: "primary_optimizer_active" })),
			problem: "context-fold is in standby while the primary context optimizer is active.",
		};
	}
	if (requested.length > maxIds) {
		return { foldedIds: [], skipped: requested.map((id) => ({ id, reason: "too_many_ids" })), problem: `fold accepts at most ${maxIds} ids.` };
	}

	const messages = deps.getMessages() ?? [];
	if (messages.length === 0) return { foldedIds: [], skipped: requested.map((id) => ({ id, reason: "no_context" })), problem: "No live context is available to fold." };

	const usage = deps.getUsage?.();
	const manage = deps.manage ?? getLiveContextFoldManage();
	if (!manage) {
		return { foldedIds: [], skipped: requested.map((id) => ({ id, reason: "no_live_engine" })), problem: "Live context-fold engine is not registered." };
	}

	const view = manage.viewFor(messages, usage);
	const byId = new Map(view.blocks.map((block) => [block.id, block]));
	const accepted: string[] = [];
	const skipped: FoldSkip[] = [];
	for (const id of requested) {
		const block = byId.get(id);
		if (!block) {
			skipped.push({ id, reason: "not_in_session" });
			continue;
		}
		const reason = candidateRejection(block);
		if (reason) skipped.push({ id, reason });
		else accepted.push(id);
	}
	if (accepted.length === 0) return { foldedIds: [], skipped };

	const result = manage.foldByIds(messages, accepted, usage);
	if (result.foldedIds.length > 0) deps.onSuccessfulFold?.(result.foldedIds);
	return { foldedIds: result.foldedIds, skipped: [...skipped, ...result.skipped] };
}

function textResult(text: string, details: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text }],
		details,
		...(isError ? { isError: true } : {}),
	};
}

export async function executeContextManage(
	params: { action?: string; ids?: string[]; limit?: number },
	deps: ContextManageDeps,
) {
	const action = params.action;
	if (action !== "inspect" && action !== "fold") {
		return textResult("action must be inspect or fold.", { status: "error", action }, true);
	}
	if (action === "inspect") {
		const manifest = inspectContext(deps, params.limit);
		return textResult(JSON.stringify(manifest), { manifest: true, llm: false });
	}
	const result = foldContextByIds(deps, params.ids ?? []);
	if (result.problem && result.foldedIds.length === 0) {
		return textResult(result.problem, { status: "error", ...result }, true);
	}
	const lines = [
		`folded ${result.foldedIds.length} block(s): ${result.foldedIds.join(", ") || "(none)"}`,
		...result.skipped.map((row) => `skipped ${row.id}: ${row.reason}`),
	];
	return textResult(lines.join("\n"), { status: "ok", ...result, llm: false });
}

export const CONTEXT_MANAGE_PARAMS = makeStrictJsonSchema({
	type: "object",
	additionalProperties: false,
	properties: {
		action: {
			type: "string",
			enum: ["inspect", "fold"],
			description: "inspect returns a bounded candidate manifest. fold applies those ids.",
		},
		ids: {
			type: "array",
			items: { type: "string" },
			maxItems: CONTEXT_MANAGE_MAX_FOLD_IDS_DEFAULT,
			description: "Candidate ids from inspect. Required for fold. Max 20.",
		},
		limit: {
			type: "integer",
			minimum: 1,
			maximum: CONTEXT_MANAGE_MAX_CANDIDATES_DEFAULT,
			default: CONTEXT_MANAGE_MAX_CANDIDATES_DEFAULT,
			description: "Top-N candidates for inspect. Default 20, hard max 20.",
		},
	},
});

export function contextManageTool(deps: ContextManageDeps) {
	return {
		name: "context_manage",
		label: "Context Manage",
		description: [
			"Inspect or fold the current session context without summarizing.",
			"inspect returns token/age/category stats and a Top-N list of safe tool_result candidates (id, category, tokens, age, externalized, one-line summary) — never full block text.",
			"fold takes those ids and machine-folds them to reversible pointers (recall_folded restores the original).",
			"Never fold user messages, plans, or worker evidence that has not been written to .pi/findings.",
		].join(" "),
		promptSnippet: "Inspect foldable context and fold only safe tool_result candidates",
		parameters: CONTEXT_MANAGE_PARAMS,
		async execute(_toolCallId: string, raw: { action?: string; ids?: string[]; limit?: number }) {
			return executeContextManage(omitNulls(raw), deps);
		},
	};
}

export const CONTEXT_MANAGE_NUDGE_TEXT = [
	"[context-manage-nudge]",
	"Context is above the idle-fold watermark.",
	"Call context_manage action=inspect, pick only safe tool_result candidates,",
	"then context_manage action=fold with those ids.",
	"Do not summarize or rewrite history. Keep this turn short.",
].join(" ");

const NUDGE_THINKING_LEVEL = "low";
const THINKING_RANK: Record<string, number> = {
	off: 0,
	minimal: 1,
	low: 2,
	medium: 3,
	high: 4,
	xhigh: 5,
	max: 6,
};

export interface NudgeThinkingApi {
	getThinkingLevel?: () => string;
	setThinkingLevel?: (level: string) => void;
}

interface NudgeMessageSender extends NudgeThinkingApi {
	sendMessage(
		message: {
			customType: string;
			content: string;
			display: boolean;
			details: Record<string, unknown>;
		},
		options: { triggerTurn: true; deliverAs: "followUp" },
	): unknown;
}

/**
 * sendMessage() options are only { triggerTurn, deliverAs } — there is no per-turn
 * thinking override on ExtensionAPI.sendMessage. The host does expose session-wide
 * getThinkingLevel/setThinkingLevel. We temporarily lower the session level for the
 * nudge turn and restore it on the next assistant message_end (restoreNudgeThinking).
 * If those APIs are missing, thinking is left unchanged and details.thinkingApplied=false.
 */
let pendingThinkingRestore: { level: string } | undefined;

function snapshotAndLowerThinking(pi: NudgeThinkingApi): string | undefined {
	if (typeof pi.getThinkingLevel !== "function" || typeof pi.setThinkingLevel !== "function") {
		return undefined;
	}
	let current: string;
	try {
		current = pi.getThinkingLevel();
	} catch {
		return undefined;
	}
	if (typeof current !== "string" || !current) return undefined;
	const currentRank = THINKING_RANK[current];
	const targetRank = THINKING_RANK[NUDGE_THINKING_LEVEL];
	if (currentRank === undefined || targetRank === undefined || currentRank <= targetRank) {
		return undefined;
	}
	try {
		pi.setThinkingLevel(NUDGE_THINKING_LEVEL);
	} catch {
		return undefined;
	}
	return current;
}

/** Restore the pre-nudge session thinking level. Safe to call when nothing is pending. */
export function restoreNudgeThinking(pi: NudgeThinkingApi): void {
	const pending = pendingThinkingRestore;
	pendingThinkingRestore = undefined;
	if (!pending || typeof pi.setThinkingLevel !== "function") return;
	try {
		pi.setThinkingLevel(pending.level);
	} catch (err) {
		console.error("[pipiui-subagent] failed to restore thinking after context-manage nudge:", err);
	}
}

export function hasPendingNudgeThinkingRestore(): boolean {
	return pendingThinkingRestore !== undefined;
}

/** Inject one follow-up turn so the Boss can inspect→fold. */
export function queueContextManageNudge(
	pi: NudgeMessageSender,
	opts: { watermark?: number } = {},
): boolean {
	const previous = snapshotAndLowerThinking(pi);
	const thinkingApplied = previous !== undefined;
	try {
		pi.sendMessage(
			{
				customType: CONTEXT_MANAGE_NUDGE_CUSTOM_TYPE,
				content: CONTEXT_MANAGE_NUDGE_TEXT,
				display: false,
				details: {
					version: 1,
					thinking: thinkingApplied ? NUDGE_THINKING_LEVEL : "unchanged",
					thinkingApplied,
					watermark: opts.watermark ?? IDLE_FOLD_LOW_WATERMARK_DEFAULT,
				},
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		pendingThinkingRestore = previous ? { level: previous } : undefined;
		return true;
	} catch (err) {
		if (previous && typeof pi.setThinkingLevel === "function") {
			try {
				pi.setThinkingLevel(previous);
			} catch {
				/* already reporting the send failure */
			}
		}
		pendingThinkingRestore = undefined;
		console.error("[pipiui-subagent] context-manage nudge rejected:", err);
		return false;
	}
}

export function handleIdleFoldNudge(
	pi: NudgeMessageSender,
	info?: IdleFoldFireInfo & { watermark?: number },
): boolean {
	return queueContextManageNudge(pi, { watermark: info?.watermark });
}
