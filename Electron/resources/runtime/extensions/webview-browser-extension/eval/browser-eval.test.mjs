import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OBSERVATION_CASES,
  SECRET_PASSWORD_VALUE,
  TASK_DEFINITIONS,
  applyFixtureActivation,
  isTaskComplete,
  observationCaseById,
  taskSourceCase,
} from "./fixtures.mjs";
import {
  CONTROLLER_PATH,
  createSession,
  destroySession,
  dispatchObserve,
  loadControllerSource,
  querySelectorDeep,
} from "./harness.mjs";
import { parseArgs, runBaseline } from "./run-browser-observation-eval.mjs";

const SCENARIOS = [
  "区域预览外目标",
  "多个区域的同名控件",
  "中英文表达",
  "语义与词面不一致",
  "弹窗",
  "表单敏感内容",
  "同源 iframe",
  "范围过滤",
  "页面变更",
  "无匹配",
  "超预算",
  "双视口",
];

test("fixtures: 12 gold cases and 4 tasks with stable ids", () => {
  assert.equal(OBSERVATION_CASES.length, 12);
  assert.equal(new Set(OBSERVATION_CASES.map((item) => item.id)).size, 12);
  assert.equal(TASK_DEFINITIONS.length, 4);
  assert.equal(new Set(TASK_DEFINITIONS.map((item) => item.id)).size, 4);
  const seen = new Set(OBSERVATION_CASES.map((item) => item.scenario));
  for (const scenario of SCENARIOS) assert.equal(seen.has(scenario), true, scenario);
  for (const caseDef of OBSERVATION_CASES) {
    assert.equal(typeof caseDef.id, "string");
    assert.equal(typeof caseDef.html, "string");
    assert.equal(typeof caseDef.intent, "string");
    assert.ok(caseDef.gold && "present" in caseDef.gold);
    assert.ok(Array.isArray(caseDef.requiredInfo) && caseDef.requiredInfo.length > 0);
    assert.ok(caseDef.baselineQuery);
  }
  for (const task of TASK_DEFINITIONS) {
    assert.equal(task.agentExecuted, false);
    assert.equal(task.modelExecuted, false);
    const source = taskSourceCase(task);
    assert.equal(source.id, task.sourceCaseId);
    assert.ok(task.completion.flagId);
    assert.ok(task.fixtureActivation);
  }
});

test("harness: production controller observe returns a real envelope", () => {
  const controller = loadControllerSource();
  assert.equal(controller.path, CONTROLLER_PATH);
  assert.match(controller.source, /function observe\(/);
  const session = createSession({
    id: "smoke",
    html: `<!DOCTYPE html><html><body><main><button type="button" id="go">Go</button></main></body></html>`,
  });
  try {
    const rect = session.window.document.getElementById("go").getBoundingClientRect();
    assert.ok(rect.width > 0 || rect.height > 0);
    assert.equal(typeof session.window.Element.prototype.checkVisibility, "function");
    assert.equal(typeof session.window.document.elementFromPoint, "function");
    const envelope = dispatchObserve(session, { scope: "viewport" });
    assert.equal(envelope.ok, true);
    assert.equal(typeof envelope.snapshotID, "string");
    assert.ok(Array.isArray(envelope.elements));
    assert.ok(Array.isArray(envelope.regions));
    const go = envelope.elements.find((el) => el.name === "Go");
    assert.ok(go, "production collect must see the button, not a string search of controller.js");
  } finally {
    destroySession(session);
  }
});

test("gold selectors exist except the no-match case", () => {
  for (const caseDef of OBSERVATION_CASES) {
    const viewport = caseDef.viewports?.[0] || { width: 1280, height: 800 };
    const session = createSession(caseDef, { viewport });
    try {
      if (caseDef.gold.present === false) {
        assert.equal(querySelectorDeep(session.window, caseDef.gold.selector), null);
      } else if (caseDef.viewports) {
        for (const vp of caseDef.viewports) {
          const inner = createSession(caseDef, { viewport: vp });
          try {
            assert.ok(querySelectorDeep(inner.window, vp.goldSelector), `${caseDef.id} ${vp.id}`);
          } finally {
            destroySession(inner);
          }
        }
      } else {
        assert.ok(querySelectorDeep(session.window, caseDef.gold.selector), caseDef.id);
      }
    } finally {
      destroySession(session);
    }
  }
});

test("sensitive fixture never puts the password literal in A observe", () => {
  const caseDef = observationCaseById("sensitive-form");
  const session = createSession(caseDef);
  try {
    const envelope = dispatchObserve(session, caseDef.baselineQuery);
    const blob = JSON.stringify(envelope);
    assert.equal(blob.includes(SECRET_PASSWORD_VALUE), false);
    assert.match(blob, /sensitive value hidden/);
    assert.ok(envelope.elements.some((el) => el.name === "Sign in" && el.role === "button"));
  } finally {
    destroySession(session);
  }
});

test("task completion predicates are solvable and resettable, not agent runs", () => {
  for (const task of TASK_DEFINITIONS) {
    const source = taskSourceCase(task);
    const session = createSession(source, { viewport: source.viewports?.[0] });
    try {
      assert.equal(isTaskComplete(session.window, task), false, task.id);
      applyFixtureActivation(session.window, task);
      assert.equal(isTaskComplete(session.window, task), true, task.id);
    } finally {
      destroySession(session);
    }
    const reset = createSession(source, { viewport: source.viewports?.[0] });
    try {
      assert.equal(isTaskComplete(reset.window, task), false, `${task.id} reset`);
    } finally {
      destroySession(reset);
    }
  }
});

test("parseArgs reads --mode baseline --json", () => {
  const args = parseArgs(["--mode", "baseline", "--json", "/tmp/pipiui-browser-eval-baseline.json"]);
  assert.equal(args.mode, "baseline");
  assert.equal(args.json, "/tmp/pipiui-browser-eval-baseline.json");
});

test("baseline A measurement completes without claiming model/Jev/E2E", async () => {
  const report = await runBaseline();
  assert.equal(report.mode, "baseline");
  assert.equal(report.executed.model, false);
  assert.equal(report.executed.jev, false);
  assert.equal(report.executed.taskAgent, false);
  assert.equal(report.counts.observationCases, 12);
  assert.equal(report.counts.tasksDefined, 4);
  assert.ok(report.counts.misses > 0, "A must not be a fake perfect baseline");
  assert.equal(report.honesty.modelUsage, "not_executed");
  assert.equal(report.honesty.costUsd, "not_verified");
  assert.equal(report.ok, true, JSON.stringify(report.observations.filter((row) => row.status.kind === "failure" || row.toolError), null, 2));
  const outside = report.observations.find((row) => row.caseId === "outside-region-preview");
  assert.equal(outside.target.target, "miss");
  const pageChange = report.observations.find((row) => row.caseId === "page-change");
  assert.equal(pageChange.extras.staleAfterMutation, true);
  for (const task of report.tasks) {
    assert.equal(task.fixtureSolvable, true, task.id);
    assert.equal(task.agentExecuted, false);
    assert.equal(task.e2eDurationMs.status, "not_executed");
  }
});
