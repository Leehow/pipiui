/**
 * The boss ledger's `## Tasks` table is runtime-owned.
 *
 * The boss used to hand-write these rows before dispatching, which put every new user task in a
 * `pending` row that nobody was working on — a queue in the one place fan-out forbids one — and
 * the hand-kept table drifted into duplicate ids and contradictory states. These tests pin the
 * replacement: rows appear only when a worker actually owns the work, one row per agentId, and
 * a terminal event updates that row in place instead of appending a second one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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

/** Run one scenario against a real ledger file and return its final text. */
async function runLedger(body) {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-boss-ledger-"));
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);
  const projectRoot = join(directory, "project");
  await mkdir(projectRoot, { recursive: true });

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    [
      'import { beginWave, recordTaskDispatch, recordTaskTerminal, seedBossLedger } from "./subagent/boss-ledger.ts";',
      `const mainCwd = ${JSON.stringify(projectRoot)};`,
      'const sessionKey = "testkey";',
      "const dispatch = (agentId, title, role, blockedBy) =>",
      "  recordTaskDispatch({ mainCwd, sessionKey, agentId, title, task: title, role, blockedBy });",
      "const terminal = (agentId, status, verified) =>",
      "  recordTaskTerminal({ mainCwd, sessionKey, agentId, title: agentId, task: agentId, role: 'general-purpose', status, verified });",
      "seedBossLedger(mainCwd, sessionKey);",
      body,
      // Writes are queued and fire-and-forget; let the queue drain before the process exits.
      "await new Promise((r) => setTimeout(r, 400));",
    ].join("\n"),
    "utf-8",
  );

  await execFileAsync(process.execPath, ["--experimental-strip-types", harness], { cwd: directory });
  return readFile(join(projectRoot, ".pi/boss/ledger-testkey.md"), "utf-8");
}

/** Dispatch once into a pre-existing ledger file and return its text afterwards. */
async function runLegacyLedger(existingContent) {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-boss-ledger-"));
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);
  const projectRoot = join(directory, "project");
  await mkdir(join(projectRoot, ".pi/boss"), { recursive: true });
  const ledgerFile = join(projectRoot, ".pi/boss/ledger-testkey.md");
  await writeFile(ledgerFile, existingContent, "utf-8");

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    [
      'import { beginWave, recordTaskDispatch } from "./subagent/boss-ledger.ts";',
      "beginWave();",
      `recordTaskDispatch({ mainCwd: ${JSON.stringify(projectRoot)}, sessionKey: "testkey", agentId: "x", title: "X", task: "X", role: "general-purpose" });`,
      "await new Promise((r) => setTimeout(r, 400));",
    ].join("\n"),
    "utf-8",
  );
  await execFileAsync(process.execPath, ["--experimental-strip-types", harness], { cwd: directory });
  return readFile(ledgerFile, "utf-8");
}

/** Task rows only, header and divider excluded. */
function taskRows(ledger) {
  const start = ledger.indexOf("## Tasks");
  const rest = ledger.slice(start);
  const end = rest.indexOf("\n## ", 1);
  return (end === -1 ? rest : rest.slice(0, end))
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .filter((line) => !line.includes("| ID |") && !/^\|\s*-+/.test(line));
}

test("the seeded table offers no state for work nobody is doing", async () => {
  const ledger = await runLedger("");
  assert.ok(ledger.includes("## Tasks"), "seed must lay out the Tasks section");
  assert.ok(
    ledger.includes("Runtime-owned: written from real dispatch and completion events"),
    "the table must say who owns it, so the boss does not hand-edit it",
  );
  assert.ok(
    !ledger.includes("pending"),
    "a `pending` status is a queue slot; the seed must not offer one",
  );
  assert.equal(taskRows(ledger).length, 0, "seeding alone dispatches nothing, so there are no rows");
});

test("a dispatch writes exactly one in-flight row carrying its wave", async () => {
  const ledger = await runLedger(
    ['beginWave();', 'dispatch("quota-pill", "Fix the quota pill", "general-purpose");'].join("\n"),
  );
  const rows = taskRows(ledger);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /\|\s*quota-pill\s*\|/);
  assert.match(rows[0], /\|\s*Fix the quota pill\s*\|/);
  assert.match(rows[0], /\|\s*general-purpose\s*\|/);
  assert.match(rows[0], /\|\s*1\s*\|/, "the first tool invocation is wave 1");
  assert.match(rows[0], /\|\s*in-flight\s*\|/);
});

test("one wave's parallel dispatches all land, and share a wave number", async () => {
  const ledger = await runLedger(
    [
      "beginWave();",
      'dispatch("a-one", "First", "general-purpose");',
      'dispatch("a-two", "Second", "explore");',
      'dispatch("a-three", "Third", "reviewer");',
    ].join("\n"),
  );
  const rows = taskRows(ledger);
  assert.equal(rows.length, 3, "a concurrent wave must not lose rows to a write race");
  for (const row of rows) assert.match(row, /\|\s*1\s*\|/);
  assert.equal(rows.filter((r) => r.includes("in-flight")).length, 3);
});

