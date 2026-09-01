import type { AgentConfig } from "./agents.ts";
import { sanitizeProgressLogInput } from "./progress-log.ts";
import type { LivenessVerdict } from "./worker-liveness.ts";

/** Runtime-only grants that frontmatter is never allowed to manufacture. */
export interface AgentRuntimeRolePolicy {
	role: "worker" | "closeout-secretary";
	/** `main-session` is reserved; `direct` merely honors the caller/default cwd. */
	worktree: "isolated" | "direct" | "main-session";
	allowRecursiveDelegation: boolean;
}

/** Depth-1 workers may dispatch only these types. Depth 0 (Boss) is unrestricted. */
export const NESTED_DELEGATION_ALLOWED_TYPES = ["explore", "general-purpose"] as const;

/** Boss depth 0 plus worker depths 1 and 2: at most three agent-tree layers. */
export const ABSOLUTE_MAX_SUBAGENT_DEPTH = 2;

export function resolveSubagentMaxDepth(raw: string | undefined): number {
	const requested = raw === undefined || raw.trim() === ""
		? ABSOLUTE_MAX_SUBAGENT_DEPTH
		: Number(raw);
	if (!Number.isInteger(requested)) return ABSOLUTE_MAX_SUBAGENT_DEPTH;
	return Math.max(0, Math.min(requested, ABSOLUTE_MAX_SUBAGENT_DEPTH));
}

export function resolveEffectiveSubagentDepth(
	reportedRaw: string | undefined,
	inheritedRaw: string | undefined,
): number {
	const normalize = (raw: string | undefined): number => {
		const value = Number(raw ?? 0);
		if (!Number.isInteger(value)) return 0;
		return Math.max(0, Math.min(value, ABSOLUTE_MAX_SUBAGENT_DEPTH));
	};
	return Math.max(normalize(reportedRaw), normalize(inheritedRaw));
}

/** Capability may declare delegation; children at/above the max depth still lose the tools. */
export function childReceivesDelegationTools(input: {
	allowRecursiveDelegation: boolean;
	childDepth: number;
	maxDepth: number;
}): boolean {
	return input.allowRecursiveDelegation && input.childDepth < input.maxDepth;
}

/** Execution-time hard cap. Same wording the `subagent` tool returns to the model. */
export function rejectDispatchAtDepth(input: { depth: number; maxDepth: number }): string | null {
	if (input.depth < input.maxDepth) return null;
	return `Subagent depth limit reached (depth ${input.depth}, max ${input.maxDepth}). Do the work yourself with your available tools instead of delegating.`;
}

export function isNestedDelegationAllowedType(name: string): boolean {
	return (NESTED_DELEGATION_ALLOWED_TYPES as readonly string[]).includes(name);
}

/** Reject disallowed `subagent_type` values when the caller is already nested. Not remapped. */
export function rejectNestedDelegationTypes(input: {
	callerDepth: number;
	agentNames: readonly string[];
}): string | null {
	if (input.callerDepth < 1) return null;
	for (const name of input.agentNames) {
		if (isNestedDelegationAllowedType(name)) continue;
		return `Nested dispatch at depth ${input.callerDepth} may only use subagent_type "explore" or "general-purpose"; "${name}" is not allowed.`;
	}
	return null;
}

export interface GeneralPurposeExecutionOverrides {
	worktree?: "isolated" | "none";
	noWorktreeReason?: string;
	heartbeatSecs?: number;
	timeoutSecs?: number;
	progressLog?: string;
}

export interface GeneralPurposeExecutionPolicy {
	worktree: "isolated" | "none";
	noWorktreeReason?: string;
	heartbeatMs?: number;
	timeoutMs?: number;
	progressLog?: string;
}

/** Default GP budget: producing workers extend silently; a stalled one can be aborted. */
export const DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS = 600_000;

/** Stall cap for repeated inspect-only turns: same targets, no writes/validation. Novel recon does not count. */
export const GENERAL_PURPOSE_SEMANTIC_TURN_CAP = 12;

