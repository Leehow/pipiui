import type { AgentConfig } from "./agents.ts";

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
			worktree: "isolated",
			allowRecursiveDelegation: false,
		};
	}
	return {
		role: "worker",
		worktree: agent.worktree === "none" ? "direct" : "isolated",
		allowRecursiveDelegation: agent.capabilities.delegation,
	};
}
