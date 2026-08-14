import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const sourceComputerAgentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/packages/computer-agent");
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

test("persisted running state is historical evidence, never a live subagent status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-persisted-running-"));
  try {
    await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
    await cp(sourceComputerAgentDirectory, join(directory, "packages/computer-agent"), { recursive: true });
    await linkRuntimePackages(directory);

    const piDirectory = join(directory, ".pi");
    const sessionsDirectory = join(piDirectory, "agent-sessions");
    await mkdir(sessionsDirectory, { recursive: true });
    await writeFile(join(sessionsDirectory, "probe_pipiui-electron-fast-app.jsonl"), "{}\n", "utf8");
    await writeFile(join(piDirectory, "agent-slices.json"), JSON.stringify({
      version: 1,
      slices: [{
        agentId: "electron-fast-app",
        runId: "run-old",
        name: "implementer",
        task: "Package Electron app",
        state: "running",
        updatedAt: 1,
      }],
    }), "utf8");

    const harness = join(directory, "probe.mjs");
    await writeFile(harness, `
const tools = new Map();
const handlers = new Map();
const fakePi = new Proxy({
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  on(name, handler) { handlers.set(name, handler); },
}, { get(target, key) { return key in target ? target[key] : () => {}; } });
const { default: install } = await import("./subagent/index.ts");
install(fakePi);
const status = tools.get("subagent_status");
if (!status) throw new Error("subagent_status was not registered");
const text = async (params) => String((await status.execute("probe", params)).content?.[0]?.text ?? "");
process.stdout.write(JSON.stringify({
  byId: await text({ agentId: "electron-fast-app" }),
  onlyRunning: await text({ onlyRunning: true }),
  all: await text({}),
}));
`, "utf8");

    const { stdout, stderr } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "0",
        PIPIUI_MAIN_CWD: directory,
        PIPIUI_AGENTS_DIR: join(directory, "no-agents"),
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_WORKTREE: "0",
      },
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    assert.equal(stderr, "");
    const output = JSON.parse(stdout);

    assert.match(output.byId, /state: interrupted \(not running in this process\)/);
    assert.match(output.byId, /last recorded state: running/);
    assert.match(output.byId, /stored conversation: yes/);
    assert.equal(output.onlyRunning, "No running subagent jobs.");
    assert.match(output.all, /^No subagent jobs recorded in this process\./);
    assert.match(output.all, /Resumable workers \(stored context, not running\):/);
    assert.match(output.all, /state=interrupted \(not running in this process\); last recorded state=running/);
    assert.doesNotMatch(output.all, /— state=running/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