/** Bounded ring of recent inspect-call signatures used to tell spinning from advancing recon. */
const INSPECT_SIGNATURE_RING_SIZE = 24;

export interface SemanticProgressState {
	completedTurns: number;
	inspectOnlyStreak: number;
	progressEvents: number;
	pendingToolIds: string[];
	pendingAnonymousTools: string[];
	recentInspectSignatures: string[];
	lastSummary: string;
}

export type SemanticProgressEvent =
	| {
			type: "assistant-turn";
			toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
	  }
	| { type: "tool-result"; toolCallId: string; toolName?: string; isError: boolean }
	| { type: "settle" };

const MUTATION_TOOL_NAMES = new Set([
	"write",
	"edit",
	"apply_patch",
	"write_file",
	"create_file",
	"replace_in_file",
	"multi_edit",
]);

/** Narrow command recognizer: validation/build evidence only, never generic shell activity. */
function isRecognizableValidationCommand(command: string): boolean {
	const normalized = command.trim().replace(/\s+/g, " ");
	if (!normalized) return false;
	const executable = normalized
		// Briefs routinely prefix the verify command with `cd <dir> &&`; strip those hops before
		// judging, otherwise a mandated `cd Electron && node --test` earns no progress credit.
		.replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*)+/, "")
		.replace(
			/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/,
			"",
		);
	return [
		/^(?:npm|pnpm|yarn|bun) (?:test|run (?:test|build|check|verify|typecheck)(?::[\w.-]+)?)(?: |$)/,
		/^npx (?:--[\w-]+ )*(?:tsx|vitest|jest|tsc)(?: |$).*(?:--test| test|--run|--noEmit| run)(?: |$)/,
		// `node --test` is this repo's mandated worker verify command; without it the guard
		// kills workers for following their own brief.
		/^node(?:\.js)? (?:--[\w-]+(?:=[^\s]*)? )*--test(?:\s|$)/,
		/^(?:cargo|swift) (?:test|build|check)(?: |$)/,
		/^go test(?: |$)/,
		/^(?:python(?:3)? -m )?pytest(?: |$)/,
		/^make (?:test|build|check|verify)(?: |$)/,
	].some((pattern) => pattern.test(executable));
}

function isSemanticToolCall(call: { name: string; arguments: Record<string, unknown> }): boolean {
	const name = call.name.trim().toLowerCase();
	if (MUTATION_TOOL_NAMES.has(name)) return true;
	if (name !== "bash" && name !== "shell") return false;
	return isRecognizableValidationCommand(String(call.arguments.command ?? ""));
}

export function createSemanticProgressState(
	overrides: Partial<SemanticProgressState> = {},
): SemanticProgressState {
	return {
		completedTurns: 0,
		inspectOnlyStreak: 0,
		progressEvents: 0,
		pendingToolIds: [],
		pendingAnonymousTools: [],
		recentInspectSignatures: [],
		lastSummary: "no completed assistant turn",
		...overrides,
	};
}

/**
 * What a non-semantic call was aimed at. Repeating the same signature is the stall this
 * guard exists to catch; a changing target is recon advancing, which the wall-clock
 * timeout — not a turn counter — is responsible for bounding.
 */
function inspectSignature(call: { name: string; arguments: Record<string, unknown> }): string {
	const args = call.arguments ?? {};
	const primary =
		args.path ?? args.command ?? args.pattern ?? args.query ?? args.url ??
		Object.values(args).find((value) => typeof value === "string");
	const normalized = typeof primary === "string" ? primary.trim().replace(/\s+/g, " ").slice(0, 120) : "";
	return `${call.name.trim().toLowerCase()}:${normalized}`;
}

