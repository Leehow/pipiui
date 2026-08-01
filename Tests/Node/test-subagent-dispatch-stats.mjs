import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(
  repositoryRoot,
  "Sources/PipiUI/PiExt/subagent",
);
const piPackageRoot = join(
  homedir(),
  ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");

const singleBrief = [
  "Investigate the dispatcher.",
  "- first item",
  "* second item",
  "• third item",
  "1. fourth item",
  "2) fifth item",
  "not a list item",
].join("\n");
const taskBriefs = [
  "Review the first workflow.\n- identify inputs",
  "Review the second workflow.\n1) identify outputs\n2. identify failures",
];
const chainBriefs = ["Prepare context.", "- Continue from {previous}"];

async function linkRuntimePackages(directory) {
  const scoped = join(directory, "node_modules/@earendil-works");
  await mkdir(scoped, { recursive: true });
  await Promise.all([
    symlink(piPackageRoot, join(scoped, "pi-coding-agent"), "dir"),
    symlink(
      join(piNodeModules, "@earendil-works/pi-agent-core"),
      join(scoped, "pi-agent-core"),
      "dir",
    ),
    symlink(
      join(piNodeModules, "@earendil-works/pi-ai"),
      join(scoped, "pi-ai"),
      "dir",
    ),
    symlink(
      join(piNodeModules, "@earendil-works/pi-tui"),
      join(scoped, "pi-tui"),
      "dir",
    ),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

async function prepareHarness(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const agentsDirectory = join(directory, "agents");
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(
    join(agentsDirectory, "probe.md"),
    "---\nname: probe\ndescription: Test-only probe agent\nread-only: true\n---\nReturn ok.\n",
    "utf8",
  );

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    `if (process.argv.includes("--mode")) {
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stopReason: "end",
    },
  }) + "\\n");
} else {
  const { default: install } = await import("./subagent/index.ts");
  const tools = new Map();
  install({
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    on() {},
  });
  const subagent = tools.get("subagent");
  const options = [new AbortController().signal, undefined, { cwd: process.cwd(), hasUI: false }];
  const single = await subagent.execute(
    "stats-single",
    ${JSON.stringify({ agent: "probe", task: singleBrief, title: "Single dispatch", background: false })},
    ...options,
  );
  const tasks = await subagent.execute(
    "stats-tasks",
    ${JSON.stringify({
      tasks: [
        { agent: "probe", task: taskBriefs[0], title: "First parallel task" },
        { agent: "probe", task: taskBriefs[1], title: "Second parallel task" },
      ],
      background: false,
    })},
    ...options,
  );
  const chain = await subagent.execute(
    "stats-chain",
    ${JSON.stringify({
      chain: [
        { agent: "probe", task: chainBriefs[0], title: "Chain start" },
        { agent: "probe", task: chainBriefs[1] },
      ],
    })},
    ...options,
  );
  process.stdout.write(JSON.stringify({ pid: process.pid, single, tasks, chain }));
}
`,
    "utf8",
  );
  return { agentsDirectory, harness };
}

async function runHarness(directory, agentsDirectory, harness, statsPath) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", harness],
    {
      cwd: directory,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "1",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: "",
        PIPIUI_AGENTS_DIR: agentsDirectory,
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_WORKTREE: "0",
        PIPI_SUBAGENT_STATS_PATH: statsPath,
      },
    },
  );
  return JSON.parse(stdout);
}

async function waitForStats(statsPath, expectedCount) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const lines = (await readFile(statsPath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      if (lines.length >= expectedCount) return lines.map((line) => JSON.parse(line));
    } catch {
      // The fire-and-forget writer may not have created the file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for ${expectedCount} dispatch stats records`);
}

function assertDispatchSucceeded(result, name) {
  assert.notEqual(result[name].isError, true, `${name} dispatch should succeed`);
}

function assertRecordShape(record, result, mode, taskCount) {
  assert.equal(typeof record.ts, "string");
  assert.equal(record.pid, result.pid);
  assert.equal(record.depth, 1);
  assert.equal(record.mode, mode);
  assert.equal(record.task_count, taskCount);
  assert.equal(record.background, false);
  assert.ok(Array.isArray(record.tasks));
  assert.equal(record.tasks.length, taskCount);
}

test("single, tasks, and chain dispatches append structured stats records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-stats-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory);
    const statsPath = join(directory, "telemetry", "subagent-stats.jsonl");
    const result = await runHarness(directory, agentsDirectory, harness, statsPath);
    assertDispatchSucceeded(result, "single");
    assertDispatchSucceeded(result, "tasks");
    assertDispatchSucceeded(result, "chain");

    const records = await waitForStats(statsPath, 3);
    const single = records.find((record) => record.mode === "single");
    const tasks = records.find((record) => record.mode === "tasks");
    const chain = records.find((record) => record.mode === "chain");
    assert.ok(single, "single dispatch should be recorded");
    assert.ok(tasks, "tasks dispatch should be recorded");
    assert.ok(chain, "chain dispatch should be recorded");

    assertRecordShape(single, result, "single", 1);
    assert.deepEqual(single.tasks, [{
      agent: "probe",
      title: "Single dispatch",
      brief_chars: singleBrief.length,
      brief_items: 5,
    }]);

    assertRecordShape(tasks, result, "tasks", 2);
    assert.deepEqual(tasks.tasks, [
      {
        agent: "probe",
        title: "First parallel task",
        brief_chars: taskBriefs[0].length,
        brief_items: 1,
      },
      {
        agent: "probe",
        title: "Second parallel task",
        brief_chars: taskBriefs[1].length,
        brief_items: 2,
      },
    ]);

    assertRecordShape(chain, result, "chain", 2);
    assert.deepEqual(chain.tasks, [
      {
        agent: "probe",
        title: "Chain start",
        brief_chars: chainBriefs[0].length,
        brief_items: 0,
      },
      {
        agent: "probe",
        title: null,
        brief_chars: chainBriefs[1].length,
        brief_items: 1,
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dispatch succeeds when the stats destination cannot be written", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-stats-failure-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory);
    const blockedDirectory = join(directory, "blocked");
    await writeFile(blockedDirectory, "not a directory", "utf8");
    const statsPath = join(blockedDirectory, "subagent-stats.jsonl");
    const result = await runHarness(directory, agentsDirectory, harness, statsPath);

    assertDispatchSucceeded(result, "single");
    assertDispatchSucceeded(result, "tasks");
    assertDispatchSucceeded(result, "chain");
    await assert.rejects(readFile(statsPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
