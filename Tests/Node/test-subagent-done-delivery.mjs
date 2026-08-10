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
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
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
    symlink(join(piNodeModules, "@earendil-works/pi-agent-core"), join(scoped, "pi-agent-core"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-ai"), join(scoped, "pi-ai"), "dir"),
    symlink(join(piNodeModules, "@earendil-works/pi-tui"), join(scoped, "pi-tui"), "dir"),
    symlink(join(piNodeModules, "typebox"), join(directory, "node_modules/typebox"), "dir"),
  ]);
}

async function prepareHarness(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const indexPath = join(directory, "subagent/index.ts");
  const source = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    `${source}

export const __doneDeliveryTestHooks = {
  deliverConfirmedDone,
  pendingDone,
};
`,
    "utf8",
  );

  const harness = join(directory, "harness.mjs");
  await writeFile(
    harness,
    `import { writeFileSync } from "node:fs";

const outputPath = ${JSON.stringify(join(directory, "result.json"))};
const handlers = new Map();
const registeredTools = [];
const sent = [];
let attempts = 0;
let deliveries = 0;
const fakePi = {
  on(event, handler) {
    const current = handlers.get(event) ?? [];
    current.push(handler);
    handlers.set(event, current);
  },
  registerTool(tool) { registeredTools.push(tool.name); },
  registerCommand() {},
  async sendUserMessage(text) {
    attempts += 1;
    sent.push(String(text));
    // trySendUserMessage tries deliverAs then the legacy fallback. Both reject while
    // compaction is busy; the first post-settled retry is the single successful delivery.
    if (attempts <= 2) throw new Error("session compacting / busy");
    deliveries += 1;
  },
};

const { default: install, __doneDeliveryTestHooks: hooks } = await import("./subagent/index.ts");
install(fakePi);
const waitFor = async (predicate, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
};

hooks.deliverConfirmedDone(fakePi, "worker-7", "run-7", "[subagent-done] agentId=worker-7");
const initialSettled = await waitFor(() => {
  const entry = [...hooks.pendingDone.values()][0];
  return hooks.pendingDone.size === 1 && entry && !entry.inFlight;
});
for (const handler of handlers.get("session_compact") ?? []) await handler({}, {});
for (const handler of handlers.get("agent_settled") ?? []) await handler({}, {});
const delivered = await waitFor(() => hooks.pendingDone.size === 0 && deliveries === 1);
await new Promise((resolve) => setTimeout(resolve, 30)); // second signal must stay coalesced

writeFileSync(outputPath, JSON.stringify({
  initialSettled,
  delivered,
  attempts,
  deliveries,
  pending: hooks.pendingDone.size,
  sent,
  sessionBeforeCompactHandlers: (handlers.get("session_before_compact") ?? []).length,
  sessionCompactHandlers: (handlers.get("session_compact") ?? []).length,
  agentSettledHandlers: (handlers.get("agent_settled") ?? []).length,
  sessionRecallRegistered: registeredTools.includes("session_recall"),
}));
`,
    "utf8",
  );
  return harness;
}

test("pending [subagent-done] retries immediately after compaction settles, once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-done-delivery-"));
  try {
    const harness = await prepareHarness(directory);
    await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "0",
        PIPIUI_MAIN_CWD: "",
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PI_SESSION_FILE: "",
      },
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const out = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));

    assert.equal(out.initialSettled, true, "busy compaction failure must enter pendingDone");
    assert.equal(out.delivered, true, "settled signal must retry without waiting for the 60s watchdog");
    assert.equal(out.attempts, 3, "two busy attempts plus exactly one post-settled retry");
    assert.equal(out.deliveries, 1, "coalesced compact + settled signals must not duplicate delivery");
    assert.equal(out.pending, 0, "confirmed delivery must clear pendingDone");
    assert.equal(out.sessionBeforeCompactHandlers, 1, "the existing main hook remains the only compaction owner");
    assert.equal(out.sessionCompactHandlers, 1);
    assert.equal(out.agentSettledHandlers, 1);
    assert.equal(out.sessionRecallRegistered, true, "index.ts must register the session_recall tool");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
