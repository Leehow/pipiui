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

import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
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
import {
	type AgentConfig,
	type AgentScope,
	discoverAgents,
	formatAgentDiagnostics,
} from "./agents.ts";
import { registerMainSessionCompactionHook } from "./main-compaction.ts";
import { registerSessionRecallTool } from "./session-recall.ts";
import { registerQoderContextWindowCompat } from "./qoder-context-window.ts";
import {
	resolveSubagentToolSelection,
	resolvePipiUIExtensionRouting,
	selectPipiUIExtensionRoutes,
	resolveDesktopGrant,
	DESKTOP_GRANT_CHILD_POLICY,
	sanitizeDisabledToolNames,
} from "./desktop-tool-policy.mjs";
import {
	DeliveryObligationStore,
	type DeliveryObligation,
} from "./delivery-obligation.ts";
import {
	formatSecretaryCommitResult,
	runSecretaryCommit,
} from "./secretary-commit.ts";
import { secretaryToolCallBlock } from "./secretary-policy.ts";
import {
	type VerifyAttestation,
	truncateTextHead,
	formatVerifyExit,
	formatVerifyLine,
	verifiedStateFor,
	doneCapForResult,
	formatSubagentDoneMessage,
	formatChainVerifyPrefix,
	getFinalOutput,
	isFailedResult,
	getResultOutput,
} from "./done-message.ts";
import { seedBossLedger } from "./boss-ledger.ts";
import {
	acquireAgentLease,
	releaseAgentLease,
} from "./agent-lease.ts";
import { resolveSubagentWorktree } from "./worktree.ts";
import { runtimeRolePolicyForAgent } from "./runtime-policy.ts";
import { registerSubagentManagementTool } from "./agent-management.ts";
import {
	encodeAgentEventBridgeRequestV1,
	type AgentBridgeEventPayloadV1,
} from "./host-bridge.ts";

const MAX_PARALLEL_TASKS = 1000;
const MAX_CONCURRENCY = 1000;
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

type DispatchStatsMode = "single" | "tasks" | "chain";

type DispatchStatsTask = {
	agent: string;
	task: string;
	title?: string;
};

type DispatchValidatorAction = "nudge" | "enforce";

type DispatchValidatorFinding = {
	/** tasks[] index, or 0 for single-mode brief. */
	taskIndex: number;
	briefItems: number;
	/** Short human-readable split hint (list item previews). */
	splitHint: string;
};

type DispatchValidatorStats = {
	triggered: true;
	action: DispatchValidatorAction;
	findings: Array<{ task_index: number; brief_items: number }>;
};

/** Heuristic only: count brief lines that look like list items. */
function estimateBriefItems(brief: string): number {
	return brief.split(/\r?\n/).filter((line) => /^\s*([-*•]|\d+[.)])\s/.test(line)).length;
}

/** List-item line body capture (same bullet/number forms as estimateBriefItems). */
const DISPATCH_LIST_ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

/**
 * Heuristic serial-dependency cues. When these dominate the brief, a long list is
 * more likely one ordered workflow than independent parallel goals — do not flag.
 */
const DISPATCH_SERIAL_SIGNAL_RE =
	/先|然后|接着|其次|之后|基于|再|随后|最后|\bfirst\b|\bfinally\b|\bbefore\b|\bafter\b|\bthen\b|\bnext\b|\bonce\b|\bbased\s+on\b|\bdepending\s+on\b|\bfollowed\s+by\b|\bstep\s*\d/gi;

/**
 * Heuristic independent-goal cues inside list lines / free text:
 * action-ish openers and multi-goal conjunctions (和/以及/并且/+ /and /also).
 * Not a parser — false positives/negatives are expected; default behavior is nudge-only.
 */
const DISPATCH_ACTIONISH_RE =
	/^(实现|添加|增加|修复|检查|验证|更新|删除|创建|修改|重构|测试|调研|调查|审查|write|add|fix|check|verify|update|delete|create|implement|test|review|investigate|build|run|refactor|ensure|confirm)\b/i;
const DISPATCH_INDEPENDENT_CONJ_RE = /以及|并且|\+|\band\b|\balso\b|和/g;

function countRegExpMatches(text: string, re: RegExp): number {
	const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
	const global = new RegExp(re.source, flags);
	return [...text.matchAll(global)].length;
}

function listItemBodies(brief: string): string[] {
	const bodies: string[] = [];
	for (const line of brief.split(/\r?\n/)) {
		const m = DISPATCH_LIST_ITEM_RE.exec(line);
		if (m?.[1]?.trim()) bodies.push(m[1].trim());
	}
	return bodies;
}

/**
 * Heuristic: does this brief pack multiple independent goals into one worker?
 * All of the following must hold:
 *   1. brief_items >= 6 (same list-line heuristic as telemetry)
 *   2. independent enumeration signals (standalone-ish list rows and/or multi-goal conjunctions)
 *   3. serial dependency words do NOT dominate those independent signals
 */
function looksLikeMergedIndependentGoals(brief: string): {
	merged: boolean;
	briefItems: number;
	splitHint: string;
} {
	const briefItems = estimateBriefItems(brief);
	if (briefItems < 6) {
		return { merged: false, briefItems, splitHint: "" };
	}

	const bodies = listItemBodies(brief);
	let independentItems = 0;
	let serialOnItems = 0;
	for (const body of bodies) {
		const serialOnLine = countRegExpMatches(body, DISPATCH_SERIAL_SIGNAL_RE);
		if (serialOnLine > 0) {
			serialOnItems += 1;
			continue;
		}
		// Standalone-ish row: action opener, sentence punctuation, or a substantial clause.
		const standalone =
			DISPATCH_ACTIONISH_RE.test(body) ||
			/[.!?。！？;；]$/.test(body) ||
			body.length >= 10;
		if (standalone) independentItems += 1;
	}

	const serialHits =
		countRegExpMatches(brief, DISPATCH_SERIAL_SIGNAL_RE) + serialOnItems;
	const conjHits = countRegExpMatches(brief, DISPATCH_INDEPENDENT_CONJ_RE);
	// Independent score: standalone list rows plus capped conjunction evidence.
	const independentScore = independentItems + Math.min(conjHits, 3);

	// Serial dominates → ordered workflow, not a merge anti-pattern.
	if (serialHits > 0 && serialHits >= Math.max(independentItems, 1) && serialHits >= independentScore / 2) {
		return { merged: false, briefItems, splitHint: "" };
	}

	const hasIndependentSignal = independentItems >= 4 || (independentItems >= 3 && conjHits >= 1);
	if (!hasIndependentSignal && independentItems < 6) {
		return { merged: false, briefItems, splitHint: "" };
	}

	// Prefer flagging when most of the 6+ items look independently actionable.
	if (independentItems < 4 && briefItems >= 6 && independentScore < 4) {
		return { merged: false, briefItems, splitHint: "" };
	}

	const preview = bodies
		.slice(0, 8)
		.map((b, i) => `${i + 1}) ${b.length > 60 ? `${b.slice(0, 60)}…` : b}`)
		.join("; ");
	return {
		merged: true,
		briefItems,
		splitHint: preview || `${briefItems} list items`,
	};
}

type DispatchShapeAssessment = {
	findings: DispatchValidatorFinding[];
	/** Prepended to successful tool results when nudge is active. */
	nudgeText: string;
	/** Full tool-result error body when enforce blocks the dispatch. */
	enforceError: string;
	stats: DispatchValidatorStats | null;
};

function dispatchValidatorMode(): "off" | "nudge" | "enforce" {
	if (process.env.PIPI_SUBAGENT_DISPATCH_ENFORCE === "1") return "enforce";
	if (process.env.PIPI_SUBAGENT_DISPATCH_NUDGE === "0") return "off";
	return "nudge";
}

/**
 * Pre-flight shape check for single / tasks[] dispatches.
 * - chain mode: never runs (caller skips)
 * - same-agentId resume (agentId set, fresh !== true): skipped per task / single
 * - default nudge: non-blocking reminder
 * - PIPI_SUBAGENT_DISPATCH_ENFORCE=1: block and ask for tasks[] / multiple dispatches
 * - PIPI_SUBAGENT_DISPATCH_NUDGE=0: disable even the reminder (unless enforce)
 */
function assessDispatchShape(input: {
	mode: "single" | "tasks";
	tasks: readonly { task: string; agentId?: string; fresh?: boolean; title?: string }[];
}): DispatchShapeAssessment {
	const empty: DispatchShapeAssessment = {
		findings: [],
		nudgeText: "",
		enforceError: "",
		stats: null,
	};
	const level = dispatchValidatorMode();
	if (level === "off") return empty;

	const findings: DispatchValidatorFinding[] = [];
	for (let i = 0; i < input.tasks.length; i++) {
		const t = input.tasks[i];
		// Resume / continue the same worker: do not second-guess an in-flight brief.
		const agentId = t.agentId?.trim();
		if (agentId && t.fresh !== true) continue;

		const verdict = looksLikeMergedIndependentGoals(t.task);
		if (!verdict.merged) continue;
		findings.push({
			taskIndex: i,
			briefItems: verdict.briefItems,
			splitHint: verdict.splitHint,
		});
	}
	if (findings.length === 0) return empty;

	const action: DispatchValidatorAction = level === "enforce" ? "enforce" : "nudge";
	const stats: DispatchValidatorStats = {
		triggered: true,
		action,
		findings: findings.map((f) => ({
			task_index: f.taskIndex,
			brief_items: f.briefItems,
		})),
	};

	const scopeLabel =
		input.mode === "single"
			? "single brief"
			: findings.length === 1
				? `tasks[${findings[0].taskIndex}] brief`
				: `${findings.length} tasks[] briefs`;
	const itemsLabel = findings.map((f) => f.briefItems).join(",");
	const splitLines = findings
		.map((f) =>
			input.mode === "single"
				? `- suggested split preview: ${f.splitHint}`
				: `- tasks[${f.taskIndex}] (${f.briefItems} items): ${f.splitHint}`,
		)
		.join("\n");

	if (action === "enforce") {
		return {
			findings,
			nudgeText: "",
			enforceError: [
				`Dispatch shape rejected (PIPI_SUBAGENT_DISPATCH_ENFORCE=1): expected parallel tasks[] / multiple dispatches, got merged ${input.mode === "single" ? "single" : "task brief"}.`,
				`Detected ${scopeLabel} with brief_items=[${itemsLabel}] that look like independent goals packed together.`,
				"missing: split independent goals into tasks:[{agent,task},…] (or multiple subagent calls) and re-send this turn.",
				"NEVER merge independent goals into one brief.",
				splitLines,
			].join("\n"),
			stats,
		};
	}

	const nudgeText = [
		`[dispatch-shape] Detected ${scopeLabel} with brief_items=[${itemsLabel}].`,
		"If these items are mutually independent, split them into tasks[] multi-element fan-out (or multiple dispatches) instead of one worker.",
		"Reference: NEVER merge independent goals into one brief.",
		splitLines,
		"",
	].join("\n");

	return { findings, nudgeText, enforceError: "", stats };
}

/** Best-effort, fire-and-forget dispatch-shape telemetry. Never affects a dispatch. */
function recordSubagentDispatchStats(
	mode: DispatchStatsMode,
	tasks: readonly DispatchStatsTask[],
	background: boolean,
	validator?: DispatchValidatorStats | null,
): void {
	try {
		const configuredPath = process.env.PIPI_SUBAGENT_STATS_PATH;
		const statsPath =
			configuredPath === undefined
				? path.join(os.homedir(), ".pi", "agent", "subagent-stats.jsonl")
				: configuredPath.trim();
		if (!statsPath) return;

		const line = `${JSON.stringify({
			ts: new Date().toISOString(),
			pid: process.pid,
			depth: PIPIUI_DEPTH,
			mode,
			task_count: tasks.length,
			background,
			tasks: tasks.map((task) => ({
				agent: task.agent,
				title: task.title ?? null,
				brief_chars: task.task.length,
				brief_items: estimateBriefItems(task.task),
			})),
			...(validator ? { validator } : {}),
		})}\n`;
		void fs.promises
			.mkdir(path.dirname(statsPath), { recursive: true })
			.then(() => fs.promises.appendFile(statsPath, line, "utf8"))
			.catch(() => {});
	} catch {
		// Telemetry must remain completely isolated from dispatch.
	}
}

// ---- Pipi UI 集成：向 App 桥接服务上报 subagent 生命周期（无环境变量时完全静默） ----
const PIPIUI_PORT = process.env.PIPIUI_BRIDGE_PORT;
const PIPIUI_SESSION = process.env.PIPIUI_SESSION_KEY;
const PIPIUI_SESSION_CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY;
const PIPIUI_HOST_PROTOCOL = process.env.PIPIUI_HOST_PROTOCOL;

function pipiuiChildProcessEnv(
	extra: Record<string, string | undefined> = {},
	preserveComputerCapability = false,
): Record<string, string | undefined> {
	const env = { ...process.env, ...extra };
	// A broker connection/capability is one dispatch generation only. Never let a
	// verifier, helper, or nested child inherit the main token or another run's
	// grant. The main extension re-adds this complete tuple only for this spawn.
	const memoryBrokerValues = Object.fromEntries(
		Object.entries(extra).filter(([key, value]) =>
			key === "PIPIUI_MEMORY_BROKER_MODE"
			|| key === "PIPIUI_MEMORY_BROKER_URL"
			|| key === "PIPIUI_MEMORY_BROKER_TOKEN"
			|| key === "PIPIUI_MEMORY_BROKER_CAPABILITY"
			|| key === "PIPIUI_MEMORY_PROJECT_ROOT"
			|| key === "PIPIUI_MEMORY_BROKER_PACKAGE_ROOT"
			|| key === "PIPIUI_MEMORY_BROKER_EXTENSION"
			|| key === "PIPIUI_MEMORY_BROKER_PACKAGE_VERSION"
			|| key === "PIPIUI_MAIN_CWD"
			? typeof value === "string" && value.length > 0
			: false,
		),
	);
	const computerMemoryEnabled = extra.PIPIUI_COMPUTER_MEMORY_ENABLED;
	delete env.PIPIUI_MEMORY_BROKER_MODE;
	delete env.PIPIUI_MEMORY_BROKER_URL;
	delete env.PIPIUI_MEMORY_BROKER_TOKEN;
	delete env.PIPIUI_MEMORY_BROKER_CAPABILITY;
	delete env.PIPIUI_MEMORY_PROJECT_ROOT;
	delete env.PIPIUI_MEMORY_BROKER_PACKAGE_ROOT;
	delete env.PIPIUI_MEMORY_BROKER_EXTENSION;
	delete env.PIPIUI_MEMORY_BROKER_PACKAGE_VERSION;
	delete env.PIPIUI_COMPUTER_MEMORY_ENABLED;
	Object.assign(env, memoryBrokerValues);
	// Only the dispatched Pi process may inherit desktop control. Verifier
	// shells and git helpers still use the default false path. The companion
	// Computer-memory marker is equally one-dispatch-only and is never inherited
	// merely because a parent once held a desktop grant.
	if (!preserveComputerCapability) {
		delete env.PIPIUI_COMPUTER_CAPABILITY;
	} else if (computerMemoryEnabled === "1") {
		env.PIPIUI_COMPUTER_MEMORY_ENABLED = "1";
	}
	return env;
}
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
// Globally enabled Computer Use strategy path; mounted in a dispatched Pi
// process only when that task carries an explicit per-task desktop grant.
const PIPIUI_COMPUTER_EXT = process.env.PIPIUI_COMPUTER_EXT;
// App-owned search guard; children load the same code and inherit the human-turn grant file.
const PIPIUI_SEARCH_SCOPE_EXT = process.env.PIPIUI_SEARCH_SCOPE_EXT;
// Managed pi-web-access supplies web_search, fetch_content, source_check, and
// get_search_content. Provider-hosted search may also reach workers through pi's own
// extension discovery; this pinned route makes research delegable for other providers.
const PIPIUI_WEB_ACCESS_EXT = process.env.PIPIUI_WEB_ACCESS_EXT;
// arXiv remains a specialized local Pi package. Role allowlists decide whether a
// child may call each mounted package tool.
const PIPIUI_ARXIV_EXT = process.env.PIPIUI_ARXIV_EXT;
// Every dispatched subagent runs with the external skill library switched off: a worker
// follows its own agent prompt plus the brief, never a skill SOP it discovered on its own.
const PIPIUI_SUBAGENT_SKILL_ISOLATION = process.env.PIPIUI_SUBAGENT_SKILL_ISOLATION === "1";
// Read-only planners additionally cannot pull SKILL.md through the read tool.
const PIPIUI_SKILL_READ_BLOCK = process.env.PIPIUI_SKILL_READ_BLOCK === "1";

type MemoryBrokerChildRole = "worker" | "operator";
type IssuedMemoryBrokerEnvironment = Record<string, string>;
type IssuedMemoryBrokerPackage = { root: string; extension: string; version: string };
type MainMemoryBrokerIssuer = ((input: {
	agentID: string;
	runID: string;
	role: MemoryBrokerChildRole;
	hostIssuedDesktopGrant?: "user-requested" | "ui-verify";
}) => IssuedMemoryBrokerEnvironment | undefined) & {
	validateIssuedPackageIdentity?: (
		environment: Record<string, string | undefined>,
	) => { root: string; entrypoint: string; version: string } | undefined;
};

const MAIN_MEMORY_BROKER_ISSUER = Symbol.for("pipiui.memory-broker.issue-child-capability");
const memoryBrokerIssuerHost = globalThis as typeof globalThis & { [key: symbol]: unknown };

function mainMemoryBrokerIssuer(): MainMemoryBrokerIssuer | undefined {
	const issuer = memoryBrokerIssuerHost[MAIN_MEMORY_BROKER_ISSUER];
	return typeof issuer === "function" ? issuer as MainMemoryBrokerIssuer : undefined;
}

/** Main-only capability issue. Absence/degradation remains optional-memory fail-soft. */
async function issueMemoryBrokerEnvironment(
	input: {
		agentID: string;
		runID: string;
		role: MemoryBrokerChildRole;
		hostIssuedDesktopGrant?: "user-requested" | "ui-verify";
	},
): Promise<IssuedMemoryBrokerEnvironment | undefined> {
	try {
		return mainMemoryBrokerIssuer()?.(input);
	} catch {
		return undefined;
	}
}

/**
 * The live main package owns identity validation. There is deliberately no
 * local `../packages` or development-tree fallback: a stale, mismatched, or
 * missing identity removes only optional child memory.
 */
function issuedMemoryBrokerPackageForChild(
	environment: IssuedMemoryBrokerEnvironment,
): IssuedMemoryBrokerPackage | undefined {
	try {
		const identity = mainMemoryBrokerIssuer()?.validateIssuedPackageIdentity?.(environment);
		return identity
			? { root: identity.root, extension: identity.entrypoint, version: identity.version }
			: undefined;
	} catch {
		return undefined;
	}
}

/** Terminal memory is optional and must never delay done delivery. */
async function submitBrokerTerminalCandidate(
	environment: IssuedMemoryBrokerEnvironment | undefined,
	input: { runID: string; task: string; title?: string; terminalText: string; outcome: "success" | "failure" },
): Promise<void> {
	if (!environment) return;
	try {
		const identity = issuedMemoryBrokerPackageForChild(environment);
		if (!identity) return;
		const clientPath = fs.realpathSync(path.join(identity.root, "src/client.ts"));
		const prefix = identity.root.endsWith(path.sep) ? identity.root : `${identity.root}${path.sep}`;
		if (!clientPath.startsWith(prefix) || !fs.statSync(clientPath).isFile()) return;
		const { createMemoryBrokerClient, submitTerminalExperienceCandidate } = await import(pathToFileURL(clientPath).href);
		await submitTerminalExperienceCandidate(createMemoryBrokerClient(environment), input);
	} catch {
		// Optional memory must not interfere with terminal report/done delivery.
	}
}

function memoryBrokerExtensionPathForChild(
	environment: IssuedMemoryBrokerEnvironment,
): string | undefined {
	return issuedMemoryBrokerPackageForChild(environment)?.extension;
}

/**
 * Runtime state published by the pipi-philosophy extension for this exact pid, each turn.
 * Not the config file: the config says what the user asked for, this says what the composer
 * actually resolved after capability guards, role scope and layer dependencies.
 */
const PHILOSOPHY_STATE = path.join(os.tmpdir(), `pipi-philosophy-${process.pid}.json`);

/**
 * Is the fan-out philosophy layer live in this very process?
 *
 * That layer's premise is that workers run in the background and report through signals — a
 * boss that blocks on each dispatch is running a fake fan-out. So while the layer is on,
 * background stops being a per-call preference and becomes a runtime invariant, exactly like
 * the depth guard. The guard has to live here rather than in the prompt: session history shows
 * models passing background:false regardless of what the system prompt says.
 *
 * Read fresh per call, so a Settings toggle applies from the next turn without a restart. No
 * state file means the philosophy is not loaded here, and the old caller-decides behaviour
 * stands.
 */
function fanoutLayerActive(): boolean {
	try {
		const state = JSON.parse(fs.readFileSync(PHILOSOPHY_STATE, "utf-8")) as {
			pid?: number;
			layers?: unknown;
			at?: number;
		};
		if (state.pid !== process.pid || !Array.isArray(state.layers)) return false;
		// Rewritten every turn, so anything old belongs to a dead process whose pid the OS
		// recycled — not to us.
		if (typeof state.at !== "number" || Date.now() - state.at > 3_600_000) return false;
		return state.layers.includes("fanout");
	} catch {
		return false;
	}
}

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

const PIPIUI_REPORT_TIMEOUT_MS = 5000;
type PipiuiAgentReport = AgentBridgeEventPayloadV1;

/**
 * The sole live agent-event emitter. It selects exactly one envelope for the
 * same /rpc endpoint: legacy flat Swift bridge by default, canonical v1 only
 * when the Electron host explicitly exported PIPIUI_HOST_PROTOCOL=1.
 */
