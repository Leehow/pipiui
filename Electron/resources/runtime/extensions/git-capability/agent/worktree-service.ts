/** Mounted Git worktree placement provider for agent orchestration. */
import * as path from "node:path";

import {
	gitSpawnSync,
	resolveSubagentWorktree,
	type WorktreePlacement,
	type WorktreePlacementOptions,
} from "./worktree-placement.ts";

export type GitStatusPorcelainResultV1 = { ok: boolean; stdout: string };

export interface GitWorktreePlacementProviderV1 {
	resolvePlacement(options: WorktreePlacementOptions): WorktreePlacement;
	statusPorcelain(mainCwd: string): GitStatusPorcelainResultV1;
}

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-placement-provider.v1");

const defaultProvider: GitWorktreePlacementProviderV1 = {
	resolvePlacement: resolveSubagentWorktree,
	statusPorcelain(mainCwd) {
		const result = gitSpawnSync(
			["-C", mainCwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"],
			undefined,
			4_000,
		);
		return { ok: result.ok, stdout: result.stdout };
	},
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

export function requestGitStatusPorcelainV1(mainCwd: string | undefined): GitStatusPorcelainResultV1 {
	if (!mainCwd?.trim()) return { ok: false, stdout: "" };
	try {
		return requestGitWorktreePlacementProviderV1()?.statusPorcelain(mainCwd) ?? { ok: false, stdout: "" };
	} catch {
		return { ok: false, stdout: "" };
	}
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
