import type { AgentConfig } from "./agents.ts";

export const PRIVATE_COMPUTER_AGENT_NAMES = ["computer-use-leader", "operator", "computer-verifier", "computer-terminal"] as const;

/** Bind Computer Task protocol principals to exact App-shipped definitions. */
export function bindCanonicalComputerAgents(discovered: AgentConfig[], canonical: AgentConfig[]): AgentConfig[] {
	const result = new Map(discovered.map((agent) => [agent.name, agent]));
	for (const name of PRIVATE_COMPUTER_AGENT_NAMES) {
		const agent = canonical.find((candidate) => candidate.name === name && candidate.origin === "bundled");
		if (!agent) throw new Error(`Canonical Computer Agent role is unavailable: ${name}`);
		result.set(name, agent);
	}
	return [...result.values()];
}

/** Runtime-only grants that frontmatter is never allowed to manufacture. */
export interface AgentRuntimeRolePolicy {
	role: "worker" | "operator" | "closeout-secretary";
	/** `main-session` is reserved; `direct` merely honors the caller/default cwd. */
	worktree: "isolated" | "direct" | "main-session";
	allowRecursiveDelegation: boolean;
}

export interface GeneralPurposeExecutionOverrides {
	worktree?: "isolated" | "none";
	noWorktreeReason?: string;
	heartbeatSecs?: number;
	timeoutSecs?: number;
}

export interface GeneralPurposeExecutionPolicy {
	worktree: "isolated" | "none";
	noWorktreeReason?: string;
	heartbeatMs?: number;
	timeoutMs?: number;
}

/** Default GP budget: producing workers extend silently; a stalled one can be aborted. */
export const DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS = 600_000;

export type StallWatchdogAction = "ignore" | "notify" | "abort";

/**
 * Fan-out makes background a runtime invariant. A one-step chain is not ordered
 * work, so it must not be a synchronous wait hatch. Multi-step chains still
 * run synchronously so `{previous}` can be substituted.
 */
export function decideDispatchBackground(input: {
	depth: number;
	isChain: boolean;
	chainLength: number;
	fanoutActive: boolean;
	requestedBackground?: boolean;
}): { useBackground: boolean; warning: string } {
	const orderedChain = input.isChain && input.chainLength > 1;
	const forcedBackground = input.depth === 0 && input.fanoutActive && !orderedChain;
	const defaultBackground = input.depth === 0 && !input.isChain;
	const wantBg = forcedBackground || (input.requestedBackground ?? defaultBackground);
	const useBackground = Boolean(wantBg && !orderedChain && input.depth === 0);
	let warning = "";
	if (input.requestedBackground === true && (input.depth > 0 || orderedChain)) {
		warning =
			"Warning: background:true ignored (nested depth>0 or multi-step chain always runs synchronously).\n\n";
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

	return {
		policy: {
			worktree,
			...(noWorktreeReason ? { noWorktreeReason } : {}),
			...(overrides.heartbeatSecs !== undefined ? { heartbeatMs: overrides.heartbeatSecs * 1000 } : {}),
			timeoutMs:
				overrides.timeoutSecs !== undefined
					? overrides.timeoutSecs * 1000
					: DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS,
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
 */
export type RuntimeBudgetExpiryDecision = "extend-silent" | "notify-extend" | "abort";
export function decideRuntimeBudgetExpiry(input: {
	idleMs: number;
	progressGraceMs: number;
	notified: boolean;
	syncWait?: boolean;
}): RuntimeBudgetExpiryDecision {
	if (input.idleMs <= input.progressGraceMs) return "extend-silent";
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
	// Only the shipped operator may carry the role marker consumed by the
	// host's Computer-memory grant fence. A user/project agent named operator
	// remains an ordinary worker and cannot self-declare this route.
	if (agent.origin === "bundled" && agent.name === "operator") {
		return {
			role: "operator",
			// The bundled Operator is declaratively read-only and never edits code.
			// Giving it an isolated worktree incorrectly classifies an unnamed desktop
			// dispatch as a writable branch-producing worker before model/spawn setup.
			worktree: "direct",
			allowRecursiveDelegation: false,
		};
	}
	return {
		role: "worker",
		worktree: agent.worktree === "none" ? "direct" : "isolated",
		allowRecursiveDelegation: agent.capabilities.delegation,
	};
}
