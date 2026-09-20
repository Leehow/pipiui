#!/usr/bin/env node
/** Controlled paired benchmark: generated code only, live requests require an explicit flag. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { SYNTHETIC_CASES, generatedFiles, liveSyntheticAllowed } from "./eval-lib/synthetic-cases.mjs";
import { summarizeArm } from "./eval-lib/jev-contrast.mjs";
import { sanitizeValue } from "./eval-lib/result-files.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const live = liveSyntheticAllowed(argv, process.env);
const outputAt = argv.indexOf("--json");
const output = outputAt >= 0 ? argv[outputAt + 1] : argv.find(x => x.startsWith("--json="))?.slice(7);
if (outputAt >= 0 && !output) throw new Error("--json requires a path");
const { executeCodeSearch } = await import(join(here, "../dist/code-search.js"));
const { RefRegistry } = await import(join(here, "../dist/protocol.js"));
const { applyOptionalRerank, connectReranker } = await import(join(here, "../dist/reranker.js"));
const { rebuildZvecIndex } = await import(join(here, "../dist/zvec-semantic.js"));
const createJevOptimizer = live ? (await import(join(here, "../../../jev-optimizer/agent/dist/index.js"))).createJevOptimizer : undefined;

const root = await mkdtemp(join(tmpdir(), "pipiui-jev-synthetic-"));
const started = performance.now();
let requests = 0;
let provider;
let consumer;
const records = [];
const poolKey = (hits) => hits.map(({ path, startLine, endLine }) => `${path}:${startLine}-${endLine}`).sort();
const fingerprint = (hits) => createHash("sha256").update(JSON.stringify(poolKey(hits))).digest("hex");
function measurement(def, arm, repetition, hits, latencyMs, metadata) {
  const rank = hits.findIndex(hit => hit.path === `${def.id}/work.ts`);
  return { id: def.id, arm, repetition, latencyMs: Math.round(latencyMs), firstGoldRank: rank < 0 ? null : rank + 1,
    goldInTop12: rank >= 0 && rank < 12, goldInTop3: rank >= 0 && rank < 3, goldInTop1: rank === 0,
    candidateCount: hits.length, poolFingerprint: fingerprint(hits),
    rerankStatus: metadata?.status ?? (arm === "C" || arm === "singleQueryJev" ? "skipped" : null),
    rerankReason: metadata?.reason ?? null, model: metadata?.model ?? null, inputTokenCount: metadata?.inputTokens ?? null,
    error: null, skipped: false };
}
try {
  for (const def of SYNTHETIC_CASES) for (const file of generatedFiles(def)) {
    const dest = join(root, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.text, "utf8");
  }
  const rebuilt = await rebuildZvecIndex(root);
  if (!rebuilt.ok) throw new Error(`Synthetic index unavailable: ${rebuilt.reason}`);
  if (live) {
    const emitter = new EventEmitter();
    const events = { on(name, handler) { emitter.on(name, handler); return () => emitter.off(name, handler); }, emit(name, value) { emitter.emit(name, value); } };
    consumer = connectReranker(events);
    provider = createJevOptimizer({ events, on() {} }, {
      // This authorization is for the generated corpus only; never import project state or files.
      env: { EXT_JEV_OPTIMIZER_APIKEY: process.env.TYPESAFE_API_KEY, PIPIUI_JEV_STATE_FILE: "synthetic-only", PIPIUI_JEV_GENERATION: "synthetic-only" },
      readState: async () => JSON.stringify({ schemaVersion: 1, enabled: true, hasKey: true, generation: "synthetic-only" }),
      fetch: async (...args) => { if (requests >= 60) throw new Error("Synthetic request cap exceeded"); requests++; return fetch(...args); },
    });
  }
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const def of SYNTHETIC_CASES) {
      const local = {};
      for (const arm of repetition % 2 ? ["B", "A"] : ["A", "B"]) {
        const t0 = performance.now();
        // topK=100 exposes the complete bounded B candidate pool for an exact paired rerank.
        const result = await executeCodeSearch({ query: def.query, ...(arm === "B" ? { queryVariants: def.variants } : {}), mode: "semantic", topK: 100,
          projectRoot: root, registry: new RefRegistry(), excludeGlobs: [], sidecar: undefined });
        if (/^code_search failed/.test(result.content?.[0]?.text ?? "")) throw new Error(`Synthetic tool failure: ${def.id}/${arm}`);
        local[arm] = { hits: result.details.hits, elapsed: performance.now() - t0, degraded: result.details.degraded };
        records.push({ ...measurement(def, arm, repetition, local[arm].hits, local[arm].elapsed), degraded: local[arm].degraded });
      }
      if (live) for (const [arm, base] of repetition % 2 ? [["singleQueryJev", "A"], ["C", "B"]] : [["C", "B"], ["singleQueryJev", "A"]]) {
        const t0 = performance.now();
        const optimizer = consumer.current();
        const result = await applyOptionalRerank({ query: def.query, hits: local[base].hits, projectRoot: root, excludeGlobs: [], reranker: optimizer,
          isRerankerCurrent: () => consumer.current()?.instanceId === optimizer?.instanceId });
        assert.deepEqual(poolKey(result.hits), poolKey(local[base].hits), "reranking must not add/drop/change candidates");
        records.push({ ...measurement(def, arm, repetition, result.hits, local[base].elapsed + performance.now() - t0, result.details), degraded: local[base].degraded });
      }
      process.stderr.write(`synthetic ${repetition + 1}/3 ${def.id}: ${requests}/60 API requests\n`);
    }
  }
  const summary = {};
  for (const arm of ["A", "B", "C", "singleQueryJev"]) {
    const rows = records.filter(row => row.arm === arm);
    summary[arm] = rows.length ? { ...summarizeArm(rows), top1Accuracy: rows.filter(r => r.goldInTop1).length / rows.length,
      applied: rows.filter(r => r.rerankStatus === "applied").length, fallbacks: rows.filter(r => r.rerankStatus === "fallback").length,
      inputTokenCount: rows.reduce((sum, row) => sum + (row.inputTokenCount ?? 0), 0), status: "measured" }
      : { status: "not-run", reason: "--live-synthetic not supplied", top1Accuracy: null, latencyP50Ms: null };
  }
  const regressions = records.filter(row => ["C", "singleQueryJev"].includes(row.arm)).flatMap(row => {
    const base = records.find(other => other.id === row.id && other.repetition === row.repetition && other.arm === (row.arm === "C" ? "B" : "A"));
    return base.goldInTop12 && !row.goldInTop12 ? [{ id: row.id, arm: row.arm, repetition: row.repetition }] : [];
  });
  const report = { schemaVersion: 1, kind: "jev-synthetic-paired", ranAt: new Date().toISOString(), live, requests, elapsedMs: Math.round(performance.now() - started),
    distinctTasks: SYNTHETIC_CASES.length, repetitions: 3, files: 40, candidateBudget: 100, indexState: "prebuilt synthetic index",
    corpus: "generated near-match distractor scenarios, not representative repository or full-agent acceptance",
    latencyDefinition: "A/B production core local search; C=B plus rerank; singleQueryJev=A plus rerank; no LLM loop measured",
    candidateIdentity: "exact same captured pool for each local/Jev pair; equality asserted", summary, regressions,
    correctnessGate: live ? (regressions.length ? "FAIL" : "PASS_ON_TESTED_CASES") : "NOT_RUN",
    totalCostUsd: null, wholeAgentSpeedup: null, globalCorrectnessGuarantee: false, records };
  if (regressions.length) process.exitCode = 1;
  const pct = (v) => v == null ? "未测" : `${(v * 100).toFixed(1)}%`;
  const lines = ["# Jev 合成代码真实配对测试", "", `10 个不同任务 × 3 次；${requests} 次真实 API 请求；只发送生成的代码。`,
    "近似词干扰为人工构造，不等于真实仓库、LLM 排序或完整 Agent 的性能。", "",
    "| 方案 | Top1 | Recall@3 | Recall@12 | P50/P95 总毫秒 | 应用/回退 | 输入 token |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for (const arm of ["A", "B", "C", "singleQueryJev"]) { const r = summary[arm]; lines.push(`| ${arm} | ${pct(r.top1Accuracy)} | ${pct(r.recallAt3)} | ${pct(r.recallAt12)} | ${r.latencyP50Ms ?? "未测"}/${r.latencyP95Ms ?? "未测"} | ${r.applied ?? "未测"}/${r.fallbacks ?? "未测"} | ${r.inputTokenCount ?? "未测"} |`); }
  lines.push("", `配对候选集合保持不变；Top12 新增漏检：${regressions.length}。实际费用未取得，不估造账单。`,
    "这里只检验这批生成案例；不能据此保证全部正确，也不能声称整个 Agent 更快。", "");
  const markdown = lines.join("\n");
  process.stdout.write(markdown);
  if (output) { await writeFile(resolve(output), `${JSON.stringify(sanitizeValue(report, { maxArrayLength: 200 }), null, 2)}\n`); await writeFile(`${resolve(output)}.md`, markdown); }
} finally {
  provider?.dispose(); consumer?.dispose();
  // This directory was uniquely created by this process, never a user's repository.
  await rm(root, { recursive: true, force: true });
}