async function postPipiuiReport(payload: PipiuiAgentReport): Promise<void> {
	if (!PIPIUI_PORT) return;
	const body = encodeAgentEventBridgeRequestV1(payload, {
		PIPIUI_HOST_PROTOCOL,
		PIPIUI_SESSION_KEY: PIPIUI_SESSION,
		PIPIUI_SESSION_CAPABILITY,
	});
	// Missing agentId/runId or a missing canonical capability fails closed. Never
	// send a second legacy fallback and never ask a host to infer a reusable run.
	if (!body) return;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), PIPIUI_REPORT_TIMEOUT_MS);
	timeout.unref?.();
	try {
		await fetch(`http://127.0.0.1:${PIPIUI_PORT}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch {
		// Bridge reporting is observability, never a reason to crash the worker.
	} finally {
		clearTimeout(timeout);
	}
}

function pipiuiReport(payload: PipiuiAgentReport): void {
	void postPipiuiReport(payload);
}

const terminalPipiuiReportFlights = new Map<string, Promise<void>>();

/** Serialize terminal UI events per bare ID; the lease owner awaits the queue before release. */
function postTerminalPipiuiReport(payload: PipiuiAgentReport): Promise<void> {
	const previous = terminalPipiuiReportFlights.get(payload.agentId) ?? Promise.resolve();
	const flight = previous.catch(() => {}).then(() => postPipiuiReport(payload));
	terminalPipiuiReportFlights.set(payload.agentId, flight);
	void flight.finally(() => {
		if (terminalPipiuiReportFlights.get(payload.agentId) === flight) {
			terminalPipiuiReportFlights.delete(payload.agentId);
		}
	});
	return flight;
}

async function awaitTerminalPipiuiReports(agentId: string): Promise<void> {
	while (terminalPipiuiReportFlights.has(agentId)) {
		await terminalPipiuiReportFlights.get(agentId);
	}
}

// ---- Cut-in hold：GUI「插队」后，批量 join 的用户消息必须先进入 turn ----
// Swift（ChatSession.cutInQueueHead）在插队时写 marker 文件，joined prompt 发出后删除。
// 扩展见到新鲜 marker 时暂缓所有自动 followUp 投递（done/stall/heartbeat 都经
// trySendUserMessage），让 cut-in prompt 先赢下一个 turn；信号只晚一个 turn，绝不丢。
// 兜底释放：marker 超过 15s（Swift 崩溃 / 未发出）自动失效，或 input 事件见到真实
// 用户消息进 turn 时提前删除。
const PIPIUI_CUTIN_HOLD_MS = 15_000;
const PIPIUI_CUTIN_HOLD_FILE = PIPIUI_SESSION
	? path.join(os.tmpdir(), `pipiui-cutin-${PIPIUI_SESSION}.json`)
	: null;

function cutInHoldActive(): boolean {
	if (!PIPIUI_CUTIN_HOLD_FILE) return false;
	try {
		const raw = JSON.parse(fs.readFileSync(PIPIUI_CUTIN_HOLD_FILE, "utf-8")) as { at?: unknown };
		if (typeof raw.at !== "number") return false;
		return Date.now() - raw.at < PIPIUI_CUTIN_HOLD_MS;
	} catch {
		return false;
	}
}

/** Release the hold: called on a real user turn start; also clears stale markers. */
function releaseCutInHold(): void {
	if (!PIPIUI_CUTIN_HOLD_FILE) return;
	try {
		fs.unlinkSync(PIPIUI_CUTIN_HOLD_FILE);
	} catch {
		/* already gone */
	}
}

/** Block automatic delivery while a fresh cut-in hold marker exists (≤15s fallback). */
async function awaitCutInHoldRelease(): Promise<void> {
	if (!PIPIUI_CUTIN_HOLD_FILE || !cutInHoldActive()) return;
	const deadline = Date.now() + PIPIUI_CUTIN_HOLD_MS + 2_000;
	while (cutInHoldActive()) {
		if (Date.now() >= deadline) {
			releaseCutInHold();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
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
const PIPIUI_EDIT_PAYLOAD_LIMIT = 20_000;

/**
 * Keep enough edit arguments for the native log to render a diff, while ensuring
 * the bridge never retains an unbounded tool payload. Every returned value is
 * complete JSON: oversized replacements are shortened or omitted as whole items.
 */
function boundedEditPayloadForUI(args: Record<string, unknown>): string {
	const rawPath = String(args.path ?? args.file_path ?? "");
	let path = rawPath;
	while (JSON.stringify({ path }).length > PIPIUI_EDIT_PAYLOAD_LIMIT && path.length > 0) {
		path = path.slice(0, Math.max(0, path.length - Math.ceil(path.length / 4)));
	}

	const source = Array.isArray(args.edits)
		? args.edits
		: [{ oldText: args.oldText, newText: args.newText }];
	const edits = source.flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const edit = value as Record<string, unknown>;
		return typeof edit.oldText === "string" && typeof edit.newText === "string"
			? [{ oldText: edit.oldText, newText: edit.newText }]
			: [];
	});

	const retained: Array<{ oldText: string; newText: string }> = [];
	for (const edit of edits) {
		const full = [...retained, edit];
		if (JSON.stringify({ path, edits: full }).length <= PIPIUI_EDIT_PAYLOAD_LIMIT) {
			retained.push(edit);
			continue;
		}

		// Retain as much of the first overflowing replacement as fits, without
		// ever slicing serialized JSON (which would corrupt escaping/structure).
		if (JSON.stringify({ path, edits: [...retained, { oldText: "", newText: "" }] }).length
			> PIPIUI_EDIT_PAYLOAD_LIMIT) break;
		let low = 0;
		let high = edit.oldText.length + edit.newText.length;
		while (low < high) {
			const count = Math.ceil((low + high + 1) / 2);
			const oldCount = Math.min(edit.oldText.length, count);
			const candidate = {
				oldText: edit.oldText.slice(0, oldCount),
				newText: edit.newText.slice(0, Math.max(0, count - oldCount)),
			};
			if (JSON.stringify({ path, edits: [...retained, candidate] }).length <= PIPIUI_EDIT_PAYLOAD_LIMIT) {
				low = count;
			} else {
				high = count - 1;
			}
		}
		const oldCount = Math.min(edit.oldText.length, low);
		retained.push({
			oldText: edit.oldText.slice(0, oldCount),
			newText: edit.newText.slice(0, Math.max(0, low - oldCount)),
		});
		break;
	}
	return JSON.stringify(retained.length > 0 ? { path, edits: retained } : { path });
}

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
		case "fetch_content":
			return String(args.url || args.urls?.[0] || "…");
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
	/** Dispatch generation; prevents a late terminal callback from contaminating a reused agentId. */
	runId?: string;
	/** Runtime-attested verify result (set when the brief carried `verify`). */
	verify?: VerifyAttestation;
	/** Brief carried `verify` but it was not run because the agent was aborted. */
	verifySkipped?: boolean;
	/** Brief carried `verify` for a read-only agent; the runtime dropped it as unattestable. */
	verifyDropped?: boolean;
	/** Declared `deliverable: report`: the done message carries a report, capped higher. */
	reportsInFull?: boolean;
	/** Continued an existing worker's conversation instead of starting it cold. */
	resumed?: boolean;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	/** True when tool returned immediately and completion arrives via [subagent-done] followUp */
	background?: boolean;
	agentIds?: string[];
	/** Invalid/duplicate package diagnostics from discovery; valid agents still remain usable. */
	agentDiagnostics?: string[];
}

interface RunSingleAgentOptions {
	/** When true, start report includes background flag; caller must not bind parent abort. */
	background?: boolean;
	/** Pre-assigned id (background path needs ids before process exits). */
	agentId?: string;
	/** Short one-line title for the Subagents panel list; falls back to task text if omitted. */
	title?: string;
	/** Informational dependency tags (task/agentId short names); display-only. */
	blockedBy?: string[];
	/** Current session model as `provider/id` (depth 0 `ctx.model`); used for「跟随主 Agent」. */
	sessionModel?: string;
	/** Optional Boss-selected thinking for this dispatch; never inherited from the Boss session. */
	thinking?: string;
	/** Shell command the runtime runs in the agent's cwd after the process ends (attested verify). */
	verify?: string;
	/** Discard this worker's stored conversation and start it cold. */
	fresh?: boolean;
	/** Explicit per-task Computer Use grant; omission = no desktop tools. */
	desktop?: "user-requested" | "ui-verify";
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

interface SubagentModelChain {
	/** Ordered fallback chain; index 0 is the primary model. Never empty. */
	models: SubagentModelOverride[];
}

/**
 * Parse one agent override value into an ordered model chain. All three shapes are
 * compatible (must stay parse-compatible with the Swift side):
 * 1. legacy string `"provider/id"` → chain = [{ model }]
 * 2. `{ model, thinking? }` → chain = [{ model, thinking? }]
 * 3. `{ models: [{ model, thinking? }, ...] }` → ordered chain (invalid entries skipped)
 * Returns an empty array when nothing parseable — caller falls back to the main model.
 */
function parseSubagentModelChain(value: unknown): SubagentModelOverride[] {
	const parseEntry = (
		candidate: { model?: unknown; thinking?: unknown },
	): SubagentModelOverride | undefined => {
		if (typeof candidate.model !== "string" || !candidate.model.trim()) return undefined;
		const thinking =
			typeof candidate.thinking === "string" && candidate.thinking.trim()
				? candidate.thinking.trim()
				: undefined;
		return { model: candidate.model.trim(), ...(thinking ? { thinking } : {}) };
	};
	if (typeof value === "string" && value.trim()) {
		return [{ model: value.trim() }];
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const candidate = value as { model?: unknown; thinking?: unknown; models?: unknown };
		if (Array.isArray(candidate.models)) {
			const chain: SubagentModelOverride[] = [];
			for (const item of candidate.models) {
				if (item && typeof item === "object" && !Array.isArray(item)) {
					const entry = parseEntry(item as { model?: unknown; thinking?: unknown });
					if (entry) chain.push(entry);
				}
			}
			if (chain.length > 0) return chain;
		}
		const single = parseEntry(candidate);
		if (single) return [single];
	}
	return [];
}

/** Hot-read PipiUI settings JSON (UserDefaults mirror). Missing / empty = follow main.
 *
 * Legacy values are model strings; newer values are `{ model, thinking? }` or an ordered
 * fallback chain `{ models: [...] }`. Normalizing all shapes here lets a running extension
 * immediately see settings saved by the app.
 */
function loadSubagentModelOverrides(): Record<string, SubagentModelChain> {
	const file =
		process.env.PIPIUI_SUBAGENT_MODELS_FILE ||
		path.join(os.homedir(), "Library/Application Support/PipiUI/subagent-models.json");
	try {
		const raw = fs.readFileSync(file, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const result: Record<string, SubagentModelChain> = {};
			for (const [agentName, value] of Object.entries(parsed)) {
				const chain = parseSubagentModelChain(value);
				if (chain.length > 0) result[agentName] = { models: chain };
			}
			return result;
		}
	} catch {
		// absent or unreadable → all follow main
	}
	return {};
}

const PI_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const PI_THINKING_LEVELS_WITH_DEFAULT = new Set(["", ...PI_THINKING_LEVELS]);

type SubagentModelCapability = {
	/** True only when Swift received an explicit reasoning boolean from the model catalog. */
	capabilityKnown: boolean;
	/** Exact Swift `ThinkingCapability.allowedLevels` output; empty string means model default. */
	allowedLevels: string[];
};

/** Schema validation normally enforces this; keep direct/runtime callers from injecting junk. */
function normalizeTaskThinking(value: unknown): string | undefined {
	return typeof value === "string" && PI_THINKING_LEVELS.has(value.trim())
		? value.trim()
		: undefined;
}

/** `model:high` is Pi shorthand, not a distinct model id. */
function stripModelThinkingSuffix(modelRef: string): string {
	const colon = modelRef.lastIndexOf(":");
	if (colon <= 0) return modelRef;
	return PI_THINKING_LEVELS.has(modelRef.slice(colon + 1)) ? modelRef.slice(0, colon) : modelRef;
}

/**
 * Hot-read the compact Swift capability catalog. Swift has already applied the authoritative
 * `ThinkingCapability` rules, so Node only consumes the serialized allowed levels; it does not
 * reconstruct reasoning/thinkingLevelMap behavior here.
 */
function loadSubagentModelCapabilities(): Record<string, SubagentModelCapability> {
	const file =
		process.env.PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE ||
		// Tolerate an early experimental name if a live extension was launched before an app update.
		process.env.PIPIUI_SUBAGENT_CAPABILITIES_FILE ||
		path.join(os.homedir(), "Library/Application Support/PipiUI/subagent-model-capabilities.json");
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const root = parsed as { m?: unknown; models?: unknown };
		const rawModels = root.m ?? root.models;
		if (!rawModels || typeof rawModels !== "object" || Array.isArray(rawModels)) return {};

		const result: Record<string, SubagentModelCapability> = {};
		for (const [rawModel, rawEntry] of Object.entries(rawModels)) {
			const model = rawModel.trim();
			if (!model || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
			const entry = rawEntry as {
				r?: unknown;
				l?: unknown;
				reasoning?: unknown;
				levels?: unknown;
			};
			const reasoning = entry.r ?? entry.reasoning;
			const rawLevels = entry.l ?? entry.levels;
			const levels = Array.isArray(rawLevels)
				? Array.from(new Set(rawLevels.filter(
					(level): level is string =>
						typeof level === "string" && PI_THINKING_LEVELS_WITH_DEFAULT.has(level),
				)))
				: [];
			result[model] = {
				capabilityKnown: typeof reasoning === "boolean",
				allowedLevels: levels,
			};
		}
		return result;
	} catch {
		// Missing/unreadable catalog means capability is unknown, never permission to carry
		// Boss-selected thinking across a fallback.
		return {};
	}
}

function capabilityForSubagentModel(
	model: string,
	catalog: Record<string, SubagentModelCapability> = loadSubagentModelCapabilities(),
): SubagentModelCapability | undefined {
	return catalog[stripModelThinkingSuffix(model.trim())];
}

/** A fallback may inherit tool thinking only with explicit catalog proof. */
function modelExplicitlyAllowsThinking(model: string, thinking: string): boolean {
	const capability = capabilityForSubagentModel(model);
	return capability?.capabilityKnown === true && capability.allowedLevels.includes(thinking);
}

/**
 * Rewrite already-assembled spawn args for a fallback chain entry. Same session
 * (--session-id untouched): only --model / --thinking change. An entry without an
 * explicit thinking level removes --thinking instead of keeping the previous one.
 */
function rewriteSpawnModelArgs(args: string[], model: string, thinking: string | undefined): void {
	const modelValue = thinking ? stripModelThinkingSuffix(model) : model;
	const mi = args.indexOf("--model");
	if (mi >= 0 && mi + 1 < args.length) args[mi + 1] = modelValue;
	else args.push("--model", modelValue);
	const ti = args.indexOf("--thinking");
	if (ti >= 0 && ti + 1 < args.length) {
		if (thinking) args[ti + 1] = thinking;
		else args.splice(ti, 2);
	} else if (thinking) {
		args.push("--thinking", thinking);
	}
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
		return new Set(sanitizeDisabledToolNames(out));
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
	const explicit = overrides[agentName]?.models[0];
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

/**
 * Initial candidate precedence is deliberately narrow: per-task tool thinking wins, then the
 * selected chain entry's persisted thinking, otherwise Pi/model default. There is no Boss
 * session-thinking input anywhere in this path.
 */
function resolveAgentThinking(agentName: string, taskThinking?: unknown): string | undefined {
	return normalizeTaskThinking(taskThinking) ?? loadSubagentModelOverrides()[agentName]?.models[0]?.thinking;
}

/**
 * A fallback can be reached after the Boss is no longer deciding. Carry its requested thinking
 * only when the Swift catalog explicitly proves that exact fallback supports it. Otherwise use
 * that candidate's own setting (including legacy/default behavior) rather than hard-passing an
 * incompatible `--thinking`. Existing entry settings remain untouched when catalog data is unknown.
 */
function resolveFallbackThinking(
	entry: SubagentModelOverride,
	taskThinking: unknown,
): string | undefined {
	const requested = normalizeTaskThinking(taskThinking);
	if (requested && modelExplicitlyAllowsThinking(entry.model, requested)) return requested;
	return entry.thinking;
}

/** Chain entry by index (0-based); undefined past the end or without an explicit override. */
function resolveAgentModelChainEntry(
	agentName: string,
	index: number,
): SubagentModelOverride | undefined {
	return loadSubagentModelOverrides()[agentName]?.models[index];
}

/** Main-agent model to stamp onto child env so nested agents still「跟随主」. */
function inheritMainModel(sessionModel: string | undefined): string | undefined {
	const fileMain = loadMainModelFile();
	if (PIPIUI_DEPTH === 0) {
		return sessionModel || fileMain || process.env.PIPIUI_MAIN_MODEL || undefined;
	}
	return process.env.PIPIUI_MAIN_MODEL || fileMain || sessionModel || undefined;
}

function legacyModelThinking(model: string): string | undefined {
	const trimmed = model.trim();
	const colon = trimmed.lastIndexOf(":");
	if (colon <= 0) return undefined;
	const suffix = trimmed.slice(colon + 1);
	return PI_THINKING_LEVELS.has(suffix) ? suffix : undefined;
}

function formatAllowedThinking(capability: SubagentModelCapability | undefined): string {
	if (!capability) return "?";
	const levels = capability.allowedLevels.map((level) => level || "default").join("|") || "none";
	return capability.capabilityKnown ? levels : `${levels}?`;
}

function formatRoutingCandidate(
	entry: SubagentModelOverride,
	catalog: Record<string, SubagentModelCapability>,
): string {
	const configured = entry.thinking ?? legacyModelThinking(entry.model) ?? "default";
	return `${entry.model}{set=${configured};allow=${formatAllowedThinking(
		capabilityForSubagentModel(entry.model, catalog),
	)}}`;
}

/**
 * Boss-only, hot-read dispatch reference. It is intentionally compact because it is appended to
 * the dynamic system prompt every turn: each route shows current primary/fallback candidates,
 * configured strength, and Swift-authoritative allowed levels. `?` means catalog capability is
 * unknown (the displayed persisted setting remains backward-compatible, but fallback tool
 * thinking will not be carried through it).
 */
function formatSubagentModelRoutingBlock(): string | null {
	if (PIPIUI_DEPTH !== 0) return null;
	const overrides = loadSubagentModelOverrides();
	const catalog = loadSubagentModelCapabilities();
	let discovered: AgentConfig[] = [];
	try {
		discovered = discoverAgents(process.cwd(), "user").agents;
	} catch {
		// The routing reference is advisory; a transient directory read must never block a turn.
	}
	const byName = new Map(discovered.map((agent) => [agent.name, agent]));
	const names = Array.from(new Set([...byName.keys(), ...Object.keys(overrides)])).sort();
	if (names.length === 0) return null;

	const followMain = loadMainModelFile() || process.env.PIPIUI_MAIN_MODEL;
	const routes = names.map((name) => {
		const configured = overrides[name]?.models;
		const agent = byName.get(name);
		const fallbackModel = followMain || agent?.model;
		const entries = configured ?? (fallbackModel
			? [{ model: fallbackModel, thinking: undefined }]
			: []);
		const chain = entries.length > 0
			? entries.map((entry) => formatRoutingCandidate(entry, catalog)).join(" -> ")
			: "unresolved";
		return `- ${name}${configured ? "" : " (follow-main)"}: ${chain}`;
	});
	return [
		"[Subagent model routing — hot-read]",
		"Optional task `thinking` is available on single, tasks[], and chain; v1 has no per-task model. Never inherit Boss thinking.",
		"Priority: task thinking > current candidate set thinking > omit --thinking. On fallback, carry task thinking only when catalog explicitly allows it; otherwise use that fallback set thinking/default. `allow=?` or a trailing `?` means capability unknown.",
		...routes,
	].join("\n");
}


// Store cap for the pull path (`subagent_status full:true`). Must comfortably hold a
// whole explore/plan report: this is the only place the full text survives, and every
// done message advertises it as the escape hatch.
const JOB_RESULT_STORE_CAP = 32000;
const JOB_RESULT_DISPLAY_CAP = 8000;
/** Terminal history is bounded independently; running jobs are never pruning candidates. */
const MAX_TERMINAL_JOB_RECORDS = 1000;

// ---- Attested verify (system testimony): the runtime runs `verify` in the agent's cwd ----
const VERIFY_TIMEOUT_MS = 120_000;
const VERIFY_TAIL_CHARS = 2000;
const VERIFY_TAIL_LINES = 20;
/** Rolling collection cap while verify runs: retain only this tail so a chatty
 * command cannot buffer unbounded output for up to VERIFY_TIMEOUT_MS. */
const VERIFY_COLLECT_TAIL_CHARS = 64 * 1024;


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
				env: pipiuiChildProcessEnv(),
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
type JobState = "running" | "ok" | "failed" | "aborted" | "interrupted";

interface JobRecord {
	agentId: string;
	/** Unique dispatch/run identity; agentId may be deliberately reused for a later completion. */
	runId: string;
	name: string;
	task: string; // truncated summary
	/** Short UI title (optional). */
	title?: string;
	/** Informational dependency tags (task/agentId short names); display-only, no scheduler. */
	blockedBy?: string[];
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
	/**
	 * [subagent-interrupted-reminder] pushes for terminal jobs that still hold stored context.
	 * 0/undefined = never nudged this terminal episode; max 2 then silence. Reset on re-dispatch.
	 */
	nudgeCount?: number;
	/** Timestamp of the last interrupted-reminder push; undefined/0 = never this episode. */
	lastNudgeAt?: number;
	/** A watchdog-only interrupted result may be corrected by this same run's real terminal callback. */
	interruptedProvisional?: boolean;
	/** Boss/user closeout for this failed/aborted/interrupted episode; state and verify stay intact. */
	closeoutDisposition?: "cleaned";
	closeoutReason?: string;
	closeoutAt?: number;
}

interface InterruptedReminder {
	agentId: string;
	runId: string;
	nudgeSeq: number;
	text: string;
}

const jobRegistry = new Map<string, JobRecord>();
/** Queued reminder tokens are memory-only: restart never resurrects an old interrupted nudge. */
const pendingInterruptedReminders = new Map<string, InterruptedReminder>();
/** Immediate in-process reservations close the selector-to-dispatch await/confirmation gap. */
const localAgentReservations = new Set<string>();

function interruptedReminderKey(agentId: string, runId: string, nudgeSeq: number): string {
	return `${agentId}\u0000${runId}\u0000${nudgeSeq}`;
}

function cancelInterruptedReminders(agentId: string, runId?: string): void {
	for (const [key, reminder] of pendingInterruptedReminders) {
		if (reminder.agentId === agentId && (runId === undefined || reminder.runId === runId)) {
			pendingInterruptedReminders.delete(key);
		}
	}
}

// ---- Stall watchdog + abort：运行中后台 job 的外部可触达句柄 ----
const STALL_THRESHOLD_MS = 120_000;
const STALL_WATCHDOG_INTERVAL_MS = 30_000;
/** Max automatic re-spawns after a retryable transport/API death (total runs = 1 + this). */
const AUTO_RESUME_MAX = 2;
/** Backoff before each auto-resume attempt (ms). Index 0 = first resume. */
const AUTO_RESUME_BACKOFF_MS = [5_000, 15_000] as const;
/** Spread retry waves across a +/-25% window instead of synchronizing thousands of workers. */
const AUTO_RESUME_JITTER_RATIO = 0.25;
/** Context size above which a final retryable failure gets a fresh-redispatch hint. */
const AUTO_RESUME_CONTEXT_HINT_TOKENS = 100_000;
/** Context tokens at/above which the session is compacted before an auto-resume re-spawn. */
const AUTO_COMPACT_BEFORE_RESUME_TOKENS = 80_000;
/** Keep the most recent tokens across the compaction boundary (pi default keepRecentTokens). */
const AUTO_COMPACT_KEEP_TOKENS = 20_000;
/** Min chain messages for a compaction to be meaningful. */
const AUTO_COMPACT_MIN_MESSAGES = 3;
/** Max messages kept by compaction (bounds the walk when usage tokens are missing). */
const AUTO_COMPACT_MAX_MESSAGES = 12;

/**
 * Transient network / upstream API failures worth auto-resuming the worker session.
 * Auth, billing, and unknown-agent failures are excluded first (not retryable).
 * Matching is lowercase substring — same spirit as pi-ai retry.js.
 */
function isRetryableWorkerError(text: string): boolean {
	const t = (text || "").toLowerCase();
	if (!t.trim()) return false;
	const nonRetryable = [
		"insufficient_quota",
		"quota",
		"billing",
		"credit balance",
		"invalid api key",
		"unauthorized",
		"401",
		"403",
		"unknown agent",
	];
	for (const s of nonRetryable) {
		if (t.includes(s)) return false;
	}
	const retryable = [
		"fetch failed",
		"connection error",
		"econnreset",
		"econnrefused",
		"etimedout",
		"socket hang up",
		"network",
		"timed out",
		"timeout",
		"429",
		"rate limit",
		"rate_limit",
		"overloaded",
		"500",
		"502",
		"503",
		"504",
		"internal error",
		"unavailable",
		"502 bad gateway",
	];
	for (const s of retryable) {
		if (t.includes(s)) return true;
	}
	return false;
}

/**
 * Quota/budget exhaustion worth switching to the next fallback model immediately.
 * Separate from isRetryableWorkerError: same-model retries cannot fix a depleted
 * quota, so these never consume the same-model resume budget. Lowercase substring.
 */
const QUOTA_FALLBACK_MARKERS = [
	"insufficient_quota",
	"quota exceeded",
	"allocated quota",
	"out of budget",
	"usage limit",
	"available balance",
	"billing",
];

function isQuotaLikeWorkerError(text: string): boolean {
	const t = (text || "").toLowerCase();
	if (!t.trim()) return false;
	for (const s of QUOTA_FALLBACK_MARKERS) {
		if (t.includes(s)) return true;
	}
	return false;
}

function jitteredRetryBackoffMs(baseMs: number, random = Math.random): number {
	const unit = Math.max(0, Math.min(1, random()));
	const multiplier = 1 - AUTO_RESUME_JITTER_RATIO + unit * AUTO_RESUME_JITTER_RATIO * 2;
	return Math.max(1, Math.round(baseMs * multiplier));
}
/** stall 复推节奏：boss 决定继续等时，最多 5 分钟沉默一次，不必等心跳。 */
const STALL_RENOTIFY_INTERVAL_MS = 5 * 60 * 1000;
/** 同一无活动片段最多推送首次 + 两次复推；有新活动后重新武装。 */
const STALL_RENOTIFY_MAX = 3;
/**
 * Terminal interrupted/aborted/failed jobs that still hold stored context: first boss reminder
 * after this many seconds idle in that state, then one re-nudge at the renudge threshold.
 * Override via PIPIUI_INTERRUPTED_NUDGE_SECS / PIPIUI_INTERRUPTED_RENUDGE_SECS.
 */
const INTERRUPTED_NUDGE_SECS_DEFAULT = 1200;
const INTERRUPTED_RENUDGE_SECS_DEFAULT = 3600;
function envPositiveSecs(name: string, fallback: number): number {
	const raw = Number.parseInt(process.env[name] || "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
const INTERRUPTED_NUDGE_SECS = envPositiveSecs(
	"PIPIUI_INTERRUPTED_NUDGE_SECS",
	INTERRUPTED_NUDGE_SECS_DEFAULT,
);
const INTERRUPTED_RENUDGE_SECS = envPositiveSecs(
	"PIPIUI_INTERRUPTED_RENUDGE_SECS",
	INTERRUPTED_RENUDGE_SECS_DEFAULT,
);
/** done 重投节奏：30s 扫描每次都看，但同一 agentId 两次投递至少隔 60s，避免轰炸正在处理中的 boss。 */
const DONE_RETRY_MIN_INTERVAL_MS = 60_000;
/** Initial delivery plus four retries; a broken follow-up channel must not retry forever. */
const DONE_MAX_ATTEMPTS = 5;
/**
 * How long the boss may hear nothing at all while work is outstanding. Chosen to be far longer
 * than the stall threshold: this is the last line of defence against silence, not a progress
 * report, and every heartbeat costs the boss a turn. 即时性已由 30s 轮询（stall 复推 / done
 * 重投 / vanished 检测）承担，心跳只做兜底摘要，故从 15min 降到 5min。
 */
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
/** A handle with no pid after this age is treated as vanished (spawn never attached). */
const NO_PID_VANISH_MS = 5 * 60 * 1000;

/** Signal 0 tests for existence without touching the process. */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means it exists but belongs to someone else — alive for our purposes.
		return (err as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

interface RunningAgentHandle {
	/** This exact dispatch generation; a late prior callback must never touch a reused agentId. */
	runId: string;
	/** 外部中止入口（action=abort / subagent_abort 命令）；走 killProc SIGTERM→SIGKILL。 */
	controller: AbortController;
	name: string;
	task: string;
	title?: string;
	/** 最后一次有任何流式事件/输出（stdout/stderr）的时间戳。 */
	lastActivityAt: number;
	/** 上次推送 [subagent-stalled] 的时间戳；0 = 本卡死片段尚未推过（有新活动后复位为 0）。 */
	lastStallNotifyAt: number;
	/** 本无活动片段已推送 [subagent-stalled] 的次数；有新活动后复位为 0。 */
	stallNotifyCount: number;
	/** When this worker was dispatched; the heartbeat reports elapsed time. */
	startedAt: number;
	/**
	 * The child has emitted close/error and this run is performing verify/end-report closeout.
	 * This is set only after an actual child terminal event, so it cannot hide a child that
	 * disappeared without reporting; it only prevents the watchdog from mistaking expected
	 * post-exit cleanup for a vanished live worker.
	 */
	finalizing: boolean;
	/**
	 * Child pid, so liveness can be checked directly. Idleness is not death: a worker can be
	 * quiet while thinking, and a dead one can leave a registry entry behind if its close
	 * handler never ran — which is precisely when the boss would otherwise wait forever.
	 */
	pid?: number;
}

/** 仅后台 job 注册；前台 job 由工具调用自身的 abort signal 负责。 */
const runningAgents = new Map<string, RunningAgentHandle>();

function handleForRun(agentId: string, runId: string): RunningAgentHandle | undefined {
	const handle = runningAgents.get(agentId);
	return handle?.runId === runId ? handle : undefined;
}

function noteAgentActivity(agentId: string, runId?: string): void {
	const handle = runningAgents.get(agentId);
	if (!handle || (runId !== undefined && handle.runId !== runId)) return;
	handle.lastActivityAt = Date.now();
	handle.lastStallNotifyAt = 0;
	handle.stallNotifyCount = 0;
}

/** Claim one bounded, interval-spaced stall notification for this idle episode. */
function claimStallNotification(handle: RunningAgentHandle, now: number): boolean {
	if (handle.stallNotifyCount >= STALL_RENOTIFY_MAX) return false;
	if (
		handle.lastStallNotifyAt > 0 &&
		now - handle.lastStallNotifyAt < STALL_RENOTIFY_INTERVAL_MS
	)
		return false;
	handle.lastStallNotifyAt = now;
	handle.stallNotifyCount++;
	return true;
}

function markAgentFinalizing(agentId: string, runId: string): void {
	const handle = handleForRun(agentId, runId);
	if (!handle) return;
	handle.pid = undefined;
	handle.finalizing = true;
	noteAgentActivity(agentId, runId);
}

function resumeAgentHandle(agentId: string, runId: string): void {
	const handle = handleForRun(agentId, runId);
	if (!handle) return;
	handle.pid = undefined;
	handle.finalizing = false;
	noteAgentActivity(agentId, runId);
}

function deleteRunningAgentHandle(agentId: string, runId: string): void {
	const handle = runningAgents.get(agentId);
	// `runId` was added after early test hooks/legacy handles existed; normal runtime handles
	// always carry it, while an old untagged handle is still safe to remove only here.
	if (handle && (handle.runId === runId || handle.runId === undefined)) runningAgents.delete(agentId);
}

function stalledInfoFor(agentId: string, now: number): { stalled: boolean; idleSec: number } {
	const handle = runningAgents.get(agentId);
	if (!handle || handle.finalizing) return { stalled: false, idleSec: 0 };
	const idleSec = Math.max(0, Math.floor((now - handle.lastActivityAt) / 1000));
	return { stalled: idleSec * 1000 >= STALL_THRESHOLD_MS, idleSec };
}

function formatJobStateWithStall(job: JobRecord, now: number): string {
	if (job.state !== "running") {
		return isHandledJob(job) ? `${job.state} (resolved/handled)` : job.state;
	}
	if (handleForRun(job.agentId, job.runId)?.finalizing) return "finalizing";
	const info = stalledInfoFor(job.agentId, now);
	return info.stalled ? `running (stalled, idle ${info.idleSec}s)` : "running";
}

/** Compact state tag for a heartbeat worker line; the verbose status view keeps idle detail. */
function formatHeartbeatWorkerState(agentId: string, handle: RunningAgentHandle, now: number): string {
	if (handle.finalizing) return "finalizing";
	const job = jobRegistry.get(agentId);
	if (!job || job.runId !== handle.runId || job.state === "running") {
		return stalledInfoFor(agentId, now).stalled ? "running(stalled)" : "running";
	}
	return job.state;
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
	if (handle.finalizing) {
		return {
			ok: false,
			message: `Cannot abort agentId=${agentId}: child process already exited and is already finalizing closeout.`,
		};
	}
	handle.controller.abort();
	return {
		ok: true,
		message: `Abort requested for agentId=${agentId} (${handle.name}). SIGTERM sent (SIGKILL after 5s if still alive); the job will report [subagent-done] with aborted status.`,
	};
}

interface ResolveSubagentEpisodeResult {
	ok: boolean;
	message: string;
	job?: JobRecord;
	currentRunId?: string;
	idempotent?: boolean;
}

function isHandledJob(job: JobRecord): boolean {
	return job.closeoutDisposition === "cleaned";
}

/**
 * Mark one terminal failure episode handled without changing its process state or verify attestation.
 * agentId is reusable, so runId is mandatory and stale requests are rejected rather than crossing runs.
 */
function resolveSubagentEpisode(
	agentId: string,
	runId: string,
	reason?: string,
): ResolveSubagentEpisodeResult {
	const job = jobRegistry.get(agentId);
	if (!job) {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId}: unknown agentId (no such job in this session process).`,
		};
	}
	if (job.runId !== runId) {
		return {
			ok: false,
			currentRunId: job.runId,
			message: `Resolve rejected for agentId=${agentId}: stale runId=${runId}; currentRunId=${job.runId}.`,
		};
	}
	if (isHandledJob(job)) {
		cancelInterruptedReminders(agentId, runId);
		return {
			ok: true,
			job,
			idempotent: true,
			message: `agentId=${agentId} runId=${runId} is already resolved/handled; state remains "${job.state}".`,
		};
	}
	if (job.state === "running") {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId} runId=${runId}: job is still running. Use action:"abort" or wait for it to finish.`,
		};
	}
	if (job.state === "ok") {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId} runId=${runId}: job state is "ok"; resolve only handles failed, aborted, or interrupted episodes.`,
		};
	}
	if (!isInterruptedReminderState(job.state)) {
		return {
			ok: false,
			message: `Cannot resolve agentId=${agentId} runId=${runId}: unsupported job state "${job.state}".`,
		};
	}
	job.closeoutDisposition = "cleaned";
	job.closeoutReason = taskSummary(
		reason?.replace(/\s+/g, " ").trim() || "Boss marked this episode handled",
		500,
	);
	job.closeoutAt = Date.now();
	cancelInterruptedReminders(agentId, runId);
	return {
		ok: true,
		job,
		message: `Resolved agentId=${agentId} runId=${runId}: state remains "${job.state}" and verification was not changed; interrupted reminders cancelled.`,
	};
}