/** Pure semantic-progress transition; transport liveness remains a separate policy. */
export function advanceSemanticProgress(
	state: SemanticProgressState,
	event: SemanticProgressEvent,
): { state: SemanticProgressState; terminate: boolean } {
	if (event.type === "settle") {
		if (state.pendingToolIds.length === 0 && state.pendingAnonymousTools.length === 0) {
			return { state, terminate: false };
		}
		const next: SemanticProgressState = {
			...state,
			inspectOnlyStreak: state.inspectOnlyStreak + 1,
			pendingToolIds: [],
			pendingAnonymousTools: [],
			lastSummary: `${state.lastSummary}; semantic tool missing result at process settlement`,
		};
		return { state: next, terminate: next.inspectOnlyStreak >= GENERAL_PURPOSE_SEMANTIC_TURN_CAP };
	}

	if (event.type === "assistant-turn") {
		const hadUnsettledSemanticTool = state.pendingToolIds.length > 0 || state.pendingAnonymousTools.length > 0;
		const names = event.toolCalls.map((call) => call.name).filter(Boolean);
		const semanticCalls = event.toolCalls.filter(isSemanticToolCall);
		const pendingToolIds = semanticCalls.filter((call) => call.id).map((call) => call.id);
		const pendingAnonymousTools = semanticCalls
			.filter((call) => !call.id)
			.map((call) => call.name.trim().toLowerCase());
		const next: SemanticProgressState = {
			...state,
			completedTurns: state.completedTurns + 1,
			inspectOnlyStreak: state.inspectOnlyStreak + (hadUnsettledSemanticTool ? 1 : 0),
			pendingToolIds,
			pendingAnonymousTools,
			lastSummary: hadUnsettledSemanticTool
				? `turn ${state.completedTurns + 1}: previous semantic tool missing result`
				: `turn ${state.completedTurns + 1}: ${names.length > 0 ? names.join(",") : "assistant-only"}`,
		};
		if (next.inspectOnlyStreak >= GENERAL_PURPOSE_SEMANTIC_TURN_CAP) {
			return { state: next, terminate: true };
		}
		if (pendingToolIds.length > 0 || pendingAnonymousTools.length > 0) {
			return { state: next, terminate: false };
		}
		// No semantic tool this turn. Only aimless repetition counts toward the stall cap:
		// a turn inspecting something new is recon advancing — legitimate progress the old
		// blind turn counter killed mid-work (verification/check tasks never write files).
		const signatures = event.toolCalls
			.filter((call) => !isSemanticToolCall(call))
			.map(inspectSignature);
		const novel = signatures.filter((sig) => !next.recentInspectSignatures.includes(sig));
		if (signatures.length > 0 && novel.length > 0) {
			next.recentInspectSignatures = [...next.recentInspectSignatures, ...novel].slice(-INSPECT_SIGNATURE_RING_SIZE);
			next.lastSummary = `${next.lastSummary} (recon: ${novel.length} new target${novel.length === 1 ? "" : "s"})`;
			return { state: next, terminate: false };
		}
		next.inspectOnlyStreak += 1;
		if (signatures.length > 0) next.lastSummary = `${next.lastSummary} (spin: repeated inspect targets)`;
		return { state: next, terminate: next.inspectOnlyStreak >= GENERAL_PURPOSE_SEMANTIC_TURN_CAP };
	}

	let matchedLabel: string | undefined;
	let pendingToolIds = state.pendingToolIds;
	let pendingAnonymousTools = state.pendingAnonymousTools;
	if (event.toolCallId && state.pendingToolIds.includes(event.toolCallId)) {
		matchedLabel = event.toolCallId;
		pendingToolIds = state.pendingToolIds.filter((id) => id !== event.toolCallId);
	} else if (!event.toolCallId && event.toolName?.trim()) {
		const normalizedName = event.toolName.trim().toLowerCase();
		const matchIndex = state.pendingAnonymousTools.indexOf(normalizedName);
		if (matchIndex >= 0) {
			matchedLabel = `anonymous ${normalizedName}`;
			pendingAnonymousTools = state.pendingAnonymousTools.filter((_, index) => index !== matchIndex);
		}
	}
	if (!matchedLabel) return { state, terminate: false };
	if (!event.isError) {
		const next: SemanticProgressState = {
			...state,
			inspectOnlyStreak: 0,
			progressEvents: state.progressEvents + 1,
			pendingToolIds: [],
			pendingAnonymousTools: [],
			recentInspectSignatures: [],
			lastSummary: `${state.lastSummary}; semantic tool ${matchedLabel} succeeded`,
		};
		return { state: next, terminate: false };
	}
	if (pendingToolIds.length > 0 || pendingAnonymousTools.length > 0) {
		return {
			state: {
				...state,
				pendingToolIds,
				pendingAnonymousTools,
				lastSummary: `${state.lastSummary}; semantic tool ${matchedLabel} failed`,
			},
			terminate: false,
		};
	}
	const next: SemanticProgressState = {
		...state,
		inspectOnlyStreak: state.inspectOnlyStreak + 1,
		pendingToolIds,
		pendingAnonymousTools,
		lastSummary: `${state.lastSummary}; all semantic tools failed`,
	};
	return { state: next, terminate: next.inspectOnlyStreak >= GENERAL_PURPOSE_SEMANTIC_TURN_CAP };
}

