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

/** Six independent list goals — should trip the merge heuristic. */
const mergedIndependentBrief = [
  "Do all of the following independent goals:",
  "- implement login form validation",
  "- add password reset email flow",
  "- fix navbar overflow on mobile",
  "- review payment webhook retries",
  "- investigate slow dashboard query",
  "- update README install section",
].join("\n");

/** Six+ list items dominated by serial dependency words — must not trip. */
const serialDominatedBrief = [
  "Execute this ordered workflow carefully:",
  "- first prepare the database schema",
  "- then migrate existing rows based on the schema",
  "- after migration, rebuild the search index",
  "- next verify queries against the new index",
  "- once verified, update the API handlers",
  "- finally deploy after the previous steps succeed",
].join("\n");

const shortTaskBrief = "Review the auth module.\n- check exports";

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

async function prepareAgents(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  // subagent/index.ts statically imports ../packages/computer-agent/*.
  await cp(
    join(sourceSubagentDirectory, "../packages/computer-agent"),
    join(directory, "packages/computer-agent"),
    { recursive: true },
  );
  await linkRuntimePackages(directory);

  const agentsDirectory = join(directory, "agents");
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(
    join(agentsDirectory, "probe.md"),
    "---\nname: probe\ndescription: Test-only probe agent\nread-only: true\n---\nReturn ok.\n",
    "utf8",
  );
  return agentsDirectory;
}

/**
 * Harness runs one or more subagent.execute calls described by `scenario`.
 * Child pi invocations hit the --mode branch and return a tiny assistant message.
 */
async function writeHarness(directory, scenario) {
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
  const scenario = ${JSON.stringify(scenario)};
  const results = {};
  for (const [name, params] of Object.entries(scenario)) {
    results[name] = await subagent.execute("validator-" + name, params, ...options);
  }
  process.stdout.write(JSON.stringify({ pid: process.pid, results }));
}
`,
    "utf8",
  );
  return harness;
}

async function runHarness(directory, agentsDirectory, harness, envExtra = {}) {
  const statsPath = join(directory, "telemetry", "subagent-stats.jsonl");
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
        // Default nudge on unless a test overrides.
        PIPI_SUBAGENT_DISPATCH_NUDGE: envExtra.PIPI_SUBAGENT_DISPATCH_NUDGE ?? "1",
        PIPI_SUBAGENT_DISPATCH_ENFORCE: envExtra.PIPI_SUBAGENT_DISPATCH_ENFORCE ?? "0",
        ...envExtra,
      },
    },
  );
  return { parsed: JSON.parse(stdout), statsPath };
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
      // fire-and-forget writer
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for ${expectedCount} dispatch stats records`);
}

function resultText(result) {
  const part = result?.content?.find((c) => c.type === "text");
  return typeof part?.text === "string" ? part.text : "";
}

