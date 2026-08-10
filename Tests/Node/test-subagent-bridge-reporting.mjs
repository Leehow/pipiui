import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

import {
  createNodeFsStorageAdapterV1,
  createSubagentHostRuntimeV1,
} from "../../Sources/PipiUI/PiExt/subagent-host/index.ts";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
const piPackageRoot = join(homedir(), ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent");
const piNodeModules = join(piPackageRoot, "node_modules");
const capability = "canonical-live-capability-0123456789abcdef";

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

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

async function prepareHarness(directory) {
  const subagentDirectory = join(directory, "subagent");
  await cp(sourceSubagentDirectory, subagentDirectory, { recursive: true });
  await linkRuntimePackages(directory);
  const indexPath = join(subagentDirectory, "index.ts");
  let source = await (await import("node:fs/promises")).readFile(indexPath, "utf8");
  source = source.replace("const STALL_THRESHOLD_MS = 120_000;", "const STALL_THRESHOLD_MS = 5;");
  source = source.replace("const STALL_WATCHDOG_INTERVAL_MS = 30_000;", "const STALL_WATCHDOG_INTERVAL_MS = 5;");
  await writeFile(indexPath, source, "utf8");

  const agentsDirectory = join(directory, "agents");
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(
    join(agentsDirectory, "probe.md"),
    "---\nname: probe\ndescription: Canonical bridge reporting probe\nread-only: true\n---\nReturn a report.\n",
    "utf8",
  );

  const harness = join(directory, "harness.mjs");
  await writeFile(harness, `
if (process.argv.includes("--mode")) {
  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "streamed failure" },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        model: "openai-codex/gpt-5.6",
        stopReason: "error",
        usage: {
          input: 100,
          output: 20,
          cacheRead: 10,
          cacheWrite: 0,
          totalTokens: 120,
          cost: { total: 0.01 },
        },
        content: [
          { type: "text", text: "failed after live reports" },
          { type: "toolCall", name: "read", arguments: { path: "contract.ts" } },
        ],
      },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      type: "tool_result_end",
      message: {
        role: "toolResult",
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "fixture result" }],
      },
    }) + "\\n");
    process.stderr.write("permanent fixture failure\\n");
    process.exit(1);
  }, 90);
} else {
  const tools = new Map();
  const fetchAttempts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const attempt = { url: String(input), body: String(init?.body ?? "") };
    try {
      const response = await realFetch(input, init);
      fetchAttempts.push({ ...attempt, status: response.status, response: await response.clone().text() });
      return response;
    } catch (error) {
      fetchAttempts.push({ ...attempt, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const fakePi = {
    on() {},
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand() {},
    async sendUserMessage() {},
  };
  const { default: install } = await import("./subagent/index.ts");
  install(fakePi);
  const subagent = tools.get("subagent");
  const status = tools.get("subagent_status");
  const context = { cwd: process.cwd(), hasUI: false };
  await subagent.execute(
    "bridge-live-dispatch",
    { agent: "probe", task: "emit every bridge report", agentId: "bridge-live", background: true },
    new AbortController().signal,
    undefined,
    context,
  );

  let statusText = "";
  let runId = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await status.execute("bridge-live-status", { agentId: "bridge-live", full: true });
    statusText = String(result.content?.[0]?.text ?? "");
    runId = /runId:\\s*(\\S+)/.exec(statusText)?.[1] ?? "";
    if (runId && /state:\\s*failed/.test(statusText)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!runId) throw new Error("probe did not expose a terminal runId: " + statusText);
  const resolved = await subagent.execute(
    "bridge-live-resolve",
    { action: "resolve", agentId: "bridge-live", runId, reason: "canonical probe handled" },
    new AbortController().signal,
    undefined,
    context,
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  process.stdout.write(JSON.stringify({ runId, statusText, resolved, fetchAttempts }));
}
`, "utf8");
  return { agentsDirectory, harness };
}

test("live extension reporting captures one explicit runId for every agent event and reaches canonical runtime /rpc", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-canonical-live-reports-"));
  const observed = [];
  const runtime = createSubagentHostRuntimeV1({
    sessionCapability: capability,
    persistence: {
      storage: createNodeFsStorageAdapterV1(),
      agentProjectionPath: join(directory, "agent-projection.json"),
      planPath: join(directory, "plan.json"),
    },
    callbacks: {
      onJobsSnapshot(notification) {
        if (notification.event?.agentId === "bridge-live") observed.push(notification.event);
      },
    },
  });
  const { port } = await runtime.start();
  try {
    const { agentsDirectory, harness } = await prepareHarness(directory);
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "0",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: directory,
        PIPIUI_AGENTS_DIR: agentsDirectory,
        PIPIUI_BRIDGE_PORT: String(port),
        PIPIUI_HOST_PROTOCOL: "1",
        PIPIUI_SESSION_CAPABILITY: capability,
        PIPIUI_SESSION_KEY: "legacy-alias-for-other-clients-0123456789",
        PIPIUI_WORKTREE: "0",
      },
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.ok(result.runId);
    assert.match(result.statusText, /state: failed/);

    const expectedKinds = ["start", "update", "log_delta", "log", "usage", "stalled", "end", "closeout"];
    assert.equal(await waitFor(() => expectedKinds.every((kind) => observed.some((event) => event.kind === kind))), true,
      `missing live canonical kinds: ${JSON.stringify(observed)}`);
    assert.ok(observed.every((event) => event.runId === result.runId),
      "every asynchronously emitted live report must retain the dispatch-captured runId");
    assert.equal(result.fetchAttempts.length, observed.length, "the single emitter must issue one /rpc request per observed report");
    const encoded = result.fetchAttempts.map((attempt) => JSON.parse(attempt.body));
    assert.ok(result.fetchAttempts.every((attempt) => attempt.status === 200), "all captured canonical reports should reach the live host");
    assert.ok(encoded.every((body) => body.schemaVersion === 1
      && body.sessionCapability === capability
      && body.action === "agent_event"
      && body.event?.schemaVersion === 1
      && body.event?.runId === result.runId
      && !("sessionKey" in body)), "flag-on reports must be canonical only, never dual-sent legacy bodies");

    const run = runtime.snapshot().jobs.find((job) => job.agentId === "bridge-live" && job.runId === result.runId);
    assert.equal(run?.state, "failed");
    assert.equal(run?.closeoutDisposition, "cleaned");
    assert.equal(run?.closeoutReason, "canonical probe handled");
  } finally {
    await runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
