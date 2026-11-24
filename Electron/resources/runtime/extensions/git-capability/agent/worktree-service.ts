/** Mounted Git worktree placement provider for agent orchestration. */
import * as path from "node:path";
import * as fs from "node:fs";
import { retainWorktreeMergePolicyV1 } from "../host/worktree/merge-policy.ts";

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
	resolveExperimentPlacement?(options: { projectRoot: string; agentId: string }): WorktreePlacement & { created: true; mergePolicy: "never" };
}

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-placement-provider.v1");

const defaultProvider: GitWorktreePlacementProviderV1 = {
	resolvePlacement: resolveSubagentWorktree,
	resolveExperimentPlacement({ projectRoot, agentId }) {
		// Unlike normal worker placement, experiments must never initialize HEAD,
		// reuse another worker, or silently sanitize/truncate caller identities.
		if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(agentId) || agentId.length < 2 || agentId.length > 24) {
			throw new Error("invalid experiment agentId: use a 2-24 character semantic slug");
		}
		const root = fs.realpathSync(projectRoot);
		const top = gitSpawnSync(["-C", root, "rev-parse", "--show-toplevel"]);
		const head = gitSpawnSync(["-C", root, "rev-parse", "--verify", "HEAD"]);
		if (!top.ok || !head.ok || fs.realpathSync(top.stdout) !== root) throw new Error("experiment placement requires a Git project root with existing HEAD");
		const expected = path.join(root, ".pi", "worktrees", agentId);
		const branch = `pipiui/${agentId}`;
		for (const folder of [path.join(root, ".pi"), path.join(root, ".pi", "worktrees")]) {
			try { const stat = fs.lstatSync(folder); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("unsafe experiment worktree parent"); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		}
		const refs = gitSpawnSync(["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/heads/pipiui/"]);
		if (!refs.ok) throw new Error("cannot inspect existing experiment branches");
		if (refs.stdout.split("\n").some((ref) => ref === branch || ref.startsWith(`${branch}-`))) throw new Error("experiment agentId conflicts with an existing branch");
		try { fs.lstatSync(expected); throw new Error("experiment agentId conflicts with an existing directory"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		retainWorktreeMergePolicyV1(root, agentId, "never");
		const placed = this.resolvePlacement({ agentId, defaultCwd: root, mainCwd: root, readOnly: false, policy: { worktree: "isolated" }, allowEnvironmentOptOut: false, requireNew: true });
		if (placed.worktreeError || placed.worktreePath !== expected || placed.worktreeBranch !== branch || placed.cwd !== expected) {
			throw new Error(placed.worktreeError || "experiment placement did not create the requested isolated worktree; retained without initialization");
		}
		return { ...placed, created: true, mergePolicy: "never" };
	},
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
