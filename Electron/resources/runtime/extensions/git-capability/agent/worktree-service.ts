/** Mounted Git worktree placement provider for agent orchestration. */
import * as path from "node:path";

import {
	resolveSubagentWorktree,
	type WorktreePlacement,
	type WorktreePlacementOptions,
} from "./worktree-placement.ts";

export interface GitWorktreePlacementProviderV1 {
	resolvePlacement(options: WorktreePlacementOptions): WorktreePlacement;
}

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-placement-provider.v1");

const defaultProvider: GitWorktreePlacementProviderV1 = {
	resolvePlacement: resolveSubagentWorktree,
};

/** Register only from the mounted git-capability agent entry. */
export function registerGitWorktreePlacementProviderV1(
	provider: GitWorktreePlacementProviderV1 = defaultProvider,
): void {
	(globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = provider;
}

/** Consumers request at operation time; undefined means Git capability is unavailable. */
export function requestGitWorktreePlacementProviderV1(): GitWorktreePlacementProviderV1 | undefined {
	return (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] as GitWorktreePlacementProviderV1 | undefined;
}

/**
 * Ask the mounted provider for writable isolated placement. Intentional shared-cwd
 * modes are resolved without Git so disabling the capability cannot change them.
 */
export function requestGitWorktreePlacementV1(options: WorktreePlacementOptions): WorktreePlacement {
	const fallbackCwd = options.explicitCwd ?? options.defaultCwd;
	if (options.policy.worktree === "main-session") {
		return { cwd: path.resolve(options.mainCwd || options.defaultCwd) };
	}
	if (
		options.policy.worktree === "direct" ||
		options.readOnly ||
		(options.allowEnvironmentOptOut !== false && process.env.PIPIUI_WORKTREE === "0")
	) {
		return { cwd: fallbackCwd };
	}
	const provider = requestGitWorktreePlacementProviderV1();
	if (provider) return provider.resolvePlacement(options);
	return {
		cwd: fallbackCwd,
		worktreeError: "git-capability worktree placement provider is unavailable; refusing shared-cwd fallback",
	};
}
