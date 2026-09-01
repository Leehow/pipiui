/**
 * Root for worker session JSONL (`.pi/agent-sessions`).
 *
 * Worker conversations used to live under `PIPIUI_MAIN_CWD` so they survived
 * *worker* worktree cleanup (never the child's own cwd). Session-level worktrees
 * flip that: MAIN_CWD is the session workspace and can itself be removed, so the
 * pin upgrades to `PIPIUI_PROJECT_ROOT` (canonical project root). MAIN_CWD
 * remains the fallback when the project-root env is absent.
 */
export function resolveAgentSessionRoot(
	projectRoot: string | undefined,
	mainCwd: string | undefined,
): string | undefined {
	const preferred = projectRoot?.trim();
	if (preferred) return preferred;
	const fallback = mainCwd?.trim();
	return fallback || undefined;
}
