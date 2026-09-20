import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expandDeepSearch, DEEP_LIMITS, type DeepSearchArgs } from "./deep-search.js";
import type { Reranker } from "./reranker.js";
import { executeCodeSearch } from "./code-search.js";
import { RefRegistry } from "./protocol.js";
import { rebuildZvecIndex } from "./zvec-semantic.js";
import { resultsDir } from "./paths.js";
import { codeNavHook } from "./symbol/hooks-adapter.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "pipiui-deep-search-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  return root;
}
function args(root: string, path = "entry.ts"): DeepSearchArgs {
  return { query: "locate the implementation and its entry point", projectRoot: root, excludeGlobs: [], limit: 12,
    hits: [{ path, startLine: 2, endLine: 2, symbol: "start" }], navigate: async () => [] };
}
const pair = { "entry.ts": 'import { work } from "./worker.js";\nexport function start() { return work(); }\n', "worker.ts": 'export function work() { return 42; }\n' };

test("deep follows parsed relative JS-to-TS imports and preserves both ends without Jev", async t => {
  const root = await fixture(t, pair);
  let calls = 0;
  const reranker: Reranker = { version: 1, provider: "jev-optimizer", instanceId: "test", availability: async () => { calls++; return { ready: true }; }, rerank: async () => { throw new Error("unnecessary cloud call"); } };
  const result = await expandDeepSearch({ ...args(root), reranker });
  assert.equal(calls, 0);
  assert.deepEqual(result.hits.map(h => h.path), ["entry.ts", "worker.ts"]);
  assert(result.details.links.some(e => e.kind === "import" && e.to === "worker.ts:1-1"));
  assert.equal(result.hits[1]?.text, pair["worker.ts"].trim());
});

test("stale enclosing ranges are refreshed and contained spans share output slots", async t => {
  const root = await fixture(t, pair);
  const result = await expandDeepSearch({ ...args(root), limit: 2, hits: [
    { path: "entry.ts", startLine: 2, endLine: 99 },
    { path: "worker.ts", startLine: 1, endLine: 2 },
  ] });
  assert.equal(result.hits.length, 2);
  assert(result.hits.every(h => h.endLine <= 3));
  assert(result.details.links.some(e => e.from === "entry.ts:2-3" && e.to === "worker.ts:1-2"));
});

test("parsed imports ignore commented and quoted fake statements", async t => {
  const root = await fixture(t, { "entry.ts": '/* import x from "./trap"; */\nexport function start() { return "import y from ./trap"; }\n', "trap.ts": 'export function trap() {}' });
  const result = await expandDeepSearch(args(root));
  assert.equal(result.details.filesRead, 1);
  assert.equal(result.details.links.length, 0);
});

test("name-based graph callers stay adjacent to the implementation, without final score filtering", async t => {
  const root = await fixture(t, pair);
  const result = await expandDeepSearch({ ...args(root), hits: [{ path: "worker.ts", startLine: 1, endLine: 1, symbol: "work" }],
    navigate: async ({ operation, path }) => ({ hits: operation === "callers" && path === "worker.ts" ? [{ path: "entry.ts", startLine: 2, endLine: 2, symbol: "start" }] : [], incomplete: true }) });
  assert.deepEqual(result.hits.map(h => h.path), ["worker.ts", "entry.ts"]);
  assert(result.details.links.some(e => e.kind === "callers"));
  assert.equal(result.details.incomplete, true);
});

test("only excess unanchored starting branches request one optional rerank", async t => {
  const root = await fixture(t, Object.fromEntries(["a", "b", "c", "d"].map(n => [`${n}.ts`, `export function ${n}() { return 1; }\n`])));
  let calls = 0;
  const reranker: Reranker = { version: 1, provider: "jev-optimizer", instanceId: "branches", availability: async () => ({ ready: true }),
    rerank: async ({ candidates }) => { calls++; return { status: "applied", scores: candidates.map(c => ({ id: c.id, score: c.path === "d.ts" ? 3 : 0 })) }; } };
  const hits = ["a", "b", "c", "d"].map(n => ({ path: `${n}.ts`, startLine: 1, endLine: 1 }));
  const result = await expandDeepSearch({ ...args(root), hits, reranker });
  assert.equal(calls, 1);
  assert.equal(result.hits[0]?.path, "d.ts");
  assert.equal(result.hits.length, 4, "low scores must not delete local evidence");
  assert.equal(result.reranker?.status, "applied");
  const anchored = await expandDeepSearch({ ...args(root), hits, reranker, query: 'explain "a.ts"', limit: 4 });
  assert.equal(calls, 1, "explicit anchor needs no model selection");
  assert.equal(anchored.hits[0]?.path, "a.ts");
});

