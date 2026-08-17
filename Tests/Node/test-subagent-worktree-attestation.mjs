/**
 * Merge attribution: trailers, checkpoint ref, and local git notes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  NodeGitWorktreeAdapter,
  WorktreeFinalizationServiceV1,
  checkpointRefNameV1,
} from "../../Electron/resources/runtime/pi-ext/subagent-host/worktree/index.ts";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd });
}

async function makeWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-worktree-attest-"));
  const main = join(directory, "main");
  await mkdir(main, { recursive: true });
  await git(main, "init", "--initial-branch=main");
  await git(main, "config", "user.email", "test@example.com");
  await git(main, "config", "user.name", "Test");
  await writeFile(join(main, "base.txt"), "base\n", "utf-8");
  await git(main, "add", "base.txt");
  await git(main, "commit", "-m", "base");
  const { stdout: preMergeHead } = await git(main, "rev-parse", "HEAD");

  const worktreePath = join(main, ".pi/worktrees/agent-one");
  const branch = "pipiui/agent-one";
  await git(main, "worktree", "add", worktreePath, "-b", branch, "HEAD");
  await writeFile(join(worktreePath, "worker.txt"), "worker output\n", "utf-8");
  await git(worktreePath, "add", "worker.txt");
  await git(worktreePath, "commit", "-m", "worker change");

  return { directory, main, worktreePath, branch, preMergeHead: preMergeHead.trim() };
}

function inputFor({ main, worktreePath, branch, agentId = "agent-one", runId = "run-1" }) {
  return {
    schemaVersion: 1,
    agentId,
    runId,
    mainCwd: main,
    worktree: {
      path: worktreePath,
      branch,
      ownership: { mode: "isolated", role: "worker", agentId, runId },
    },
    terminal: { state: "ok" },
  };
}

test("successful merge writes trailers, checkpoint, and notes", async () => {
  const workspace = await makeWorkspace();
  const service = new WorktreeFinalizationServiceV1({ adapter: new NodeGitWorktreeAdapter() });
  const state = await service.finalize(inputFor(workspace));

  assert.equal(state.result.merge, "merged", JSON.stringify(state.result.messages));
  const { stdout: body } = await git(workspace.main, "log", "-1", "--format=%B");
  assert.match(body, /PipiUI-Agent: agent-one/);
  assert.match(body, /PipiUI-Run: run-1/);

  const { stdout: mergeSha } = await git(workspace.main, "rev-parse", "HEAD");
  const { stdout: noteRaw } = await git(workspace.main, "notes", "--ref=pipiui", "show", mergeSha.trim());
  const note = JSON.parse(noteRaw);
  assert.equal(note.schemaVersion, 1);
  assert.equal(note.agentId, "agent-one");
  assert.equal(note.runId, "run-1");
  assert.equal(note.merge, "merged");
  assert.equal(note.disposition, state.result.disposition);
  assert.equal("exitCode" in note.verify, true);
  assert.equal("postMergeExitCode" in note.verify, true);
  assert.equal(note.verify.exitCode, state.result.verify.exitCode ?? null);
  assert.equal(note.verify.postMergeExitCode, state.result.verify.postMergeExitCode ?? null);
  assert.equal(note.updatedAt, state.result.updatedAt);

  const checkpoint = checkpointRefNameV1("agent-one");
  const { stdout: checkpointSha } = await git(workspace.main, "rev-parse", checkpoint);
  assert.equal(checkpointSha.trim(), workspace.preMergeHead);
});

test("audit note failure does not fail finalization", async () => {
  const workspace = await makeWorkspace();
  class FailingNotesAdapter extends NodeGitWorktreeAdapter {
    addAuditNote() {
      return Promise.resolve({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "simulated notes failure",
        error: "simulated notes failure",
      });
    }
  }
  const service = new WorktreeFinalizationServiceV1({ adapter: new FailingNotesAdapter() });
  const state = await service.finalize(inputFor(workspace));
  assert.equal(state.result.merge, "merged");
  assert.equal(state.result.disposition, "merged");
  assert.ok(
    state.result.messages.some((line) => line.includes("merge audit note failed")),
    state.result.messages.join("\n"),
  );
  const { stdout: files } = await git(workspace.main, "ls-tree", "--name-only", "HEAD");
  assert.ok(files.split("\n").includes("worker.txt"));
});
