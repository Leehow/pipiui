import { createHash } from "node:crypto";
import type { BatchRecord, BatchTrial, BatchTrialState, FrozenVariant } from "./batch-contract.js";

const STATES: BatchTrialState[] = ["queued", "preparing", "running", "waiting-input", "verifying", "succeeded", "failed", "timed-out", "cancelled", "invalid", "interrupted"];
const TERMINAL = new Set<BatchTrialState>(["succeeded", "failed", "timed-out", "cancelled", "invalid", "interrupted"]);
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const nonnegative = (value: unknown): number | null => { const n = finite(value); return n !== null && n >= 0 ? n : null; };
// Stable and JSON-roundtrip safe, including incomplete/non-finite historical evidence.
function canonical(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number") return JSON.stringify(finite(value));
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const fingerprint = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const copy = <T>(value: T): T => JSON.parse(canonical(value)) as T;
function elapsed(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  return nonnegative(Date.parse(end) - Date.parse(start));
}
export type NumericSummary = { n: number; missing: number; median: number | null; min: number | null; max: number | null };
function summary(values: Array<number | null>): NumericSummary {
  const numbers = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const n = numbers.length;
  return { n, missing: values.length - n, median: n ? finite(n % 2 ? numbers[n >> 1] : numbers[n / 2 - 1] / 2 + numbers[n / 2] / 2) : null, min: numbers[0] ?? null, max: numbers[n - 1] ?? null };
}
export type ComparisonEvidence = { frozenVariants?: FrozenVariant[] };
export type ComparisonPoint = {
  trialId: string | null; variantId: string; caseId: string; repetition: number;
  planned: boolean; state: BatchTrialState | "missing-record"; quality: BatchTrial["quality"];
  started: boolean | "unknown"; reason: string | null; sequence: number | null; manualInput: boolean;
  verification: { source: "coordinator-checks" | "unknown"; checks: BatchTrial["checks"] };
  metrics: Array<BatchTrial["metrics"][number] & { direction: "lower" | "higher" | "neutral" | "unknown" }>;
  timing: { queueMs: number | null; totalTrialMs: number | null; piSessionMs: number | null; completedPiSessionMs: number | null; workloadMs: null; preparationMs: null; verificationMs: null; censored: boolean };
  usage: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null; total: number | null; source: "pi-session" | "unknown"; cost: { reportedValue: number | null; source: "provider" | "pricing-estimate" | "unknown"; currency: "unknown"; actualBill: false } };
  evidence: { runFingerprint: string | null; actualProfileFingerprint: string | null; effectiveSystemPromptFingerprint: string | null; runtimeFingerprint: string | null; sessionId: string | null };
};
export type ComparisonSeries = {
  metricId: string; unit: string; direction: "lower" | "higher" | "neutral" | "unknown";
  source: string; subset: "quality-pass-completed-no-manual-input" | "all-recorded-trials";
  values: Array<{ trialId: string | null; repetition: number; value: number | null }>;
  statistics: NumericSummary;
};
export type ComparisonReport = {
  version: 1; fingerprint: string; recordFingerprint: string;
  experimentId: string; batchId: string; revision: number; definitionFingerprint: string;
  state: BatchRecord["state"]; mode: BatchRecord["mode"]; budget: BatchRecord["budget"];
  cases: BatchRecord["cases"]; metricDefinitions: BatchRecord["metricDefinitions"];
  variants: Array<BatchRecord["variants"][number] & { label: string; revision: number; baselineFingerprint: string | null; frozenEvidenceFingerprint: string | null }>;
  points: ComparisonPoint[];
  totals: { planned: number; recorded: number; started: number; startUnknown: number; notStarted: number; missingRecords: number; distinctCases: number; repetitions: number };
  perVariant: Array<{ variantId: string; planned: number; started: number; startUnknown: number; notStarted: number; finished: number; states: Record<BatchTrialState | "missing-record", number>; quality: Record<"pass" | "fail" | "unknown", number>; qualityRate: { passed: number; actualStarted: number; allPlanned: number; perStarted: number | null; perPlanned: number | null }; cases: Array<{ caseId: string; series: ComparisonSeries[] }> }>;
  timing: { batchWallClockMs: number | null; sumObservedTrialMs: number | null; observedTrialCount: number; missingTrialCount: number };
  pairs: Array<{ leftVariant: string; rightVariant: string; caseId: string; compatible: boolean; reasons: string[]; series: Array<{ metricId: string; source: string; unit: string; direction: ComparisonSeries["direction"]; operation: "right-minus-left"; differences: Array<{ repetition: number; leftTrial: string; rightTrial: string; value: number }>; statistics: NumericSummary; excludedRepetitions: number[] }> }>;
  conditions: { baseline: "verified-frozen-evidence" | "unknown"; configurationVariables: Array<{ field: string; values: Array<{ variantId: string; value: unknown }> }>; resourceContention: "possible" | "unknown"; rateLimiting: "unknown"; cache: "unknown"; seed: "unknown"; environmentValues: "unknown" };
  limitations: string[]; untested: string[];
};
function point(batch: BatchRecord, variantId: string, caseId: string, repetition: number, trial?: BatchTrial, planned = true): ComparisonPoint {
  const run = trial?.run, usage = run?.usage;
  const started = run?.pid || trial?.pid ? true : !trial || trial.startedAt || run ? "unknown" : false;
  const metric = (id: string) => nonnegative(trial?.metrics.find((m) => m.id === id && m.source === "runtime" && m.unit === "ms")?.value);
  const complete = (trial?.state === "succeeded" || trial?.state === "failed") && run?.state === "completed";
  return {
    trialId: trial?.id ?? null, variantId, caseId, repetition, planned, state: trial?.state ?? "missing-record", quality: trial?.quality ?? "unknown", started,
    reason: trial?.reason ?? null, sequence: trial?.sequence ?? null, manualInput: trial?.manualInput === true,
    verification: { source: trial?.checks.length ? "coordinator-checks" : "unknown", checks: copy(trial?.checks ?? []) },
    metrics: (trial?.metrics ?? []).map((m) => ({ ...m, value: finite(m.value), direction: m.source === "runtime" && ["runtime-total-ms", "pi-session-ms"].includes(m.id) ? "lower" : batch.metricDefinitions.find((d) => d.id === m.id && d.unit === m.unit)?.direction ?? "unknown" })),
    timing: { queueMs: elapsed(trial?.createdAt, trial?.startedAt), totalTrialMs: metric("runtime-total-ms"), piSessionMs: nonnegative(run?.totalMs), completedPiSessionMs: complete ? nonnegative(run?.totalMs) : null, workloadMs: null, preparationMs: null, verificationMs: null, censored: !complete },
    usage: { input: nonnegative(usage?.input), output: nonnegative(usage?.output), cacheRead: nonnegative(usage?.cacheRead), cacheWrite: nonnegative(usage?.cacheWrite), total: nonnegative(usage?.total), source: usage?.source ?? "unknown", cost: { reportedValue: nonnegative(usage?.cost), source: "unknown", currency: "unknown", actualBill: false } },
    evidence: { runFingerprint: run ? fingerprint(run) : null, actualProfileFingerprint: run?.profileFingerprint ?? null, effectiveSystemPromptFingerprint: run?.effectiveSystemPromptFingerprint ?? null, runtimeFingerprint: run?.runtime ? fingerprint(run.runtime) : null, sessionId: run?.sessionId ?? null },
  };
}
function eligible(p: ComparisonPoint): boolean { return p.planned && p.started === true && p.state === "succeeded" && p.quality === "pass" && p.verification.source === "coordinator-checks" && p.verification.checks.every((c) => c.passed) && !p.manualInput && !p.timing.censored; }
function seriesFor(points: ComparisonPoint[]): ComparisonSeries[] {
  const descriptors = new Map<string, { metricId: string; source: string; unit: string; direction: ComparisonSeries["direction"] }>();
  descriptors.set("runtime:completed-pi-session-ms:ms", { metricId: "completed-pi-session-ms", source: "runtime", unit: "ms", direction: "lower" });
  for (const p of points) for (const m of p.metrics) if (m.source !== "unavailable") descriptors.set(`${m.source}:${m.id}:${m.unit}`, { metricId: m.id, source: m.source, unit: m.unit, direction: m.direction });
  const rows: ComparisonSeries[] = [...descriptors.values()].map((d) => {
    const values = points.filter(eligible).map((p) => ({ trialId: p.trialId, repetition: p.repetition, value: d.metricId === "completed-pi-session-ms" ? p.timing.completedPiSessionMs : p.metrics.find((m) => m.id === d.metricId && m.source === d.source && m.unit === d.unit)?.value ?? null }));
    return { ...d, subset: "quality-pass-completed-no-manual-input", values, statistics: summary(values.map((v) => v.value)) };
  });
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    const values = points.map((p) => ({ trialId: p.trialId, repetition: p.repetition, value: p.usage[key] }));
    rows.push({ metricId: `tokens-${key}`, source: "pi-session", unit: "tokens", direction: "neutral", subset: "all-recorded-trials", values, statistics: summary(values.map((v) => v.value)) });
  }
  const values = points.map((p) => ({ trialId: p.trialId, repetition: p.repetition, value: p.usage.cost.reportedValue }));
  rows.push({ metricId: "reported-cost-unknown-provenance", source: "unknown", unit: "unknown", direction: "unknown", subset: "all-recorded-trials", values, statistics: summary(values.map((v) => v.value)) });
  return rows;
}
function label(index: number): string { let out = ""; for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(65 + (i - 1) % 26) + out; return out; }