/**
 * Independent closeout bridge event; deliberately never impersonates a terminal end event.
 * Queue it after any outstanding end report for this agent so Swift cannot observe a resolved
 * closeout while its row still appears running.
 */
function reportResolvedCloseout(job: JobRecord): Promise<void> {
	if (!isHandledJob(job)) return Promise.resolve();
	return postTerminalPipiuiReport({
		kind: "closeout",
		agentId: job.agentId,
		runId: job.runId,
		disposition: "cleaned",
		reason: job.closeoutReason ?? "Boss marked this episode handled",
		closeoutAt: job.closeoutAt ?? Date.now(),
	});
}


function taskSummary(task: string, cap = 200): string {
	const t = task.replace(/\s+/g, " ").trim();
	return t.length <= cap ? t : `${t.slice(0, cap)}…`;
}

function jobPrune(): void {
	const finished = [...jobRegistry.entries()]
		.filter(([, j]) => j.state !== "running")
		.sort((a, b) => (a[1].endedAt ?? a[1].startedAt) - (b[1].endedAt ?? b[1].startedAt));
	const excess = finished.length - MAX_TERMINAL_JOB_RECORDS;
	for (let i = 0; i < excess; i++) {
		jobRegistry.delete(finished[i][0]);
	}
}

function jobUpsertRunning(
	agentId: string,
	name: string,
	task: string,
	title?: string,
	blockedBy?: string[],
	runId?: string,
): string {
	// Every dispatch is a fresh episode, including a same-agentId continuation. A late old
	// close/finalize callback is therefore unable to mutate the new row or its reminders.
	const episodeRunId = runId ?? DeliveryObligationStore.runId();
	cancelInterruptedReminders(agentId);
	jobRegistry.set(agentId, {
		agentId,
		runId: episodeRunId,
		name,
		task: taskSummary(task),
		title,
		...(blockedBy && blockedBy.length > 0 ? { blockedBy } : {}),
		state: "running",
		startedAt: Date.now(),
	});
	jobPrune();
	return episodeRunId;
}

function jobPatchRunning(
	agentId: string,
	runId: string,
	patch: { activity?: string; cost?: number; turns?: number },
): void {
	const job = jobRegistry.get(agentId);
	if (!job || job.runId !== runId || job.state !== "running") return;
	if (patch.activity !== undefined) job.activity = patch.activity;
	if (patch.cost !== undefined) job.cost = patch.cost;
	if (patch.turns !== undefined) job.turns = patch.turns;
}

type JobFinalizeFields = {
	name?: string;
	task?: string;
	state: JobState;
	resultText?: string;
	cost?: number;
	turns?: number;
	activity?: string;
	verify?: VerifyAttestation;
	/** Only watchdog disappearance settle uses this; the real terminal callback may replace it. */
	provisional?: boolean;
};

function mergeTerminalJobFields(existing: JobRecord, fields: JobFinalizeFields): void {
	if (!existing.resultText && fields.resultText)
		existing.resultText = truncateTextHead(fields.resultText, JOB_RESULT_STORE_CAP);
	if (existing.cost === undefined && fields.cost !== undefined) existing.cost = fields.cost;
	if (existing.turns === undefined && fields.turns !== undefined) existing.turns = fields.turns;
	if (!existing.activity && fields.activity) existing.activity = fields.activity;
	if (!existing.verify && fields.verify) existing.verify = fields.verify;
}

/**
 * Apply one terminal result to exactly one run. A watchdog interruption is provisional only:
 * the same run's real ok/failed/aborted terminal callback replaces it. Other terminal races are
 * idempotent and cannot overwrite a newer run sharing this agentId.
 */
function jobFinalize(agentId: string, runId: string, fields: JobFinalizeFields): boolean {
	if (fields.state === "running") return false;
	const existing = jobRegistry.get(agentId);
	const now = Date.now();
	if (existing && existing.runId !== runId) return false;

	const correctsProvisionalInterrupted =
		existing?.state === "interrupted" &&
		existing.interruptedProvisional === true &&
		fields.provisional !== true &&
		(fields.state === "ok" || fields.state === "failed" || fields.state === "aborted");
	if (existing && existing.state !== "running" && !correctsProvisionalInterrupted) {
		if (existing.state === fields.state) mergeTerminalJobFields(existing, fields);
		return false;
	}

	// A new terminal boundary (or correction of watchdog-only interruption) invalidates every
	// queued reminder from its prior view of this episode. `ok` consequently has no reminder path.
	cancelInterruptedReminders(agentId, runId);
	jobRegistry.set(agentId, {
		agentId,
		runId,
		name: fields.name ?? existing?.name ?? "?",
		task: fields.task ? taskSummary(fields.task) : (existing?.task ?? ""),
		...(existing?.blockedBy && existing.blockedBy.length > 0
			? { blockedBy: existing.blockedBy }
			: {}),
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
		...(existing?.closeoutDisposition === "cleaned"
			? {
					closeoutDisposition: existing.closeoutDisposition,
					closeoutReason: existing.closeoutReason,
					closeoutAt: existing.closeoutAt,
				}
			: {}),
		...(fields.state === "interrupted" && fields.provisional ? { interruptedProvisional: true } : {}),
	});
	jobPrune();
	return true;
}

function isInterruptedReminderState(state: JobState): boolean {
	return state === "interrupted" || state === "aborted" || state === "failed";
}

function formatInterruptedReminder(job: JobRecord, idleSec: number, nudgeSeq: number): string {
	const title =
		job.title?.trim() || (job.task.split("\n")[0] ?? "").trim().slice(0, 80) || "(untitled)";
	return [
		`[subagent-interrupted-reminder] agentId=${job.agentId} runId=${job.runId} state=${job.state} title=${title} idle=${idleSec}s nudge=${nudgeSeq}/2`,
		`This worker is ${job.state} but its stored context is intact. Re-dispatch the same agentId to continue where it left off, or pass fresh:true to abandon that context. Do not treat this message as a new user request.`,
		`If this episode's work is already complete, mark it handled with subagent({action:"resolve", agentId:"${job.agentId}", runId:"${job.runId}"}) (or /subagent_resolve ${job.agentId} ${job.runId}) so no further reminders are sent; do not just reply "already completed".`,
	].join("\n");
}

/** Reserve due terminal reminders before delivery; reservations remain process-memory only. */
function scheduleInterruptedReminders(now: number, resumableIds: ReadonlySet<string>): InterruptedReminder[] {
	const reminders: InterruptedReminder[] = [];
	for (const job of jobRegistry.values()) {
		if (!isInterruptedReminderState(job.state) || isHandledJob(job) || !resumableIds.has(job.agentId)) continue;
		const priorCount = job.nudgeCount ?? 0;
		if (priorCount >= 2) continue;
		const endedAt = job.endedAt ?? job.startedAt;
		const idleSec = Math.max(0, Math.floor((now - endedAt) / 1000));
		const thresholdSec = priorCount === 0 ? INTERRUPTED_NUDGE_SECS : INTERRUPTED_RENUDGE_SECS;
		if (idleSec < thresholdSec) continue;
		const nudgeSeq = priorCount + 1;
		job.nudgeCount = nudgeSeq;
		job.lastNudgeAt = now;
		const reminder: InterruptedReminder = {
			agentId: job.agentId,
			runId: job.runId,
			nudgeSeq,
			text: formatInterruptedReminder(job, idleSec, nudgeSeq),
		};
		pendingInterruptedReminders.set(
			interruptedReminderKey(reminder.agentId, reminder.runId, reminder.nudgeSeq),
			reminder,
		);
		reminders.push(reminder);
	}
	return reminders;
}

function isInterruptedReminderEligible(reminder: InterruptedReminder): boolean {
	const key = interruptedReminderKey(reminder.agentId, reminder.runId, reminder.nudgeSeq);
	const queued = pendingInterruptedReminders.get(key);
	const job = jobRegistry.get(reminder.agentId);
	return (
		queued === reminder &&
		job !== undefined &&
		job.runId === reminder.runId &&
		!isHandledJob(job) &&
		isInterruptedReminderState(job.state) &&
		(job.nudgeCount ?? 0) >= reminder.nudgeSeq
	);
}

function discardInterruptedReminder(reminder: InterruptedReminder): void {
	const key = interruptedReminderKey(reminder.agentId, reminder.runId, reminder.nudgeSeq);
	if (pendingInterruptedReminders.get(key) === reminder) pendingInterruptedReminders.delete(key);
}

/** Dead pid, or no pid attached after NO_PID_VANISH_MS. Finalizing follows an observed close. */
function isHandleVanished(handle: RunningAgentHandle, now: number): boolean {
	if (handle.finalizing) return false;
	if (handle.pid !== undefined) return !isProcessAlive(handle.pid);
	// Prefer lastActivityAt so auto-resume backoff (pid cleared + activity noted) is not vanished.
	return now - Math.max(handle.startedAt, handle.lastActivityAt) >= NO_PID_VANISH_MS;
}

