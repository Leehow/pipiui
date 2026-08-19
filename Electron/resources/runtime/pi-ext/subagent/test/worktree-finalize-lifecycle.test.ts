import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAutoMergeReadinessV1 } from "../../subagent-host/worktree/policy.ts";
import { NodeGitWorktreeAdapter } from "../../subagent-host/worktree/adapter.ts";
import { WorktreeFinalizationServiceV1 } from "../../subagent-host/worktree/service.ts";
import { sweepLeftoverWorktreesV1 } from "../../subagent-host/worktree/sweep.ts";
import type { WorktreeFinalizationInputV1, WorktreeFinalizationStateV1 } from "../../subagent-host/worktree/schema.ts";
import {
	acquireAgentLease,
	agentLeaseFile,
	claimAgentCleanupLease,
	inspectAgentLease,
	reapStaleAgentLease,
	releaseAgentCleanupLease,
} from "../agent-lease.ts";
import {
	finalizeWorktreeIfOwned,
	lifecycleForFinalization,
	reenterFinalizeOnBossAccept,
	resetRememberedFinalizationsForTests,
} from "../worktree-finalize.ts";

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
}

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pipiui-finalize-lifecycle-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	git(root, ["add", "README.md"]);
	git(root, ["commit", "-m", "base"]);
	return root;
}

function addWorker(root: string, agentId: string): { path: string; branch: string } {
	const worktree = join(root, ".pi", "worktrees", agentId);
	const branch = `pipiui/${agentId}`;
	mkdirSync(join(root, ".pi", "worktrees"), { recursive: true });
	git(root, ["worktree", "add", "-b", branch, worktree, "HEAD"]);
	return { path: worktree, branch };
}

function inputFor(
	root: string,
	agentId: string,
	placement: { path: string; branch: string },
	overrides: Partial<WorktreeFinalizationInputV1> = {},
): WorktreeFinalizationInputV1 {
	return {
		schemaVersion: 1,
		agentId,
		runId: `${agentId}-run`,
		mainCwd: root,
		worktree: {
			path: placement.path,
			branch: placement.branch,
			ownership: { mode: "isolated", role: "worker", agentId, runId: `${agentId}-run` },
		},
		terminal: { state: "ok" },
		...overrides,
	};
}

function projectionState(partial: Partial<WorktreeFinalizationStateV1["result"]>): WorktreeFinalizationStateV1 {
	return {
		schemaVersion: 1,
		attempt: 1,
		createdAt: "t",
		updatedAt: "t",
		phase: "completed",
		input: inputFor("/tmp", "x", { path: "/tmp/x", branch: "pipiui/x" }),
		result: {
			schemaVersion: 1,
			agentId: "x",
			runId: "x-run",
			mainCwd: "/tmp",
			worktree: { path: "/tmp/x", branch: "pipiui/x" },
			terminal: "ok",
			disposition: "merged",
			ownership: "verified",
			dirty: "clean",
			conflict: "none",
			merge: "merged",
			recovery: { disposition: "none", nextAction: "none", retryable: false, reason: "", actionable: [] },
			cleanup: "cleaned",
			verify: { terminal: "none", postMerge: "not-requested" },
			messages: [],
			updatedAt: "t",
			...partial,
		},
	};
}

test("lifecycle projection: merged closes; retained/needs-fixer stay pendingReview", () => {
	assert.equal(lifecycleForFinalization(projectionState({})), "merged");
	assert.equal(
		lifecycleForFinalization(projectionState({ cleanup: "retained-worktree", disposition: "needs-fixer" })),
		"mergedCleanupPending",
	);
	assert.equal(
		lifecycleForFinalization(projectionState({
			disposition: "needs-fixer",
			merge: "not-attempted",
			cleanup: "not-attempted",
		})),
		"pendingReview",
	);
	assert.equal(
		lifecycleForFinalization(projectionState({
			disposition: "retained",
			merge: "not-attempted",
			cleanup: "not-attempted",
		})),
		"pendingReview",
	);
});

test("boss acceptance re-enters readiness without skipping dirty/verify/ownership", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dirty = addWorker(root, "dirty-accept");
	writeFileSync(join(dirty.path, "draft.txt"), "keep\n");
	const adapter = new NodeGitWorktreeAdapter();
	const inspection = await adapter.inspect(inputFor(root, "dirty-accept", dirty, {
		terminal: { state: "failed" },
		acceptance: { source: "boss" },
	}));
	const readiness = evaluateAutoMergeReadinessV1(
		inputFor(root, "dirty-accept", dirty, { terminal: { state: "failed" }, acceptance: { source: "boss" } }),
		inspection,
	);
	assert.equal(readiness.ready, false);
	assert.equal(readiness.dirty, "worktree-dirty");

	const verifyFail = addWorker(root, "verify-fail");
	writeFileSync(join(verifyFail.path, "ok.txt"), "ok\n");
	git(verifyFail.path, ["add", "ok.txt"]);
	git(verifyFail.path, ["commit", "-m", "ok"]);
	const verifyInspection = await adapter.inspect(inputFor(root, "verify-fail", verifyFail));
	const blockedVerify = evaluateAutoMergeReadinessV1(
		inputFor(root, "verify-fail", verifyFail, {
			terminal: { state: "failed" },
			acceptance: { source: "boss" },
			verify: { command: "false", exitCode: 1 },
		}),
		verifyInspection,
	);
	assert.equal(blockedVerify.ready, false);
	assert.equal(blockedVerify.disposition, "needs-fixer");
});