/** Pure offline calculation; optional immutable VariantStore.read evidence enables baseline verification.
 * BatchCoordinator.read (not get/list summaries) is the authoritative persisted input.
 * Never combines separate batches, case workloads, or repetitions into independent tasks.
 */
export function buildComparisonReport(batch: BatchRecord, evidence: ComparisonEvidence = {}): ComparisonReport {
  if (batch.version !== 1 || !Number.isInteger(batch.budget.repetitions) || batch.budget.repetitions < 1 || batch.budget.repetitions * batch.variants.length * batch.cases.length > 512) throw new Error("invalid-comparison-matrix");
  if (new Set(batch.variants.map((v) => v.id)).size !== batch.variants.length || new Set(batch.cases.map((c) => c.id)).size !== batch.cases.length) throw new Error("duplicate-comparison-definition");
  const variants = batch.variants.map((v, index) => {
    const frozen = evidence.frozenVariants?.filter((f) => f.experimentId === batch.experimentId && f.revision === batch.revision && f.id === v.id && f.fingerprint === v.fingerprint);
    const match = frozen?.length === 1 ? frozen[0] : undefined;
    return { ...copy(v), label: label(index), revision: batch.revision, baselineFingerprint: match?.baselineFingerprint || null, frozenEvidenceFingerprint: match ? fingerprint(match) : null };
  });
  const points: ComparisonPoint[] = [], used = new Set<BatchTrial>();
  for (const v of batch.variants) for (const c of batch.cases) for (let repetition = 1; repetition <= batch.budget.repetitions; repetition++) {
    const matches = batch.trials.filter((t) => t.variantId === v.id && t.caseId === c.id && t.repetition === repetition);
    if (matches.length > 1) throw new Error("duplicate-comparison-trial");
    if (matches[0]) used.add(matches[0]);
    points.push(point(batch, v.id, c.id, repetition, matches[0]));
  }
  for (const t of batch.trials) if (!used.has(t)) points.push(point(batch, t.variantId, t.caseId, t.repetition, t, false));
  const planned = points.filter((p) => p.planned);
  const perVariant = variants.map((v) => {
    const selected = planned.filter((p) => p.variantId === v.id);
    const states = Object.fromEntries([...STATES, "missing-record"].map((s) => [s, selected.filter((p) => p.state === s).length])) as ComparisonReport["perVariant"][number]["states"];
    const quality = { pass: 0, fail: 0, unknown: 0 }; for (const p of selected) quality[p.quality]++;
    const started = selected.filter((p) => p.started === true).length;
    const passed = selected.filter((p) => p.started === true && p.quality === "pass" && p.verification.source === "coordinator-checks" && p.verification.checks.every((c) => c.passed)).length;
    return { variantId: v.id, planned: selected.length, started, startUnknown: selected.filter((p) => p.started === "unknown").length, notStarted: selected.filter((p) => p.started === false && p.state !== "missing-record").length, finished: selected.filter((p) => TERMINAL.has(p.state as BatchTrialState)).length, states, quality, qualityRate: { passed, actualStarted: started, allPlanned: selected.length, perStarted: started ? passed / started : null, perPlanned: selected.length ? passed / selected.length : null }, cases: batch.cases.map((c) => ({ caseId: c.id, series: seriesFor(selected.filter((p) => p.caseId === c.id)) })) };
  });
  const baselineKnown = variants.length > 0 && variants.every((v) => v.baselineFingerprint !== null && v.baselineFingerprint === variants[0].baselineFingerprint);
  const pairs: ComparisonReport["pairs"] = [];
  for (let i = 0; i < variants.length; i++) for (let j = i + 1; j < variants.length; j++) for (const c of batch.cases) {
    const left = variants[i], right = variants[j], reasons: string[] = [];
    if (!left.baselineFingerprint || !right.baselineFingerprint) reasons.push("baseline-evidence-unknown");
    else if (left.baselineFingerprint !== right.baselineFingerprint) reasons.push("baseline-mismatch");
    if (batch.mode !== "comparison") reasons.push("throughput-not-controlled-comparison");
    if (points.some((p) => !p.planned)) reasons.push("unplanned-trial-records");
    const rows: ComparisonReport["pairs"][number]["series"] = [];
    const leftSeries = perVariant[i].cases.find((row) => row.caseId === c.id)!.series;
    const rightSeries = perVariant[j].cases.find((row) => row.caseId === c.id)!.series;
    for (const a of leftSeries) {
      if (a.source === "unknown") continue;
      const b = rightSeries.find((s) => s.metricId === a.metricId && s.unit === a.unit && s.source === a.source);
      if (!b) continue;
      const differences: typeof rows[number]["differences"] = [], excludedRepetitions: number[] = [];
      for (let repetition = 1; repetition <= batch.budget.repetitions; repetition++) {
        const lp = planned.find((p) => p.variantId === left.id && p.caseId === c.id && p.repetition === repetition)!;
        const rp = planned.find((p) => p.variantId === right.id && p.caseId === c.id && p.repetition === repetition)!;
        const av = a.values.find((v) => v.repetition === repetition)?.value, bv = b.values.find((v) => v.repetition === repetition)?.value;
        const runtimeMatches = lp.evidence.runtimeFingerprint !== null && lp.evidence.runtimeFingerprint === rp.evidence.runtimeFingerprint;
        const delta = av == null || bv == null ? null : finite(bv - av);
        if (reasons.length || !eligible(lp) || !eligible(rp) || !runtimeMatches || delta === null) excludedRepetitions.push(repetition);
        else differences.push({ repetition, leftTrial: lp.trialId!, rightTrial: rp.trialId!, value: delta });
      }
      rows.push({ metricId: a.metricId, source: a.source, unit: a.unit, direction: a.direction, operation: "right-minus-left", differences, statistics: summary(differences.map((d) => d.value)), excludedRepetitions });
    }
    pairs.push({ leftVariant: left.id, rightVariant: right.id, caseId: c.id, compatible: reasons.length === 0, reasons, series: rows });
  }
  const configurationVariables: ComparisonReport["conditions"]["configurationVariables"] = [];
  for (const field of ["profile", "profileFingerprint", "environmentKeys"] as const) if (new Set(variants.map((v) => canonical(v[field]))).size > 1) configurationVariables.push({ field, values: variants.map((v) => ({ variantId: v.id, value: v[field] ?? null })) });
  const durations = points.map((p) => p.timing.totalTrialMs), observed = durations.filter((v): v is number => v !== null);
  const body: Omit<ComparisonReport, "fingerprint"> = {
    version: 1, recordFingerprint: fingerprint(batch), experimentId: batch.experimentId, batchId: batch.id, revision: batch.revision, definitionFingerprint: batch.definitionFingerprint, state: batch.state, mode: batch.mode, budget: copy(batch.budget), cases: copy(batch.cases), metricDefinitions: copy(batch.metricDefinitions), variants, points, perVariant, pairs,
    totals: { planned: planned.length, recorded: batch.trials.length, started: planned.filter((p) => p.started === true).length, startUnknown: planned.filter((p) => p.started === "unknown").length, notStarted: planned.filter((p) => p.started === false && p.state !== "missing-record").length, missingRecords: planned.filter((p) => p.state === "missing-record").length, distinctCases: batch.cases.length, repetitions: batch.budget.repetitions },
    timing: { batchWallClockMs: elapsed(batch.createdAt, batch.endedAt), sumObservedTrialMs: observed.length ? finite(observed.reduce((a, b) => a + b, 0)) : null, observedTrialCount: observed.length, missingTrialCount: durations.length - observed.length },
    conditions: { baseline: baselineKnown ? "verified-frozen-evidence" : "unknown", configurationVariables, resourceContention: batch.budget.concurrency > 1 ? "possible" : "unknown", rateLimiting: "unknown", cache: "unknown", seed: "unknown", environmentValues: "unknown" },
    limitations: [
      "仅同批次、同测例、同轮次、同起始基线与共同预算/并发条件配对；配置差异单列为声明变量，不进行跨批合并。",
      "每个测例的重复轮不是独立任务；仅描述样本数、中位数、范围和右减左差值，不给总分、强制赢家或显著性结论。",
      "性能统计子集为已启动、完整完成、固定检查通过且无人工输入；所有失败、超时、取消、无效、中断、未知和未启动点仍保留。usage描述统计包含所有已记录用量，配对仍限相同通过子集。",
      "Pi session耗时包含启动/握手/等待/模型/工具/退出，不等于纯被测工作；总trial耗时包含准备与验证；逐轮耗时之和不是批次墙钟。超时/取消耗时仅为截至终止观察值。",
      "workload-output是被测程序自报，非独立验证；runtime指标不可由它替代。质量来自coordinator固定检查；没有检查不算质量达标。",
      "pi-session usage.cost未记录provider返回或pricing estimate来源及币种，保留数值但来源unknown，不作为实际账单或可比价格。缺用量不补0。",
      "费用/token仅归属本批被测Pi会话，不含Boss、原型制作或外部验证成本；这些成本未观测，不能算作0。",
      "限流、并发资源争用、人工输入和环境/缓存/seed未知不能直接归因于候选退化；配对排除人工输入及运行时不一致/缺失证据。",
      ...(!baselineKnown ? ["BatchRecord没有起始baseline指纹；未提供匹配FrozenVariant证据时禁用配对差值。"] : []),
      ...(planned.some((p) => p.state === "missing-record") ? ["计划矩阵存在缺失记录，未推断为未启动或成功。"] : []),
    ],
    untested: ["纯被测工作、准备和验证阶段独立耗时未观测", "浏览器交互/响应式/真实生产数据与正式集成回归未由本批证明", "限流、资源争用、缓存、seed及环境值一致性未测", "主树相对冻结原型的新改动及过期范围未核对", "原始metrics产物内容指纹未保存在BatchRecord中；当前仅有记录/run/冻结证据指纹"],
  };
  return { ...body, fingerprint: fingerprint(body) };
}