/**
 * Settle a genuinely vanished worker on every ledger. A child that emitted close is marked
 * finalizing instead and reaches its own real terminal path after verify/end-report closeout.
 */
function markWorkerInterrupted(agentId: string, reason: string): boolean {
	const handle = runningAgents.get(agentId);
	const job = jobRegistry.get(agentId);
	if (!handle && !job) return false;
	if (!handle && job && job.state !== "running") return false;
	const runId = handle?.runId ?? job?.runId;
	if (!runId) return false;
	if (handle && job && handle.runId && handle.runId !== job.runId) {
		deleteRunningAgentHandle(agentId, handle.runId);
		return false;
	}

	const changed = jobFinalize(agentId, runId, {
		name: handle?.name ?? job?.name,
		task: handle?.task ?? job?.task,
		state: "interrupted",
		provisional: true,
		resultText: reason,
		activity: job?.activity,
		cost: job?.cost,
		turns: job?.turns,
	});
	deleteRunningAgentHandle(agentId, runId);
	if (!changed) return false;
	void postTerminalPipiuiReport({
		kind: "end",
		agentId,
		runId,
		ok: false,
		aborted: true,
		interrupted: true,
		output: reason,
		...(job?.cost !== undefined ? { cost: job.cost } : {}),
		...(job?.turns !== undefined ? { turns: job.turns } : {}),
	});
	return true;
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
): string | undefined {
	const agentId = result.agentId;
	if (!agentId) return undefined;
	const runId = result.runId ?? jobRegistry.get(agentId)?.runId ?? DeliveryObligationStore.runId();
	const resultText = extra?.error || getResultOutput(result) || result.stderr || "(no output)";
	jobFinalize(agentId, runId, {
		name: result.agent,
		task: result.task,
		state: jobStateFromResult(result, extra),
		resultText,
		cost: result.usage.cost,
		turns: result.usage.turns,
		verify: result.verify,
	});
	return runId;
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

/** Compact live snapshot of in-flight background workers, for the boss system prompt.
 *  Returns null when nothing is in flight (zero cost in the normal case). */
function formatInFlightWorkersBlock(now: number): string | null {
	if (runningAgents.size === 0) return null;
	const lines: string[] = ["## Background workers in flight (live this turn)"];
	let anyStalledOrVanished = false;
	for (const [agentId, handle] of runningAgents) {
		const idleSec = Math.floor((now - handle.lastActivityAt) / 1000);
		const elapsed = formatElapsedMs(now - handle.startedAt);
		const title = (handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 60)) || "(untitled)";
		let state: string;
		if (handle.finalizing) {
			state = `finalizing closeout ${elapsed}`;
		} else if (isHandleVanished(handle, now)) {
			anyStalledOrVanished = true;
			state = "VANISHED — process gone with no report";
		} else if (idleSec * 1000 >= STALL_THRESHOLD_MS) {
			anyStalledOrVanished = true;
			state = `STALLED — idle ${idleSec}s`;
		} else {
			state = `running ${elapsed}, idle ${idleSec}s`;
		}
		lines.push(`- \`${agentId}\` (${title}) — ${state}`);
	}
	if (anyStalledOrVanished) {
		lines.push(
			"A stalled or vanished worker is NOT fine and NOT \"everything is normal\". Before answering the user or declaring anything done, account for every worker above: call `subagent_status`, then recover each stalled/vanished one (abort + re-dispatch by a materially different route, or continue the same agentId). Do not claim success or normalcy while any worker above is stalled or vanished.",
		);
	} else {
		lines.push(
			"All still running. If the user asks about progress, call `subagent_status` rather than answering from memory.",
		);
	}
	return lines.join("\n");
}

/**
 * Workers whose conversation survives on disk without a live job entry.
 *
 * The registry is memory in one process, so a restarted main session forgets every worker it
 * dispatched — while their stored conversations are still sitting there. An interrupted worker
 * is not a failed one: it was cut off mid-thought, and restarting it from zero throws away
 * context that is still perfectly good. This is what lets the boss find those again.
 */
function resumableAgentIds(): string[] {
	const dir = PIPIUI_MAIN_CWD
		? path.join(PIPIUI_MAIN_CWD, ".pi", "agent-sessions")
		: undefined;
	if (!dir) return [];
	try {
		return fs
			.readdirSync(dir)
			.map((f) => /_pipiui-(.+)\.jsonl$/.exec(f)?.[1])
			.filter((id): id is string => Boolean(id))
			.filter((id) => jobRegistry.get(id)?.state !== "running")
			.sort();
	} catch {
		return [];
	}
}

function formatResumableSection(exclude: Set<string>): string[] {
	const ids = resumableAgentIds().filter((id) => !exclude.has(id));
	if (ids.length === 0) return [];
	return [
		"",
		`Resumable workers (stored context, not running): ${ids.join(", ")}`,
		"Re-dispatch one by its agentId to continue with everything it already knows; pass fresh only to throw that context away.",
	];
}

function formatJobsStatus(opts: { agentId?: string; onlyRunning?: boolean; full?: boolean }): string {
	const now = Date.now();
	if (opts.agentId) {
		const job = jobRegistry.get(opts.agentId);
		if (!job) {
			const resumable = resumableAgentIds().includes(opts.agentId);
			if (resumable) {
				return [
					`agentId: ${opts.agentId}`,
					"state: not running in this process, but its stored conversation is intact.",
					"This is an interruption, not a failure — re-dispatch this same agentId to continue where it left off.",
				].join("\n");
			}
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
			`runId: ${job.runId}`,
			`name: ${job.name}`,
			...(job.title ? [`title: ${job.title}`] : []),
			...(job.blockedBy && job.blockedBy.length > 0
				? [`blocked-by: ${job.blockedBy.join(", ")}`]
				: []),
			`state: ${formatJobStateWithStall(job, now)}`,
			`turns: ${turns}`,
			`cost: ${cost}`,
			`elapsed: ${elapsed}`,
			`Task: ${job.task || "(none)"}`,
		];
		if (isHandledJob(job)) {
			const handledAt = job.closeoutAt ? new Date(job.closeoutAt).toISOString() : "(time unavailable)";
			lines.push(`closeout: cleaned (resolved/handled) at ${handledAt}`);
			lines.push(`reason: ${job.closeoutReason ?? "Boss marked this episode handled"}`);
		}
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
		const head = opts.onlyRunning
			? "No running subagent jobs."
			: "No subagent jobs recorded in this process.";
		// A restarted main session has an empty registry while stored conversations remain.
		return opts.onlyRunning ? head : [head, ...formatResumableSection(new Set())].join("\n");
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

	const header = `| agentId | runId | name | state | turns | cost | elapsed | preview |`;
	const sep = `| --- | --- | --- | --- | --- | --- | --- | --- |`;
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
		const blockedByNote =
			j.blockedBy && j.blockedBy.length > 0 ? `blocked-by: ${j.blockedBy.join(", ")}` : "";
		const handledNote = isHandledJob(j)
			? `handled: ${j.closeoutReason ?? "Boss marked this episode handled"}`
			: "";
		const previewBase = previewRaw.replace(/\s+/g, " ").trim();
		const notes = [blockedByNote, handledNote].filter(Boolean).join(" · ");
		const preview = (notes
			? previewBase
				? `${notes} · ${previewBase}`
				: notes
			: previewBase
		).slice(0, 80);
		return `| ${j.agentId} | ${j.runId} | ${j.name} | ${formatJobStateWithStall(j, now)} | ${turns} | ${cost} | ${elapsed} | ${preview || "-"} |`;
	});
	return [header, sep, ...rows, ...formatResumableSection(new Set(jobs.map((j) => j.agentId)))].join(
		"\n",
	);
}

function generatePipiuiAgentId(reserved: Set<string> = new Set()): string {
	// 64 random bits keeps generated ids collision-resistant while staying inside the 24-char
	// semantic-id contract. The loop turns probabilistic uniqueness into a checked invariant.
	for (let attempt = 0; attempt < 100; attempt++) {
		const candidate = `agent-${randomBytes(8).toString("hex")}`;
		const active =
			localAgentReservations.has(candidate) ||
			runningAgents.has(candidate) ||
			jobRegistry.get(candidate)?.state === "running";
		if (reserved.has(candidate) || active) continue;
		reserved.add(candidate);
		localAgentReservations.add(candidate);
		return candidate;
	}
	throw new Error("Unable to allocate a unique subagent id after 100 attempts.");
}

/**
 * A worker's id is what the boss has to type back to continue with the same worker, so it is
 * chosen by the boss and kept short and meaningful: `quota-pill`, not `agent-ms1mo5dx-pn6o1l`.
 * Long random ids drift when a model retypes them, and a drifted id silently becomes a new
 * worker with an empty head — the exact failure this naming exists to prevent.
 *
 * Also lands verbatim in a git branch (`pipiui/<id>`) and a session filename, so the character
 * set is the intersection of "safe there" and "hard to mistype".
 */
// PIPIUI_PURE_AGENT_ID_BEGIN
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,23}$/;
const RESERVED_AGENT_IDS = new Set(["root", "main", "head", "master"]);

/** Returns an error addressed to the model, or null when the id is usable. */
function validateAgentId(id: string): string | null {
	if (!AGENT_ID_PATTERN.test(id)) {
		return `Invalid agentId ${JSON.stringify(id)}. Use 2-24 chars of lowercase letters, digits, "-" or "_", starting with a letter or digit — a short name for this worker, e.g. "quota-pill".`;
	}
	if (RESERVED_AGENT_IDS.has(id)) {
		return `agentId ${JSON.stringify(id)} is reserved. Pick another short name.`;
	}
	if (id.includes("..")) {
		return `agentId ${JSON.stringify(id)} must not contain "..".`;
	}
	return null;
}

interface CallerAgentIdSelection {
	ids: string[];
	problem?: string;
}

/** Pure request gate: validates, de-duplicates, and excludes every currently active id. */
function selectCallerAgentIds(
	candidates: readonly (string | undefined)[],
	activeIds: ReadonlySet<string>,
): CallerAgentIdSelection {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (candidate === undefined) continue;
		const normalized = candidate.trim();
		const invalid = validateAgentId(normalized);
		if (invalid) return { ids, problem: invalid };
		if (seen.has(normalized)) {
			return {
				ids,
				problem: `Duplicate agentId ${JSON.stringify(normalized)} in one request. Each dispatched worker must have a unique id.`,
			};
		}
		if (activeIds.has(normalized)) {
			return {
				ids,
				problem: `agentId ${JSON.stringify(normalized)} is already running. Wait for it to finish or abort it before resuming that worker.`,
			};
		}
		seen.add(normalized);
		ids.push(normalized);
	}
	return { ids };
}

/** Selector + synchronous reservation is one operation from the event loop's perspective. */
function selectAndReserveCallerAgentIds(
	candidates: readonly (string | undefined)[],
	activeIds: ReadonlySet<string>,
	reservations: Set<string>,
): CallerAgentIdSelection {
	const selection = selectCallerAgentIds(candidates, activeIds);
	if (selection.problem) return selection;
	for (const id of selection.ids) reservations.add(id);
	return selection;
}
// PIPIUI_PURE_AGENT_ID_END

/**
 * Where a reusable worker's conversation lives. Deliberately under the main project rather
 * than the worker's own cwd: that cwd is a worktree, and a successful merge deletes it — which
 * would throw away the context on exactly the runs that went well.
 */
/**
 * Retention for stored worker conversations.
 *
 * Deliberately conservative in both directions. Deleting one throws away the context that
 * makes continuing a worker worth anything, so age is the only "this is finished" signal
 * trusted here: a merged slice is often continued the next day, while a worker nobody has
 * touched in two weeks is reasoning about code that has since moved on. The count cap only
 * exists so a burst of short-lived workers cannot grow the directory without bound.
 */
// PIPIUI_PURE_SESSION_RETENTION_BEGIN
const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_MAX_KEEP = 1000;
const SESSION_PRUNE_COMPLETION_INTERVAL = 256;
const SESSION_PRUNE_TIME_INTERVAL_MS = 5 * 60 * 1000;

interface StoredSession {
	name: string;
	agentId: string;
	mtimeMs: number;
}

/** Pure so the retention rule can be tested without touching a filesystem. */
function selectStaleSessions(
	entries: StoredSession[],
	opts: { now: number; maxAgeMs: number; maxKeep: number; running: Set<string> },
): string[] {
	const candidates = entries.filter((e) => !opts.running.has(e.agentId));
	const stale = new Set(
		candidates.filter((e) => opts.now - e.mtimeMs > opts.maxAgeMs).map((e) => e.name),
	);
	// Newest first, then anything past the cap goes too.
	const survivors = candidates
		.filter((e) => !stale.has(e.name))
		.sort((a, b) => b.mtimeMs - a.mtimeMs);
	for (const extra of survivors.slice(opts.maxKeep)) stale.add(extra.name);
	return [...stale];
}

interface SessionPruneSchedule {
	hasPruned: boolean;
	completionsSincePrune: number;
	lastPrunedAt: number;
}

/** Pure amortization policy: first access, every completed wave slice, or elapsed interval. */
function nextSessionPruneSchedule(
	state: SessionPruneSchedule,
	trigger: "access" | "completed",
	now: number,
): { state: SessionPruneSchedule; shouldPrune: boolean } {
	const completionsSincePrune =
		state.completionsSincePrune + (trigger === "completed" ? 1 : 0);
	const shouldPrune =
		!state.hasPruned ||
		completionsSincePrune >= SESSION_PRUNE_COMPLETION_INTERVAL ||
		now - state.lastPrunedAt >= SESSION_PRUNE_TIME_INTERVAL_MS;
	return {
		shouldPrune,
		state: shouldPrune
			? { hasPruned: true, completionsSincePrune: 0, lastPrunedAt: now }
			: { ...state, completionsSincePrune },
	};
}
// PIPIUI_PURE_SESSION_RETENTION_END

const SESSION_PRUNE_IO_BATCH = 64;

function yieldSessionPruneIO(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

// PIPIUI_PURE_ASYNC_BATCH_BEGIN
async function mapSessionPruneBatches<T, R>(
	items: readonly T[],
	batchSize: number,
	fn: (item: T) => Promise<R>,
	yieldBetween: () => Promise<void>,
): Promise<R[]> {
	const results: R[] = [];
	for (let offset = 0; offset < items.length; offset += batchSize) {
		results.push(...(await Promise.all(items.slice(offset, offset + batchSize).map(fn))));
		await yieldBetween();
	}
	return results;
}
// PIPIUI_PURE_ASYNC_BATCH_END

// PIPIUI_PURE_SESSION_REMOVE_GUARD_BEGIN
async function removeSessionWithLeaseGuard<TLease>(
	entry: StoredSession,
	isLocallyActive: () => boolean,
	acquireLease: () => TLease | undefined,
	releaseLease: (lease: TLease) => void,
	readCurrentMtime: () => Promise<number | undefined>,
	remove: () => Promise<void>,
): Promise<boolean> {
	// Close both race windows: activity may begin after the original directory snapshot,
	// and another Pi process may begin between this local check and deletion.
	if (isLocallyActive()) return false;
	const lease = acquireLease();
	if (!lease) return false;
	try {
		if (isLocallyActive()) return false;
		if ((await readCurrentMtime()) !== entry.mtimeMs) return false;
		await remove();
		return true;
	} finally {
		releaseLease(lease);
	}
}
// PIPIUI_PURE_SESSION_REMOVE_GUARD_END

async function readStoredSessions(dir: string): Promise<StoredSession[]> {
	let names: string[];
	try {
		names = await fs.promises.readdir(dir);
	} catch {
		return [];
	}
	const entries = await mapSessionPruneBatches(
		names,
		SESSION_PRUNE_IO_BATCH,
		async (name) => {
				const agentId = /_pipiui-(.+)\.jsonl$/.exec(name)?.[1];
				if (!agentId) return undefined;
				try {
					return { name, agentId, mtimeMs: (await fs.promises.stat(path.join(dir, name))).mtimeMs };
				} catch {
					return undefined;
				}
		},
		yieldSessionPruneIO,
	);
	return entries.filter((entry): entry is StoredSession => Boolean(entry));
}

async function leasedAgentIds(): Promise<Set<string>> {
	if (!PIPIUI_MAIN_CWD) return new Set();
	try {
		const names = await fs.promises.readdir(path.join(PIPIUI_MAIN_CWD, ".pi", "agent-leases"));
		return new Set(
			names
				.map((name) => /^(.*)\.lease$/.exec(name)?.[1])
				.filter((id): id is string => Boolean(id)),
		);
	} catch {
		return new Set();
	}
}

function isAgentLocallyActiveForSessionPrune(agentId: string): boolean {
	return (
		localAgentReservations.has(agentId) ||
		runningAgents.has(agentId) ||
		jobRegistry.get(agentId)?.state === "running"
	);
}

let sessionPruneSchedule: SessionPruneSchedule = {
	hasPruned: false,
	completionsSincePrune: 0,
	lastPrunedAt: 0,
};
let sessionPruneFlight: Promise<void> | undefined;
let sessionPruneRerun = false;
let sessionPruneRerunDir: string | undefined;

async function performAgentSessionPrune(dir: string): Promise<void> {
	if (!PIPIUI_MAIN_CWD) return;
	const running = new Set<string>([
		...localAgentReservations,
		...runningAgents.keys(),
		...[...jobRegistry.values()]
			.filter((j) => j.state === "running")
			.map((j) => j.agentId),
		...(await leasedAgentIds()),
	]);
	const stored = await readStoredSessions(dir);
	const staleNames = selectStaleSessions(stored, {
		now: Date.now(),
		maxAgeMs: SESSION_MAX_AGE_MS,
		maxKeep: SESSION_MAX_KEEP,
		running,
	});
	const stale = stored.filter((entry) => staleNames.includes(entry.name));
	await mapSessionPruneBatches(
		stale,
		SESSION_PRUNE_IO_BATCH,
		async (entry) => {
			const file = path.join(dir, entry.name);
			try {
				await removeSessionWithLeaseGuard(
					entry,
					() => isAgentLocallyActiveForSessionPrune(entry.agentId),
					() => acquireAgentLease(path.resolve(PIPIUI_MAIN_CWD), entry.agentId).lease,
					releaseAgentLease,
					async () => {
						try {
							return (await fs.promises.stat(file)).mtimeMs;
						} catch {
							return undefined;
						}
					},
					async () => fs.promises.rm(file),
				);
			} catch {
					// A file we cannot remove only costs disk; never fail a dispatch over housekeeping.
				}
		},
		yieldSessionPruneIO,
	);
}

function launchAgentSessionPrune(dir: string): void {
	sessionPruneFlight = performAgentSessionPrune(dir)
		.catch((err) => console.error("[pipiui-subagent] session housekeeping failed:", err))
		.finally(() => {
			sessionPruneFlight = undefined;
			if (!sessionPruneRerun) return;
			sessionPruneRerun = false;
			const rerunDir = sessionPruneRerunDir ?? dir;
			sessionPruneRerunDir = undefined;
			launchAgentSessionPrune(rerunDir);
		});
}

/** Amortized, single-flight housekeeping: no synchronous directory scan blocks dispatch. */
function pruneAgentSessions(dir: string, trigger: "access" | "completed"): void {
	const decision = nextSessionPruneSchedule(sessionPruneSchedule, trigger, Date.now());
	sessionPruneSchedule = decision.state;
	if (!decision.shouldPrune) return;
	if (sessionPruneFlight) {
		sessionPruneRerun = true;
		sessionPruneRerunDir = dir;
		return;
	}
	launchAgentSessionPrune(dir);
}


function agentSessionDir(): string | undefined {
	if (!PIPIUI_MAIN_CWD) return undefined;
	const dir = path.join(PIPIUI_MAIN_CWD, ".pi", "agent-sessions");
	try {
		fs.mkdirSync(dir, { recursive: true });
		pruneAgentSessions(dir, "access");
		return dir;
	} catch {
		return undefined;
	}
}

/** pi writes `<timestamp>_<sessionId>.jsonl`, so presence is a suffix match. */
function agentSessionExists(dir: string, sessionId: string): boolean {
	try {
		return fs.readdirSync(dir).some((f) => f.endsWith(`_${sessionId}.jsonl`));
	} catch {
		return false;
	}
}

function agentSessionFiles(dir: string, sessionId: string): string[] {
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(`_${sessionId}.jsonl`))
			.map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

/** 8-char hex id for a compaction entry (matches pi's own compaction id shape). */
function compactionEntryId(): string {
	try {
		return randomBytes(4).toString("hex");
	} catch {
		return Math.floor(Math.random() * 0xffffffff)
			.toString(16)
			.padStart(8, "0");
	}
}

/**
 * Append a pi-native `{"type":"compaction",...}` entry to the session jsonl before an
 * auto-resume re-spawn, so the worker restarts from a compacted context instead of dying
 * on a full one. Append-only: never rewrites the file, never breaks the parent chain —
 * pi's buildContextEntries drops everything before `firstKeptEntryId` on resume and renders
 * `summary` as one user text. Any failure returns false: compaction must never block resume.
 */
function appendSessionCompaction(
	sessionDir: string,
	sessionId: string,
	taskText: string,
	lastContextTokens: number,
): boolean {
	try {
		const files = agentSessionFiles(sessionDir, sessionId);
		if (files.length === 0) return false;
		const lines = fs.readFileSync(files[files.length - 1], "utf8").split("\n");
		const entries: any[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				entries.push(JSON.parse(trimmed));
			} catch {
				// Bad line: pi's loader skips it, so do we.
			}
		}
		// No parseable header, or first entry is not a session header → treat file as empty.
		if (entries.length === 0 || entries[0]?.type !== "session") return false;

		// leafId = id of the last non-session entry (message / compaction / branch_summary …).
		let leafId: string | undefined;
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i].type !== "session") {
				leafId = entries[i].id;
				break;
			}
		}
		if (!leafId) return false;

		// Walk the parent chain root → leaf once; it serves both the keep-set and the summary.
		const byId = new Map<string, any>();
		for (const e of entries) if (e.id) byId.set(e.id, e);
		const chain: any[] = [];
		let cur: any = byId.get(leafId);
		while (cur) {
			chain.push(cur);
			cur = cur.parentId ? byId.get(cur.parentId) : undefined;
		}
		chain.reverse();

		// Walk the chain backwards from the leaf, accumulating usage.totalTokens (assistant
		// messages only; 0 otherwise) until we keep KEEP_TOKENS or MAX_MESSAGES messages.
		const kept: any[] = [];
		let acc = 0;
		for (let i = chain.length - 1; i >= 0; i--) {
			if (chain[i].type !== "message") continue;
			kept.push(chain[i]);
			acc += chain[i].message?.usage?.totalTokens ?? 0;
			if (acc >= AUTO_COMPACT_KEEP_TOKENS || kept.length >= AUTO_COMPACT_MAX_MESSAGES) break;
		}
		kept.reverse(); // kept[0] = earliest kept message
		if (kept.length < AUTO_COMPACT_MIN_MESSAGES) return false;
		const firstKeptEntryId = kept[0].id;

		// Summary: the chain's first user message (the original task), truncated.
		// content may be a string or an array of blocks ({type:"text",text} etc.).
		let summary = "";
		for (const e of chain) {
			if (e.type !== "message" || e.message?.role !== "user") continue;
			const content = e.message.content;
			if (typeof content === "string") {
				summary = content;
			} else if (Array.isArray(content)) {
				const textBlock = content.find((b: any) => b?.type === "text" && typeof b.text === "string");
				if (textBlock) summary = textBlock.text;
			}
			if (summary) break;
		}
		summary = summary.slice(0, 400);
		if (summary) {
			summary += "\n[pipiui] 早期上下文已压缩；请基于以上任务描述继续。";
		} else {
			summary = "任务描述见上方会话开头（已压缩）。";
		}

		fs.appendFileSync(
			files[files.length - 1],
			"\n" +
				JSON.stringify({
					type: "compaction",
					id: compactionEntryId(),
					parentId: leafId,
					timestamp: new Date().toISOString(),
					summary,
					firstKeptEntryId,
					tokensBefore: lastContextTokens,
				}) +
				"\n",
		);
		return true;
	} catch {
		return false;
	}
}


