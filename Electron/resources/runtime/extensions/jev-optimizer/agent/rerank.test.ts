import assert from "node:assert/strict";
import { test } from "node:test";
import { JEV_API_URL, JEV_DEADLINE_MS, JEV_POLL_MS, JEV_PROVIDER } from "./protocol.js";
import { executeRerank } from "./rerank.js";
import type { JevDeps, JevFetch, RerankCandidate, RerankInput } from "./types.js";

const KEY = "sk-test-not-real";
const GEN = "gen-1";

function candidate(id: string): RerankCandidate {
  return {
    id,
    path: `src/${id}.ts`,
    startLine: 1,
    endLine: 4,
    text: `export const ${id} = 1;`,
  };
}

function hostState(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    enabled: true,
    hasKey: true,
    generation: GEN,
    ...over,
  });
}

function readyDeps(
  over: Partial<JevDeps> & { fetch: JevFetch; readRaw?: string },
): JevDeps {
  const raw = over.readRaw ?? hostState();
  const { readRaw: _readRaw, readState, ...rest } = over;
  return {
    env: {
      PIPIUI_JEV_STATE_FILE: "/injected/jev-optimizer/runtime-state.json",
      PIPIUI_JEV_GENERATION: GEN,
      EXT_JEV_OPTIMIZER_APIKEY: KEY,
    },
    ...rest,
    readState: readState ?? (async () => raw),
  };
}

function input(over: Partial<RerankInput> = {}): RerankInput {
  return {
    query: "where is auth implemented",
    projectRoot: "/abs/project",
    candidates: [candidate("candidate-1"), candidate("candidate-2")],
    ...over,
  };
}