/** Rebuilds from full persisted records without running Pi or issuing a judge request. */
export async function rebuildComparisonReport(reader: { read(experimentId: string, batchId: string): Promise<BatchRecord> }, experimentId: string, batchId: string, evidence: ComparisonEvidence = {}): Promise<ComparisonReport> {
  const batch = await reader.read(experimentId, batchId);
  if (batch.experimentId !== experimentId || batch.id !== batchId) throw new Error("comparison-record-mismatch");
  return buildComparisonReport(batch, evidence);
}

export type TrustedUserEntry = { entryId: string; sessionId: string; role: "user"; text: string; reportFingerprint: string };
declare const userSourceBrand: unique symbol;
export type TrustedUserMessageSource = { readonly [userSourceBrand]: true };
const userSources = new WeakMap<TrustedUserMessageSource, (entryId: string) => Promise<TrustedUserEntry | null>>();
/** HOST ONLY: register a closure that reads actual Pi session user entries and binds the
 * report actually shown in that conversation. Never expose this factory/closure in a tool
 * schema or construct entries from model-supplied text/source='user'. JSON cannot forge it.
 */
export function createTrustedUserMessageSource(readEntry: (entryId: string) => Promise<TrustedUserEntry | null>): TrustedUserMessageSource {
  const source = Object.freeze({}) as TrustedUserMessageSource;
  userSources.set(source, readEntry);
  return source;
}
export type AdoptionRequest = { reportFingerprint: string; userEntryId?: string; suggestedVariantId?: string };
export type ImplementationHandoff = {
  status: "implementation-handoff" | "suggestion-draft"; reason: string;
  reportFingerprint: string; experimentId: string; batchId: string; definitionFingerprint: string;
  selection: { variantId: string; label: string; revision: number; fingerprint: string; profileFingerprint: string } | null;
  userEvidence: { sessionId: string; entryId: string } | null;
  verified: Array<{ trialId: string; caseId: string; repetition: number; checks: BatchTrial["checks"] }>;
  unverified: string[]; requirements: string[]; mergePolicy: "never"; automaticImplementation: false;
};
/** Generates an inert handoff only; never writes, merges, commits or relaxes never policy. */
export async function buildImplementationHandoff(report: ComparisonReport, request: AdoptionRequest, source?: TrustedUserMessageSource): Promise<ImplementationHandoff> {
  const { fingerprint: claimed, ...body } = report;
  if (fingerprint(body) !== claimed) throw new Error("comparison-report-tampered");
  let reason = "trusted-user-selection-required", selected = report.variants.find((v) => v.id === request.suggestedVariantId), userEvidence: ImplementationHandoff["userEvidence"] = null;
  const reader = source && userSources.get(source);
  if (request.reportFingerprint !== report.fingerprint) reason = "report-fingerprint-mismatch";
  else if (reader && request.userEntryId) {
    const entry = await reader(request.userEntryId);
    if (!entry || entry.role !== "user" || entry.entryId !== request.userEntryId || !entry.sessionId || entry.reportFingerprint !== report.fingerprint) reason = "user-entry-or-report-binding-mismatch";
    else {
      // Deliberately narrow full-message intent: no quoted text, negation, alternatives,
      // suggestions, or generic approval can be promoted into a user selection.
      const match = /^(?:请\s*)?(?:按\s*([A-Za-z][A-Za-z0-9-]*)\s*正式实现|采用\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:正式)?实现)[。！!]?$/u.exec(entry.text.trim());
      const token = match?.[1] ?? match?.[2];
      const choices = token ? report.variants.filter((v) => v.id === token || v.label === token.toUpperCase()) : [];
      if (choices.length === 1) { selected = choices[0]; userEvidence = { sessionId: entry.sessionId, entryId: entry.entryId }; reason = "explicit-user-selection"; }
      else reason = "no-unambiguous-explicit-selection";
    }
  }
  const selection = selected ? { variantId: selected.id, label: selected.label, revision: selected.revision, fingerprint: selected.fingerprint, profileFingerprint: selected.profileFingerprint } : null;
  return {
    status: userEvidence ? "implementation-handoff" : "suggestion-draft", reason,
    reportFingerprint: report.fingerprint, experimentId: report.experimentId, batchId: report.batchId, definitionFingerprint: report.definitionFingerprint,
    selection, userEvidence, verified: report.points.filter((p) => p.variantId === selected?.id && eligible(p)).map((p) => ({ trialId: p.trialId!, caseId: p.caseId, repetition: p.repetition, checks: copy(p.verification.checks) })),
    unverified: [...report.untested, ...report.points.filter((p) => p.variantId === selected?.id && !eligible(p)).map((p) => `${p.caseId}/${p.repetition}: ${p.state}, quality=${p.quality}, manualInput=${p.manualInput}`)],
    requirements: ["这是正式实现交接而非已执行：进入正常开发流程后重新整合，不自动实施。", "只复用经检查适用于正式需求的逻辑；逐项识别并去除mock/stub、夹具、实验工具/配置和试验代码，当前记录无可安全删除的路径清单。", "核对主树与确切冻结版本之间的新改动；主树过期范围unknown，若有变化必须重新整合并运行正式回归。", "保留失败与未测项并补足真实交互/生产边界验证；本报告不授权提交、合并、部署、打包或宿主重启。"],
    mergePolicy: "never", automaticImplementation: false,
  };
}
