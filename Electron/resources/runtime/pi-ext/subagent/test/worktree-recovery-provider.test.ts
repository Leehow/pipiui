import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	registerGitWorktreeServiceProviderV1,
	requestGitWorktreeServiceProviderV1,
	type GitWorktreeServiceProviderV1,
} from "../../../extensions/git-capability/host/worktree/provider.ts";
import { probeMainDirty } from "../worktree-recovery.ts";

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-provider.v1");

function clearMountedProvider(): GitWorktreeServiceProviderV1 | undefined {
	const previous = requestGitWorktreeServiceProviderV1();
	delete (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY];
	return previous;
}

function restoreMountedProvider(previous: GitWorktreeServiceProviderV1 | undefined): void {
	if (previous) (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = previous;
	else delete (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY];
}

test("worktree-recovery.ts has no child_process or direct git status", () => {
	const source = readFileSync(new URL("../worktree-recovery.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /child_process/);
	assert.doesNotMatch(source, /spawnSync/);
	assert.doesNotMatch(source, /["']git["']\s*,/);
	assert.doesNotMatch(source, /status --porcelain/);
	assert.match(source, /requestGitWorktreeServiceProviderV1\(\)\?\.probeMainDirty/);
});

test("probeMainDirty is conservative without a provider and delegates when mounted", (t) => {
	const previous = clearMountedProvider();
	t.after(() => restoreMountedProvider(previous));

	assert.equal(probeMainDirty("/tmp"), true);

	registerGitWorktreeServiceProviderV1({
		createFinalizationService() {
			throw new Error("unused");
		},
		finalizeWorktree() {
			return Promise.reject(new Error("unused"));
		},
		probeMainDirty() {
			return false;
		},
	});
	assert.equal(probeMainDirty("/any"), false);

	registerGitWorktreeServiceProviderV1({
		createFinalizationService() {
			throw new Error("unused");
		},
		finalizeWorktree() {
			return Promise.reject(new Error("unused"));
		},
		probeMainDirty() {
			throw new Error("boom");
		},
	});
	assert.equal(probeMainDirty("/any"), true);
});
