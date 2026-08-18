/**
 * Writable workers must not discover settings.json packages.
 *
 * The Boss session is intentionally read-only. general-purpose is the write
 * path. Pi's `setActiveTools` replaces the whole active set; a settings
 * package that calls it after a partial registry (the live chatrpgv4 keeper
 * does this unless PI_SUBAGENT_CHILD=1) leaves the worker with only `read`.
 *
 * MAIN already passes `--no-extensions` so packages never load. Workers must
 * do the same. Explicit `-e` mounts still load.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRuntimeDirectory = join(repositoryRoot, "Electron/resources/runtime/pi-ext");
const sourceAgentsDirectory = join(sourceRuntimeDirectory, "agents");
const piPackageRoot = join(repositoryRoot, "Electron/node_modules/@earendil-works/pi-coding-agent");
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

async function git(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

async function prepareHarness(directory) {
  const runtime = join(directory, "runtime");
  const agents = join(directory, "agents");
  const repository = join(directory, "repo");
  const capture = join(directory, "child-spawns.jsonl");
  const resultFile = join(directory, "dispatch-result.json");
  await cp(sourceRuntimeDirectory, runtime, { recursive: true });
  await cp(sourceAgentsDirectory, agents, { recursive: true });
  await linkRuntimePackages(runtime);
  await mkdir(repository, { recursive: true });
  await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
  await git(repository, ["init", "-q"]);
  await git(repository, ["config", "user.email", "fixture@example.invalid"]);
  await git(repository, ["config", "user.name", "PipiUI Fixture"]);
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-qm", "fixture"]);

  const harness = join(runtime, "harness.mjs");
  await writeFile(
    harness,
    `import fs from "node:fs";

if (process.argv.includes("--mode")) {
  fs.appendFileSync(process.env.PIPIUI_CAPTURE_FILE, JSON.stringify({
    args: process.argv.slice(2),
    env: {
      PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD ?? null,
    },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "captured" }],
      stopReason: "end",
    },
  }) + "\\n");
  process.exit(0);
}

const { default: install } = await import("./subagent/index.ts");
const tools = new Map();
install({
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  on() {},
  async sendUserMessage() {},
});
const subagent = tools.get("subagent");
try {
  const result = await subagent.execute(
    "isolation-probe",
    {
      agent: "general-purpose",
      agentId: "probe-gp-isolation",
      task: "capture:probe-general",
      background: false,
    },
    new AbortController().signal,
    undefined,
    { cwd: process.env.PIPIUI_MAIN_CWD, hasUI: false },
  );
  fs.writeFileSync(process.env.PIPIUI_RESULT_FILE, JSON.stringify({
    toolNames: [...tools.keys()],
    content: result?.content ?? null,
    details: result?.details ?? null,
  }, null, 2));
} catch (error) {
  fs.writeFileSync(process.env.PIPIUI_RESULT_FILE, JSON.stringify({
    toolNames: [...tools.keys()],
    error: error instanceof Error ? error.stack : String(error),
  }, null, 2));
  throw error;
}
`,
    "utf8",
  );
  return { repository, capture, resultFile, harness, agents };
}

function toolAllowlist(record) {
  const index = record.args.indexOf("--tools");
  assert.ok(index >= 0, `expected --tools: ${JSON.stringify(record.args)}`);
  return new Set(record.args[index + 1].split(",").filter(Boolean));
}

test("general-purpose worker spawn isolates discovery and keeps write tools", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-worker-ext-isolation-"));
  try {
    const fixture = await prepareHarness(directory);
    await writeFile(fixture.capture, "", "utf8");
    await execFileAsync(process.execPath, ["--experimental-strip-types", fixture.harness], {
      cwd: fixture.repository,
      env: {
        ...process.env,
        HOME: join(directory, "home"),
        PIPIUI_AGENT_DEPTH: "1",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: fixture.repository,
        PIPIUI_AGENTS_DIR: fixture.agents,
        PIPIUI_WORKTREE: "0",
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_SUBAGENT_EXT: "",
        PIPIUI_SEARCH_SCOPE_EXT: "",
        PIPIUI_COMPUTER_EXT: "",
        PIPIUI_COMPUTER_CAPABILITY: "",
        PIPIUI_WEB_ACCESS_EXT: "",
        PIPIUI_ARXIV_EXT: "",
        PIPIUI_CAPTURE_FILE: fixture.capture,
        PIPIUI_RESULT_FILE: fixture.resultFile,
      },
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30_000,
    });
    const captures = (await readFile(fixture.capture, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const dispatch = JSON.parse(await readFile(fixture.resultFile, "utf8"));
    assert.equal(
      captures.length,
      1,
      `one general-purpose child spawn; dispatch=${JSON.stringify(dispatch)}`,
    );
    const record = captures[0];
    assert.ok(
      record.args.includes("--no-extensions"),
      `settings packages must not load on workers: ${JSON.stringify(record.args)}`,
    );
    assert.equal(
      record.env.PI_SUBAGENT_CHILD,
      "1",
      "packages that still load must keep the child-owned tool surface",
    );
    const tools = toolAllowlist(record);
    for (const name of ["read", "bash", "edit", "write"]) {
      assert.ok(tools.has(name), `general-purpose --tools must include ${name}: ${[...tools]}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
