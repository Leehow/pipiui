import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { executeCodeSearch } from "./code-search.js";
import { exactSearch } from "./grep-exact.js";
import { RefRegistry } from "./protocol.js";
import type { Reranker } from "./reranker.js";
import { matchesSearchScope } from "./search-scope.js";
import { fuseRecall, queryVariants, recallQueries } from "./wide-recall.js";
import { setSemanticSearchForTests } from "./zvec-semantic.js";
import type { UnassignedHit } from "./types.js";

const hit = (i: number): UnassignedHit => ({ path: `src/f${i}.ts`, startLine: 1, endLine: 12, score: 100 - i });
async function fixture(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "jev-wide-"));
  try {
    await mkdir(join(root, "src"));
    for (let i = 0; i < 12; i++) await writeFile(join(root, `src/f${i}.ts`), Array.from({ length: 12 }, (_, n) => `// source ${i} needle line ${n}`).join("\n"));
    await body(root);
  } finally { setSemanticSearchForTests(null); await rm(root, { recursive: true, force: true }); }
}

function optimizer(ready = true): Reranker {
  return { version: 1, provider: "jev-optimizer", instanceId: "wide-test", availability: async () => ({ ready, reason: ready ? undefined : "no-key" }),
    rerank: async ({ candidates }) => ({ status: "applied", scores: candidates.map((c, i) => ({ id: c.id, score: i / candidates.length * 3 })) }) };
}

test("query variants are bounded, trimmed and deduplicated", () => {
  assert.deepEqual(queryVariants("main", [" main ", "other", " other "]), ["other"]);
  for (const invalid of [null, "a", [" "], ["x".repeat(513)], ["a", "b", "c", "d"]]) assert.throws(() => queryVariants("main", invalid));
});

test("multi-query tool uses two lanes, stable fusion, one registry and one persisted result", async () => {
  await fixture(async (root) => {
    let active = 0, peak = 0;
    const calls: string[] = [];
    setSemanticSearchForTests(async (args) => {
      calls.push(args.query); peak = Math.max(peak, ++active);
      assert.equal(args.topK, 6);
      assert.equal(args.path, "src"); assert.equal(args.glob, "**/*.ts");
      await new Promise(resolve => setTimeout(resolve, args.query === "main" ? 15 : 2)); active--;
      return { available: true, provider: "zvec", hits: (args.query === "main" ? [0, 1, 2] : args.query === "second" ? [2, 3, 1] : [3, 2]).map(hit) };
    });
    const registry = new RefRegistry();
    const result = await executeCodeSearch({ query: "main", queryVariants: ["second", "third", " second "], mode: "semantic", topK: 2, path: "src", glob: "**/*.ts",
      projectRoot: root, registry, excludeGlobs: [], sidecar: undefined });
    assert.equal(peak, 2); assert.deepEqual(calls, ["main", "second", "third"]);
    assert.deepEqual(result.details.hits.map(x => x.path), ["src/f2.ts", "src/f3.ts"]);
    assert.deepEqual(result.details.hits[0]!.queryIndices, [0, 1, 2]);
    assert.equal(result.details.hits[0]!.score, 98);
    assert.equal(registry.size(), 2);
    assert.deepEqual(result.details.hits.map(x => x.ref), ["R1", "R2"]);
    assert.equal(result.details.sources?.length, 3);
    assert.equal(result.details.reranker, undefined);
    assert.equal((await readdir(join(root, ".pi/agent/code-retrieval/results"))).length, 1);
  });
});

test("plain and missing-key queries preserve their candidate budget; ready optimizer widens once", async () => {
  await fixture(async (root) => {
    const budgets: Array<number | undefined> = [];
    setSemanticSearchForTests(async ({ topK }) => { budgets.push(topK); return { available: true, provider: "zvec", hits: Array.from({ length: topK ?? 2 }, (_, i) => hit(i)) }; });
    const run = (reranker?: Reranker) => executeCodeSearch({ query: "where refresh happens", topK: 2, projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined, reranker });
    const plain = await run();
    const noKey = await run(optimizer(false));
    assert.deepEqual(noKey.details.hits, plain.details.hits);
    assert.equal(plain.details.sources, undefined); assert.equal(noKey.details.sources, undefined);
    const ready = await run(optimizer());
    assert.deepEqual(budgets, [2, 2, 6]);
    assert.deepEqual(ready.details.hits.map(x => x.path), ["src/f5.ts", "src/f4.ts"]);
    assert.equal(ready.details.reranker?.evaluatedCount, 6);
    assert.equal(ready.details.hits.length, 2);
  });
});

test("exact/symbol variants reject before recall, even when a variant duplicates the primary", async () => {
  await fixture(async (root) => {
    let calls = 0;
    setSemanticSearchForTests(async () => { calls++; return { available: true, hits: [hit(0)] }; });
    for (const mode of ["auto", "exact", "symbol"] as const) {
      const result = await executeCodeSearch({ query: "knownSymbol", queryVariants: ["knownSymbol"], mode, projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined });
      assert.equal(result.details.degraded, true); assert.match(result.content[0]!.text, /queryVariants/);
    }
    assert.equal(calls, 0);
  });
});

