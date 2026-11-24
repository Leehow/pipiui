import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { BatchCoordinator } from "./batches.js";
import type { VariantStore } from "./variants.js";
import { buildComparisonReport, buildImplementationHandoff, createTrustedUserMessageSource, type ComparisonReport, type ImplementationHandoff } from "./comparison.js";
import { ExperimentError, immutableJson, semanticId } from "./paths.js";

export const COMPARISON_ACTIONS = new Set(["batch_report", "adopt"]);
const SECTIONS = ["summary", "points", "pairs", "differences", "statistics", "cases", "variants", "limitations", "verified", "unverified"] as const;
export type ComparisonRequest = {
  version?: 1; requestId?: string; action: "batch_report" | "adopt";
  experimentId: string; batchId?: string; variantId?: string; revision?: number;
  reportFingerprint?: string; userEntryId?: string; section?: typeof SECTIONS[number];
  limit?: number; offset?: number; saveReport?: boolean;
};
export const comparisonParameterProperties = {
  reportFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$", description: "此前 batch_report 返回的完整性指纹，不是新身份；省略时仍须匹配本会话此前展示的当前报告。" },
  userEntryId: { type: "string", minLength: 1, maxLength: 512, description: "仅定位本会话已有用户 entry；默认最近用户消息，不要求用户填写，不能传文本冒充授权。" },
  section: { type: "string", enum: SECTIONS, description: "默认 summary；points/pairs/statistics 等按 limit/offset 分页，每页1至20项。" },
  saveReport: { type: "boolean", description: "将完整报告保存为本项目 .pi/agent/experiments 下的只读 JSON；不运行或采纳任何代码。" },
};
export type ComparisonContext = { sessionManager?: Pick<ExtensionContext["sessionManager"], "getBranch" | "getSessionId"> };
export type ComparisonResponse = {
  version: 1; action: ComparisonRequest["action"]; requestId?: string;
  report: ComparisonReport; reportPath?: string;
  evidence: { batchPath: string; recordFingerprint: string; frozenVariants: Array<{ variantId: string; revision: number; fingerprint: string | null; status: "matched" | "unavailable" | "mismatch" }> };
  handoff?: ImplementationHandoff;
};
const fail = (code: string) => new ExperimentError(code, code);
function page(request?: ComparisonRequest) {
  const limit = request?.limit ?? 10, offset = request?.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 || !Number.isSafeInteger(offset) || offset < 0) throw fail("invalid-page");
  return { limit, offset };
}
const short = (value: string | null, max = 300) => value === null ? null : value.length > max ? `${value.slice(0, max)}…` : value;
const variantView = (v: ComparisonReport["variants"][number]) => ({ id: v.id, label: v.label, revision: v.revision, fingerprint: v.fingerprint, profileFingerprint: v.profileFingerprint, baselineFingerprint: v.baselineFingerprint, frozenEvidenceFingerprint: v.frozenEvidenceFingerprint, profile: { id: v.profile.id, provider: short(v.profile.provider), model: short(v.profile.model), thinking: v.profile.thinking } });

/** Use this value as BOTH tool text JSON and details, so the persisted receipt proves
 * which exact report/labels were presented. No full prompts/profiles or 512-point dump. */
