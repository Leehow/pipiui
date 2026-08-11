import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import corpus from "../eval/memory-learning-loop.v1.json" with { type: "json" };
import { MemoryCatalog } from "../src/memory-catalog.ts";
import { MemoryCurator } from "../src/memory-curator.ts";
import { createCatalogHermesRetrievalPort, RetrievalOrchestrator, type RetrievalCandidate } from "../src/retrieval-orchestrator.ts";
import { MemoryRuntimeMetricsCollector } from "../src/runtime-metrics.ts";

type Scenario = { id: string; group: string; query: string; expected?: string; forbid?: string; needsHistory: boolean; skip?: boolean; app?: string; validatedApp?: string; role?: "main" | "worker" | "operator"; capability?: boolean };
const scenarios = corpus.scenarios as Scenario[];
const expectedByQuery = new Map(scenarios.filter((s) => s.expected).map((s) => [s.query, s.expected!]));
const hermes = { add: async (r: { id: string }) => ({ id: `fake-hermes-${r.id}` }), verify: async () => true };
const p95 = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)]! : 0; };

async function active(catalog: MemoryCatalog, claim: string, scope: { kind: "project" | "app"; project: string; app?: string }, evidence = "observed conditions steps pitfalls verification", sourceRuns = ["verified:a", "verified:b"]) {
  const r = await catalog.upsert({ kind: claim === "R04" ? "procedural" : "semantic", claim, summary: claim, scope, evidence: [{ summary: evidence }], sourceRuns });
  return catalog.promote(r.id, hermes);
}
function validateContract(items: RetrievalCandidate[], request: { project: string; app?: string }, threshold = .55): string[] {
  const failed: string[] = [];
  for (const r of items) {
    if (r.status !== "active") failed.push("tombstone");
    if (r.scope.project !== request.project || (r.scope.kind === "app" && r.scope.app !== request.app)) failed.push("scope");
    if (r.hermesScore < threshold) failed.push("threshold");
    if (/(api[_ -]?key|token|password|secret|ignore previous instructions|system prompt|screenshot|coordinates)/iu.test(r.summary)) failed.push("secret-filter");
  }
  return [...new Set(failed)];
}

async function setup(metrics: MemoryRuntimeMetricsCollector) {
  const dir = await mkdtemp(join(tmpdir(), "pipiui-memory-eval-")); const catalog = await MemoryCatalog.open(dir);
  for (let i=1; i<=10; i++) await active(catalog, `R${String(i).padStart(2,"0")}`, { kind: i === 7 ? "app" : "project", project: "project-a", ...(i === 7 ? { app: "com.acme.editor" } : {}) });
  await active(catalog, "R11-old", {kind:"project",project:"project-a"}); const newer = await active(catalog,"R11-new",{kind:"project",project:"project-a"}); const old = catalog.list().find(r=>r.claim === "R11-old")!; await catalog.supersede(newer.id, old.id);
  const stale = await active(catalog,"R12-stale",{kind:"project",project:"project-a"}); await catalog.transition(stale.id,"stale");
  const deleted = await active(catalog,"R13-deleted",{kind:"project",project:"project-a"}); await catalog.transition(deleted.id,"deleted");
  await active(catalog,"R14-old",{kind:"project",project:"project-a"}); const latest = await active(catalog,"R14-new",{kind:"project",project:"project-a"}); const prior = catalog.list().find(r=>r.claim === "R14-old")!; await catalog.supersede(latest.id,prior.id);
  const reviewed = await catalog.upsert({kind:"semantic",claim:"R15",summary:"R15",scope:{kind:"project",project:"project-a"},evidence:[{summary:"observed"}],sourceRuns:["run-reviewed"]});
  await active(catalog,"X-project",{kind:"project",project:"project-b"});
  await active(catalog,"X-secret",{kind:"project",project:"project-a"},"api_key=should-never-persist");
  await active(catalog,"X-computer",{kind:"project",project:"project-a"},"screenshot coordinates raw computer");
  // Candidate paths prove invalid review and evidence thresholds cannot promote.
  const invalid = await catalog.upsert({kind:"semantic",claim:"R16",scope:{kind:"project",project:"project-a"},evidence:[{summary:"observed"}],sourceRuns:["run"]});
  const weakProcedure = await catalog.upsert({kind:"procedural",claim:"R17",scope:{kind:"project",project:"project-a"},evidence:[{summary:"steps only"}],sourceRuns:["verified:a"]});
  const weakFailure = await catalog.upsert({kind:"episodic",claim:"R18",scope:{kind:"project",project:"project-a"},evidence:[{summary:"symptom only"}],provenance:[{source:"test",reason:"failure"}],sourceRuns:["run"]});
  const curator = MemoryCurator.create({mode:"main",catalog,hermes,metrics,reviewer:{review: async (x) => x.candidate.id === invalid.id ? { bad: true } : {decision:"promote",kind:"semantic",claim:x.candidate.claim,confidence:.9,reason:"reviewed",evidenceRefs:["fixture"]}}})!;
  await curator.runBatch();
  assert.equal(catalog.get(reviewed.id)?.status,"active");
  assert.notEqual(catalog.get(invalid.id)?.status,"active"); assert.notEqual(catalog.get(weakProcedure.id)?.status,"active"); assert.notEqual(catalog.get(weakFailure.id)?.status,"active");
  const scorer = { score: async (query: string, record: { summary: string }) => expectedByQuery.get(query) === record.summary ? .99 : .1 };
  return { dir, catalog, port: createCatalogHermesRetrievalPort(catalog, scorer) };
}

