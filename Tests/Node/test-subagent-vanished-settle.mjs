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
 * pipiuiReport is redirected to an in-memory log (no bridge required).
 */
async function prepareHooksModule(directory) {
  await cp(sourceSubagentDirectory, join(directory, "subagent"), { recursive: true });
  await linkRuntimePackages(directory);

  const indexPath = join(directory, "subagent/index.ts");
  let src = await readFile(indexPath, "utf8");

  const reportRe =
    /function pipiuiReport\(payload: Record<string, unknown>\): void \{[\s\S]*?\n\}/;
  assert.match(src, reportRe, "pipiuiReport body must be patchable");
  src = src.replace(
    reportRe,
    `function pipiuiReport(payload: Record<string, unknown>): void {
	const g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
	if (!g.__pipiuiReports) g.__pipiuiReports = [];
	g.__pipiuiReports.push({ ...payload });
}`,
  );

  src += `

export const __vanishedSettleHooks = {
	jobUpsertRunning,
	jobFinalize,
	markWorkerInterrupted,
	isHandleVanished,
	jobRegistry,
	runningAgents,
	NO_PID_VANISH_MS,
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
h.jobUpsertRunning(agentId, "probe", "do work", "t");
h.runningAgents.set(agentId, {
  controller: new AbortController(),
  name: "probe",
  task: "do work",
  title: "t",
  lastActivityAt: Date.now(),
  lastStallNotifyAt: 0,
  startedAt: Date.now() - 60_000,
  pid: ${JSON.stringify(pid)},
});

const vanished = h.isHandleVanished(h.runningAgents.get(agentId), Date.now());
h.markWorkerInterrupted(agentId, "process gone after 1m, no result reported");
h.markWorkerInterrupted(agentId, "process gone after 1m, no result reported"); // idempotent

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
h.jobUpsertRunning(agentId, "probe", "first pass", "t1");
h.jobFinalize(agentId, {
  name: "probe",
  task: "first pass",
  state: "interrupted",
  resultText: "vanished earlier",
  cost: 0.12,
  turns: 3,
});
const terminal = { ...h.jobRegistry.get(agentId) };

h.jobUpsertRunning(agentId, "probe", "continue the slice", "t2");
const live = h.jobRegistry.get(agentId);

process.stdout.write(JSON.stringify({
  terminalState: terminal.state,
  terminalEndedAt: terminal.endedAt ?? null,
  terminalResult: terminal.resultText ?? null,
  liveState: live?.state,
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
    assert.equal(typeof out.terminalEndedAt, "number");
    assert.equal(out.terminalResult, "vanished earlier");
    assert.equal(out.liveState, "running");
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
h.jobUpsertRunning(agentId, "probe", "stuck spawn", "t");
h.runningAgents.set(agentId, {
  controller: new AbortController(),
  name: "probe",
  task: "stuck spawn",
  title: "t",
  lastActivityAt: now - h.NO_PID_VANISH_MS,
  lastStallNotifyAt: 0,
  startedAt: now - h.NO_PID_VANISH_MS - 1,
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
