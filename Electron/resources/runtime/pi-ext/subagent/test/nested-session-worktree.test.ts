/**
 * Session-worktree nesting: a Boss workspace that is itself a linked worktree
 * must still place a worker under `{sessionToplevel}/.pi/worktrees/<id>` and
 * finalize (merge) back into that session tree — not the canonical checkout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveSubagentWorktree } from "../../../extensions/git-capability/agent/worktree-placement.ts";
import { registerGitWorktreeServiceProviderV1 } from "../../../extensions/git-capability/host/worktree/provider.ts";
import {
	finalizeWorktreeIfOwned,
	resetRememberedFinalizationsForTests,
} from "../worktree-finalize.ts";

registerGitWorktreeServiceProviderV1();

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
	return (result.stdout ?? "").trim();
}

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pipiui-nested-session-wt-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	writeFileSync(join(root, ".gitignore"), ".pi/\n");
	git(root, ["add", "README.md", ".gitignore"]);
	git(root, ["commit", "-m", "base"]);
	return realpathSync.native(root);
}

test("worker placement nested in a session worktree merges back to the session branch; main is unchanged", async (t) => {
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

	const sessionPath = join(root, ".pi", "worktrees", "session-nest");
	mkdirSync(join(root, ".pi", "worktrees"), { recursive: true });
	git(root, ["worktree", "add", "-b", "pipiui/session-nest", sessionPath, "HEAD"]);
	const sessionReal = realpathSync.native(sessionPath);
	assert.equal(git(sessionReal, ["rev-parse", "--abbrev-ref", "HEAD"]), "pipiui/session-nest");
	assert.equal(git(sessionReal, ["rev-parse", "--show-toplevel"]), sessionReal);

	const mainHeadBefore = git(root, ["rev-parse", "HEAD"]);

	const placement = resolveSubagentWorktree({
		agentId: "nest-w1",
		defaultCwd: sessionReal,
		readOnly: false,
		policy: { worktree: "isolated" },
		mainCwd: sessionReal,
		allowEnvironmentOptOut: false,
	});
	assert.equal(placement.worktreeError, undefined, placement.worktreeError ?? "");
	assert.ok(placement.worktreePath, "placement must create a worker worktree");
	assert.ok(placement.worktreeBranch, "placement must name a worker branch");
	const workerReal = realpathSync.native(placement.worktreePath);
	assert.equal(workerReal, join(sessionReal, ".pi", "worktrees", "nest-w1"));
	assert.equal(placement.worktreeBranch, "pipiui/nest-w1");
	assert.equal(git(workerReal, ["rev-parse", "--abbrev-ref", "HEAD"]), "pipiui/nest-w1");

	writeFileSync(join(workerReal, "feature.txt"), "from-nested-worker\n");
	git(workerReal, ["add", "feature.txt"]);
	git(workerReal, ["commit", "-m", "feat: nested worker change"]);

	const state = await finalizeWorktreeIfOwned({
		agentId: "nest-w1",
		runId: "nest-w1-run",
		mainCwd: sessionReal,
		worktreePath: placement.worktreePath,
		worktreeBranch: placement.worktreeBranch,
		role: "worker",
		terminalState: "ok",
	});
	assert.ok(state, "pi finalizer must run");
	assert.equal(state.result.merge === "merged" || state.result.merge === "already-integrated", true, JSON.stringify(state.result));
	assert.equal(state.result.disposition, "merged", JSON.stringify(state.result));
	assert.equal(existsSync(workerReal), false, "worker worktree is cleaned after merge");

	assert.equal(existsSync(join(sessionReal, "feature.txt")), true);
	assert.equal(git(sessionReal, ["rev-parse", "--abbrev-ref", "HEAD"]), "pipiui/session-nest");
	assert.match(git(sessionReal, ["log", "-1", "--pretty=%s"]), /nest-w1|nested worker/i);

	assert.equal(existsSync(join(root, "feature.txt")), false);
	assert.equal(git(root, ["rev-parse", "HEAD"]), mainHeadBefore);
	assert.equal(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
	const sessionNotOnMain = spawnSync("git", ["merge-base", "--is-ancestor", "pipiui/session-nest", "HEAD"], {
		cwd: root,
		encoding: "utf8",
		shell: false,
	});
	assert.notEqual(sessionNotOnMain.status, 0, "session branch must not be an ancestor of main HEAD");
});