export type StallWatchdogAction = "ignore" | "notify" | "abort";

/**
 * Fan-out makes background a runtime invariant. A one-step chain is not ordered
 * work, so it must not be a synchronous wait hatch. Multi-step chains still
 * run synchronously so `{previous}` can be substituted.
 *
 * Depth is deliberately not an input: every dispatch that already passed the
 * depth/type guards — Boss or nested worker alike — follows the same rule.
 * Single/parallel default to background, an explicit `background:true` is
 * honored, and an active fan-out layer forces background on every non-ordered
 * dispatch so `background:false` can never become a synchronous-wait hatch. A
 * nested worker that returns a dispatch receipt instead of blocking its own
 * tool call is what makes real fan-out trees possible.
 */
export function decideDispatchBackground(input: {
	isChain: boolean;
	chainLength: number;
	fanoutActive: boolean;
	requestedBackground?: boolean;
}): { useBackground: boolean; warning: string } {
	const orderedChain = input.isChain && input.chainLength > 1;
	const forcedBackground = input.fanoutActive && !orderedChain;
	const defaultBackground = !input.isChain;
	const wantBg = forcedBackground || (input.requestedBackground ?? defaultBackground);
	const useBackground = Boolean(wantBg && !orderedChain);
	let warning = "";
	if (input.requestedBackground === true && orderedChain) {
		warning =
			"Warning: background:true ignored (a multi-step chain runs synchronously so {previous} can be substituted).\n\n";
	} else if (input.requestedBackground === false && forcedBackground) {
		warning =
			"Warning: background:false ignored — the fan-out philosophy layer is active, and it requires dispatch to stay asynchronous. A one-step chain is not ordered work. Do not wait here: keep dispatching independent work, then read [subagent-done]. Use a multi-step chain or blockedBy for genuine dependencies, or turn off the 瀑布流 layer in Settings.\n\n";
	} else if (input.isChain && input.chainLength === 1 && forcedBackground) {
		warning =
			"Note: one-step chain ran in the background (fan-out is active). Completion arrives as [subagent-done]; do not wait here.\n\n";
	}
	return { useBackground, warning };
}

/**
 * Stall recovery must not depend on an idle boss turn. A sync wait that is
 * already stalled cannot receive the notify letter, so abort immediately. A
 * background worker that exhausted unanswered stall notifies is also aborted
 * instead of hanging forever.
 */
export function decideStallWatchdogAction(input: {
	idleMs: number;
	stallThresholdMs: number;
	notifyCount: number;
	maxNotifies: number;
	msSinceLastNotify: number;
	notifyIntervalMs: number;
	syncWait: boolean;
	/** A bounded recovery window for sync agents whose own tool protocol has timeouts and reconciliation. */
	syncRecoveryGraceMs?: number;
}): StallWatchdogAction {
	if (input.idleMs < input.stallThresholdMs) return "ignore";
	if (input.syncWait) {
		if (input.syncRecoveryGraceMs !== undefined && input.idleMs < input.syncRecoveryGraceMs) return "ignore";
		return "abort";
	}
	if (input.notifyCount >= input.maxNotifies) return "abort";
	if (input.notifyCount > 0 && input.msSinceLastNotify < input.notifyIntervalMs) return "ignore";
	return "notify";
}

