import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createGitWorktreeServiceProviderV1,
	requestGitWorktreeServiceProviderV1,
} from "./provider.ts";

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
}

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pipiui-git-provider-probe-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	git(root, ["add", "README.md"]);
	git(root, ["commit", "-m", "base"]);
	return root;
}

test("createGitWorktreeServiceProviderV1 does not register a global provider", () => {
	const previous = requestGitWorktreeServiceProviderV1();
	const PROVIDER_KEY = Symbol.for("pipiui.git-capability.worktree-provider.v1");
	delete (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY];
	const local = createGitWorktreeServiceProviderV1();
	assert.equal(requestGitWorktreeServiceProviderV1(), undefined);
	assert.equal(typeof local.probeMainDirty, "function");
	if (previous) (globalThis as Record<PropertyKey, unknown>)[PROVIDER_KEY] = previous;
});

test("probeMainDirty is false for a clean repo, true for dirty or unreadable cwd", (t) => {
	const provider = createGitWorktreeServiceProviderV1();
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	assert.equal(provider.probeMainDirty(root), false);

	writeFileSync(join(root, "draft.txt"), "keep\n");
	assert.equal(provider.probeMainDirty(root), true);

	assert.equal(provider.probeMainDirty(join(root, "definitely-missing")), true);
	assert.equal(provider.probeMainDirty("/tmp/pipiui-not-a-git-repo-" + Date.now()), true);
});
