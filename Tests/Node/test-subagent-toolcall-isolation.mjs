import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const piPackageRoot = join(
  repositoryRoot,
  "Electron/node_modules/@earendil-works/pi-coding-agent",
);
const piNodeModules = join(piPackageRoot, "node_modules");
const runtimeSources = [
  "Sources/PipiUI/PiExt/subagent",
  "Electron/resources/runtime/pi-ext/subagent",
];

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

async function probeOverlappingInvocations(root, source, index) {
  const fixture = join(root, `fixture-${index}`);
  const runtime = join(fixture, "runtime");
  const repository = join(fixture, "repo");
  const agents = join(fixture, "agents");
  const home = join(fixture, "home");
  const sourceRoot = dirname(join(repositoryRoot, source));
  await Promise.all([
    cp(join(repositoryRoot, source), join(runtime, "subagent"), { recursive: true }),
    cp(
      join(sourceRoot, "packages/computer-agent"),
      join(runtime, "packages/computer-agent"),
      { recursive: true },
    ),
    mkdir(repository, { recursive: true }),
    mkdir(agents, { recursive: true }),
    mkdir(home, { recursive: true }),
  ]);
  await linkRuntimePackages(runtime);
  await writeFile(
    join(agents, "probe.md"),
    "---\nname: probe\ndescription: Invocation isolation probe\nread-only: true\n---\nReturn ok.\n",
    "utf8",
  );

  const harness = join(runtime, "harness.mjs");
  await writeFile(
    harness,
    `if (process.argv.includes("--mode")) {
  const task = process.argv.find((arg) => arg.startsWith("Task: "))?.slice("Task: ".length) ?? "";
  if (task.startsWith("queue filler ")) {
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  process.stdout.write(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stopReason: "end",
    },
  }) + "\\n");
  process.exit(0);
}

const events = [];
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (body.event) events.push(body.event);
  return new Response("", { status: 200 });
};

let releaseRecall;
let markRecallEntered;
let blockedRecallTask = "first overlapping task";
let recallEntered = new Promise((resolve) => { markRecallEntered = resolve; });
globalThis[Symbol.for("pipiui.memory-broker.recall-before-subagent-dispatch")] = async ({ text }) => {
  if (text === blockedRecallTask) {
    markRecallEntered();
    return new Promise((resolve) => { releaseRecall = () => resolve({}); });
  }
  return {};
};

const tools = new Map();
const { default: install } = await import("./subagent/index.ts");
install({
  registerTool(tool) { tools.set(tool.name, tool); },
  registerCommand() {},
  on() {},
  async sendUserMessage() {},
});
const subagent = tools.get("subagent");
if (!subagent) throw new Error("subagent tool was not registered");
const context = { cwd: process.env.PIPIUI_MAIN_CWD, hasUI: false };
const options = [new AbortController().signal, undefined, context];
let foregroundParallelResult;
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!predicate()) throw new Error("Timed out waiting for " + label + ": " + JSON.stringify({ starts: events.filter((event) => event.kind === "start"), foregroundParallelResult }));
};
const startedTask = (task) => events.some(
  (event) => event.kind === "start" && event.name === "probe" && event.task === task,
);

const first = subagent.execute(
  "tool-call-first",
  { agent: "probe", agentId: "overlap-first", task: "first overlapping task", background: false },
  ...options,
);
await recallEntered;
const second = subagent.execute(
  "tool-call-second",
  { agent: "probe", agentId: "overlap-second", task: "second overlapping task", background: false },
  ...options,
);
releaseRecall();
await Promise.all([first, second]);

foregroundParallelResult = await subagent.execute(
  "tool-call-foreground-parallel",
  {
    tasks: [
      { agent: "probe", agentId: "fg-parallel-a", task: "foreground parallel first" },
      { agent: "probe", agentId: "fg-parallel-b", task: "foreground parallel second" },
    ],
    background: false,
  },
  ...options,
);
await subagent.execute(
  "tool-call-chain",
  {
    chain: [
      { agent: "probe", agentId: "chain-first", task: "chain first task" },
      { agent: "probe", agentId: "chain-second", task: "chain second task" },
    ],
  },
  ...options,
);
await subagent.execute(
  "tool-call-background-single",
  { agent: "probe", agentId: "background-single", task: "background single task", background: true },
  ...options,
);
await subagent.execute(
  "tool-call-queued-parallel",
  {
    tasks: [
      ...Array.from({ length: 16 }, (_, index) => ({
        agent: "probe",
        agentId: "queue-fill-" + index,
        task: "queue filler " + index,
      })),
      { agent: "probe", agentId: "queued-delayed", task: "queued delayed task" },
    ],
    background: true,
  },
  ...options,
);
await waitFor(
  () => events.filter((event) => event.kind === "start" && event.task?.startsWith("queue filler ")).length === 16,
  "all queue fillers",
);
blockedRecallTask = "interloper task";
recallEntered = new Promise((resolve) => { markRecallEntered = resolve; });
const interloper = subagent.execute(
  "tool-call-interloper",
  { agent: "probe", agentId: "interloper", task: "interloper task", background: false },
  ...options,
);
await recallEntered;
await waitFor(() => startedTask("queued delayed task"), "queued delayed start while interloper is paused");
const queuedDelayedStartedWhileInterloperPaused = !startedTask("interloper task");
releaseRecall();
await interloper;
await waitFor(
  () => events.filter((event) => event.kind === "start" && event.name === "probe").length === 25,
  "all start reports",
);

const starts = events
  .filter((event) => event.kind === "start" && event.name === "probe")
  .map((event) => ({ task: event.task, toolCallId: event.toolCallId }))
  .sort((a, b) => a.task.localeCompare(b.task));
process.stdout.write(JSON.stringify({
  starts,
  queuedDelayedStartedWhileInterloperPaused,
}));
`,
    "utf8",
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", harness],
    {
      cwd: repository,
      env: {
        ...process.env,
        HOME: home,
        PIPIUI_AGENT_DEPTH: "1",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: repository,
        PIPIUI_AGENTS_DIR: agents,
        PIPIUI_BRIDGE_PORT: "41777",
        PIPIUI_HOST_PROTOCOL: "1",
        PIPIUI_SESSION_CAPABILITY: "toolcall-isolation-capability-0123456789abcdef",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_WORKTREE: "0",
        PIPIUI_SUBAGENT_EXT: "",
        PIPIUI_SEARCH_SCOPE_EXT: "",
        PIPIUI_COMPUTER_EXT: "",
        PIPIUI_COMPUTER_CAPABILITY: "",
        PIPIUI_WEB_ACCESS_EXT: "",
        PIPIUI_ARXIV_EXT: "",
      },
      timeout: 20_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

test("overlapping and delayed subagent paths keep invocation-local toolCallId in every runtime copy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pipiui-toolcall-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const expectedStarts = [
    { task: "first overlapping task", toolCallId: "tool-call-first" },
    { task: "second overlapping task", toolCallId: "tool-call-second" },
    { task: "chain first task", toolCallId: "tool-call-chain" },
    { task: "chain second task", toolCallId: "tool-call-chain" },
    { task: "foreground parallel first", toolCallId: "tool-call-foreground-parallel" },
    { task: "foreground parallel second", toolCallId: "tool-call-foreground-parallel" },
    { task: "background single task", toolCallId: "tool-call-background-single" },
    { task: "queued delayed task", toolCallId: "tool-call-queued-parallel" },
    { task: "interloper task", toolCallId: "tool-call-interloper" },
    ...Array.from({ length: 16 }, (_, index) => ({
      task: "queue filler " + index,
      toolCallId: "tool-call-queued-parallel",
    })),
  ].sort((a, b) => a.task.localeCompare(b.task));
  for (const [index, source] of runtimeSources.entries()) {
    const result = await probeOverlappingInvocations(root, source, index);
    assert.equal(result.queuedDelayedStartedWhileInterloperPaused, true, source);
    assert.deepEqual(result.starts, expectedStarts, source);
  }
});
