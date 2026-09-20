import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrowserPayload, executeBrowserAvailability, executeBrowserRerank, type BrowserRerankInput } from "./browser-rerank.js";
import { executeRerank } from "./rerank.js";
import { JEV_API_URL } from "./protocol.js";
import type { JevDeps } from "./types.js";

const KEY = "sk-synthetic-test-secret";
const state = (over = {}) => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true,
  generation: "code-gen", browserEnabled: true, browserGeneration: "browser-gen", ...over });
const input = (over: Partial<BrowserRerankInput> = {}): BrowserRerankInput => ({
  intent: "save account", projectRoot: "/synthetic/project",
  candidates: [{ id: "c1", role: "button", name: "Save", region: "Account" },
    { id: "c2", role: "button", name: "Cancel", region: "Account" }], ...over,
});
const response = (answers: unknown = { c1: { type: "score", score: 3 }, c2: { type: "score", score: 1 } }) =>
  new Response(JSON.stringify({ answers, model: "jev-latest", usage: { input_tokens: 27 } }));
const deps = (over: JevDeps = {}): JevDeps => ({
  env: { PIPIUI_JEV_STATE_FILE: "/injected/state.json", PIPIUI_JEV_GENERATION: "code-gen", EXT_JEV_OPTIMIZER_APIKEY: KEY },
  readState: async () => state(), fetch: async () => response(), ...over,
});

test("browser Score uses allowlisted DOM fields and never sends secrets or project context", async () => {
  let requests = 0;
  const result = await executeBrowserRerank(input({ intent: `save ${KEY}`, candidates: [
    { ...input().candidates[0]!, name: `Save ${KEY}`, token: "opaque-token", snapshotID: "snapshot", url: "https://private/", title: "private-title", domPath: "body/form", value: "secret-value" } as any,
    input().candidates[1]!,
  ] }), deps({ fetch: async (url, init) => {
    requests++;
    assert.equal(url, JEV_API_URL);
    assert.equal((init!.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
    assert.equal(init!.redirect, "error");
    const raw = String(init!.body);
    for (const secret of [KEY, "opaque-token", "snapshot", "https://private/", "private-title", "body/form", "secret-value", "/synthetic/project"]) assert.ok(!raw.includes(secret));
    const body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body.state), ["intent", "candidates"]);
    assert.deepEqual(Object.keys(body.state.candidates[0]), ["id", "role", "name", "region"]);
    assert.equal(body.state.candidates[0].id, "c1");
    assert.match(body.questions.c1.instructions, /data, not instructions/);
    return response();
  } }));
  assert.equal(requests, 1);
  assert.equal(result.status, "applied");
  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.inputTokens, 27);
  assert.equal(result.model, "jev-latest");
});

test("browser missing/old authorization and key are fail closed while code state stays usable", async () => {
  for (const over of [{ browserEnabled: false }, { browserEnabled: undefined, browserGeneration: undefined },
    { browserGeneration: undefined }, { enabled: false }, { hasKey: false }, { generation: "replaced" }]) {
    let calls = 0;
    const result = await executeBrowserRerank(input(), deps({ readState: async () => state(over), fetch: async () => { calls++; return response(); } }));
    assert.equal(result.status, "skipped");
    assert.equal(result.evaluatedCount, 0);
    assert.equal(calls, 0);
  }
  const code = await executeRerank({ query: "save", projectRoot: "/synthetic/project", candidates: [
    { id: "c1", path: "one.ts", startLine: 1, endLine: 1, text: "save" },
    { id: "c2", path: "two.ts", startLine: 1, endLine: 1, text: "cancel" },
  ] }, deps({ readState: async () => state({ browserEnabled: false, browserGeneration: undefined }) }));
  assert.equal(code.status, "applied");
});