test("a second tool invocation is a second wave", async () => {
  const ledger = await runLedger(
    [
      "beginWave();",
      'dispatch("w1", "Wave one work", "general-purpose");',
      "beginWave();",
      'dispatch("w2", "Wave two work", "general-purpose");',
    ].join("\n"),
  );
  const rows = taskRows(ledger);
  assert.match(rows.find((r) => r.includes("w1")), /\|\s*1\s*\|/);
  assert.match(rows.find((r) => r.includes("w2")), /\|\s*2\s*\|/);
});

test("a terminal event updates the dispatch row instead of appending a second one", async () => {
  const ledger = await runLedger(
    [
      "beginWave();",
      'dispatch("quota-pill", "Fix the quota pill", "general-purpose");',
      "await new Promise((r) => setTimeout(r, 100));",
      'terminal("quota-pill", "done", "pass");',
    ].join("\n"),
  );
  const rows = taskRows(ledger);
  assert.equal(rows.length, 1, "the same agentId must never occupy two contradictory rows");
  assert.match(rows[0], /\|\s*done\s*\|/);
  assert.match(rows[0], /verified=pass/);
  assert.match(rows[0], /\|\s*1\s*\|/, "a terminal update keeps the wave its dispatch assigned");
  assert.ok(!rows[0].includes("in-flight"));
});

test("a failed run is recorded as failed with its attested verdict", async () => {
  const ledger = await runLedger(
    [
      "beginWave();",
      'dispatch("bad-one", "Break something", "general-purpose");',
      "await new Promise((r) => setTimeout(r, 100));",
      'terminal("bad-one", "failed", "fail");',
    ].join("\n"),
  );
  const rows = taskRows(ledger);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /\|\s*failed\s*\|/);
  assert.match(rows[0], /verified=fail/);
});

test("blockedBy is recorded as a note, never as a reason to withhold the row", async () => {
  const ledger = await runLedger(
    ["beginWave();", 'dispatch("later", "Depends on earlier", "general-purpose", ["earlier"]);'].join("\n"),
  );
  const rows = taskRows(ledger);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /\|\s*in-flight\s*\|/, "a dependency tag does not park a task in a queue");
  assert.match(rows[0], /blocked-by: earlier/);
});

test("a pipe or newline in a title cannot break the table", async () => {
  const ledger = await runLedger(
    ["beginWave();", 'dispatch("messy", "a | b\\nc", "general-purpose");'].join("\n"),
  );
  const rows = taskRows(ledger);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].split("|").length - 1, 7, "one row is exactly six cells");
});

test("a closeout disposition is upserted, never appended twice", async () => {
  const ledger = await runLedger(
    [
      'import { recordCloseoutDisposition } from "./subagent/boss-ledger.ts";',
      "const closeout = (agentId, disposition, reason) =>",
      "  recordCloseoutDisposition({ mainCwd, sessionKey, agentId, disposition, reason });",
      'closeout("quota-pill", "retained", "worker worktree has uncommitted changes");',
      "await new Promise((r) => setTimeout(r, 150));",
      'closeout("quota-pill", "cleaned", "merged and cleaned");',
    ].join("\n"),
  );
  const start = ledger.indexOf("## Closeout dispositions");
  const rows = ledger
    .slice(start)
    .split("\n")
    .filter((l) => l.startsWith("|") && l.includes("quota-pill"));
  assert.equal(rows.length, 1, "a later disposition replaces the earlier one for the same item");
  assert.match(rows[0], /\|\s*cleaned\s*\|/);
  assert.match(rows[0], /merged and cleaned/);
  assert.match(rows[0], /\d{4}-\d{2}-\d{2}T/, "evidence carries a timestamp, as the Swift mirror does");
});

test("a ledger seeded under the old hand-written layout is left alone", async () => {
  const legacy = [
    "# Ledger",
    "",
    "## Tasks",
    "| ID | title | status | agent | wave | notes | blocked-by |",
    "| -- | ----- | ------ | ----- | ---- | ----- | ---------- |",
    "| old-one | Something earlier | in-flight | general-purpose | 3 | | |",
    "",
    "## Done",
    "",
  ].join("\n");
  const after = await runLegacyLedger(legacy);
  assert.equal(
    after,
    legacy,
    "the wider legacy header must never receive our narrower rows, nor have its agent column read as a wave",
  );
});

test("a ledger with no Tasks table is left untouched rather than repaired", async () => {
  const original = "# Ledger\nhand-written, no table here\n";
  assert.equal(
    await runLegacyLedger(original),
    original,
    "guessing at a damaged table is how the hand-written one got worse",
  );
});
