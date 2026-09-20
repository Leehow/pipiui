import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { exactSearch } from "./grep-exact.js";
import { SeenRangeLedger } from "./ledger.js";
import { RefRegistry } from "./protocol.js";
import { executeReadSpans } from "./read-spans.js";
import { applyOptionalRerank, cloudPathAllowed, connectReranker, prepareRerankCandidates, RERANK_DISCOVER, RERANK_PROVIDE, RERANK_WITHDRAW, type Reranker, type RerankerBus } from "./reranker.js";
import { setSemanticSearchForTests } from "./zvec-semantic.js";
import type { UnassignedHit } from "./types.js";

const hits: UnassignedHit[] = [
  { path: "src/a.ts", startLine: 1, endLine: 12, symbol: "otherThing", score: 100 },
  { path: "src/b.ts", startLine: 1, endLine: 12, symbol: "refreshToken", score: 10 },
];
function service(patch: Partial<Reranker> = {}): Reranker {
  return {
    version: 1, provider: "jev-optimizer", instanceId: "first",
    availability: async () => ({ ready: true }),
    rerank: async ({ candidates }) => ({ status: "applied", scores: candidates.map((c, i) => ({ id: c.id, score: i ? 3 : 0 })) }),
    ...patch,
  };
}
async function fixture(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "jev-retrieval-test-"));
  try {
    await mkdir(join(root, "src"));
    for (const name of ["a", "b"]) await writeFile(join(root, `src/${name}.ts`), Array.from({ length: 12 }, (_, i) => `// ${name} token lifecycle ${i}`).join("\n"));
    await body(root);
  } finally { setSemanticSearchForTests(null); await rm(root, { recursive: true, force: true }); }
}
function bus(): RerankerBus {
  const emitter = new EventEmitter();
  return { on: (name, handler) => { emitter.on(name, handler); return () => { emitter.off(name, handler); }; }, emit: (name, data) => { emitter.emit(name, data); } };
}

test("optional handshake supports either loading order, withdrawal, stale offers, and dispose", () => {
  for (const providerFirst of [true, false]) {
    const events = bus();
    const offer = service();
    const register = () => { events.on(RERANK_DISCOVER, () => events.emit(RERANK_PROVIDE, offer)); events.emit(RERANK_PROVIDE, offer); };
    if (providerFirst) register();
    const client = connectReranker(events);
    if (!providerFirst) register();
    assert.equal(client.current(), offer);
    const newer = service({ instanceId: "newer" });
    events.emit(RERANK_PROVIDE, newer);
    events.emit(RERANK_WITHDRAW, { version: 1, provider: "jev-optimizer", instanceId: "first" });
    events.emit(RERANK_PROVIDE, offer);
    assert.equal(client.current(), newer);
    events.emit(RERANK_WITHDRAW, { version: 1, provider: "jev-optimizer", instanceId: "newer" });
    assert.equal(client.current(), undefined);
    client.dispose();
    events.emit(RERANK_PROVIDE, service({ instanceId: "third" }));
    assert.equal(client.current(), undefined);
  }
  assert.equal(connectReranker().current(), undefined);
});

test("no service preserves local output; exact route never asks an optimizer", async () => {
  await fixture(async (root) => {
    setSemanticSearchForTests(async () => ({ available: true, hits, provider: "zvec" }));
    const result = await executeCodeSearch({ query: "where tokens are refreshed", projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined });
    assert.deepEqual(result.details.hits.map((x) => x.path), hits.map((x) => x.path));
    assert.equal(result.details.reranker, undefined);
    let called = false;
    await executeCodeSearch({ query: "lifecycle", mode: "exact", projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined,
      reranker: service({ availability: async () => { called = true; return { ready: true }; } }) });
    assert.equal(called, false);
  });
});

test("tool-level rerank keeps provider/score/ref identity and full read_spans continuation", async () => {
  await fixture(async (root) => {
    setSemanticSearchForTests(async () => ({ available: true, hits, provider: "zvec" }));
    const registry = new RefRegistry();
    const ledger = new SeenRangeLedger();
    const result = await executeCodeSearch({ query: "where tokens are refreshed", projectRoot: root, registry, ledger, excludeGlobs: [], sidecar: undefined, reranker: service() });
    assert.deepEqual(result.details.hits.map((x) => x.path), ["src/b.ts", "src/a.ts"]);
    assert.equal(result.details.hits[0]!.score, 10);
    assert.equal(result.details.hits[0]!.ref, "R1");
    assert.equal(result.details.provider, "zvec");
    assert.equal(result.details.degraded, false);
    assert.equal(result.details.reranker?.status, "applied");
    assert.equal(result.details.reranker?.evaluatedCount, 2);
    const read = await executeReadSpans({ refs: ["R1"], projectRoot: root, registry, ledger, tokenBudget: 4000 });
    assert.match(read.content[0]!.text, /b token lifecycle 11/);
    assert.equal(read.details.hits[0]!.alreadyRead, false);
  });
});

