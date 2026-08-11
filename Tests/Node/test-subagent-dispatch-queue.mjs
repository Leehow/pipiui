/**
 * The dispatch queue: capacity and declared dependencies are the runtime's problem, not the boss's.
 *
 * `blockedBy` used to be validated, printed, and ignored, so "dispatch the fixer after the
 * reviewer reports" lived only in the boss's context and died at the next compaction. And
 * MAX_CONCURRENCY was 1000, which is not a limit. These tests pin the replacement, including the
 * two ways it must never lose work: a failed dependency neither runs nor discards its dependents.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, symlink, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");

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

/** Run a scenario against the real queue and return whatever it printed as JSON. */
async function runQueue(body) {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-dispatch-queue-"));
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);
  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    [
      'import { DispatchQueueV1, formatQueuedDispatches, formatQueuedPromptSections, resolveDispatchConcurrency } from "./subagent/dispatch-queue.ts";',
      "const started = []; const notices = []; const states = new Map();",
      "const settle = new Map();",
      "const lookup = (id) => states.get(id) ?? 'unknown';",
      "let queue;",
      "const task = (agentId, blockedBy = []) => ({",
      "  agentId, role: 'general-purpose', title: agentId, task: agentId, blockedBy,",
      "  queuedAt: Date.now(),",
      "  run: () => new Promise((resolve) => { started.push(agentId); settle.set(agentId, resolve); }),",
      "});",
      "/** Finish a started worker with a terminal state, as the job registry would record it. */",
      "const finish = (agentId, state) => { states.set(agentId, state); settle.get(agentId)(); queue.onAgentTerminal(agentId); };",
      body,
      "console.log(JSON.stringify({ started, notices, queued: queue.snapshot().map(q => ({ agentId: q.agentId, heldReason: q.heldReason })) }));",
    ].join("\n"),
    "utf-8",
  );
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
    cwd: directory,
  });
  return JSON.parse(stdout.trim().split("\n").pop());
}

const makeQueue = (limit) =>
  `queue = new DispatchQueueV1({ limit: ${limit}, lookup, notify: (t) => notices.push(t) });`;

test("independent tasks all start at once, up to the limit", async () => {
  const out = await runQueue(
    [makeQueue(16), "queue.enqueueBatch(['a','b','c','d'].map(id => task(id)));"].join("\n"),
  );
  assert.deepEqual(out.started, ["a", "b", "c", "d"], "nothing independent should ever wait");
  assert.equal(out.queued.length, 0);
});

test("work past the limit is queued, then starts as slots free", async () => {
  const out = await runQueue(
    [
      makeQueue(2),
      "queue.enqueueBatch(['a','b','c','d'].map(id => task(id)));",
      "const afterFirstPump = [...started];",
      "finish('a','ok'); await new Promise(r => setTimeout(r, 10));",
      "finish('b','ok'); await new Promise(r => setTimeout(r, 10));",
      "notices.push('first=' + afterFirstPump.join(','));",
    ].join("\n"),
  );
  assert.ok(
    out.notices.includes("first=a,b"),
    `only two may run at once, got ${JSON.stringify(out.notices)}`,
  );
  assert.deepEqual(out.started, ["a", "b", "c", "d"], "a freed slot admits the next queued task");
  assert.equal(out.queued.length, 0);
});

test("a dependent waits for its predecessor, then starts on its own", async () => {
  const out = await runQueue(
    [
      makeQueue(16),
      "queue.enqueueBatch([task('impl'), task('review', ['impl'])]);",
      "const beforeFinish = [...started];",
      "finish('impl','ok'); await new Promise(r => setTimeout(r, 10));",
      "notices.push('before=' + beforeFinish.join(','));",
    ].join("\n"),
  );
  assert.ok(out.notices.includes("before=impl"), "the dependent must not start early");
  assert.deepEqual(out.started, ["impl", "review"], "it starts without another call from the boss");
});

test("a whole chain is handed over in one call", async () => {
  const out = await runQueue(
    [
      makeQueue(16),
      "queue.enqueueBatch([task('impl'), task('review', ['impl']), task('fix', ['review'])]);",
      "finish('impl','ok'); await new Promise(r => setTimeout(r, 10));",
      "finish('review','ok'); await new Promise(r => setTimeout(r, 10));",
    ].join("\n"),
  );
  assert.deepEqual(out.started, ["impl", "review", "fix"]);
});

test("a failed dependency neither runs nor discards its dependents", async () => {
  const out = await runQueue(
    [
      makeQueue(16),
      "queue.enqueueBatch([task('impl'), task('review', ['impl'])]);",
      "finish('impl','failed'); await new Promise(r => setTimeout(r, 10));",
    ].join("\n"),
  );
  assert.deepEqual(out.started, ["impl"], "a dependent must never run on a failed predecessor");
  assert.equal(out.queued.length, 1, "and must never be silently dropped either");
  assert.match(out.queued[0].heldReason, /did not succeed/);
  assert.equal(out.notices.length, 1, "the boss is told exactly once");
  assert.match(out.notices[0], /\[subagent-blocked\]/);
  assert.match(out.notices[0], /agentId=review/);
  assert.match(out.notices[0], /will NOT run on its own/);
});

