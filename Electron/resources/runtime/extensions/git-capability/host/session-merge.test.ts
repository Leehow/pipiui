import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSpawnV1 } from "./worktree/adapter.ts";
import { ensureSessionWorktree, sessionWorktreeBranch } from "./session-worktree.ts";
import { isSessionMergeBranch, mergeSessionWorktree } from "./session-merge.ts";

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

function gitOk(cwd: string, args: string[]): boolean {
	return spawnSync("git", args, { cwd, encoding: "utf8", shell: false }).status === 0;
}

function makeRepo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "pipiui-session-merge-")));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	writeFileSync(join(root, ".gitignore"), ".pi/\n");
	git(root, ["add", "README.md", ".gitignore"]);
	git(root, ["commit", "-m", "base"]);
	return root;
}

function commitIn(cwd: string, file: string, content: string, message: string): void {
	writeFileSync(join(cwd, file), content);
	git(cwd, ["add", file]);
	git(cwd, ["commit", "-m", message]);
}

function mergeHeadExists(cwd: string): boolean {
	const result = spawnSync("git", ["rev-parse", "--git-path", "MERGE_HEAD"], {
		cwd,
		encoding: "utf8",
		shell: false,
	});
	if (result.status !== 0) return false;
	const candidate = result.stdout.trim();
	const abs = candidate.startsWith("/") ? candidate : join(cwd, candidate);
	return existsSync(abs);
}

function porcelain(cwd: string): string {
	return git(cwd, ["status", "--porcelain"]);
}

async function sessionTree(root: string, title: string) {
	const created = await ensureSessionWorktree({
		canonicalRoot: root,
		sessionId: `s-${title}`,
		sessionTitle: title,
	});
	assert.equal(created.ok, true);
	if (!created.ok) throw new Error(created.error);
	return created;
}

test("isSessionMergeBranch accepts only pipiui/session-* slugs", () => {
	assert.equal(isSessionMergeBranch("pipiui/session-fix-login"), true);
	assert.equal(isSessionMergeBranch("pipiui/session-"), false);
	assert.equal(isSessionMergeBranch("pipiui/agent-foo"), false);
	assert.equal(isSessionMergeBranch("main"), false);
});

test("mergeSessionWorktree merges, then removes the worktree and session branch", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const created = await sessionTree(root, "demo");
	commitIn(created.worktreePath, "feature.txt", "from session\n", "session work");

	const state = await mergeSessionWorktree({
		canonicalRoot: root,
		sessionBranch: created.branch,
		worktreePath: created.worktreePath,
	});
	assert.equal(state.result.disposition, "merged");
	assert.equal(state.result.merge, "merged");
	assert.equal(state.result.cleanup, "cleaned");
	assert.equal(state.phase, "completed");
	assert.equal(existsSync(created.worktreePath), false);
	assert.equal(gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${created.branch}`]), false);
	assert.equal(git(root, ["log", "-1", "--pretty=%s"]).trim().startsWith("Merge branch"), true);
	assert.equal(existsSync(join(root, "feature.txt")), true);
});

test("conflict aborts MERGE_HEAD, leaves a clean main, and retains worktree+branch as needs-fixer", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const created = await sessionTree(root, "conflict");
	commitIn(created.worktreePath, "README.md", "session side\n", "session edit");
	commitIn(root, "README.md", "main side\n", "main edit");

	const state = await mergeSessionWorktree({
		canonicalRoot: root,
		sessionBranch: created.branch,
		worktreePath: created.worktreePath,
	});
	assert.equal(state.result.disposition, "needs-fixer");
	assert.equal(state.result.merge, "conflicted");
	assert.equal(state.result.conflict, "merge-conflict");
	assert.equal(state.result.recovery.disposition, "needs-fixer");
	assert.equal(state.result.recovery.nextAction, "resolve-conflict");
	assert.equal(state.result.recovery.retryable, true);
	assert.equal(state.result.cleanup, "not-attempted");
	assert.equal(state.phase, "recovery");
	assert.equal(mergeHeadExists(root), false);
	assert.equal(porcelain(root).trim(), "");
	assert.equal(existsSync(created.worktreePath), true);
	assert.equal(gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${created.branch}`]), true);
	assert.equal(gitOk(root, ["rev-parse", "--is-inside-work-tree"]), true);
});