test("missing key, errors and invalid score sets retain the complete saved local order", async () => {
  await fixture(async (root) => {
    const cases: Reranker[] = [
      service({ availability: async () => ({ ready: false, reason: "missing-key" }), rerank: async () => { throw new Error("must not call"); } }),
      service({ rerank: async () => { throw new Error("PRIVATE SERVER PAYLOAD"); } }),
      service({ rerank: async () => ({ status: "applied", scores: [{ id: "unknown", score: 3 }] }) }),
      service({ rerank: async ({ candidates }) => ({ status: "applied", scores: [{ id: candidates[0]!.id, score: NaN }] }) }),
      service({ rerank: async ({ candidates }) => ({ status: "applied", scores: candidates.map((c) => ({ id: c.id, score: 1 })) }) }),
    ];
    for (const reranker of cases) {
      const result = await applyOptionalRerank({ hits, query: "token lifecycle", projectRoot: root, excludeGlobs: [], reranker });
      assert.deepEqual(result.hits, hits);
      assert.notEqual(result.details?.status, "applied");
      assert.ok(!JSON.stringify(result).includes("PRIVATE SERVER PAYLOAD"));
    }
  });
});

test("candidate preparation refuses private paths, aliases, escapes and excluded files without marking reads", async () => {
  assert.equal(cloudPathAllowed(".PI/session.json"), false);
  assert.equal(cloudPathAllowed(".GIT/config"), false);
  await fixture(async (root) => {
    await writeFile(join(root, ".env"), "PRIVATE_ENV=secret\n");
    await symlink(join(root, ".env"), join(root, "src/alias.ts"));
    await writeFile(join(root, ".envrc"), "export DATABASE_URL=private\n");
    await writeFile(join(root, ".env-production"), "PRIVATE_KEY=private\n");
    await symlink(join(root, ".envrc"), join(root, "src/env-alias.ts"));
    await symlink("/etc/hosts", join(root, "src/escape.ts"));
    const records = [...hits, ...[".env", ".envrc", ".env-production", "src/alias.ts", "src/env-alias.ts", "src/escape.ts", "../escape.ts", ".pi/agent/auth.json"].map((path) => ({ path, startLine: 1, endLine: 1, text: "untrusted stale source" }))];
    const candidates = await prepareRerankCandidates({ hits: records, projectRoot: root, excludeGlobs: ["**/a.ts"] });
    assert.deepEqual(candidates.map((x) => x.candidate.path), ["src/b.ts"]);
    assert.ok(candidates.every((x) => Buffer.byteLength(x.candidate.text) <= 768));
  });
});

test("full symbols/literals stay protected while unscored tail stays local", async () => {
  await fixture(async (root) => {
    const result = await applyOptionalRerank({ hits, query: "where otherThing handles tokens", projectRoot: root, excludeGlobs: [], reranker: service() });
    assert.equal(result.hits[0]!.symbol, "otherThing");
    const anchors = await applyOptionalRerank({ hits, query: "otherThing and refreshToken", projectRoot: root, excludeGlobs: [], reranker: service() });
    assert.deepEqual(anchors.hits, hits, "Jev must not reorder two protected anchors");
    const literal = await applyOptionalRerank({ hits, query: 'where "a token lifecycle" is handled', projectRoot: root, excludeGlobs: [], reranker: service() });
    assert.equal(literal.hits[0]!.path, "src/a.ts", "fresh candidate text also protects a literal when the index supplied no text");
    const partial = await applyOptionalRerank({ hits: [...hits, { ...hits[0]!, symbol: "tail" }], query: "token lifecycle", projectRoot: root, excludeGlobs: [],
      reranker: service({ rerank: async ({ candidates }) => ({ status: "applied", scores: candidates.slice(0, 2).map((c, i) => ({ id: c.id, score: i * 3 })) }) }) });
    assert.equal(partial.hits[2]!.symbol, "tail");
  });
});

test("revoked instance cannot apply a late answer, and hung providers are bounded", async () => {
  await fixture(async (root) => {
    let current = true;
    const revoked = await applyOptionalRerank({ hits, query: "token lifecycle", projectRoot: root, excludeGlobs: [], isRerankerCurrent: () => current,
      reranker: service({ rerank: async ({ candidates }) => { current = false; return { status: "applied", scores: candidates.map((c, i) => ({ id: c.id, score: i * 3 })) }; } }) });
    assert.deepEqual(revoked.hits, hits);
    assert.equal(revoked.details?.reason, "provider-revoked");
    const start = Date.now();
    const hung = await applyOptionalRerank({ hits, query: "token lifecycle", projectRoot: root, excludeGlobs: [], reranker: service({ availability: async () => new Promise(() => {}) }) });
    assert.deepEqual(hung.hits, hits);
    assert.equal(hung.details?.status, "fallback");
    assert.ok(Date.now() - start < 2500);
  });
});

test("cancellation in the local capture path does not recover by scanning files", async (t) => {
  await fixture(async (root) => {
    const controller = new AbortController();
    const original = controller.signal.addEventListener.bind(controller.signal);
    t.mock.method(controller.signal, "addEventListener", (...args: any[]) => {
      Reflect.apply(original, undefined, args);
      queueMicrotask(() => controller.abort(new Error("local cancellation")));
    });
    await assert.rejects(exactSearch({ query: "lifecycle", projectRoot: root, signal: controller.signal }), /local cancellation/);
    await assert.rejects(exactSearch({ query: "lifecycle", projectRoot: root, signal: controller.signal }), /local cancellation/);
  });
});

test("user cancellation rejects the search instead of initiating grep fallback", async () => {
  await fixture(async (root) => {
    setSemanticSearchForTests(async () => ({ available: true, hits, provider: "zvec" }));
    const controller = new AbortController();
    const result = executeCodeSearch({ query: "where tokens are refreshed", projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined, signal: controller.signal,
      reranker: service({ rerank: async () => { controller.abort(new Error("user cancelled")); return new Promise(() => {}); } }) });
    await assert.rejects(result, /user cancelled/);
  });
});
