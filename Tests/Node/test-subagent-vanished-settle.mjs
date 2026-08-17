import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
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
 * Copy the extension and expose module-level job/vanished helpers for unit checks.
 * Both UI report paths are redirected to an in-memory log (no bridge required).
 */
async function prepareHooksModule(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await cp(
    join(sourceSubagentDirectory, "../packages/computer-agent"),
    join(directory, "packages/computer-agent"),
    { recursive: true },
  );
  await linkRuntimePackages(directory);

  const indexPath = join(directory, "subagent/index.ts");
  let src = await readFile(indexPath, "utf8");

  const reportRe =
    /function pipiuiReport\(payload: [^)]+\): void \{[\s\S]*?\n\}/;
  assert.match(src, reportRe, "pipiuiReport body must be patchable");
  src = src.replace(
    reportRe,
    `function pipiuiReport(payload: Record<string, unknown>): void {
	const g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
	if (!g.__pipiuiReports) g.__pipiuiReports = [];
	g.__pipiuiReports.push({ ...payload });
}`,
  );
  // Terminal reports use postPipiuiReport directly. In this isolated no-bridge harness,
  // route that deliberate no-op through the patched in-memory reporter as well.
  const bridgeNoop = "if (!PIPIUI_PORT) return true;";
  assert.ok(src.includes(bridgeNoop), "postPipiuiReport no-bridge guard must be patchable");
  src = src.replace(bridgeNoop, "if (!PIPIUI_PORT) { pipiuiReport(payload); return true; }");

  src += `

export const __vanishedSettleHooks = {
	jobUpsertRunning,
	jobFinalize,
	abortRunningAgent,
	markWorkerInterrupted,
	markAgentFinalizing,
	resolveSubagentEpisode,
	isHandleVanished,
	scheduleInterruptedReminders,
	isInterruptedReminderEligible,
	deliverInterruptedReminder,
	noteAgentActivity,
	claimStallNotification,
	formatHeartbeatWorkerState,
	jobRegistry,
	runningAgents,
	pendingInterruptedReminders,
	NO_PID_VANISH_MS,
	STALL_RENOTIFY_MAX,
	STALL_RENOTIFY_INTERVAL_MS,
	STALL_WATCHDOG_INTERVAL_MS,
	INTERRUPTED_NUDGE_SECS,
	CHECKIN_FIRST_MS,
	CHECKIN_SECOND_MS,
	CHECKIN_REST_MS,
	nextCheckinAt,
	getReports(): Record<string, unknown>[] {
		const g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
		return g.__pipiuiReports ?? [];
	},
	clearReports(): void {
		const g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
		g.__pipiuiReports = [];
	},
	reset(): void {
		jobRegistry.clear();
		runningAgents.clear();
		pendingInterruptedReminders.clear();
		const g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
		g.__pipiuiReports = [];
	},
};
`;

  await writeFile(indexPath, src, "utf8");
  return indexPath;
}

async function runProbe(directory, probeSource) {
  const probePath = join(directory, "probe.mjs");
  await writeFile(probePath, probeSource, "utf8");
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", probePath],
    {
      cwd: directory,
      env: {
        ...process.env,
        PIPIUI_AGENT_DEPTH: "0",
        PIPIUI_AGENT_MAX_DEPTH: "2",
        PIPIUI_MAIN_CWD: "",
        PIPIUI_AGENTS_DIR: join(directory, "no-agents"),
        PIPIUI_BRIDGE_PORT: "",
        PIPIUI_SESSION_KEY: "",
        PIPIUI_WORKTREE: "0",
      },
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    },
  );
  if (stderr && /Error:|TypeError:|ReferenceError:/.test(stderr)) {
    // Surface unexpected runtime failures; TypeScript strip noise is fine.
    assert.fail(`probe stderr unexpected:\n${stderr}\nstdout:\n${stdout}`);
  }
  return JSON.parse(stdout);
}

