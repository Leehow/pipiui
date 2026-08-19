import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	acquireAgentLease,
	claimAgentCleanupLease,
	inspectAgentLease,
	reapStaleAgentLease,
	releaseAgentCleanupLease,
} from "../agent-lease.ts";
import { NodeGitWorktreeAdapter } from "../../subagent-host/worktree/adapter.ts";
import {
	setLeftoverSweepHooksForTests,
	sweepLeftoverWorktreesV1,
} from "../../subagent-host/worktree/sweep.ts";
import { resetLeftoverWorktreeSweepForTests, WorktreeRecoveryStoreV1 } from "../worktree-recovery.ts";

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
}

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pipiui-leftover-sweep-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	git(root, ["add", "README.md"]);
	git(root, ["commit", "-m", "base"]);
	return root;
}

function sweepLeaseHooks(root: string) {
	return {
		inspect(agentId: string) {
			return inspectAgentLease(root, agentId).status;
		},
		reapStale(agentId: string) {
			return reapStaleAgentLease(root, agentId);
		},
		claimCleanup(agentId: string) {
			const claimed = claimAgentCleanupLease(root, agentId, "leftover-sweep");
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

function addWorker(root: string, agentId: string): { path: string; branch: string } {
	const worktree = join(root, ".pi", "worktrees", agentId);
	const branch = `pipiui/${agentId}`;
	mkdirSync(join(root, ".pi", "worktrees"), { recursive: true });
	git(root, ["worktree", "add", "-b", branch, worktree, "HEAD"]);
	return { path: worktree, branch };
}

test("sweep removes an already-integrated leftover and an empty orphan, keeps dirty/live/unique", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const integrated = addWorker(root, "already-merged");
	const unique = addWorker(root, "unique-commits");
	const dirty = addWorker(root, "dirty-tree");
	const live = addWorker(root, "live-lease");
	const orphan = join(root, ".pi", "worktrees", "empty-orphan");
	mkdirSync(orphan, { recursive: true });

	writeFileSync(join(unique.path, "unique.txt"), "unique\n");
	git(unique.path, ["add", "unique.txt"]);
	git(unique.path, ["commit", "-m", "unique"]);
	writeFileSync(join(dirty.path, "draft.txt"), "keep me\n");

	const leaseDir = join(root, ".pi", "agent-leases");
	mkdirSync(leaseDir, { recursive: true });
	writeFileSync(join(leaseDir, "live-lease.lease"), JSON.stringify({
		agentId: "live-lease",
		pid: process.pid,
		token: "live-token",
		createdAt: Date.now(),
	}));
	writeFileSync(join(leaseDir, "already-merged.lease"), JSON.stringify({
		agentId: "already-merged",
		pid: 999_999_999,
		processIdentity: "dead-owner",
		token: "stale-token",
		createdAt: Date.now() - 60_000,
	}));

	const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
	const summary = await sweepLeftoverWorktreesV1({
		mainCwd: root,
		adapter: new NodeGitWorktreeAdapter(),
		logger: {
			info(event, fields) { events.push({ event, fields }); },
			warn(event, fields) { events.push({ event, fields }); },
		},
		lease: sweepLeaseHooks(root),
	});

	assert.equal(summary.pruned, 2, JSON.stringify(summary.items));
	assert.equal(summary.dirty, 1);
	assert.equal(readFileSync(join(dirty.path, "draft.txt"), "utf8"), "keep me\n");
	assert.equal(spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", "refs/heads/pipiui/unique-commits"]).status, 0);
	assert.notEqual(spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", "refs/heads/pipiui/already-merged"]).status, 0);
	assert.equal(existsSync(integrated.path), false);
	assert.equal(existsSync(live.path), true);
	assert.equal(existsSync(unique.path), true);
	assert.equal(existsSync(orphan), false);
	assert.equal(inspectAgentLease(root, "already-merged").status, "absent");
	assert.equal(inspectAgentLease(root, "live-lease").status, "live");
	assert.ok(events.some((entry) => entry.event === "worktree-leftover-sweep" && entry.fields?.pruned === 2));
});

test("startup recovery load arms the leftover sweep only after decisions return", async (t) => {
	const previousDepth = process.env.PIPIUI_AGENT_DEPTH;
	process.env.PIPIUI_AGENT_DEPTH = "0";
	const root = makeRepo();
	t.after(() => {
		resetLeftoverWorktreeSweepForTests();
		rmSync(root, { recursive: true, force: true });
		if (previousDepth === undefined) delete process.env.PIPIUI_AGENT_DEPTH;
		else process.env.PIPIUI_AGENT_DEPTH = previousDepth;
	});
	const leftover = addWorker(root, "startup-integrated");
	const fixer = addWorker(root, "startup-fixer");
	const storePath = join(root, ".pi", "pipiui-memory", "worktree-recovery-default.json");
	mkdirSync(join(root, ".pi", "pipiui-memory"), { recursive: true });
	const store = new WorktreeRecoveryStoreV1(storePath);
	store.upsert("startup-fixer", { attempt: 1, fresh: false, inFlight: true, name: "general-purpose" });
	const loaded = store.load();
	assert.equal(loaded.records["startup-fixer"]?.inFlight, true);
	assert.equal(existsSync(leftover.path), true, "sweep must not run before recovery decisions return");
	assert.equal(existsSync(fixer.path), true);
	const deadline = Date.now() + 5_000;
	while (existsSync(leftover.path) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.equal(existsSync(leftover.path), false);
	assert.equal(existsSync(fixer.path), true);
});

test("sweep skips an in-flight fixer worktree even when its lease is already stale", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const fixer = addWorker(root, "in-flight-fixer");
	const summary = await sweepLeftoverWorktreesV1({
		mainCwd: root,
		activeAgentIds: ["in-flight-fixer"],
		adapter: new NodeGitWorktreeAdapter(),
		lease: {
			inspect() { return "stale"; },
			reapStale() { return true; },
		},
	});
	assert.equal(summary.pruned, 0);
	assert.equal(summary.items[0]?.disposition, "kept-active");
	assert.equal(existsSync(fixer.path), true);
});

test("sweep does not delete a worktree that becomes live after the unlocked precheck", async (t) => {
	const root = makeRepo();
	t.after(() => {
		setLeftoverSweepHooksForTests();
		rmSync(root, { recursive: true, force: true });
	});
	const leftover = addWorker(root, "race-live");
	setLeftoverSweepHooksForTests({
		afterLeasePrecheck(agentId) {
			if (agentId !== "race-live") return;
			const raced = acquireAgentLease(root, agentId);
			assert.ok(raced.lease, raced.problem);
		},
	});
	const summary = await sweepLeftoverWorktreesV1({
		mainCwd: root,
		adapter: new NodeGitWorktreeAdapter(),
		lease: sweepLeaseHooks(root),
	});
	assert.equal(existsSync(leftover.path), true);
	assert.equal(inspectAgentLease(root, "race-live").status, "live");
	assert.ok(summary.items.some((item) => item.agentId === "race-live" && item.disposition === "kept-live"));
});