test("disjoint dirty on main is allowed; a staged index blocks merge", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const created = await sessionTree(root, "dirty");
	commitIn(created.worktreePath, "session-only.txt", "session\n", "session file");

	appendFileSync(join(root, "README.md"), "local draft\n");
	const allowed = await mergeSessionWorktree({
		canonicalRoot: root,
		sessionBranch: created.branch,
		worktreePath: created.worktreePath,
	});
	assert.equal(allowed.result.disposition, "merged");
	assert.equal(allowed.result.merge, "merged");
	assert.equal(allowed.result.dirty, "disjoint-main-wip");
	assert.match(git(root, ["status", "--porcelain"]), /README\.md/);

	const second = await sessionTree(root, "staged");
	commitIn(second.worktreePath, "other.txt", "other\n", "other work");
	writeFileSync(join(root, "staged.txt"), "keep\n");
	git(root, ["add", "staged.txt"]);
	const blocked = await mergeSessionWorktree({
		canonicalRoot: root,
		sessionBranch: second.branch,
		worktreePath: second.worktreePath,
	});
	assert.equal(blocked.result.disposition, "needs-user");
	assert.equal(blocked.result.dirty, "main-staged");
	assert.equal(blocked.result.merge, "not-attempted");
	assert.equal(existsSync(second.worktreePath), true);
	assert.equal(gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${second.branch}`]), true);
});

test("a second mergeSessionWorktree call after success is idempotent", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const created = await sessionTree(root, "again");
	commitIn(created.worktreePath, "once.txt", "once\n", "once");

	const first = await mergeSessionWorktree({
		canonicalRoot: root,
		sessionBranch: created.branch,
		worktreePath: created.worktreePath,
	});
	assert.equal(first.result.disposition, "merged");
	assert.equal(first.result.merge, "merged");

	const second = await mergeSessionWorktree({
		canonicalRoot: root,
		sessionBranch: created.branch,
		worktreePath: created.worktreePath,
	});
	assert.equal(second.result.disposition, "merged");
	assert.equal(second.result.merge, "already-integrated");
	assert.equal(second.result.cleanup, "cleaned");
	assert.equal(gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${created.branch}`]), false);
});

test("non pipiui/session-* branches are refused and never deleted", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const workerPath = join(root, ".pi", "worktrees", "agent-foo");
	git(root, ["worktree", "add", "-b", "pipiui/agent-foo", workerPath, "HEAD"]);
	commitIn(workerPath, "worker.txt", "worker\n", "worker commit");

	const state = await mergeSessionWorktree({
		canonicalRoot: root,
		sessionBranch: "pipiui/agent-foo",
		worktreePath: workerPath,
	});
	assert.equal(state.result.disposition, "needs-user");
	assert.equal(state.result.merge, "not-attempted");
	assert.equal(state.result.cleanup, "not-attempted");
	assert.equal(gitOk(root, ["show-ref", "--verify", "--quiet", "refs/heads/pipiui/agent-foo"]), true);
	assert.equal(existsSync(workerPath), true);
	assert.equal(isSessionMergeBranch("pipiui/agent-foo"), false);
	assert.equal(sessionWorktreeBranch("agent-foo").startsWith("pipiui/session-"), true);
});

test("runGit stdout is not trimmed: rev-parse keeps its trailing newline", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const result = await runSpawnV1("git", ["-C", root, "rev-parse", "--verify", "HEAD"]);
	assert.equal(result.ok, true);
	assert.equal(result.stdout.endsWith("\n"), true);
	assert.notEqual(result.stdout, result.stdout.trim());
	assert.match(result.stdout.trim(), /^[0-9a-f]{40}$/);
});
