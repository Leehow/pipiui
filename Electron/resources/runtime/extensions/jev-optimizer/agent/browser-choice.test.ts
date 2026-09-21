import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBrowserChoicePayload, executeBrowserChoice, executeBrowserChoiceAvailability, type BrowserChoiceInput } from "./browser-choice.js";
import type { JevDeps } from "./types.js";

const KEY = "sk-synthetic-choice-secret";
const root = "/synthetic/project";
const state = (over = {}) => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: "gen", browserEnabled: true, browserGeneration: "browser", ...over });
const input = (over: Partial<BrowserChoiceInput> = {}): BrowserChoiceInput => ({ projectRoot: root, goal: "choose blue", candidates: [
  { id: "save", role: "button", name: "Save", operations: ["CLICK"] },
  { id: "field", role: "textbox", name: "Name", operations: ["TYPE_TEXT"] },
  { id: "color", role: "combobox", name: "Color", operations: ["SELECT"], options: [{ id: "blue", label: "Blue" }] },
], scroll: { canUp: false, canDown: true }, ...over });
const deps = (over: JevDeps = {}): JevDeps => ({ env: { PIPIUI_JEV_STATE_FILE: `${root}/.pi/agent/jev-optimizer/runtime-state.json`, PIPIUI_JEV_GENERATION: "gen", EXT_JEV_OPTIMIZER_APIKEY: KEY }, readState: async () => state(), ...over });
function answer(keys: string[], choice = keys[0]!) { return { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0])) }; }
function result(body: any, operation = "CLICK") {
  const answers: any = { operation: answer(Object.keys(body.questions.operation.criteria), operation) };
  const head = `${operation.toLowerCase()}_target`;
  if (body.questions[head]) answers[head] = answer(Object.keys(body.questions[head].criteria));
  return { answers, model: "jev-latest", usage: { input_tokens: 15 } };
}
const fetchResult = (operation = "CLICK", mutate: (v: any) => void = () => {}): JevDeps["fetch"] => async (_url, init) => {
  const value = result(JSON.parse(String(init!.body)), operation); mutate(value); return new Response(JSON.stringify(value));
};

test("preserves a full Unicode goal rather than dropping its final requirements", () => {
  const goal = `${'先检查页面内容'.repeat(30)}最后选择蓝色而不是红色`;
  const built = buildBrowserChoicePayload(input({ goal }), KEY);
  assert.equal(built.status, 'ok');
  if (built.status === 'ok') assert.equal(JSON.parse(built.json).state.goal, goal);
});

