/**
 * Mounted Git-capability worktree provider.
 *
 * Git policy and process execution belong to this extension. Orchestration owns
 * scheduling, leases, episode attestation, and asks this mounted provider for
 * the service at operation time so a disabled/unregistered provider is visible.
 * Electron-main creates a local provider via the factory and injects the service;
 * it must not depend on this global registration.
 */
import { spawnSync } from "node:child_process";

import {
	finalizeWorktreeV1,
	WorktreeFinalizationServiceV1,
	type WorktreeFinalizationServiceOptionsV1,
} from "./service.ts";
import type {
	WorktreeFinalizationInputV1,
	WorktreeFinalizationStateV1,
} from "./schema.ts";

export interface GitWorktreeServiceProviderV1 {
	createFinalizationService(options?: WorktreeFinalizationServiceOptionsV1): WorktreeFinalizationServiceV1;
	finalizeWorktree(
		input: WorktreeFinalizationInputV1 | unknown,
		options?: WorktreeFinalizationServiceOptionsV1,
	): Promise<WorktreeFinalizationStateV1>;
	/** Conservative dirty probe: true when Git is unavailable or the tree is not clean. */
	probeMainDirty(mainCwd: string): boolean;
}

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-provider.v1");

function probeMainDirty(mainCwd: string): boolean {
	try {
		const env = { ...process.env };
		delete env.PIPIUI_COMPUTER_CAPABILITY;
		const result = spawnSync("git", ["-C", mainCwd, "status", "--porcelain"], {
			encoding: "utf8",
			shell: false,
			env,
			timeout: 10_000,
		});
		if (result.status !== 0 || result.error) return true;
		return typeof result.stdout === "string" && result.stdout.trim().length > 0;
	} catch {
		return true;
	}
}

/** Local provider for Electron-main / tests. Does not write globalThis. */
export function createGitWorktreeServiceProviderV1(): GitWorktreeServiceProviderV1 {
	return {
		createFinalizationService(options = {}) {
			return new WorktreeFinalizationServiceV1(options);
		},
		finalizeWorktree(input, options = {}) {
			return finalizeWorktreeV1(input, options);
		},
		probeMainDirty,
	};
}

/** Register only from the mounted git-capability agent entry. */
export function registerGitWorktreeServiceProviderV1(
	provider: GitWorktreeServiceProviderV1 = createGitWorktreeServiceProviderV1(),
): void {
	(globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = provider;
}

/** Consumers request at operation time; undefined means Git capability is unavailable. */
export function requestGitWorktreeServiceProviderV1(): GitWorktreeServiceProviderV1 | undefined {
	return (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] as GitWorktreeServiceProviderV1 | undefined;
}
