import { containsLikelySecret, type MemoryExperienceCandidate, type MemoryRecordKind, type MemoryRecordV2 } from "#memory-broker-contract";
import { MemoryCatalog, type HermesCatalogPort } from "./memory-catalog.ts";
import type { MemoryRuntimeMetricsCollector } from "./runtime-metrics.ts";

/** Curator is deliberately a Pi-main service: child packages only submit quarantined candidates. */
export type CuratorMode = "main" | "worker" | "operator";
export type CuratorDecision = "keep_candidate" | "promote" | "merge" | "supersede" | "stale" | "reject" | "delete";
export type CuratorReview = { decision: CuratorDecision; kind: MemoryRecordKind; claim: string; applicability?: string; confidence: number; reason: string; evidenceRefs: string[]; targetID?: string };
export type CuratorAudit = { at: number; candidateID: string; decision: CuratorDecision; reason: string; evidenceRefs: string[] };
export interface CuratorReviewer { review(input: Readonly<{ candidate: MemoryRecordV2; related: readonly MemoryRecordV2[] }>): Promise<unknown>; }
export interface CuratorOptions { mode: CuratorMode; catalog: MemoryCatalog; hermes: HermesCatalogPort; reviewer: CuratorReviewer; timeoutMs?: number; batchSize?: number; metrics?: MemoryRuntimeMetricsCollector; }

const decisions = new Set<CuratorDecision>(["keep_candidate", "promote", "merge", "supersede", "stale", "reject", "delete"]);
const maxBatch = 10;
const redacted = "[redacted]";
function safeText(value: unknown, maximum = 900): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000\r\n]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum);
  return text && !containsLikelySecret(text) ? text : undefined;
}
function reviewFrom(value: unknown): CuratorReview | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const x = value as Record<string, unknown>; const decision = x.decision;
  const kind = x.kind;
  const claim = safeText(x.claim, 1800); const reason = safeText(x.reason); const applicability = x.applicability === undefined ? undefined : safeText(x.applicability);
  const confidence = x.confidence;
  const evidenceRefs = Array.isArray(x.evidenceRefs) ? x.evidenceRefs.map((v) => safeText(v, 128)).filter((v): v is string => !!v).slice(0, 8) : [];
  const targetID = x.targetID === undefined ? undefined : safeText(x.targetID, 160);
  if (!decisions.has(decision as CuratorDecision) || !["semantic", "episodic", "procedural"].includes(kind as string) || !claim || !reason || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || evidenceRefs.length === 0) return undefined;
  return { decision: decision as CuratorDecision, kind: kind as MemoryRecordKind, claim, ...(applicability ? { applicability } : {}), confidence, reason, evidenceRefs, ...(targetID ? { targetID } : {}) };
}
function evidenceText(record: MemoryRecordV2): string { return record.evidence.map((e) => e.summary).join(" "); }
function hasComputer(record: MemoryRecordV2): boolean { return record.evidence.some((e) => !!e.computer); }
function candidateEligible(record: MemoryRecordV2): string | undefined {
  if (record.status !== "candidate" || record.pendingPromotion || !record.claim || !record.scope?.project || !record.sourceRuns.length || !record.contentHash || record.evidence.length === 0) return "candidate schema/scope/source/evidence is incomplete";
  if (containsLikelySecret(record.claim) || record.evidence.some((e) => containsLikelySecret(e.summary))) return "candidate contains sensitive text";
  if (hasComputer(record)) return "Computer candidates are never automatically durable";
  if (record.kind === "procedural") {
    const evidence = evidenceText(record).toLowerCase();
    const verified = record.sourceRuns.filter((run) => run.startsWith("verified:")).length;
    if (!(/conditions?/u.test(evidence) && /steps?/u.test(evidence) && /pitfalls?/u.test(evidence) && /verification/u.test(evidence)) || verified < 2) return "procedural memory needs two independent verified successes and conditions/steps/pitfalls/verification";
  }
  if (/failure/u.test(record.kind) || record.provenance.some((p) => p.reason === "failure")) {
    const evidence = evidenceText(record).toLowerCase();
    if (!(/symptom/u.test(evidence) && /root cause/u.test(evidence) && /alternative/u.test(evidence))) return "failure memory needs symptom, root-cause evidence, and verified alternative";
  }
  return undefined;
}
function redact(reason: string): string { return containsLikelySecret(reason) ? redacted : reason.slice(0, 900); }

