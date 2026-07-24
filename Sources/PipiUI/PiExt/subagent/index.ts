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

import { spawn } from "node:child_process";
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
}

const DONE_RESULT_CAP = 8000;
const JOB_RESULT_STORE_CAP = 12000;
const JOB_RESULT_DISPLAY_CAP = 8000;
const MAX_JOB_RECORDS = 40;

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
	state: JobState;
	startedAt: number;
	endedAt?: number;
	activity?: string;
	cost?: number;
	turns?: number;
	/** Full-ish result text for status-by-id (capped) */
	resultText?: string;
}

const jobRegistry = new Map<string, JobRecord>();

function truncateText(text: string, cap: number): string {
	if (text.length <= cap) return text;
	return text.slice(-cap);
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

function jobUpsertRunning(agentId: string, name: string, task: string): void {
	const existing = jobRegistry.get(agentId);
	if (existing && existing.state !== "running") return; // never reopen a terminal job
	jobRegistry.set(agentId, {
		agentId,
		name,
		task: taskSummary(task),
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
	},
): void {
	if (fields.state === "running") return;
	const existing = jobRegistry.get(agentId);
	const now = Date.now();
	if (existing && existing.state !== "running") {
		// Already terminal: fill missing result/metrics only (notify may race with runSingleAgent end)
		if (!existing.resultText && fields.resultText) existing.resultText = truncateText(fields.resultText, JOB_RESULT_STORE_CAP);
		if (existing.cost === undefined && fields.cost !== undefined) existing.cost = fields.cost;
		if (existing.turns === undefined && fields.turns !== undefined) existing.turns = fields.turns;
		if (!existing.activity && fields.activity) existing.activity = fields.activity;
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
				? truncateText(fields.resultText, JOB_RESULT_STORE_CAP)
				: existing?.resultText,
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

function formatJobsStatus(opts: { agentId?: string; onlyRunning?: boolean }): string {
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
			`state: ${job.state}`,
			`turns: ${turns}`,
			`cost: ${cost}`,
			`elapsed: ${elapsed}`,
			`Task: ${job.task || "(none)"}`,
		];
		if (job.state === "running") {
			lines.push(`activity: ${job.activity || "(starting/idle)"}`);
		} else {
			const result = truncateText(job.resultText || "(no result stored)", JOB_RESULT_DISPLAY_CAP);
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
		return `| ${j.agentId} | ${j.name} | ${j.state} | ${turns} | ${cost} | ${elapsed} | ${preview || "-"} |`;
	});
	return [header, sep, ...rows].join("\n");
}

function generatePipiuiAgentId(): string {
	return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateDoneOutput(output: string, cap = DONE_RESULT_CAP): string {
	return truncateText(output, cap);
}

function formatSubagentDoneMessage(
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): string {
	const aborted = extra?.aborted ?? result.stopReason === "aborted";
	const ok = !isFailedResult(result) && !aborted && !extra?.error;
	const output = truncateDoneOutput(
		extra?.error || getResultOutput(result) || result.stderr || "(no output)",
	);
	const cost =
		typeof result.usage.cost === "number" ? result.usage.cost.toFixed(4) : String(result.usage.cost ?? 0);
	return [
		`[subagent-done] agentId=${result.agentId ?? "?"} name=${result.agent} ok=${ok} aborted=${aborted} cost=${cost} turns=${result.usage.turns ?? 0}`,
		"",
		`Task: ${result.task}`,
		"Result:",
		output,
	].join("\n");
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

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	// 嵌套委派也加载补丁版 subagent（主会话通过 PIPIUI_SUBAGENT_EXT 传入目录）
	if (PIPIUI_SUBAGENT_EXT) args.push("-e", PIPIUI_SUBAGENT_EXT);
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model: agent.model,
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
		model: agent.model ?? null,
		...(isBackground ? { background: true } : {}),
	});
	jobUpsertRunning(pipiuiAgentId, agentName, task);
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
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				detached: false,
				// 把 agent 树身份传给子进程：子进程再派 subagent 时 parentId/depth 自动正确
				// PIPIUI_SUBAGENT_EXT / BRIDGE / SESSION 经 process.env 继承，嵌套 -e 与上报保持一致
				env: {
					...process.env,
					PIPIUI_AGENT_ID: pipiuiAgentId,
					PIPIUI_AGENT_DEPTH: String(PIPIUI_DEPTH + 1),
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
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
						// 完整工作流水上报：每轮的思考/文本/工具调用都进 UI 日志
						const pipiuiItems: Record<string, unknown>[] = [];
						for (const part of (msg as any).content ?? []) {
							if (part?.type === "toolCall") {
								const argsText = JSON.stringify(part.arguments ?? {});
								pipiuiActivity = `${part.name} ${argsText.slice(0, 120)}`;
								pipiuiItems.push({ itemType: "tool", name: part.name, text: argsText.slice(0, 400) });
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
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
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
		});
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
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

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	background: Type.Optional(
		Type.Boolean({
			description:
				"If true, return immediately after starting agents; completion is delivered later as a follow-up message. Default: true at boss depth (0), false for nested agents or chain mode.",
		}),
	),
});

export default function (pi: ExtensionAPI) {
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
		}),
		async execute(_toolCallId, params) {
			const text = formatJobsStatus({
				agentId: params.agentId,
				onlyRunning: params.onlyRunning === true,
			});
			return { content: [{ type: "text", text }] };
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			"At boss depth 0, single/parallel default to background=true: tool returns immediately with agentIds; each agent completion arrives later as a user message prefixed [subagent-done].",
			"Track jobs with subagent_status(agentId?). Never re-spawn a finished task without reading its result via [subagent-done] or subagent_status.",
			"Do not busy-loop poll; one status check per decision is correct.",
			"chain and nested (depth>0) are always synchronous. Set background:false to await a single/parallel result.",
			`Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
			`To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			pipiuiCurrentToolCall = _toolCallId;
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

			const startBackgroundAgent = (
				agentName: string,
				task: string,
				cwd: string | undefined,
				agentId: string,
				mode: "single" | "parallel",
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
					{ background: true, agentId },
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
				items: { agentId: string; name: string; task: string }[],
			): string => {
				const lines = items.map(
					(it) =>
						`- agentId=${it.agentId} name=${it.name} task=${it.task.length > 120 ? `${it.task.slice(0, 120)}...` : it.task}`,
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
					);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						const errorMsg = getResultOutput(result);
						return {
							content: [
								{
									type: "text",
									text: `${bgIgnoredWarning}Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}`,
								},
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [
						{
							type: "text",
							text:
								bgIgnoredWarning +
								(getFinalOutput(results[results.length - 1].messages) || "(no output)"),
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

					const startedItems: { agentId: string; name: string; task: string }[] = [];
					const placeholders: SingleResult[] = [];
					const agentIds: string[] = [];

					for (const t of params.tasks) {
						const agentCfg = agents.find((a) => a.name === t.agent)!;
						const agentId = generatePipiuiAgentId();
						agentIds.push(agentId);
						startedItems.push({ agentId, name: t.agent, task: t.task });
						placeholders.push({
							agent: t.agent,
							agentId,
							agentSource: agentCfg.source,
							task: t.task,
							exitCode: -1,
							messages: [],
							stderr: "",
							usage: emptyUsage(),
							model: agentCfg.model,
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
								{ background: true, agentId },
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
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateParallelOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					return `### [${r.agent}] ${status}\n\n${output}`;
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
					startBackgroundAgent(params.agent, params.task, params.cwd, agentId, "single");
					const placeholder: SingleResult = {
						agent: params.agent,
						agentId,
						agentSource: agentCfg.source,
						task: params.task,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: emptyUsage(),
						model: agentCfg.model,
					};
					return {
						content: [
							{
								type: "text",
								text: formatStartedMessage([
									{ agentId, name: params.agent, task: params.task },
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
							text: bgIgnoredWarning + (getFinalOutput(result.messages) || "(no output)"),
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
