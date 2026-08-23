import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	applyFinalizationTransition,
	canTransitionFinalizationPhase,
	isTerminalFinalizingPhase,
	resetFinalizationFields,
	snapshotFinalizationFields,
	type FinalizationFields,
} from "../finalization-phase.ts";
import { WorktreeFinalizationServiceV1 } from "../../subagent-host/worktree/service.ts";
import type { WorktreeFinalizationInputV1 } from "../../subagent-host/worktree/schema.ts";

test("summary then delayed verify records phaseSince and verify elapsed only after leave", () => {
	const state: FinalizationFields = {};
	assert.equal(applyFinalizationTransition(state, "final-received", 1_000), true);
	assert.equal(state.finalizationPhase, "final-received");
	assert.equal(state.phaseSince, 1_000);
	assert.equal(state.verifyElapsedMs, undefined);

	assert.equal(applyFinalizationTransition(state, "verifying", 4_000), true);
	assert.equal(state.finalizationPhase, "verifying");
	assert.equal(state.phaseSince, 4_000);
	assert.equal(applyFinalizationTransition(state, "verifying", 20_000, { verifyPid: 4242 }), false);
	assert.equal(state.verifyPid, 4242);
	assert.equal(state.phaseSince, 4_000);
	assert.equal(state.verifyElapsedMs, undefined);

	assert.equal(applyFinalizationTransition(state, "reconciling", 9_500), true);
	assert.equal(state.verifyElapsedMs, 5_500);
	assert.equal(state.verifyPid, undefined);
});

test("verify then reconcile merge cleanup post-verify records elapsed in order and rejects going back", () => {
	const state: FinalizationFields = {};
	const seen: string[] = [];
	for (const [phase, at] of [
		["verifying", 10],
		["reconciling", 40],
		["merging", 70],
		["cleaning", 90],
		["post-verify", 110],
		["done-await-host", 140],
	] as const) {
		assert.equal(applyFinalizationTransition(state, phase, at), true);
		seen.push(`${phase}@${state.phaseSince}`);
	}
	assert.deepEqual(seen, [
		"verifying@10",
		"reconciling@40",
		"merging@70",
		"cleaning@90",
		"post-verify@110",
		"done-await-host@140",
	]);
	assert.equal(state.verifyElapsedMs, 30);
	assert.equal(state.reconcileElapsedMs, 30);
	assert.equal(state.mergeElapsedMs, 20);
	assert.equal(state.cleanupElapsedMs, 20);
	assert.equal(canTransitionFinalizationPhase("cleaning", "post-verify"), true);
	assert.equal(canTransitionFinalizationPhase("post-verify", "cleaning"), false);
	assert.equal(canTransitionFinalizationPhase("done-await-host", "verifying"), false);
	assert.equal(applyFinalizationTransition(state, "verifying", 200), false);
	assert.equal(state.finalizationPhase, "done-await-host");
});

test("missing elapsed and pid stay missing; snapshots omit secrets", () => {
	const state: FinalizationFields = {};
	applyFinalizationTransition(state, "final-received", 5);
	const snap = snapshotFinalizationFields(state);
	assert.equal(snap.verifyPid, undefined);
	assert.equal(snap.verifyElapsedMs, undefined);
	assert.equal(snap.mergeElapsedMs, undefined);
	assert.deepEqual(Object.keys(snap).sort(), ["finalizationPhase", "phaseSince"]);
	assert.equal(JSON.stringify(snap).includes("SECRET"), false);
	assert.equal("prompt" in snap, false);
});

test("generating and tool-active may swap; final-received is the closeout gate", () => {
	const state: FinalizationFields = {};
	applyFinalizationTransition(state, "generating", 1);
	applyFinalizationTransition(state, "tool-active", 2);
	applyFinalizationTransition(state, "generating", 3);
	assert.equal(state.finalizationPhase, "generating");
	assert.equal(isTerminalFinalizingPhase("generating"), false);
	assert.equal(isTerminalFinalizingPhase("tool-active"), false);
	assert.equal(isTerminalFinalizingPhase("final-received"), true);
	applyFinalizationTransition(state, "final-received", 4);
	assert.equal(applyFinalizationTransition(state, "tool-active", 5), false);
});

