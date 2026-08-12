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