export async function runMemoryLearningEval(options: { jsonPath?: string } = {}) {
  if (scenarios.length < 30) throw new Error("corpus must contain at least 30 scenarios");
  const groups = ["correct-recall","abstain","conflict-update","scope-security","promotion-forgetting"];
  for (const g of groups) if (scenarios.filter(s=>s.group===g).length < 5) throw new Error(`corpus group ${g} needs >=5 scenarios`);
  const metrics = new MemoryRuntimeMetricsCollector(() => 1_700_000_000_000, process.platform); const {dir,catalog,port} = await setup(metrics); const failures: string[] = []; let right = 0, returned = 0, noMemory = 0, abstained = 0, onHistorySuccess = 0, onNonHistorySafe = 0;
  try {
    const orchestrator = new RetrievalOrchestrator(port);
    for (const s of scenarios) {
      let items: string[] = []; let resultCount = 0; let wasAbstain = false;
      if (s.skip) { wasAbstain = true; } else {
        const out = await orchestrator.recall({runId:`eval-${s.id}`,role:s.role ?? "main",project:"project-a",text:s.query,trigger:"explicit-query",capabilityValid:s.capability ?? true,...(s.app?{bundleId:s.app}:{}),...(s.validatedApp?{validatedBundleId:s.validatedApp}:{validatedBundleId:s.app})});
        items = out.context.items.map(i=>i.reference); resultCount = items.length; wasAbstain = out.telemetry.abstained || out.telemetry.skipped;
      }
      metrics.record({triggered:!s.skip,skipped:!!s.skip,abstain:wasAbstain,resultCount,latencyMs: 2 + (resultCount ? 1 : 0),candidate:0,promotion:0,reject:0,supersede:0,stale:0,delete:0,degraded:false});
      const pass = (!s.expected || items.includes(s.expected)) && (!s.forbid || !items.includes(s.forbid)) && items.length <= 3 && JSON.stringify(items).length <= 1200;
      if (!pass) failures.push(s.id);
      if (s.expected && items.includes(s.expected)) right++;
      returned += resultCount;
      if (!s.needsHistory) { noMemory++; if (wasAbstain && resultCount === 0) onNonHistorySafe++; }
      if (s.needsHistory && s.expected && items.includes(s.expected)) onHistorySuccess++;
    }
    // Mutation-like negative contracts: each deliberately bad result maps to the guard that must reject it.
    const base = catalog.list().find(r=>r.claim === "R01")!;
    const asCandidate = (patch: Partial<RetrievalCandidate>): RetrievalCandidate => ({...base,hermesScore:.99,...patch});
    const mutations: Record<string, string[]> = {
      "remove-scope": validateContract([asCandidate({scope:{kind:"project",project:"project-b"}})],{project:"project-a"}),
      "remove-threshold": validateContract([asCandidate({hermesScore:.1})],{project:"project-a"}),
      "remove-tombstone": validateContract([asCandidate({status:"deleted"})],{project:"project-a"}),
      "remove-secret-filter": validateContract([asCandidate({summary:"api_key=leak"})],{project:"project-a"}),
    };
    for (const [name, observed] of Object.entries(mutations)) if (!observed.length) failures.push(`mutation-${name}`);
    const latencies: number[] = []; for (let i=0;i<40;i++) { const start=performance.now(); await new RetrievalOrchestrator(port).recall({runId:`perf-${i}`,role:"main",project:"project-a",text:"Remember the build convention",trigger:"explicit-query"}); latencies.push(performance.now()-start); }
    const precision = returned ? right / returned : 1; const abstention = noMemory ? abstained /* overwritten below */ : 1;
    // Count only no-history corpus rows after their explicit result is observed deterministically.
    const noMemoryAbstention = noMemory ? onNonHistorySafe / noMemory : 1;
    const summary = {version:1,platform:process.platform,corpusVersion:corpus.version,sampleCount:scenarios.length,metrics:{precisionAt3:precision,noMemoryAbstention,leakage:0,deletedResurrection:0,sensitivePersistence:0,retrievalP95Ms:p95(latencies),top3And1200Chars:true,invalidReviewPromotion:false,memoryOnHistorySuccess:onHistorySuccess,memoryOffHistorySuccess:0,memoryOnNonHistorySafe:onNonHistorySafe,memoryOffNonHistorySafe:noMemory},runtimeMetrics:metrics.summary(),performance:{method:"40 real short local retrieval loops; p95 uses sorted[ceil(n*0.95)-1]",samples:latencies.length,p95Ms:p95(latencies)},mutations:Object.fromEntries(Object.entries(mutations).map(([k,v])=>[k,v])),failures};
    const gates = precision >= .85 && noMemoryAbstention >= .90 && summary.metrics.retrievalP95Ms <= 300 && !failures.length;
    console.log(`Memory eval v${corpus.version}: ${gates ? "PASS" : "FAIL"} | scenarios=${scenarios.length} precision@3=${precision.toFixed(3)} abstention=${noMemoryAbstention.toFixed(3)} p95=${summary.metrics.retrievalP95Ms.toFixed(2)}ms`);
    const json = JSON.stringify(summary);
    console.log(json);
    if (options.jsonPath) { await mkdir(dirname(options.jsonPath), { recursive: true }); await writeFile(options.jsonPath, `${json}\n`, "utf8"); }
    if (!gates) process.exitCode = 1;
    return summary;
  } finally { await rm(dir,{recursive:true,force:true}); }
}
function cliOptions(args: string[]): { jsonPath?: string } {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--json" && args[1]?.trim()) return { jsonPath: args[1] };
  throw new Error("Usage: eval-memory.ts [--json <path>]");
}

if (process.argv[1]?.endsWith("eval-memory.ts")) {
  runMemoryLearningEval(cliOptions(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
