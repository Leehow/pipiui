/**
 * Per-dispatch budgets: `toolBudget` (tool calls, enforced in the child) and
 * `usageBudget` (reported tokens / cost, enforced by the parent).
 *
 * Pure: parsing, counting, and message text. index.ts wires the tool_call hook
 * in the worker, the env transport, the parent-side usage check, and the abort.
 *
 * Semantics (deliberately narrow):
 * - toolBudget.soft: one steer nudge to the worker to finalize. Advisory.
 * - toolBudget.hard: further calls to the `block` list are refused with a reason;
 *   other tools and the final answer are never blocked, and the run does not end.
 *   `block` defaults to read/grep/find/ls — the browsing tools — so a worker that
 *   is looping on recon is stopped, while an edit it is mid-way through is not.
 * - usageBudget.soft: status only; the Boss gets one `[subagent-budget]` notice.
 * - usageBudget.hard: the parent aborts the worker (same path as timeoutSecs).
 *   Do not put a hard usage cap on a writer; an abort is not a mutation-safe cut.
 *
 * `ask_boss` is never counted or blocked: waiting on the Boss is not spend.
 */

export const DEFAULT_TOOL_BUDGET_BLOCK = Object.freeze(["read", "grep", "find", "ls"]);
export const TOOL_BUDGET_ENV = "PIPIUI_TOOL_BUDGET";
/** Tools exempt from counting and blocking. */
export const TOOL_BUDGET_EXEMPT = Object.freeze(["ask_boss"]);
export const BLOCK_ALL = "*";
export const MAX_TOOL_BUDGET_HARD = 100_000;

export interface ToolBudget {
	soft?: number;
	hard: number;
	/** Tool names refused after `hard`; `["*"]` refuses every tool. */
	block: readonly string[];
}

export type ToolBudgetOutcome = "within-budget" | "soft-reached" | "hard-reached";

export interface ToolBudgetState {
	count: number;
	soft?: number;
	hard: number;
	block: readonly string[];
	outcome: ToolBudgetOutcome;
	blockedCalls: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, label: string, max: number): ParseResult<number> {
	if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, problem: `${label} must be an integer.` };
	if (value < 1) return { ok: false, problem: `${label} must be at least 1.` };
	if (value > max) return { ok: false, problem: `${label} must be at most ${max}.` };
	return { ok: true, value };
}

export function parseToolBudget(input: unknown): ParseResult<ToolBudget> {
	if (!isRecord(input)) return { ok: false, problem: "toolBudget must be an object { soft?, hard, block? }." };
	for (const key of Object.keys(input)) {
		if (key !== "soft" && key !== "hard" && key !== "block") return { ok: false, problem: `toolBudget has an unknown field \`${key}\`.` };
	}
	const hard = positiveInteger(input.hard, "toolBudget.hard", MAX_TOOL_BUDGET_HARD);
	if (!hard.ok) return hard;
	let soft: number | undefined;
	if (input.soft !== undefined) {
		const parsed = positiveInteger(input.soft, "toolBudget.soft", MAX_TOOL_BUDGET_HARD);
		if (!parsed.ok) return parsed;
		if (parsed.value > hard.value) return { ok: false, problem: "toolBudget.soft must not exceed toolBudget.hard." };
		soft = parsed.value;
	}
	let block: readonly string[] = DEFAULT_TOOL_BUDGET_BLOCK;
	if (input.block !== undefined) {
		if (!Array.isArray(input.block) || input.block.length === 0 || !input.block.every((entry) => typeof entry === "string" && entry.trim())) {
			return { ok: false, problem: `toolBudget.block must be a non-empty array of tool names, or ["${BLOCK_ALL}"] for every tool.` };
		}
		block = [...new Set(input.block.map((entry: string) => entry.trim()))];
	}
	return { ok: true, value: { ...(soft !== undefined ? { soft } : {}), hard: hard.value, block } };
}

export function encodeToolBudgetEnv(budget: ToolBudget): string {
	return JSON.stringify({ ...(budget.soft !== undefined ? { soft: budget.soft } : {}), hard: budget.hard, block: [...budget.block] });
}

/** Fails closed: a malformed value means no budget, never a guessed one. */
export function decodeToolBudgetEnv(raw: string | undefined): ToolBudget | undefined {
	if (!raw) return undefined;
	try {
		const parsed = parseToolBudget(JSON.parse(raw));
		return parsed.ok ? parsed.value : undefined;
	} catch {
		return undefined;
	}
}

export interface ToolBudgetVerdict {
	count: number;
	/** True exactly once, on the call that reaches `soft`. */
	softReached: boolean;
	/** Set when the call must be refused. */
	block?: string;
}

