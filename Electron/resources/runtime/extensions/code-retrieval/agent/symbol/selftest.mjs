#!/usr/bin/env node
/**
 * Stage-1 evidence: Python repo_map + definition/references on flask/requests.
 * Uses /private/tmp/pipiui-eval clones locked by .pi/agent/code-retrieval/eval/repos.json.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const symbolDir = here;
const repoRoot = join(here, "..", "..", "..", "..", "..", "..", "..");
const tsc = join(repoRoot, "Electron", "node_modules", "typescript", "bin", "tsc");
const evalDir = join(repoRoot, ".pi", "agent", "code-retrieval", "eval");
const reposPath = join(evalDir, "repos.json");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(tsc)) fail(`workspace tsc not found: ${tsc}`);
if (!existsSync(reposPath)) fail(`repos.json missing: ${reposPath}`);

const compile = spawnSync(process.execPath, [tsc, "-p", join(symbolDir, "tsconfig.json")], {
  stdio: "inherit",
});
if (compile.status !== 0) fail("tsc -p agent/symbol/tsconfig.json");

const mod = await import(pathToFileURL(join(symbolDir, "dist", "index.js")).href);
const {
  initTreeSitter,
  isTreeSitterReady,
  treeSitterInitError,
  sidecarAssetStatus,
  computeRepoMap,
  navigateProject,
  lastCachedExtractStats,
} = mod;

const assets = sidecarAssetStatus();
console.log("sidecar", assets.sidecarDir);
if (!assets.ok) fail(`wasm missing: ${assets.missing.join(", ")}`);

await initTreeSitter();
if (!isTreeSitterReady()) fail(`web-tree-sitter load failed: ${treeSitterInitError()}`);
console.log("web-tree-sitter: ready");

const repos = JSON.parse(readFileSync(reposPath, "utf8"));
const cloneRoot = repos.clone_root;
const wanted = ["flask", "requests"];
const results = [];
const passTimings = [];

async function runRepo(id, pass) {
  const spec = repos.repos.find((r) => r.id === id);
  const root = join(cloneRoot, id);
  if (!spec || !existsSync(root)) fail(`eval clone missing: ${root} (run eval/run_baseline.py --clone)`);

  const t0 = Date.now();
  const map = await computeRepoMap(root, { tokenBudget: 4000 });
  const mapMs = Date.now() - t0;
  const mapCache = lastCachedExtractStats();
  const sigCount = map.entries.reduce(
    (n, e) => n + e.symbols.filter((s) => s.kind !== "import" && s.signature).length,
    0,
  );
  const callEdges = map.entries.reduce((n, e) => n + e.calls.length, 0);
  const importEdges = map.entries.reduce((n, e) => n + e.imports.length, 0);

  const defs = [];
  const refs = [];
  const defQueries = id === "flask"
    ? ["Flask", "render_template", "url_for", "SessionInterface"]
    : ["HTTPAdapter", "Session.send", "PreparedRequest", "send"];
  const refQueries = id === "flask"
    ? ["render_template", "url_for", "open_session"]
    : ["send", "resolve_redirects", "prepare"];

  const tNav = Date.now();
  for (const q of defQueries) {
    const r = await navigateProject(root, { operation: "definition", symbol: q });
    defs.push({ q, n: r.hits.length, degraded: r.degraded, sample: r.hits[0] });
  }
  for (const q of refQueries) {
    const r = await navigateProject(root, { operation: "references", symbol: q });
    refs.push({ q, n: r.hits.length, degraded: r.degraded, sample: r.hits[0] });
  }
  const callers = await navigateProject(root, { operation: "callers", symbol: "send" });
  const navMs = Date.now() - tNav;
  const navCache = lastCachedExtractStats();
  const totalMs = Date.now() - t0;

  const row = {
    repo: id,
    pass,
    files: map.fileCount,
    mapEntries: map.entries.length,
    signatures: sigCount,
    callEdges,
    importEdges,
    degraded: map.degraded,
    definitionHits: defs.reduce((n, d) => n + d.n, 0),
    referenceHits: refs.reduce((n, d) => n + d.n, 0),
    mapMs,
    navMs,
    totalMs,
    mapCache,
    navCache,
    defs,
    refs,
    callersUnsupported: Boolean(callers.unsupported),
    sampleEntry: map.entries[0]
      ? {
          path: map.entries[0].path,
          score: map.entries[0].score,
          signatures: map.entries[0].symbols.slice(0, 4).map((s) => s.signature),
          calls: map.entries[0].calls.slice(0, 4),
        }
      : null,
  };

  console.log(`\n== ${id} pass=${pass} ==`);
  console.log(`files=${row.files} map_entries=${row.mapEntries} signatures=${row.signatures} call_edges=${row.callEdges} imports=${row.importEdges}`);
  console.log(`timing map=${mapMs}ms nav=${navMs}ms total=${totalMs}ms`);
  if (mapCache) {
    console.log(`cache(map) hits=${mapCache.cacheHits} misses=${mapCache.cacheMisses} mem=${mapCache.memoryHits} disk=${mapCache.diskHits} extract=${mapCache.elapsedMs}ms`);
  }
  if (navCache) {
    console.log(`cache(nav) hits=${navCache.cacheHits} misses=${navCache.cacheMisses} mem=${navCache.memoryHits} disk=${navCache.diskHits} extract=${navCache.elapsedMs}ms`);
  }
  if (row.sampleEntry) {
    console.log(`top ${row.sampleEntry.path} score=${row.sampleEntry.score.toFixed(4)}`);
    for (const s of row.sampleEntry.signatures) console.log(`  sig ${s}`);
    for (const c of row.sampleEntry.calls) console.log(`  call ${c.from} -> ${c.to}`);
  }
  for (const d of defs) console.log(`definition ${d.q}: ${d.n}${d.sample ? `  e.g. ${d.sample.path}:${d.sample.startLine} ${d.sample.symbol}` : ""}`);
  for (const r of refs) console.log(`references ${r.q}: ${r.n}${r.sample ? `  e.g. ${r.sample.path}:${r.sample.startLine}` : ""}`);
  console.log(`callers unsupported=${row.callersUnsupported}`);

  if (map.degraded || row.mapEntries === 0) fail(`${id}: repo_map empty/degraded`);
  if (sigCount === 0) fail(`${id}: repo_map has no signatures`);
  if (callEdges === 0) fail(`${id}: repo_map has no call edges`);
  if (row.definitionHits === 0) fail(`${id}: definition hits empty`);
  if (row.referenceHits === 0) fail(`${id}: references hits empty`);
  if (!row.callersUnsupported) fail(`${id}: callers must be marked unsupported`);
  return row;
}

for (const pass of [1, 2]) {
  const tPass = Date.now();
  for (const id of wanted) {
    const row = await runRepo(id, pass);
    results.push(row);
  }
  passTimings.push({ pass, ms: Date.now() - tPass });
  console.log(`\n-- pass ${pass} wall=${Date.now() - tPass}ms --`);
}

const first = passTimings[0]?.ms ?? 0;
const second = passTimings[1]?.ms ?? 0;
if (first > 50 && second >= first) {
  fail(`second pass not faster: pass1=${first}ms pass2=${second}ms`);
}

const outDir = join(evalDir, "symbol");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "selftest.json");
writeFileSync(
  outPath,
  JSON.stringify({ ok: true, when: new Date().toISOString(), passTimings, results }, null, 2),
);
console.log(`\nOK flask+requests repo_map + definition/references non-empty`);
console.log(`pass1=${first}ms pass2=${second}ms speedup=${first && second ? (first / Math.max(second, 1)).toFixed(2) : "n/a"}x`);
console.log(`wrote ${outPath}`);
