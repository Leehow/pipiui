/**
 * pi-side worktree finalization, against real Git.
 *
 * Creating a worker's worktree was already pi's job; finishing with it was the Swift app's, and
 * a portable implementation of the same semantics sat unused in subagent-host/worktree. These
 * tests cover the wire between them, and above all the default: two finalizers on one
 * repository is worse than either alone, so an un-opted host must see pi touch nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const piExtDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt");
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd });
}

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-agent-core"), join(scoped, "pi-agent-core"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

/**
 * A main checkout with one committed file, plus a worker worktree on its own branch that has
 * added a second file — the exact shape a writable worker leaves behind.
 */
async function makeWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-worktree-finalize-"));
  // The extension imports its sibling subagent-host, so both must be present.
  await cp(piExtDirectory, join(directory, "PiExt"), { recursive: true });
  await linkRuntimePackages(directory);

  const main = join(directory, "main");
  await mkdir(main, { recursive: true });
  await git(main, "init", "--initial-branch=main");
  await git(main, "config", "user.email", "test@example.com");
  await git(main, "config", "user.name", "Test");
  await writeFile(join(main, "base.txt"), "base\n", "utf-8");
  await git(main, "add", "base.txt");
  await git(main, "commit", "-m", "base");

  const worktreePath = join(main, ".pi/worktrees/agent-one");
  const branch = "pipiui/agent-one";
  await git(main, "worktree", "add", worktreePath, "-b", branch, "HEAD");
  await writeFile(join(worktreePath, "worker.txt"), "worker output\n", "utf-8");
  await git(worktreePath, "add", "worker.txt");
  await git(worktreePath, "commit", "-m", "worker change");

  return { directory, main, worktreePath, branch };
}

/** Run finalization in a child process with the given env, and return its printed summary. */
async function finalize({ directory, main, worktreePath, branch }, env, terminalState = "ok") {
  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    [
      'import { finalizeWorktreeIfOwned, summarizeFinalization } from "./PiExt/subagent/worktree-finalize.ts";',
      "const state = await finalizeWorktreeIfOwned({",
      '  agentId: "agent-one",',
      '  runId: "run-1",',
      `  mainCwd: ${JSON.stringify(main)},`,
      `  worktreePath: ${JSON.stringify(worktreePath)},`,
      `  worktreeBranch: ${JSON.stringify(branch)},`,
      '  role: "worker",',
      `  terminalState: ${JSON.stringify(terminalState)},`,
      "});",
      'console.log(state ? summarizeFinalization(state) : "SKIPPED");',
    ].join("\n"),
    "utf-8",
  );
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
    cwd: directory,
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

test("with no opt-in, pi does not touch Git at all", async () => {
  const workspace = await makeWorkspace();
  const summary = await finalize(workspace, { PIPIUI_WORKTREE_FINALIZER: "" });

  assert.equal(summary, "SKIPPED");
  const { stdout: log } = await git(workspace.main, "log", "--oneline", "main");
  assert.equal(log.trim().split("\n").length, 1, "the host's merge must not have been done for it");
  assert.ok(existsSync(workspace.worktreePath), "an un-opted host still owns its worktree");
});

test("a host that opts another finalizer in is still not pi", async () => {
  const workspace = await makeWorkspace();
  assert.equal(await finalize(workspace, { PIPIUI_WORKTREE_FINALIZER: "swift" }), "SKIPPED");
  assert.ok(existsSync(workspace.worktreePath));
});

test("opted in, a successful run is merged and its worktree removed", async () => {
  const workspace = await makeWorkspace();
  const summary = await finalize(workspace, { PIPIUI_WORKTREE_FINALIZER: "pi" });

  assert.match(summary, /merge=merged/, `expected a real merge, got: ${summary}`);
  const { stdout: files } = await git(workspace.main, "ls-tree", "--name-only", "main");
  assert.ok(
    files.split("\n").includes("worker.txt"),
    "the worker's commit must actually be in main",
  );
  assert.equal(
    await readFile(join(workspace.main, "worker.txt"), "utf-8"),
    "worker output\n",
  );
  assert.ok(!existsSync(workspace.worktreePath), "a merged worktree is cleaned up");
});

test("a failed run keeps its worktree for the fixer", async () => {
  const workspace = await makeWorkspace();
  const summary = await finalize(workspace, { PIPIUI_WORKTREE_FINALIZER: "pi" }, "failed");

  assert.doesNotMatch(summary, /merge=merged/, `a failed run must not merge, got: ${summary}`);
  assert.ok(
    existsSync(workspace.worktreePath),
    "failed work is retained for resume, never discarded",
  );
  const { stdout: files } = await git(workspace.main, "ls-tree", "--name-only", "main");
  assert.ok(!files.split("\n").includes("worker.txt"));
});

test("an aborted run is retained too", async () => {
  const workspace = await makeWorkspace();
  const summary = await finalize(workspace, { PIPIUI_WORKTREE_FINALIZER: "pi" }, "aborted");
  assert.doesNotMatch(summary, /merge=merged/, `an aborted run must not merge, got: ${summary}`);
  assert.ok(existsSync(workspace.worktreePath));
});

test("the closeout vocabulary follows the finalization outcome", async () => {
  const merged = await makeWorkspace();
  const failed = await makeWorkspace();
  const harnessFor = async (workspace, terminalState) => {
    const harness = join(workspace.directory, `closeout-${terminalState}.mjs`);
    await writeFile(
      harness,
      [
        'import { finalizeWorktreeIfOwned, closeoutDispositionFor } from "./PiExt/subagent/worktree-finalize.ts";',
        "const state = await finalizeWorktreeIfOwned({",
        '  agentId: "agent-one", runId: "run-1",',
        `  mainCwd: ${JSON.stringify(workspace.main)},`,
        `  worktreePath: ${JSON.stringify(workspace.worktreePath)},`,
        `  worktreeBranch: ${JSON.stringify(workspace.branch)},`,
        `  role: "worker", terminalState: ${JSON.stringify(terminalState)},`,
        "});",
        'console.log(state ? closeoutDispositionFor(state) : "SKIPPED");',
      ].join("\n"),
      "utf-8",
    );
    const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: workspace.directory,
      env: { ...process.env, PIPIUI_WORKTREE_FINALIZER: "pi" },
    });
    return stdout.trim();
  };

  assert.equal(await harnessFor(merged, "ok"), "cleaned", "integrated work is cleaned");
  assert.equal(
    await harnessFor(failed, "failed"),
    "retained",
    "failed work is retained, never reported as cleaned",
  );
});

test("a run with no worktree is nothing to finalize, even when opted in", async () => {
  const workspace = await makeWorkspace();
  const harness = join(workspace.directory, "no-worktree.mjs");
  await writeFile(
    harness,
    [
      'import { finalizeWorktreeIfOwned } from "./PiExt/subagent/worktree-finalize.ts";',
      "const state = await finalizeWorktreeIfOwned({",
      '  agentId: "read-only-one", runId: "run-1",',
      `  mainCwd: ${JSON.stringify(workspace.main)},`,
      "  worktreePath: undefined, worktreeBranch: undefined,",
      '  role: "worker", terminalState: "ok",',
      "});",
      'console.log(state ? "RAN" : "SKIPPED");',
    ].join("\n"),
    "utf-8",
  );
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
    cwd: workspace.directory,
    env: { ...process.env, PIPIUI_WORKTREE_FINALIZER: "pi" },
  });
  assert.equal(stdout.trim(), "SKIPPED", "a read-only role never had a worktree to finalize");
});