export interface ToolBudgetTracker {
	note(toolName: string): ToolBudgetVerdict;
	state(): ToolBudgetState;
}

function blocksTool(block: readonly string[], toolName: string): boolean {
	return block.includes(BLOCK_ALL) || block.includes(toolName);
}

export function createToolBudgetTracker(budget: ToolBudget): ToolBudgetTracker {
	let count = 0;
	let blockedCalls = 0;
	let softAnnounced = false;
	return {
		note(toolName) {
			if (TOOL_BUDGET_EXEMPT.includes(toolName)) return { count, softReached: false };
			count += 1;
			let softReached = false;
			if (budget.soft !== undefined && !softAnnounced && count >= budget.soft) {
				softAnnounced = true;
				softReached = true;
			}
			if (count > budget.hard && blocksTool(budget.block, toolName)) {
				blockedCalls += 1;
				return { count, softReached, block: formatToolBudgetBlockReason(toolName, count, budget) };
			}
			return { count, softReached };
		},
		state() {
			return summarizeToolBudget(budget, count, blockedCalls);
		},
	};
}

/** Parent-side summary from its own count; both sides count the same emitted calls. */
export function summarizeToolBudget(budget: ToolBudget, count: number, blockedCalls = 0): ToolBudgetState {
	const outcome: ToolBudgetOutcome = count > budget.hard
		? "hard-reached"
		: budget.soft !== undefined && count >= budget.soft
			? "soft-reached"
			: "within-budget";
	return { count, ...(budget.soft !== undefined ? { soft: budget.soft } : {}), hard: budget.hard, block: budget.block, outcome, blockedCalls };
}

export function formatToolBudgetSoftNudge(count: number, budget: ToolBudget): string {
	return `[tool-budget] Soft limit reached after ${count} tool call(s) (soft ${budget.soft}, hard ${budget.hard}). Stop starting new browsing or search work and finalize from what you already have; after ${budget.hard} calls, ${budget.block.includes(BLOCK_ALL) ? "every tool" : budget.block.join("/")} is refused.`;
}

export function formatToolBudgetBlockReason(toolName: string, count: number, budget: ToolBudget): string {
	return `[tool-budget] Hard limit reached: ${count} tool call(s) exceed hard ${budget.hard}. \`${toolName}\` is refused so you finalize from the context you already have. Write your final report now; do not retry this call.`;
}

/** One line for [subagent-done] and status; absent when no budget was set. */
export function formatToolBudgetLine(state: ToolBudgetState): string {
	const window = state.soft !== undefined ? `soft ${state.soft}, hard ${state.hard}` : `hard ${state.hard}`;
	const blocked = state.blockedCalls > 0 ? `, ${state.blockedCalls} refused` : "";
	return `Tool budget: ${state.count} call(s) (${window}) → ${state.outcome}${blocked}`;
}

// --- usage budget -----------------------------------------------------------------

export interface UsageBudgetLimit {
	soft?: number;
	hard: number;
}

export interface UsageBudget {
	tokens?: UsageBudgetLimit;
	costUsd?: UsageBudgetLimit;
}

export type UsageBudgetOutcome = "within-budget" | "soft-exceeded" | "hard-exceeded";

export interface UsageBudgetMetricState {
	used: number;
	soft?: number;
	hard: number;
	outcome: UsageBudgetOutcome;
}

export interface UsageBudgetState {
	tokens?: UsageBudgetMetricState;
	costUsd?: UsageBudgetMetricState;
	/** A hard limit was crossed; `reason` names the metric. */
	exhausted: boolean;
	reason?: "tokens" | "costUsd";
	softExceeded: boolean;
	/** Set by the runtime once the abort actually fired; an exhausted run that finished first keeps this unset. */
	aborted?: boolean;
}

/**
 * A hard usage cap is enforced at the next safe point: after any in-flight tool
 * call returns, so an edit or a test run is never cut in half. A tool that does
 * not return within this grace is not a safe point that is coming; abort anyway.
 */
export const USAGE_BUDGET_SAFE_POINT_GRACE_MS = 120_000;

function positiveNumber(value: unknown, label: string): ParseResult<number> {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return { ok: false, problem: `${label} must be a positive number.` };
	return { ok: true, value };
}

function parseLimit(input: unknown, label: string): ParseResult<UsageBudgetLimit> {
	if (!isRecord(input)) return { ok: false, problem: `${label} must be an object { soft?, hard }.` };
	for (const key of Object.keys(input)) {
		if (key !== "soft" && key !== "hard") return { ok: false, problem: `${label} has an unknown field \`${key}\`.` };
	}
	const hard = positiveNumber(input.hard, `${label}.hard`);
	if (!hard.ok) return hard;
	if (input.soft === undefined) return { ok: true, value: { hard: hard.value } };
	const soft = positiveNumber(input.soft, `${label}.soft`);
	if (!soft.ok) return soft;
	if (soft.value > hard.value) return { ok: false, problem: `${label}.soft must not exceed ${label}.hard.` };
	return { ok: true, value: { soft: soft.value, hard: hard.value } };
}