function deadPid() {
  return new Promise((resolvePid, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", () => {
      // pid is still known after exit; isProcessAlive must return false.
      resolvePid(child.pid);
    });
  });
}

test("observed child close enters finalizing and cannot be reclassified as vanished", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-finalizing-close-"));
  try {
    await prepareHooksModule(directory);
    const pid = await deadPid();
    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "closeout-worker";
const runId = h.jobUpsertRunning(agentId, "probe", "verify then report", "closeout");
const before = Date.now();
h.runningAgents.set(agentId, {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "verify then report",
  title: "closeout",
  lastActivityAt: before - 60_000,
  lastStallNotifyAt: 123,
  stallNotifyCount: 0,
  startedAt: before - 60_000,
  finalizing: false,
  pid: ${JSON.stringify(pid)},
});
h.markAgentFinalizing(agentId, runId);
const handle = h.runningAgents.get(agentId);
const job = h.jobRegistry.get(agentId);
process.stdout.write(JSON.stringify({
  finalizing: handle?.finalizing === true,
  pid: handle?.pid ?? null,
  vanished: h.isHandleVanished(handle, Date.now()),
  activityRefreshed: (handle?.lastActivityAt ?? 0) >= before,
  stallRearmed: handle?.lastStallNotifyAt ?? null,
  jobState: job?.state ?? null,
  endCount: h.getReports().filter((r) => r.kind === "end").length,
}));
`,
    );

    assert.equal(out.finalizing, true);
    assert.equal(out.pid, null, "closeout must clear the exited child pid");
    assert.equal(out.vanished, false, "an observed closeout must not be reclassified vanished");
    assert.equal(out.activityRefreshed, true);
    assert.equal(out.stallRearmed, 0);
    assert.equal(out.jobState, "running", "verify/end-report owns the eventual terminal transition");
    assert.equal(out.endCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("vanished dead pid settles jobRegistry interrupted and reports end once (idempotent)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-vanished-dead-"));
  try {
    await prepareHooksModule(directory);
    const pid = await deadPid();
    assert.equal(typeof pid, "number");

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "vanish-dead";
const runId = h.jobUpsertRunning(agentId, "probe", "do work", "t");
h.runningAgents.set(agentId, {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "do work",
  title: "t",
  lastActivityAt: Date.now(),
  lastStallNotifyAt: 0,
  stallNotifyCount: 0,
  startedAt: Date.now() - 60_000,
  finalizing: false,
  pid: ${JSON.stringify(pid)},
});

const vanished = h.isHandleVanished(h.runningAgents.get(agentId), Date.now());
h.markWorkerInterrupted(agentId, "process gone after 1m, no result reported");
h.markWorkerInterrupted(agentId, "process gone after 1m, no result reported"); // idempotent
await new Promise((resolve) => setTimeout(resolve, 0));

const job = h.jobRegistry.get(agentId);
const ends = h.getReports().filter((r) => r.kind === "end" && r.agentId === agentId);
process.stdout.write(JSON.stringify({
  vanished,
  jobState: job?.state,
  resultText: job?.resultText ?? null,
  endedAt: job?.endedAt ?? null,
  stillRunning: h.runningAgents.has(agentId),
  endCount: ends.length,
  endInterrupted: ends[0]?.interrupted === true,
  endOk: ends[0]?.ok,
  endAborted: ends[0]?.aborted,
}));
`,
    );

    assert.equal(out.vanished, true, "dead pid must count as vanished");
    assert.equal(out.jobState, "interrupted");
    assert.match(String(out.resultText ?? ""), /process gone/);
    assert.equal(typeof out.endedAt, "number");
    assert.equal(out.stillRunning, false);
    assert.equal(out.endCount, 1, "second markWorkerInterrupted must not re-report end");
    assert.equal(out.endInterrupted, true);
    assert.equal(out.endOk, false);
    assert.equal(out.endAborted, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("jobUpsertRunning reopens a terminal job as running without old endedAt/result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-job-reopen-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "resume-me";
const firstRun = h.jobUpsertRunning(agentId, "probe", "first pass", "t1");
h.jobFinalize(agentId, firstRun, {
  name: "probe",
  task: "first pass",
  state: "interrupted",
  provisional: true,
  resultText: "vanished earlier",
  cost: 0.12,
  turns: 3,
});
const terminal = { ...h.jobRegistry.get(agentId) };

const secondRun = h.jobUpsertRunning(agentId, "probe", "continue the slice", "t2");
const live = h.jobRegistry.get(agentId);

process.stdout.write(JSON.stringify({
  terminalState: terminal.state,
  terminalRunId: terminal.runId,
  terminalEndedAt: terminal.endedAt ?? null,
  terminalResult: terminal.resultText ?? null,
  liveState: live?.state,
  liveRunId: live?.runId ?? null,
  runsDistinct: firstRun !== secondRun,
  liveEndedAt: live?.endedAt ?? null,
  liveHasEndedAtKey: Object.prototype.hasOwnProperty.call(live ?? {}, "endedAt"),
  liveResult: live?.resultText ?? null,
  liveHasResultKey: Object.prototype.hasOwnProperty.call(live ?? {}, "resultText"),
  liveCost: live?.cost ?? null,
  liveTurns: live?.turns ?? null,
  liveTask: live?.task ?? null,
  liveStartedAt: live?.startedAt ?? null,
}));
`,
    );

    assert.equal(out.terminalState, "interrupted");
    assert.equal(typeof out.terminalRunId, "string");
    assert.equal(typeof out.terminalEndedAt, "number");
    assert.equal(out.terminalResult, "vanished earlier");
    assert.equal(out.liveState, "running");
    assert.equal(out.runsDistinct, true, "same agentId continuation must start a new run generation");
    assert.notEqual(out.liveRunId, out.terminalRunId);
    assert.equal(out.liveEndedAt, null, "reopen must drop endedAt");
    assert.equal(out.liveHasEndedAtKey, false, "reopen object must omit endedAt");
    assert.equal(out.liveResult, null, "reopen must drop prior resultText");
    assert.equal(out.liveHasResultKey, false, "reopen object must omit resultText");
    assert.equal(out.liveCost, null);
    assert.equal(out.liveTurns, null);
    assert.match(String(out.liveTask ?? ""), /continue the slice/);
    assert.equal(typeof out.liveStartedAt, "number");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("no-pid handle past NO_PID_VANISH_MS uses the same markWorkerInterrupted settle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-vanished-nopid-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "no-pid-old";
const now = Date.now();
const runId = h.jobUpsertRunning(agentId, "probe", "stuck spawn", "t");
h.runningAgents.set(agentId, {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "stuck spawn",
  title: "t",
  lastActivityAt: now - h.NO_PID_VANISH_MS,
  lastStallNotifyAt: 0,
  stallNotifyCount: 0,
  startedAt: now - h.NO_PID_VANISH_MS - 1,
  finalizing: false,
  // pid intentionally omitted
});

const handle = h.runningAgents.get(agentId);
const young = {
  ...handle,
  startedAt: now - 1_000,
};
const oldVanished = h.isHandleVanished(handle, now);
const youngVanished = h.isHandleVanished(young, now);

const reason = "process never attached a pid after 5m; treated as interrupted (vanished)";
h.markWorkerInterrupted(agentId, reason);
await new Promise((resolve) => setTimeout(resolve, 0));

const job = h.jobRegistry.get(agentId);
const ends = h.getReports().filter((r) => r.kind === "end" && r.agentId === agentId);
process.stdout.write(JSON.stringify({
  noPidMs: h.NO_PID_VANISH_MS,
  oldVanished,
  youngVanished,
  jobState: job?.state,
  resultText: job?.resultText ?? null,
  stillRunning: h.runningAgents.has(agentId),
  endCount: ends.length,
  interrupted: ends[0]?.interrupted === true,
}));
`,
    );

    assert.equal(out.noPidMs, 5 * 60 * 1000);
    assert.equal(out.oldVanished, true, "aged no-pid handle is vanished");
    assert.equal(out.youngVanished, false, "fresh no-pid handle must wait");
    assert.equal(out.jobState, "interrupted");
    assert.match(String(out.resultText ?? ""), /never attached a pid/);
    assert.equal(out.stillRunning, false);
    assert.equal(out.endCount, 1);
    assert.equal(out.interrupted, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stall re-notify caps one idle episode and activity re-arms it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-stall-cap-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "stall-cap";
const now = Date.now();
const runId = h.jobUpsertRunning(agentId, "probe", "wait", "t");
const handle = {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "wait",
  title: "t",
  lastActivityAt: now - 120_000,
  lastStallNotifyAt: 0,
  stallNotifyCount: 0,
  finalizing: false,
  startedAt: now - 120_000,
};
h.runningAgents.set(agentId, handle);
const calls = [
  h.claimStallNotification(handle, now),
  h.claimStallNotification(handle, now + h.STALL_RENOTIFY_INTERVAL_MS - 1),
  h.claimStallNotification(handle, now + h.STALL_RENOTIFY_INTERVAL_MS),
  h.claimStallNotification(handle, now + h.STALL_RENOTIFY_INTERVAL_MS * 2),
  h.claimStallNotification(handle, now + h.STALL_RENOTIFY_INTERVAL_MS * 3),
];
const countAtCap = handle.stallNotifyCount;
h.noteAgentActivity(agentId, runId);
const resetCount = handle.stallNotifyCount;
const resetTimestamp = handle.lastStallNotifyAt;
const rearmed = h.claimStallNotification(
  handle,
  now + h.STALL_RENOTIFY_INTERVAL_MS * 4,
);
process.stdout.write(JSON.stringify({
  max: h.STALL_RENOTIFY_MAX,
  calls,
  countAtCap,
  resetCount,
  resetTimestamp,
  rearmed,
  countAfterRearm: handle.stallNotifyCount,
}));
`,
    );

    assert.equal(out.max, 3, "initial push plus two re-notifies");
    assert.deepEqual(out.calls, [true, false, true, true, false]);
    assert.equal(out.countAtCap, out.max, "the fourth spaced notify is capped");
    assert.equal(out.resetCount, 0, "new activity resets the idle episode count");
    assert.equal(out.resetTimestamp, 0, "new activity resets the notify timestamp");
    assert.equal(out.rearmed, true, "new activity permits a fresh stall episode");
    assert.equal(out.countAfterRearm, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("heartbeat state tag distinguishes stalled, finalizing, and terminal work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-heartbeat-state-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "heartbeat-state";
const now = Date.now();
const runId = h.jobUpsertRunning(agentId, "probe", "wait", "t");
const handle = {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "wait",
  title: "t",
  lastActivityAt: now - 120_000,
  lastStallNotifyAt: 0,
  stallNotifyCount: 0,
  finalizing: false,
  startedAt: now - 120_000,
};
h.runningAgents.set(agentId, handle);
const stalled = h.formatHeartbeatWorkerState(agentId, handle, now);
handle.finalizing = true;
const finalizing = h.formatHeartbeatWorkerState(agentId, handle, now);
const abortFinalizing = h.abortRunningAgent(agentId);
handle.finalizing = false;
h.jobFinalize(agentId, runId, { state: "ok" });
const ok = h.formatHeartbeatWorkerState(agentId, handle, now);
const terminal = {};
for (const state of ["failed", "aborted", "interrupted"]) {
  const terminalRun = h.jobUpsertRunning(agentId, "probe", "wait", "t");
  handle.runId = terminalRun;
  h.jobFinalize(agentId, terminalRun, { state });
  terminal[state] = h.formatHeartbeatWorkerState(agentId, handle, now);
}
process.stdout.write(JSON.stringify({ stalled, finalizing, abortFinalizing, ok, terminal }));
`,
    );

    assert.equal(out.stalled, "running(stalled)");
    assert.equal(out.finalizing, "finalizing");
    assert.equal(out.abortFinalizing.ok, false);
    assert.match(out.abortFinalizing.message, /already finalizing/);
    assert.equal(out.ok, "ok");
    assert.deepEqual(out.terminal, {
      failed: "failed",
      aborted: "aborted",
      interrupted: "interrupted",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("long-running check-in wakes the boss at 10m then 30m with an activity snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-checkin-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `delete process.env.PIPIUI_HEARTBEAT_SECS;
const intervals = [];
globalThis.setInterval = (callback, ms) => {
  const handle = { unref() {} };
  intervals.push({ callback, ms });
  return handle;
};
globalThis.clearInterval = () => {};
const { default: registerSubagent, __vanishedSettleHooks: h } = await import("./subagent/index.ts");
let now = 1_000_000;
Date.now = () => now;
const messages = [];
const pi = {
  on() {},
  registerTool() {},
  registerCommand() {},
  async sendUserMessage(text, options) {
    messages.push({ text, deliverAs: options?.deliverAs ?? null });
  },
};
registerSubagent(pi);
h.reset();
const agentId = "checkin-active";
const runId = h.jobUpsertRunning(agentId, "probe", "package the electron app", "打包 Electron App");
const job = h.jobRegistry.get(agentId);
job.activity = "editing electron.vite.config.ts";
job.turns = 12;
job.cost = 0.41;
const handle = {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "package the electron app",
  title: "打包 Electron App",
  lastActivityAt: now,
  lastStallNotifyAt: 0,
  stallNotifyCount: 0,
  startedAt: now,
  finalizing: false,
  pid: process.pid,
};
h.runningAgents.set(agentId, handle);
const watchdog = intervals.find((interval) => interval.ms === h.STALL_WATCHDOG_INTERVAL_MS);
if (!watchdog) throw new Error("stall watchdog was not registered");
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};
watchdog.callback();
await flush();
const beforeDue = messages.length;
now = handle.startedAt + h.CHECKIN_FIRST_MS;
handle.lastActivityAt = now;
watchdog.callback();
await flush();
const first = messages[0]?.text ?? "";
const afterFirst = messages.length;
watchdog.callback();
await flush();
const afterRepeat = messages.length;
now = handle.startedAt + h.nextCheckinAt(handle.startedAt, 1) - handle.startedAt;
handle.lastActivityAt = now;
watchdog.callback();
await flush();
const second = messages[1]?.text ?? "";
process.stdout.write(JSON.stringify({
  firstMs: h.CHECKIN_FIRST_MS,
  secondAt: h.nextCheckinAt(0, 1),
  restAt: h.nextCheckinAt(0, 2),
  beforeDue,
  afterFirst,
  afterRepeat,
  afterSecond: messages.length,
  first,
  second,
  allFollowUp: messages.every((message) => message.deliverAs === "followUp"),
}));
`,
    );

    assert.equal(out.firstMs, 10 * 60 * 1000);
    assert.equal(out.secondAt, 30 * 60 * 1000);
    assert.equal(out.restAt, 60 * 60 * 1000);
    assert.equal(out.beforeDue, 0, "must not wake the boss before the first check-in");
    assert.equal(out.afterFirst, 1);
    assert.equal(out.afterRepeat, 1, "the same check-in must not fire twice");
    assert.equal(out.afterSecond, 2, "the stretched second check-in must still fire while running");
    assert.match(out.first, /\[subagent-heartbeat\] outstanding=1 vanished=0 stalled=0/);
    assert.match(out.first, /打包 Electron App/);
    assert.match(out.first, /turns=12/);
    assert.match(out.first, /cost=\$0\.4100|cost=\$0\.41/);
    assert.match(out.first, /last=editing electron\.vite\.config\.ts/);
    assert.match(out.first, /wall-clock check-in|still producing output/);
    assert.match(out.second, /\[subagent-heartbeat\]/);
    assert.equal(out.allFollowUp, true);

    const stalled = await runProbe(
      directory,
      `delete process.env.PIPIUI_HEARTBEAT_SECS;
const intervals = [];
globalThis.setInterval = (callback, ms) => {
  const handle = { unref() {} };
  intervals.push({ callback, ms });
  return handle;
};
globalThis.clearInterval = () => {};
const { default: registerSubagent, __vanishedSettleHooks: h } = await import("./subagent/index.ts");
let now = 2_000_000;
Date.now = () => now;
const messages = [];
const pi = {
  on() {},
  registerTool() {},
  registerCommand() {},
  async sendUserMessage(text) { messages.push(text); },
};
registerSubagent(pi);
h.reset();
const agentId = "checkin-stalled";
const runId = h.jobUpsertRunning(agentId, "probe", "wait", "卡住");
const handle = {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "wait",
  title: "卡住",
  lastActivityAt: now - 130_000,
  lastStallNotifyAt: 0,
  stallNotifyCount: 0,
  startedAt: now - h.CHECKIN_FIRST_MS,
  finalizing: false,
  pid: process.pid,
};
h.runningAgents.set(agentId, handle);
const watchdog = intervals.find((interval) => interval.ms === h.STALL_WATCHDOG_INTERVAL_MS);
watchdog.callback();
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
process.stdout.write(JSON.stringify({
  texts: messages,
}));
`,
    );
    assert.equal(stalled.texts.length, 1);
    assert.match(stalled.texts[0], /\[subagent-stalled\]/);
    assert.doesNotMatch(stalled.texts[0], /wall-clock check-in|still producing output/);

    const override = await runProbe(
      directory,
      `process.env.PIPIUI_HEARTBEAT_SECS = "17";
const { __vanishedSettleHooks: h } = await import("./subagent/index.ts");
process.stdout.write(JSON.stringify({
  firstMs: h.CHECKIN_FIRST_MS,
  secondAt: h.nextCheckinAt(0, 1),
  restAt: h.nextCheckinAt(0, 2),
}));
`,
    );
    assert.equal(override.firstMs, 17 * 1000);
    assert.equal(override.secondAt, 17 * 1000 + 34 * 1000);
    assert.equal(override.restAt, 17 * 1000 + 34 * 1000 + 51 * 1000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("same-run provisional interruption is corrected, while an old run cannot overwrite a new episode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-run-generation-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "generation-worker";
const firstRun = h.jobUpsertRunning(agentId, "probe", "first", "first");
const provisionalApplied = h.jobFinalize(agentId, firstRun, {
  state: "interrupted",
  provisional: true,
  resultText: "watchdog guessed vanished",
});
const realApplied = h.jobFinalize(agentId, firstRun, {
  state: "ok",
  resultText: "verified real completion",
});
const duplicateApplied = h.jobFinalize(agentId, firstRun, {
  state: "ok",
  resultText: "duplicate callback must not replace",
});
const corrected = { ...h.jobRegistry.get(agentId) };
const remindersAfterOk = h.scheduleInterruptedReminders(Date.now() + 10_000_000, new Set([agentId]));

const secondRun = h.jobUpsertRunning(agentId, "probe", "continued", "second");
const oldRunApplied = h.jobFinalize(agentId, firstRun, {
  state: "failed",
  resultText: "late old failure",
});
const current = h.jobRegistry.get(agentId);
process.stdout.write(JSON.stringify({
  provisionalApplied,
  realApplied,
  duplicateApplied,
  correctedState: corrected.state,
  correctedResult: corrected.resultText,
  correctedProvisional: corrected.interruptedProvisional === true,
  hasNudgeCount: Object.prototype.hasOwnProperty.call(corrected, "nudgeCount"),
  pendingAfterOk: h.pendingInterruptedReminders.size,
  remindersAfterOk: remindersAfterOk.length,
  runsDistinct: firstRun !== secondRun,
  oldRunApplied,
  currentRunId: current?.runId ?? null,
  currentState: current?.state ?? null,
}));
`,
    );

    assert.equal(out.provisionalApplied, true);
    assert.equal(out.realApplied, true, "the real same-run terminal must correct watchdog interruption");
    assert.equal(out.duplicateApplied, false, "true repeated terminal callbacks are idempotent");
    assert.equal(out.correctedState, "ok");
    assert.equal(out.correctedResult, "verified real completion");
    assert.equal(out.correctedProvisional, false);
    assert.equal(out.hasNudgeCount, false, "ok must clear reminder eligibility state");
    assert.equal(out.pendingAfterOk, 0);
    assert.equal(out.remindersAfterOk, 0);
    assert.equal(out.runsDistinct, true);
    assert.equal(out.oldRunApplied, false, "old terminal callback must not mutate a newer generation");
    assert.equal(out.currentState, "running");
    assert.notEqual(out.currentRunId, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("queued interrupted reminder is filtered when the worker resumes and reaches ok before cut-in releases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-reminder-cancel-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "resume-before-send";
const failedRun = h.jobUpsertRunning(agentId, "probe", "will resume", "resume");
h.jobFinalize(agentId, failedRun, { state: "failed", resultText: "real failure" });
const base = Date.now();
h.jobRegistry.get(agentId).endedAt = base;
const reminders = h.scheduleInterruptedReminders(base + 1200 * 1000, new Set([agentId]));
let release;
const cutIn = new Promise((resolve) => { release = resolve; });
const sent = [];
const delivery = h.deliverInterruptedReminder(null, reminders[0], {
  waitForCutIn: () => cutIn,
  send: async (text) => { sent.push(text); return true; },
});
await Promise.resolve();
const resumedRun = h.jobUpsertRunning(agentId, "probe", "continued after failure", "resume");
h.jobFinalize(agentId, resumedRun, { state: "ok", resultText: "verified pass" });
release();
const delivered = await delivery;
process.stdout.write(JSON.stringify({
  reminderCount: reminders.length,
  reminderRunId: reminders[0]?.runId ?? null,
  resumedRun,
  delivered,
  sentCount: sent.length,
  pending: h.pendingInterruptedReminders.size,
  state: h.jobRegistry.get(agentId)?.state ?? null,
}));
`,
    );

    assert.equal(out.reminderCount, 1);
    assert.notEqual(out.reminderRunId, out.resumedRun);
    assert.equal(out.delivered, false);
    assert.equal(out.sentCount, 0, "old queued nudge must not enter the follow-up channel");
    assert.equal(out.pending, 0);
    assert.equal(out.state, "ok");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolved vanished episode no longer queues or delivers an interrupted reminder", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-vanished-resolved-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const agentId = "vanish-resolved";
const runId = h.jobUpsertRunning(agentId, "probe", "stuck work", "t");
h.runningAgents.set(agentId, {
  runId,
  controller: new AbortController(),
  name: "probe",
  task: "stuck work",
  title: "t",
  lastActivityAt: Date.now(),
  lastStallNotifyAt: 0,
  stallNotifyCount: 0,
  startedAt: Date.now() - 60_000,
  finalizing: false,
});
h.markWorkerInterrupted(agentId, "process gone");
await new Promise((resolve) => setTimeout(resolve, 0));
const before = h.jobRegistry.get(agentId);
const resolved = h.resolveSubagentEpisode(agentId, runId, "superseded by verified=pass elsewhere");
const queued = h.scheduleInterruptedReminders(
  (before.endedAt ?? Date.now()) + (h.INTERRUPTED_NUDGE_SECS + 1) * 1_000,
  new Set([agentId]),
);
const sent = [];
for (const reminder of queued) {
  await h.deliverInterruptedReminder(null, reminder, {
    send: async (text) => { sent.push(text); return true; },
  });
}
const after = h.jobRegistry.get(agentId);
process.stdout.write(JSON.stringify({
  resolved: resolved.ok,
  queued: queued.length,
  sent,
  state: after?.state,
  handled: after?.closeoutDisposition,
  reason: after?.closeoutReason ?? null,
}));
`,
    );

    assert.equal(out.resolved, true);
    assert.equal(out.state, "interrupted", "resolve must retain vanished/interrupted state");
    assert.equal(out.handled, "cleaned");
    assert.match(String(out.reason ?? ""), /superseded by verified=pass/);
    assert.equal(out.queued, 0, "resolved vanished run must be filtered before scheduler queueing");
    assert.deepEqual(out.sent, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real failed resumable episodes receive exactly two run-scoped nudges and do not suppress other agents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-reminder-schedule-"));
  try {
    await prepareHooksModule(directory);

    const out = await runProbe(
      directory,
      `import { __vanishedSettleHooks as h } from "./subagent/index.ts";

h.reset();
const base = Date.now();
function fail(agentId) {
  const runId = h.jobUpsertRunning(agentId, "probe", "still failed", agentId);
  h.jobFinalize(agentId, runId, { state: "failed", resultText: "real failure" });
  h.jobRegistry.get(agentId).endedAt = base;
  return runId;
}
const alphaRun = fail("alpha");
const betaRun = fail("beta");
const resumable = new Set(["alpha", "beta"]);
const sent = [];
async function deliver(reminders) {
  for (const reminder of reminders) {
    await h.deliverInterruptedReminder(null, reminder, {
      send: async (text) => { sent.push(text); return true; },
    });
  }
}
const first = h.scheduleInterruptedReminders(base + 1200 * 1000, resumable);
await deliver(first);
const between = h.scheduleInterruptedReminders(base + 1201 * 1000, resumable);
const second = h.scheduleInterruptedReminders(base + 3600 * 1000, resumable);
await deliver(second);
const third = h.scheduleInterruptedReminders(base + 7200 * 1000, resumable);
const counts = Object.fromEntries([...h.jobRegistry.entries()].map(([id, job]) => [id, job.nudgeCount ?? 0]));
h.reset();
const afterRestart = h.scheduleInterruptedReminders(base + 7200 * 1000, resumable);
process.stdout.write(JSON.stringify({
  alphaRun,
  betaRun,
  first: first.map((r) => [r.agentId, r.runId, r.nudgeSeq]),
  between: between.length,
  second: second.map((r) => [r.agentId, r.runId, r.nudgeSeq]),
  third: third.length,
  sentCount: sent.length,
  sentAlpha: sent.filter((text) => text.includes("agentId=alpha")).length,
  sentBeta: sent.filter((text) => text.includes("agentId=beta")).length,
  counts,
  afterRestart: afterRestart.length,
}));
`,
    );

    assert.deepEqual(
      out.first.map(([agentId, _runId, nudgeSeq]) => [agentId, nudgeSeq]).sort(),
      [["alpha", 1], ["beta", 1]],
    );
    assert.equal(out.between, 0, "no duplicate before the 3600-second re-nudge threshold");
    assert.deepEqual(
      out.second.map(([agentId, _runId, nudgeSeq]) => [agentId, nudgeSeq]).sort(),
      [["alpha", 2], ["beta", 2]],
    );
    assert.equal(out.third, 0, "a real failed episode is silent after its two nudges");
    assert.equal(out.sentCount, 4);
    assert.equal(out.sentAlpha, 2);
    assert.equal(out.sentBeta, 2, "one agent's budget must not suppress another agent");
    assert.deepEqual(out.counts, { alpha: 2, beta: 2 });
    assert.equal(out.afterRestart, 0, "interrupted reminder reservations are never persisted across restart");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
