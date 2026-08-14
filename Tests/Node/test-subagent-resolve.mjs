import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, cp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceSubagentDirectory = join(repositoryRoot, "Sources/PipiUI/PiExt/subagent");
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

/** Copy the extension and expose only the run-scoped resolve control-plane seams. */
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
    /async function postPipiuiReport\(payload: [^)]+\): Promise<void> \{[\s\S]*?\n\}/;
  assert.match(src, reportRe, "postPipiuiReport body must remain patchable for Node behavior tests");
  src = src.replace(
    reportRe,
    `async function postPipiuiReport(payload: Record<string, unknown>): Promise<void> {
\tconst g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
\tif (!g.__pipiuiReports) g.__pipiuiReports = [];
\tg.__pipiuiReports.push({ ...payload });
}`,
  );

  src += `

export const __resolveHooks = {
\tjobUpsertRunning,
\tjobFinalize,
\tresolveSubagentEpisode,
\treportResolvedCloseout,
\tpostTerminalPipiuiReport,
\tscheduleInterruptedReminders,
\tdeliverInterruptedReminder,
\tcancelInterruptedReminders,
\tformatJobsStatus,
\tjobRegistry,
\tpendingInterruptedReminders,
\tINTERRUPTED_NUDGE_SECS,
\tgetReports(): Record<string, unknown>[] {
\t\tconst g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
\t\treturn g.__pipiuiReports ?? [];
\t},
\treset(): void {
\t\tjobRegistry.clear();
\t\tpendingInterruptedReminders.clear();
\t\tconst g = globalThis as typeof globalThis & { __pipiuiReports?: Record<string, unknown>[] };
\t\tg.__pipiuiReports = [];
\t},
};
`;
  await writeFile(indexPath, src, "utf8");
  return indexPath;
}

async function runProbe(directory, source) {
  const probePath = join(directory, "probe.mjs");
  await writeFile(probePath, source, "utf8");
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
    assert.fail(`probe stderr unexpected:\n${stderr}\nstdout:\n${stdout}`);
  }
  return JSON.parse(stdout);
}