test("first end not ready then boss resolve reentry merges; second resolve is idempotent", async (t) => {
	const previous = process.env.PIPIUI_WORKTREE_FINALIZER;
	process.env.PIPIUI_WORKTREE_FINALIZER = "pi";
	resetRememberedFinalizationsForTests();
	const root = makeRepo();
	t.after(() => {
		resetRememberedFinalizationsForTests();
		rmSync(root, { recursive: true, force: true });
		if (previous === undefined) delete process.env.PIPIUI_WORKTREE_FINALIZER;
		else process.env.PIPIUI_WORKTREE_FINALIZER = previous;
	});
	const worker = addWorker(root, "reenter-ok");
	writeFileSync(join(worker.path, "feature.txt"), "land\n");
	git(worker.path, ["add", "feature.txt"]);
	git(worker.path, ["commit", "-m", "feature"]);

	const first = await finalizeWorktreeIfOwned({
		agentId: "reenter-ok",
		runId: "reenter-ok-run",
		mainCwd: root,
		worktreePath: worker.path,
		worktreeBranch: worker.branch,
		role: "worker",
		terminalState: "failed",
	});
	assert.equal(first?.result.disposition, "retained");
	assert.equal(existsSync(worker.path), true);

	const second = await reenterFinalizeOnBossAccept({
		agentId: "reenter-ok",
		runId: "reenter-ok-run",
	});
	assert.ok(second);
	assert.equal(second.result.merge === "merged" || second.result.merge === "already-integrated", true);
	assert.equal(second.result.disposition, "merged");
	assert.equal(lifecycleForFinalization(second), "merged");
	assert.equal(existsSync(worker.path), false);

	const third = await reenterFinalizeOnBossAccept({
		agentId: "reenter-ok",
		runId: "reenter-ok-run",
	});
	assert.ok(third?.result.merge === "merged" || third?.result.merge === "already-integrated");
	assert.equal(third?.result.disposition, "merged");
});

test("live lease, unique commits, and verify-fail keep the worktree after merge attempt / sweep", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const unique = addWorker(root, "unique-keep");
	writeFileSync(join(unique.path, "unique.txt"), "u\n");
	git(unique.path, ["add", "unique.txt"]);
	git(unique.path, ["commit", "-m", "unique"]);
	const live = addWorker(root, "live-keep");
	const dirty = addWorker(root, "dirty-keep");
	writeFileSync(join(dirty.path, "draft.txt"), "d\n");

	const service = new WorktreeFinalizationServiceV1({
		lease: {
			inspect(agentId) {
				return agentId === "live-keep" ? "live" : "absent";
			},
		},
	});
	const liveResult = await service.finalize(inputFor(root, "live-keep", live));
	assert.notEqual(liveResult.result.disposition, "merged");
	assert.equal(existsSync(live.path), true);

	const summary = await sweepLeftoverWorktreesV1({
		mainCwd: root,
		adapter: new NodeGitWorktreeAdapter(),
		lease: {
			inspect(agentId) {
				return agentId === "live-keep" ? "live" : "absent";
			},
			claimCleanup(agentId) {
				if (agentId === "live-keep") {
					return { ok: false as const, status: "live" as const, message: "live" };
				}
				return {
					ok: true as const,
					claim: { releaseOnEnd: true, release() {} },
				};
			},
		},
	});
	assert.equal(existsSync(unique.path), true);
	assert.equal(existsSync(dirty.path), true);
	assert.ok(summary.items.some((item) => item.agentId === "unique-keep" && item.disposition === "kept-unique"));
	assert.ok(summary.items.some((item) => item.agentId === "dirty-keep" && item.disposition === "kept-dirty"));
	assert.ok(summary.items.some((item) => item.agentId === "live-keep" && item.disposition === "kept-live"));
});