async function sendUserMessageAfterCutIn(
	pi: ExtensionAPI,
	text: string,
	shouldSend?: () => boolean,
): Promise<boolean> {
	// A resolved episode may have been queued behind the cut-in hold. Re-check immediately
	// before each actual send so resolve can suppress that stale reminder.
	if (shouldSend && !shouldSend()) return false;
	try {
		await pi.sendUserMessage(text, { deliverAs: "followUp" });
		return true;
	} catch {
		// 降级到不带 options 的形式（旧版 pi 可能不认识 deliverAs）。
	}
	if (shouldSend && !shouldSend()) return false;
	try {
		await pi.sendUserMessage(text);
		return true;
	} catch (err) {
		console.error("[pipiui-subagent] failed to deliver message:", err);
		return false;
	}
}

async function trySendUserMessage(pi: ExtensionAPI, text: string): Promise<boolean> {
	// 插队保护：用户批量消息未进 turn 前，自动信号不得抢跑（超时自动释放）。
	await awaitCutInHoldRelease();
	return sendUserMessageAfterCutIn(pi, text);
}

/**
 * A reminder can wait behind a cut-in while the boss resumes/completes the worker. Revalidate
 * both before and after that wait, then immediately before the actual follow-up send, so an old
 * nudge token cannot surface after its agentId has begun another run or reached ok.
 */
async function deliverInterruptedReminder(
	pi: ExtensionAPI,
	reminder: InterruptedReminder,
	testHooks?: {
		waitForCutIn?: () => Promise<void>;
		send?: (text: string) => Promise<boolean>;
	},
): Promise<boolean> {
	if (!isInterruptedReminderEligible(reminder)) {
		discardInterruptedReminder(reminder);
		return false;
	}
	await (testHooks?.waitForCutIn ?? awaitCutInHoldRelease)();
	if (!isInterruptedReminderEligible(reminder)) {
		discardInterruptedReminder(reminder);
		return false;
	}
	try {
		const send = testHooks?.send ?? ((text: string) =>
			sendUserMessageAfterCutIn(pi, text, () => isInterruptedReminderEligible(reminder)));
		return await send(reminder.text);
	} catch (err) {
		console.error("[pipiui-subagent] failed to deliver interrupted reminder:", err);
		return false;
	} finally {
		discardInterruptedReminder(reminder);
	}
}

/** 一次性通知（stall / heartbeat / vanished）：投出去即可，失败由各自的重推节奏兜底。 */
function deliverSubagentDone(pi: ExtensionAPI, text: string): void {
	void trySendUserMessage(pi, text);
}

/** done 消息在 promise resolve 前都视为未确认；持久 obligation 让新进程恢复未确认投递。 */
interface PendingDoneEntry {
	obligation: DeliveryObligation;
	firstFailedAt: number;
	inFlight: boolean;
	recoveredAmbiguous: boolean;
}
const pendingDone = new Map<string, PendingDoneEntry>();
let pendingDoneSettledRetryTimer: ReturnType<typeof setTimeout> | undefined;
let doneDeliveryStore: DeliveryObligationStore | undefined;

/**
 * A compaction can make follow-up delivery reject as busy even though the done
 * obligation is otherwise ready. session_compact/agent_settled are the narrow
 * post-busy seams: coalesce them, wait one event-loop turn for the failed
 * attempt to settle, then retry only entries that are no longer in flight.
 */
function retryPendingDoneAfterSessionSettled(pi: ExtensionAPI): void {
	if (pendingDoneSettledRetryTimer) return;
	pendingDoneSettledRetryTimer = setTimeout(() => {
		pendingDoneSettledRetryTimer = undefined;
		for (const [obligationId, entry] of [...pendingDone]) {
			if (entry.obligation.state === "delivered") {
				pendingDone.delete(obligationId);
				continue;
			}
			if (!entry.inFlight) sendDoneWithConfirmation(pi, entry, true);
		}
	}, 0);
	pendingDoneSettledRetryTimer.unref?.();
}
let doneDeliveryPiSessionId: string | undefined;

function logDonePersistenceFailure(action: string, obligationId: string, err: unknown): void {
	const code = (err as NodeJS.ErrnoException)?.code;
	console.error(
		`[pipiui-subagent] done delivery persistence ${action} failed` +
			` id=${obligationId || "unassigned"}${code ? ` code=${code}` : ""}`,
	);
}

function volatileObligation(agentId: string, runId: string, text: string): DeliveryObligation {
	const now = Date.now();
	return {
		version: 1,
		id: `volatile-${runId}-${randomBytes(6).toString("hex")}`,
		routingKeyHash: "unavailable",
		agentId,
		runId,
		payloadHash: "unavailable",
		text,
		state: "pending",
		attempts: 0,
		createdAt: now,
		updatedAt: now,
		lastAttemptAt: 0,
	};
}

/** Persist pending BEFORE attempting send; persistence failure degrades to the old in-memory path. */
function createDoneObligation(agentId: string, runId: string, text: string): DeliveryObligation {
	if (!doneDeliveryStore) return volatileObligation(agentId, runId, text);
	try {
		return doneDeliveryStore.create(agentId, runId, text);
	} catch (err) {
		logDonePersistenceFailure("create", "", err);
		return volatileObligation(agentId, runId, text);
	}
}

function sendDoneWithConfirmation(
	pi: ExtensionAPI,
	entry: PendingDoneEntry,
	isRetry: boolean,
): void {
	let obligation = entry.obligation;
	if (obligation.state === "delivered" || entry.inFlight || obligation.attempts >= DONE_MAX_ATTEMPTS) return;
	const now = Date.now();
	if (doneDeliveryStore && !obligation.id.startsWith("volatile-")) {
		try {
			const persisted = doneDeliveryStore.beginAttempt(obligation.id);
			if (persisted) {
				obligation = persisted;
			} else if (doneDeliveryStore.read(obligation.id)) {
				// Another live process/extension instance owns this exact obligation.
				return;
			} else {
				// The row vanished/corrupted after create: do not suppress the actual completion.
				logDonePersistenceFailure("missing-before-send", obligation.id, undefined);
				obligation = volatileObligation(obligation.agentId, obligation.runId, obligation.text);
			}
		} catch (err) {
			logDonePersistenceFailure("begin", obligation.id, err);
			obligation = {
				...obligation,
				state: "attempting",
				attempts: obligation.attempts + 1,
				lastAttemptAt: now,
			};
		}
	} else {
		obligation = {
			...obligation,
			state: "attempting",
			attempts: obligation.attempts + 1,
			lastAttemptAt: now,
		};
	}
	entry.obligation = obligation;
	entry.inFlight = true;
	const prefix = entry.recoveredAmbiguous
		? "(recovered delivery: this [subagent-done] may already have been delivered before restart; treat it as the same completion, not a new event.)"
		: isRetry
			? `(re-delivery #${obligation.attempts}: the previous [subagent-done] below was not confirmed delivered; treat it as the same event, not a new one.)`
			: "";
	const outText = prefix ? `${prefix}\n${obligation.text}` : obligation.text;
	void trySendUserMessage(pi, outText).then((ok) => {
		if (pendingDone.get(obligation.id) !== entry) return;
		entry.inFlight = false;
		let settled = { ...entry.obligation, state: ok ? "delivered" as const : "failed" as const };
		if (doneDeliveryStore && !obligation.id.startsWith("volatile-")) {
			try {
				settled = doneDeliveryStore.finishAttempt(obligation.id, ok) ?? settled;
			} catch (err) {
				logDonePersistenceFailure(ok ? "confirm" : "fail", obligation.id, err);
			}
		}
		entry.obligation = settled;
		if (ok) {
			pendingDone.delete(obligation.id);
		} else if (entry.firstFailedAt === 0) {
			entry.firstFailedAt = now;
		}
		if (!ok && settled.attempts >= DONE_MAX_ATTEMPTS) {
			pendingDone.delete(obligation.id);
			console.error(
				`[pipiui-subagent] giving up done delivery after ${settled.attempts} attempts: ${settled.agentId}`,
			);
		}
	});
}

/** [subagent-done] 专用：带送达确认 + 失败重投。job 此时已 terminal，重投只依赖保存的 text。 */
function deliverConfirmedDone(pi: ExtensionAPI, agentId: string, runId: string, text: string): void {
	const obligation = createDoneObligation(agentId, runId, text);
	if (obligation.state === "delivered") return;
	// Duplicate close/finalize callbacks for the same completion share one in-flight promise.
	const existing = pendingDone.get(obligation.id);
	if (existing) {
		if (!existing.inFlight) sendDoneWithConfirmation(pi, existing, true);
		return;
	}
	const entry: PendingDoneEntry = {
		obligation,
		firstFailedAt: 0,
		inFlight: false,
		recoveredAmbiguous: false,
	};
	pendingDone.set(obligation.id, entry);
	sendDoneWithConfirmation(pi, entry, false);
}

/** Bind persistence to Pi's durable session identity, then restore delivery only (not execution). */
function initializeDoneDeliveryStore(pi: ExtensionAPI, piSessionId: string): void {
	if (!PIPIUI_MAIN_CWD || PIPIUI_DEPTH !== 0 || !piSessionId) return;
	if (doneDeliveryPiSessionId === piSessionId && doneDeliveryStore) return;
	if (doneDeliveryPiSessionId && doneDeliveryPiSessionId !== piSessionId) {
		// A runtime session switch must not retry the previous session's messages here.
		// Their durable rows remain for that Pi session's next startup.
		pendingDone.clear();
		doneDeliveryStore = undefined;
	}
	doneDeliveryPiSessionId = piSessionId;
	try {
		doneDeliveryStore = new DeliveryObligationStore(
			path.join(
				PIPIUI_MAIN_CWD,
				".pi",
				"subagent-delivery-obligations",
				DeliveryObligationStore.routingDirectory(piSessionId),
			),
			{ routingKey: piSessionId },
		);
		for (const recovered of doneDeliveryStore.recoverable()) {
			const entry: PendingDoneEntry = {
				obligation: recovered.record,
				firstFailedAt: recovered.record.state === "failed" ? recovered.record.updatedAt : 0,
				inFlight: false,
				recoveredAmbiguous: recovered.ambiguous,
			};
			pendingDone.set(recovered.record.id, entry);
			sendDoneWithConfirmation(pi, entry, recovered.record.attempts > 0);
		}
	} catch (err) {
		logDonePersistenceFailure("restore", "", err);
		doneDeliveryStore = undefined;
	}
}

function notifySubagentDone(
	pi: ExtensionAPI,
	result: SingleResult,
	extra?: { aborted?: boolean; error?: string },
): void {
	// Finalize job BEFORE deliver: status must work even if sendUserMessage fails.
	const terminalRunId = ensureJobTerminalFromResult(result, extra);
	const runId = result.agentId
		? (result.runId ?? terminalRunId ?? jobRegistry.get(result.agentId)?.runId ?? DeliveryObligationStore.runId())
		: undefined;
	const text = formatSubagentDoneMessage(result, runId ? { ...extra, runId } : extra);
	// 前台 job 可能没有 bridge agentId；那种情况下投递确认无从挂起，退化为一次性投递。
	if (result.agentId && runId) {
		deliverConfirmedDone(pi, result.agentId, runId, text);
	} else {
		deliverSubagentDone(pi, text);
	}
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

/** Background fan-out finalizes each item and drops its full result immediately. */
async function forEachWithConcurrencyLimit<TIn>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<void>,
): Promise<void> {
	if (items.length === 0) return;
	const limit = Math.max(1, Math.min(concurrency, items.length));
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			await fn(items[current], current);
		}
	});
	await Promise.all(workers);
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

const SUBAGENT_SKILL_ISOLATION = `[DISPATCHED SUBAGENT ISOLATION — HIGHEST PRIORITY]
This session is a dispatched subagent. External skill libraries are switched off here: you MUST NOT load, read, or follow using-superpowers, brainstorming, writing-plans, subagent-driven-development, or any other SKILL.md, and no skill may add gates, approvals, or extra process on top of your brief. You MUST NOT write a spec or plan document unless your brief names its exact path. Follow only this agent's own system prompt and the brief.`;

const PLAN_SUBAGENT_ARTIFACT_BAN = `You are read-only: you MUST NOT create or save plan artifacts. Your deliverable is the plan text in your final message.`;

// Read-only-ness now travels on the agent definition (`read-only: true`), so a new agent
// declares it instead of being remembered here. See AgentTraits in ./agents.ts.

const PI_SKILLS_PREAMBLE = [
	"The following skills provide specialized instructions for specific tasks.",
	"Use the read tool to load a skill's file when the task matches its description.",
	"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
	"",
].join("\n");

const AVAILABLE_SKILLS_BLOCK = /\n*<available_skills>[\s\S]*?<\/available_skills>/g;

function stripPiSkillsFromSystemPrompt(systemPrompt: string): string {
	return systemPrompt.split(PI_SKILLS_PREAMBLE).join("").replace(AVAILABLE_SKILLS_BLOCK, "");
}

function isSkillReadPath(requestedPath: unknown): boolean {
	if (typeof requestedPath !== "string") return false;
	const normalized = requestedPath.replace(/\\/g, "/");
	return /(?:^|\/)SKILL\.md$/i.test(normalized) || /(?:^|\/)skills\//i.test(normalized);
}

// Superpowers' Pi extension skips bootstrap injection when any context message contains
// this stable marker. The explicit PipiUI extension loads first, so this sentinel reaches
// Superpowers' messageContainsBootstrap guard without disabling other extensions —
// `--no-extensions` would also cut the provider server-tool extensions workers rely on.
const SUPERPOWERS_BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
const SUBAGENT_BOOTSTRAP_SUPPRESSION_NOTE = `[PipiUI subagent isolation sentinel: ${SUPERPOWERS_BOOTSTRAP_MARKER}
The skill-library bootstrap is intentionally suppressed for this dispatched subagent. This sentinel is not a skill instruction; follow only this agent's own system prompt and its brief.]`;
// The Boss session keeps skills discoverable for an explicit user request, but the
// "invoke a skill before any response" auto-bootstrap is not the session's process owner:
// the Boss protocol is. Suppressing it is what makes the skill library opt-in.
const MAIN_BOOTSTRAP_SUPPRESSION_NOTE = `[PipiUI session skill policy: ${SUPERPOWERS_BOOTSTRAP_MARKER}
The skill-library auto-bootstrap is suppressed in this session. Skills remain available and may be loaded when the user explicitly asks for one by name; they are never a mandatory step and never add gates or approvals on top of this session's own protocol. This sentinel is not a skill instruction.]`;
// Fixed at module load: a per-turn timestamp on an always-present message would look like
// fresh content to the prompt cache.
const MAIN_SUPPRESSION_TIMESTAMP = Date.now();