export function boundedComparisonResponse(response: ComparisonResponse, request?: ComparisonRequest) {
  const { limit, offset } = page(request), r = response.report, section = request?.section ?? "summary";
  if (!SECTIONS.includes(section)) throw fail("invalid-section");
  const report = {
    version: r.version, fingerprint: r.fingerprint, recordFingerprint: r.recordFingerprint,
    experimentId: r.experimentId, batchId: r.batchId, revision: r.revision, definitionFingerprint: r.definitionFingerprint,
    state: r.state, mode: r.mode, budget: r.budget, totals: r.totals, timing: r.timing,
    variants: r.variants.map(variantView),
    perVariant: r.perVariant.map(({ cases: _cases, ...counts }) => counts),
    conditions: { ...r.conditions, configurationVariables: r.conditions.configurationVariables.map(({ field, values }) => ({ field, variantIds: values.map((v) => v.variantId), evidence: "完整值见保存报告；配置指纹见variants" })) },
    counts: { points: r.points.length, pairs: r.pairs.length, cases: r.cases.length, limitations: r.limitations.length, untested: r.untested.length },
    limitations: r.limitations, untested: r.untested,
  };
  let rows: unknown[] = [];
  switch (section) {
    case "points": rows = r.points.map((p) => ({ ...p, reason: short(p.reason), verification: { source: p.verification.source, count: p.verification.checks.length, passed: p.verification.checks.filter((c) => c.passed).length }, metrics: p.metrics.slice(0, 32).map((m) => ({ ...m, id: short(m.id), unit: short(m.unit) })), metricCount: p.metrics.length })); break;
    // A pair page is a page of metric summaries, not nested unbounded differences.
    case "pairs": rows = r.pairs.flatMap(({ series, ...pair }) => series.map(({ differences, excludedRepetitions, ...s }) => ({ ...pair, ...s, differenceCount: differences.length, excludedCount: excludedRepetitions.length }))); break;
    case "differences": rows = r.pairs.flatMap((p) => p.series.flatMap((s) => s.differences.map((d) => ({ leftVariant: p.leftVariant, rightVariant: p.rightVariant, caseId: p.caseId, metricId: s.metricId, unit: s.unit, source: s.source, operation: s.operation, ...d })))); break;
    case "statistics": rows = r.perVariant.flatMap((v) => v.cases.flatMap((c) => c.series.map(({ values: _values, ...s }) => ({ variantId: v.variantId, caseId: c.caseId, ...s })))); break;
    case "cases": rows = r.cases.map((c) => ({ id: c.id, title: short(c.title), checkCount: c.checks.length, expectedAnswerPresent: c.expectedAnswer !== undefined, metricsFile: c.metricsFile })); break;
    case "variants": rows = r.variants.map(variantView); break;
    case "limitations": rows = [...r.limitations, ...r.untested]; break;
    case "verified": rows = response.handoff?.verified.map((v) => ({ ...v, checks: v.checks.map((c) => ({ ...c, name: short(c.name), reason: c.reason ? short(c.reason) : undefined })) })) ?? []; break;
    case "unverified": rows = response.handoff?.unverified ?? []; break;
  }
  const handoff = response.handoff && (() => { const { verified, unverified, ...rest } = response.handoff; return { ...rest, verifiedCount: verified.length, unverifiedCount: unverified.length }; })();
  return { version: response.version, action: response.action, ...(response.requestId ? { requestId: response.requestId } : {}), report, evidence: response.evidence, ...(response.reportPath ? { reportPath: response.reportPath } : {}), ...(handoff ? { handoff } : {}), ...(section !== "summary" ? { section, items: rows.slice(offset, offset + limit), page: { limit, offset, returned: rows.slice(offset, offset + limit).length, total: rows.length } } : {}) };
}

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function displayed(entry: SessionEntry, report: ComparisonReport): boolean {
  if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "experiment" || entry.message.isError !== false) return false;
  if (!entry.message.content.some((c) => c.type === "text" && c.text.trim())) return false;
  const details = object(entry.message.details), saved = object(details?.report);
  if (details?.version !== 1 || details.action !== "batch_report" || !saved || saved.fingerprint !== report.fingerprint || saved.experimentId !== report.experimentId || saved.batchId !== report.batchId || saved.revision !== report.revision || saved.definitionFingerprint !== report.definitionFingerprint || !Array.isArray(saved.variants)) return false;
  return saved.variants.length === report.variants.length && report.variants.every((v, i) => {
    const shown = object((saved.variants as unknown[])[i]);
    return shown?.id === v.id && shown.label === v.label && shown.revision === v.revision && shown.fingerprint === v.fingerprint && shown.profileFingerprint === v.profileFingerprint;
  });
}

/** Installed SDK docs/session-format.md + dist/core/session-manager.d.ts:
 * getBranch() is root-to-current-leaf raw entries (NOT context-converted custom
 * notifications). Read only; never accept a model-authored userText/source callback. */
