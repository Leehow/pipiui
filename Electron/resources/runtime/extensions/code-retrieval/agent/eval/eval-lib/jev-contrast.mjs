/** Offline contrast uses the existing registered-tool measurement seam; no model scores. */
export function caseParams(def, arm = "A") {
  if (def.kind === "nav") return { operation: def.operation, symbol: def.symbol, ...(def.path ? { path: def.path } : {}) };
  if (def.kind === "map") return {};
  return {
    query: def.query,
    ...(def.mode ? { mode: def.mode } : def.kind === "exact" ? { mode: "exact" } : def.kind === "descriptive" ? { mode: "semantic" } : {}),
    ...(arm === "B" && def.kind === "descriptive" && def.queryVariants?.length ? { queryVariants: def.queryVariants } : {}),
    ...(def.path ? { path: def.path } : {}), ...(def.glob ? { glob: def.glob } : {}),
    ...(def.topK !== undefined ? { topK: def.topK } : {}),
  };
}

/** zvec is a local semantic layer, not the separately observed exact sidecar. */
export function providerHonestyViolations(details, liveProvider) {
  const rows = Array.isArray(details.sources) ? details.sources : [{ provider: details.provider, degraded: details.degraded, hitCount: details.hits?.length ?? 0 }];
  const violations = [];
  for (const row of rows) {
    if (!row.hitCount || row.degraded || !row.provider || row.provider === "zvec") continue;
    if (liveProvider && row.provider !== liveProvider) violations.push(`serving provider ${row.provider} differs from observed exact sidecar ${liveProvider} without fallback`);
  }
  const actual = new Set(rows.filter((row) => row.hitCount).map((row) => row.provider));
  if (Array.isArray(details.sources) && actual.size > 1 && details.provider) violations.push("mixed query sources must not claim a single serving provider");
  return violations;
}

export function routingExplained(details, text) {
  if (details.hits?.length) return !/^No hits\b/i.test(text);
  return /^No hits\b/i.test(text) || (details.degraded === true && Boolean(text.trim()));
}

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}

export function summarizeArm(samples) {
  const valid = samples.filter((sample) => !sample.error && !sample.skipped && !sample.staleGold);
  const latencies = valid.map((sample) => sample.latencyMs);
  const required = valid.filter((sample) => sample.requiredCount > 0);
  return {
    measured: samples.length, scored: valid.length, errors: samples.filter((sample) => sample.error).length,
    recallAt12: valid.length ? valid.filter((sample) => sample.goldInTop12).length / valid.length : null,
    recallAt3: valid.length ? valid.filter((sample) => sample.goldInTop3).length / valid.length : null,
    reciprocalRank: valid.length ? valid.reduce((sum, sample) => sum + (sample.firstGoldRank ? 1 / sample.firstGoldRank : 0), 0) / valid.length : null,
    latencyP50Ms: percentile(latencies, 0.5), latencyP95Ms: percentile(latencies, 0.95),
    outputTokenEstimateP50: percentile(valid.map((sample) => sample.outputTokenEstimate), 0.5),
    requiredCoverage: required.length ? required.reduce((sum, sample) => sum + sample.requiredFound / sample.requiredCount, 0) / required.length : null,
  };
}

/** No mock/oracle scores can be substituted for the two unexecuted Jev arms. */
export function unexecutedJevArm() {
  return { status: "not-run", reason: "no authorized live Jev experiment", recallAt12: null, latencyP50Ms: null, totalCostUsd: null };
}