/** True once any context message already carries the bootstrap marker (ours or theirs). */
function messagesContainSuperpowersMarker(messages: unknown[]): boolean {
	return messages.some((message) => {
		const content = (message as { content?: unknown }).content;
		if (typeof content === "string") return content.includes(SUPERPOWERS_BOOTSTRAP_MARKER);
		if (!Array.isArray(content)) return false;
		return content.some(
			(part) =>
				part &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string" &&
				(part as { text: string }).text.includes(SUPERPOWERS_BOOTSTRAP_MARKER),
		);
	});
}

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
	// Capture this invocation's generation before any early failure path can return a result.
	const runId = DeliveryObligationStore.runId();
	const isBackground = options?.background === true;
	localAgentReservations.add(pipiuiAgentId);

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
			runId,
			stopReason: "error",
			errorMessage: `Unknown agent: "${agentName}"`,
		};
		jobFinalize(pipiuiAgentId, runId, {
			name: agentName,
			task,
			state: "failed",
			resultText: fail.stderr,
		});
		localAgentReservations.delete(pipiuiAgentId);
		return fail;
	}
	const leaseResult = acquireAgentLease(path.resolve(PIPIUI_MAIN_CWD || defaultCwd), pipiuiAgentId);
	if (!leaseResult.lease) {
		const message = leaseResult.problem;
		localAgentReservations.delete(pipiuiAgentId);
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: message,
			errorMessage: message,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	const agentLease = leaseResult.lease;
	try {

	const runtimePolicy = runtimeRolePolicyForAgent(agent);
	// A package may make desktop requestable, but it never receives desktop merely
	// by declaring that field. The boss still needs one explicit per-task grant.
	if (options?.desktop && agent.capabilities.desktop !== "requestable") {
		const message = `Agent "${agent.name}" does not declare desktop: requestable. Omit desktop or choose an agent whose v1 capability policy permits a per-task desktop grant.`;
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: message,
			errorMessage: message,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	// Per-task desktop gate: a worker gets computer/open_application (plus the
	// strategy extension and capability env) ONLY when the boss attached an
	// explicit grant AND the host capability is live. A requested grant with no
	// host capability fails fast with a clear reason — never a silent no-op.
	const desktopGrant = resolveDesktopGrant({
		desktop: options?.desktop,
		hostAvailable:
			!!PIPIUI_COMPUTER_EXT && !!process.env.PIPIUI_COMPUTER_CAPABILITY,
	});
	if (desktopGrant.problem) {
		const message = desktopGrant.problem;
		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: message,
			errorMessage: message,
			usage: emptyUsage(),
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
	}
	// The bundled operator receives the existing broker capability only while
	// this exact dispatch has an explicit desktop grant. It is not a second
	// desktop capability: it merely authorizes bounded app-recipe recall and
	// host-generated metadata candidates for the already granted run.
	const computerMemoryEnabled =
		runtimePolicy.role === "operator" && desktopGrant.granted;
	// The formal main extension owns the live registry and returns the only
	// capability tuple a child may receive. No Swift/AppStore RPC registration or
	// child-selected root is involved. An unavailable broker simply removes the
	// optional query/candidate surface for this dispatch.
	const memoryBrokerRole: MemoryBrokerChildRole | undefined =
		runtimePolicy.role === "worker"
			? "worker"
			: computerMemoryEnabled
				? "operator"
				: undefined;
	const issuedMemoryBrokerEnvironment = memoryBrokerRole
		? await issueMemoryBrokerEnvironment({
			agentID: pipiuiAgentId,
			runID: runId,
			role: memoryBrokerRole,
			...(computerMemoryEnabled && (desktopGrant.reason === "user-requested" || desktopGrant.reason === "ui-verify")
				? { hostIssuedDesktopGrant: desktopGrant.reason }
				: {}),
		})
		: undefined;
	// A complete capability is not enough on its own: the child must also be
	// able to prove the exact installed package identity before it receives a
	// memory tool or mounts an extension.
	const terminalMemoryBrokerEnvironment = issuedMemoryBrokerEnvironment
		&& memoryBrokerExtensionPathForChild(issuedMemoryBrokerEnvironment)
		? issuedMemoryBrokerEnvironment
		: undefined;
	const placement = resolveSubagentWorktree({
		mainCwd: PIPIUI_MAIN_CWD,
		agentId: pipiuiAgentId,
		defaultCwd,
		explicitCwd: cwd, // only when caller passed cwd; undefined → auto worktree
		readOnly: agent.traits.readOnly,
		policy: runtimePolicy,
	});
	const resolvedModel = resolveAgentModel(agentName, agent.model, options?.sessionModel);
	// Tool-selected thinking belongs to this one dispatch only; it never reads the Boss's
	// current thinking level. The initial candidate may use it directly by priority.
	const taskThinking = normalizeTaskThinking(options?.thinking);
	const resolvedThinking = resolveAgentThinking(agentName, taskThinking);
	const mainModelForChild = inheritMainModel(options?.sessionModel);
	if (placement.worktreeError) {
		const message = `Writable subagent isolation failed before spawn: ${placement.worktreeError}`;
		const fail: SingleResult = {
			agent: agentName,
			agentSource: agent.source,
			task,
			title: options?.title,
			exitCode: 1,
			messages: [],
			stderr: message,
			errorMessage: message,
			usage: emptyUsage(),
			model: resolvedModel,
			step,
			agentId: pipiuiAgentId,
			runId,
			stopReason: "error",
		};
		await postPipiuiReport({
			kind: "start",
			agentId: pipiuiAgentId,
			runId,
			parentId: PIPIUI_PARENT,
			toolCallId: pipiuiCurrentToolCall,
			name: agentName,
			task,
			depth: PIPIUI_DEPTH + 1,
			model: resolvedModel ?? null,
			...(options?.title ? { title: options.title } : {}),
			...(options?.background ? { background: true } : {}),
			worktreeError: placement.worktreeError,
		});
		jobUpsertRunning(pipiuiAgentId, agentName, task, options?.title, options?.blockedBy, runId);
		jobFinalize(pipiuiAgentId, runId, {
			name: agentName,
			task,
			state: "failed",
			resultText: message,
		});
		await postTerminalPipiuiReport({
			kind: "end",
			agentId: pipiuiAgentId,
			runId,
			ok: false,
			output: message,
			worktreeError: placement.worktreeError,
		});
		return fail;
	}
	const spawnCwd = placement.cwd;

	// A worker keeps its conversation across re-dispatches so a vertical slice — implement,
	// verify, debug, fix, re-verify — is done by someone who remembers writing the code, rather
	// than by a stranger who re-reads the files and re-derives the same wrong assumption every
	// round. Read-only roles stay ephemeral: their deliverable is a one-shot report, and stale
	// context would bias the next one.
	// First real dispatch is exactly when the ledger becomes relevant (see the lazy-discovery
	// rule the orchestration layer states), so seed it here rather than on every session start.
	seedBossLedger(PIPIUI_MAIN_CWD, PIPIUI_SESSION);
	const sessionDir = agent.traits.readOnly ? undefined : agentSessionDir();
	const sessionId = `pipiui-${pipiuiAgentId}`;
	const resumingSession = Boolean(
		sessionDir && !options?.fresh && agentSessionExists(sessionDir, sessionId),
	);
	if (sessionDir && options?.fresh) {
		// Explicitly starting over: drop the old conversation rather than resuming a poisoned one.
		for (const file of agentSessionFiles(sessionDir, sessionId)) {
			try {
				fs.rmSync(file);
			} catch {
				// Best effort; a leftover file only costs a stale resume the boss asked to avoid.
			}
		}
	}
	const args: string[] = ["--mode", "json", "-p"];
	if (sessionDir) {
		args.push("--session-id", sessionId, "--session-dir", sessionDir);
	} else {
		args.push("--no-session");
	}
	// Skill libraries are off for every dispatched role, not just plan: a worker that
	// discovers a process skill on its own turns a scoped brief into someone else's SOP.
	args.push("--no-skills");
	// PipiUI-only tool names must be filtered before `--tools`: Pi 0.84 applies that flag to
	// extension/custom registrations too, so an absent feature path cannot leave a dead name in
	// a role's allowlist. `web_search` stays independent because it may be provider-native.
	const pipiuiExtensionRouting = resolvePipiUIExtensionRouting({
		webAccessExtension: PIPIUI_WEB_ACCESS_EXT,
		arxivExtension: PIPIUI_ARXIV_EXT,
	});
	const toolSelection = resolveSubagentToolSelection({
		// Keep the role-local guard explicit at the caller as well as in the
		// shared resolver: a secretary may never regain recursive delegation.
		declaredTools: agent.tools?.filter(
			(t) => runtimePolicy.allowRecursiveDelegation || t !== "subagent",
		),
		disabledTools: loadDisabledTools(),
		hasDesktopCapability: desktopGrant.granted,
		hasMemoryBrokerCapability: !!terminalMemoryBrokerEnvironment,
		allowRecursiveDelegation: runtimePolicy.allowRecursiveDelegation,
		availableExtensionTools: pipiuiExtensionRouting.extensionOnlyTools,
	});
	// 嵌套委派也加载补丁版 subagent（主会话通过 PIPIUI_SUBAGENT_EXT 传入目录）
	if (PIPIUI_SUBAGENT_EXT) args.push("-e", PIPIUI_SUBAGENT_EXT);
	// The official package owns the child-side read-only query registration.
	// Mount it only alongside a complete main-issued capability tuple.
	if (terminalMemoryBrokerEnvironment) {
		const memoryBrokerExtension = memoryBrokerExtensionPathForChild(terminalMemoryBrokerEnvironment);
		if (memoryBrokerExtension) args.push("-e", memoryBrokerExtension);
	}
	if (PIPIUI_SEARCH_SCOPE_EXT) args.push("-e", PIPIUI_SEARCH_SCOPE_EXT);
	for (const route of selectPipiUIExtensionRoutes(pipiuiExtensionRouting, toolSelection)) {
		args.push("-e", route.path);
	}
	if (desktopGrant.granted && PIPIUI_COMPUTER_EXT) {
		args.push("-e", PIPIUI_COMPUTER_EXT);
	}
	// A new explicit thinking override wins over Pi's older `model:thinking` shorthand.
	// Strip only a recognized shorthand suffix, preserving other colon-containing model ids.
	if (resolvedModel) args.push("--model", resolvedThinking ? stripModelThinkingSuffix(resolvedModel) : resolvedModel);
	if (resolvedThinking) args.push("--thinking", resolvedThinking);
	if (toolSelection.flag === "--no-tools") {
		args.push("--no-tools");
	} else {
		args.push(toolSelection.flag, toolSelection.names.join(","));
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		// Carried on the result because the done formatter runs far from the agent definition.
		reportsInFull: agent.traits.reportsInFull,
		task,
		title: options?.title,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model: resolvedModel,
		step,
		agentId: pipiuiAgentId,
		runId,
		...(resumingSession ? { resumed: true } : {}),
	};

	let pipiuiLastUpdate = 0;
	let pipiuiActivity = "";
	await postPipiuiReport({
		kind: "start",
		agentId: pipiuiAgentId,
		runId,
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
	jobUpsertRunning(pipiuiAgentId, agentName, task, options?.title, options?.blockedBy, runId);
	// 后台 job：注册外部可触达的 AbortController（subagent_abort / action=abort 入口），
	// 同一句柄也是 stall watchdog 的活动时间戳载体。前台 job 不注册（父 abort 已可杀）。
	let backgroundAbort: AbortController | undefined;
	if (isBackground) {
		backgroundAbort = new AbortController();
		runningAgents.set(pipiuiAgentId, {
			runId,
			controller: backgroundAbort,
			name: agentName,
			task,
			title: options?.title,
			lastActivityAt: Date.now(),
			lastStallNotifyAt: 0,
			stallNotifyCount: 0,
			startedAt: Date.now(),
			finalizing: false,
		});
	}
	const pipiuiUpdate = (force = false) => {
		const now = Date.now();
		if (!force && now - pipiuiLastUpdate < 500) return;
		pipiuiLastUpdate = now;
		pipiuiReport({
			kind: "update",
			agentId: pipiuiAgentId,
			runId,
			output: (getFinalOutput(currentResult.messages) || "").slice(-4000),
			activity: pipiuiActivity,
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
		});
		jobPatchRunning(pipiuiAgentId, runId, {
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
		// Central child prompt: the agent's own system prompt plus, for desktop-
		// granted dispatches only, the shared Computer Use policy (applies to ALL
		// subagents — a grant never turns desktop into a general-purpose tool).
		const promptParts: string[] = [];
		if (agent.systemPrompt.trim()) promptParts.push(agent.systemPrompt);
		if (desktopGrant.granted) promptParts.push(DESKTOP_GRANT_CHILD_POLICY);
		if (promptParts.length > 0) {
			const tmp = await writePromptToTempFile(
				agent.name,
				promptParts.join("\n\n"),
			);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;
		// Auto-resume: transport/API deaths used to mark the job failed with zero recovery even
		// though `--session-id` already supports resume. Re-spawn up to AUTO_RESUME_MAX times
		// (same args → session resume for stateful roles; cold restart for --no-session).
		let autoResumeCount = 0;
		let exitCode = 1;
		// Model fallback chain: only advances when Settings gave this agent an explicit
		// multi-model chain (index 0 is the primary model, i.e. resolvedModel).
		let modelChainIndex = 0;
		const modelFallbackNotes: string[] = [];

		for (;;) {
			// Snapshot so retry classification only sees THIS attempt (prior "fetch failed"
			// text in accumulated messages/stderr must not force another resume).
			const attemptMessagesFrom = currentResult.messages.length;
			const attemptStderrFrom = currentResult.stderr.length;
			exitCode = await new Promise<number>((resolve) => {
				const invocation = getPiInvocation(args);
				const childEnv = pipiuiChildProcessEnv({
					PIPIUI_AGENT_ID: pipiuiAgentId,
					PIPIUI_AGENT_RUN_ID: runId,
					PIPIUI_AGENT_DEPTH: String(PIPIUI_DEPTH + 1),
					PIPIUI_AGENT_ROLE: runtimePolicy.role,
					...(terminalMemoryBrokerEnvironment ?? {}),
					...(computerMemoryEnabled
						? { PIPIUI_COMPUTER_MEMORY_ENABLED: "1" }
						: {}),
					// Scope marker read by the philosophy package. An agent that delegates needs the
					// orchestration layers; every other dispatched agent must not get them — depth
					// alone cannot tell the two apart, and a worker taught to fan out would fight
					// PIPIUI_AGENT_MAX_DEPTH. Declared by the agent (`delegates: true`), which is
					// consistent with `tools` already deciding whether it can dispatch at all.
					PIPI_PHILOSOPHY_ROLE:
						agent.traits.delegates && runtimePolicy.allowRecursiveDelegation ? "lead" : "worker",
					...(mainModelForChild ? { PIPIUI_MAIN_MODEL: mainModelForChild } : {}),
					// Every dispatched child runs isolated from external skill libraries; an agent
					// that asks for it (`block-skill-reads: true`) also cannot read SKILL.md at all.
					PIPIUI_SUBAGENT_SKILL_ISOLATION: "1",
					PIPIUI_SKILL_READ_BLOCK: agent.traits.blockSkillReads ? "1" : undefined,
					...(runtimePolicy.worktree === "main-session"
						? { PIPIUI_WORKTREE: "0", PIPIUI_AGENT_NO_DELEGATION: "1" }
						: {}),
					...(placement.worktreePath ? { PIPIUI_WORKTREE_PATH: placement.worktreePath } : {}),
					...(placement.worktreeBranch ? { PIPIUI_WORKTREE_BRANCH: placement.worktreeBranch } : {}),
				}, desktopGrant.granted);
				const proc = spawn(invocation.command, invocation.args, {
					cwd: spawnCwd,
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
					detached: false,
					// 把 agent 树身份传给子进程：子进程再派 subagent 时 parentId/depth 自动正确
					// PIPIUI_SUBAGENT_EXT / SEARCH_SCOPE_EXT / grant file / bridge / session
					// 经 process.env 继承；子进程只读当前真人回合的 grant file。
					env: childEnv,
				});
				pipiuiTrackChild(proc);
				// Recorded so the heartbeat can tell "quiet" from "gone". Bind it to this
				// generation so an old child cannot attach its pid to a reused agentId.
				const liveHandle = handleForRun(pipiuiAgentId, runId);
				if (liveHandle) {
					liveHandle.pid = proc.pid;
					liveHandle.finalizing = false;
					noteAgentActivity(pipiuiAgentId, runId);
				}
				let buffer = "";
				// pi 0.84+: message_update carries assistantMessageEvent deltas only.
				// Assemble text/thinking by contentIndex and push throttled cumulative
				// snapshots (kind: log_delta) so the native panel streams live.
				// message_end remains authoritative for tools + non-streamed fallback.
				type StreamPart = { itemType: "text" | "thinking" | "tool"; text: string; name: string };
				const streamParts = new Map<number, StreamPart>();
				const streamDirty = new Set<number>();
				let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
				const STREAM_FLUSH_MS = 50;
				const STREAM_TEXT_CAP = 4000;
				const STREAM_THINKING_CAP = 600;

				const flushStreamParts = () => {
					if (streamDirty.size === 0) return;
					const indices = [...streamDirty].sort((a, b) => a - b);
					streamDirty.clear();
					for (const idx of indices) {
						const part = streamParts.get(idx);
						if (!part) continue;
						// Skip empty placeholders (e.g. bare text_start) until first delta.
						if (!part.text && part.itemType !== "tool") continue;
						pipiuiReport({
							kind: "log_delta",
							agentId: pipiuiAgentId,
							runId,
							contentIndex: idx,
							itemType: part.itemType,
							text: part.text,
							...(part.name ? { name: part.name } : {}),
						});
					}
					pipiuiUpdate();
				};

				const scheduleStreamFlush = () => {
					if (streamFlushTimer) return;
					streamFlushTimer = setTimeout(() => {
						streamFlushTimer = null;
						flushStreamParts();
					}, STREAM_FLUSH_MS);
					streamFlushTimer.unref?.();
				};

				const forceFlushStreamParts = () => {
					if (streamFlushTimer) {
						clearTimeout(streamFlushTimer);
						streamFlushTimer = null;
					}
					flushStreamParts();
				};

				const upsertStreamPart = (
					contentIndex: number,
					itemType: StreamPart["itemType"],
					delta: string,
					name?: string,
					replaceText?: string,
				) => {
					let part = streamParts.get(contentIndex);
					if (!part) {
						part = { itemType, text: "", name: name ?? "" };
						streamParts.set(contentIndex, part);
					} else if (part.itemType !== itemType) {
						part.itemType = itemType;
					}
					if (name) part.name = name;
					const cap = itemType === "thinking" ? STREAM_THINKING_CAP : STREAM_TEXT_CAP;
					if (typeof replaceText === "string") {
						part.text = replaceText.slice(0, cap);
					} else if (delta && part.text.length < cap) {
						part.text = (part.text + delta).slice(0, cap);
					}
					streamDirty.add(contentIndex);
					scheduleStreamFlush();
				};

				const processLine = (line: string) => {
					if (!line.trim()) return;
					let event: any;
					try {
						event = JSON.parse(line);
					} catch {
						return;
					}

					// Live deltas (pi 0.84+). Do not wait for message_end.
					if (event.type === "message_update") {
						const ame = event.assistantMessageEvent;
						if (ame && typeof ame === "object") {
							const ctype = String(ame.type ?? "");
							const contentIndex =
								typeof ame.contentIndex === "number" && Number.isFinite(ame.contentIndex)
									? ame.contentIndex
									: 0;
							if (ctype === "text_start") {
								upsertStreamPart(contentIndex, "text", "");
							} else if (ctype === "text_delta") {
								upsertStreamPart(contentIndex, "text", String(ame.delta ?? ""));
							} else if (ctype === "text_end") {
								const finalText =
									typeof ame.content === "string"
										? ame.content
										: typeof ame.text === "string"
											? ame.text
											: undefined;
								if (typeof finalText === "string") {
									upsertStreamPart(contentIndex, "text", "", undefined, finalText);
								}
								forceFlushStreamParts();
							} else if (ctype === "thinking_start") {
								upsertStreamPart(contentIndex, "thinking", "");
							} else if (ctype === "thinking_delta") {
								upsertStreamPart(contentIndex, "thinking", String(ame.delta ?? ""));
							} else if (ctype === "thinking_end") {
								const finalThinking =
									typeof ame.thinking === "string"
										? ame.thinking
										: typeof ame.content === "string"
											? ame.content
											: undefined;
								if (typeof finalThinking === "string") {
									upsertStreamPart(contentIndex, "thinking", "", undefined, finalThinking);
								}
								forceFlushStreamParts();
							} else if (ctype === "toolcall_start") {
								// Activity-only placeholder; tools still land authoritatively on message_end.
								const toolName = String(ame.name ?? "tool");
								pipiuiActivity = `${toolName} …`;
								pipiuiUpdate();
							}
							// toolcall_delta / toolcall_end: ignore (message_end owns final tool rows)
							return;
						}
						// Legacy cumulative snapshot message_update (pre-0.84 / jcode-style).
						const snap = event.message;
						if (snap?.role === "assistant" && Array.isArray(snap.content)) {
							for (let idx = 0; idx < snap.content.length; idx++) {
								const part = snap.content[idx];
								if (part?.type === "text" && typeof part.text === "string") {
									upsertStreamPart(idx, "text", "", undefined, part.text);
								} else if (part?.type === "thinking" && typeof part.thinking === "string") {
									upsertStreamPart(idx, "thinking", "", undefined, part.thinking);
								}
							}
						}
						return;
					}

					if (event.type === "message_end" && event.message) {
						const msg = event.message as Message;
						currentResult.messages.push(msg);

							if (msg.role === "assistant") {
								// Drain any pending live preview before authoritative tool rows.
								forceFlushStreamParts();
								const didStreamTextOrThinking = [...streamParts.values()].some(
									(p) =>
										(p.itemType === "text" || p.itemType === "thinking") &&
										p.text.trim().length > 0,
								);
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
										runId,
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
							// 完整工作流水上报：每轮的思考/文本/工具调用都进 UI 日志。
							// 若本回合已通过 log_delta 流式预览过 text/thinking，则不再整块追加，
							// 避免面板重复；tool 仍以 message_end 为权威落盘。
							const pipiuiItems: Record<string, unknown>[] = [];
							for (const part of (msg as any).content ?? []) {
								if (part?.type === "toolCall") {
									const args = (part.arguments ?? {}) as Record<string, unknown>;
									const summary = summarizeToolArgsForUI(String(part.name ?? ""), args);
									pipiuiActivity = `${part.name} ${summary}`;
									// Edit keeps a bounded, valid JSON payload so the native subagent log can
									// render the same line diff as the main-agent transcript. Other tools
									// retain their compact human-readable summary.
									const text = part.name === "edit" ? boundedEditPayloadForUI(args) : summary;
									pipiuiItems.push({ itemType: "tool", name: part.name, text });
								} else if (part?.type === "text" && String(part.text ?? "").trim()) {
									if (didStreamTextOrThinking) continue;
									pipiuiItems.push({ itemType: "text", text: String(part.text).slice(0, 4000) });
								} else if (part?.type === "thinking" && String(part.thinking ?? "").trim()) {
									if (didStreamTextOrThinking) continue;
									pipiuiItems.push({ itemType: "thinking", text: String(part.thinking).slice(0, 600) });
								}
							}
							// Always emit log when we streamed text/thinking so Swift resets
							// contentIndex→row slots even if tools array is empty (otherwise the
							// next turn would overwrite the previous message's live rows).
							if (pipiuiItems.length > 0 || didStreamTextOrThinking) {
								pipiuiReport({ kind: "log", agentId: pipiuiAgentId, runId, items: pipiuiItems });
							}
							// Next assistant turn starts fresh contentIndex mapping on the Swift side
							// after kind:"log"; clear local assembly state here.
							streamParts.clear();
							streamDirty.clear();
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
							runId,
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
					if (isBackground) noteAgentActivity(pipiuiAgentId, runId);
					buffer += data.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) processLine(line);
				});

				proc.stderr.on("data", (data) => {
					if (isBackground) noteAgentActivity(pipiuiAgentId, runId);
					currentResult.stderr += data.toString();
				});

				proc.on("close", (code) => {
					if (buffer.trim()) processLine(buffer);
					// The process is known closed. Keep the background handle alive as finalizing
					// while verify/end reporting runs; only an unreported dead live child is vanished.
					if (isBackground) markAgentFinalizing(pipiuiAgentId, runId);
					resolve(code ?? 0);
				});

				proc.on("error", () => {
					if (isBackground) markAgentFinalizing(pipiuiAgentId, runId);
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

			// Decide whether to auto-resume before verify/end (those run once, after the loop).
			if (wasAborted) break;
			const runFailed = exitCode !== 0 || Boolean(currentResult.errorMessage);
			if (!runFailed) break;
			const attemptMessages = currentResult.messages.slice(attemptMessagesFrom);
			const attemptStderr = currentResult.stderr.slice(attemptStderrFrom);
			const classifyText = [
				currentResult.errorMessage ?? "",
				currentResult.stopReason ?? "",
				attemptStderr,
				getFinalOutput(attemptMessages).slice(-2000),
			].join("\n");
			// Fallback chain classification:
			// a) quota family (isQuotaLikeWorkerError) → never consumes the same-model resume
			//    budget; switch to the next chain model immediately when one exists;
			// b) transient family (isRetryableWorkerError) → same-model auto-resume first
			//    (AUTO_RESUME_MAX budget); once exhausted, switch model if the chain has a
			//    next entry (the new model resets its own resume budget);
			// c) any other non-retryable (auth 401/403, unknown agent, …) → never switch;
			//    fall through to the existing failed path.
			const nextChainEntry = resolveAgentModelChainEntry(agentName, modelChainIndex + 1);
			let fallbackReason: string | undefined;
			if (isQuotaLikeWorkerError(currentResult.errorMessage ?? "")) {
				if (!nextChainEntry) break;
				fallbackReason = "quota";
			} else if (isRetryableWorkerError(classifyText)) {
				if (autoResumeCount >= AUTO_RESUME_MAX) {
					if (!nextChainEntry) break;
					fallbackReason = "retry budget exhausted";
				}
			} else {
				break;
			}

			const shortErr = (currentResult.errorMessage || currentResult.stderr || "retryable error")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 120);
			const baseBackoffMs = AUTO_RESUME_BACKOFF_MS[autoResumeCount] ?? 15_000;
			const backoffMs = jitteredRetryBackoffMs(baseBackoffMs);
			// Reset per-run failure flags; messages/usage/stderr keep accumulating across resumes.
			currentResult.stopReason = undefined;
			currentResult.errorMessage = undefined;
			if (fallbackReason && nextChainEntry) {
				// Model switch = same agentId / same session resume: --session-id untouched,
				// only --model / --thinking rewritten. Index only advances, so total switches
				// are naturally bounded by chain length - 1.
				const oldModel = resolveAgentModelChainEntry(agentName, modelChainIndex)?.model ?? "?";
				modelChainIndex++;
				const fallbackThinking = resolveFallbackThinking(nextChainEntry, taskThinking);
				rewriteSpawnModelArgs(args, nextChainEntry.model, fallbackThinking);
				currentResult.model = fallbackThinking
					? stripModelThinkingSuffix(nextChainEntry.model)
					: nextChainEntry.model;
				autoResumeCount = 0; // the new model gets its own same-model resume budget
				const fallbackNote = `model fallback: ${oldModel} -> ${nextChainEntry.model} (${fallbackReason})`;
				modelFallbackNotes.push(`\n[pipiui] ${fallbackNote}`);
				pipiuiActivity = `auto-resume 换模：${fallbackNote}；前次死于 ${shortErr}`;
				pipiuiReport({
					kind: "log",
					agentId: pipiuiAgentId,
					runId,
					items: [{ itemType: "text", text: `[pipiui] ${fallbackNote}` }],
				});
				pipiuiUpdate(true);
			} else {
				autoResumeCount++;
				pipiuiActivity = `auto-resume 第${autoResumeCount}次：前次死于 ${shortErr}`;
			}
			// A retry returns this same episode to live-running state; the just-closed pid is
			// intentionally cleared, but activity remains fresh throughout the short backoff.
			if (isBackground) resumeAgentHandle(pipiuiAgentId, runId);
			// 压缩会话后再 resume：worker 进程已退出（无并发写窗口），满上下文会反复 fetch
			// failed，append 一条 pi 原生 compaction 条目让 buildContextEntries 丢弃旧上下文。
			// 只读角色（sessionDir undefined）无会话可压缩，跳过并走原 resume 路径（冷重跑）。
			if (sessionDir && (currentResult.usage?.contextTokens ?? 0) >= AUTO_COMPACT_BEFORE_RESUME_TOKENS) {
				const compacted = appendSessionCompaction(
					sessionDir,
					sessionId,
					task,
					currentResult.usage?.contextTokens ?? 0,
				);
				if (compacted) {
					pipiuiActivity += `；会话已压缩（${((currentResult.usage?.contextTokens ?? 0) / 1000) | 0}k tokens）`;
					pipiuiUpdate(true);
				}
			}
			pipiuiUpdate(true);

			// Backoff interruptible by abort (foreground tool signal or backgroundAbort).
			const waitSignal = signal ?? backgroundAbort?.signal;
			const abortedDuringBackoff = await new Promise<boolean>((resolve) => {
				if (waitSignal?.aborted) {
					resolve(true);
					return;
				}
				const timer = setTimeout(() => {
					waitSignal?.removeEventListener("abort", onAbort);
					resolve(false);
				}, backoffMs);
				timer.unref?.();
				const onAbort = () => {
					clearTimeout(timer);
					resolve(true);
				};
				if (waitSignal) waitSignal.addEventListener("abort", onAbort, { once: true });
			});
			if (abortedDuringBackoff || waitSignal?.aborted) {
				wasAborted = true;
				break;
			}		}

		// Child close/error has ended the live process. Keep its handle explicitly finalizing
		// through verify + end reporting so the 30s watchdog cannot manufacture interruption.
		if (isBackground) markAgentFinalizing(pipiuiAgentId, runId);

		// Attested verify: runs AFTER the agent process exits and BEFORE the "end" report,
		// because Swift auto-merges and removes the worktree on "end". Skipped on abort
		// (user interrupted; don't block up to VERIFY_TIMEOUT_MS on a dead task).
		// A read-only role delivers a report, not a file: running a verify against it can
		// only ever fail, which used to burn the two-attempts budget on a re-dispatch that
		// was structurally incapable of passing. `verifyDropped` tells the boss why.
		const attestableVerify = agent.traits.readOnly ? undefined : options?.verify;
		if (agent.traits.readOnly && options?.verify && options.verify.trim()) {
			currentResult.verifyDropped = true;
		}
		if (attestableVerify && attestableVerify.trim() && !wasAborted) {
			currentResult.verify = await runVerifyCommand(attestableVerify.trim(), spawnCwd);
		} else if (attestableVerify && attestableVerify.trim()) {
			// Aborted: verify was in the brief but intentionally not run — record that
			// so the done message can say "skipped" instead of "no verify in brief".
			currentResult.verifySkipped = true;
		}
		const endOk = exitCode === 0 && !currentResult.errorMessage && !wasAborted;
		if (wasAborted) currentResult.stopReason = currentResult.stopReason ?? "aborted";
		// Notes appended after slice so they survive the -8000 tail trim on long outputs.
		let endOutput = (getFinalOutput(currentResult.messages) || currentResult.stderr || "").slice(-8000);
		let endResultText =
			getResultOutput(currentResult) || currentResult.stderr || getFinalOutput(currentResult.messages) || "(no output)";
		if (modelFallbackNotes.length > 0) {
			const note = modelFallbackNotes.join("");
			endOutput += note;
			endResultText += note;
		}
		if (endOk && autoResumeCount > 0) {
			const note = `\n[pipiui] auto-resumed ${autoResumeCount}× after retryable errors.`;
			endOutput += note;
			endResultText += note;
		} else if (
			!endOk &&
			!wasAborted &&
			(currentResult.usage.contextTokens || 0) >= AUTO_RESUME_CONTEXT_HINT_TOKENS
		) {
			const n = Math.round((currentResult.usage.contextTokens || 0) / 1000);
			const note = `\n[pipiui] 疑似上下文过大（~${n}k tokens）导致请求反复失败：建议 boss 以 fresh 重派该 agentId，缩小任务范围并要求小窗口读取。`;
			endOutput += note;
			endResultText += note;
			// Append only — never replace an existing terminal errorMessage.
			if (currentResult.errorMessage) currentResult.errorMessage += note;
		}
		// Terminal job state before bridge end/notify so a watchdog-only interruption is corrected
		// even while the bridge report is awaiting its bounded network timeout.
		const endState: JobState = wasAborted ? "aborted" : endOk ? "ok" : "failed";
		const terminalFinalized = jobFinalize(pipiuiAgentId, runId, {
			name: agentName,
			task,
			state: endState,
			resultText: endResultText,
			cost: currentResult.usage.cost,
			turns: currentResult.usage.turns,
			activity: pipiuiActivity,
			verify: currentResult.verify,
		});
		// Candidate evidence comes only from the final assistant text. It never
		// reads stream previews, tool results, stderr, or a non-terminal run.
		// A desktop-granted operator receives only host-projected Computer
		// candidates from settled open/batch paths. Do not turn its broad terminal
		// report into a second memory source that could contain UI prose.
		if (terminalFinalized && !wasAborted && !computerMemoryEnabled) {
			await submitBrokerTerminalCandidate(terminalMemoryBrokerEnvironment, {
				runID: runId,
				task,
				title: options?.title,
				terminalText: getFinalOutput(currentResult.messages),
				outcome: endOk ? "success" : "failure",
			});
		}
		await postTerminalPipiuiReport({
			kind: "end",
			agentId: pipiuiAgentId,
			runId,
			ok: endOk,
			aborted: wasAborted,
			output: endOutput,
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
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		if (isBackground) deleteRunningAgentHandle(pipiuiAgentId, runId);
		if (sessionDir) pruneAgentSessions(sessionDir, "completed");
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
	} finally {
		await awaitTerminalPipiuiReports(pipiuiAgentId);
		releaseAgentLease(agentLease);
		localAgentReservations.delete(pipiuiAgentId);
	}
}

const VERIFY_PARAM_DESCRIPTION =
	"Shell command run by the runtime in the agent's cwd after the agent process ends, before worktree merge/removal; exit code and tail output are attested into the done message. Boss must fill this for implementation tasks. Omit it for read-only agents — they deliver a report, not files, and the runtime drops any verify they are given.";

const AGENT_ID_DESCRIPTION =
	"Short semantic name for the worker, e.g. \"quota-pill\": 2-24 chars of lowercase letters, digits, \"-\" or \"_\". Re-dispatching the same agentId continues a writable worker with its previous conversation, worktree and branch — use it for one vertical slice (implement, verify, debug, fix, re-verify). Read-only roles are one-shot and do not create a worktree. Omit for one-off work and a name is generated. Also the target id for action=\"abort\" or action=\"resolve\".";
const FRESH_DESCRIPTION =
	"Discard this agentId's stored conversation and start it cold. Use when its context went wrong, not routinely.";
const DESKTOP_PARAM_DESCRIPTION =
	'Explicit per-task Computer Use authorization. Omitted by default — desktop tools are NEVER injected without it, even when the global toggle is on. Only two values exist: "user-requested" (the user explicitly asked to operate an external app, or named Chrome/Safari/another external browser / "my browser" — then you MUST use exactly that external browser via open_application + computer, never swap in the built-in browser) and "ui-verify" (this task built/changed an app and genuinely needs a visual UI acceptance check). Ordinary web research → built-in browser tool, not desktop. Waiting, polling logs, reading files, and build/test verification never use desktop. Do not grant for convenience; each task is authorized independently and never inherits another task\'s grant.';
const BLOCKED_BY_DESCRIPTION =
	'Optional dependency tags (task/agentId short names this task depends on), e.g. ["tldr-done-report"]; informational display only — does not delay or gate scheduling.';
const THINKING_PARAM_DESCRIPTION =
	"Optional per-task thinking for this dispatch only: off|minimal|low|medium|high|xhigh|max. It never inherits the Boss current thinking and does not select a model (v1 has no per-task model). It overrides the current candidate's configured thinking; if a fallback is needed, it carries only when the Swift capability catalog explicitly allows that fallback level, otherwise that fallback uses its configured thinking/default.";

/** Runtime shape check for blockedBy: array of strings, max 10, each ≤ 40 chars. */
function validateBlockedBy(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (!Array.isArray(value)) {
		return `Invalid blockedBy on ${label}: must be an array of strings (got ${typeof value}).`;
	}
	if (value.length > 10) {
		return `Invalid blockedBy on ${label}: at most 10 entries (got ${value.length}).`;
	}
	for (let i = 0; i < value.length; i++) {
		const entry = value[i];
		if (typeof entry !== "string") {
			return `Invalid blockedBy on ${label}: entry [${i}] must be a string (got ${typeof entry}).`;
		}
		if (entry.length > 40) {
			return `Invalid blockedBy on ${label}: entry [${i}] must be ≤ 40 characters (got ${entry.length}).`;
		}
	}
	return null;
}

const BlockedByParam = Type.Optional(
	Type.Array(Type.String({ maxLength: 40 }), {
		description: BLOCKED_BY_DESCRIPTION,
		maxItems: 10,
	}),
);
const ThinkingParam = Type.Optional(
	StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const, {
		description: THINKING_PARAM_DESCRIPTION,
	}),
);

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	title: Type.Optional(
		Type.String({
			description:
				"Short one-line title shown in the Subagents panel list instead of the full task; omit to fall back to task text",
		}),
	),
	blockedBy: BlockedByParam,
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
	thinking: ThinkingParam,
	agentId: Type.Optional(Type.String({ description: AGENT_ID_DESCRIPTION })),
	fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION })),
	desktop: Type.Optional(
		StringEnum(["user-requested", "ui-verify"] as const, {
			description: DESKTOP_PARAM_DESCRIPTION,
		}),
	),
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
	thinking: ThinkingParam,
	desktop: Type.Optional(
		StringEnum(["user-requested", "ui-verify"] as const, {
			description: DESKTOP_PARAM_DESCRIPTION,
		}),
	),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentSharedParams = {
	fresh: Type.Optional(Type.Boolean({ description: FRESH_DESCRIPTION })),
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	title: Type.Optional(
		Type.String({
			description:
				"Short one-line title shown in the Subagents panel list instead of the full task (single mode); omit to fall back to task text",
		}),
	),
	blockedBy: BlockedByParam,
	thinking: ThinkingParam,
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description:
				'Array of {agent, task, title?, blockedBy?, cwd?, verify?, thinking?} for parallel execution. Put each independent workflow in its own array element; NEVER merge independent goals into one brief.\nExample: [{"agent":"explore","task":"map auth"},{"agent":"explore","task":"map billing"}].\nAnti-pattern: one task brief listing A; B; C.',
		}),
	),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task, title?, cwd?, verify?, thinking?} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	verify: Type.Optional(Type.String({ description: VERIFY_PARAM_DESCRIPTION })),
	desktop: Type.Optional(
		StringEnum(["user-requested", "ui-verify"] as const, {
			description: DESKTOP_PARAM_DESCRIPTION,
		}),
	),
	background: Type.Optional(
		Type.Boolean({
			description:
				"If true, return immediately after starting agents; completion is delivered later as a follow-up message. Default: true at boss depth (0), false for nested agents or chain mode.",
		}),
	),
};

// Keep the root object shape for existing Pi/tool introspection, while JSON Schema's conditional
// branch makes runId and agentId required exactly when action=resolve.
const SubagentParams = Type.Object({
	action: Type.Optional(
		StringEnum(["abort", "resolve"] as const, {
			description:
				'Optional action instead of dispatching. "abort": terminate a running background job (requires agentId); "resolve": mark one terminal failed/aborted/interrupted episode handled (requires agentId and runId).',
		}),
	),
	agentId: Type.Optional(Type.String({ description: AGENT_ID_DESCRIPTION })),
	runId: Type.Optional(Type.String({
		minLength: 1,
		description: "Exact runId for action=resolve; stale runIds are rejected with currentRunId.",
	})),
	reason: Type.Optional(Type.String({ maxLength: 500, description: "Optional handled/superseded reason shown in closeout status." })),
	...SubagentSharedParams,
}, {
	allOf: [
		{
			if: {
				properties: { action: { const: "resolve" } },
				required: ["action"],
			},
			then: { required: ["agentId", "runId"] },
		},
	],
});

const SecretaryCommitParams = Type.Object({
	closeout: StringEnum(["pass", "needs-action", "blocked"] as const),
	integrationVerify: StringEnum(["pass", "fail", "none"] as const),
	commitMessage: Type.String({
		description: "Safe, non-empty one-line Git commit message (maximum 200 characters).",
	}),
	paths: Type.Array(
		Type.String({
			description:
				"Exact accepted repository-relative path. Absolute, traversal, .git, and .pi paths are denied.",
		}),
	),
	allRelevantItemsClassified: Type.Boolean({
		description: "Must be true only after every relevant closeout item has a final disposition.",
	}),
	dispositions: Type.Array(
		Type.Object({
			item: Type.String(),
			disposition: StringEnum(
				["cleaned", "retained", "unclassified", "needs-fixer", "needs-user"] as const,
			),
			reason: Type.Optional(Type.String()),
		}),
	),
});

export default function (pi: ExtensionAPI) {
	// 主会话上下文压缩走有界快路径（thinking off 的 LLM 摘要 → 确定性摘要 → pi 内置兜底）。
	// 见 main-compaction.ts：不覆盖 worker（PIPIUI_AGENT_DEPTH 守卫）。
	registerMainSessionCompactionHook(pi);
	// Qoder CN / Qwen 3.8-Max-Preview contextWindow 修复：按 API default tier
	// 归一化 model.contextWindow（真实影响 pi shouldCompact/session stats），
	// 并用 vendored stream 保持请求 model_config 的 API 默认档。
	registerQoderContextWindowCompat(pi);
	pi.on("session_start", (_event, ctx) => {
		const piSessionId = ctx.sessionManager.getSessionId().trim();
		initializeDoneDeliveryStore(pi, piSessionId);
	});
	// Do not add another session_before_compact handler: Pi resolves that hook
	// last-wins. The existing main-compaction hook remains its only owner; these
	// post-compaction/settled notifications merely unblock pending done delivery.
	pi.on("session_compact", () => {
		retryPendingDoneAfterSessionSettled(pi);
	});
	pi.on("agent_settled", () => {
		retryPendingDoneAfterSessionSettled(pi);
	});
	registerSessionRecallTool(pi);
	// UI-independent definition management. It only reads/scaffolds/installs
	// agent packages and never enters the dispatch, desktop, or grant paths.
	registerSubagentManagementTool(pi);
	// Cut-in hold 提前释放：真实用户消息（本地/远程，非扩展自己的 followUp）已进入
	// turn，说明 cut-in prompt 抢到了先手，暂缓的自动信号可以按原逻辑继续投递。
	pi.on("input", (event) => {
		if (event.source !== "extension") releaseCutInHold();
	});
	if (PIPIUI_SUBAGENT_SKILL_ISOLATION) {
		// Pi still accepts extension-contributed skillPaths under --no-skills. Remove the
		// generated model-visible skill catalog and make this child extension the sole
		// authority for the dispatched-subagent isolation instruction.
		pi.on("before_agent_start", (event) => {
			const systemPrompt = stripPiSkillsFromSystemPrompt(event.systemPrompt).trimEnd();
			const isolation = PIPIUI_SKILL_READ_BLOCK
				? `${SUBAGENT_SKILL_ISOLATION}\n${PLAN_SUBAGENT_ARTIFACT_BAN}`
				: SUBAGENT_SKILL_ISOLATION;
			return {
				systemPrompt: `${systemPrompt}\n\n${isolation}`,
			};
		});


		// The PipiUI extension is supplied explicitly with -e and loads before global
		// extensions. Superpowers sees this marker in its later context handler and uses
		// its own messageContainsBootstrap guard instead of injecting using-superpowers.
		pi.on("context", (event) => {
			if (messagesContainSuperpowersMarker(event.messages)) return;

			const taskIndex = event.messages.findIndex(
				(message) => (message as { role?: unknown }).role === "user",
			);
			if (taskIndex < 0) return;

			const messages = [...event.messages];
			const taskMessage = messages[taskIndex] as { content?: unknown };
			if (typeof taskMessage.content === "string") {
				messages[taskIndex] = {
					...messages[taskIndex],
					content: `${taskMessage.content}\n\n${SUBAGENT_BOOTSTRAP_SUPPRESSION_NOTE}`,
				};
			} else if (Array.isArray(taskMessage.content)) {
				messages[taskIndex] = {
					...messages[taskIndex],
					content: [
						...taskMessage.content,
						{ type: "text", text: SUBAGENT_BOOTSTRAP_SUPPRESSION_NOTE },
					],
				};
			} else {
				return;
			}
			return { messages };
		});

		// Even if another extension registers skill paths, a read-only planner cannot load
		// the discovered instructions through Pi's read tool. Deliberately not applied to
		// implementers: their own repository may legitimately contain a skills/ directory.
		if (PIPIUI_SKILL_READ_BLOCK) {
			pi.on("tool_call", (event) => {
				if (event.toolName !== "read") return;
				const input = event.input as { path?: unknown; file_path?: unknown };
				const requestedPath = input.path ?? input.file_path;
				if (!isSkillReadPath(requestedPath)) return;
				return {
					block: true,
					reason: "Plan subagents cannot load SKILL.md files or files under a skills directory.",
				};
			});
		}
	} else {
		// Main session: the same sentinel makes the skill library opt-in. Skills stay
		// discoverable for an explicit user request; what is suppressed is the injected
		// "invoke a skill before any response" bootstrap, which otherwise competes with
		// the session's own protocol and pulls trivial work into a heavyweight SOP.
		pi.on("context", (event) => {
			if (messagesContainSuperpowersMarker(event.messages)) return;
			let insertAt = 0;
			while ((event.messages[insertAt] as { role?: unknown } | undefined)?.role === "compactionSummary") {
				insertAt += 1;
			}
			return {
				messages: [
					...event.messages.slice(0, insertAt),
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: MAIN_BOOTSTRAP_SUPPRESSION_NOTE }],
						timestamp: MAIN_SUPPRESSION_TIMESTAMP,
					},
					...event.messages.slice(insertAt),
				],
			};
		});
	}

	// Boss-only, hot-read routing reference plus the live in-flight reminder. The same dynamic
	// prompt tells Boss exactly which agent chain / settings / allowed levels it can select before
	// a dispatch, while workers stay free of parent orchestration context.
	pi.on("before_agent_start", (event) => {
		const routing = formatSubagentModelRoutingBlock();
		const inflight = formatInFlightWorkersBlock(Date.now());
		const blocks = [routing, inflight].filter((block): block is string => Boolean(block));
		if (blocks.length === 0) return;
		return { systemPrompt: `${event.systemPrompt.trimEnd()}\n\n${blocks.join("\n\n")}` };
	});

	// Prompt text is not a security boundary. The runtime-owned closeout secretary
	// may write only its state records and may not perform destructive cleanup.
	pi.on("tool_call", (event) => {
		return secretaryToolCallBlock(
			PIPIUI_AGENT_ROLE,
			{ toolName: event.toolName, input: event.input },
			PIPIUI_MAIN_CWD,
		);
	});

	pi.registerTool({
		name: "secretary_commit",
		label: "Secretary Commit",
		description: [
			"Runtime-owned final commit gate for the closeout secretary.",
			"Requires closeout=pass, integrationVerify=pass, a final structured disposition set, an empty pre-existing index, and an exact accepted-path manifest.",
			"Stages and commits only that manifest; raw git add/commit remains forbidden in bash.",
			"Returns commit=created:<sha>, already-clean:<sha>, or blocked:<reason>, plus committed and remaining dirty paths.",
		].join(" "),
		parameters: SecretaryCommitParams,
		async execute(_toolCallId, params) {
			const result = runSecretaryCommit(params, {
				processRole: PIPIUI_AGENT_ROLE,
				mainCwd: PIPIUI_MAIN_CWD,
			});
			return {
				content: [{ type: "text", text: formatSecretaryCommitResult(result) }],
				details: result,
			};
		},
	});

	// ---- 统一轮询（30s）：承载四条按节奏补推的路径 ——
	// 1) done 重投：sendUserMessage 的 promise 未确认（reject 或未 settle）的 [subagent-done]，
	//    同一 obligation 至少隔 60s 重投一次，直到确认。job 已 terminal，重投只依赖持久化 text。
	// 2) vanished 即时检测：pid 已死但没人报告 → 立刻推（不等 5min 心跳），推一次后从 runningAgents 删除。
	// 3) stall 复推：idle ≥ 120s 即推 [subagent-stalled]，同一无活动片段最多首次 + 两次复推，
	//    每次仍至少间隔 5 分钟；有新活动后 noteAgentActivity 复位计数和时间戳，重新武装。
	// 4) interrupted/aborted/failed + stored context：idle ≥ NUDGE_SECS 推 [subagent-interrupted-reminder]，
	//    再于 RENUDGE_SECS 复推一次后沉默；同 agentId 再 dispatch 为 running 时字段被清零。
	// 复用 [subagent-done] 的 followUp 通道。无 PIPIUI_* 环境变量时桥接上报自动静默（pipiuiReport no-op）。
	const STALL_WATCHDOG_KEY = "__pipiuiSubagentStallWatchdog";
	const g = globalThis as Record<string, unknown>;
	const prevWatchdog = g[STALL_WATCHDOG_KEY] as ReturnType<typeof setInterval> | undefined;
	if (prevWatchdog) clearInterval(prevWatchdog); // 防扩展 reload 后旧定时器泄漏
	const stallWatchdog = setInterval(() => {
		const now = Date.now();

		// (1) done 重投
		for (const [obligationId, entry] of [...pendingDone]) {
			if (entry.obligation.state === "delivered") { pendingDone.delete(obligationId); continue; }
			if (now - entry.obligation.lastAttemptAt < DONE_RETRY_MIN_INTERVAL_MS) continue;
			sendDoneWithConfirmation(pi, entry, true);
		}

		// (2) vanished 即时检测（isProcessAlive 只是 signal 0，很便宜）。先于 stall 扫描：
		// 死掉的进程不该再收到 stall 推送。必须 jobFinalize + pipiuiReport(end) 再 delete，
		// 否则 jobRegistry/Swift 面板会永远停在 running（半结算）。
		for (const [agentId, handle] of [...runningAgents]) {
			if (!isHandleVanished(handle, now)) continue;
			const title =
				handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 60) || "(untitled)";
			const elapsed = formatElapsedMs(now - handle.startedAt);
			const reason =
				handle.pid === undefined
					? `process never attached a pid after ${elapsed}; treated as interrupted (vanished)`
					: `process gone after ${elapsed}, no result reported`;
			if (!markWorkerInterrupted(agentId, reason)) continue;
			deliverSubagentDone(
				pi,
				[
					`[subagent-heartbeat] outstanding=${runningAgents.size} vanished=1 stalled=0`,
					`  ${agentId} (${title}) — ${reason}, state=interrupted`,
					"A vanished worker was interrupted, not failed: its stored conversation is intact, so re-dispatch that same agentId to continue where it left off.",
				].join("\n"),
			);
		}

		// (3) stall 推送 / 复推
		for (const [agentId, handle] of runningAgents) {
			if (handle.finalizing) continue;
			const idleMs = now - handle.lastActivityAt;
			if (idleMs < STALL_THRESHOLD_MS) continue;
			// 同一无活动片段最多推 STALL_RENOTIFY_MAX 次；每次仍至少间隔 5 分钟。
			if (!claimStallNotification(handle, now)) continue;
			const idleSec = Math.floor(idleMs / 1000);
			const job = jobRegistry.get(agentId);
			const title =
				handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 80) || "(untitled)";
			const activityRaw = job?.activity?.trim() || "";
			const lastLine = (activityRaw.split("\n").pop() ?? "").trim().slice(0, 120) || "(no activity)";
			deliverSubagentDone(
				pi,
				// Handling rides with the event rather than sitting in the cached prefix all
				// session waiting for a stall that may never happen — and it is more likely to
				// be followed here, next to the thing it is about.
				[
					`[subagent-stalled] agentId=${agentId} title=${title} idle=${idleSec}s last=${lastLine}`,
					`Query it first with subagent_status({agentId:"${agentId}"}), then choose exactly one: keep waiting (say why) / abort and re-dispatch by a materially different route / abort and ask the user. An aborted agent still reports [subagent-done], and a re-dispatch after an abort still counts toward the two-attempts-per-approach cap. Do not treat this message as a new user request.`,
					`If work is already complete from your perspective, do not keep waiting or reply "already completed": first call subagent_status({agentId:"${agentId}"}). If it is still running, close it with action:"abort" (or /subagent_abort) so this recurring message stops; if it is terminal (failed/aborted/interrupted), resolve it with action:"resolve" + runId (or /subagent_resolve). A text-only reply does not stop this message.`,
				].join("\n"),
			);
			pipiuiReport({
				kind: "stalled",
				agentId,
				runId: handle.runId,
				stalled: true,
				idle: idleSec,
				activity: lastLine,
			});
		}

		// (4) interrupted/aborted/failed + intact stored context → reserve a run-scoped reminder,
		// then revalidate it around the cut-in wait before any follow-up can enter the boss turn.
		const resumableIds = new Set(resumableAgentIds());
		for (const reminder of scheduleInterruptedReminders(now, resumableIds)) {
			void deliverInterruptedReminder(pi, reminder);
		}
	}, STALL_WATCHDOG_INTERVAL_MS);
	stallWatchdog.unref?.();
	g[STALL_WATCHDOG_KEY] = stallWatchdog;

	// Heartbeat. Background dispatch ends the boss's turn, so from then on the session only
	// moves again when something pushes it. Every push so far fires at most once per worker:
	// [subagent-done] on exit, [subagent-stalled] once per idle episode. If any of those is
	// missed — the close handler never ran, the extension reloaded mid-flight, delivery failed
	// — nothing ever wakes the boss and it waits forever on work that is already over.
	//
	// Codex avoids this by making the wait itself bounded: `wait_agent` takes a timeout and
	// returns an empty status when it expires, so control always comes back. We cannot bound a
	// wait the boss never issued, so we bound the silence instead: while anything is
	// outstanding, the boss hears from us at least this often, whatever else did or did not
	// happen.
	const HEARTBEAT_KEY = "__pipiuiSubagentHeartbeat";
	const prevHeartbeat = g[HEARTBEAT_KEY] as ReturnType<typeof setInterval> | undefined;
	if (prevHeartbeat) clearInterval(prevHeartbeat);
	const heartbeat = setInterval(() => {
		if (runningAgents.size === 0) return; // nothing outstanding: stay quiet
		const now = Date.now();
		const alive: string[] = [];
		const vanished: string[] = [];
		let stalled = 0;
		for (const [agentId, handle] of [...runningAgents]) {
			const title =
				handle.title?.trim() || (handle.task.split("\n")[0] ?? "").trim().slice(0, 60) || "(untitled)";
			const elapsed = formatElapsedMs(now - handle.startedAt);
			const idle = Math.floor((now - handle.lastActivityAt) / 1000);
			if (isHandleVanished(handle, now)) {
				// Process gone (or never attached) without a close report — full settle once.
				const reason =
					handle.pid === undefined
						? `process never attached a pid after ${elapsed}; treated as interrupted (vanished)`
						: `process gone after ${elapsed}, no result reported`;
				if (markWorkerInterrupted(agentId, reason)) {
					vanished.push(`  ${agentId} (${title}) — ${reason}, state=interrupted`);
				}
				continue;
			}
			const state = formatHeartbeatWorkerState(agentId, handle, now);
			if (state === "running(stalled)") stalled++;
			alive.push(`  ${agentId} (${title}) — running ${elapsed}, idle ${idle}s, state=${state}`);
		}
		if (alive.length === 0 && vanished.length === 0) return;
		const lines = [
			`[subagent-heartbeat] outstanding=${alive.length} vanished=${vanished.length} stalled=${stalled}`,
			...alive,
			...vanished,
		];
		if (vanished.length > 0) {
			lines.push(
				"A vanished worker was interrupted, not failed: its stored conversation is intact, so re-dispatch that same agentId to continue where it left off.",
			);
		}
		lines.push(
			"Silence is not progress: it means one of still thinking, died without reporting, or its report was lost. Decide which and act — keep waiting (say why), pull one report with subagent_status, or recover a vanished worker. Do not re-dispatch a worker that is still running; that puts two agents in the same files.",
			"If a related worker's work is already complete, close the loop instead of replying \"already completed\": abort a still-running job with action:\"abort\" (or /subagent_abort), or resolve a terminal failed/aborted/interrupted episode with action:\"resolve\" + runId (or /subagent_resolve). A text-only reply does not stop these messages.",
		);
		deliverSubagentDone(pi, lines.join("\n"));
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref?.();
	g[HEARTBEAT_KEY] = heartbeat;
	// 进程退出时清理定时器（unref 已保证不拖住退出；这里是显式清理）。
	process.on("exit", () => {
		clearInterval(stallWatchdog);
		if (g[STALL_WATCHDOG_KEY] === stallWatchdog) delete g[STALL_WATCHDOG_KEY];
	});

	// ---- RPC commands: GUI uses these same Node control paths instead of mutating Swift-only state. ----
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

	pi.registerCommand("subagent_resolve", {
		description: "Mark one failed/aborted/interrupted subagent episode handled: /subagent_resolve <agentId> <runId> [reason] (PipiUI)",
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const agentId = parts.shift();
			const runId = parts.shift();
			if (!agentId || !runId) {
				ctx.ui.notify("Usage: /subagent_resolve <agentId> <runId> [reason]", "error");
				return;
			}
			const result = resolveSubagentEpisode(agentId, runId, parts.join(" ") || undefined);
			if (result.ok && result.job) void reportResolvedCloseout(result.job);
			ctx.ui.notify(result.message, result.ok ? "info" : "error");
		},
	});

	// Runtime-owned recovery path. It deliberately reuses the original id: that makes
	// resolveSubagentWorktree reuse its branch/path and runSingleAgent reuse its session.
	// The cross-process lease plus running registry make duplicate bridge/restart commands no-ops.
	pi.registerCommand("subagent_recover", {
		description: "Internal: resume one failed worktree integration (PipiUI)",
		handler: async (args, ctx) => {
			const [agentId = "", requestedName = "", freshFlag = "0", verifyBase64 = ""] = (args ?? "").trim().split(/\s+/, 4);
			if (!agentId || validateAgentId(agentId)) return;
			if (jobRegistry.get(agentId)?.state === "running") return;
			const previous = jobRegistry.get(agentId);
			const discovery = discoverAgents(ctx.cwd, "both");
			const agentName = previous?.name ?? requestedName;
			if (!agentName || !discovery.agents.some((agent) => agent.name === agentName)) return;
			const fresh = freshFlag === "1";
			let persistedVerify: string | undefined;
			try {
				const decoded = Buffer.from(verifyBase64, "base64").toString("utf8").trim();
				persistedVerify = decoded || undefined;
			} catch {
				persistedVerify = undefined;
			}
			const task = [
				"Runtime recovery for the worktree integration failure. Continue the existing task in the existing worktree.",
				"Integrate the current main HEAD, resolve any committed-tree conflict, run the original verification, then finish normally.",
				"Do not ask the user for Git operations and do not use stash, reset, or clean.",
			].join(" ");
			void runSingleAgent(ctx.cwd, discovery.agents, agentName, task, undefined, undefined, undefined, undefined,
				(results) => ({ mode: "single", agentScope: "both", projectAgentsDir: discovery.projectAgentsDir, results }),
				{ agentId, background: true, fresh, title: previous?.title, verify: persistedVerify ?? previous?.verify?.command });
		},
	});

	pi.registerTool({
		name: "subagent_status",
		label: "Subagent Status",
		description: [
			"Query subagent job status (running / ok / failed / aborted / interrupted), including the exact runId required to resolve an old failed episode safely.",
			"An interrupted worker is not a failed one: re-dispatch its agentId to continue where it left off instead of starting someone cold.",
			"Use on every [subagent-done] event before any user-facing conclusion: inspect all jobs, keep user-facing progress and summaries silent while related work remains running or stalled, and close out only after the whole related goal is terminal.",
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
			"Optional thinking is accepted per single/task/chain step; it applies only to that dispatch, never inherits Boss thinking, and v1 intentionally has no per-task model. The dynamic system prompt shows each agent's configured model/fallback chain and allowed levels.",
			"At boss depth 0, single/parallel default to background=true: tool returns immediately with agentIds; each agent completion arrives later as a user message prefixed [subagent-done].",
			"While the fan-out philosophy layer is active, background=false is ignored at boss depth — asynchronous dispatch is that layer's premise, not a preference. Use chain for genuinely ordered synchronous steps.",
			"By default writable workers run in an isolated git worktree under .pi/worktrees/ on a pipiui/<agentId> branch; read-only roles run directly in the caller cwd and never create a worktree. Pass explicit cwd or set PIPIUI_WORKTREE=0 to disable worktree isolation. The runtime-owned secretary role is also an exception: it always runs in PIPIUI_MAIN_CWD with recursive delegation disabled and never creates a worktree. On successful writable-worker end the app auto-merges into the main project, removes the worktree, and safely deletes only a merged internal branch with git branch -d. If merge or cleanup fails, the main session retains actionable state; failed/aborted keeps worktree for resume (GUI merge/discard fallback).",
			"Track jobs with subagent_status(agentId?). Never re-spawn a finished task without reading its result via [subagent-done] or subagent_status.",
			"Optional blockedBy on single/parallel tasks records dependency tags for status and ledger display only (no scheduler gating).",
			'Abort a running background job with action:"abort" + agentId (equivalent to /subagent_abort); it ends as aborted and still reports [subagent-done].',
			'Resolve a terminal failed/aborted/interrupted episode with action:"resolve" + agentId + runId (from [subagent-done] or subagent_status). Resolve keeps the real state/verified attestation unchanged, marks closeout cleaned, and suppresses that run\'s interrupted reminders; stale runIds are rejected.',
			"Background jobs with no output for 120s are pushed as [subagent-stalled] and marked stalled (with idle seconds) in subagent_status.",
			"Do not busy-loop poll; one status check per decision is correct.",
			"chain and nested (depth>0) are always synchronous. Background dispatches automatically wake you with a [subagent-done] signal; continue other work rather than waiting or polling.",
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
			const makeDetails =
				(mode: "single" | "parallel" | "chain", extra?: { background?: boolean; agentIds?: string[] }) =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
					...(extra?.background ? { background: true } : {}),
					...(extra?.agentIds ? { agentIds: extra.agentIds } : {}),
					...(discovery.diagnostics.length > 0
						? { agentDiagnostics: discovery.diagnostics.map((entry) => `[${entry.severity}] ${entry.message}`) }
						: {}),
				});

			const requestAgentIds = new Set<string>();
			// Default background at boss depth for single/parallel; chain and nested always sync.
			// While the fan-out layer is on, background is not the caller's to switch off: a boss
			// that blocks on every dispatch is running a fake fan-out, and the guard has to be
			// here rather than in the prompt — models do pass background:false regardless of what
			// the system prompt says.
			const forcedBackground = PIPIUI_DEPTH === 0 && !isChain && fanoutLayerActive();
			const wantBg = forcedBackground || (params.background ?? (PIPIUI_DEPTH === 0 && !isChain));
			const useBackground = Boolean(wantBg && !isChain && PIPIUI_DEPTH === 0);
			const bgIgnoredWarning =
				params.background === true && (PIPIUI_DEPTH > 0 || isChain)
					? "Warning: background:true ignored (nested depth>0 or chain mode always runs synchronously).\n\n"
					: params.background === false && forcedBackground
						? "Warning: background:false ignored — the fan-out philosophy layer is active, and it requires dispatch to stay asynchronous. Do not wait here: keep dispatching independent work, then read [subagent-done]. Use chain if you genuinely need ordered synchronous steps, or turn off the 瀑布流 layer in Settings.\n\n"
						: "";

			// action=resolve: close one exact old terminal episode without changing state/verify.
			if (params.action === "resolve") {
				const target = params.agentId?.trim();
				const runId = params.runId?.trim();
				if (!target || !runId) {
					return {
						content: [
							{ type: "text", text: 'action="resolve" requires both agentId and runId.' },
						],
						details: makeDetails("single")([]),
						isError: true,
					};
				}
				const resolveResult = resolveSubagentEpisode(target, runId, params.reason);
				if (resolveResult.ok && resolveResult.job) void reportResolvedCloseout(resolveResult.job);
				return {
					content: [{ type: "text", text: resolveResult.message }],
					details: makeDetails("single")([]),
					isError: !resolveResult.ok,
				};
			}

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
				thinking: string | undefined,
				fresh?: boolean,
				desktop?: "user-requested" | "ui-verify",
				blockedBy?: string[],
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
					{ background: true, agentId, title, sessionModel, verify, thinking, fresh, desktop, blockedBy },
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

			// blockedBy is display-only dependency metadata; reject malformed values early.
			if (hasSingle) {
				const blockedByErr = validateBlockedBy(params.blockedBy, "single");
				if (blockedByErr) {
					return {
						content: [{ type: "text", text: blockedByErr }],
						details: makeDetails("single")([]),
						isError: true,
					};
				}
			}
			if (hasTasks && params.tasks) {
				for (let i = 0; i < params.tasks.length; i++) {
					const blockedByErr = validateBlockedBy(params.tasks[i].blockedBy, `tasks[${i}]`);
					if (blockedByErr) {
						return {
							content: [{ type: "text", text: blockedByErr }],
							details: makeDetails("parallel")([]),
							isError: true,
						};
					}
				}
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

			const dispatchStatsTasks = hasChain
				? params.chain!
				: hasTasks
					? params.tasks!
					: [{ agent: params.agent!, task: params.task!, title: params.title }];
			const dispatchMode: DispatchStatsMode = hasChain ? "chain" : hasTasks ? "tasks" : "single";

			// Shape validator: single / tasks[] only. chain and same-agentId resume are exempt.
			let dispatchNudgePrefix = "";
			let dispatchValidatorStats: DispatchValidatorStats | null = null;
			if (!hasChain) {
				const shapeTasks = hasTasks
					? (params.tasks ?? []).map((t) => ({
							task: t.task,
							agentId: t.agentId,
							fresh: t.fresh,
							title: t.title,
						}))
					: [
							{
								task: params.task!,
								agentId: params.agentId,
								fresh: params.fresh,
								title: params.title,
							},
						];
				const assessment = assessDispatchShape({
					mode: hasTasks ? "tasks" : "single",
					tasks: shapeTasks,
				});
				dispatchValidatorStats = assessment.stats;
				if (assessment.enforceError) {
					recordSubagentDispatchStats(
						dispatchMode,
						dispatchStatsTasks,
						useBackground,
						dispatchValidatorStats,
					);
					return {
						content: [{ type: "text", text: assessment.enforceError }],
						details: makeDetails(hasTasks ? "parallel" : "single")([]),
						isError: true,
					};
				}
					dispatchNudgePrefix = assessment.nudgeText;
				}

			if (hasTasks && (params.tasks?.length ?? 0) > MAX_PARALLEL_TASKS) {
				return {
					content: [{ type: "text", text: `Too many parallel tasks (${params.tasks!.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
					details: makeDetails("parallel")([]),
					isError: true,
				};
			}
			const requestedNames = hasChain
				? (params.chain ?? []).map((step) => step.agent)
				: hasTasks
					? (params.tasks ?? []).map((task) => task.agent)
					: [params.agent!];
			const unknownNames = [...new Set(requestedNames.filter((name) => !agents.some((agent) => agent.name === name)))];
			if (unknownNames.length > 0) {
				const available = agents.map((agent) => `"${agent.name}"`).join(", ") || "none";
				const packageDiagnostics = discovery.diagnostics.length > 0
					? `\n\nAgent package diagnostics:\n${formatAgentDiagnostics(discovery.diagnostics)}`
					: "";
				return {
					content: [{ type: "text", text: `Unknown agent(s): ${unknownNames.map((name) => `"${name}"`).join(", ")}. Available agents: ${available}.${packageDiagnostics}` }],
					details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
					isError: true,
				};
			}

			// This is deliberately after the final await/validation and immediately before
			// dispatch. Add to the module reservation set synchronously so a concurrent tool call
			// cannot pass the same selector during any later async setup.
			const activeAgentIds = new Set<string>([
				...localAgentReservations,
				...runningAgents.keys(),
				...[...jobRegistry.values()]
					.filter((job) => job.state === "running")
					.map((job) => job.agentId),
			]);
			const callerSelection = selectAndReserveCallerAgentIds(
				hasTasks
					? (params.tasks ?? []).map((task) => task.agentId)
					: hasSingle
						? [params.agentId]
						: [],
				activeAgentIds,
				localAgentReservations,
			);
			if (callerSelection.problem) {
				return {
					content: [{ type: "text", text: callerSelection.problem }],
					details: makeDetails(isChain ? "chain" : hasTasks ? "parallel" : "single")([]),
					isError: true,
				};
			}
			for (const id of callerSelection.ids) {
				requestAgentIds.add(id);
			}

			recordSubagentDispatchStats(
				dispatchMode,
				dispatchStatsTasks,
				useBackground,
				dispatchValidatorStats,
			);

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

						{
							title: step.title,
							sessionModel,
							verify: step.verify,
							thinking: step.thinking,
							agentId: generatePipiuiAgentId(requestAgentIds),
							desktop: step.desktop,
						},
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
					doneCapForResult(lastChainResult, false),
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
						const agentId = t.agentId?.trim() || generatePipiuiAgentId(requestAgentIds);
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

					// Fire-and-forget with the same concurrency cap. Per-item notification is the
					// finalization boundary, so completed full results are not retained until the
					// slowest sibling settles.
					void forEachWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
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
								{ background: true, agentId, title: t.title, sessionModel, verify: t.verify, thinking: t.thinking, fresh: t.fresh, desktop: t.desktop, blockedBy: t.blockedBy },
							);
							notifySubagentDone(pi, result);
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
						}
					}).catch((err) => {
						console.error("[pipiui-subagent] background parallel runner error:", err);
					});

					return {
						content: [
							{ type: "text", text: dispatchNudgePrefix + formatStartedMessage(startedItems) },
						],
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

						{
							title: t.title,
							sessionModel,
							verify: t.verify,
							thinking: t.thinking,
							agentId: t.agentId?.trim() || generatePipiuiAgentId(requestAgentIds),
							fresh: t.fresh,
							desktop: t.desktop,
							blockedBy: t.blockedBy,
						},
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
								dispatchNudgePrefix +
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
					const agentId = params.agentId?.trim() || generatePipiuiAgentId(requestAgentIds);
					startBackgroundAgent(params.agent, params.task, params.cwd, agentId, "single", params.title, params.verify, params.thinking, params.fresh, params.desktop, params.blockedBy);
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
								text:
									dispatchNudgePrefix +
									formatStartedMessage([
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

					{
						title: params.title,
						sessionModel,
						verify: params.verify,
						thinking: params.thinking,
						agentId: params.agentId?.trim() || generatePipiuiAgentId(requestAgentIds),
						fresh: params.fresh,
						desktop: params.desktop,
						blockedBy: params.blockedBy,
					},
				);
				const isError = isFailedResult(result);
				if (isError) {
					const errorMsg = getResultOutput(result);
					return {
						content: [
							{
								type: "text",
								text: `${dispatchNudgePrefix}${bgIgnoredWarning}Agent ${result.stopReason || "failed"}: ${errorMsg}`,
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
								dispatchNudgePrefix +
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
			if (args.action === "resolve") {
				return new Text(
					theme.fg("toolTitle", theme.bold("subagent ")) +
						theme.fg("success", "resolve ") +
						theme.fg("accent", args.agentId || "?") +
						theme.fg("muted", ` ${args.runId || "?"}`),
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
