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

/**
 * Fake-pi harness:
 * - When re-invoked with --mode (child worker), fail N times with a configured stderr
 *   signature, then succeed (or keep failing).
 * - Parent installs the real subagent extension and runs one foreground dispatch so the
 *   result + captured [subagent-autoresume]/[subagent-done] messages are returned as JSON.
 */
async function prepareHarness(directory, { failTimes, failStderr, agentId }) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const agentsDirectory = join(directory, "agents");
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(
    join(agentsDirectory, "probe.md"),
    "---\nname: probe\ndescription: Test-only probe agent\nread-only: true\n---\nReturn ok.\n",
    "utf8",
  );

  const counterPath = join(directory, "child-spawn-count.txt");
  await writeFile(counterPath, "0", "utf8");

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    `import { readFileSync, writeFileSync } from "node:fs";

const counterPath = ${JSON.stringify(counterPath)};
const failTimes = ${JSON.stringify(failTimes)};
const failStderr = ${JSON.stringify(failStderr)};
const agentId = ${JSON.stringify(agentId)};

if (process.argv.includes("--mode")) {
  let n = Number(readFileSync(counterPath, "utf8") || "0");
  n += 1;
  writeFileSync(counterPath, String(n));
  if (n <= failTimes) {
    process.stderr.write(failStderr + "\\n");
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "recovered-ok spawn=" + n }],
        stopReason: "end",
      },
    }) + "\\n",
  );
  process.exit(0);
}

const delivered = [];
const { default: install } = await import("./subagent/index.ts");
install({
  registerTool(tool) {
    globalThis.__tool = tool;
  },
  registerCommand() {},
  on() {},
  async sendUserMessage(text) {
    delivered.push(String(text));
  },
});

const subagent = globalThis.__tool;
const started = Date.now();
const result = await subagent.execute(
  "autoresume-test",
  {
    agent: "probe",
    task: "simulate transient death",
    agentId,
    background: false,
  },
  new AbortController().signal,
  undefined,
  { cwd: process.cwd(), hasUI: false },
);
const elapsedMs = Date.now() - started;
const spawns = Number(readFileSync(counterPath, "utf8") || "0");
process.stdout.write(
  JSON.stringify({
    result,
    delivered,
    spawns,
    elapsedMs,
    text: result?.content?.[0]?.text ?? "",
    isError: !!result?.isError,
    details: result?.details ?? null,
  }),
);
`,
    "utf8",
  );
  return { agentsDirectory, harness, counterPath };
}

async function runHarness(directory, agentsDirectory, harness, extraEnv = {}) {
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
        // Keep tests fast; production default remains 20s→60s.
        PIPI_SUBAGENT_AUTORESUME_BACKOFF_MS: "40,80",
        ...extraEnv,
      },
      // Exhausted path: 3 spawns + 40+80ms backoff; leave headroom.
      timeout: 15_000,
      maxBuffer: 5 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

test("transient child death triggers auto-resume with backoff then succeeds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-ok-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 1,
      failStderr: "Error: fetch failed",
      agentId: "resume-ok",
    });
    const out = await runHarness(directory, agentsDirectory, harness);

    assert.equal(out.spawns, 2, "initial death + one auto-resume spawn");
    assert.notEqual(out.isError, true, "dispatch should succeed after resume");
    assert.match(out.text, /recovered-ok spawn=2/);
    const autoresume = out.delivered.filter((m) => m.includes("[subagent-autoresume]"));
    assert.equal(autoresume.length, 1, "one light auto-resume notify");
    assert.match(autoresume[0], /attempt=1\/2/);
    assert.match(autoresume[0], /fetch failed/i);
    assert.match(autoresume[0], /backoffMs=40/);
    // Backoff ~40ms should be visible vs an instant double-spawn, without flaking hard.
    assert.ok(out.elapsedMs >= 30, `expected backoff delay, elapsed=${out.elapsedMs}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("auto-resume exhausts after 2 resumes and reports terminal failure with reason", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-exhaust-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 99,
      failStderr: "Service temporarily unavailable",
      agentId: "resume-exhaust",
    });
    const out = await runHarness(directory, agentsDirectory, harness);

    assert.equal(out.spawns, 3, "initial + 2 auto-resumes");
    assert.equal(out.isError, true, "must end as failure");
    assert.match(
      out.text,
      /auto-resume exhausted \(2\/2\)/i,
      "terminal text must include exhausted reason",
    );
    assert.match(out.text, /Service temporarily unavailable/i);
    const autoresume = out.delivered.filter((m) => m.includes("[subagent-autoresume]"));
    assert.equal(autoresume.length, 2, "notify once per resume attempt");
    assert.match(autoresume[0], /attempt=1\/2/);
    assert.match(autoresume[0], /backoffMs=40/);
    assert.match(autoresume[1], /attempt=2\/2/);
    assert.match(autoresume[1], /backoffMs=80/);
    // Foreground path returns the tool result directly; details.results carry the failure.
    const single = out.details?.results?.[0];
    assert.ok(single, "details.results[0] present");
    assert.equal(single.exitCode, 1);
    assert.match(String(single.errorMessage ?? single.stderr ?? ""), /auto-resume exhausted/i);
    assert.ok(out.elapsedMs >= 100, `expected 40+80 backoff, elapsed=${out.elapsedMs}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("401 Unauthorized is non-transient and does not auto-resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-401-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 99,
      failStderr: "HTTP 401 Unauthorized: invalid api key",
      agentId: "resume-401",
    });
    const out = await runHarness(directory, agentsDirectory, harness);

    assert.equal(out.spawns, 1, "must not retry non-transient auth errors");
    assert.equal(out.isError, true);
    assert.equal(
      out.delivered.filter((m) => m.includes("[subagent-autoresume]")).length,
      0,
      "no auto-resume notify",
    );
    assert.doesNotMatch(out.text, /auto-resume exhausted/i);
    assert.match(out.text, /401|Unauthorized|invalid api key/i);
    assert.ok(out.elapsedMs < 500, `should fail immediately, elapsed=${out.elapsedMs}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PIPI_SUBAGENT_AUTORESUME=0 disables automatic resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-autoresume-off-"));
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory, {
      failTimes: 99,
      failStderr: "Connection error",
      agentId: "resume-off",
    });
    const out = await runHarness(directory, agentsDirectory, harness, {
      PIPI_SUBAGENT_AUTORESUME: "0",
    });

    assert.equal(out.spawns, 1);
    assert.equal(out.isError, true);
    assert.equal(out.delivered.filter((m) => m.includes("[subagent-autoresume]")).length, 0);
    assert.match(out.text, /Connection error/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
