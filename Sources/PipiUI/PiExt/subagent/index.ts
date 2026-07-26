/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
	getMarkdownTheme,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";
import { secretaryToolCallBlock } from "./secretary-policy.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

// ---- Pipi UI 集成：向 App 桥接服务上报 subagent 生命周期（无环境变量时完全静默） ----
const PIPIUI_PORT = process.env.PIPIUI_BRIDGE_PORT;
const PIPIUI_SESSION = process.env.PIPIUI_SESSION_KEY;
// 当前进程在 agent 树里的身份：主会话 depth=0，被派出的 subagent 由父进程注入
const PIPIUI_DEPTH = Number.parseInt(process.env.PIPIUI_AGENT_DEPTH || "0", 10);
const PIPIUI_PARENT = process.env.PIPIUI_AGENT_ID || null;
// App-owned authoritative session root. Nested agents inherit it even when their own
// process cwd is an isolated worktree.
const PIPIUI_MAIN_CWD = process.env.PIPIUI_MAIN_CWD;
const PIPIUI_AGENT_ROLE = process.env.PIPIUI_AGENT_ROLE;
// 多层护栏：depth >= 上限的进程不允许再派 subagent（终端裸跑同样生效）
const PIPIUI_MAX_DEPTH = Number.parseInt(process.env.PIPIUI_AGENT_MAX_DEPTH || "2", 10);
// App 注入的补丁版 subagent 扩展目录；嵌套 spawn 时再传 `-e`，保持上报/护栏一致
const PIPIUI_SUBAGENT_EXT = process.env.PIPIUI_SUBAGENT_EXT;

// 跟踪本扩展 spawn 出的子 pi，父进程退出时尽量收割，避免孤儿继续打桥接
const pipiuiChildProcs = new Set<ReturnType<typeof spawn>>();

function pipiuiTrackChild(proc: ReturnType<typeof spawn>): void {
	pipiuiChildProcs.add(proc);
	const done = () => pipiuiChildProcs.delete(proc);
	proc.on("close", done);
	proc.on("error", done);
}

function pipiuiKillAllChildren(): void {
	for (const child of pipiuiChildProcs) {
		try {
			child.kill("SIGTERM");
		} catch {
			/* ignore */
		}
	}
}

// Only hook `exit` (does not replace Node's default SIGTERM/SIGINT behavior).
// App-side PiProcess.terminate also SIGTERMs the process tree as a backstop.
process.on("exit", pipiuiKillAllChildren);

// 当前正在执行的 subagent 工具调用 id（同一次调用内的 single/parallel/chain 共享）
let pipiuiCurrentToolCall: string | null = null;