test("one query fallback does not discard other results and mixed providers are attributed per source", async () => {
  await fixture(async (root) => {
    await writeFile(join(root, "src/f1.ts"), "export const lastNeedle = true;\n");
    setSemanticSearchForTests(async ({ query }) => {
      if (query === "broken-expression") throw new Error("injected unavailable index");
      if (query === "lastNeedle") return { available: false, hits: [], reason: "fixture lexical route" };
      return { available: true, provider: "zvec", hits: [hit(0)] };
    });
    const result = await executeCodeSearch({ query: "first", queryVariants: ["broken-expression", "lastNeedle"], mode: "semantic", projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined });
    assert.equal(result.details.hits.length, 2);
    assert.equal(result.details.degraded, true);
    assert.equal(result.details.provider, undefined, "must not claim one provider served all mixed hits");
    assert.equal(result.details.sources?.[0]?.provider, "zvec");
    assert.equal(result.details.sources?.[2]?.provider, "rg");
  });
});

test("wide results obey scope/globs and reject an index symlink escape", async () => {
  await fixture(async (root) => {
    const outer = await mkdtemp(join(tmpdir(), "jev-outside-"));
    try {
      await writeFile(join(outer, "private.ts"), "do not disclose\n");
      await symlink(join(outer, "private.ts"), join(root, "src/escape.ts"));
      setSemanticSearchForTests(async () => ({ available: true, provider: "zvec", hits: [hit(0), hit(10), { path: "src/escape.ts", startLine: 1, endLine: 1 }] }));
      const result = await executeCodeSearch({ query: "where code lives", queryVariants: ["source behavior"], path: "src", glob: "*.{ts,tsx}", projectRoot: root,
        registry: new RefRegistry(), excludeGlobs: ["**/f?.ts"], sidecar: undefined });
      assert.deepEqual(result.details.hits.map(x => x.path), ["src/f10.ts"]);
      assert.ok(!JSON.stringify(result).includes("do not disclose"));
      const escaped = await executeCodeSearch({ query: "where code lives", queryVariants: ["source behavior"], path: outer, projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined });
      assert.equal(escaped.details.hits.length, 0); assert.match(escaped.content[0]!.text, /inside the current project/);
      assert.equal(matchesSearchScope("private/deep/a.ts", { excludeGlobs: ["private"] }), false);
    } finally { await rm(outer, { recursive: true, force: true }); }
  });
});

test("RRF deduplicates within each query, preserves scores and protects strong hits before pool trimming", () => {
  const a = hit(0), b = hit(1);
  const result = fuseRecall([{ hits: [a, a, b], degraded: false }, { hits: [b], degraded: false }], 2);
  assert.deepEqual(result.hits.map(x => x.path), [b.path, a.path]);
  assert.deepEqual(result.hits[0]!.queryIndices, [0, 1]);
  assert.equal(result.hits[0]!.score, b.score);
  const protectedResult = fuseRecall([{ hits: [a, b], degraded: false }, { hits: [b], degraded: false }], 1, (x) => x.path === a.path);
  assert.equal(protectedResult.hits[0]!.path, a.path);
});

test("cancelled recall never starts queued queries", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  await assert.rejects(recallQueries(["a", "b", "c", "d"], async (_q, i) => {
    started.push(i);
    const waiting = new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true }));
    if (i === 1) queueMicrotask(() => controller.abort(new Error("stopped")));
    return waiting;
  }, controller.signal), /stopped/);
  assert.deepEqual(started, [0, 1]);
});

test("Node fallback neither leaves the project nor follows a child symlink cycle", async () => {
  await fixture(async (root) => {
    const outer = await mkdtemp(join(tmpdir(), "jev-outside-grep-"));
    const path = process.env.PATH;
    try {
      await writeFile(join(outer, "private.ts"), "needle\n");
      await symlink(outer, join(root, "src/escape"));
      await symlink(join(root, "src"), join(root, "src/cycle"));
      process.env.PATH = "/nonexistent-jev-test-bin";
      const local = await exactSearch({ query: "needle", projectRoot: root, path: "src", topK: 100 });
      assert.equal(local.length, 100, "bounded line matches are capped even in Node fallback");
      assert.ok(local.every(x => !x.path.includes("escape") && !x.path.includes("cycle")));
      assert.deepEqual(await exactSearch({ query: "needle", projectRoot: root, path: outer }), []);
      const file = await exactSearch({ query: "needle", projectRoot: root, path: "src/f0.ts", topK: 1 });
      assert.equal(file.length, 1);
    } finally {
      if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
      await rm(outer, { recursive: true, force: true });
    }
  });
});
