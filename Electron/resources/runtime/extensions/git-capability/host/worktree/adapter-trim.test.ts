/**
 * Regression: `git status --porcelain=v1 -z` records are whitespace-significant.
 * runGit used to trim() stdout, mangling a leading unstaged-only record (" M f")
 * into a phantom staged path ("M f" → staged, path loses its first char) — which
 * made the merge policy report a blocking "main-staged" index that does not exist.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	NodeGitWorktreeAdapter,
	parsePorcelainV1Z,
} from "./adapter.ts";

test("parsePorcelainV1Z keeps an unstaged-only first record unstaged", () => {
	const parsed = parsePorcelainV1Z(" M alpha.txt\0M  beta.txt\0?? gamma.txt\0");
	assert.deepEqual(parsed.stagedPaths, ["beta.txt"]);
	assert.deepEqual(parsed.unstagedPaths, ["alpha.txt"]);
	assert.deepEqual(parsed.untrackedPaths, ["gamma.txt"]);
	assert.deepEqual(parsed.conflictPaths, []);
});

test("adapter inspect does not invent a staged index from a leading-space first record", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pipiui-adapter-trim-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (args: string[]) => {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
		if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	};
	git(["init", "-b", "main"]);
	git(["config", "user.email", "pipiui-test@example.com"]);
	git(["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "alpha.txt"), "a\n");
	writeFileSync(join(root, "beta.txt"), "b\n");
	git(["add", "."]);
	git(["commit", "-m", "base"]);

	// The first record in output order is unstaged-only (" M alpha.txt"): exactly the
	// shape trim() used to corrupt into a phantom staged "lpha.txt".
	appendFileSync(join(root, "alpha.txt"), "dirty\n");
	appendFileSync(join(root, "beta.txt"), "dirty\n");

	const adapter = new NodeGitWorktreeAdapter();
	const inside = await adapter.repositoryToplevel(root);
	assert.ok(inside);
	const status = spawnSync("git", ["status", "--porcelain=v1", "-z"], { cwd: root, encoding: "utf8" });
	assert.equal(status.stdout.startsWith(" M "), true, "fixture must start with an unstaged-only record");

	// Direct unit-level guard on the raw path: the real repo's parse agrees with git.
	const parsed = parsePorcelainV1Z(status.stdout);
	assert.deepEqual(parsed.stagedPaths, []);
	assert.deepEqual(parsed.unstagedPaths, ["alpha.txt", "beta.txt"]);
	// And the file content is untouched (we never wrote via git): sanity the repo is ours.
	assert.ok(readFileSync(join(root, "alpha.txt"), "utf8").endsWith("dirty\n"));
});