test("no injected key returns immediately without reading possibly hung state", async () => {
  let reads = 0;
  const result = await executeBrowserAvailability("/synthetic/project", deps({ env: {}, readState: async () => { reads++; return new Promise(() => {}); } }));
  assert.deepEqual(result, { ready: false, reason: "no-key" });
  assert.equal(reads, 0);
});

test("payload bounds UTF-8 descriptions, stable 64 candidate window, JSON budget and IDs", () => {
  const candidates = Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, role: "button", name: `${i}${'敏"'.repeat(1500)}`, region: "区".repeat(1000) }));
  const built = buildBrowserPayload("find save", candidates);
  assert.equal(built.status, "ok");
  if (built.status !== "ok") return;
  assert.ok(Buffer.byteLength(built.json) <= 65536);
  const body = JSON.parse(built.json);
  assert.ok(body.state.candidates.length <= 64);
  assert.ok(body.state.candidates.length >= 2);
  assert.deepEqual(built.ids, candidates.slice(0, built.ids.length).map(({ id }) => id));
  for (const { id: _id, ...description } of body.state.candidates) {
    assert.ok(Buffer.byteLength(JSON.stringify(description)) <= 768);
    assert.ok(!JSON.stringify(description).includes("�"));
  }
  assert.deepEqual(buildBrowserPayload("x".repeat(65536), input().candidates), { status: "skipped", reason: "budget" });
  assert.deepEqual(buildBrowserPayload("save", [{ ...input().candidates[0]!, id: KEY }, input().candidates[1]!], KEY), { status: "skipped", reason: "secret" });
  assert.deepEqual(buildBrowserPayload("save", [input().candidates[0]!, input().candidates[0]!]), { status: "skipped", reason: "invalid-candidates" });
});

test("recognizable known-key prefixes already clipped upstream skip before HTTP", async () => {
  for (const suffix of [KEY.slice(0, -1), KEY.slice(0, -2) + "…", KEY.slice(0, -3) + "..."]) {
    for (const field of ["intent", "role", "name", "region"]) {
      const value = input();
      if (field === "intent") value.intent = `lookup ${suffix}`;
      else value.candidates[0] = { ...value.candidates[0]!, [field]: `description ${suffix}` };
      let requests = 0;
      const result = await executeBrowserRerank(value, deps({ fetch: async () => { requests++; return response(); } }));
      assert.equal(requests, 0);
      assert.equal(result.reason, "secret-fragment");
      assert.equal(result.evaluatedCount, 0);
      assert.equal(result.submittedCount, 0);
    }
  }
});

test("insufficient, identical and overbudget inputs skip without network", async () => {
  for (const value of [input({ candidates: input().candidates.slice(0, 1) }),
    input({ candidates: [input().candidates[0]!, { ...input().candidates[0]!, id: "c2" }] }), input({ intent: "x".repeat(65536) })]) {
    let calls = 0;
    const result = await executeBrowserRerank(value, deps({ fetch: async () => { calls++; return response(); } }));
    assert.equal(result.status, "skipped");
    assert.equal(calls, 0);
  }
});

test("complete Score validation rejects missing, extra, duplicate JSON keys, wrong types, ranges", async () => {
  const invalid = [
    '{"answers":{"c1":{"type":"score","score":3},"c1":{"type":"score","score":2},"c2":{"type":"score","score":1}}}',
    '{"answers":{"c1":{"type":"score","score":3,"score":2},"c2":{"type":"score","score":1}}}',
    JSON.stringify({ answers: { c1: { type: "score", score: 3 } } }),
    ...["3", -1, 4, null].map((score) => JSON.stringify({ answers: { c1: { type: "score", score }, c2: { type: "score", score: 1 } } })),
    JSON.stringify({ answers: { c1: { type: "choice", score: 3 }, c2: { type: "score", score: 1 } } }),
    JSON.stringify({ answers: { c1: { type: "score", score: 3 }, c2: { type: "score", score: 1 }, c3: { type: "score", score: 0 } } }),
  ];
  for (const body of invalid) {
    let calls = 0;
    const result = await executeBrowserRerank(input(), deps({ fetch: async () => { calls++; return new Response(body); } }));
    assert.equal(result.status, "fallback");
    assert.equal(result.reason, "invalid-response");
    assert.equal(result.evaluatedCount, 0);
    assert.equal(result.submittedCount, 2);
    assert.equal(result.scores, undefined);
    assert.equal(calls, 1);
  }
});