function userBinding(ctx: ComparisonContext | undefined, report: ComparisonReport, requestedId?: string) {
  try {
    const sm = ctx?.sessionManager;
    if (!sm || typeof sm.getBranch !== "function" || typeof sm.getSessionId !== "function") return undefined;
    const entries = sm.getBranch(), sessionId = sm.getSessionId();
    if (!sessionId || !Array.isArray(entries)) return undefined;
    const users = entries.filter((e) => e.type === "message" && e.message.role === "user");
    const selected = requestedId ? users.find((e) => e.id === requestedId) : users.at(-1);
    if (!selected || selected.type !== "message" || selected.message.role !== "user") return undefined;
    // An older affirmative choice cannot override a newer user refusal/request.
    if (selected !== users.at(-1)) return undefined;
    const before = entries.slice(0, entries.indexOf(selected));
    // Search before the choice, not before the latest report re-query: repeating
    // the same report after a legitimate choice must not invalidate that choice.
    if (!before.some((e) => displayed(e, report))) return undefined;
    // If a newer version of this batch was shown before the choice, its labels
    // supersede the old report. Unrelated batch reports do not revoke the binding.
    const latest = before.filter((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "experiment" && e.message.isError === false && object(e.message.details)?.action === "batch_report" && object(object(e.message.details)?.report)?.experimentId === report.experimentId && object(object(e.message.details)?.report)?.batchId === report.batchId).at(-1);
    if (!latest || !displayed(latest, report)) return undefined;
    const content = selected.message.content;
    if (Array.isArray(content) && content.some((c) => c.type !== "text")) return undefined;
    const text = typeof content === "string" ? content : content.map((c) => c.type === "text" ? c.text : "").join("\n");
    // The core also uses a strict full-message grammar; no stripping quotation,
    // notification wrappers, negation or page excerpts before that check.
    return { entryId: selected.id, sessionId, role: "user" as const, text, reportFingerprint: report.fingerprint };
  } catch { return undefined; } // Missing/stale SDK context means draft, never fake authority.
}

export class ComparisonController {
  constructor(private readonly projectRoot: string, private readonly ports: { batches: () => Promise<Pick<BatchCoordinator, "read">>; variants: Pick<VariantStore, "read"> }) {}
  async execute(request: ComparisonRequest, ctx?: ComparisonContext): Promise<ComparisonResponse> {
    if (request.version !== undefined && request.version !== 1) throw fail("invalid-version");
    if (!COMPARISON_ACTIONS.has(request.action)) throw fail("unsupported-action");
    page(request);
    if (request.section !== undefined && !SECTIONS.includes(request.section)) throw fail("invalid-section");
    const exp = semanticId(request.experimentId), batchId = semanticId(request.batchId);
    if (request.variantId !== undefined) semanticId(request.variantId);
    if (request.revision !== undefined && (!Number.isSafeInteger(request.revision) || request.revision < 1)) throw fail("invalid-revision");
    const batch = await (await this.ports.batches()).read(exp, batchId);
    if (batch.experimentId !== exp || batch.id !== batchId) throw fail("comparison-record-mismatch");
    const frozenVariants = [], evidence: ComparisonResponse["evidence"] = { batchPath: `.pi/agent/experiments/${exp}/batches/${batchId}/batch.json`, recordFingerprint: "", frozenVariants: [] };
    for (const v of batch.variants) {
      try {
        const frozen = await this.ports.variants.read(exp, v.id, batch.revision);
        const matched = frozen.experimentId === exp && frozen.id === v.id && frozen.revision === batch.revision && frozen.fingerprint === v.fingerprint;
        if (matched) frozenVariants.push(frozen);
        evidence.frozenVariants.push({ variantId: v.id, revision: batch.revision, fingerprint: matched ? frozen.fingerprint : null, status: matched ? "matched" : "mismatch" });
      } catch { evidence.frozenVariants.push({ variantId: v.id, revision: batch.revision, fingerprint: null, status: "unavailable" }); }
    }
    const report = buildComparisonReport(batch, { frozenVariants });
    evidence.recordFingerprint = report.recordFingerprint;
    const response: ComparisonResponse = { version: 1, action: request.action, ...(request.requestId ? { requestId: request.requestId } : {}), report, evidence };
    const revisionMatches = request.revision === undefined || request.revision === batch.revision;
    if (request.action === "batch_report" && !revisionMatches) throw fail("comparison-revision-mismatch");
    if (request.action === "adopt") {
      const entry = revisionMatches && evidence.frozenVariants.every((v) => v.status === "matched") ? userBinding(ctx, report, request.userEntryId) : undefined;
      const source = entry ? createTrustedUserMessageSource(async (entryId) => entry.entryId === entryId ? entry : null) : undefined;
      response.handoff = await buildImplementationHandoff(report, { reportFingerprint: request.reportFingerprint ?? report.fingerprint, userEntryId: entry?.entryId, suggestedVariantId: request.variantId }, source);
      if (!revisionMatches) response.handoff.reason = "comparison-revision-mismatch";
      else if (evidence.frozenVariants.some((v) => v.status !== "matched")) response.handoff.reason = "frozen-evidence-unavailable-or-mismatched";
    }
    if (request.saveReport) {
      const root = await realpath(this.projectRoot);
      response.reportPath = `.pi/agent/experiments/${exp}/reports/${batchId}/${report.fingerprint}.json`;
      const path = join(root, response.reportPath);
      await immutableJson(root, path, report, 32 * 1024 * 1024);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { if (!(await handle.stat()).isFile()) throw fail("unsafe-path"); await handle.chmod(0o444); }
      finally { await handle.close(); }
    }
    return response;
  }
}