/** Fail-closed two-stage curator. It has no network behavior and only its caller may schedule it. */
export class MemoryCurator {
  private readonly timeoutMs: number; private readonly batchSize: number; private readonly audits: CuratorAudit[] = [];
  private readonly catalog: MemoryCatalog; private readonly hermes: HermesCatalogPort; private readonly reviewer: CuratorReviewer; private readonly metrics: MemoryRuntimeMetricsCollector | undefined;
  private constructor(catalog: MemoryCatalog, hermes: HermesCatalogPort, reviewer: CuratorReviewer, options: CuratorOptions) { this.catalog = catalog; this.hermes = hermes; this.reviewer = reviewer; this.timeoutMs = Math.max(1, options.timeoutMs ?? 5_000); this.metrics = options.metrics; this.batchSize = Math.min(maxBatch, Math.max(1, options.batchSize ?? maxBatch)); }
  static create(options: CuratorOptions): MemoryCurator | undefined { return options.mode === "main" ? new MemoryCurator(options.catalog, options.hermes, options.reviewer, options) : undefined; }
  auditView(): readonly CuratorAudit[] { return this.audits.map((a) => ({ ...a, reason: redact(a.reason), evidenceRefs: [...a.evidenceRefs] })); }
  async reconcile(): Promise<void> { await this.catalog.reconcile(this.hermes); }
  /** Fail-soft by design: timeout/reviewer/catalog errors leave candidate pending and do not block Pi lifecycle hooks. */
  async runBatch(): Promise<void> {
    const candidates = this.catalog.list().filter((r) => r.status === "candidate" && !r.pendingPromotion).slice(0, this.batchSize);
    for (const candidate of candidates) { try { await this.curate(candidate); } catch { /* candidate remains safely pending */ } }
  }
  private async curate(candidate: MemoryRecordV2): Promise<void> {
    const rejected = candidateEligible(candidate);
    if (rejected) return this.audit(candidate, "keep_candidate", rejected, []);
    const related = this.catalog.list().filter((r) => r.id !== candidate.id && r.scope.project === candidate.scope.project && r.status !== "deleted");
    const reviewed = reviewFrom(await Promise.race([this.reviewer.review({ candidate: structuredClone(candidate), related: structuredClone(related) }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("review timeout")), this.timeoutMs))]));
    if (!reviewed) return this.audit(candidate, "keep_candidate", "review schema invalid or unavailable", []);
    if (hasComputer(candidate) || containsLikelySecret(reviewed.claim) || containsLikelySecret(reviewed.reason)) return this.audit(candidate, "keep_candidate", "review failed safety scan", []);
    if (reviewed.decision === "promote") await this.catalog.promote(candidate.id, this.hermes);
    else if (reviewed.decision === "merge" && reviewed.targetID) await this.catalog.merge(candidate.id, reviewed.targetID);
    else if (reviewed.decision === "supersede" && reviewed.targetID) { const promoted = await this.catalog.promote(candidate.id, this.hermes); if (promoted.status === "active") await this.catalog.supersede(candidate.id, reviewed.targetID); }
    else if (reviewed.decision === "stale" || reviewed.decision === "reject" || reviewed.decision === "delete") await this.catalog.transition(candidate.id, reviewed.decision === "delete" ? "deleted" : reviewed.decision === "reject" ? "rejected" : "stale");
    this.audit(candidate, reviewed.decision, reviewed.reason, reviewed.evidenceRefs);
  }
  private audit(record: MemoryRecordV2, decision: CuratorDecision, reason: string, evidenceRefs: string[]): void { this.metrics?.record({ candidate: 1, promotion: decision === "promote" ? 1 : 0, reject: decision === "reject" ? 1 : 0, supersede: decision === "supersede" ? 1 : 0, stale: decision === "stale" ? 1 : 0, "delete": decision === "delete" ? 1 : 0 }); this.audits.push({ at: Date.now(), candidateID: record.id, decision, reason: redact(reason), evidenceRefs: evidenceRefs.filter((x) => !containsLikelySecret(x)).slice(0, 8) }); if (this.audits.length > 200) this.audits.shift(); }
}

/** Main lifecycle adapter: explicit idle/session-end calls are non-blocking; no compaction writer is registered. */
export class MemoryCuratorScheduler {
  private queued = 0; private running = false; private readonly curator: MemoryCurator; private readonly catalog: MemoryCatalog; private readonly threshold: number;
  constructor(curator: MemoryCurator, catalog: MemoryCatalog, threshold = maxBatch) { this.curator = curator; this.catalog = catalog; this.threshold = threshold; }
  async submit(candidate: MemoryExperienceCandidate, project: string): Promise<void> { const draft = catalogDraftFromCandidate(candidate, project); if (!draft) return; await this.catalog.upsert(draft); this.queued++; if (this.queued >= Math.min(maxBatch, Math.max(1, this.threshold))) this.failSoft(); }
  onIdle(): void { this.failSoft(); }
  onSessionEnd(): void { this.failSoft(); }
  private failSoft(): void { if (this.running) return; this.running = true; void this.curator.runBatch().catch(() => {}).finally(() => { this.queued = 0; this.running = false; }); }
}

/** Explicit safe adapter seam for existing candidate sources; it strips typed text/secrets before catalog admission. */
export function catalogDraftFromCandidate(candidate: MemoryExperienceCandidate, project: string): { kind: MemoryRecordKind; claim: string; scope: { kind: "project"; project: string }; evidence: { summary: string }[]; sourceRuns: string[] } | undefined {
  if (!project || candidate.kind === "computer" || containsLikelySecret(candidate.claim) || candidate.evidence.some((e) => containsLikelySecret(e.summary))) return undefined;
  const evidence = candidate.evidence.map((e) => safeText(e.summary)).filter((e): e is string => !!e).map((summary) => ({ summary }));
  if (!evidence.length || !candidate.sourceRuns.length) return undefined;
  return { kind: candidate.claimKind === "failure" ? "episodic" : "semantic", claim: candidate.claim, scope: { kind: "project", project }, evidence, sourceRuns: [...new Set(candidate.sourceRuns)].sort() };
}