test("resolve keeps failed state and verify intact, rejects stale/running/ok, is idempotent, and reports closeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-resolve-"));
  try {
    await prepareHooksModule(directory);
    const out = await runProbe(
      directory,
      `import { __resolveHooks as h } from "./subagent/index.ts";

h.reset();
const failedRunId = h.jobUpsertRunning("failed", "probe", "failed work", "failed title");
h.jobFinalize("failed", failedRunId, {
  name: "probe",
  task: "failed work",
  state: "failed",
  resultText: "worker failure",
  verify: { command: "swift test", exitCode: 7, timedOut: false, tail: "test failed" },
});
const before = { ...h.jobRegistry.get("failed") };
// A real terminal report may still be in flight when resolve arrives. Closeout must serialize
// after it rather than letting Swift see a handled row before the terminal state lands.
const terminalReport = h.postTerminalPipiuiReport({ kind: "end", agentId: "failed", runId: failedRunId });
const resolved = h.resolveSubagentEpisode("failed", failedRunId, "superseded by verified=pass replacement");
const closeoutReport = h.reportResolvedCloseout(resolved.job);
await Promise.all([terminalReport, closeoutReport]);
const repeated = h.resolveSubagentEpisode("failed", failedRunId, "must not overwrite original reason");
const stale = h.resolveSubagentEpisode("failed", "old-run-id", "stale");
const after = h.jobRegistry.get("failed");

const runningRunId = h.jobUpsertRunning("running", "probe", "still working");
const running = h.resolveSubagentEpisode("running", runningRunId, "too soon");

const okRunId = h.jobUpsertRunning("ok", "probe", "successful work");
h.jobFinalize("ok", okRunId, { name: "probe", task: "successful work", state: "ok", resultText: "passed" });
const ok = h.resolveSubagentEpisode("ok", okRunId, "should reject");

const singleStatus = h.formatJobsStatus({ agentId: "failed" });
const tableStatus = h.formatJobsStatus({});
process.stdout.write(JSON.stringify({
  failedRunId,
  beforeState: before.state,
  afterState: after.state,
  afterVerify: after.verify,
  handled: after.closeoutDisposition,
  handledReason: after.closeoutReason,
  resolvedOk: resolved.ok,
  repeatedOk: repeated.ok,
  repeatedIdempotent: repeated.idempotent === true,
  staleOk: stale.ok,
  staleCurrentRunId: stale.currentRunId ?? null,
  staleMessage: stale.message,
  runningOk: running.ok,
  runningMessage: running.message,
  okOk: ok.ok,
  okMessage: ok.message,
  reports: h.getReports(),
  reportKinds: h.getReports().map((event) => event.kind),
  singleStatus,
  tableStatus,
}));
`,
    );

    assert.equal(out.beforeState, "failed");
    assert.equal(out.afterState, "failed", "resolve must never rewrite failure to ok");
    assert.deepEqual(out.afterVerify, {
      command: "swift test",
      exitCode: 7,
      timedOut: false,
      tail: "test failed",
    }, "resolve must never fabricate or replace verification");
    assert.equal(out.handled, "cleaned");
    assert.equal(out.handledReason, "superseded by verified=pass replacement");
    assert.equal(out.resolvedOk, true);
    assert.equal(out.repeatedOk, true);
    assert.equal(out.repeatedIdempotent, true);
    assert.equal(out.staleOk, false);
    assert.equal(out.staleCurrentRunId, out.failedRunId);
    assert.match(out.staleMessage, /stale runId=.*currentRunId=/);
    assert.equal(out.runningOk, false);
    assert.match(out.runningMessage, /subagent_abort|wait/);
    assert.equal(out.okOk, false);
    assert.match(out.okMessage, /state is "ok"/);

    assert.deepEqual(out.reportKinds, ["end", "closeout"], "closeout must follow the terminal bridge report");
    const closeout = out.reports.find((event) => event.kind === "closeout");
    assert.equal(closeout?.agentId, "failed");
    assert.equal(closeout?.runId, out.failedRunId);
    assert.equal(closeout?.disposition, "cleaned");
    assert.equal(closeout?.reason, "superseded by verified=pass replacement");
    assert.equal(typeof closeout?.closeoutAt, "number");
    assert.doesNotMatch(JSON.stringify(closeout), /"kind":"end"/);
    assert.match(out.singleStatus, new RegExp(`runId: ${out.failedRunId}`));
    assert.match(out.singleStatus, /state: failed \(resolved\/handled\)/);
    assert.match(out.singleStatus, /closeout: cleaned \(resolved\/handled\)/);
    assert.match(out.singleStatus, /reason: superseded by verified=pass replacement/);
    assert.match(out.tableStatus, /\| agentId \| runId \| name \| state/);
    assert.match(out.tableStatus, new RegExp(`\\| failed \\| ${out.failedRunId} \\|`));
    assert.match(out.tableStatus, /handled: superseded by verified=pass replacement/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolve cancels a queued run-scoped reminder without suppressing a sibling or a later run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipiui-subagent-resolve-reminder-"));
  try {
    await prepareHooksModule(directory);
    const out = await runProbe(
      directory,
      `import { __resolveHooks as h } from "./subagent/index.ts";

h.reset();
for (const agentId of ["old", "other"]) {
  const runId = h.jobUpsertRunning(agentId, "probe", agentId + " task");
  h.jobFinalize(agentId, runId, {
    name: "probe",
    task: agentId + " task",
    state: "interrupted",
    resultText: "interrupted",
  });
}
const oldRunId = h.jobRegistry.get("old").runId;
const otherRunId = h.jobRegistry.get("other").runId;
const due = Math.max(
  h.jobRegistry.get("old").endedAt,
  h.jobRegistry.get("other").endedAt,
) + (h.INTERRUPTED_NUDGE_SECS + 1) * 1_000;
const queued = h.scheduleInterruptedReminders(due, new Set(["old", "other"]));
let release;
const cutIn = new Promise((resolve) => { release = resolve; });
const sent = [];
const deliveries = queued.map((reminder) => h.deliverInterruptedReminder(null, reminder, {
  waitForCutIn: () => cutIn,
  send: async (text) => { sent.push(text); return true; },
}));
await Promise.resolve();
const resolveOld = h.resolveSubagentEpisode("old", oldRunId, "superseded by verified=pass");
release();
await Promise.all(deliveries);
const sentAfterResolve = [...sent];
// A later run with the same logical id must not inherit the old closeout marker.
const newRunId = h.jobUpsertRunning("old", "probe", "new task");
const newRun = h.jobRegistry.get("old");
const staleOldResolve = h.resolveSubagentEpisode("old", oldRunId, "stale old episode");
process.stdout.write(JSON.stringify({
  queuedBeforeResolve: queued.length,
  resolveOldOk: resolveOld.ok,
  oldRunId,
  otherRunId,
  newRunId,
  newRunState: newRun.state,
  newRunHandled: newRun.closeoutDisposition ?? null,
  staleOldResolveOk: staleOldResolve.ok,
  staleCurrentRunId: staleOldResolve.currentRunId ?? null,
  sentAfterResolve,
  sent,
  pendingCount: h.pendingInterruptedReminders.size,
}));
`,
    );

    assert.equal(out.queuedBeforeResolve, 2, "both terminal episodes should initially queue");
    assert.equal(out.resolveOldOk, true);
    assert.notEqual(out.newRunId, out.oldRunId, "agent reuse must create a fresh run identity");
    assert.equal(out.newRunState, "running");
    assert.equal(out.newRunHandled, null, "new run must not inherit old handled closeout");
    assert.equal(out.staleOldResolveOk, false);
    assert.equal(out.staleCurrentRunId, out.newRunId);
    assert.equal(out.pendingCount, 0, "resolve/new-run cancellation must drain old queued tokens");
    assert.equal(out.sentAfterResolve.length, 1, "resolve must cancel the already-queued old reminder");
    assert.equal(out.sent.length, 1, "only unrelated sibling reminder may deliver");
    assert.match(out.sentAfterResolve[0], /agentId=other/);
    assert.match(out.sent[0], new RegExp(`runId=${out.otherRunId}`));
    assert.doesNotMatch(out.sent[0], /agentId=old/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolve keeps runtime identity validation without xAI best-effort schema conditionals", async () => {
  const source = await readFile(join(sourceSubagentDirectory, "index.ts"), "utf8");
  assert.match(source, /name: "subagent"/);
  assert.match(source, /name: "subagent_resolve"/);
  assert.match(source, /name: "subagent_abort"/);
  assert.match(source, /const SubagentParams = Type\.Object\(\{/);
  assert.match(source, /const SubagentResolveParams = Type\.Object\(\{/);
  assert.match(source, /runId: Type\.String\(\{ minLength: 1/);
  const schemaSource = source.slice(
    source.indexOf("const SubagentParams = Type.Object("),
    source.indexOf("const ParallelSubagentParams = Type.Object("),
  );
  assert.doesNotMatch(schemaSource, /\btasks:/);
  assert.doesNotMatch(schemaSource, /\baction:/);
  assert.doesNotMatch(schemaSource, /\b(?:if|then|else):/);
  assert.match(source, /if \(params\.action === "resolve"\)/);
  assert.match(source, /if \(!target \|\| !runId\)/);
  assert.match(source, /action="resolve" requires both agentId and runId/);
  assert.match(source, /function cancelInterruptedReminders\(agentId: string, runId\?: string\)/);
  assert.match(source, /pi\.registerCommand\("subagent_resolve"/);
});