test("runtime emits phases at real verify/worktree/done boundaries", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /projectFinalizationPhase\(pipiuiAgentId, runId, "final-received"\)/);
	assert.match(source, /projectFinalizationPhase\(pipiuiAgentId, runId, "verifying"\)/);
	assert.match(source, /runVerifyCommand\([\s\S]*onSpawn/);
	assert.match(source, /onProgress\(phase\) \{[\s\S]*?projectFinalizationPhase\(pipiuiAgentId, runId, phase\)/);
	assert.match(source, /projectFinalizationPhase\(pipiuiAgentId, runId, "done-await-host"\)/);
	assert.match(source, /kind:\s*"diagnostics"/);
	assert.doesNotMatch(source, /projectFinalizationPhase\([\s\S]{0,80}activity:/);
	assert.doesNotMatch(source, /finalizationPhase[\s\S]{0,40}prompt/);
	const worktree = readFileSync(new URL("../../subagent-host/worktree/service.ts", import.meta.url), "utf8");
	assert.match(worktree, /this\.emitProgress\("reconciling"\)/);
	assert.match(worktree, /this\.emitProgress\("merging"\)/);
	const cleaningAt = worktree.indexOf('this.emitProgress("cleaning")');
	const postVerifyAt = worktree.indexOf('this.emitProgress("post-verify")');
	assert.ok(cleaningAt >= 0 && postVerifyAt > cleaningAt, "service must emit cleaning before post-verify");
});

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
}

test("service cleaning then post-verify is accepted and stays on post-verify", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pipiui-finalization-phase-order-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	git(root, ["add", "README.md"]);
	git(root, ["commit", "-m", "base"]);
	const agentId = "phase-order";
	const worktreePath = join(root, ".pi", "worktrees", agentId);
	const branch = `pipiui/${agentId}`;
	mkdirSync(join(root, ".pi", "worktrees"), { recursive: true });
	git(root, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
	writeFileSync(join(worktreePath, "landed.txt"), "ok\n");
	git(worktreePath, ["add", "landed.txt"]);
	git(worktreePath, ["commit", "-m", "land"]);

	const emitted: Array<"reconciling" | "merging" | "cleaning" | "post-verify"> = [];
	const service = new WorktreeFinalizationServiceV1({
		onProgress(phase) {
			emitted.push(phase);
		},
		postMergeVerify: async () => ({ ok: true, exitCode: 0 }),
	});
	const input: WorktreeFinalizationInputV1 = {
		schemaVersion: 1,
		agentId,
		runId: `${agentId}-run`,
		mainCwd: root,
		worktree: {
			path: worktreePath,
			branch,
			ownership: { mode: "isolated", role: "worker", agentId, runId: `${agentId}-run` },
		},
		terminal: { state: "ok" },
		verify: { command: "true" },
	};
	const result = await service.finalize(input);
	assert.equal(result.result.merge === "merged" || result.result.merge === "already-integrated", true);
	assert.deepEqual(emitted, ["reconciling", "merging", "cleaning", "post-verify"]);

	const state: FinalizationFields = {};
	let now = 1_000;
	for (const phase of emitted) {
		assert.equal(applyFinalizationTransition(state, phase, now), true, `dropped ${phase} after ${state.finalizationPhase}`);
		now += 1_000;
	}
	assert.equal(state.finalizationPhase, "post-verify");
	assert.equal(canTransitionFinalizationPhase("cleaning", "post-verify"), true);
});

test("reset drops closeout fields so a resume is not stuck finalizing", () => {
	const state: FinalizationFields = {};
	applyFinalizationTransition(state, "verifying", 1, { verifyPid: 9 });
	resetFinalizationFields(state);
	assert.deepEqual(snapshotFinalizationFields(state), {});
});
