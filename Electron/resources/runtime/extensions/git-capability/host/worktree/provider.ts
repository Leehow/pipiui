/**
 * Mounted Git-capability worktree provider.
 *
 * Git policy and process execution belong to this extension. Orchestration owns
 * scheduling, leases, episode attestation, and asks this mounted provider for
 * the service at operation time so a disabled/unregistered provider is visible.
 */
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
}

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-provider.v1");

const defaultProvider: GitWorktreeServiceProviderV1 = {
	createFinalizationService(options = {}) {
		return new WorktreeFinalizationServiceV1(options);
	},
	finalizeWorktree(input, options = {}) {
		return finalizeWorktreeV1(input, options);
	},
};

/** Register only from the mounted git-capability agent entry. */
export function registerGitWorktreeServiceProviderV1(
	provider: GitWorktreeServiceProviderV1 = defaultProvider,
): void {
	(globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = provider;
}

/** Consumers request at operation time; undefined means Git capability is unavailable. */
export function requestGitWorktreeServiceProviderV1(): GitWorktreeServiceProviderV1 | undefined {
	return (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] as GitWorktreeServiceProviderV1 | undefined;
}