export type GeneralPurposeExecutionPolicyResult =
	| { policy?: GeneralPurposeExecutionPolicy; problem?: undefined }
	| { policy?: undefined; problem: string };

const AUDIT_REASON_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Normalize Boss-owned execution overrides before worktree, lease, or child side effects. */
export function normalizeGeneralPurposeExecutionPolicy(
	agent: Pick<AgentConfig, "name" | "origin">,
	overrides: GeneralPurposeExecutionOverrides,
): GeneralPurposeExecutionPolicyResult {
	const exactBundledGeneralPurpose = agent.origin === "bundled" && agent.name === "general-purpose";
	if (!exactBundledGeneralPurpose) {
		return {};
	}

	const worktree = overrides.worktree ?? "isolated";
	if (worktree !== "isolated" && worktree !== "none") {
		return { problem: 'Invalid worktree: expected "isolated" or "none".' };
	}
	let noWorktreeReason: string | undefined;
	if (worktree === "none") {
		if (typeof overrides.noWorktreeReason === "string") {
			noWorktreeReason = overrides.noWorktreeReason.trim();
			if (!noWorktreeReason || noWorktreeReason.length > 500 || AUDIT_REASON_CONTROL_CHARACTERS.test(noWorktreeReason)) {
				return { problem: "noWorktreeReason must be a non-empty single line of 1-500 characters with no control characters." };
			}
		}
	} else if (overrides.noWorktreeReason !== undefined) {
		return { problem: 'noWorktreeReason is only allowed with worktree="none".' };
	}

	const boundedInteger = (value: number | undefined, name: string, minimum: number, maximum: number): string | null => {
		if (value === undefined) return null;
		return Number.isInteger(value) && value >= minimum && value <= maximum
			? null
			: `${name} must be an integer from ${minimum} to ${maximum} seconds.`;
	};
	const heartbeatProblem = boundedInteger(overrides.heartbeatSecs, "heartbeatSecs", 30, 3600);
	if (heartbeatProblem) return { problem: heartbeatProblem };
	const timeoutProblem = boundedInteger(overrides.timeoutSecs, "timeoutSecs", 30, 604800);
	if (timeoutProblem) return { problem: timeoutProblem };
	const effectiveTimeoutSecs = overrides.timeoutSecs ?? DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS / 1000;
	if (overrides.heartbeatSecs !== undefined && overrides.heartbeatSecs >= effectiveTimeoutSecs) {
		return { problem: "heartbeatSecs must be less than timeoutSecs when both are provided." };
	}
	const progressLog = sanitizeProgressLogInput(overrides.progressLog);
	if (progressLog && "problem" in progressLog) return { problem: progressLog.problem };

	return {
		policy: {
			worktree,
			...(noWorktreeReason ? { noWorktreeReason } : {}),
			...(overrides.heartbeatSecs !== undefined ? { heartbeatMs: overrides.heartbeatSecs * 1000 } : {}),
			timeoutMs:
				overrides.timeoutSecs !== undefined
					? overrides.timeoutSecs * 1000
					: DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS,
			...(progressLog && "value" in progressLog ? { progressLog: progressLog.value } : {}),
		},
	};
}

type RuntimeTimeoutHandle = ReturnType<typeof setTimeout>;

/**
 * Arm one deadline for one exact dispatch generation. The first arm anchors to the
 * injected `now` (the first child spawn instant); `extend` re-arms from a fresh
 * base so an alive-but-slow worker can outlive its original budget.
 */
