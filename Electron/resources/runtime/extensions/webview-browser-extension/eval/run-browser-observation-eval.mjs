#!/usr/bin/env node
/**
 * Baseline (A) observation eval: production controller.js inside JSDOM.
 * Does not run a model, Jev, or a scripted agent experiment.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  BASELINE_GROUP,
  OBSERVATION_CASES,
  SCHEMA_VERSION,
  TASK_DEFINITIONS,
  UNEVALUATED_GROUPS,
  applyFixtureActivation,
  isTaskComplete,
  taskSourceCase,
} from "./fixtures.mjs";
import {
  createSession,
  destroySession,
  dispatchObserve,
  loadControllerSource,
} from "./harness.mjs";
import {
  classifyCaseStatus,
  estimateOutputTokens,
  evaluateRequiredInfo,
  observationStats,
  scoreObservation,
} from "./score.mjs";

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { mode: null, json: null, rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      out.mode = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--mode=")) {
      out.mode = arg.slice("--mode=".length);
    } else if (arg === "--json") {
      out.json = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--json=")) {
      out.json = arg.slice("--json=".length);
    } else {
      out.rest.push(arg);
    }
  }
  return out;
}

function measureObserve(session, query) {
  const started = performance.now();
  let envelope;
  let error = null;
  try {
    envelope = dispatchObserve(session, query);
  } catch (err) {
    error = err;
  }
  const durationMs = Math.round((performance.now() - started) * 1000) / 1000;
  return { envelope, error, durationMs };
}

function finishRecord(caseDef, viewport, session, measured, controller, extras) {
  const gold = viewport.goldSelector
    ? { ...caseDef.gold, selector: viewport.goldSelector, name: viewport.goldName || caseDef.gold?.name }
    : caseDef.gold;
  const toolOk = !measured.error && measured.envelope && measured.envelope.ok === true;
  const targetScore = toolOk
    ? scoreObservation({ session, envelope: measured.envelope, gold, extras })
    : { target: "tool_error", presentInDom: null, recallAt12: null, shownAt: null, targetPresence: "unknown" };
  const coverage = toolOk
    ? evaluateRequiredInfo(measured.envelope, caseDef.requiredInfo, extras)
    : { items: [], missing: caseDef.requiredInfo.map((rule) => rule.id), status: "missing" };
  const status = classifyCaseStatus({
    toolOk,
    target: targetScore.target,
    coverageStatus: coverage.status,
  });
  return {
    id: viewport.id ? `${caseDef.id}:${viewport.id}` : caseDef.id,
    caseId: caseDef.id,
    scenario: caseDef.scenario,
    viewport: { id: viewport.id || "default", width: session.viewport.width, height: session.viewport.height },
    group: BASELINE_GROUP,
    intent: caseDef.intent,
    intentApplied: false,
    status,
    target: targetScore,
    coverage,
    stats: toolOk ? observationStats(measured.envelope) : null,
    tokens: toolOk ? estimateOutputTokens(measured.envelope) : null,
    durationMs: measured.durationMs,
    environment: "jsdom",
    controllerSha256: controller.sha256,
    toolError: measured.error
      ? { kind: "throw", message: String(measured.error.message || measured.error) }
      : (!toolOk
        ? { kind: "observe_not_ok", code: measured.envelope?.code || null, error: measured.envelope?.error || "observe returned not ok" }
        : null),
    model: { executed: false, reason: "baseline A is observe-only" },
    jev: { executed: false, reason: "ticket 2 does not call Jev" },
    extras: {
      staleAfterMutation: extras.staleAfterMutation ?? null,
      tokensDistinct: extras.tokensDistinct ?? null,
    },
  };
}

function runObservationCase(caseDef, controller) {
  const viewports = Array.isArray(caseDef.viewports) && caseDef.viewports.length
    ? caseDef.viewports
    : [{ id: null, width: caseDef.viewport?.width, height: caseDef.viewport?.height }];
  const sessions = viewports.map((viewport) => {
    const session = createSession(caseDef, { viewport });
    const measured = measureObserve(session, caseDef.baselineQuery || { scope: "viewport" });
    return { viewport, session, measured };
  });
  const snapshotIDs = sessions.map((row) => row.measured.envelope?.snapshotID || null);
  const tokensDistinct = viewports.length > 1
    && snapshotIDs.every(Boolean)
    && new Set(snapshotIDs).size === snapshotIDs.length;
  return sessions.map(({ viewport, session, measured }) => {
    const extras = viewports.length > 1 ? { tokensDistinct } : {};
    const record = finishRecord(caseDef, viewport, session, measured, controller, extras);
    if (typeof caseDef.afterObserve === "function" && measured.envelope && !measured.error) {
      Object.assign(extras, caseDef.afterObserve(session, measured.envelope) || {});
      record.coverage = evaluateRequiredInfo(measured.envelope, caseDef.requiredInfo, extras);
      record.extras.staleAfterMutation = extras.staleAfterMutation ?? null;
      record.extras.tokensDistinct = extras.tokensDistinct ?? record.extras.tokensDistinct;
      record.status = classifyCaseStatus({
        toolOk: !measured.error && measured.envelope && measured.envelope.ok === true,
        target: record.target.target,
        coverageStatus: record.coverage.status,
      });
    }
    destroySession(session);
    return record;
  });
}

function runTaskFixtureCheck(task) {
  const source = taskSourceCase(task);
  const session = createSession(source, { viewport: source.viewports?.[0] });
  const before = isTaskComplete(session.window, task);
  applyFixtureActivation(session.window, task);
  const after = isTaskComplete(session.window, task);
  const reset = createSession(source, { viewport: source.viewports?.[0] });
  const afterReset = isTaskComplete(reset.window, task);
  destroySession(session);
  destroySession(reset);
  return {
    id: task.id,
    sourceCaseId: task.sourceCaseId,
    title: task.title,
    intent: task.intent,
    prompt: task.prompt,
    toolBudget: task.toolBudget,
    gold: task.gold,
    requiredInfo: task.requiredInfo,
    completion: task.completion,
    reset: task.reset,
    fixtureSolvable: before === false && after === true && afterReset === false,
    initialComplete: before,
    afterActivationComplete: after,
    afterResetComplete: afterReset,
    agentExecuted: false,
    modelExecuted: false,
    e2eDurationMs: { status: "not_executed", reason: "ticket 2 does not run a model/tool agent loop" },
    costUsd: { status: "not_verified", reason: "no API usage" },
    usage: { status: "not_executed" },
    note: "solvability uses a fixture DOM click to prove the completion predicate; it is not an agent experiment",
  };
}

export async function runBaseline() {
  const controller = loadControllerSource();
  const started = performance.now();
  const observations = [];
  for (const caseDef of OBSERVATION_CASES) {
    observations.push(...runObservationCase(caseDef, controller));
  }
  const tasks = TASK_DEFINITIONS.map(runTaskFixtureCheck);
  const failures = observations.filter((row) => row.status.kind === "failure" || row.toolError);
  const taskBroken = tasks.filter((task) => !task.fixtureSolvable);
  const hits = observations.filter((row) => row.target?.target === "hit").length;
  const misses = observations.filter((row) => row.target?.target === "miss").length;
  const notApplicable = observations.filter((row) => row.target?.target === "not_applicable").length;
  const measuredCaseIds = new Set(observations.map((row) => row.caseId));
  const incomplete = observations.length === 0
    || observations.some((row) => !row.status)
    || tasks.length !== TASK_DEFINITIONS.length
    || measuredCaseIds.size !== OBSERVATION_CASES.length;
  const ok = failures.length === 0 && taskBroken.length === 0 && !incomplete;
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: "baseline",
    group: BASELINE_GROUP,
    ok,
    controller: { path: controller.path, sha256: controller.sha256, bytes: controller.bytes },
    executed: {
      observation: true,
      tasksDefined: true,
      taskAgent: false,
      model: false,
      jev: false,
    },
    groups: {
      A: { status: "measured", environment: "jsdom", note: "no-intent observe via production controller.js" },
      ...UNEVALUATED_GROUPS,
    },
    counts: {
      observationCases: OBSERVATION_CASES.length,
      observationRuns: observations.length,
      hits,
      misses,
      notApplicable,
      toolFailures: failures.length,
      tasksDefined: tasks.length,
      tasksFixtureBroken: taskBroken.length,
    },
    honesty: {
      perfectBaselineForbidden: misses > 0,
      modelUsage: "not_executed",
      e2eTaskTiming: "not_executed",
      costUsd: "not_verified",
      jev: "not_executed",
      note: "A miss means the gold was not in the first no-intent observation, not that the harness failed",
    },
    wallMs: Math.round((performance.now() - started) * 1000) / 1000,
    observations,
    tasks,
    consumer: {
      observationCases: "OBSERVATION_CASES in fixtures.mjs",
      tasks: "TASK_DEFINITIONS in fixtures.mjs",
      session: "createSession/dispatchObserve/destroySession in harness.mjs",
      scoring: "scoreObservation/evaluateRequiredInfo in score.mjs",
      B: "call dispatchObserve with includeIntent once ticket 1 lands; reuse gold selectors and scoreObservation",
      C: "not provided here — requires the product prepare/score/publish seam from ticket 3; do not mock scores",
    },
  };
}

export async function writeReport(report, jsonPath) {
  const target = resolve(jsonPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const mode = args.mode || "baseline";
  if (mode !== "baseline") {
    const report = {
      schemaVersion: SCHEMA_VERSION,
      mode,
      status: "not_executed",
      reason: mode === "local" || mode === "B"
        ? UNEVALUATED_GROUPS.B.reason
        : mode === "jev" || mode === "C"
          ? UNEVALUATED_GROUPS.C.reason
          : `unsupported mode ${mode}; this ticket implements --mode baseline only`,
      model: { executed: false },
      jev: { executed: false },
      costUsd: { status: "not_verified" },
    };
    if (args.json) await writeReport(report, args.json);
    process.stderr.write(`${report.reason}\n`);
    process.exitCode = 2;
    return report;
  }
  const report = await runBaseline();
  if (args.json) {
    const path = await writeReport(report, args.json);
    process.stderr.write(`wrote ${path}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ ok: report.ok, counts: report.counts, honesty: report.honesty }, null, 2)}\n`);
  }
  if (!report.ok) {
    process.stderr.write("baseline measurement failed (fixture/tool error or incomplete run)\n");
    process.exitCode = 1;
  }
  return report;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