test("re-dispatching a failed dependency releases what it held", async () => {
  const out = await runQueue(
    [
      makeQueue(16),
      "queue.enqueueBatch([task('impl'), task('review', ['impl'])]);",
      "finish('impl','failed'); await new Promise(r => setTimeout(r, 10));",
      // The boss re-dispatches the same agentId; this time it succeeds.
      "queue.enqueueBatch([task('impl')]);",
      "finish('impl','ok'); await new Promise(r => setTimeout(r, 10));",
    ].join("\n"),
  );
  assert.deepEqual(out.started, ["impl", "impl", "review"], "the held task resumes by itself");
  assert.equal(out.queued.length, 0);
});

test("a dependency that was never dispatched is held, not waited on forever", async () => {
  const out = await runQueue(
    [makeQueue(16), "queue.enqueueBatch([task('review', ['typo-in-this-name'])]);"].join("\n"),
  );
  assert.deepEqual(out.started, []);
  assert.match(out.queued[0].heldReason, /never dispatched/);
  assert.match(out.notices[0], /never dispatched/);
});

test("aborting a queued task drops it before it starts", async () => {
  const out = await runQueue(
    [
      makeQueue(1),
      "queue.enqueueBatch([task('a'), task('b')]);",
      "const cancelled = queue.cancel('b');",
      "notices.push('cancelled=' + cancelled);",
      "finish('a','ok'); await new Promise(r => setTimeout(r, 10));",
    ].join("\n"),
  );
  assert.ok(out.notices.includes("cancelled=true"));
  assert.deepEqual(out.started, ["a"], "a dropped task must not start when the slot frees");
  assert.equal(out.queued.length, 0);
});

test("a blocked task does not stall independent work behind it", async () => {
  const out = await runQueue(
    [
      makeQueue(16),
      "queue.enqueueBatch([task('slow'), task('waits', ['slow']), task('independent')]);",
    ].join("\n"),
  );
  assert.ok(
    out.started.includes("independent"),
    "head-of-line blocking would turn one slow dependency into an idle machine",
  );
  assert.ok(!out.started.includes("waits"));
});

test("the concurrency default is a real limit and stays overridable", async () => {
  const out = await runQueue(
    [
      makeQueue(16),
      "notices.push('default=' + resolveDispatchConcurrency({}));",
      "notices.push('override=' + resolveDispatchConcurrency({ PIPIUI_MAX_CONCURRENCY: '4' }));",
      "notices.push('garbage=' + resolveDispatchConcurrency({ PIPIUI_MAX_CONCURRENCY: 'lots' }));",
    ].join("\n"),
  );
  assert.ok(out.notices.includes("default=16"));
  assert.ok(out.notices.includes("override=4"));
  assert.ok(out.notices.includes("garbage=16"), "an unparseable value must not mean unlimited");
});

test("the boss's live prompt block shows handed-over work, not just running workers", async () => {
  const out = await runQueue(
    [
      makeQueue(1),
      "queue.enqueueBatch([task('a'), task('b'), task('c', ['a'])]);",
      "notices.push(...formatQueuedPromptSections(queue.snapshot()));",
    ].join("\n"),
  );
  const block = out.notices.join("\n");
  assert.match(block, /Handed over, not started yet \(2\)/);
  assert.match(block, /`b` \(b\) — waiting for a free slot/);
  assert.match(block, /`c` \(c\) — waiting for a/);
  assert.match(
    block,
    /These start by themselves\. Do not re-dispatch them and do not wait on them\./,
    "the boss must not treat queued work as work it still owes a dispatch",
  );
  assert.doesNotMatch(block, /Held/, "nothing is held while the dependency is merely running");
});

test("a held task is called out in the prompt as needing a decision", async () => {
  const out = await runQueue(
    [
      makeQueue(16),
      "queue.enqueueBatch([task('impl'), task('review', ['impl'])]);",
      "finish('impl','failed'); await new Promise(r => setTimeout(r, 10));",
      "notices.length = 0;",
      "notices.push(...formatQueuedPromptSections(queue.snapshot()));",
    ].join("\n"),
  );
  const block = out.notices.join("\n");
  assert.match(block, /Held — these will NOT run without a decision from you \(1\)/);
  assert.match(block, /`review`/);
  assert.match(block, /did not succeed/);
  assert.match(
    block,
    /Do not declare the goal finished while anything above is held\./,
    "a held task must block a premature completion claim",
  );
});

test("an empty queue contributes nothing to the prompt", async () => {
  const out = await runQueue(
    [makeQueue(16), "notices.push(...formatQueuedPromptSections(queue.snapshot()));"].join("\n"),
  );
  assert.deepEqual(out.notices, [], "no queued work must not cost a single prompt line");
});

test("status lines say what each queued task is waiting on", async () => {
  const out = await runQueue(
    [
      makeQueue(1),
      "queue.enqueueBatch([task('a'), task('b'), task('c', ['a'])]);",
      "notices.push(...formatQueuedDispatches(queue.snapshot(), Date.now()));",
    ].join("\n"),
  );
  assert.ok(out.notices.some((l) => l.includes("agentId=b") && l.includes("waiting for a slot")));
  assert.ok(out.notices.some((l) => l.includes("agentId=c") && l.includes("waiting for a")));
});
