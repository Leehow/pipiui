import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requestGitWorktreeServiceProviderV1 } from "../../extensions/git-capability/host/worktree/provider.ts";
import { createElectronMainSubagentHostV1 } from "./electron-main.ts";
import { createNodeFsStorageAdapterV1 } from "./state/node-fs-storage.ts";

const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-provider.v1");

function clearMountedProvider(): void {
	delete (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY];
}

test("electron-main injects a local finalization service without writing globalThis", async (t) => {
	const previous = requestGitWorktreeServiceProviderV1();
	clearMountedProvider();
	const root = mkdtempSync(join(tmpdir(), "pipiui-electron-main-inject-"));
	t.after(() => {
		rmSync(root, { recursive: true, force: true });
		if (previous) (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = previous;
		else clearMountedProvider();
	});

	const host = createElectronMainSubagentHostV1({
		sessionCapability: "electron-main-test-session",
		runtime: {
			persistence: {
				storage: createNodeFsStorageAdapterV1(),
				agentProjectionPath: join(root, "agents.json"),
				planPath: join(root, "plan.json"),
				worktreeFinalizationsPath: join(root, "finalizations.json"),
			},
			worktreeFinalization: {
				enabled: true,
				mainCwd: root,
				ownership: { mode: "isolated", role: "worker" },
			},
		},
		capabilities: {
			session: { id: "electron-main-test" },
			mainCwd: root,
			extensions: {},
			modelFiles: {},
		},
		spawn: { command: "true" },
	});

	assert.equal(requestGitWorktreeServiceProviderV1(), undefined);

	const agentId = "electron-inject";
	const runId = "electron-inject-run";
	const worktreePath = join(root, ".pi", "worktrees", agentId);
	const branch = `pipiui/${agentId}`;
	assert.equal((await host.runtime.applyAgentEvent({
		schemaVersion: 1,
		kind: "start",
		agentId,
		runId,
		name: "general-purpose",
		task: "prove local injection",
		depth: 1,
		worktreePath,
		worktreeBranch: branch,
	})).applied, true);

	const ended = await host.runtime.applyAgentEvent({
		schemaVersion: 1,
		kind: "end",
		agentId,
		runId,
		ok: true,
		aborted: false,
		worktreePath,
		worktreeBranch: branch,
	});

	assert.equal(ended.diagnostics.some((entry) => entry.code === "git_worktree_provider_unavailable"), false);
	assert.ok(ended.finalization, "injected local service must run finalization");
	assert.equal(requestGitWorktreeServiceProviderV1(), undefined);
});
