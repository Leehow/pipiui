/**
 * Merge preflight + in-flight overlap against real Git.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  branchChangedFiles,
  createTipPreflightTracker,
  evaluateBaseAdvanceAlerts,
  preflightMerge,
  worktreeDirtyFiles,
} from "../../Electron/resources/runtime/pi-ext/subagent-host/worktree/preflight.ts";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd });
}

async function initRepo(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const main = join(directory, "main");
  await mkdir(main, { recursive: true });
  await git(main, "init", "--initial-branch=main");
  await git(main, "config", "user.email", "test@example.com");
  await git(main, "config", "user.name", "Test");
  await writeFile(join(main, "shared.txt"), "base\n", "utf-8");
  await writeFile(join(main, "only-main.txt"), "main-only\n", "utf-8");
  await git(main, "add", "shared.txt", "only-main.txt");
  await git(main, "commit", "-m", "base");
  return { directory, main };
}

async function addWorktree(main, id, files) {
  const worktreePath = join(main, ".pi/worktrees", id);
  const branch = `pipiui/${id}`;
  await git(main, "worktree", "add", worktreePath, "-b", branch, "HEAD");
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(worktreePath, name), body, "utf-8");
    await git(worktreePath, "add", name);
  }
  if (Object.keys(files).length > 0) {
    await git(worktreePath, "commit", "-m", `${id} change`);
  }
  return { worktreePath, branch };
}

test("a) disjoint branches preflight clean", async () => {
  const { main } = await initRepo("pipiui-preflight-clean-");
  await addWorktree(main, "alpha", { "alpha.txt": "a\n" });
  const { branch: beta } = await addWorktree(main, "beta", { "beta.txt": "b\n" });
  const result = await preflightMerge(main, "HEAD", beta);
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.deepEqual(result.conflictPaths, []);
});

test("b) same-file forks report the exact conflict path", async () => {
  const { main } = await initRepo("pipiui-preflight-conflict-");
  const { worktreePath: left, branch: leftBranch } = await addWorktree(main, "left", {});
  await writeFile(join(left, "shared.txt"), "left\n", "utf-8");
  await git(left, "add", "shared.txt");
  await git(left, "commit", "-m", "left edits shared");

  const { worktreePath: right, branch: rightBranch } = await addWorktree(main, "right", {});
  await writeFile(join(right, "shared.txt"), "right\n", "utf-8");
  await git(right, "add", "shared.txt");
  await git(right, "commit", "-m", "right edits shared");

  // Simulate main having absorbed left.
  await git(main, "merge", "--no-edit", leftBranch);
  const result = await preflightMerge(main, "HEAD", rightBranch);
  assert.equal(result.clean, false, JSON.stringify(result));
  assert.ok(result.conflictPaths.includes("shared.txt"), JSON.stringify(result));
});

test("c) two-worker broadcast overlap is only the intersecting worker", async () => {
  const { main } = await initRepo("pipiui-preflight-overlap-");
  const alpha = await addWorktree(main, "alpha", { "landed.txt": "from-alpha\n" });
  const beta = await addWorktree(main, "beta", { "other.txt": "from-beta\n" });
  await git(main, "merge", "--no-edit", alpha.branch);
  const alerts = await evaluateBaseAdvanceAlerts({
    mainCwd: main,
    landedFiles: ["landed.txt"],
    workers: [
      { agentId: "alpha", worktreePath: alpha.worktreePath, branch: alpha.branch },
      { agentId: "beta", worktreePath: beta.worktreePath, branch: beta.branch },
    ],
    skipAgentId: "alpha",
  });
  assert.equal(alerts.length, 0, JSON.stringify(alerts));

  const gamma = await addWorktree(main, "gamma", { "landed.txt": "gamma also\n" });
  const withOverlap = await evaluateBaseAdvanceAlerts({
    mainCwd: main,
    landedFiles: ["landed.txt"],
    workers: [
      { agentId: "beta", worktreePath: beta.worktreePath, branch: beta.branch },
      { agentId: "gamma", worktreePath: gamma.worktreePath, branch: gamma.branch },
    ],
  });
  assert.equal(withOverlap.length, 1, JSON.stringify(withOverlap));
  assert.equal(withOverlap[0].agentId, "gamma");
  assert.deepEqual(withOverlap[0].overlap, ["landed.txt"]);
});

test("d) dirty uncommitted files count toward overlap", async () => {
  const { main } = await initRepo("pipiui-preflight-dirty-");
  const worker = await addWorktree(main, "dirty", { "committed.txt": "c\n" });
  await writeFile(join(worker.worktreePath, "dirty.txt"), "uncommitted\n", "utf-8");
  const dirty = await worktreeDirtyFiles(worker.worktreePath);
  assert.ok(dirty.includes("dirty.txt"), JSON.stringify(dirty));
  const changed = await branchChangedFiles(main, worker.branch);
  assert.ok(changed.includes("committed.txt"), JSON.stringify(changed));
  assert.ok(!changed.includes("dirty.txt"));

  const alerts = await evaluateBaseAdvanceAlerts({
    mainCwd: main,
    landedFiles: ["dirty.txt"],
    workers: [{ agentId: "dirty", worktreePath: worker.worktreePath, branch: worker.branch }],
  });
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].overlap, ["dirty.txt"]);
});

test("e) tip move flips clean→conflict once; a second tick is silent", async () => {
  const { main } = await initRepo("pipiui-preflight-tip-");
  const worker = await addWorktree(main, "mover", { "unique.txt": "ok\n" });
  const tracker = createTipPreflightTracker();

  const first = await tracker.onTick({ agentId: "mover", mainCwd: main, branch: worker.branch });
  assert.equal(first, undefined);
  assert.equal(tracker.lastClean("mover"), true);

  const again = await tracker.onTick({ agentId: "mover", mainCwd: main, branch: worker.branch });
  assert.equal(again, undefined);

  // Main now conflicts with a future worker commit on shared.txt.
  await writeFile(join(main, "shared.txt"), "main advanced\n", "utf-8");
  await git(main, "add", "shared.txt");
  await git(main, "commit", "-m", "main takes shared");

  await writeFile(join(worker.worktreePath, "shared.txt"), "worker takes shared\n", "utf-8");
  await git(worker.worktreePath, "add", "shared.txt");
  await git(worker.worktreePath, "commit", "-m", "worker takes shared");

  const flipped = await tracker.onTick({ agentId: "mover", mainCwd: main, branch: worker.branch });
  assert.ok(flipped, "tip move onto a conflicting commit must emit once");
  assert.equal(flipped.clean, false);
  assert.ok(flipped.conflictPaths.includes("shared.txt"), JSON.stringify(flipped));

  const silent = await tracker.onTick({ agentId: "mover", mainCwd: main, branch: worker.branch });
  assert.equal(silent, undefined);
});