test("reranker failure keeps the original local frontier", async t => {
  const root = await fixture(t, Object.fromEntries(["a", "b", "c", "d"].map(n => [`${n}.ts`, `export function ${n}() {}`])));
  const reranker: Reranker = { version: 1, provider: "jev-optimizer", instanceId: "broken", availability: async () => ({ ready: true }), rerank: async () => ({ status: "fallback", reason: "network" }) };
  const result = await expandDeepSearch({ ...args(root), hits: ["a", "b", "c", "d"].map(n => ({ path: `${n}.ts`, startLine: 1, endLine: 1 })), reranker });
  assert.equal(result.hits[0]?.path, "a.ts");
  assert.equal(result.hits.length, 4);
  assert.equal(result.reranker?.status, "fallback");
});

test("relative imports and graph results obey path, glob, exclusions and realpath containment", async t => {
  const outside = await fixture(t, { "outside.ts": 'export function secret() {}' });
  const root = await fixture(t, {
    "app/entry.ts": 'import { work } from "../private";\nexport function start() { return work(); }\nimport { secret } from "./escape";\nimport x from "./hidden";\n',
    "private.ts": 'export function work() {}', "app/hidden.ts": 'export function hidden() {}', "app/other.js": 'export function other() {}',
  });
  await symlink(join(outside, "outside.ts"), join(root, "app/escape.ts"));
  const result = await expandDeepSearch({ ...args(root, "app/entry.ts"), path: "app", glob: "**/*.ts", excludeGlobs: ["**/hidden.ts"],
    navigate: async () => [{ path: "../outside.ts", startLine: 1, endLine: 1 }, { path: "app/hidden.ts", startLine: 1, endLine: 1 }, { path: "app/other.js", startLine: 1, endLine: 1 }, { path: "app/escape.ts", startLine: 1, endLine: 1 }] });
  assert.deepEqual(result.hits.map(h => h.path), ["app/entry.ts"]);
  assert.equal(result.details.filesRead, 1);
});

test("linked evidence truncation is explicit, including topK one", async t => {
  const root = await fixture(t, pair);
  const result = await expandDeepSearch({ ...args(root), limit: 1 });
  assert.equal(result.hits.length, 1);
  assert.equal(result.details.incomplete, true);
  assert.equal(result.details.stopReason, "budget");
  assert.equal(result.details.links.length, 0, "never expose a relation to an absent result");
});

test("cycles and expansion limits terminate with bounded work", async t => {
  const files: Record<string, string> = {};
  for (let n = 0; n < 12; n++) files[`part-${n}.ts`] = `import { step } from './part-${(n + 1) % 12}';\nexport function step() { return 1; }\n`;
  const root = await fixture(t, files);
  const result = await expandDeepSearch({ ...args(root), hits: [{ path: "part-0.ts", startLine: 2, endLine: 2 }] });
  assert(result.details.expanded <= DEEP_LIMITS.expansions);
  assert(result.details.filesRead <= DEEP_LIMITS.files);
  assert(result.details.bytesRead <= DEEP_LIMITS.bytes);
  assert.equal(result.details.incomplete, true);
});

test("large files are not read by deep expansion", async t => {
  const root = await fixture(t, { "entry.ts": 'import x from "./large";\nexport function start() {}', "large.ts": "x".repeat(DEEP_LIMITS.fileBytes + 1) });
  const result = await expandDeepSearch(args(root));
  assert.equal(result.details.filesRead, 1);
  assert.equal(result.details.incomplete, true);
});

