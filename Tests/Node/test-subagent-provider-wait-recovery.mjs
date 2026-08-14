import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");

async function loadRuntime(t) {
  const root = await mkdtemp(join(tmpdir(), "pipi-provider-wait-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, "runtime");
  await cp(join(repositoryRoot, "Sources/PipiUI/PiExt/subagent"), join(runtime, "subagent"), { recursive: true });
  await cp(join(repositoryRoot, "Sources/PipiUI/PiExt/packages/computer-agent"), join(runtime, "packages/computer-agent"), { recursive: true });
  const scoped = join(runtime, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-agent-core"), join(scoped, "pi-agent-core"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(runtime, "node_modules/typebox"), "dir"),
  ]);
  return import(pathToFileURL(join(runtime, "subagent/index.ts")).href);
}

test("provider wait starts only after every exact tool result and times out one attempt", async t => {
  const { createProviderWaitController } = await loadRuntime(t);
  const scheduled = [];
  const cleared = [];
  const phases = [];
  const timeouts = [];
  const controller = createProviderWaitController({
    model: "xai/grok-4.6",
    deadlineMs: 180_000,
    schedule: (callback, delay) => { const token = { callback, delay }; scheduled.push(token); return token; },
    cancel: token => cleared.push(token),
    onPhase: phase => phases.push(phase),
    onTimeout: () => timeouts.push("timeout"),
  });

  controller.noteToolBatch(["A", "B"]);
  controller.noteToolResult("B");
  assert.equal(controller.phase(), "running-tool");
  assert.equal(scheduled.length, 0, "out-of-order partial results must not arm provider wait");
  controller.noteToolResult("unrelated");
  assert.equal(scheduled.length, 0, "only exact pending ids count");
  controller.noteToolResult("A");
  assert.equal(controller.phase(), "awaiting-model");
  assert.equal(controller.activity(), "工具结果已返回，等待 xai/grok-4.6 响应…");
  assert.equal(scheduled[0].delay, 180_000);
  scheduled[0].callback();
  assert.deepEqual(timeouts, ["timeout"]);
  assert.deepEqual(phases, ["running-tool", "awaiting-model"]);
});

test("new assistant activity cancels provider wait and long tools never arm it", async t => {
  const { createProviderWaitController } = await loadRuntime(t);
  const scheduled = [];
  const cleared = [];
  const controller = createProviderWaitController({
    model: "openai/gpt-5.6",
    deadlineMs: 180_000,
    schedule: callback => { const token = { callback }; scheduled.push(token); return token; },
    cancel: token => cleared.push(token),
    onPhase() {},
    onTimeout() { assert.fail("cancelled provider wait must not fire"); },
  });

  controller.noteToolBatch(["long-tool"]);
  assert.equal(controller.phase(), "running-tool");
  assert.equal(scheduled.length, 0, "a long/streaming tool is not provider wait");
  controller.noteToolResult("long-tool");
  assert.equal(scheduled.length, 1);
  controller.noteAssistantActivity();
  assert.equal(controller.phase(), "model-active");
  assert.deepEqual(cleared, [scheduled[0]]);
});

test("deadline config defaults conservatively and accepts a positive override", async t => {
  const { providerWaitDeadlineMs } = await loadRuntime(t);
  assert.equal(providerWaitDeadlineMs({}), 180_000);
  assert.equal(providerWaitDeadlineMs({ PIPIUI_PROVIDER_WAIT_TIMEOUT_MS: "2500" }), 2_500);
  assert.equal(providerWaitDeadlineMs({ PIPIUI_PROVIDER_WAIT_TIMEOUT_MS: "0" }), 180_000);
});

test("provider stall gets exactly one same-model resume while abort never resumes", async t => {
  const { decideProviderStallRecovery } = await loadRuntime(t);
  assert.equal(decideProviderStallRecovery({ timedOut: true, wasAborted: false, resumeCount: 0 }), "resume");
  assert.equal(decideProviderStallRecovery({ timedOut: true, wasAborted: false, resumeCount: 1 }), "terminal-failed");
  assert.equal(decideProviderStallRecovery({ timedOut: true, wasAborted: true, resumeCount: 0 }), "aborted");
  assert.equal(decideProviderStallRecovery({ timedOut: false, wasAborted: false, resumeCount: 0 }), "not-provider-stall");
});

test("real lifecycle seam cancels awaiting-model on the first assistant update", async t => {
  const runtime = await loadRuntime(t);
  const source = await (await import("node:fs/promises")).readFile(
    join(repositoryRoot, "Sources/PipiUI/PiExt/subagent/index.ts"),
    "utf8",
  );
  assert.match(source, /if \(ame && typeof ame === "object"\) \{\s*providerWait\.noteAssistantActivity\(\);/s);
  assert.match(source, /providerWait\.noteToolResult\(String\(resultMsg\.toolCallId \?\? ""\)\);/);
  assert.equal(typeof runtime.createProviderWaitController, "function");
});
