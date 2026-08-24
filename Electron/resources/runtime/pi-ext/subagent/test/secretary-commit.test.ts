import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
