import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPayload,
  buildSystemOneBody,
  serializeBody,
  toWireCandidate,
  utf8Bytes,
  type ScoreQuestion,
} from "./payload.js";
import {
  JEV_MAX_CANDIDATES,
  JEV_MAX_JSON_BYTES,
  JEV_MODEL,
  SCORE_CRITERIA,
} from "./protocol.js";
import type { RerankCandidate } from "./types.js";

function candidate(id: string, extra: Partial<RerankCandidate> = {}): RerankCandidate {
  return {
    id,
    path: `src/${id}.ts`,
    startLine: 1,
    endLine: 8,
    symbol: id,
    text: `export function ${id}() { return 1; }`,
    ...extra,
  };
}

test("wire payload keeps relative path, query, and exact score questions", () => {
  const query = "where is signToken implemented";
  const candidates = [candidate("candidate-1"), candidate("candidate-2", { symbol: "signToken" })];
  const built = buildPayload(query, candidates);
  assert.equal(built.status, "ok");
  if (built.status !== "ok") return;
  assert.deepEqual(built.ids, ["candidate-1", "candidate-2"]);
  assert.equal(built.body.model, JEV_MODEL);
  assert.equal(built.body.state.query, query);
  assert.equal(built.body.state.candidates.length, 2);
  assert.deepEqual(Object.keys(built.body.questions), ["candidate-1", "candidate-2"]);
  for (const id of built.ids) {
    const question: ScoreQuestion | undefined = built.body.questions[id];
    assert.equal(question?.type, "score");
    assert.match(question?.instructions ?? "", new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(question?.instructions ?? "", new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(question?.criteria, [...SCORE_CRITERIA]);
  }
  assert.match(built.json, /"type":"score"/);
  assert.doesNotMatch(built.json, /projectRoot/);
  assert.doesNotMatch(built.json, /signal/);
  assert.doesNotMatch(built.json, /apiKey|Bearer|EXT_JEV/);
});

test("absolute paths, projectRoot, signal, and secrets never enter the body", () => {
  const query = "auth helper";
  const built = buildPayload(query, [
    candidate("candidate-1", { path: "/etc/passwd", text: "secret-file-text" }),
    candidate("candidate-2", { path: "C:\\Windows\\system32\\config", text: "win" }),
    candidate("candidate-3", { path: "src/auth.ts", text: "export const ok = 1;" }),
  ]);
  assert.equal(built.status, "ok");
  if (built.status !== "ok") return;
  assert.equal(built.body.state.candidates[0]?.path, undefined);
  assert.equal(built.body.state.candidates[1]?.path, undefined);
  assert.equal(built.body.state.candidates[2]?.path, "src/auth.ts");
  const json = built.json;
  assert.doesNotMatch(json, /\/etc\/passwd/);
  assert.doesNotMatch(json, /C:\\\\Windows/);
  assert.doesNotMatch(json, /projectRoot/);
  assert.doesNotMatch(json, /sk-live/);
  const wire = toWireCandidate(candidate("x", { path: "src/rel.ts" }));
  assert.equal(wire.path, "src/rel.ts");
});

test("caps at 64 candidates and drops the tail to fit JSON budget", () => {
  const many = Array.from({ length: 70 }, (_, i) => candidate(`candidate-${i + 1}`));
  const capped = buildPayload("q", many);
  assert.equal(capped.status, "ok");
  if (capped.status !== "ok") return;
  assert.equal(capped.ids.length, JEV_MAX_CANDIDATES);
  assert.equal(capped.ids[0], "candidate-1");
  assert.equal(capped.ids.at(-1), "candidate-64");
  assert.equal(capped.body.state.candidates.length, 64);

  const bulky = Array.from({ length: 8 }, (_, i) =>
    candidate(`candidate-${i + 1}`, { text: "t".repeat(12_000) }),
  );
  const trimmed = buildPayload("wide recall", bulky);
  assert.equal(trimmed.status, "ok");
  if (trimmed.status !== "ok") return;
  assert.ok(trimmed.ids.length >= 1);
  assert.ok(trimmed.ids.length < bulky.length);
  assert.deepEqual(
    trimmed.ids,
    bulky.slice(0, trimmed.ids.length).map((item) => item.id),
  );
  assert.ok(utf8Bytes(trimmed.json) <= JEV_MAX_JSON_BYTES);
  const oneMore = buildSystemOneBody(
    "wide recall",
    bulky.slice(0, trimmed.ids.length + 1),
  );
  assert.ok(utf8Bytes(serializeBody(oneMore)) > JEV_MAX_JSON_BYTES);
});

test("query plus one candidate over budget skips without a partial JSON cut", () => {
  const query = "q".repeat(JEV_MAX_JSON_BYTES);
  const built = buildPayload(query, [candidate("candidate-1")]);
  assert.deepEqual(built, { status: "skipped", reason: "budget" });
});

test("empty or duplicate ids skip before any body is produced", () => {
  assert.deepEqual(buildPayload("q", []), { status: "skipped", reason: "empty" });
  assert.deepEqual(buildPayload("q", [candidate("candidate-1"), candidate("candidate-1")]), {
    status: "skipped",
    reason: "duplicate-id",
  });
});

test("each score question names only its candidate id and does not mix another", () => {
  const query = "UNIQUE_QUERY_STRING about auth";
  const built = buildPayload(query, [
    candidate("alpha-id", { text: "UNIQUE_ALPHA_SOURCE", symbol: "alphaFn" }),
    candidate("beta-id", { text: "UNIQUE_BETA_SOURCE", symbol: "betaFn" }),
  ]);
  assert.equal(built.status, "ok");
  if (built.status !== "ok") return;
  const alpha: ScoreQuestion | undefined = built.body.questions["alpha-id"];
  const beta: ScoreQuestion | undefined = built.body.questions["beta-id"];
  assert.ok(alpha && beta);
  assert.notEqual(alpha.instructions, beta.instructions);
  assert.match(alpha.instructions, /alpha-id/);
  assert.doesNotMatch(alpha.instructions, /beta-id/);
  assert.doesNotMatch(alpha.instructions, /UNIQUE_QUERY_STRING/);
  assert.doesNotMatch(alpha.instructions, /UNIQUE_BETA_SOURCE/);
  assert.doesNotMatch(alpha.instructions, /UNIQUE_ALPHA_SOURCE/);
  assert.match(beta.instructions, /beta-id/);
  assert.doesNotMatch(beta.instructions, /alpha-id/);
  assert.doesNotMatch(beta.instructions, /UNIQUE_QUERY_STRING/);
  assert.doesNotMatch(beta.instructions, /UNIQUE_ALPHA_SOURCE/);
  assert.equal(built.body.state.query, query);
});

test("known API key in query or snippet is redacted and never sent raw", () => {
  const secret = "sk-test-not-real";
  const built = buildPayload(`please review ${secret} in login`, [
    candidate("candidate-1", { text: `token ${secret} here` }),
    candidate("candidate-2", { text: "clean" }),
  ], secret);
  assert.equal(built.status, "ok");
  if (built.status !== "ok") return;
  assert.doesNotMatch(built.json, /sk-test-not-real/);
  assert.match(built.body.state.query, /<redacted>/);
  assert.match(built.body.state.candidates[0]?.text ?? "", /<redacted>/);
  assert.doesNotMatch(built.body.state.candidates[0]?.text ?? "", /sk-test-not-real/);
  assert.equal(built.ids[0], "candidate-1");
});

test("candidate id containing the API key skips instead of renaming ids", () => {
  const secret = "sk-test-not-real";
  assert.deepEqual(
    buildPayload("q", [candidate(`id-${secret}`)], secret),
    { status: "skipped", reason: "secret" },
  );
});
