import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { symbolLayer } from "./hooks.js";
import { RefRegistry } from "./protocol.js";
import { sidecarSearch } from "./sidecar-lifecycle.js";
import { rebuildZvecIndex, searchSemantic, semanticCandidateLimit, setSemanticSearchForTests, zvecAvailable } from "./zvec-semantic.js";

test("real semantic budget allows 60/100 only for internal wide recall", async (t) => {
  assert.equal(semanticCandidateLimit({ topK: 100 }), 50);
  assert.equal(semanticCandidateLimit({ topK: 60, wideRecall: true }), 60);
  assert.equal(semanticCandidateLimit({ topK: 999, wideRecall: true }), 100);
  const cancelled = new AbortController();
  cancelled.abort(new Error("semantic cancelled"));
  await assert.rejects(searchSemantic({ query: "anything", projectRoot: "/not-a-project", signal: cancelled.signal }), /semantic cancelled/);
  if (!await zvecAvailable()) { t.skip("native zvec is not installed"); return; }
  const root = await mkdtemp(join(tmpdir(), "jev-zvec-budget-"));
  setSemanticSearchForTests(null);
  try {
    await mkdir(join(root, "src"));
    await Promise.all(Array.from({ length: 110 }, (_, i) => writeFile(join(root, `src/item${i}.ts`), `/** budgetneedle common retrieval target */\nexport function item${i}() { return 'budgetneedle'; }\n`)));
    const rebuilt = await rebuildZvecIndex(root);
    assert.equal(rebuilt.ok, true, rebuilt.reason);
    const ordinary = await searchSemantic({ query: "budgetneedle", projectRoot: root, topK: 100 });
    assert.equal(ordinary.hits.length, 50);
    for (const topK of [60, 100]) {
      const wide = await searchSemantic({ query: "budgetneedle", projectRoot: root, topK, wideRecall: true });
      assert.equal(wide.available, true, wide.reason);
      assert.equal(wide.hits.length, topK);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cancellation during symbol wait starts zero subsequent sidecar searches", async () => {
  const root = await mkdtemp(join(tmpdir(), "jev-symbol-abort-"));
  const controller = new AbortController();
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end(JSON.stringify({ ok: true, hits: [] })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const previous = symbolLayer.searchSymbols;
  try {
    setSemanticSearchForTests(async () => ({ available: false, hits: [], reason: "fixture" }));
    symbolLayer.searchSymbols = async () => { controller.abort(new Error("cancel during symbols")); return []; };
    await assert.rejects(executeCodeSearch({ query: "where refreshToken happens", queryVariants: ["refresh credentials"], projectRoot: root,
      registry: new RefRegistry(), excludeGlobs: [], signal: controller.signal,
      sidecar: { pid: process.pid, port: address.port, token: "fixture-local-token", provider: "rg" },
    }), /cancel during symbols/);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requests, 0);
  } finally {
    if (previous) symbolLayer.searchSymbols = previous; else delete symbolLayer.searchSymbols;
    setSemanticSearchForTests(null);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("sidecar HTTP receives caller cancellation without serializing the signal", async () => {
  const controller = new AbortController();
  let signalWasSent = false;
  const server = createServer(async (req, _res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    signalWasSent = Object.hasOwn(JSON.parse(Buffer.concat(chunks).toString()), "signal");
    controller.abort(new Error("stop transport"));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const start = Date.now();
    await assert.rejects(sidecarSearch({ pid: process.pid, port: address.port, token: "fixture-local-token" }, { query: "needle", signal: controller.signal }), /stop transport/);
    assert.ok(Date.now() - start < 1000);
    assert.equal(signalWasSent, false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