function appliedJson(ids = ["candidate-1", "candidate-2"], scores = [3, 1]) {
  const answers: Record<string, unknown> = {};
  ids.forEach((id, index) => {
    answers[id] = { type: "score", score: scores[index] ?? 2, confidence: 0.4 };
  });
  return {
    model: "jev-latest",
    answers,
    usage: { input_tokens: 17, output_tokens: 0 },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function abortableHang(): { fetch: JevFetch; aborted: () => boolean } {
  let aborted = false;
  const fetch: JevFetch = (_url, init) =>
    new Promise((_, reject) => {
      const fail = () => {
        aborted = true;
        const error = new Error("Aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) {
        fail();
        return;
      }
      init?.signal?.addEventListener("abort", fail, { once: true });
    });
  return { fetch, aborted: () => aborted };
}

test("constants match the contract deadline and poll", () => {
  assert.equal(JEV_DEADLINE_MS, 1500);
  assert.equal(JEV_POLL_MS, 100);
  assert.equal(JEV_PROVIDER, "jev-optimizer");
});

test("successful score maps model, inputTokens, and exact ids", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = readyDeps({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, appliedJson());
    },
  });
  const outcome = await executeRerank(input(), deps);
  assert.equal(outcome.status, "applied");
  assert.deepEqual(outcome.scores, [
    { id: "candidate-1", score: 3 },
    { id: "candidate-2", score: 1 },
  ]);
  assert.equal(outcome.model, "jev-latest");
  assert.equal(outcome.inputTokens, 17);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, JEV_API_URL);
  assert.equal(calls[0]?.init?.redirect, "error");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${KEY}`);
  const body = String(calls[0]?.init?.body ?? "");
  assert.doesNotMatch(body, new RegExp(KEY));
  assert.doesNotMatch(body, /\/abs\/project/);
  assert.doesNotMatch(body, /PIPIUI_JEV/);
  const parsed = JSON.parse(body) as { questions: Record<string, unknown> };
  assert.deepEqual(Object.keys(parsed.questions), ["candidate-1", "candidate-2"]);
});

test("missing, extra, non-score, or non-finite scores fall back", async () => {
  const cases: unknown[] = [
    { model: "jev-latest", answers: { "candidate-1": { type: "score", score: 2 } } },
    {
      answers: {
        "candidate-1": { type: "score", score: 2 },
        "candidate-2": { type: "score", score: 1 },
        extra: { type: "score", score: 0 },
      },
    },
    {
      answers: {
        "candidate-1": { type: "choice", choice: "a" },
        "candidate-2": { type: "score", score: 1 },
      },
    },
    {
      answers: {
        "candidate-1": { type: "score", score: Number.NaN },
        "candidate-2": { type: "score", score: 1 },
      },
    },
    {
      answers: {
        "candidate-1": { type: "score", score: 4 },
        "candidate-2": { type: "score", score: 1 },
      },
    },
    "not-json-object",
    { answers: null },
  ];
  for (const body of cases) {
    const outcome = await executeRerank(
      input(),
      readyDeps({ fetch: async () => jsonResponse(200, body) }),
    );
    assert.equal(outcome.status, "fallback", JSON.stringify(body));
    assert.equal(outcome.reason, "invalid-response");
    assert.equal(outcome.scores, undefined);
  }
});

test("raw JSON duplicate keys fall back without scores", async () => {
  const escapedEquiv =
    '{"answers":{"candidate-1":{"type":"score","score":3},"candidat' +
    "\\u0065" +
    '-1":{"type":"score","score":0},"candidate-2":{"type":"score","score":3}}}';
  const cases = [
    '{"answers":{"candidate-1":{"type":"score","score":3},"candidate-1":{"type":"score","score":0},"candidate-2":{"type":"score","score":3}}}',
    escapedEquiv,
    '{"answers":{"candidate-1":{"type":"score","score":3},"candidate-2":{"type":"score","score":1}},"answers":{"candidate-1":{"type":"score","score":0},"candidate-2":{"type":"score","score":3}}}',
    '{"answers":{"candidate-1":{"type":"score","score":3,"score":0},"candidate-2":{"type":"score","score":1}}}',
  ];
  assert.match(escapedEquiv, /candidat\\u0065-1/);
  assert.doesNotMatch(escapedEquiv.split("candidat")[2] ?? "", /^e-1/);
  for (const body of cases) {
    const outcome = await executeRerank(
      input(),
      readyDeps({ fetch: async () => jsonResponse(200, body) }),
    );
    assert.equal(outcome.status, "fallback", body);
    assert.equal(outcome.reason, "invalid-response", body);
    assert.equal(outcome.scores, undefined, body);
  }
});

test("independent objects and JSON-looking strings do not false-positive duplicate keys", async () => {
  const body = JSON.stringify({
    answers: {
      "candidate-1": {
        type: "score",
        score: 3,
        note: '{"candidate-1":{"type":"score","score":0}}',
      },
      "candidate-2": { type: "score", score: 1 },
    },
  });
  assert.match(body, /candidate-1/);
  const outcome = await executeRerank(
    input(),
    readyDeps({ fetch: async () => jsonResponse(200, body) }),
  );
  assert.equal(outcome.status, "applied");
  assert.deepEqual(outcome.scores, [
    { id: "candidate-1", score: 3 },
    { id: "candidate-2", score: 1 },
  ]);
});

test("401 429 5xx network timeout and bad JSON each fail closed once", async () => {
  const counts: number[] = [];
  const once = (fetch: JevFetch): JevFetch => async (url, init) => {
    counts[counts.length - 1] += 1;
    return fetch(url, init);
  };

  counts.push(0);
  assert.equal(
    (await executeRerank(input(), readyDeps({ fetch: once(async () => jsonResponse(401, { error: "nope" })) }))).reason,
    "http-401",
  );
  counts.push(0);
  assert.equal(
    (await executeRerank(input(), readyDeps({ fetch: once(async () => jsonResponse(429, { error: "slow" })) }))).reason,
    "http-429",
  );
  counts.push(0);
  assert.equal(
    (await executeRerank(input(), readyDeps({ fetch: once(async () => jsonResponse(503, { error: "down" })) }))).reason,
    "http-5xx",
  );
  counts.push(0);
  assert.equal(
    (
      await executeRerank(
        input(),
        readyDeps({
          fetch: once(async () => {
            throw new TypeError("fetch failed");
          }),
        }),
      )
    ).reason,
    "network",
  );
  counts.push(0);
  const hang = abortableHang();
  const timed = await executeRerank(
    input(),
    readyDeps({ fetch: once(hang.fetch), deadlineMs: 40 }),
  );
  assert.equal(timed.status, "fallback");
  assert.equal(timed.reason, "timeout");
  assert.equal(hang.aborted(), true);
  counts.push(0);
  assert.equal(
    (await executeRerank(input(), readyDeps({ fetch: once(async () => jsonResponse(200, "{")) }))).reason,
    "invalid-response",
  );
  assert.deepEqual(counts, [1, 1, 1, 1, 1, 1]);
});

test("no state, disabled, or missing key never touch the network", async () => {
  let fetches = 0;
  const fetch: JevFetch = async () => {
    fetches += 1;
    return jsonResponse(200, appliedJson());
  };

  const none = await executeRerank(input(), { env: { EXT_JEV_OPTIMIZER_APIKEY: KEY }, fetch });
  assert.equal(none.status, "skipped");
  assert.equal(none.reason, "no-state");

  const disabled = await executeRerank(
    input(),
    readyDeps({ fetch, readRaw: hostState({ enabled: false }) }),
  );
  assert.equal(disabled.status, "skipped");
  assert.equal(disabled.reason, "disabled");

  const noKey = await executeRerank(
    input(),
    readyDeps({
      fetch,
      env: {
        PIPIUI_JEV_STATE_FILE: "/injected/jev-optimizer/runtime-state.json",
        PIPIUI_JEV_GENERATION: GEN,
      },
    }),
  );
  assert.equal(noKey.status, "skipped");
  assert.equal(noKey.reason, "no-key");

  const mismatch = await executeRerank(
    input(),
    readyDeps({
      fetch,
      env: {
        PIPIUI_JEV_STATE_FILE: "/injected/jev-optimizer/runtime-state.json",
        PIPIUI_JEV_GENERATION: "other",
        EXT_JEV_OPTIMIZER_APIKEY: KEY,
      },
    }),
  );
  assert.equal(mismatch.status, "skipped");
  assert.equal(mismatch.reason, "generation-mismatch");
  assert.equal(fetches, 0);
});

test("generation rotation during flight aborts and rejects a late 200", async () => {
  let raw = hostState();
  const hang = abortableHang();
  const deps = readyDeps({
    fetch: hang.fetch,
    pollMs: 20,
    deadlineMs: 800,
    readState: async () => raw,
  });
  const pending = executeRerank(input(), deps);
  await new Promise((resolve) => setTimeout(resolve, 15));
  raw = hostState({ generation: "gen-2" });
  const outcome = await pending;
  assert.equal(outcome.status, "fallback");
  assert.equal(outcome.reason, "generation-mismatch");
  assert.equal(outcome.scores, undefined);
  assert.equal(hang.aborted(), true);
});

test("state change after HTTP still refuses to apply late scores", async () => {
  let raw = hostState();
  const deps = readyDeps({
    fetch: async () => {
      raw = hostState({ generation: "rotated" });
      return jsonResponse(200, appliedJson());
    },
    readState: async () => raw,
  });
  const outcome = await executeRerank(input(), deps);
  assert.equal(outcome.status, "fallback");
  assert.equal(outcome.reason, "generation-mismatch");
  assert.equal(outcome.scores, undefined);
});

test("caller abort skips before network and falls back if already in flight", async () => {
  let fetches = 0;
  const pre = new AbortController();
  pre.abort();
  const skipped = await executeRerank(
    input({ signal: pre.signal }),
    readyDeps({
      fetch: async () => {
        fetches += 1;
        return jsonResponse(200, appliedJson());
      },
    }),
  );
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.reason, "aborted");
  assert.equal(fetches, 0);

  const hang = abortableHang();
  const live = new AbortController();
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const pending = executeRerank(
    input({ signal: live.signal }),
    readyDeps({
      deadlineMs: 800,
      fetch: (url, init) => {
        markStarted();
        return hang.fetch(url, init);
      },
    }),
  );
  await started;
  live.abort();
  const outcome = await pending;
  assert.equal(outcome.status, "fallback");
  assert.equal(outcome.reason, "aborted");
  assert.equal(hang.aborted(), true);
});

test("deadline covers hung response.text and does not apply a late body", async () => {
  let finishText: ((value: string) => void) | undefined;
  let textStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    textStarted = resolve;
  });
  const t0 = Date.now();
  const pending = executeRerank(
    input(),
    readyDeps({
      deadlineMs: 40,
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          text: () => {
            textStarted();
            return new Promise<string>((resolve) => {
              finishText = resolve;
            });
          },
        }) as Response,
    }),
  );
  await started;
  const outcome = await pending;
  assert.ok(Date.now() - t0 < 400);
  assert.equal(outcome.status, "fallback");
  assert.equal(outcome.reason, "timeout");
  assert.equal(outcome.scores, undefined);
  finishText?.(JSON.stringify(appliedJson()));
  assert.equal(outcome.status, "fallback");
  assert.equal(outcome.scores, undefined);
});

test("deadline covers hung readState before any HTTP", async () => {
  let fetches = 0;
  const t0 = Date.now();
  const outcome = await executeRerank(
    input(),
    readyDeps({
      deadlineMs: 40,
      readState: () => new Promise(() => {}),
      fetch: async () => {
        fetches += 1;
        return jsonResponse(200, appliedJson());
      },
    }),
  );
  assert.ok(Date.now() - t0 < 400);
  assert.equal(outcome.status, "fallback");
  assert.equal(outcome.reason, "timeout");
  assert.equal(fetches, 0);
  assert.equal(outcome.scores, undefined);
});

test("parent signal during hung body is bounded and does not apply scores", async () => {
  const live = new AbortController();
  let textStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    textStarted = resolve;
  });
  let finishText: ((value: string) => void) | undefined;
  const t0 = Date.now();
  const pending = executeRerank(
    input({ signal: live.signal }),
    readyDeps({
      deadlineMs: 800,
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          text: () => {
            textStarted();
            return new Promise<string>((resolve) => {
              finishText = resolve;
            });
          },
        }) as Response,
    }),
  );
  await started;
  live.abort();
  const outcome = await pending;
  assert.ok(Date.now() - t0 < 400);
  assert.equal(outcome.status, "fallback");
  assert.equal(outcome.reason, "aborted");
  assert.equal(outcome.scores, undefined);
  finishText?.(JSON.stringify(appliedJson()));
  assert.equal(outcome.scores, undefined);
});

test("query or snippet containing the API key never ships the raw key", async () => {
  const calls: Array<{ body: string; redirect?: RequestRedirect }> = [];
  const outcome = await executeRerank(
    input({
      query: `debug ${KEY} please`,
      candidates: [
        candidate("candidate-1"),
        { ...candidate("candidate-2"), text: `hold ${KEY}` },
      ],
    }),
    readyDeps({
      fetch: async (_url, init) => {
        calls.push({ body: String(init?.body ?? ""), redirect: init?.redirect });
        return jsonResponse(200, appliedJson());
      },
    }),
  );
  assert.equal(outcome.status, "applied");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.redirect, "error");
  assert.doesNotMatch(calls[0]?.body ?? "", new RegExp(KEY));
  assert.match(calls[0]?.body ?? "", /<redacted>/);
});