export function createRunScopedTimeout(options: {
	runId: string;
	timeoutMs: number;
	isCurrentRun: (runId: string) => boolean;
	onTimeout: () => void;
	now?: () => number;
	schedule?: (callback: () => void, delayMs: number) => RuntimeTimeoutHandle;
	cancel?: (handle: RuntimeTimeoutHandle) => void;
}): { deadlineAt: number; extend: (ms?: number, base?: number) => number; dispose: () => void } {
	const now = options.now ?? Date.now;
	const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const cancel = options.cancel ?? clearTimeout;
	const deadlineAt = now() + options.timeoutMs;
	let handle: RuntimeTimeoutHandle | undefined = schedule(() => {
		handle = undefined;
		if (options.isCurrentRun(options.runId)) options.onTimeout();
	}, options.timeoutMs);
	(handle as { unref?: () => void })?.unref?.();
	return {
		deadlineAt,
		extend(ms = options.timeoutMs, base = Date.now()) {
			if (handle !== undefined) cancel(handle);
			const extendedDeadlineAt = base + ms;
			handle = schedule(() => {
				handle = undefined;
				if (options.isCurrentRun(options.runId)) options.onTimeout();
			}, ms);
			(handle as { unref?: () => void })?.unref?.();
			return extendedDeadlineAt;
		},
		dispose() {
			if (handle !== undefined) cancel(handle);
			handle = undefined;
		},
	};
}

/**
 * Budget-expiry policy for the run-scoped timeout: a worker that is still
 * producing gets its budget silently re-armed; a stalled one earns the boss one
 * diagnostic notification plus one final grace budget; only a second expiry with
 * no progress aborts. Never aborts a producing worker just for being slow.
 *
 * `idleMs` alone cannot see a worker that is busy *through a child*. A nested
 * dispatch is silent on the parent's own stream by construction — the parent is
 * blocked in its `subagent` tool while the grandchild burns the CPU — so a
 * delegating worker looked exactly like a wedged one here and paid for
 * delegating with its own life. The stall watchdog already resolved that
 * question with subtree CPU evidence (`isQuietToolStalled`); this decision now
 * reads the same evidence rather than a second, blinder measure of the same
 * thing.
 *
 * Measured progress is checked before `syncWait` on purpose. That branch exists
 * because a boss turn blocked on a sync wait cannot receive the diagnostic
 * letter, which is a reason to skip the notification — not a reason to kill a
 * worker whose subtree is demonstrably working. A grandchild is always a sync
 * wait, so without this order nested delegation would stay unaffordable exactly
 * where it is most useful.
 */
export type RuntimeBudgetExpiryDecision = "extend-silent" | "notify-extend" | "abort";
export function decideRuntimeBudgetExpiry(input: {
	idleMs: number;
	progressGraceMs: number;
	notified: boolean;
	syncWait?: boolean;
	/** Subtree CPU evidence, when the watchdog has a sample pair. Absent = unknown, never assumed. */
	verdict?: LivenessVerdict;
}): RuntimeBudgetExpiryDecision {
	if (input.idleMs <= input.progressGraceMs) return "extend-silent";
	if (input.verdict === "working") return "extend-silent";
	if (input.syncWait) return "abort";
	return input.notified ? "abort" : "notify-extend";
}

/** A configured heartbeat is regular; omission lets the caller retain its legacy stepped schedule. */
export function configuredHeartbeatAt(
	startedAt: number,
	delivered: number,
	heartbeatMs: number | undefined,
): number | undefined {
	return heartbeatMs === undefined
		? undefined
		: startedAt + (Math.max(0, delivered) + 1) * heartbeatMs;
}

/**
 * Only the shipped bundled definition named `secretary` can receive the
 * main-session closeout role. A project/user agent with the same name, prompt,
 * or frontmatter fields stays an ordinary worker and is still subject to its
 * declarative capability policy.
 */
export function runtimeRolePolicyForAgent(agent: AgentConfig): AgentRuntimeRolePolicy {
	if (agent.origin === "bundled" && agent.name === "secretary") {
		return {
			role: "closeout-secretary",
			worktree: "main-session",
			allowRecursiveDelegation: false,
		};
	}
	// Only the shipped operator carried the operator role marker; that bundled
	// role was removed. A user/project agent named operator remains an ordinary
	// worker and cannot self-declare a privileged route.
	return {
		role: "worker",
		worktree: agent.worktree === "none" ? "direct" : "isolated",
		allowRecursiveDelegation: agent.capabilities.delegation,
	};
}