test("binds the exact project state file, accepting canonical project aliases", async () => {
  for (const projectRoot of ['/', '/synthetic']) {
    assert.equal((await executeBrowserChoiceAvailability(projectRoot, deps())).ready, false);
  }
  const wrong = deps({ env: { ...deps().env, PIPIUI_JEV_STATE_FILE: `${root}/other-state.json` } });
  assert.equal((await executeBrowserChoiceAvailability(root, wrong)).ready, false);
  const dir = mkdtempSync(join(tmpdir(), 'jev-choice-alias-'));
  try {
    const real = join(dir, 'real'); const alias = join(dir, 'alias'); mkdirSync(real);
    symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const bound = deps({ env: { ...deps().env, PIPIUI_JEV_STATE_FILE: join(real, '.pi/agent/jev-optimizer/runtime-state.json') } });
    assert.equal((await executeBrowserChoiceAvailability(alias, bound)).ready, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("one request contains operation and compatible speculative targets; allowlists all fields", async () => {
  let calls = 0;
  const value = input();
  Object.assign(value, { token: "private-token", url: "private-url" });
  Object.assign(value.candidates[2]!, { locator: "private-locator", valueHint: "private-hint" });
  Object.assign(value.candidates[2]!.options![0]!, { value: "private-value" });
  const outcome = await executeBrowserChoice(value, deps({ fetch: async (_url, init) => {
    calls++; const raw = String(init!.body); assert.doesNotMatch(raw, /private-|projectRoot|signal/);
    const body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body.questions), ["operation", "click_target", "type_text_target", "select_target"]);
    assert.equal(body.questions.operation.criteria.SCROLL_UP, undefined);
    assert.ok(body.questions.operation.criteria.SCROLL_DOWN);
    return new Response(JSON.stringify(result(body, "SELECT")));
  } }));
  assert.equal(calls, 1); assert.deepEqual(outcome.decision, { operation: "SELECT", candidateId: "color", optionId: "blue" });
});

test("single/empty candidates work; only selected target head is consumed", async () => {
  const single = await executeBrowserChoice(input({ candidates: input().candidates.slice(0, 1) }), deps({ fetch: fetchResult("CLICK", v => { v.answers.select_target = { choice: "javascript:evil()" }; }) }));
  assert.deepEqual(single.decision, { operation: "CLICK", candidateId: "save" });
  for (const operation of ["WAIT", "DONE", "BLOCKED", "SCROLL_DOWN"]) {
    const outcome = await executeBrowserChoice(input({ candidates: [] }), deps({ fetch: fetchResult(operation, v => { v.answers.click_target = "evil()"; }) }));
    assert.deepEqual(outcome.decision, { operation });
  }
});

test("invalid selected answers, enums, probabilities and duplicate keys reject without decision", async () => {
  const invalid = [
    (v: any) => { delete v.answers.click_target; },
    (v: any) => { v.answers.operation.choice = "eval('evil')"; },
    (v: any) => { v.answers.click_target.choice = "unknown"; },
    (v: any) => { v.answers.operation.confidence = null; },
    (v: any) => { v.answers.operation.type = "score"; },
    (v: any) => { v.answers.operation.probabilities.CLICK = 0.3; },
    (v: any) => { v.answers.operation.probabilities.CLICK = 0.4; v.answers.operation.probabilities.DONE = 0.6; },
    (v: any) => { v.answers.operation.probabilities.extra = 0; },
    (v: any) => { v.answers.operation.probabilities.CLICK = "1"; },
    (v: any) => { v.answers.operation.confidence = 2; },
  ];
  for (const mutate of invalid) {
    const outcome = await executeBrowserChoice(input(), deps({ fetch: fetchResult("CLICK", mutate) }));
    assert.equal(outcome.reason, "invalid-response"); assert.equal(outcome.decision, undefined);
  }
  for (const raw of ['{"answers":{},"answers":{}}', '{"answers":{"operation":{"choice":"DONE","choi\\u0063e":"CLICK"}}}', 'not-json']) {
    const outcome = await executeBrowserChoice(input(), deps({ fetch: async () => new Response(raw) }));
    assert.equal(outcome.reason, "invalid-response"); assert.equal(outcome.decision, undefined);
  }
});

test("bounded candidates, heads, UTF-8 and payload; no option value or unknown operation", () => {
  const value = input({ candidates: Array.from({ length: 80 }, (_, i) => ({ id: `select-${i}`, role: "combobox", name: '名"'.repeat(800), operations: ["SELECT"], options: Array.from({ length: 300 }, (_, j) => ({ id: `o${j}`, label: '选"'.repeat(800) })) })) });
  const built = buildBrowserChoicePayload(value, KEY);
  assert.equal(built.status, "ok"); if (built.status !== "ok") return;
  assert.ok(Buffer.byteLength(built.json) <= 65536);
  const body = JSON.parse(built.json);
  assert.ok(body.state.candidates.length <= 64);
  assert.ok(body.state.candidates.reduce((count: number, candidate: any) => count + (candidate.options?.length ?? 0), 0) <= 255);
  for (const question of Object.values(body.questions) as any[]) assert.ok(Object.keys(question.criteria).length <= 255);
  assert.doesNotMatch(built.json, /�/);
  const illegal = buildBrowserChoicePayload(input({ candidates: [{ ...input().candidates[0]!, operations: ["EVAL"] as any }] }), KEY);
  assert.equal(illegal.status, "skipped");
});

test("known key redacted before clipping; clipped upstream prefixes cause zero upload", async () => {
  const full = buildBrowserChoicePayload(input({ goal: `${"g".repeat(2040)}${KEY}`, candidates: [{ ...input().candidates[0]!, name: `${"n".repeat(500)}${KEY}` }] }), KEY);
  assert.equal(full.status, "ok"); if (full.status === "ok") { assert.ok(!full.json.includes(KEY)); assert.ok(!full.json.includes(KEY.slice(0, 8))); }
  for (const tail of [KEY.slice(0, -1), `${KEY.slice(0, -2)}…`, `${KEY.slice(0, 8)}...`]) {
    for (const field of ["goal", "name", "label", "history"]) {
      const value = input();
      if (field === "goal") value.goal = `goal ${tail}`;
      if (field === "name") value.candidates[0]!.name = `name ${tail}`;
      if (field === "label") value.candidates[2]!.options![0]!.label = `label ${tail}`;
      if (field === "history") value.history = [{ operation: "CLICK", candidateName: `history ${tail}` }];
      let calls = 0;
      const outcome = await executeBrowserChoice(value, deps({ fetch: async () => { calls++; return new Response(); } }));
      assert.equal(outcome.reason, "secret-fragment"); assert.equal(calls, 0);
    }
  }
});

test("no key, disabled, root mismatch and generation mismatch never upload", async () => {
  for (const change of [{ browserEnabled: false }, { enabled: false }, { hasKey: false }, { generation: "other" }]) {
    let calls = 0; const outcome = await executeBrowserChoice(input(), deps({ readState: async () => state(change), fetch: async () => { calls++; return new Response(); } }));
    assert.equal(outcome.status, "skipped"); assert.equal(outcome.decision, undefined); assert.equal(calls, 0);
  }
  assert.deepEqual(await executeBrowserChoiceAvailability(root, deps({ env: {} })), { ready: false, reason: "no-key" });
  let calls = 0;
  const wrong = await executeBrowserChoice(input({ projectRoot: "/other" }), deps({ fetch: async () => { calls++; return new Response(); } }));
  assert.equal(wrong.reason, "project-mismatch"); assert.equal(calls, 0);
});

test("rotation, disable or cancel after HTTP and service failures have no decision", async () => {
  for (const change of [{ generation: "other" }, { browserGeneration: "other" }, { browserEnabled: false }]) {
    let raw = state();
    const outcome = await executeBrowserChoice(input(), deps({ readState: async () => raw, fetch: async (url, init) => { raw = state(change); return fetchResult()!(url, init); } }));
    assert.equal(outcome.status, "fallback"); assert.equal(outcome.decision, undefined);
  }
  const ac = new AbortController();
  const cancelled = await executeBrowserChoice(input({ signal: ac.signal }), deps({ fetch: async (url, init) => { ac.abort(); return fetchResult()!(url, init); } }));
  assert.equal(cancelled.reason, "aborted"); assert.equal(cancelled.decision, undefined);
  for (const status of [401, 429, 503, 0]) {
    let calls = 0;
    const outcome = await executeBrowserChoice(input(), deps({ fetch: async () => { calls++; if (!status) throw Error(KEY); return new Response(KEY, { status }); } }));
    assert.equal(calls, 1); assert.equal(outcome.status, "fallback"); assert.equal(outcome.decision, undefined); assert.ok(!JSON.stringify(outcome).includes(KEY));
  }
});

test("pre-upload revocation, pre-abort and credential replacement prevent decisions", async () => {
  let calls = 0, reads = 0;
  const before = await executeBrowserChoice(input(), deps({ readState: async () => state({ browserEnabled: ++reads < 2 }), fetch: async () => { calls++; return new Response(); } }));
  assert.equal(before.status, "skipped"); assert.equal(calls, 0);
  const ac = new AbortController(); ac.abort();
  const pre = await executeBrowserChoice(input({ signal: ac.signal }), deps({ fetch: async () => { calls++; return new Response(); } }));
  assert.equal(pre.reason, "aborted"); assert.equal(calls, 0);
  const options = deps();
  options.fetch = async (url, init) => { options.env!.EXT_JEV_OPTIMIZER_APIKEY = "new-synthetic-key"; return fetchResult()!(url, init); };
  const rotated = await executeBrowserChoice(input(), options);
  assert.equal(rotated.status, "fallback"); assert.equal(rotated.decision, undefined);
});

test("deadline and live browser rotation bound hung fetch, body and state", async () => {
  const keeper = setTimeout(() => {}, 1000);
  try {
    for (const over of [
      { fetch: async () => new Promise<Response>(() => {}) },
      { fetch: async () => ({ ok: true, text: async () => new Promise<string>(() => {}) }) as Response },
      { readState: async () => new Promise<string>(() => {}) },
    ]) {
      const outcome = await executeBrowserChoice(input(), deps({ ...over, deadlineMs: 20 }));
      assert.equal(outcome.reason, "timeout"); assert.equal(outcome.decision, undefined);
    }
    let raw = state(); let requestSignal: AbortSignal | null | undefined;
    const outcome = await executeBrowserChoice(input(), deps({ pollMs: 5, readState: async () => raw, fetch: async (_url, init) => {
      requestSignal = init?.signal; raw = state({ browserGeneration: "rotated" }); return new Promise<Response>(() => {});
    } }));
    assert.equal(outcome.status, "fallback"); assert.equal(outcome.decision, undefined); assert.equal(requestSignal?.aborted, true);
  } finally { clearTimeout(keeper); }
});

test("model and usage only return bounded safe metrics", async () => {
  const outcome = await executeBrowserChoice(input(), deps({ fetch: fetchResult("CLICK", v => { v.model = `model-${KEY}`; v.usage = { input_tokens: Infinity, secret: KEY }; }) }));
  assert.equal(outcome.status, "applied"); assert.equal(outcome.model, undefined); assert.equal(outcome.inputTokens, undefined); assert.ok(!JSON.stringify(outcome).includes(KEY));
});