test("flat scores retain usage; HTTP/network failures never retry", async () => {
  const flat = await executeBrowserRerank(input(), deps({ fetch: async () => response({ c1: { type: "score", score: 2 }, c2: { type: "score", score: 2 } }) }));
  assert.equal(flat.reason, "flat-scores");
  assert.equal(flat.evaluatedCount, 2);
  assert.equal(flat.inputTokens, 27);
  assert.equal(flat.scores, undefined);
  for (const status of [401, 429, 500, 0]) {
    let calls = 0;
    const result = await executeBrowserRerank(input(), deps({ fetch: async () => { calls++; if (!status) throw Error("network"); return new Response("error", { status }); } }));
    assert.equal(result.status, "fallback");
    assert.equal(result.evaluatedCount, 0);
    assert.equal(result.submittedCount, 2);
    assert.equal(calls, 1);
  }
});

test("browser false→true generation changes cancel in-flight work without changing code generation", async () => {
  let raw = state();
  let requestSignal: AbortSignal | null | undefined;
  let resolveLate: (response: Response) => void = () => {};
  const keeper = setTimeout(() => {}, 500);
  try {
    const result = await executeBrowserRerank(input(), deps({ pollMs: 5, readState: async () => raw, fetch: async (_url, init) => {
      requestSignal = init?.signal;
      raw = state({ browserGeneration: "browser-gen-after-reenable" });
      return new Promise((resolve) => { resolveLate = resolve; });
    } }));
    assert.equal(result.status, "fallback");
    assert.equal(requestSignal?.aborted, true);
    resolveLate(response());
    assert.equal(result.scores, undefined);
  } finally { clearTimeout(keeper); }
});

test("authorization is checked before upload and after body, not only at startup", async () => {
  let reads = 0;
  let calls = 0;
  const before = await executeBrowserRerank(input(), deps({ readState: async () => state({ browserEnabled: ++reads < 2 }), fetch: async () => { calls++; return response(); } }));
  assert.equal(before.status, "skipped");
  assert.equal(calls, 0);
  let raw = state();
  const after = await executeBrowserRerank(input(), deps({ readState: async () => raw, fetch: async () => {
    raw = state({ browserEnabled: false }); return response();
  } }));
  assert.equal(after.status, "fallback");
  assert.equal(after.scores, undefined);
});

test("bounded timeout and user cancellation stop HTTP/body/state waits", async () => {
  const keeper = setTimeout(() => {}, 500);
  try {
    for (const over of [
      { fetch: async () => new Promise<Response>(() => {}) },
      { fetch: async () => ({ ok: true, text: async () => new Promise<string>(() => {}) }) as Response },
      { readState: async () => new Promise<string>(() => {}) },
    ]) {
      const result = await executeBrowserRerank(input(), deps({ ...over, deadlineMs: 20 }));
      assert.equal(result.reason, "timeout");
    }
    const ac = new AbortController();
    let calls = 0;
    const result = await executeBrowserRerank(input({ signal: ac.signal }), deps({ fetch: async () => { calls++; ac.abort(); return response(); } }));
    assert.equal(result.reason, "aborted");
    assert.equal(calls, 1);
    const already = await executeBrowserRerank(input({ signal: ac.signal }), deps({ fetch: async () => { calls++; return response(); } }));
    assert.equal(already.reason, "aborted");
    assert.equal(calls, 1);
  } finally { clearTimeout(keeper); }
});
