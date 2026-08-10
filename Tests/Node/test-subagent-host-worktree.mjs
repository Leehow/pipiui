import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  NodeGitWorktreeAdapter,
  PerMainRepoSerialQueueV1,
  runSpawnV1,
  WorktreeFinalizationServiceV1,
  decodeWorktreeFinalizationStateV1,
  evaluateAutoMergeReadinessV1,
} from "../../Sources/PipiUI/PiExt/subagent-host/worktree/index.ts";

async function run(program, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(program, args, {
        ...(cwd ? { cwd } : {}),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ ok: exitCode === 0, exitCode, stdout, stderr }));
  });
}

async function git(cwd, args) {
  const result = await run("git", args, { cwd });
  if (!result.ok) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  return result;
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function removeTemporaryTree(value) {
  try {
    await rm(value, { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function makeRepository(t) {
  const main = await mkdtemp(join(tmpdir(), "pipiui-host-worktree-"));
  const extraPaths = [];
  t.after(async () => {
    await Promise.all(extraPaths.map((entry) => removeTemporaryTree(entry)));
    await removeTemporaryTree(main);
  });
  await git(main, ["init", "-b", "main"]);
  await git(main, ["config", "user.email", "pipiui-test@example.com"]);
  await git(main, ["config", "user.name", "PipiUI Node Test"]);
  await writeFile(join(main, "README.md"), "initial\n");
  await git(main, ["add", "README.md"]);
  await git(main, ["commit", "-m", "initial"]);

  let worktreeNumber = 0;
  return {
    main,
    async addWorker(branch) {
      const worktree = join(dirname(main), `${basename(main)}-worker-${worktreeNumber++}`);
      extraPaths.push(worktree);
      await git(main, ["worktree", "add", "-b", branch, worktree, "HEAD"]);
      return worktree;
    },
  };
}

async function commitFile(cwd, file, contents, message) {
  await writeFile(join(cwd, file), contents);
  await git(cwd, ["add", file]);
  await git(cwd, ["commit", "-m", message]);
}

function inputFor({
  mainCwd = "/tmp/main",
  worktreePath = "/tmp/worker",
  branch = "pipiui/agent-a",
  agentId = "agent-a",
  runId = "run-a",
  terminal = "ok",
  verify,
  ownership,
} = {}) {
  return {
    schemaVersion: 1,
    agentId,
    runId,
    mainCwd,
    worktree: {
      path: worktreePath,
      branch,
      ownership: ownership ?? {
        mode: "isolated",
        role: "worker",
        agentId,
        runId,
      },
    },
    terminal: { state: terminal },
    ...(verify ? { verify } : {}),
  };
}

function fakeInspection(input, mutate = (value) => value) {
  const value = {
    main: {
      isRepo: true,
      branch: "main",
      head: "main-head",
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      conflictPaths: [],
      dangerousOperations: [],
      pathsKnown: true,
      errors: [],
    },
    worktree: {
      isRepo: true,
      branch: input.worktree.branch,
      head: "worker-head",
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      conflictPaths: [],
      dangerousOperations: [],
      pathsKnown: true,
      errors: [],
    },
    registeredWorktrees: [{ path: input.worktree.path, branch: input.worktree.branch }],
    registeredWorktreePath: input.worktree.path,
    branchExists: true,
    branchHead: "worker-head",
    branchIsAncestorOfMain: false,
    workerBranchChangedPaths: ["Sources/Worker.swift"],
    errors: [],
  };
  return mutate(structuredClone(value));
}

class FakeAdapter {
  constructor(mutate = (inspection) => inspection) {
    this.mutate = mutate;
    this.mergeCalls = 0;
    this.removeCalls = 0;
    this.cleanupCalls = 0;
  }

  async repositoryKey() { return "fake-main"; }

  async inspect(input) {
    return this.mutate(fakeInspection(input));
  }

  async merge() {
    this.mergeCalls += 1;
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  }

  async removeWorktree() {
    this.removeCalls += 1;
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  }

  async cleanupMergedBranch({ branch }) {
    this.cleanupCalls += 1;
    return { disposition: "deleted", branch, message: "deleted" };
  }
}

test("fake adapter policy matrix retains every unsafe terminal/ownership/main state", async () => {
  const cases = [
    {
      name: "pre-existing staged index",
      mutate: (inspection) => { inspection.main.stagedPaths = ["README.md"]; return inspection; },
      expected: ["needs-user", "main-staged", "waiting-for-main"],
    },
    {
      name: "overlapping main WIP",
      mutate: (inspection) => {
        inspection.main.unstagedPaths = ["Sources/Worker.swift"];
        return inspection;
      },
      expected: ["needs-user", "main-overlap", "waiting-for-main"],
    },
    {
      name: "dirty worker",
      mutate: (inspection) => { inspection.worktree.untrackedPaths = ["draft.txt"]; return inspection; },
      expected: ["needs-fixer", "worktree-dirty", "needs-fixer"],
    },
    {
      name: "path branch mismatch",
      mutate: (inspection) => { delete inspection.registeredWorktreePath; return inspection; },
      expected: ["needs-user", "unknown", "needs-user"],
    },
  ];

  for (const entry of cases) {
    const input = inputFor();
    const adapter = new FakeAdapter(entry.mutate);
    const state = await new WorktreeFinalizationServiceV1({ adapter }).finalize(input);
    assert.equal(state.result.disposition, entry.expected[0], entry.name);
    assert.equal(state.result.dirty, entry.expected[1], entry.name);
    assert.equal(state.result.recovery.disposition, entry.expected[2], entry.name);
    assert.equal(adapter.mergeCalls, 0, `${entry.name} must not invoke merge`);
    assert.equal(state.result.cleanup, "not-attempted");
  }

  for (const terminal of ["aborted", "interrupted"]) {
    const input = inputFor({ terminal });
    const adapter = new FakeAdapter();
    const state = await new WorktreeFinalizationServiceV1({ adapter }).finalize(input);
    assert.equal(state.result.disposition, "retained", terminal);
    assert.equal(state.result.recovery.nextAction, "resume-worker", terminal);
    assert.equal(adapter.mergeCalls, 0, terminal);
  }

  const secretary = inputFor({
    ownership: { mode: "isolated", role: "secretary", agentId: "agent-a", runId: "run-a" },
  });
  const secretaryState = await new WorktreeFinalizationServiceV1({ adapter: new FakeAdapter() }).finalize(secretary);
  assert.equal(secretaryState.result.disposition, "retained");
  assert.equal(secretaryState.result.ownership, "secretary");

  const verifyFailed = inputFor({ verify: { command: "swift test", exitCode: 1 } });
  const verifyAdapter = new FakeAdapter();
  const verifyState = await new WorktreeFinalizationServiceV1({ adapter: verifyAdapter }).finalize(verifyFailed);
  assert.equal(verifyState.result.disposition, "needs-fixer");
  assert.equal(verifyState.result.verify.terminal, "failed");
  assert.equal(verifyAdapter.mergeCalls, 0);

  const ready = inputFor();
  const readiness = evaluateAutoMergeReadinessV1(ready, fakeInspection(ready));
  assert.equal(readiness.ready, true);
  assert.equal(readiness.dirty, "clean");
  const readyAdapter = new FakeAdapter();
  const readyState = await new WorktreeFinalizationServiceV1({ adapter: readyAdapter }).finalize(ready);
  assert.equal(readyState.result.disposition, "merged");
  assert.equal(readyAdapter.mergeCalls, 1);
  assert.equal(decodeWorktreeFinalizationStateV1(JSON.parse(JSON.stringify(readyState))).ok, true, "state must persist and decode");
});

test("default Node adapter merges a temporary worker, safely removes it, and non-force deletes its merged branch", async (t) => {
  const repo = await makeRepository(t);
  const branch = "pipiui/happy";
  const worker = await repo.addWorker(branch);
  await commitFile(worker, "feature.txt", "integrated\n", "worker feature");

  const state = await new WorktreeFinalizationServiceV1().finalize(inputFor({
    mainCwd: repo.main,
    worktreePath: worker,
    branch,
    agentId: "happy",
    runId: "run-happy",
    ownership: { mode: "isolated", role: "worker", agentId: "happy", runId: "run-happy" },
  }));

  assert.equal(state.result.disposition, "merged");
  assert.equal(state.result.merge, "merged");
  assert.equal(state.result.cleanup, "cleaned");
  assert.equal(state.result.verify.terminal, "none", "no attested verify keeps existing none-is-pass merge semantics");
  assert.equal(await readFile(join(repo.main, "feature.txt"), "utf8"), "integrated\n");
  assert.equal(await pathExists(worker), false);
  const branchProbe = await run("git", ["-C", repo.main, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  assert.equal(branchProbe.ok, false, "only a safely merged internal branch may be deleted");
});

test("default Node adapter blocks dirty overlapping main work before any merge", async (t) => {
  const repo = await makeRepository(t);
  const branch = "pipiui/dirty-main";
  const worker = await repo.addWorker(branch);
  await commitFile(worker, "shared.txt", "worker\n", "worker shared change");
  await writeFile(join(repo.main, "shared.txt"), "user WIP\n");

  const state = await new WorktreeFinalizationServiceV1().finalize(inputFor({
    mainCwd: repo.main,
    worktreePath: worker,
    branch,
    agentId: "dirty-main",
    runId: "run-dirty-main",
    ownership: { mode: "isolated", role: "worker", agentId: "dirty-main", runId: "run-dirty-main" },
  }));

  assert.equal(state.result.disposition, "needs-user");
  assert.equal(state.result.dirty, "main-overlap");
  assert.equal(state.result.merge, "not-attempted");
  assert.equal(await pathExists(worker), true, "unsafe work must remain retained");
});

test("known disjoint main work in progress preserves the Swift merge-readiness behavior", async (t) => {
  const repo = await makeRepository(t);
  const branch = "pipiui/disjoint-main";
  const worker = await repo.addWorker(branch);
  await commitFile(worker, "worker-only.txt", "worker\n", "worker-only change");
  await writeFile(join(repo.main, "user-notes.txt"), "untracked user work\n");

  const state = await new WorktreeFinalizationServiceV1().finalize(inputFor({
    mainCwd: repo.main,
    worktreePath: worker,
    branch,
    agentId: "disjoint-main",
    runId: "run-disjoint-main",
    ownership: { mode: "isolated", role: "worker", agentId: "disjoint-main", runId: "run-disjoint-main" },
  }));

  assert.equal(state.result.disposition, "merged");
  assert.equal(state.result.dirty, "disjoint-main-wip");
  assert.equal(await readFile(join(repo.main, "worker-only.txt"), "utf8"), "worker\n");
  assert.equal(await readFile(join(repo.main, "user-notes.txt"), "utf8"), "untracked user work\n");
});

test("terminal verify failure retains the temporary worker without attempting merge", async (t) => {
  const repo = await makeRepository(t);
  const branch = "pipiui/verify-fail";
  const worker = await repo.addWorker(branch);
  await commitFile(worker, "feature.txt", "not merged\n", "worker feature");

  const state = await new WorktreeFinalizationServiceV1().finalize(inputFor({
    mainCwd: repo.main,
    worktreePath: worker,
    branch,
    agentId: "verify-fail",
    runId: "run-verify-fail",
    ownership: { mode: "isolated", role: "worker", agentId: "verify-fail", runId: "run-verify-fail" },
    verify: { command: "swift test", exitCode: 1 },
  }));

  assert.equal(state.result.disposition, "needs-fixer");
  assert.equal(state.result.merge, "not-attempted");
  assert.equal(await pathExists(worker), true);
  assert.equal(await pathExists(join(repo.main, "feature.txt")), false);
});

test("merge conflict returns a recovery contract and never removes the temporary worker", async (t) => {
  const repo = await makeRepository(t);
  await commitFile(repo.main, "shared.txt", "base\n", "add shared base");
  const branch = "pipiui/conflict";
  const worker = await repo.addWorker(branch);
  await commitFile(worker, "shared.txt", "worker side\n", "worker shared edit");
  await commitFile(repo.main, "shared.txt", "main side\n", "main shared edit");

  const state = await new WorktreeFinalizationServiceV1().finalize(inputFor({
    mainCwd: repo.main,
    worktreePath: worker,
    branch,
    agentId: "conflict",
    runId: "run-conflict",
    ownership: { mode: "isolated", role: "worker", agentId: "conflict", runId: "run-conflict" },
  }));

  assert.equal(state.result.disposition, "needs-fixer");
  assert.equal(state.result.merge, "conflicted");
  assert.equal(state.result.conflict, "merge-conflict");
  assert.equal(state.result.recovery.nextAction, "resolve-conflict");
  assert.equal(state.result.cleanup, "not-attempted");
  assert.equal(await pathExists(worker), true);
  assert.equal(decodeWorktreeFinalizationStateV1(JSON.parse(JSON.stringify(state))).ok, true, "conflict recovery must remain persistable");
});

test("default cleanup retains unique commits and deletes only safely merged detached branches", async (t) => {
  const repo = await makeRepository(t);
  const adapter = new NodeGitWorktreeAdapter();

  const uniqueBranch = "pipiui/unique";
  const uniqueWorker = await repo.addWorker(uniqueBranch);
  await commitFile(uniqueWorker, "unique.txt", "unique\n", "unique worker commit");
  await git(repo.main, ["worktree", "remove", uniqueWorker]);
  const unique = await adapter.cleanupMergedBranch({ mainCwd: repo.main, branch: uniqueBranch });
  assert.equal(unique.disposition, "retained-unique-commits");
  assert.equal((await run("git", ["-C", repo.main, "show-ref", "--verify", "--quiet", `refs/heads/${uniqueBranch}`])).ok, true);

  const safeBranch = "pipiui/safe-cleanup";
  const safeWorker = await repo.addWorker(safeBranch);
  await git(repo.main, ["worktree", "remove", safeWorker]);
  const safe = await adapter.cleanupMergedBranch({ mainCwd: repo.main, branch: safeBranch });
  assert.equal(safe.disposition, "deleted");
  assert.equal((await run("git", ["-C", repo.main, "show-ref", "--verify", "--quiet", `refs/heads/${safeBranch}`])).ok, false);
});

test("post-merge direct-argv verification failure remains needs-fixer after integration", async (t) => {
  const repo = await makeRepository(t);
  const branch = "pipiui/post-verify";
  const worker = await repo.addWorker(branch);
  await commitFile(worker, "post-verify.txt", "merged first\n", "worker feature");

  const state = await new WorktreeFinalizationServiceV1().finalize(inputFor({
    mainCwd: repo.main,
    worktreePath: worker,
    branch,
    agentId: "post-verify",
    runId: "run-post-verify",
    ownership: { mode: "isolated", role: "worker", agentId: "post-verify", runId: "run-post-verify" },
    verify: {
      command: "node verification",
      argv: [process.execPath, "-e", "process.exit(7)"],
      exitCode: 0,
    },
  }));

  assert.equal(state.result.merge, "merged");
  assert.equal(state.result.cleanup, "cleaned");
  assert.equal(state.result.verify.terminal, "passed");
  assert.equal(state.result.verify.postMerge, "failed");
  assert.equal(state.result.verify.postMergeExitCode, 7);
  assert.equal(state.result.disposition, "needs-fixer");
  assert.equal(await readFile(join(repo.main, "post-verify.txt"), "utf8"), "merged first\n");
  assert.equal(await pathExists(worker), false);
});

test("default direct-argv verify timeout terminates its own process group and releases the main queue", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-worktree-verify-timeout-"));
  const marker = join(directory, "unexpected-descendant.txt");
  t.after(() => removeTemporaryTree(directory));
  const descendant = `const fs = require("node:fs"); setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, "orphan"), 300); setInterval(() => {}, 1_000);`;
  const hungVerify = process.platform === "win32"
    ? "setInterval(() => {}, 1_000);"
    : `const { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" }); setInterval(() => {}, 1_000);`;
  const adapter = new FakeAdapter();
  const service = new WorktreeFinalizationServiceV1({
    adapter,
    queue: new PerMainRepoSerialQueueV1(),
    verifyTimeoutMs: 75,
    terminationGraceMs: 20,
  });
  const hanging = inputFor({
    mainCwd: directory,
    agentId: "verify-timeout",
    runId: "run-verify-timeout",
    branch: "pipiui/verify-timeout",
    worktreePath: "/tmp/verify-timeout",
    verify: { command: "hung verify", argv: [process.execPath, "-e", hungVerify], exitCode: 0 },
  });
  const after = inputFor({
    mainCwd: directory,
    agentId: "verify-after",
    runId: "run-verify-after",
    branch: "pipiui/verify-after",
    worktreePath: "/tmp/verify-after",
  });

  const startedAt = Date.now();
  const first = service.finalize(hanging);
  await delay(10);
  const second = service.finalize(after);
  const [timedOut, continued] = await Promise.all([first, second]);
  assert.equal(timedOut.result.disposition, "needs-fixer");
  assert.equal(timedOut.result.verify.postMerge, "failed");
  assert.equal(timedOut.result.verify.postMergeTimedOut, true);
  assert.match(timedOut.result.recovery.reason, /post-merge verify failed/);
  assert.equal(continued.result.disposition, "merged", "the queued finalization must run after timeout settlement");
  assert.ok(Date.now() - startedAt < 2_000, "timeout must release the queue rather than await a hung child");

  await delay(400);
  if (process.platform !== "win32") {
    assert.equal(await pathExists(marker), false, "POSIX detached-group termination must not leave the spawned descendant running");
  }
});

test("AbortSignal settles a service-owned direct child without claiming verify completion", async () => {
  const controller = new AbortController();
  const spawned = runSpawnV1(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
    timeoutMs: 1_000,
    terminationGraceMs: 20,
    signal: controller.signal,
  });
  await delay(20);
  controller.abort();
  const result = await spawned;
  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, undefined);
});

test("bounded default Git adapter timeout returns a persistable state and frees its queue", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-worktree-git-timeout-"));
  const marker = join(directory, "unexpected-git-child.txt");
  const gitStub = join(directory, "hung-git");
  await writeFile(gitStub, `#!/usr/bin/env node\nconst fs = require("node:fs"); setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, "late"), 300); setInterval(() => {}, 1_000);\n`);
  await chmod(gitStub, 0o755);
  t.after(() => removeTemporaryTree(directory));

  const adapter = new NodeGitWorktreeAdapter({
    gitExecutable: gitStub,
    timeoutMs: 80,
    terminationGraceMs: 20,
  });
  const service = new WorktreeFinalizationServiceV1({
    adapter,
    queue: new PerMainRepoSerialQueueV1(),
  });
  const firstInput = inputFor({
    mainCwd: directory,
    worktreePath: join(directory, "worker-a"),
    branch: "pipiui/git-timeout-a",
    agentId: "git-timeout-a",
    runId: "run-git-timeout-a",
  });
  const secondInput = inputFor({
    mainCwd: directory,
    worktreePath: join(directory, "worker-b"),
    branch: "pipiui/git-timeout-b",
    agentId: "git-timeout-b",
    runId: "run-git-timeout-b",
  });

  const startedAt = Date.now();
  const first = service.finalize(firstInput);
  await delay(10);
  const second = service.finalize(secondInput);
  const [firstState, secondState] = await Promise.all([first, second]);
  assert.equal(firstState.result.disposition, "needs-user");
  assert.equal(secondState.result.disposition, "needs-user", "the later queued Git inspection must settle after the first timeout");
  assert.match(firstState.result.messages.join("\n"), /timed out/);
  assert.match(secondState.result.messages.join("\n"), /timed out/);
  assert.ok(Date.now() - startedAt < 2_000, "bounded Git operations must not leave the queue stuck");
  assert.equal(decodeWorktreeFinalizationStateV1(JSON.parse(JSON.stringify(firstState))).ok, true);

  await delay(400);
  assert.equal(await pathExists(marker), false, "a timed-out Git stub must not remain alive to write later");
});

test("custom adapter merge and cleanup rejections become persistable needs-user states", async () => {
  class RejectingAdapter extends FakeAdapter {
    constructor(stage) {
      super();
      this.stage = stage;
    }
    async merge(...args) {
      if (this.stage === "merge") throw new Error("merge adapter rejected");
      return super.merge(...args);
    }
    async removeWorktree(...args) {
      if (this.stage === "remove") throw new Error("remove adapter rejected");
      return super.removeWorktree(...args);
    }
    async cleanupMergedBranch(...args) {
      if (this.stage === "cleanup") throw new Error("cleanup adapter rejected");
      return super.cleanupMergedBranch(...args);
    }
  }

  for (const stage of ["merge", "remove", "cleanup"]) {
    const adapter = new RejectingAdapter(stage);
    const state = await new WorktreeFinalizationServiceV1({ adapter }).finalize(inputFor({
      agentId: `reject-${stage}`,
      runId: `run-reject-${stage}`,
      branch: `pipiui/reject-${stage}`,
      worktreePath: `/tmp/reject-${stage}`,
    }));
    assert.equal(state.result.disposition, "needs-user", stage);
    assert.equal(state.result.recovery.retryable, true, stage);
    assert.equal(decodeWorktreeFinalizationStateV1(JSON.parse(JSON.stringify(state))).ok, true, stage);
  }
});

test("persisted integrated state retries a host-owned post-merge verifier without re-merging", async () => {
  const adapter = new FakeAdapter();
  let verifyAttempts = 0;
  const service = new WorktreeFinalizationServiceV1({
    adapter,
    postMergeVerify: async () => {
      verifyAttempts += 1;
      return verifyAttempts === 1
        ? { ok: false, exitCode: 1, outputTail: "first verification failed" }
        : { ok: true, exitCode: 0 };
    },
  });
  const input = inputFor({ verify: { command: "host-owned legacy verifier", exitCode: 0 } });
  const first = await service.finalize(input);
  assert.equal(first.result.merge, "merged");
  assert.equal(first.result.verify.postMerge, "failed");
  assert.equal(first.result.disposition, "needs-fixer");
  assert.equal(adapter.mergeCalls, 1);

  const retried = await service.retry(JSON.parse(JSON.stringify(first)));
  assert.equal(retried.attempt, 2);
  assert.equal(retried.result.merge, "merged");
  assert.equal(retried.result.verify.postMerge, "passed");
  assert.equal(retried.result.disposition, "merged");
  assert.equal(adapter.mergeCalls, 1, "retry must not merge an already integrated branch again");
  assert.equal(verifyAttempts, 2);
});

test("per-main-repository queue serializes two finalizations even with concurrent callers", async () => {
  let active = 0;
  let maximum = 0;
  const events = [];
  class DelayedAdapter extends FakeAdapter {
    async repositoryKey() { return "one-main-repository"; }
    async merge(_main, branch) {
      this.mergeCalls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      events.push(`start:${branch}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push(`end:${branch}`);
      active -= 1;
      return { ok: true, exitCode: 0, stdout: "", stderr: "" };
    }
  }
  const adapter = new DelayedAdapter();
  const service = new WorktreeFinalizationServiceV1({
    adapter,
    queue: new PerMainRepoSerialQueueV1(),
  });
  const a = inputFor({ agentId: "queue-a", runId: "run-a", branch: "pipiui/queue-a", worktreePath: "/tmp/queue-a" });
  const b = inputFor({ agentId: "queue-b", runId: "run-b", branch: "pipiui/queue-b", worktreePath: "/tmp/queue-b" });
  const [first, second] = await Promise.all([service.finalize(a), service.finalize(b)]);

  assert.equal(first.result.disposition, "merged");
  assert.equal(second.result.disposition, "merged");
  assert.equal(maximum, 1, "main merge writes must not overlap");
  assert.deepEqual(events, ["start:pipiui/queue-a", "end:pipiui/queue-a", "start:pipiui/queue-b", "end:pipiui/queue-b"]);
});

test("portable implementation has no destructive Git route and scopes timeout termination to its own detached child", async () => {
  const source = await Promise.all([
    readFile(new URL("../../Sources/PipiUI/PiExt/subagent-host/worktree/adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../../Sources/PipiUI/PiExt/subagent-host/worktree/service.ts", import.meta.url), "utf8"),
  ]);
  const joined = source.join("\n");
  assert.equal(joined.includes("branch\", \"-D"), false);
  assert.equal(joined.includes("reset\", \"--hard"), false);
  assert.equal(joined.includes("clean\""), false);
  assert.equal(joined.includes("killall"), false);
  assert.equal(joined.includes("pkill"), false);
  assert.equal(joined.includes("NSRunningApplication"), false);
  assert.ok(joined.includes("shell: false"), "default adapter must use direct spawn argv");
  assert.ok(joined.includes("detached: isPosix"), "POSIX timeout termination must target a per-spawn process group");
  assert.ok(joined.includes("process.kill(-child.pid"), "group termination must only derive from this spawned child pid");
  assert.ok(joined.includes("child.kill(signal)"), "non-POSIX fallback must target the direct spawned child only");
});
