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
const sourceSubagentDirectory = join(repositoryRoot, "Electron/resources/runtime/pi-ext/subagent");
const sourceComputerAgentDirectory = join(repositoryRoot, "Electron/resources/runtime/pi-ext/packages/computer-agent");
const piPackageRoot = join(
  repositoryRoot,
  "Electron/node_modules/@earendil-works/pi-coding-agent",
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
  await Promise.all([
    cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true }),
    cp(sourceComputerAgentDirectory, join(directory, "packages/computer-agent"), { recursive: true }),
  ]);
  await linkRuntimePackages(directory);

  const indexPath = join(directory, "subagent/index.ts");
  const source = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    `${source}

export const __stopQuietTestHooks = {
  notifySubagentDone,
  pendingDone,
  isQuiet: () => hostStopQuiet,
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
const commands = new Map();
const sentMessages = [];
const sentUserMessages = [];
const notes = [];
const fakePi = {
  on(event, handler) {
    const current = handlers.get(event) ?? [];
    current.push(handler);
    handlers.set(event, current);
  },
  registerTool() {},
  registerCommand(name, definition) { commands.set(name, { name, ...definition }); },
  sendMessage(message, options) {
    sentMessages.push({ customType: message.customType, triggerTurn: options?.triggerTurn });
    return undefined;
  },
  async sendUserMessage(text) { sentUserMessages.push(String(text)); },
};
const fakeCtx = {
  ui: { notify: (text, level) => notes.push({ text: String(text), level }) },
  sessionManager: { getSessionId: () => "sess-test", getBranch: () => [] },
};

const { default: install, __stopQuietTestHooks: hooks } = await import("./subagent/index.ts");
install(fakePi);

const result = (stopReason, agentId) => ({
  agent: "explore",
  agentId,
  runId: "run-" + agentId,
  agentSource: "user",
  task: "map the auth flow",
  title: "map auth",
  exitCode: 0,
  messages: [],
  stderr: "",
  usage: { cost: 0, turns: 1, input: 0, output: 0, totalTokens: 0 },
  stopReason,
});
const waitFor = async (predicate, timeoutMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
};
const fire = (event, arg) => Promise.all((handlers.get(event) ?? []).map((handler) => handler(arg, fakeCtx)));
// The delivery layer binds to Pi's durable session identity at session_start.
await fire("session_start", {});

// 1) An aborted job never pushes a receipt: no follow-up channel, no obligation.
hooks.notifySubagentDone(fakePi, result("aborted", "w-aborted"));
await new Promise((resolve) => setTimeout(resolve, 50));
const abortedSuppressed =
  sentMessages.length === 0 &&
  sentUserMessages.length === 0 &&
  hooks.pendingDone.size === 0;

// 2) A natural completion delivers through the completion channel.
hooks.notifySubagentDone(fakePi, result("stop", "w-ok"));
const okDelivered = await waitFor(() => sentMessages.length === 1 && sentMessages[0].triggerTurn === true);

// 3) The stop sweep arms quiet: receipts are held without burning attempts.
const abortAll = commands.get("subagent_abort_all");
await abortAll.handler("", fakeCtx);
const quietArmed = hooks.isQuiet() === true && notes.length === 1;
hooks.notifySubagentDone(fakePi, result("stop", "w-held"));
await new Promise((resolve) => setTimeout(resolve, 50));
const heldEntry = [...hooks.pendingDone.values()].find((entry) => entry.obligation.agentId === "w-held");
const heldWhileQuiet =
  sentMessages.length === 1 &&
  heldEntry !== undefined &&
  heldEntry.obligation.attempts === 0 &&
  heldEntry.inFlight === false;
// Reminders must not wake a quiet session either.
await fakePi.sendUserMessage("reminder probe");
const reminderQuiet = sentUserMessages.length === 1; // only our direct probe, nothing from the extension

// 4) The next real user message releases quiet and delivers the held receipt.
await fire("input", { source: "user", text: "continue please" });
const released = await waitFor(() => hooks.isQuiet() === false && sentMessages.length === 2);

// 5) Runtime-owned /subagent_* control commands must NOT release quiet.
await abortAll.handler("", fakeCtx);
await fire("input", { source: "user", text: "/subagent_status" });
const stayedQuietAfterControl = await waitFor(() => hooks.isQuiet() === true);
await fire("input", { source: "user", text: "next real message" });
const releasedAgain = await waitFor(() => hooks.isQuiet() === false);

writeFileSync(outputPath, JSON.stringify({
  abortedSuppressed,
  okDelivered,
  quietArmed,
  heldWhileQuiet,
  reminderQuiet,
  released,
  stayedQuietAfterControl,
  releasedAgain,
  sentMessages,
  notes,
}));
`,
    "utf8",
  );
  return harness;
}

test("stop sweep quiets the boss session: aborted receipts never push, held ones wait for the next user message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-stop-quiet-"));
  try {
    const harness = await prepareHarness(directory);
    await execFileAsync(process.execPath, ["--experimental-strip-types", harness], {
      cwd: directory,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "0",
        PIPIUI_MAIN_CWD: directory,
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PI_SESSION_FILE: "",
        PIPIUI_SUBAGENT_EXT: "",
        PIPIUI_SEARCH_SCOPE_EXT: "",
        PIPIUI_COMPUTER_EXT: "",
        PIPIUI_COMPUTER_CAPABILITY: "",
        PIPIUI_WEB_ACCESS_EXT: "",
        PIPIUI_ARXIV_EXT: "",
      },
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const out = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));

    assert.equal(out.abortedSuppressed, true, "aborted jobs must not push any receipt or create an obligation");
    assert.equal(out.okDelivered, true, "natural completions still deliver with triggerTurn");
    assert.equal(out.quietArmed, true, "/subagent_abort_all must arm the quiet gate and notify once");
    assert.equal(out.heldWhileQuiet, true, "receipts during quiet are held with zero delivery attempts burned");
    assert.equal(out.reminderQuiet, true, "nothing from the extension may send while quiet");
    assert.equal(out.released, true, "a real user message releases quiet and delivers the held receipt");
    assert.equal(out.stayedQuietAfterControl, true, "/subagent_* control commands must not release quiet");
    assert.equal(out.releasedAgain, true, "quiet re-arms after another sweep and releases on the next message");
    assert.equal(out.sentMessages.length, 2, "exactly two receipts delivered: one natural, one held-then-released");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
