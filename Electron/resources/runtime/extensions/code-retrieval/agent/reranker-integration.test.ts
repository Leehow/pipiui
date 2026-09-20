import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { RefRegistry } from "./protocol.js";
import { connectReranker, type RerankerBus } from "./reranker.js";
import { setSemanticSearchForTests } from "./zvec-semantic.js";

// Dynamic import keeps the optional extension out of code-retrieval's build/runtime imports.
// Integration verification builds BOTH packages before running this test.
const providerModule = new URL("../../../jev-optimizer/agent/dist/index.js", import.meta.url).href;
const key = "jev-integration-fixture-not-a-real-key";

for (const providerFirst of [true, false]) test(`real optional packages interoperate, providerFirst=${providerFirst}`, async () => {
  const { createJevOptimizer } = await import(providerModule);
  const root = await mkdtemp(join(tmpdir(), "jev-integration-"));
  const emitter = new EventEmitter();
  const bus: RerankerBus = {
    on: (name, handler) => { emitter.on(name, handler); return () => { emitter.off(name, handler); }; },
    emit: (name, payload) => { emitter.emit(name, payload); },
  };
  const stateFile = join(root, "state.json");
  const env = { EXT_JEV_OPTIMIZER_APIKEY: key, PIPIUI_JEV_STATE_FILE: stateFile, PIPIUI_JEV_GENERATION: "generation-one" };
  let calls = 0;
  let revokeDuringFetch = false;
  let responseOverride: string | undefined;
  let provider: { dispose(): void } | undefined;
  const deps = {
    env, pollMs: 5,
    fetch: async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      assert.ok(!String(init.body).includes(key));
      assert.ok(!String(init.body).includes(root));
      assert.equal(init.redirect, "error");
      assert.equal(body.state.candidates.length, 2);
      const answers = Object.fromEntries(body.state.candidates.map((c: { id: string; path: string }) => [c.id, { type: "score", score: c.path === "src/b.ts" ? 3 : 0 }]));
      if (revokeDuringFetch) {
        await writeFile(stateFile, JSON.stringify({ schemaVersion: 1, enabled: false, hasKey: true, generation: "generation-two" }));
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      return new Response(responseOverride ?? JSON.stringify({ model: "jev-fixture", answers, usage: { input_tokens: 123 } }));
    },
  };
  const startProvider = () => { provider = createJevOptimizer({ events: bus, on() {} }, deps); };
  if (providerFirst) startProvider();
  const client = connectReranker(bus);
  if (!providerFirst) startProvider();
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/a.ts"), "export const mention = 'token';\n");
    await writeFile(join(root, "src/b.ts"), "export function refresh() { return 'token'; }\n");
    await writeFile(stateFile, JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: "generation-one" }));
    setSemanticSearchForTests(async () => ({ available: true, provider: "zvec", hits: ["src/a.ts", "src/b.ts"].map(path => ({ path, startLine: 1, endLine: 1 })) }));
    const search = async () => {
      const optimizer = client.current();
      return executeCodeSearch({ query: "where token refresh happens", projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined,
        reranker: optimizer, isRerankerCurrent: () => client.current()?.instanceId === optimizer?.instanceId });
    };
    const applied = await search();
    assert.equal(applied.details.reranker?.status, "applied");
    assert.equal(applied.details.hits[0]!.path, "src/b.ts");
    assert.equal(applied.details.reranker?.inputTokens, 123);
    assert.equal(calls, 1);
    responseOverride = '{"answers":{"candidate-1":{"type":"score","score":3},"candidate-1":{"type":"score","score":0},"candidate-2":{"type":"score","score":3}}}';
    const duplicate = await search();
    assert.equal(duplicate.details.reranker?.status, "fallback");
    assert.equal(duplicate.details.hits[0]!.path, "src/a.ts");
    assert.equal(calls, 2);
    responseOverride = undefined;
    revokeDuringFetch = true;
    const revoked = await search();
    assert.equal(revoked.details.reranker?.status, "fallback");
    assert.equal(revoked.details.hits[0]!.path, "src/a.ts");
    assert.equal(calls, 3);
    const disabled = await search();
    assert.equal(disabled.details.reranker?.status, "skipped");
    assert.equal(calls, 3, "revoked main/worker snapshot must not upload again");
    provider!.dispose();
    assert.equal(client.current(), undefined);
    const local = await search();
    assert.equal(local.details.reranker, undefined);
    assert.equal(calls, 3);
    assert.ok(!(await readFile(stateFile, "utf8")).includes(key));
  } finally {
    provider?.dispose(); client.dispose(); setSemanticSearchForTests(null);
    await rm(root, { recursive: true, force: true });
  }
});