function pipiuiReport(payload: Record<string, unknown>): void {
	if (!PIPIUI_PORT || !PIPIUI_SESSION) return;
	fetch(`http://127.0.0.1:${PIPIUI_PORT}/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionKey: PIPIUI_SESSION, action: "agent_event", ...payload }),
	}).catch(() => {});
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

/** Plain summary for PipiUI bridge (no theme codes) — matches main-agent ToolCallSummary. */
function summarizeToolArgsForUI(toolName: string, args: Record<string, unknown>): string {
	const pathOf = () => String(args.file_path || args.path || "…");
	switch (toolName) {
		case "edit":
		case "write":
		case "read":
		case "ls":
			return pathOf();
		case "bash":
		case "shell": {
			const command = String(args.command || "…");
			return command.length > 120 ? `${command.slice(0, 120)}…` : command;
		}
		case "web_search":
			return String(args.query || "…");
		case "web_fetch":
			return String(args.url || "…");
		case "generate_image": {
			const prompt = String(args.prompt || "…").trim();
			return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt || "…";
		}
		case "browser": {
			const action = String(args.action || "…");
			const detail = String(args.url || args.js || args.mode || "");
			return detail ? `${action} ${detail}` : action;
		}
		default: {
			const raw = JSON.stringify(args ?? {});
			return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
		}
	}
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	/** Short title for UI display; falls back to task if omitted. */
	title?: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	/** PipiUI bridge / completion-signal id */
	agentId?: string;
	/** Runtime-attested verify result (set when the brief carried `verify`). */
	verify?: VerifyAttestation;
	/** Brief carried `verify` but it was not run because the agent was aborted. */
	verifySkipped?: boolean;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	/** True when tool returned immediately and completion arrives via [subagent-done] followUp */
	background?: boolean;
	agentIds?: string[];
}

interface RunSingleAgentOptions {
	/** When true, start report includes background flag; caller must not bind parent abort. */
	background?: boolean;
	/** Pre-assigned id (background path needs ids before process exits). */
	agentId?: string;
	/** Short one-line title for the Subagents panel list; falls back to task text if omitted. */
	title?: string;
	/** Current session model as `provider/id` (depth 0 `ctx.model`); used for「跟随主 Agent」. */
	sessionModel?: string;
	/** Shell command the runtime runs in the agent's cwd after the process ends (attested verify). */
	verify?: string;
}

/** Format ExtensionAPI ctx.model → `provider/id`. */
function formatCtxModel(model: { provider?: string; id?: string } | undefined | null): string | undefined {
	if (!model?.provider || !model?.id) return undefined;
	return `${model.provider}/${model.id}`;
}

interface SubagentModelOverride {
	model: string;
	/** Explicit Pi `--thinking` level. Absent preserves the existing/default behavior. */
	thinking?: string;
}

/** Hot-read PipiUI settings JSON (UserDefaults mirror). Missing / empty = follow main.
 *
 * Legacy values are model strings. New values are `{ model, thinking? }`; normalizing
 * both shapes here lets a running extension immediately see settings saved by the app.
 */
function loadSubagentModelOverrides(): Record<string, SubagentModelOverride> {
	const file =
		process.env.PIPIUI_SUBAGENT_MODELS_FILE ||
		path.join(os.homedir(), "Library/Application Support/PipiUI/subagent-models.json");
	try {
		const raw = fs.readFileSync(file, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const result: Record<string, SubagentModelOverride> = {};
			for (const [agentName, value] of Object.entries(parsed)) {
				if (typeof value === "string" && value.trim()) {
					result[agentName] = { model: value.trim() };
				} else if (value && typeof value === "object" && !Array.isArray(value)) {
					const candidate = value as { model?: unknown; thinking?: unknown };
					if (typeof candidate.model === "string" && candidate.model.trim()) {
						const thinking =
							typeof candidate.thinking === "string" && candidate.thinking.trim()
								? candidate.thinking.trim()
								: undefined;
						result[agentName] = { model: candidate.model.trim(), ...(thinking ? { thinking } : {}) };
					}
				}
			}
			return result;
		}
	} catch {
		// absent or unreadable → all follow main
	}
	return {};
}

const PI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** `model:high` is Pi shorthand, not a distinct model id. */
function stripModelThinkingSuffix(modelRef: string): string {
	const colon = modelRef.lastIndexOf(":");
	if (colon <= 0) return modelRef;
	return PI_THINKING_LEVELS.has(modelRef.slice(colon + 1)) ? modelRef.slice(0, colon) : modelRef;
}

/**
 * Hot-read the composer / bottom-bar model written by Swift (`main-model.txt`).
 * Prefer this over a stale PIPIUI_MAIN_MODEL env from process spawn.
 */
function loadMainModelFile(): string | undefined {
	const file =
		process.env.PIPIUI_MAIN_MODEL_FILE ||
		path.join(os.homedir(), "Library/Application Support/PipiUI/main-model.txt");
	try {
		const raw = fs.readFileSync(file, "utf-8").trim();
		return raw || undefined;
	} catch {
		return undefined;
	}
}

// Settings still store the group id `browser_*`; it now expands to the single `browser` tool.
const BROWSER_TOOL_NAMES = ["browser"];

/** Hot-read Settings → 工具开关 denylist. */
function loadDisabledTools(): Set<string> {
	const file = path.join(
		os.homedir(),
		"Library/Application Support/PipiUI/tool-skill-settings.json",
	);
	try {
		const raw = fs.readFileSync(file, "utf-8");
		const parsed = JSON.parse(raw) as { disabledTools?: unknown };
		const list = Array.isArray(parsed.disabledTools)
			? parsed.disabledTools.filter((x): x is string => typeof x === "string")
			: [];
		const out = new Set<string>();
		for (const name of list) {
			if (name === "browser_*") {
				for (const t of BROWSER_TOOL_NAMES) out.add(t);
			} else {
				out.add(name);
			}
		}
		return out;
	} catch {
		return new Set();
	}
}

/**
 * Resolve model for a subagent type:
 * 1. Explicit override in settings JSON
 * 2. Follow main (composer/bottom-bar): depth0 ctx.model → main-model.txt → PIPIUI_MAIN_MODEL
 * 3. agent.md frontmatter model
 */
function resolveAgentModel(
	agentName: string,
	frontmatterModel: string | undefined,
	sessionModel: string | undefined,
): string | undefined {
	const overrides = loadSubagentModelOverrides();
	const explicit = overrides[agentName];
	if (explicit?.model) {
		return explicit.model;
	}
	const fileMain = loadMainModelFile();
	const main =
		(PIPIUI_DEPTH === 0 ? sessionModel : undefined) ||
		fileMain ||
		process.env.PIPIUI_MAIN_MODEL ||
		sessionModel;
	if (main && main.trim()) return main.trim();
	const fb = frontmatterModel?.trim();
	return fb || undefined;
}

/** Only explicit per-subagent settings receive a `--thinking` argument. */
function resolveAgentThinking(agentName: string): string | undefined {
	return loadSubagentModelOverrides()[agentName]?.thinking;
}

/** Main-agent model to stamp onto child env so nested agents still「跟随主」. */
function inheritMainModel(sessionModel: string | undefined): string | undefined {
	const fileMain = loadMainModelFile();
	if (PIPIUI_DEPTH === 0) {
		return sessionModel || fileMain || process.env.PIPIUI_MAIN_MODEL || undefined;
	}
	return process.env.PIPIUI_MAIN_MODEL || fileMain || sessionModel || undefined;
}

/** Optional worktree isolation metadata reported to the App bridge. */
interface WorktreePlacement {
	/** Effective spawn cwd (worktree path or original). */
	cwd: string;
	worktreePath?: string;
	worktreeBranch?: string;
	/** Set when worktree was requested but creation failed (spawn falls back). */
	worktreeError?: string;
}

interface AgentRuntimeRolePolicy {
	role: "worker" | "closeout-secretary";
	worktree: "isolated" | "main-session";
	allowRecursiveDelegation: boolean;
}

/**
 * Runtime-owned policy: agent markdown/prompt text cannot opt the closeout secretary
 * back into a worktree or recursive delegation.
 */
function runtimeRolePolicyForAgent(agentName: string): AgentRuntimeRolePolicy {
	if (agentName === "secretary") {
		return {
			role: "closeout-secretary",
			worktree: "main-session",
			allowRecursiveDelegation: false,
		};
	}
	return { role: "worker", worktree: "isolated", allowRecursiveDelegation: true };
}

// Done-message caps (clean-context orchestration): verdict agents get a tight cap
// (code is the product; the report is evidence), explore/plan keep a larger one
// (the report IS the deliverable), errors/aborts always get the error cap.
const VERDICT_DONE_CAP = 1500;
const REPORT_DONE_CAP = 6000;
const ERROR_DONE_CAP = 6000;
// Store cap for the pull path (`subagent_status full:true`). Must comfortably hold a
// whole explore/plan report: this is the only place the full text survives, and every
// done message advertises it as the escape hatch.
const JOB_RESULT_STORE_CAP = 32000;
const JOB_RESULT_DISPLAY_CAP = 8000;
const MAX_JOB_RECORDS = 40;

// ---- Attested verify (system testimony): the runtime runs `verify` in the agent's cwd ----
const VERIFY_TIMEOUT_MS = 120_000;
const VERIFY_TAIL_CHARS = 2000;
const VERIFY_TAIL_LINES = 20;
const VERIFY_DONE_TAIL_LINES = 12;
/** Rolling collection cap while verify runs: retain only this tail so a chatty
 * command cannot buffer unbounded output for up to VERIFY_TIMEOUT_MS. */
const VERIFY_COLLECT_TAIL_CHARS = 64 * 1024;

interface VerifyAttestation {
	command: string;
	exitCode: number | null;
	timedOut: boolean;
	tail: string;
}

function tailText(text: string, maxChars: number, maxLines: number): string {
	const trimmed = text.replace(/\s+$/g, "");
	if (!trimmed) return "";
	const lines = trimmed.split("\n");
	const sliced = lines.length > maxLines ? lines.slice(-maxLines) : lines;
	let out = sliced.join("\n");
	if (out.length > maxChars) out = out.slice(-maxChars);
	return out;
}

/** Run `bash -lc <command>` in cwd with a hard timeout; capture combined stdout+stderr tail. */
function runVerifyCommand(command: string, cwd: string): Promise<VerifyAttestation> {
	return new Promise((resolve) => {
		let proc: ReturnType<typeof spawn>;
		try {
			// detached: own process group so a timeout can SIGKILL the whole group —
			// grandchildren holding the stdout pipe must not delay `close` (verify is
			// awaited before the "end" report, so a stuck descendant blocks done+merge).
			proc = spawn("bash", ["-lc", command], {
				cwd,
				shell: false,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: process.env,
			});
		} catch (err) {
			resolve({
				command,
				exitCode: null,
				timedOut: false,
				tail: `[verify spawn error: ${err instanceof Error ? err.message : String(err)}]`,
			});
			return;
		}
		let combined = "";
		let timedOut = false;
		// Rolling tail buffer: never retain more than VERIFY_COLLECT_TAIL_CHARS.
		const appendChunk = (chunk: string) => {
			combined += chunk;
			if (combined.length > VERIFY_COLLECT_TAIL_CHARS) {
				combined = combined.slice(-VERIFY_COLLECT_TAIL_CHARS);
			}
		};
		const killTimer = setTimeout(() => {
			timedOut = true;
			try {
				if (proc.pid !== undefined) process.kill(-proc.pid, "SIGKILL");
				else proc.kill("SIGKILL");
			} catch {
				// Group kill failed (e.g. process already gone) — fall back to the direct pid.
				try {
					proc.kill("SIGKILL");
				} catch {
					/* ignore */
				}
			}
			// Destroy stdio so `close` fires even if a descendant still holds the pipes.
			try {
				proc.stdout?.destroy();
				proc.stderr?.destroy();
			} catch {
				/* ignore */
			}
		}, VERIFY_TIMEOUT_MS);
		proc.stdout?.on("data", (d) => {
			appendChunk(d.toString());
		});
		proc.stderr?.on("data", (d) => {
			appendChunk(d.toString());
		});
		proc.on("error", (err) => {
			clearTimeout(killTimer);
			appendChunk(`\n[verify spawn error: ${err.message}]`);
			resolve({
				command,
				exitCode: null,
				timedOut,
				tail: tailText(combined, VERIFY_TAIL_CHARS, VERIFY_TAIL_LINES),
			});
		});
		proc.on("close", (code) => {
			clearTimeout(killTimer);
			const timeoutNote = `[verify timed out after ${VERIFY_TIMEOUT_MS / 1000}s]`;
			let tail = tailText(combined, VERIFY_TAIL_CHARS, VERIFY_TAIL_LINES);
			if (timedOut) tail = tail ? `${tail}\n${timeoutNote}` : timeoutNote;
			resolve({ command, exitCode: timedOut ? null : code, timedOut, tail });
		});
	});
}

function formatVerifyExit(att: VerifyAttestation): string {
	if (att.timedOut) return "null (timed out)";
	return String(att.exitCode ?? "null");
}

/** `Verify: $ ... → exit N (attested)` line for a runtime attestation. */
function formatVerifyLine(att: VerifyAttestation): string {
	return `Verify: $ ${att.command} → exit ${formatVerifyExit(att)} (attested)`;
}

/**
 * `verified` tri-state shared by done messages and foreground aggregates.
 * Abort/error short-circuits to none — no testimony was gathered for a synthesized failure.
 */
function verifiedStateFor(
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string | boolean },
): "pass" | "fail" | "none" {
	const aborted = extra?.aborted ?? result.stopReason === "aborted";
	const att = result.verify;
	return aborted || extra?.error || !att ? "none" : !att.timedOut && att.exitCode === 0 ? "pass" : "fail";
}

const emptyUsage = (): UsageStats => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
	turns: 0,
});

// ---- In-process job registry (model-visible via subagent_status; independent of App UI) ----
type JobState = "running" | "ok" | "failed" | "aborted";

interface JobRecord {
	agentId: string;
	name: string;
	task: string; // truncated summary
	/** Short UI title (optional). */
	title?: string;
	state: JobState;
	startedAt: number;
	endedAt?: number;
	activity?: string;
	cost?: number;
	turns?: number;
	/** Full-ish result text for status-by-id (capped) */
	resultText?: string;
	/** Runtime-attested verify (when the brief carried `verify`). */
	verify?: VerifyAttestation;
}

const jobRegistry = new Map<string, JobRecord>();

// ---- Stall watchdog + abort：运行中后台 job 的外部可触达句柄 ----
const STALL_THRESHOLD_MS = 120_000;
const STALL_WATCHDOG_INTERVAL_MS = 30_000;

interface RunningAgentHandle {
	/** 外部中止入口（action=abort / subagent_abort 命令）；走 killProc SIGTERM→SIGKILL。 */
	controller: AbortController;
	name: string;
	task: string;
	title?: string;
	/** 最后一次有任何流式事件/输出（stdout/stderr）的时间戳。 */
	lastActivityAt: number;
	/** 当前卡死片段是否已推送过（有新活动后重新武装）。 */
	stallNotified: boolean;
}

/** 仅后台 job 注册；前台 job 由工具调用自身的 abort signal 负责。 */
const runningAgents = new Map<string, RunningAgentHandle>();

function noteAgentActivity(agentId: string): void {
	const handle = runningAgents.get(agentId);
	if (!handle) return;
	handle.lastActivityAt = Date.now();
	handle.stallNotified = false;
}

function stalledInfoFor(agentId: string, now: number): { stalled: boolean; idleSec: number } {
	const handle = runningAgents.get(agentId);
	if (!handle) return { stalled: false, idleSec: 0 };
	const idleSec = Math.max(0, Math.floor((now - handle.lastActivityAt) / 1000));
	return { stalled: idleSec * 1000 >= STALL_THRESHOLD_MS, idleSec };
}

function formatJobStateWithStall(job: JobRecord, now: number): string {
	if (job.state !== "running") return job.state;
	const info = stalledInfoFor(job.agentId, now);
	return info.stalled ? `running (stalled, idle ${info.idleSec}s)` : "running";
}

/**
 * 中止运行中的后台 job：触发其 AbortController → killProc（SIGTERM，5s 后未退出则 SIGKILL）。
 * job 以 aborted 结束并正常推 [subagent-done]。agentId 不存在/已结束返回明确错误。
 */
function abortRunningAgent(agentId: string): { ok: boolean; message: string } {
	const job = jobRegistry.get(agentId);
	if (job && job.state !== "running") {
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: job already finished with state "${job.state}".`,
		};
	}
	const handle = runningAgents.get(agentId);
	if (!handle) {
		if (!job) {
			return {
				ok: false,
				message: `Cannot abort agentId=${agentId}: unknown agentId (no such job in this session process).`,
			};
		}
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: job is running but has no abort handle (already finishing?).`,
		};
	}
	handle.controller.abort();
	return {
		ok: true,
		message: `Abort requested for agentId=${agentId} (${handle.name}). SIGTERM sent (SIGKILL after 5s if still alive); the job will report [subagent-done] with aborted status.`,
	};
}

/**
 * Head-keeping truncation for every report surface (done message, job store, status
 * display): worker templates put the key sections (summary / Files / Verification /
 * Notes) FIRST, so keep the head and mark the omission in the same bracketed style as
 * truncateParallelOutput. All three surfaces must truncate the SAME direction —
 * mixing head-keep and tail-keep makes the advertised "full report" pull return a
 * disjoint slice of the report the done message showed.
 */
function truncateTextHead(text: string, cap: number): string {
	if (text.length <= cap) return text;
	return `${text.slice(0, cap)}\n\n[Output truncated: ${text.length - cap} chars omitted.]`;
}

function taskSummary(task: string, cap = 200): string {
	const t = task.replace(/\s+/g, " ").trim();
	return t.length <= cap ? t : `${t.slice(0, cap)}…`;
}

function jobPrune(): void {
	if (jobRegistry.size <= MAX_JOB_RECORDS) return;
	const finished = [...jobRegistry.entries()]
		.filter(([, j]) => j.state !== "running")
		.sort((a, b) => (a[1].endedAt ?? a[1].startedAt) - (b[1].endedAt ?? b[1].startedAt));
	for (const [id] of finished) {
		if (jobRegistry.size <= MAX_JOB_RECORDS) break;
		jobRegistry.delete(id);
	}
	if (jobRegistry.size <= MAX_JOB_RECORDS) return;
	const all = [...jobRegistry.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
	for (const [id] of all) {
		if (jobRegistry.size <= MAX_JOB_RECORDS) break;
		jobRegistry.delete(id);
	}
}

function jobUpsertRunning(agentId: string, name: string, task: string, title?: string): void {
	const existing = jobRegistry.get(agentId);
	if (existing && existing.state !== "running") return; // never reopen a terminal job
	jobRegistry.set(agentId, {
		agentId,
		name,
		task: taskSummary(task),
		title,
		state: "running",
		startedAt: existing?.startedAt ?? Date.now(),
		activity: existing?.activity,
		cost: existing?.cost,
		turns: existing?.turns,
	});
	jobPrune();
}

function jobPatchRunning(
	agentId: string,
	patch: { activity?: string; cost?: number; turns?: number },
): void {
	const job = jobRegistry.get(agentId);
	if (!job || job.state !== "running") return;
	if (patch.activity !== undefined) job.activity = patch.activity;
	if (patch.cost !== undefined) job.cost = patch.cost;
	if (patch.turns !== undefined) job.turns = patch.turns;
}

function jobFinalize(
	agentId: string,
	fields: {
		name?: string;
		task?: string;
		state: JobState;
		resultText?: string;
		cost?: number;
		turns?: number;
		activity?: string;
		verify?: VerifyAttestation;
	},
): void {
	if (fields.state === "running") return;
	const existing = jobRegistry.get(agentId);
	const now = Date.now();
	if (existing && existing.state !== "running") {
		// Already terminal: fill missing result/metrics only (notify may race with runSingleAgent end)
		if (!existing.resultText && fields.resultText)
			existing.resultText = truncateTextHead(fields.resultText, JOB_RESULT_STORE_CAP);
		if (existing.cost === undefined && fields.cost !== undefined) existing.cost = fields.cost;
		if (existing.turns === undefined && fields.turns !== undefined) existing.turns = fields.turns;
		if (!existing.activity && fields.activity) existing.activity = fields.activity;
		if (!existing.verify && fields.verify) existing.verify = fields.verify;
		return;
	}
	jobRegistry.set(agentId, {
		agentId,
		name: fields.name ?? existing?.name ?? "?",
		task: fields.task ? taskSummary(fields.task) : (existing?.task ?? ""),
		state: fields.state,
		startedAt: existing?.startedAt ?? now,
		endedAt: now,
		activity: fields.activity ?? existing?.activity,
		cost: fields.cost ?? existing?.cost,
		turns: fields.turns ?? existing?.turns,
		resultText:
			fields.resultText !== undefined
				? truncateTextHead(fields.resultText, JOB_RESULT_STORE_CAP)
				: existing?.resultText,
		verify: fields.verify ?? existing?.verify,
	});
	jobPrune();
}

function jobStateFromResult(
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): JobState {
	const aborted = extra?.aborted ?? result.stopReason === "aborted";
	if (aborted) return "aborted";
	if (extra?.error || isFailedResult(result)) return "failed";
	return "ok";
}

/** Mark job terminal before/with notify so status works even if deliver fails. */
function ensureJobTerminalFromResult(
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): void {
	const agentId = result.agentId;
	if (!agentId) return;
	const resultText = extra?.error || getResultOutput(result) || result.stderr || "(no output)";
	jobFinalize(agentId, {
		name: result.agent,
		task: result.task,
		state: jobStateFromResult(result, extra),
		resultText,
		cost: result.usage.cost,
		turns: result.usage.turns,
		verify: result.verify,
	});
}

function formatElapsedMs(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return `${m}m${rs}s`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return `${h}h${rm}m`;
}

function formatJobsStatus(opts: { agentId?: string; onlyRunning?: boolean; full?: boolean }): string {
	const now = Date.now();
	if (opts.agentId) {
		const job = jobRegistry.get(opts.agentId);
		if (!job) {
			return `No job found for agentId=${opts.agentId}. Use subagent_status without agentId to list recent jobs.`;
		}
		const elapsed =
			job.state === "running"
				? formatElapsedMs(now - job.startedAt)
				: formatElapsedMs((job.endedAt ?? now) - job.startedAt);
		const cost = typeof job.cost === "number" ? `$${job.cost.toFixed(4)}` : "-";
		const turns = job.turns ?? "-";
		const lines = [
			`agentId: ${job.agentId}`,
			`name: ${job.name}`,
			...(job.title ? [`title: ${job.title}`] : []),
			`state: ${formatJobStateWithStall(job, now)}`,
			`turns: ${turns}`,
			`cost: ${cost}`,
			`elapsed: ${elapsed}`,
			`Task: ${job.task || "(none)"}`,
		];
		if (job.verify) {
			lines.push(`Verify: $ ${job.verify.command} → exit ${formatVerifyExit(job.verify)} (attested)`);
			if (job.verify.tail) {
				lines.push("Verify tail:", ...job.verify.tail.split("\n").map((l) => `  ${l}`));
			}
		}
		if (job.state === "running") {
			lines.push(`activity: ${job.activity || "(starting/idle)"}`);
		} else {
			const stored = job.resultText || "(no result stored)";
			// Head-keep like the done message: the report's structured sections come first.
			const result = opts.full ? stored : truncateTextHead(stored, JOB_RESULT_DISPLAY_CAP);
			lines.push("Result:", result);
		}
		return lines.join("\n");
	}

	let jobs = [...jobRegistry.values()];
	if (opts.onlyRunning) jobs = jobs.filter((j) => j.state === "running");
	if (jobs.length === 0) {
		return opts.onlyRunning
			? "No running subagent jobs."
			: "No subagent jobs recorded in this process.";
	}

	// running first, then newest endedAt/startedAt
	jobs.sort((a, b) => {
		const ar = a.state === "running" ? 0 : 1;
		const br = b.state === "running" ? 0 : 1;
		if (ar !== br) return ar - br;
		const at = a.endedAt ?? a.startedAt;
		const bt = b.endedAt ?? b.startedAt;
		return bt - at;
	});

	const header = `| agentId | name | state | turns | cost | elapsed | preview |`;
	const sep = `| --- | --- | --- | --- | --- | --- | --- |`;
	const rows = jobs.map((j) => {
		const elapsed =
			j.state === "running"
				? formatElapsedMs(now - j.startedAt)
				: formatElapsedMs((j.endedAt ?? now) - j.startedAt);
		const cost = typeof j.cost === "number" ? `$${j.cost.toFixed(4)}` : "-";
		const turns = j.turns ?? "-";
		const previewRaw =
			j.state === "running"
				? j.activity || j.task || ""
				: j.resultText || j.task || "";
		const preview = previewRaw.replace(/\s+/g, " ").trim().slice(0, 80);
		return `| ${j.agentId} | ${j.name} | ${formatJobStateWithStall(j, now)} | ${turns} | ${cost} | ${elapsed} | ${preview || "-"} |`;
	});
	return [header, sep, ...rows].join("\n");
}

function generatePipiuiAgentId(): string {
	return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Sanitize agentId for branch/dir names (filesystem + git ref safe). */
function safeId(agentId: string): string {
	return agentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "agent";
}

function gitSpawnSync(
	args: string[],
	cwd?: string,
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		shell: false,
		env: process.env,
	});
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	const stderr = typeof result.stderr === "string" ? result.stderr : "";
	return {
		ok: result.status === 0 && !result.error,
		stdout: stdout.trim(),
		stderr: (stderr || result.error?.message || "").trim(),
		status: result.status,
	};
}

/**
 * Parse `git worktree list --porcelain` into { path, branch? } rows.
 * branch is short name (refs/heads/ stripped); detached → branch undefined.
 */
function parseWorktreeListPorcelain(output: string): Array<{ path: string; branch?: string }> {
	const results: Array<{ path: string; branch?: string }> = [];
	let currentPath: string | undefined;
	let currentBranch: string | undefined;

	const flush = () => {
		if (!currentPath) {
			currentPath = undefined;
			currentBranch = undefined;
			return;
		}
		results.push({ path: currentPath, branch: currentBranch });
		currentPath = undefined;
		currentBranch = undefined;
	};

	for (const raw of output.split(/\r?\n/)) {
		const line = raw;
		if (line.startsWith("worktree ")) {
			flush();
			currentPath = line.slice("worktree ".length);
		} else if (line.startsWith("branch ")) {
			let ref = line.slice("branch ".length).trim();
			if (ref.startsWith("refs/heads/")) ref = ref.slice("refs/heads/".length);
			currentBranch = ref || undefined;
		} else if (line === "detached") {
			currentBranch = undefined;
		} else if (line.trim() === "") {
			flush();
		}
	}
	flush();
	return results;
}

/**
 * Default: create an isolated git worktree under <toplevel>/.pi/worktrees/<safeId>
 * on branch pipiui/<safeId> so subagents write without polluting the main dirty tree.
 *
 * Resume / continue same agentId:
 * - Reuses preferred path when it is already a valid git worktree.
 * - If branch `pipiui/<safeId>` is already checked out in *any* registered worktree
 *   (even when preferred path differs), reuses that path so续作 lands on the same tree.
 * - Process is still a fresh spawn; only cwd/branch continuity is preserved (not LLM context).
 *
 * Off when:
 * - PIPIUI_WORKTREE=0
 * - caller passed explicit cwd (respect; do not wrap)
 * - effective cwd is not inside a git work tree
 *
 * TS never auto remove / commit / merge (Swift SubagentStore owns lifecycle).
 * On failure creating wt, fall back to original cwd + worktreeError.
 * Never auto-merge in TS or Swift end handlers — GUI confirms merge/discard.
 * failed/aborted/interrupted → keep pendingReview for续作; GUI merge/discard remains as fallback.
 */
function resolveSubagentWorktree(opts: {
	agentId: string;
	defaultCwd: string;
	explicitCwd?: string;
	policy: AgentRuntimeRolePolicy;
}): WorktreePlacement {
	const fallbackCwd = opts.explicitCwd ?? opts.defaultCwd;

	if (opts.policy.worktree === "main-session") {
		// Ignore caller cwd and nested worker cwd: secretary is a session-management
		// role and must not manufacture another branch/worktree while closing them out.
		return { cwd: path.resolve(PIPIUI_MAIN_CWD || opts.defaultCwd) };
	}
	if (process.env.PIPIUI_WORKTREE === "0") {
		return { cwd: fallbackCwd };
	}
	// Explicit cwd from tool caller → respect, no worktree wrap
	if (opts.explicitCwd) {
		return { cwd: opts.explicitCwd };
	}

	const effectiveCwd = opts.defaultCwd;
	const inside = gitSpawnSync(["-C", effectiveCwd, "rev-parse", "--is-inside-work-tree"]);
	if (!inside.ok || inside.stdout !== "true") {
		return { cwd: effectiveCwd };
	}

	const top = gitSpawnSync(["-C", effectiveCwd, "rev-parse", "--show-toplevel"]);
	if (!top.ok || !top.stdout) {
		return {
			cwd: effectiveCwd,
			worktreeError: top.stderr || "git rev-parse --show-toplevel failed",
		};
	}
	const toplevel = path.resolve(top.stdout);
	const id = safeId(opts.agentId);
	const worktreesRoot = path.join(toplevel, ".pi", "worktrees");
	try {
		fs.mkdirSync(worktreesRoot, { recursive: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { cwd: effectiveCwd, worktreeError: `mkdir .pi/worktrees: ${msg}` };
	}

	const preferredPath = path.resolve(worktreesRoot, id);
	const preferredBranch = `pipiui/${id}`;

	// 1) Reuse existing directory if it is already a valid worktree
	if (fs.existsSync(preferredPath)) {
		const reuse = gitSpawnSync(["-C", preferredPath, "rev-parse", "--is-inside-work-tree"]);
		if (reuse.ok && reuse.stdout === "true") {
			const br = gitSpawnSync(["-C", preferredPath, "rev-parse", "--abbrev-ref", "HEAD"]);
			const branch =
				br.ok && br.stdout && br.stdout !== "HEAD" ? br.stdout : preferredBranch;
			return {
				cwd: preferredPath,
				worktreePath: preferredPath,
				worktreeBranch: branch,
			};
		}
	}

	// 2) Resume by branch: if pipiui/<id> is already attached somewhere in worktree list, reuse that path
	//    (even when preferred path differs — e.g. previous alt path/suffix).
	const listOut = gitSpawnSync(["-C", toplevel, "worktree", "list", "--porcelain"], toplevel);
	if (listOut.ok && listOut.stdout) {
		const rows = parseWorktreeListPorcelain(listOut.stdout);
		const hit = rows.find((r) => r.branch === preferredBranch && r.path);
		if (hit) {
			const abs = path.resolve(hit.path);
			const still = gitSpawnSync(["-C", abs, "rev-parse", "--is-inside-work-tree"]);
			if (still.ok && still.stdout === "true") {
				return {
					cwd: abs,
					worktreePath: abs,
					worktreeBranch: preferredBranch,
				};
			}
		}
		// Also match any pipiui/<id>-* suffix branch already checked out (prior collision rename)
		const prefix = `pipiui/${id}`;
		const prefixed = rows.find(
			(r) =>
				r.branch &&
				(r.branch === prefix || r.branch.startsWith(`${prefix}-`)) &&
				r.path,
		);
		if (prefixed && prefixed.branch) {
			const abs = path.resolve(prefixed.path);
			const still = gitSpawnSync(["-C", abs, "rev-parse", "--is-inside-work-tree"]);
			if (still.ok && still.stdout === "true") {
				return {
					cwd: abs,
					worktreePath: abs,
					worktreeBranch: prefixed.branch,
				};
			}
		}
	}

	const tryAdd = (absPath: string, branch: string): { ok: boolean; error: string } => {
		const r = gitSpawnSync(
			["-C", toplevel, "worktree", "add", "-b", branch, absPath, "HEAD"],
			toplevel,
		);
		if (r.ok) return { ok: true, error: "" };
		return { ok: false, error: r.stderr || r.stdout || "git worktree add failed" };
	};

	// 3) Create new worktree on preferred path/branch
	let add = tryAdd(preferredPath, preferredBranch);
	if (add.ok) {
		return {
			cwd: preferredPath,
			worktreePath: preferredPath,
			worktreeBranch: preferredBranch,
		};
	}

	// Branch (or path) collision → unique suffix
	const suffix = Date.now().toString(36).slice(-6);
	const altBranch = `pipiui/${id}-${suffix}`;
	// Clean a failed non-git leftover at preferred path when possible
	if (fs.existsSync(preferredPath)) {
		const stillGit = gitSpawnSync(["-C", preferredPath, "rev-parse", "--is-inside-work-tree"]);
		if (!(stillGit.ok && stillGit.stdout === "true")) {
			try {
				fs.rmSync(preferredPath, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}

	// Spec: worktree add ${absPath} -b pipiui/${id}-${suffix} HEAD
	const altAddSamePath = gitSpawnSync(
		["-C", toplevel, "worktree", "add", preferredPath, "-b", altBranch, "HEAD"],
		toplevel,
	);
	if (altAddSamePath.ok) {
		return {
			cwd: preferredPath,
			worktreePath: preferredPath,
			worktreeBranch: altBranch,
		};
	}

	const altPath = path.resolve(worktreesRoot, `${id}-${suffix}`);
	add = tryAdd(altPath, altBranch);
	if (add.ok) {
		return {
			cwd: altPath,
			worktreePath: altPath,
			worktreeBranch: altBranch,
		};
	}

	const errParts = [add.error, altAddSamePath.stderr || altAddSamePath.stdout]
		.filter(Boolean)
		.join("; ");
	return {
		cwd: effectiveCwd,
		worktreeError: errParts || "git worktree add failed",
	};
}

/** Done-message cap by agent name; error/abort overrides to ERROR_DONE_CAP. */
function doneCapForAgent(agentName: string, isError: boolean): number {
	if (isError) return ERROR_DONE_CAP;
	if (agentName === "explore" || agentName === "plan") return REPORT_DONE_CAP;
	// general-purpose / reviewer / lead, and the default for unknown names
	return VERDICT_DONE_CAP;
}

function formatSubagentDoneMessage(
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): string {
	const aborted = extra?.aborted ?? result.stopReason === "aborted";
	const ok = !isFailedResult(result) && !aborted && !extra?.error;
	const isError = aborted || Boolean(extra?.error) || isFailedResult(result);
	const att = result.verify;
	// `ok` stays process-level; `verified` reflects only the runtime-attested verify command.
	const verified = verifiedStateFor(result, extra);
	// Head-keep: templates put summary/Files/Verification/Notes first — a tail-keep
	// truncation would drop exactly those sections once the report exceeds the cap.
	const output = truncateTextHead(
		extra?.error || getResultOutput(result) || result.stderr || "(no output)",
		doneCapForAgent(result.agent, isError),
	);
	const cost =
		typeof result.usage.cost === "number" ? result.usage.cost.toFixed(4) : String(result.usage.cost ?? 0);
	const title =
		result.title?.trim() || (result.task.split("\n")[0] ?? "").trim().slice(0, 80) || "(untitled)";
	const lines = [
		`[subagent-done] agentId=${result.agentId ?? "?"} name=${result.agent} ok=${ok} verified=${verified} cost=${cost} turns=${result.usage.turns ?? 0}`,
		`Title: ${title}`,
	];
	if (verified === "none") {
		if (!att && result.verifySkipped) {
			// Brief carried a verify command but it was not run (agent aborted).
			lines.push("Verification: skipped (agent aborted)");
		} else {
			lines.push("Verification: worker-claimed only (no verify in brief)");
		}
	} else if (att) {
		lines.push(formatVerifyLine(att));
		for (const tailLine of att.tail.split("\n").slice(-VERIFY_DONE_TAIL_LINES)) {
			lines.push(`  ${tailLine}`);
		}
	}
	lines.push(
		"Result:",
		output,
		`Full report: subagent_status({agentId:"${result.agentId ?? "?"}", full:true})`,
	);
	return lines.join("\n");
}

/** Per-step attested verify blocks for chain results: `Verify[i/n]: $ ... → exit N (attested)`. */
function formatChainVerifyPrefix(results: SingleResult[]): string {
	const lines: string[] = [];
	results.forEach((r, i) => {
		if (!r.verify) return;
		lines.push(`Verify[${i + 1}/${results.length}]: $ ${r.verify.command} → exit ${formatVerifyExit(r.verify)} (attested)`);
		for (const tailLine of r.verify.tail.split("\n").slice(-VERIFY_DONE_TAIL_LINES)) {
			lines.push(`  ${tailLine}`);
		}
	});
	if (lines.length === 0) return "";
	// Cap the aggregated prefix (REPORT_DONE_CAP): unbounded chain length × ~2000
	// chars/step must not blow up the tool result. Head-keep, earliest steps first.
	return `${truncateTextHead(lines.join("\n"), REPORT_DONE_CAP)}\n`;
}

function deliverSubagentDone(pi: ExtensionAPI, text: string): void {
	try {
		pi.sendUserMessage(text, { deliverAs: "followUp" });
	} catch {
		try {
			pi.sendUserMessage(text);
		} catch (err) {
			console.error("[pipiui-subagent] failed to deliver [subagent-done]:", err);
		}
	}
}

function notifySubagentDone(
	pi: ExtensionAPI,
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): void {
	// Finalize job BEFORE deliver: status must work even if sendUserMessage fails.
	ensureJobTerminalFromResult(result, extra);
	deliverSubagentDone(pi, formatSubagentDoneMessage(result, extra));
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

function truncateParallelOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	options?: RunSingleAgentOptions,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);
	const pipiuiAgentId = options?.agentId ?? generatePipiuiAgentId();
	const isBackground = options?.background === true;

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		const fail: SingleResult = {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			stopReason: "error",
			errorMessage: `Unknown agent: "${agentName}"`,
		};
		jobFinalize(pipiuiAgentId, {
			name: agentName,
			task,
			state: "failed",
			resultText: fail.stderr,
		});
		return fail;
	}

	const runtimePolicy = runtimeRolePolicyForAgent(agentName);
	const placement = resolveSubagentWorktree({
		agentId: pipiuiAgentId,
		defaultCwd,
		explicitCwd: cwd, // only when caller passed cwd; undefined → auto worktree
		policy: runtimePolicy,
	});
	const spawnCwd = placement.cwd;

	const resolvedModel = resolveAgentModel(agentName, agent.model, options?.sessionModel);
	const resolvedThinking = resolveAgentThinking(agentName);
	const mainModelForChild = inheritMainModel(options?.sessionModel);

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	// 嵌套委派也加载补丁版 subagent（主会话通过 PIPIUI_SUBAGENT_EXT 传入目录）
	if (PIPIUI_SUBAGENT_EXT) args.push("-e", PIPIUI_SUBAGENT_EXT);
	// A new explicit thinking override wins over Pi's older `model:thinking` shorthand.
	// Strip only a recognized shorthand suffix, preserving other colon-containing model ids.
	if (resolvedModel) args.push("--model", resolvedThinking ? stripModelThinkingSuffix(resolvedModel) : resolvedModel);
	if (resolvedThinking) args.push("--thinking", resolvedThinking);
	const disabledTools = loadDisabledTools();
	if (agent.tools && agent.tools.length > 0) {
		const allowed = agent.tools.filter(
			(t) =>
				!disabledTools.has(t) &&
				(runtimePolicy.allowRecursiveDelegation || t !== "subagent"),
		);
		if (allowed.length > 0) args.push("--tools", allowed.join(","));
		else args.push("--no-tools");
	} else if (disabledTools.size > 0 || !runtimePolicy.allowRecursiveDelegation) {
		const excluded = new Set(disabledTools);
		if (!runtimePolicy.allowRecursiveDelegation) excluded.add("subagent");
		args.push("--exclude-tools", [...excluded].sort().join(","));
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		title: options?.title,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model: resolvedModel,
		step,
		agentId: pipiuiAgentId,
	};

	let pipiuiLastUpdate = 0;
	let pipiuiActivity = "";
	pipiuiReport({
		kind: "start",
		agentId: pipiuiAgentId,
		parentId: PIPIUI_PARENT,
		toolCallId: pipiuiCurrentToolCall,
		name: agentName,
		task,
		depth: PIPIUI_DEPTH + 1,
		model: resolvedModel ?? null,
		...(options?.title ? { title: options.title } : {}),
		...(isBackground ? { background: true } : {}),
		...(placement.worktreePath ? { worktreePath: placement.worktreePath } : {}),
		...(placement.worktreeBranch ? { worktreeBranch: placement.worktreeBranch } : {}),
		...(placement.worktreeError ? { worktreeError: placement.worktreeError } : {}),
	});
	jobUpsertRunning(pipiuiAgentId, agentName, task, options?.title);
	// 后台 job：注册外部可触达的 AbortController（subagent_abort / action=abort 入口），
	// 同一句柄也是 stall watchdog 的活动时间戳载体。前台 job 不注册（父 abort 已可杀）。
	let backgroundAbort: AbortController | undefined;
	if (isBackground) {
		backgroundAbort = new AbortController();
		runningAgents.set(pipiuiAgentId, {
			controller: backgroundAbort,
			name: agentName,
			task,
			title: options?.title,
			lastActivityAt: Date.now(),
			stallNotified: false,
		});
	}
	const pipiuiUpdate = (force = false) => {
		const now = Date.now();
		if (!force && now - pipiuiLastUpdate < 500) return;
		pipiuiLastUpdate = now;
		pipiuiReport({
			kind: "update",
			agentId: pipiuiAgentId,
			output: (getFinalOutput(currentResult.messages) || "").slice(-4000),
			activity: pipiuiActivity,
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
		});
		jobPatchRunning(pipiuiAgentId, {
			activity: pipiuiActivity,
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
		});
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: spawnCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				detached: false,
				// 把 agent 树身份传给子进程：子进程再派 subagent 时 parentId/depth 自动正确
				// PIPIUI_SUBAGENT_EXT / BRIDGE / SESSION 经 process.env 继承，嵌套 -e 与上报保持一致
				env: {
					...process.env,
					PIPIUI_AGENT_ID: pipiuiAgentId,
					PIPIUI_AGENT_DEPTH: String(PIPIUI_DEPTH + 1),
					PIPIUI_AGENT_ROLE: runtimePolicy.role,
					...(mainModelForChild ? { PIPIUI_MAIN_MODEL: mainModelForChild } : {}),
					...(runtimePolicy.worktree === "main-session"
						? { PIPIUI_WORKTREE: "0", PIPIUI_AGENT_NO_DELEGATION: "1" }
						: {}),
					...(placement.worktreePath ? { PIPIUI_WORKTREE_PATH: placement.worktreePath } : {}),
					...(placement.worktreeBranch ? { PIPIUI_WORKTREE_BRANCH: placement.worktreeBranch } : {}),
				},
			});
			pipiuiTrackChild(proc);
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

						if (msg.role === "assistant") {
							currentResult.usage.turns++;
							const usage = msg.usage;
							if (usage) {
								currentResult.usage.input += usage.input || 0;
								currentResult.usage.output += usage.output || 0;
								currentResult.usage.cacheRead += usage.cacheRead || 0;
								currentResult.usage.cacheWrite += usage.cacheWrite || 0;
								currentResult.usage.cost += usage.cost?.total || 0;
								currentResult.usage.contextTokens = usage.totalTokens || 0;
								// Per-turn usage → PipiUI token ledger. Independent of the
								// cost/turns aggregates above; gives per-turn input/output/cache
								// breakdown that "end" doesn't carry. Safe to no-op if bridge unset.
								const toolSet = new Set<string>();
								for (const part of (msg as any).content ?? []) {
									if (part?.type === "toolCall" && typeof part.name === "string" && part.name) {
										toolSet.add(part.name);
									}
								}
								const tools = [...toolSet].sort();
								pipiuiReport({
									kind: "usage",
									agentId: pipiuiAgentId,
									turn: currentResult.usage.turns,
									model: msg.model || currentResult.model || null,
									tools,
									usage: {
										input: usage.input || 0,
										output: usage.output || 0,
										cacheRead: usage.cacheRead || 0,
										cacheWrite: usage.cacheWrite || 0,
										cost: usage.cost?.total || 0,
										contextTokens: usage.totalTokens || 0,
									},
								});
							}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
						// 完整工作流水上报：每轮的思考/文本/工具调用都进 UI 日志
						const pipiuiItems: Record<string, unknown>[] = [];
						for (const part of (msg as any).content ?? []) {
							if (part?.type === "toolCall") {
								const args = (part.arguments ?? {}) as Record<string, unknown>;
								const summary = summarizeToolArgsForUI(String(part.name ?? ""), args);
								pipiuiActivity = `${part.name} ${summary}`;
								// Send human summary (path/command), not truncated JSON — matches main agent.
								pipiuiItems.push({ itemType: "tool", name: part.name, text: summary });
							} else if (part?.type === "text" && String(part.text ?? "").trim()) {
								pipiuiItems.push({ itemType: "text", text: String(part.text).slice(0, 4000) });
							} else if (part?.type === "thinking" && String(part.thinking ?? "").trim()) {
								pipiuiItems.push({ itemType: "thinking", text: String(part.thinking).slice(0, 600) });
							}
						}
						if (pipiuiItems.length > 0) {
							pipiuiReport({ kind: "log", agentId: pipiuiAgentId, items: pipiuiItems });
						}
					}
					emitUpdate();
					pipiuiUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					const resultMsg: any = event.message;
					const resultText = (
						Array.isArray(resultMsg.content)
							? resultMsg.content
									.filter((c: any) => c?.type === "text")
									.map((c: any) => c.text)
									.join("\n")
							: ""
					).slice(-1500);
					pipiuiReport({
						kind: "log",
						agentId: pipiuiAgentId,
						items: [
							{
								itemType: "toolResult",
								name: resultMsg.toolName ?? "",
								isError: !!resultMsg.isError,
								text: resultText,
							},
						],
					});
					emitUpdate();
					pipiuiUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				if (isBackground) noteAgentActivity(pipiuiAgentId);
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				if (isBackground) noteAgentActivity(pipiuiAgentId);
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			// 后台 job 用外部可触达的 backgroundAbort（subagent_abort）；前台沿用工具调用 signal。
			const effectiveSignal = signal ?? backgroundAbort?.signal;
			if (effectiveSignal) {
				let procExited = false;
				proc.on("close", () => {
					procExited = true;
				});
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					const forceKill = setTimeout(() => {
						if (!procExited) proc.kill("SIGKILL");
					}, 5000);
					forceKill.unref?.();
				};
				if (effectiveSignal.aborted) killProc();
				else effectiveSignal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		// Attested verify: runs AFTER the agent process exits and BEFORE the "end" report,
		// because Swift auto-merges and removes the worktree on "end". Skipped on abort
		// (user interrupted; don't block up to VERIFY_TIMEOUT_MS on a dead task).
		if (options?.verify && options.verify.trim() && !wasAborted) {
			currentResult.verify = await runVerifyCommand(options.verify.trim(), spawnCwd);
		} else if (options?.verify && options.verify.trim()) {
			// Aborted: verify was in the brief but intentionally not run — record that
			// so the done message can say "skipped" instead of "no verify in brief".
			currentResult.verifySkipped = true;
		}
		const endOk = exitCode === 0 && !currentResult.errorMessage && !wasAborted;
		if (wasAborted) currentResult.stopReason = currentResult.stopReason ?? "aborted";
		pipiuiReport({
			kind: "end",
			agentId: pipiuiAgentId,
			ok: endOk,
			aborted: wasAborted,
			output: (getFinalOutput(currentResult.messages) || currentResult.stderr || "").slice(-8000),
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
			contextTokens: currentResult.usage.contextTokens,
			stopReason: currentResult.stopReason ?? null,
			...(placement.worktreePath ? { worktreePath: placement.worktreePath } : {}),
			...(placement.worktreeBranch ? { worktreeBranch: placement.worktreeBranch } : {}),
			...(placement.worktreeError ? { worktreeError: placement.worktreeError } : {}),
			...(currentResult.verify
				? {
						verifyCommand: currentResult.verify.command,
						verifyExit: currentResult.verify.timedOut ? -1 : (currentResult.verify.exitCode ?? -1),
					}
				: {}),
		});
		// Terminal job state before notify/return so status works even if follow-up delivery fails.
		const endState: JobState = wasAborted ? "aborted" : endOk ? "ok" : "failed";
		const endResultText =
			getResultOutput(currentResult) || currentResult.stderr || getFinalOutput(currentResult.messages) || "(no output)";
		jobFinalize(pipiuiAgentId, {
			name: agentName,
			task,
			state: endState,
			resultText: endResultText,
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
			activity: pipiuiActivity,
			verify: currentResult.verify,
		});
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		if (isBackground) runningAgents.delete(pipiuiAgentId);
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

const VERIFY_PARAM_DESCRIPTION =
	"Shell command run by the runtime in the agent's cwd after the agent process ends, before worktree merge/removal; exit code and tail output are attested into the done message. Boss must fill this for implementation tasks.";

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	title: Type.Optional(
		Type.String({
			description:
				"Short one-line title shown in the Subagents panel list instead of the full task; omit to fall back to task text",
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	title: Type.Optional(
		Type.String({
			description:
				"Short one-line title shown in the Subagents panel list instead of the full task; omit to fall back to task text",
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	action: Type.Optional(
		StringEnum(["abort"] as const, {
			description:
				'Optional action instead of dispatching. "abort": terminate a running background job (requires agentId); the job still reports [subagent-done] with aborted status.',
		}),
	),
	agentId: Type.Optional(
		Type.String({ description: 'Target background job id for action="abort".' }),
	),
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	title: Type.Optional(
		Type.String({
			description:
				"Short one-line title shown in the Subagents panel list instead of the full task (single mode); omit to fall back to task text",
		}),
	),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task, title?, cwd?, verify?} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task, title?, cwd?, verify?} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
	background: Type.Optional(
		Type.Boolean({
			description:
				"If true, return immediately after starting agents; completion is delivered later as a follow-up message. Default: true at boss depth (0), false for nested agents or chain mode.",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	// Prompt text is not a security boundary. The runtime-owned closeout secretary
	// may write only its state records and may not perform destructive cleanup.
	pi.on("tool_call", (event) => {
		return secretaryToolCallBlock(
			PIPIUI_AGENT_ROLE,
			{ toolName: event.toolName, input: event.input },
			PIPIUI_MAIN_CWD,
		);
	});

	// ---- Stall watchdog：后台 job 超过 120s 无任何流式事件/输出 → 向 boss 会话推一条 ----
	// [subagent-stalled] agentId=<id> title=<title> idle=<秒>s last=<最后一行动作摘要>
	// 每个卡死片段只推一次（有新活动后重新武装）；复用 [subagent-done] 的 followUp 通道。
	// 30s interval 扫描；无 PIPIUI_* 环境变量时桥接上报自动静默（pipiuiReport no-op）。
	const STALL_WATCHDOG_KEY = "__pipiuiSubagentStallWatchdog";
	const g = globalThis as Record<string, unknown>;
	const prevWatchdog = g[STALL_WATCHDOG_KEY] as ReturnType<typeof setInterval> | undefined;
	if (prevWatchdog) clearInterval(prevWatchdog); // 防扩展 reload 后旧定时器泄漏
	const stallWatchdog = setInterval(() => {
		const now = Date.now();
		for (const [agentId, handle] of runningAgents) {
			if (handle.stallNotified) continue;
			const idleMs = now - handle.lastActivityAt;
			if (idleMs < STALL_THRESHOLD_MS) continue;
			handle.stallNotified = true;
			const idleSec = Math.floor(idleMs / 1000);
			const job = jobRegistry.get(agentId);
			const title =
				handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 80) || "(untitled)";
			const activityRaw = job?.activity?.trim() || "";
			const lastLine = (activityRaw.split("\n").pop() ?? "").trim().slice(0, 120) || "(no activity)";
			deliverSubagentDone(
				pi,
				`[subagent-stalled] agentId=${agentId} title=${title} idle=${idleSec}s last=${lastLine}`,
			);
			pipiuiReport({
				kind: "stalled",
				agentId,
				stalled: true,
				idle: idleSec,
				activity: lastLine,
			});
		}
	}, STALL_WATCHDOG_INTERVAL_MS);
	stallWatchdog.unref?.();
	g[STALL_WATCHDOG_KEY] = stallWatchdog;
	// 进程退出时清理定时器（unref 已保证不拖住退出；这里是显式清理）。
	process.on("exit", () => {
		clearInterval(stallWatchdog);
		if (g[STALL_WATCHDOG_KEY] === stallWatchdog) delete g[STALL_WATCHDOG_KEY];
	});

	// ---- RPC 命令：GUI 经 {"type":"prompt","message":"/subagent_abort <agentId>"} 调用 ----
	pi.registerCommand("subagent_abort", {
		description: "Abort a running background subagent: /subagent_abort <agentId> (PipiUI)",
		handler: async (args, ctx) => {
			const agentId = (args ?? "").trim();
			if (!agentId) {
				ctx.ui.notify("Usage: /subagent_abort <agentId>", "error");
				return;
			}
			const result = abortRunningAgent(agentId);
			ctx.ui.notify(result.message, result.ok ? "info" : "error");
		},
	});

	pi.registerTool({
		name: "subagent_status",
		label: "Subagent Status",
		description: [
			"Query subagent job status in this session process (running / ok / failed / aborted).",
			"Use when deciding next action, when the user asks for progress, or before re-dispatching.",
			"Prefer reading finished results via this tool or [subagent-done] over spawning a new agent for the same work.",
			"Do not busy-loop poll; one check per decision is correct.",
		].join(" "),
		parameters: Type.Object({
			agentId: Type.Optional(Type.String({ description: "If set, return this job only with fuller Result text." })),
			onlyRunning: Type.Optional(Type.Boolean({ description: "If true, only running jobs. Default false." })),
			full: Type.Optional(
				Type.Boolean({
					description:
						"If true (with agentId), return the job's full stored result text without display truncation. Default false.",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const text = formatJobsStatus({
				agentId: params.agentId,
				onlyRunning: params.onlyRunning === true,
				full: params.full === true,
			});
			return { content: [{ type: "text", text }], details: null };
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			"At boss depth 0, single/parallel default to background=true: tool returns immediately with agentIds; each agent completion arrives later as a user message prefixed [subagent-done].",
			"By default each worker writes in an isolated git worktree under .pi/worktrees/ on a pipiui/agent-* branch; pass explicit cwd or set PIPIUI_WORKTREE=0 to disable. The runtime-owned secretary role is the exception: it always runs in PIPIUI_MAIN_CWD with recursive delegation disabled and never creates a worktree. On successful worker end the app auto-merges into the main project, removes the worktree, and safely deletes only a merged internal branch with git branch -d. If merge or cleanup fails, the main session retains actionable state; failed/aborted keeps worktree for resume (GUI merge/discard fallback).",
			"Track jobs with subagent_status(agentId?). Never re-spawn a finished task without reading its result via [subagent-done] or subagent_status.",
			'Abort a running background job with action:"abort" + agentId (equivalent to /subagent_abort); it ends as aborted and still reports [subagent-done].',
			"Background jobs with no output for 120s are pushed as [subagent-stalled] and marked stalled (with idle seconds) in subagent_status.",
			"Do not busy-loop poll; one status check per decision is correct.",
			"chain and nested (depth>0) are always synchronous. Set background:false to await a single/parallel result.",
			`Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
			`To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			pipiuiCurrentToolCall = _toolCallId;
			const sessionModel = formatCtxModel(
				(ctx as { model?: { provider?: string; id?: string } } | undefined)?.model,
			);
			// 多层深度护栏：达到上限的进程不允许继续派 subagent
			if (PIPIUI_DEPTH >= PIPIUI_MAX_DEPTH) {
				return {
					content: [
						{
							type: "text",
							text: `Subagent depth limit reached (depth ${PIPIUI_DEPTH}, max ${PIPIUI_MAX_DEPTH}). Do the work yourself with your available tools instead of delegating.`,
						},
					],
					details: { mode: "single", agentScope: params.agentScope ?? "user", projectAgentsDir: null, results: [] },
				};
			}
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
			const isChain = hasChain;
			// Default background at boss depth for single/parallel; chain and nested always sync.
			const wantBg = params.background ?? (PIPIUI_DEPTH === 0 && !isChain);
			const useBackground = Boolean(wantBg && !isChain && PIPIUI_DEPTH === 0);
			const bgIgnoredWarning =
				params.background === true && (PIPIUI_DEPTH > 0 || isChain)
					? "Warning: background:true ignored (nested depth>0 or chain mode always runs synchronously).\n\n"
					: "";

			const makeDetails =
				(mode: "single" | "parallel" | "chain", extra?: { background?: boolean; agentIds?: string[] }) =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
					...(extra?.background ? { background: true } : {}),
					...(extra?.agentIds ? { agentIds: extra.agentIds } : {}),
				});

			// action=abort：中止运行中的后台 job（不占 single/parallel/chain 的 mode 名额）
			if (params.action === "abort") {
				const target = params.agentId?.trim();
				if (!target) {
					return {
						content: [
							{ type: "text", text: 'action="abort" requires agentId of a running background job.' },
						],
						details: makeDetails("single")([]),
						isError: true,
					};
				}
				const abortResult = abortRunningAgent(target);
				return {
					content: [{ type: "text", text: abortResult.message }],
					details: makeDetails("single")([]),
					isError: !abortResult.ok,
				};
			}

			const startBackgroundAgent = (
				agentName: string,
				task: string,
				cwd: string | undefined,
				agentId: string,
				mode: "single" | "parallel",
				title: string | undefined,
				verify: string | undefined,
			): void => {
				void runSingleAgent(
					ctx.cwd,
					agents,
					agentName,
					task,
					cwd,
					undefined,
					undefined, // do not bind parent abort — turn abort must not kill background workers
					undefined,
					makeDetails(mode, { background: true, agentIds: [agentId] }),
					{ background: true, agentId, title, sessionModel, verify },
				)
					.then((result) => {
						notifySubagentDone(pi, result);
					})
					.catch((err) => {
						const msg = err instanceof Error ? err.message : String(err);
						console.error("[pipiui-subagent] background agent error:", agentId, msg);
						const aborted = /abort/i.test(msg);
						notifySubagentDone(
							pi,
							{
								agent: agentName,
								agentId,
								agentSource: agents.find((a) => a.name === agentName)?.source ?? "unknown",
								task,
								exitCode: 1,
								messages: [],
								stderr: msg,
								errorMessage: msg,
								usage: emptyUsage(),
								stopReason: aborted ? "aborted" : "error",
							},
							{ aborted, error: msg },
						);
					});
			};

			const formatStartedMessage = (
				items: { agentId: string; name: string; task: string; title?: string }[],
			): string => {
				const lines = items.map(
					(it) =>
						`- agentId=${it.agentId} name=${it.name}${it.title ? ` title=${it.title}` : ""} task=${it.task.length > 120 ? `${it.task.slice(0, 120)}...` : it.task}`,
				);
				return (
					`${bgIgnoredWarning}Started background agent(s) (${items.length}). ` +
					"You will receive a completion signal per agent when each finishes. " +
					"Do not busy-loop poll; use subagent_status before re-dispatch. " +
					"Continue other work or dispatch more independent agents.\n\n" +
					lines.join("\n")
				);
			};

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),

						{ title: step.title, sessionModel, verify: step.verify },
					);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg = getResultOutput(result);
						return {
							content: [
								{
									type: "text",
									text: `${bgIgnoredWarning}${formatChainVerifyPrefix(results)}Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}`,
								},
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				const lastChainResult = results[results.length - 1];
				// Chain aggregated output = final step output; capped by that agent's done
				// cap, head-keep (templates put the key sections first).
				const chainOutput = truncateTextHead(
					getFinalOutput(lastChainResult.messages) || "(no output)",
					doneCapForAgent(lastChainResult.agent, false),
				);
				return {
					content: [
						{
							type: "text",
							text: bgIgnoredWarning + formatChainVerifyPrefix(results) + chainOutput,
						},
					],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				if (useBackground) {
					const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
					const unknown = params.tasks.filter((t) => !agents.some((a) => a.name === t.agent));
					if (unknown.length > 0) {
						const names = unknown.map((t) => `"${t.agent}"`).join(", ");
						return {
							content: [
								{
									type: "text",
									text: `Unknown agent(s): ${names}. Available agents: ${available}.`,
								},
							],
							details: makeDetails("parallel")([]),
							isError: true,
						};
					}

					const startedItems: { agentId: string; name: string; task: string; title?: string }[] = [];
					const placeholders: SingleResult[] = [];
					const agentIds: string[] = [];

					for (const t of params.tasks) {
						const agentCfg = agents.find((a) => a.name === t.agent)!;
						const agentId = generatePipiuiAgentId();
						agentIds.push(agentId);
						startedItems.push({ agentId, name: t.agent, task: t.task, title: t.title });
						placeholders.push({
							agent: t.agent,
							agentId,
							agentSource: agentCfg.source,
							task: t.task,
							title: t.title,
							exitCode: -1,
							messages: [],
							stderr: "",
							usage: emptyUsage(),
							model: resolveAgentModel(t.agent, agentCfg.model, sessionModel),
						});
					}

					// Fire-and-forget with the same concurrency cap; each task notifies on its own completion.
					void mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
						const agentId = agentIds[index];
						try {
							const result = await runSingleAgent(
								ctx.cwd,
								agents,
								t.agent,
								t.task,
								t.cwd,
								undefined,
								undefined, // no parent abort binding
								undefined,
								makeDetails("parallel", { background: true, agentIds }),
								{ background: true, agentId, title: t.title, sessionModel, verify: t.verify },
							);
							notifySubagentDone(pi, result);
							return result;
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.error("[pipiui-subagent] background parallel agent error:", agentId, msg);
							const aborted = /abort/i.test(msg);
							const failResult: SingleResult = {
								agent: t.agent,
								agentId,
								agentSource: agents.find((a) => a.name === t.agent)?.source ?? "unknown",
								task: t.task,
								title: t.title,
								exitCode: 1,
								messages: [],
								stderr: msg,
								errorMessage: msg,
								usage: emptyUsage(),
								stopReason: aborted ? "aborted" : "error",
							};
							notifySubagentDone(pi, failResult, { aborted, error: msg });
							return failResult;
						}
					}).catch((err) => {
						console.error("[pipiui-subagent] background parallel runner error:", err);
					});

					return {
						content: [{ type: "text", text: formatStartedMessage(startedItems) }],
						details: makeDetails("parallel", { background: true, agentIds })(placeholders),
					};
				}

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						title: params.tasks[i].title,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: emptyUsage(),
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),

						{ title: t.title, sessionModel, verify: t.verify },
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const failed = isFailedResult(r);
					const status = failed
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					// Same attestation surface as [subagent-done]: verified field + Verify line.
					const verified = verifiedStateFor(r, { error: failed });
					const verifyLine = r.verify && verified !== "none" ? `${formatVerifyLine(r.verify)}\n\n` : "";
					return `### [${r.agent}] ${status} · verified=${verified}\n\n${verifyLine}${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text:
								bgIgnoredWarning +
								`Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				if (useBackground) {
					const agentCfg = agents.find((a) => a.name === params.agent);
					if (!agentCfg) {
						const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
						return {
							content: [
								{
									type: "text",
									text: `Unknown agent: "${params.agent}". Available agents: ${available}.`,
								},
							],
							details: makeDetails("single")([]),
							isError: true,
						};
					}
					const agentId = generatePipiuiAgentId();
					startBackgroundAgent(params.agent, params.task, params.cwd, agentId, "single", params.title, params.verify);
					const placeholder: SingleResult = {
						agent: params.agent,
						agentId,
						agentSource: agentCfg.source,
						task: params.task,
						title: params.title,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: emptyUsage(),
						model: resolveAgentModel(params.agent, agentCfg.model, sessionModel),
					};
					return {
						content: [
							{
								type: "text",
								text: formatStartedMessage([
									{ agentId, name: params.agent, task: params.task, title: params.title },
								]),
							},
						],
						details: makeDetails("single", { background: true, agentIds: [agentId] })([
							placeholder,
						]),
					};
				}

				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),

					{ title: params.title, sessionModel, verify: params.verify },
				);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = getResultOutput(result);
					return {
						content: [
							{
								type: "text",
								text: `${bgIgnoredWarning}Agent ${result.stopReason || "failed"}: ${errorMsg}`,
							},
						],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text",
							text:
								bgIgnoredWarning +
								(getFinalOutput(result.messages) || "(no output)") +
								// Same attestation surface as [subagent-done]: verified field + Verify line.
								`\n\nverified=${verifiedStateFor(result)}` +
								(result.verify ? `\n${formatVerifyLine(result.verify)}` : ""),
						},
					],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			if (args.action === "abort") {
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("warning", "abort ") +
						theme.fg("accent", args.agentId || "?"),
					0,
					0,
				);
			}
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isRunning = r.exitCode === -1 || details.background === true;
				// Background tool result is an immediate "started" placeholder; prefer content text.
				if (isRunning && details.background) {
					const text = result.content[0];
					const body = text?.type === "text" ? text.text : "(background agent started)";
					const header =
						theme.fg("warning", "⏳") +
						" " +
						theme.fg("toolTitle", theme.bold(r.agent)) +
						theme.fg("muted", ` (${r.agentSource}) background`);
					return new Text(`${header}\n${theme.fg("dim", body)}`, 0, 0);
				}
				const isError = isFailedResult(r);
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
				const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: isFailedResult(r)
								? theme.fg("error", "✗")
								: theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}
