import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	runSecretaryCommit,
	type SecretaryCommitInput,
} from "../secretary-commit.ts";

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pipiui-secretary-commit-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	git(root, ["add", "README.md"]);
	git(root, ["commit", "-m", "base"]);
	return root;
}

function dirty(root: string, name = "docs.md"): void {
	writeFileSync(join(root, name), "changed\n");
}

function input(overrides: Partial<SecretaryCommitInput> = {}): SecretaryCommitInput {
	return {
		closeout: "pass",
		integrationVerify: "pass",
		commitMessage: "docs: update the closeout note",
		paths: ["docs.md"],
		allRelevantItemsClassified: true,
		dispositions: [{ item: "agent-1", disposition: "cleaned" }],
		...overrides,
	};
}

function context(root: string) {
	return { processRole: "closeout-secretary", mainCwd: root };
}

test("a passing verification commits exactly the manifest", () => {
	const root = makeRepo();
	try {
		dirty(root);
		const result = runSecretaryCommit(input(), context(root));
		assert.match(result.commit, /^created:[0-9a-f]{40}$/);
		assert.deepEqual(result.committedPaths, ["docs.md"]);
		assert.deepEqual(result.remainingDirtyPaths, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a task with no executable verification commits when the secretary says why", () => {
	const root = makeRepo();
	try {
		dirty(root);
		const result = runSecretaryCommit(
			input({
				integrationVerify: "none",
				verificationUnavailable: "prompt-layer text change; this repo has no command that exercises it",
			}),
			context(root),
		);
		assert.match(result.commit, /^created:[0-9a-f]{40}$/);
		assert.deepEqual(result.committedPaths, ["docs.md"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("verification=none without a stated reason is still blocked", () => {
	const root = makeRepo();
	try {
		dirty(root);
		for (const missing of [undefined, "", "   ", "line\nbreak"]) {
			const result = runSecretaryCommit(
				input({ integrationVerify: "none", verificationUnavailable: missing }),
				context(root),
			);
			assert.equal(result.commit, "blocked:verification-none-without-stated-reason");
			assert.deepEqual(result.committedPaths, []);
			assert.deepEqual(result.remainingDirtyPaths, ["docs.md"]);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a failed verification is never committed, stated reason or not", () => {
	const root = makeRepo();
	try {
		dirty(root);
		const result = runSecretaryCommit(
			input({ integrationVerify: "fail", verificationUnavailable: "tests are red but ship it" }),
			context(root),
		);
		assert.equal(result.commit, "blocked:integration-verify-not-pass");
		assert.deepEqual(result.committedPaths, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an unrelated dirty file stays dirty and out of the commit", () => {
	const root = makeRepo();
	try {
		dirty(root);
		dirty(root, "someone-elses-work.ts");
		const result = runSecretaryCommit(
			input({ integrationVerify: "none", verificationUnavailable: "docs-only change" }),
			context(root),
		);
		assert.match(result.commit, /^created:[0-9a-f]{40}$/);
		assert.deepEqual(result.committedPaths, ["docs.md"]);
		assert.deepEqual(result.remainingDirtyPaths, ["someone-elses-work.ts"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a clean tree is a finished goal, not a commit", () => {
	const root = makeRepo();
	try {
		const result = runSecretaryCommit(
			input({ integrationVerify: "none", verificationUnavailable: "nothing to verify", paths: [] }),
			context(root),
		);
		assert.match(result.commit, /^already-clean:[0-9a-f]{40}$/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an identical-content delete/add move commits when the manifest lists both paths", () => {
	const root = movedBlobRepo();
	try {
		const result = runSecretaryCommit(
			input({
				paths: ["legacy/inspector.ts", "vendor/inspector.ts"],
				commitMessage: "refactor: move inspector blob to the vendor mirror",
			}),
			context(root),
		);

		assert.match(result.commit, /^created:[0-9a-f]{40}$/);
		assert.deepEqual(result.committedPaths.sort(), ["legacy/inspector.ts", "vendor/inspector.ts"]);
		// `--no-renames` for the assertion too: `show` rename-collapses the pair (R100)
		// even though the commit itself records the exact delete and add.
		const committed = git(root, ["show", "--no-renames", "--name-status", "--format=", "HEAD"]);
		assert.match(committed, /^D\tlegacy\/inspector\.ts$/m);
		assert.match(committed, /^A\tvendor\/inspector\.ts$/m);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

/** A committed legacy blob that moves to the vendor path with byte-identical content. */
function movedBlobRepo(): string {
	const root = makeRepo();
	mkdirSync(join(root, "legacy"), { recursive: true });
	writeFileSync(join(root, "legacy", "inspector.ts"), "inspector\n");
	git(root, ["add", "legacy/inspector.ts"]);
	git(root, ["commit", "-m", "add legacy blob"]);
	const blob = readFileSync(join(root, "legacy", "inspector.ts"));
	rmSync(join(root, "legacy/inspector.ts"));
	mkdirSync(join(root, "vendor"), { recursive: true });
	writeFileSync(join(root, "vendor", "inspector.ts"), blob);
	// Pin the environment the bug manifests in: rename detection is git's default.
	git(root, ["config", "diff.renames", "true"]);
	return root;
}

function moveManifest(paths: string[]): SecretaryCommitInput {
	return input({
		paths,
		commitMessage: "refactor: move inspector blob to the vendor mirror",
	});
}

function assertNothingStaged(root: string): void {
	const lines = git(root, ["status", "--porcelain=v1"]).split("\n").filter(Boolean);
	const staged = lines.filter((line) => line[0] !== " " && line[0] !== "?");
	assert.deepEqual(staged, [], "the helper index must be cleared after a block");
}

test("a genuinely mismatched manifest still blocks", () => {
	// The manifest names one path more than it actually moved: the unchanged extra
	// file stages but produces no index delta, so the staged set can never equal it.
	const root = movedBlobRepo();
	writeFileSync(join(root, "unchanged.md"), "untouched\n");
	git(root, ["add", "unchanged.md"]);
	git(root, ["commit", "-m", "add unchanged.md"]);
	try {
		const result = runSecretaryCommit(
			moveManifest(["legacy/inspector.ts", "vendor/inspector.ts", "unchanged.md"]),
			context(root),
		);
		assert.equal(result.commit, "blocked:staged-set-does-not-match-manifest");
		assert.deepEqual(result.committedPaths, []);
		assertNothingStaged(root);
		assert.deepEqual(result.remainingDirtyPaths.sort(), [
			"legacy/inspector.ts",
			"vendor/inspector.ts",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}

	// A manifest path that matches nothing fails closed at staging.
	const phantom = movedBlobRepo();
	try {
		const result = runSecretaryCommit(
			moveManifest(["legacy/inspector.ts", "vendor/inspector.ts", "phantom.ts"]),
			context(phantom),
		);
		assert.match(result.commit, /^blocked:/);
		assertNothingStaged(phantom);
	} finally {
		rmSync(phantom, { recursive: true, force: true });
	}
});

test("the gate is still closed to a non-secretary role and a failed closeout", () => {
	const root = makeRepo();
	try {
		dirty(root);
		assert.equal(
			runSecretaryCommit(input(), { processRole: "general-purpose", mainCwd: root }).commit,
			"blocked:wrong-runtime-role",
		);
		assert.equal(
			runSecretaryCommit(input({ closeout: "needs-action" }), context(root)).commit,
			"blocked:closeout-not-pass",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("secretary commits onto a session worktree branch; main checkout is untouched", () => {
	const root = makeRepo();
	try {
		mkdirSync(join(root, ".pi", "worktrees"), { recursive: true });
		const session = join(root, ".pi", "worktrees", "session-docs");
		git(root, ["worktree", "add", "-b", "pipiui/session-docs", session, "HEAD"]);
		dirty(session);
		const result = runSecretaryCommit(input(), context(session));
		assert.notEqual(
			result.commit,
			"blocked:main-cwd-is-not-canonical-git-root",
			"linked worktree toplevel equals the worktree path, so canonicalGitRoot must pass",
		);
		assert.match(result.commit, /^created:[0-9a-f]{40}$/);
		assert.deepEqual(result.committedPaths, ["docs.md"]);
		assert.deepEqual(result.remainingDirtyPaths, []);
		assert.equal(git(session, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(), "pipiui/session-docs");
		assert.match(git(session, ["log", "-1", "--pretty=%s"]), /docs: update the closeout note/);
		assert.equal(existsSync(join(root, "docs.md")), false);
		assert.match(git(root, ["log", "-1", "--pretty=%s"]), /base/);
		assert.equal(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(), "main");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