test("6+ independent list items: nudge injected but dispatch succeeds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-dispatch-validator-nudge-"));
  try {
    const agentsDirectory = await prepareAgents(directory);
    const harness = await writeHarness(directory, {
      single: {
        agent: "probe",
        task: mergedIndependentBrief,
        title: "Merged single",
        background: false,
      },
    });
    const { parsed, statsPath } = await runHarness(directory, agentsDirectory, harness);
    const single = parsed.results.single;
    assert.notEqual(single.isError, true, "nudge must not block dispatch");
    const text = resultText(single);
    assert.match(text, /\[dispatch-shape\]/);
    assert.match(text, /brief_items=\[6\]/);
    assert.match(text, /NEVER merge independent goals into one brief/);
    assert.match(text, /ok|verified=/i);

    const records = await waitForStats(statsPath, 1);
    assert.equal(records[0].validator?.triggered, true);
    assert.equal(records[0].validator?.action, "nudge");
    assert.equal(records[0].validator?.findings?.[0]?.brief_items, 6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("enforce mode rejects merged single with actionable error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-dispatch-validator-enforce-"));
  try {
    const agentsDirectory = await prepareAgents(directory);
    const harness = await writeHarness(directory, {
      single: {
        agent: "probe",
        task: mergedIndependentBrief,
        title: "Merged single enforce",
        background: false,
      },
    });
    const { parsed, statsPath } = await runHarness(directory, agentsDirectory, harness, {
      PIPI_SUBAGENT_DISPATCH_ENFORCE: "1",
    });
    const single = parsed.results.single;
    assert.equal(single.isError, true, "enforce must reject merged single");
    const text = resultText(single);
    assert.match(text, /expected parallel tasks\[\]|multiple dispatches/i);
    assert.match(text, /got merged single/i);
    assert.match(text, /missing:/i);
    assert.match(text, /re-send this turn/i);
    assert.doesNotMatch(text, /\bok\b/);

    const records = await waitForStats(statsPath, 1);
    assert.equal(records[0].validator?.action, "enforce");
    assert.equal(records[0].validator?.triggered, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serial-word dominated long brief does not trigger", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-dispatch-validator-serial-"));
  try {
    const agentsDirectory = await prepareAgents(directory);
    const harness = await writeHarness(directory, {
      single: {
        agent: "probe",
        task: serialDominatedBrief,
        title: "Serial workflow",
        background: false,
      },
    });
    const { parsed, statsPath } = await runHarness(directory, agentsDirectory, harness);
    const single = parsed.results.single;
    assert.notEqual(single.isError, true);
    const text = resultText(single);
    assert.doesNotMatch(text, /\[dispatch-shape\]/);
    assert.doesNotMatch(text, /Dispatch shape rejected/);

    const records = await waitForStats(statsPath, 1);
    assert.equal(records[0].validator, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tasks[] mode flags only the oversized task brief", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-dispatch-validator-tasks-"));
  try {
    const agentsDirectory = await prepareAgents(directory);
    const harness = await writeHarness(directory, {
      tasks: {
        tasks: [
          { agent: "probe", task: shortTaskBrief, title: "Short task" },
          { agent: "probe", task: mergedIndependentBrief, title: "Merged task" },
        ],
        background: false,
      },
    });
    const { parsed, statsPath } = await runHarness(directory, agentsDirectory, harness);
    const tasks = parsed.results.tasks;
    assert.notEqual(tasks.isError, true, "nudge must not block tasks dispatch");
    const text = resultText(tasks);
    assert.match(text, /\[dispatch-shape\]/);
    assert.match(text, /tasks\[1\]/);
    assert.match(text, /brief_items=\[6\]/);
    assert.doesNotMatch(text, /tasks\[0\]/);

    const records = await waitForStats(statsPath, 1);
    assert.equal(records[0].mode, "tasks");
    assert.equal(records[0].validator?.triggered, true);
    assert.equal(records[0].validator?.action, "nudge");
    assert.deepEqual(records[0].validator?.findings, [{ task_index: 1, brief_items: 6 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("chain mode and same-agentId resume do not trigger", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-dispatch-validator-exempt-"));
  try {
    const agentsDirectory = await prepareAgents(directory);
    const harness = await writeHarness(directory, {
      chain: {
        chain: [
          { agent: "probe", task: mergedIndependentBrief, title: "Chain step" },
          { agent: "probe", task: "Continue from {previous}" },
        ],
      },
      resume: {
        agent: "probe",
        task: mergedIndependentBrief,
        agentId: "resume-worker",
        // fresh omitted → treated as same-agentId continue; validator must skip.
        title: "Resume merged",
        background: false,
      },
    });
    const { parsed, statsPath } = await runHarness(directory, agentsDirectory, harness);
    assert.notEqual(parsed.results.chain.isError, true);
    assert.notEqual(parsed.results.resume.isError, true);
    assert.doesNotMatch(resultText(parsed.results.chain), /\[dispatch-shape\]|Dispatch shape rejected/);
    assert.doesNotMatch(resultText(parsed.results.resume), /\[dispatch-shape\]|Dispatch shape rejected/);

    const records = await waitForStats(statsPath, 2);
    for (const record of records) {
      assert.equal(record.validator, undefined, `${record.mode} must not record validator`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