export function contrastSummary(cases, records, invalidGoldIds, repetitions = 3) {
  const stale = new Set(invalidGoldIds);
  const ids = new Set(cases.map((c) => c.id));
  const validRecord = (r) => ids.has(r.id) && ["A", "B"].includes(r.arm) && Number.isInteger(r.repetition) && r.repetition >= 0 && r.repetition < repetitions;
  const accepted = records.filter(validRecord);
  const usable = accepted.map((record) => ({ ...record, staleGold: stale.has(record.id) }));
  const A = summarizeArm(usable.filter((record) => record.arm === "A"));
  const B = summarizeArm(usable.filter((record) => record.arm === "B"));
  const failures = [];
  if (cases.length < 30) failures.push("at-least-30-gold-cases");
  if (invalidGoldIds.length) failures.push("stale-gold");
  const counts = new Map();
  for (const r of accepted) { const key = `${r.id}/${r.arm}/${r.repetition}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  if (accepted.length !== records.length || counts.size !== cases.length * 2 * repetitions
    || [...counts.values()].some((count) => count !== 1) || records.some((r) => r.error || r.skipped)) failures.push("incomplete-measurement");
  if (records.some((r) => r.budgetViolations?.length)) failures.push("preview-budget");
  if (records.some((r) => r.honestyViolations?.length)) failures.push("retrieval-honesty");
  const controls = new Set(cases.filter((c) => c.kind === "exact" || c.kind === "symbol-hint" || c.kind === "nav").map((c) => c.id));
  const regressions = [];
  for (const a of usable.filter((r) => r.arm === "A" && controls.has(r.id) && !r.staleGold && r.goldInTop12)) {
    const b = usable.find((r) => r.arm === "B" && r.id === a.id && r.repetition === a.repetition);
    if (b && !b.goldInTop12 && !b.error) regressions.push(`${a.id}/${a.repetition}`);
  }
  if (regressions.length) failures.push("exact-control-regression");
  return { verdict: failures.length ? "FAIL" : "PASS", failedGates: failures, cases: cases.length,
    validGoldCases: cases.length - invalidGoldIds.length, invalidGoldIds, exactControlRegressions: regressions,
    A, B, C: unexecutedJevArm(), singleQueryJev: unexecutedJevArm(),
    liveAgentTaskSuccess: null, liveAgentLlmRounds: null, totalCloudCostUsd: null,
    speedupClaim: "UNPROVEN: local retrieval timings are not whole-agent speed or Jev benefit",
  };
}

export function contrastMarkdown(report) {
  const { summary } = report;
  const pct = (value) => value === null ? "未测" : `${(value * 100).toFixed(1)}%`;
  const lines = ["# Jev 检索离线对照", "", `- 验证结论：${summary.verdict}（仅离线测量有效性，不代表 Jev 提速）`,
    `- 金标：${summary.validGoldCases}/${summary.cases}；重复次数：${report.repetitions}；A/B 顺序按重复轮次交替。`,
    "- 初次观测不等于冷索引；没有停止或清空共享索引。后两轮标为重复观测。", "",
    "| 方案 | 有效测量 | Recall@12 | Recall@3 | P50/P95 检索毫秒 | 输出 token 估计中位数 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |"];
  for (const arm of ["A", "B"]) {
    const r = summary[arm];
    lines.push(`| ${arm === "A" ? "A 单查询本地" : "B 宽召回本地"} | ${r.scored}/${r.measured} | ${pct(r.recallAt12)} | ${pct(r.recallAt3)} | ${r.latencyP50Ms ?? "未测"}/${r.latencyP95Ms ?? "未测"} | ${r.outputTokenEstimateP50 ?? "未测"} |`);
  }
  lines.push("| C 同候选 + Jev | 未运行 | 未测 | 未测 | 未测 | 未测 |", "| 单 query + Jev | 未运行 | 未测 | 未测 | 未测 | 未测 |", "",
    "真实 Jev、整任务成功率、主模型轮次、端到端耗时和总费用均未测；不以模拟分数填充这些结果，也不宣称实现了 20% 提速。",
    `清理：只删除本轮明确返回的结果文件 ${report.cleanup?.deleted ?? 0} 个；只 detach，未终止 sidecar。`);
  if (summary.failedGates.length) lines.push(`失败门：${summary.failedGates.join(", ")}`);
  lines.push("", "## 逐案例观测", "", "| 案例 | A 最佳名次 | B 最佳名次 | A/B P50 毫秒 |", "| --- | ---: | ---: | ---: |");
  for (const c of report.cases) {
    const rank = (rows) => rows.some((r) => r.firstGoldRank) ? Math.min(...rows.filter((r) => r.firstGoldRank).map((r) => r.firstGoldRank)) : "未命中";
    lines.push(`| ${c.id} | ${rank(c.A)} | ${rank(c.B)} | ${percentile(c.A.map(r => r.latencyMs), .5) ?? "未测"}/${percentile(c.B.map(r => r.latencyMs), .5) ?? "未测"} |`);
  }
  return lines.join("\n") + "\n";
}
