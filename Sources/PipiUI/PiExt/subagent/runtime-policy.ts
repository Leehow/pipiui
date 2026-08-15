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

export type GeneralPurposeExecutionPolicyResult =
	| { policy?: GeneralPurposeExecutionPolicy; problem?: undefined }
	| { policy?: undefined; problem: string };

const EXECUTION_OVERRIDE_KEYS = ["worktree", "noWorktreeReason", "heartbeatSecs", "timeoutSecs"] as const;
const AUDIT_REASON_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Normalize Boss-owned execution overrides before worktree, lease, or child side effects. */
export function normalizeGeneralPurposeExecutionPolicy(
	agent: Pick<AgentConfig, "name" | "origin">,
	overrides: GeneralPurposeExecutionOverrides,
): GeneralPurposeExecutionPolicyResult {
	const exactBundledGeneralPurpose = agent.origin === "bundled" && agent.name === "general-purpose";
	const supplied = EXECUTION_OVERRIDE_KEYS.filter((key) => overrides[key] !== undefined);
	if (!exactBundledGeneralPurpose) {
		return supplied.length === 0
			? {}
			: { problem: `Execution override ${supplied.join(", ")} is only available to the bundled general-purpose agent.` };
	}

	const worktree = overrides.worktree ?? "isolated";
	if (worktree !== "isolated" && worktree !== "none") {
		return { problem: 'Invalid worktree: expected "isolated" or "none".' };
	}
	let noWorktreeReason: string | undefined;
	if (worktree === "none") {
		if (typeof overrides.noWorktreeReason !== "string") {
			return { problem: 'worktree="none" requires noWorktreeReason with the Boss reason.' };
		}
		noWorktreeReason = overrides.noWorktreeReason.trim();
		if (!noWorktreeReason || noWorktreeReason.length > 500 || AUDIT_REASON_CONTROL_CHARACTERS.test(noWorktreeReason)) {
			return { problem: "noWorktreeReason must be a non-empty single line of 1-500 characters with no control characters." };
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
	if (
		overrides.heartbeatSecs !== undefined &&
		overrides.timeoutSecs !== undefined &&
		overrides.heartbeatSecs >= overrides.timeoutSecs
	) {
		return { problem: "heartbeatSecs must be less than timeoutSecs when both are provided." };
	}

	return {
		policy: {
			worktree,
			...(noWorktreeReason ? { noWorktreeReason } : {}),
			...(overrides.heartbeatSecs !== undefined ? { heartbeatMs: overrides.heartbeatSecs * 1000 } : {}),
			...(overrides.timeoutSecs !== undefined ? { timeoutMs: overrides.timeoutSecs * 1000 } : {}),
		},
	};
}

type RuntimeTimeoutHandle = ReturnType<typeof setTimeout>;

/** Arm one absolute deadline for one exact dispatch generation. */
export function createRunScopedTimeout(options: {
	runId: string;
	timeoutMs: number;
	isCurrentRun: (runId: string) => boolean;
	onTimeout: () => void;
	now?: () => number;
	schedule?: (callback: () => void, delayMs: number) => RuntimeTimeoutHandle;
	cancel?: (handle: RuntimeTimeoutHandle) => void;
}): { deadlineAt: number; dispose: () => void } {
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
		dispose() {
			if (handle !== undefined) cancel(handle);
			handle = undefined;
		},
	};
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