export function parseUsageBudget(input: unknown): ParseResult<UsageBudget> {
	if (!isRecord(input)) return { ok: false, problem: "usageBudget must be an object { tokens?: {soft?, hard}, costUsd?: {soft?, hard} }." };
	for (const key of Object.keys(input)) {
		if (key !== "tokens" && key !== "costUsd") return { ok: false, problem: `usageBudget has an unknown field \`${key}\`.` };
	}
	const budget: UsageBudget = {};
	if (input.tokens !== undefined) {
		const parsed = parseLimit(input.tokens, "usageBudget.tokens");
		if (!parsed.ok) return parsed;
		budget.tokens = parsed.value;
	}
	if (input.costUsd !== undefined) {
		const parsed = parseLimit(input.costUsd, "usageBudget.costUsd");
		if (!parsed.ok) return parsed;
		budget.costUsd = parsed.value;
	}
	if (!budget.tokens && !budget.costUsd) return { ok: false, problem: "usageBudget needs tokens and/or costUsd." };
	return { ok: true, value: budget };
}

function metricState(limit: UsageBudgetLimit, used: number): UsageBudgetMetricState {
	const outcome: UsageBudgetOutcome = used >= limit.hard
		? "hard-exceeded"
		: limit.soft !== undefined && used >= limit.soft
			? "soft-exceeded"
			: "within-budget";
	return { used, ...(limit.soft !== undefined ? { soft: limit.soft } : {}), hard: limit.hard, outcome };
}

/** Reported usage only — no reservations, no estimates of in-flight spend. */
export function evaluateUsageBudget(budget: UsageBudget, usage: { input: number; output: number; cost: number }): UsageBudgetState {
	const state: UsageBudgetState = { exhausted: false, softExceeded: false };
	if (budget.tokens) state.tokens = metricState(budget.tokens, usage.input + usage.output);
	if (budget.costUsd) state.costUsd = metricState(budget.costUsd, usage.cost);
	for (const [reason, metric] of [["tokens", state.tokens], ["costUsd", state.costUsd]] as const) {
		if (!metric) continue;
		if (metric.outcome === "hard-exceeded" && !state.exhausted) {
			state.exhausted = true;
			state.reason = reason;
		}
		if (metric.outcome !== "within-budget") state.softExceeded = true;
	}
	return state;
}

function formatTokens(value: number): string {
	return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(Math.round(value));
}

function formatMetric(label: string, metric: UsageBudgetMetricState, money: boolean): string {
	const show = (value: number) => (money ? `$${value.toFixed(2)}` : formatTokens(value));
	const window = metric.soft !== undefined ? `${show(metric.soft)}/${show(metric.hard)}` : show(metric.hard);
	return `${label} ${show(metric.used)} of ${window} (${metric.outcome})`;
}

export function formatUsageBudgetLine(state: UsageBudgetState): string {
	const parts: string[] = [];
	if (state.tokens) parts.push(formatMetric("tokens", state.tokens, false));
	if (state.costUsd) parts.push(formatMetric("cost", state.costUsd, true));
	const tail = state.exhausted
		? state.aborted
			? ` → aborted on ${state.reason} at the next safe point`
			: ` → hard limit on ${state.reason} reached; the worker finished before the abort landed`
		: "";
	return `Usage budget: ${parts.join("; ")}${tail}`;
}

/** Boss-facing soft notice; sent once per run. */
export function formatUsageBudgetSoftNotice(agentId: string, runId: string, state: UsageBudgetState): string {
	return `[subagent-budget] agentId=${agentId} runId=${runId}\n${formatUsageBudgetLine(state)}\nSoft limit is advisory: the worker keeps running. Steer it with a narrower brief on resume if the spend is not buying progress.`;
}

export function formatUsageBudgetAbortReason(state: UsageBudgetState): string {
	const metric = state.reason === "costUsd" ? state.costUsd : state.tokens;
	const used = state.reason === "costUsd" ? `$${(metric?.used ?? 0).toFixed(2)}` : formatTokens(metric?.used ?? 0);
	const hard = state.reason === "costUsd" ? `$${(metric?.hard ?? 0).toFixed(2)}` : formatTokens(metric?.hard ?? 0);
	return `usage_budget: reported ${state.reason} ${used} reached hard limit ${hard}; the worker was aborted at the next safe point (after any in-flight tool call). Resume the same agentId with a narrower brief, or raise the budget deliberately.`;
}
