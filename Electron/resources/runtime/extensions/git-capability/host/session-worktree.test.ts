import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	SESSION_WORKTREE_SLUG_MAX,
	ensureSessionWorktree,
	sessionWorktreeBranch,
	sessionWorktreeDirName,
	sessionWorktreeSlug,
} from "./session-worktree.ts";

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
}

function makeRepo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "pipiui-session-wt-")));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	git(root, ["add", "README.md"]);
	git(root, ["commit", "-m", "base"]);
	return root;
}

test("sessionWorktreeSlug kebabs a title and caps at 24 characters", () => {
	assert.equal(sessionWorktreeSlug("Fix Login Bug!"), "fix-login-bug");
	assert.equal(sessionWorktreeSlug("  Hello   World  "), "hello-world");
	assert.equal(sessionWorktreeSlug("Fix_the_Login"), "fix-the-login");
	const long = sessionWorktreeSlug("Write a Really Long Session Title About Things");
	assert.ok(long.length <= SESSION_WORKTREE_SLUG_MAX);
	assert.equal(long.endsWith("-"), false);
	assert.match(long, /^[a-z0-9][a-z0-9-]*$/);
});

test("sessionWorktreeSlug falls back to sessionId then untitled", () => {
	assert.equal(sessionWorktreeSlug(""), "untitled");
	assert.equal(sessionWorktreeSlug(undefined), "untitled");
	assert.equal(sessionWorktreeSlug("你好世界"), "untitled");
	assert.equal(sessionWorktreeSlug("", "Hello World"), "hello-world");
	assert.equal(sessionWorktreeSlug(undefined, "sess_ABC"), "sess-abc");
	assert.equal(sessionWorktreeSlug("!!!", "---"), "untitled");
});

test("ensureSessionWorktree rejects a non-git directory", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pipiui-session-nongit-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const result = await ensureSessionWorktree({
		canonicalRoot: root,
		sessionId: "s1",
		sessionTitle: "Fix Login",
	});
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.code, "not-git");
});

test("ensureSessionWorktree creates and reuses the preferred session worktree", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = await ensureSessionWorktree({
		canonicalRoot: root,
		sessionId: "s1",
		sessionTitle: "Fix Login",
	});
	assert.equal(first.ok, true);
	if (!first.ok) return;
	assert.equal(first.branch, sessionWorktreeBranch("fix-login"));
	assert.equal(first.worktreePath, join(root, ".pi", "worktrees", sessionWorktreeDirName("fix-login")));
	assert.equal(first.workspaceCwd, first.worktreePath);

	const second = await ensureSessionWorktree({
		canonicalRoot: root,
		sessionId: "s1",
		sessionTitle: "Fix Login",
	});
	assert.equal(second.ok, true);
	if (!second.ok) return;
	assert.equal(second.worktreePath, first.worktreePath);
	assert.equal(second.branch, first.branch);
});

test("ensureSessionWorktree suffixes the slug when the preferred path is blocked", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const worktrees = join(root, ".pi", "worktrees");
	mkdirSync(worktrees, { recursive: true });
	writeFileSync(join(worktrees, sessionWorktreeDirName("demo")), "not a directory leftover\n");

	const result = await ensureSessionWorktree({
		canonicalRoot: root,
		sessionId: "s-demo",
		sessionTitle: "demo",
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.branch, sessionWorktreeBranch("demo-2"));
	assert.equal(result.worktreePath, join(worktrees, sessionWorktreeDirName("demo-2")));
});

test("ensureSessionWorktree restores a sidecar path after the directory is removed", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const created = await ensureSessionWorktree({
		canonicalRoot: root,
		sessionId: "s-restore",
		sessionTitle: "Restore Me",
	});
	assert.equal(created.ok, true);
	if (!created.ok) return;
	rmSync(created.worktreePath, { recursive: true, force: true });
	git(root, ["worktree", "prune"]);

	const restored = await ensureSessionWorktree({
		canonicalRoot: root,
		sessionId: "s-restore",
		sessionTitle: "ignored title",
		existing: { branch: created.branch, worktreePath: created.worktreePath },
	});
	assert.equal(restored.ok, true);
	if (!restored.ok) return;
	assert.equal(restored.branch, created.branch);
	assert.equal(restored.worktreePath, created.worktreePath);
});
