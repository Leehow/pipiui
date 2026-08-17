/**
 * Advisory dispatch scopes: prefix overlap + warning text on the sync tool result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const electronSubagent = join(repositoryRoot, "Electron/resources/runtime/pi-ext/subagent");
const overlapModule = await import(pathToFileURL(join(electronSubagent, "scope-overlap.ts")).href);
const {
  pathsOverlap,
  findScopeOverlaps,
  formatDispatchScopeWarning,
  recordRunningDispatchScope,
  clearRunningDispatchScope,
  runningDispatchScopes,
} = overlapModule;

const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");

test("pathsOverlap: same file, prefix contain, no intersection", () => {
  assert.equal(pathsOverlap("src/foo.ts", "src/foo.ts"), true);
  assert.equal(pathsOverlap("src/", "src/foo.ts"), true);
  assert.equal(pathsOverlap("src/foo", "src/foo/bar.ts"), true);
  assert.equal(pathsOverlap("src\\foo\\", "src/foo/bar.ts"), true);
  assert.equal(pathsOverlap("src/foo", "src/foobar"), false);
  assert.equal(pathsOverlap("src/a.ts", "src/b.ts"), false);
  assert.equal(pathsOverlap("./src/../lib/x.ts", "lib/x.ts"), true);
});

test("findScopeOverlaps skips empty scope and same agentId", () => {
  assert.deepEqual(findScopeOverlaps({ agentId: "a", scope: undefined }, [{ agentId: "b", scope: ["src/"] }]), []);
  assert.deepEqual(findScopeOverlaps({ agentId: "a", scope: ["src/"] }, [{ agentId: "b" }]), []);
  assert.deepEqual(
    findScopeOverlaps({ agentId: "a", scope: ["src/"] }, [{ agentId: "a", scope: ["src/foo.ts"] }]),
    [],
  );
  const hits = findScopeOverlaps({ agentId: "a", scope: ["src/foo.ts"] }, [
    { agentId: "b", scope: ["src/"] },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].agentId, "b");
});

test("formatDispatchScopeWarning uses running map and queued records", () => {
  runningDispatchScopes.clear();
  recordRunningDispatchScope("runner", ["Electron/packages/ui/src/session/"]);
  const warn = formatDispatchScopeWarning(
    [{ agentId: "new", scope: ["Electron/packages/ui/src/session/store.ts"] }],
    [{ agentId: "queued", scope: ["Electron/packages/host/"] }],
  );
  assert.match(warn, /\[subagent-overlap\]/);
  assert.match(warn, /agentId=runner/);
  const quiet = formatDispatchScopeWarning(
    [{ agentId: "other", scope: ["Tests/Node/"] }],
    [{ agentId: "queued", scope: ["Electron/packages/host/"] }],
  );
  assert.equal(quiet, "");
  clearRunningDispatchScope("runner");
});

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

test("dispatch tool result warns on overlap and stays quiet without it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-scope-"));
  try {
    await cp(electronSubagent, join(directory, "subagent"), { recursive: true });
    await cp(
      join(electronSubagent, "../packages/computer-agent"),
      join(directory, "packages/computer-agent"),
      { recursive: true },
    );
    await cp(
      join(electronSubagent, "../subagent-host"),
      join(directory, "subagent-host"),
      { recursive: true },
    );
    await linkRuntimePackages(directory);
    await mkdir(join(directory, "agents"), { recursive: true });
    await writeFile(
      join(directory, "agents", "probe.md"),
      "---\nname: probe\ndescription: Test-only probe agent\nread-only: true\n---\nReturn ok.\n",
      "utf8",
    );
    const harness = join(directory, "harness.mjs");
    await writeFile(
      harness,
      `import { recordRunningDispatchScope, clearRunningDispatchScope } from "./subagent/scope-overlap.ts";
import install from "./subagent/index.ts";
const tools = new Map();
install({
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  on() {},
});
const subagent = tools.get("subagent");
recordRunningDispatchScope("runner", ["src/session/"]);
const ctx = { cwd: process.cwd(), hasUI: false };
const overlap = await subagent.execute("scope-overlap", {
  agent: "probe",
  task: "touch session store",
  title: "session store",
  agentId: "writer",
  scope: ["src/session/store.ts"],
  background: true,
}, new AbortController().signal, undefined, ctx);
const abort = tools.get("subagent_abort");
const abortOpts = [new AbortController().signal, undefined, ctx];
if (abort) await abort.execute("scope-abort", { agentId: "writer" }, ...abortOpts);
clearRunningDispatchScope("runner");
const quiet = await subagent.execute("scope-quiet", {
  agent: "probe",
  task: "touch tests",
  title: "node tests",
  agentId: "tester",
  scope: ["Tests/Node/"],
  background: true,
}, new AbortController().signal, undefined, ctx);
if (abort) await abort.execute("scope-abort-2", { agentId: "tester" }, ...abortOpts);
const none = await subagent.execute("scope-none", {
  agent: "probe",
  task: "no declared scope",
  title: "no scope",
  agentId: "noscope",
  background: true,
}, new AbortController().signal, undefined, ctx);
if (abort) await abort.execute("scope-abort-3", { agentId: "noscope" }, ...abortOpts);
process.stdout.write(JSON.stringify({
  overlap: overlap.content?.[0]?.text ?? "",
  quiet: quiet.content?.[0]?.text ?? "",
  none: none.content?.[0]?.text ?? "",
}));
`,
      "utf8",
    );
    const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      timeout: 60000,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "0",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: "",
        PIPIUI_AGENTS_DIR: join(directory, "agents"),
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_WORKTREE: "0",
      },
    });
    const out = JSON.parse(stdout.trim().split("\n").pop());
    assert.match(out.overlap, /\[subagent-overlap\]/);
    assert.match(out.overlap, /agentId=runner/);
    assert.doesNotMatch(out.quiet, /\[subagent-overlap\]/);
    assert.doesNotMatch(out.none, /\[subagent-overlap\]/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