test("merge completed but first remove failed is later swept without --force", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const worker = addWorker(root, "remove-retry");
	writeFileSync(join(worker.path, "landed.txt"), "ok\n");
	git(worker.path, ["add", "landed.txt"]);
	git(worker.path, ["commit", "-m", "land"]);

	const adapter = new NodeGitWorktreeAdapter();
	let removeAttempts = 0;
	const flaky = new Proxy(adapter, {
		get(target, prop, receiver) {
			if (prop === "removeWorktree") {
				return async (mainCwd: string, worktreePath: string) => {
					removeAttempts += 1;
					if (removeAttempts === 1) {
						return { ok: false, exitCode: 1, stdout: "", stderr: "simulated lock", error: "simulated lock" };
					}
					return target.removeWorktree(mainCwd, worktreePath);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	const first = await new WorktreeFinalizationServiceV1({ adapter: flaky }).finalize(inputFor(root, "remove-retry", worker));
	assert.equal(first.result.merge, "merged");
	assert.equal(first.result.cleanup, "retained-worktree");
	assert.equal(existsSync(worker.path), true);
	assert.equal(lifecycleForFinalization(first), "mergedCleanupPending");

	const summary = await sweepLeftoverWorktreesV1({
		mainCwd: root,
		adapter: new NodeGitWorktreeAdapter(),
		lease: realLeaseHooks(root),
	});
	assert.equal(existsSync(worker.path), false);
	assert.ok(summary.items.some((item) => item.disposition === "pruned"));
});

function realLeaseHooks(root: string) {
	return {
		inspect(agentId: string) {
			return inspectAgentLease(root, agentId).status;
		},
		reapStale(agentId: string) {
			return reapStaleAgentLease(root, agentId);
		},
		claimCleanup(agentId: string) {
			const claimed = claimAgentCleanupLease(root, agentId, `${agentId}-run`);
			if (!claimed.lease) {
				return {
					ok: false as const,
					status: inspectAgentLease(root, agentId).status,
					message: claimed.problem,
				};
			}
			return {
				ok: true as const,
				claim: {
					releaseOnEnd: claimed.created,
					release() {
						releaseAgentCleanupLease(claimed);
					},
				},
			};
		},
	};
}

function writeForeignLiveLease(root: string, agentId: string): void {
	const filePath = agentLeaseFile(root, agentId);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		JSON.stringify({
			agentId,
			pid: 1,
			token: "foreign-live-token",
			createdAt: Date.now(),
		}),
		"utf8",
	);
}

test("own live lease allows integrated cleanup; other live lease blocks", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const own = addWorker(root, "own-lease");
	writeFileSync(join(own.path, "own.txt"), "own\n");
	git(own.path, ["add", "own.txt"]);
	git(own.path, ["commit", "-m", "own"]);
	const held = acquireAgentLease(root, "own-lease");
	assert.ok(held.lease);
	const service = new WorktreeFinalizationServiceV1({ lease: realLeaseHooks(root) });
	const ownResult = await service.finalize(inputFor(root, "own-lease", own));
	assert.equal(ownResult.result.merge, "merged");
	assert.equal(ownResult.result.cleanup, "cleaned");
	assert.equal(ownResult.result.disposition, "merged");
	assert.equal(existsSync(own.path), false);
	assert.equal(inspectAgentLease(root, "own-lease").status, "live", "reused worker lease must remain");

	const other = addWorker(root, "other-lease");
	writeFileSync(join(other.path, "other.txt"), "other\n");
	git(other.path, ["add", "other.txt"]);
	git(other.path, ["commit", "-m", "other"]);
	writeForeignLiveLease(root, "other-lease");
	const otherResult = await service.finalize(inputFor(root, "other-lease", other));
	assert.equal(otherResult.result.merge, "merged");
	assert.equal(otherResult.result.cleanup, "retained-worktree");
	assert.equal(existsSync(other.path), true);
	assert.equal(inspectAgentLease(root, "other-lease").status, "live");
});

test("acquire during cleanup critical section cannot steal ownership", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const worker = addWorker(root, "race-keep");
	writeFileSync(join(worker.path, "race.txt"), "race\n");
	git(worker.path, ["add", "race.txt"]);
	git(worker.path, ["commit", "-m", "race"]);
	const adapter = new NodeGitWorktreeAdapter();
	let racedProblem: string | undefined;
	const guarded = new Proxy(adapter, {
		get(target, prop, receiver) {
			if (prop === "removeWorktree") {
				return async (mainCwd: string, worktreePath: string) => {
					const raced = acquireAgentLease(root, "race-keep");
					racedProblem = raced.problem;
					return target.removeWorktree(mainCwd, worktreePath);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const result = await new WorktreeFinalizationServiceV1({
		adapter: guarded,
		lease: realLeaseHooks(root),
	}).finalize(inputFor(root, "race-keep", worker));
	assert.equal(result.result.merge, "merged");
	assert.equal(result.result.cleanup, "cleaned");
	assert.ok(racedProblem, "racer must fail exclusive create while cleanup holds the lease");
	assert.match(racedProblem, /already running/);
});

test("subagent index.ts parses as TypeScript", () => {
	const indexUrl = new URL("../index.ts", import.meta.url);
	const source = readFileSync(indexUrl, "utf8");
	const requireFromElectron = createRequire(fileURLToPath(new URL("../../../../../package.json", import.meta.url)));
	const ts = requireFromElectron("typescript") as typeof import("typescript");
	const file = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const diagnostics = (file as { parseDiagnostics?: Array<{ messageText: string | { messageText: string } }> }).parseDiagnostics ?? [];
	assert.deepEqual(
		diagnostics.map((item) => typeof item.messageText === "string" ? item.messageText : item.messageText.messageText),
		[],
	);
	assert.equal(/\}\s*\n\s*\.\.\(placement\.worktreeBranch/.test(source), false);
});