test("cancellation stops navigation and does not start later operations", async t => {
  const root = await fixture(t, pair);
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(expandDeepSearch({ ...args(root), signal: controller.signal, navigate: async () => { calls++; controller.abort(new Error("user cancelled")); return []; } }), /user cancelled/);
  assert.equal(calls, 1);
});

test("a stuck graph hook returns bounded local evidence with an explicit deadline", async t => {
  const root = await fixture(t, pair);
  const started = Date.now();
  const result = await expandDeepSearch({ ...args(root), navigate: () => new Promise(() => {}) });
  assert(Date.now() - started < 3000);
  assert.equal(result.details.stopReason, "deadline");
  assert(result.hits.some(h => h.path === "worker.ts"));
});

test("real graph resolves a same-line call site to a leaf definition", async t => {
  const root = await fixture(t, { "entry.ts": 'export function start() { return finish(); }\nfunction finish() { return 42; }\n' });
  const result = await expandDeepSearch({ ...args(root), hits: [{ path: "entry.ts", startLine: 1, endLine: 1, symbol: "start" }], navigate: codeNavHook });
  assert(result.hits.some(h => h.symbol === "finish" && h.startLine === 2));
  assert(result.details.links.some(e => e.kind === "callees" && e.to === "entry.ts:2-2"));
});

test("external imports do not consume the relative import budget", async t => {
  const text = Array.from({ length: 8 }, (_, i) => `import p${i} from 'package-${i}';`).join('\n');
  const root = await fixture(t, { "entry.ts": text + '\nimport { work } from "./worker";\nexport function start() { return work(); }\n', "worker.ts": pair["worker.ts"] });
  const result = await expandDeepSearch({ ...args(root), hits: [{ path: "entry.ts", startLine: 10, endLine: 10, symbol: "start" }] });
  assert(result.hits.some(h => h.path === "worker.ts"));
});

test("truncated import target definitions explicitly mark incomplete evidence", async t => {
  const root = await fixture(t, { "entry.ts": 'import * as all from "./many";\nexport function start() { return all; }\n', "many.ts": ["one", "two", "three", "four"].map(n => `export function ${n}() {}`).join('\n') });
  const result = await expandDeepSearch(args(root));
  assert.equal(result.details.stopReason, "budget");
  assert.equal(result.details.incomplete, true);
  assert(result.details.notes.some(n => n.includes("definition candidates")));
});

test("markdown relative links preserve the document and linked section", async t => {
  const root = await fixture(t, { "entry.md": '# Rotation policy\nSee [steps](./steps.md).\n', "steps.md": '# Steps\nRotate credentials every month.\n' });
  const result = await expandDeepSearch({ ...args(root), hits: [{ path: "entry.md", startLine: 1, endLine: 2 }] });
  assert.deepEqual(result.hits.map(h => h.path), ["entry.md", "steps.md"]);
  assert(result.details.links.some(e => e.kind === "link"));
});

test("tool integration assigns final refs once, leaves normal mode unchanged, and rejects exact deep", async t => {
  const root = await fixture(t, { "entry.ts": '/** Release a reservation through its entry point. */\nimport { relinquish } from "./work";\nexport function start() { return relinquish(); }\n', "work.ts": 'export function relinquish() { return "released"; }\n' });
  const rebuilt = await rebuildZvecIndex(root);
  assert(rebuilt.ok, rebuilt.reason);
  const base = { query: "where a reservation is released", mode: "semantic" as const, projectRoot: root, excludeGlobs: [], sidecar: undefined, topK: 6 };
  const plain = await executeCodeSearch({ ...base, registry: new RefRegistry() });
  assert.equal(plain.details.deep, undefined);
  const registry = new RefRegistry();
  const deep = await executeCodeSearch({ ...base, deep: true, registry });
  assert(deep.details.deep);
  assert.equal(registry.size(), deep.details.hits.length);
  assert(deep.details.hits.some(h => h.path === "entry.ts"));
  assert(deep.details.hits.some(h => h.path === "work.ts"));
  assert.equal((await readdir(resultsDir(root))).length, 2, "deep internal stages must not persist extra tool results");
  const rejected = await executeCodeSearch({ ...base, deep: true, mode: "exact", registry: new RefRegistry() });
  assert.match(rejected.content[0]!.text, /deep requires/);
});
