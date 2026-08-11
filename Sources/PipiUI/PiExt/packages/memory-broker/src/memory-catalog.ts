import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, truncate, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  MemoryCatalogSnapshot, MemoryLifecycleEvent, MemoryRecordDraft, MemoryRecordStatus, MemoryRecordV2,
} from "#memory-broker-contract";
import { MEMORY_RECORD_V2_VERSION } from "#memory-broker-contract";

const LOG = "pipiui-memory-catalog-v2.jsonl";
const SNAPSHOT = "pipiui-memory-catalog-v2.json";
const IMPORT_MARKERS = "pipiui-memory-catalog-v2-imports.json";
const V1_QUEUE = "pipiui-memory-broker-experience-v1.jsonl";
const statuses: readonly MemoryRecordStatus[] = ["candidate", "active", "superseded", "stale", "rejected", "deleted"];
const transitions: Record<MemoryRecordStatus, readonly MemoryRecordStatus[]> = {
  candidate: ["active", "rejected", "deleted", "stale"], active: ["superseded", "stale", "deleted"],
  superseded: ["deleted"], stale: ["active", "deleted", "rejected"], rejected: ["candidate", "deleted"], deleted: [],
};

export interface HermesCatalogPort { add(record: MemoryRecordV2): Promise<{ id: string } | void>; verify(record: MemoryRecordV2, hermesID?: string): Promise<boolean>; }
export class MemoryCatalogError extends Error { constructor(message: string) { super(message); this.name = "MemoryCatalogError"; } }
function canonicalText(value: string): string { return value.normalize("NFC").replace(/\s+/gu, " ").trim(); }
function scopeKey(scope: MemoryRecordV2["scope"]): string {
  if (!scope || (scope.kind !== "project" && scope.kind !== "app") || !canonicalText(scope.project) || (scope.kind === "app" && !canonicalText(scope.app ?? ""))) throw new MemoryCatalogError("Catalog scope must be canonical project or project/app; global scope is forbidden.");
  return `${scope.kind}:${canonicalText(scope.project)}${scope.kind === "app" ? `:${canonicalText(scope.app!)}` : ""}`;
}
function hash(kind: string, claim: string, scope: MemoryRecordV2["scope"]): string { return createHash("sha256").update(`${kind}\u001f${scopeKey(scope)}\u001f${canonicalText(claim)}`, "utf8").digest("hex"); }
function validRecord(value: unknown): value is MemoryRecordV2 {
  const r = value as Partial<MemoryRecordV2>; return !!r && r.version === 2 && typeof r.id === "string" && typeof r.contentHash === "string" && statuses.includes(r.status as MemoryRecordStatus) && !!r.scope && (() => { try { scopeKey(r.scope!); return true; } catch { return false; } })();
}

/** Main-process-only, host-neutral durable catalog. Construct it only in the Pi main extension. */
export class MemoryCatalog {
  private readonly directory: string; private readonly logPath: string; private readonly snapshotPath: string; private readonly markerPath: string;
  private records = new Map<string, MemoryRecordV2>(); private events: MemoryLifecycleEvent[] = []; private sequence = 0; private chain = Promise.resolve();
  private constructor(directory: string) { this.directory = resolve(directory); this.logPath = join(this.directory, LOG); this.snapshotPath = join(this.directory, SNAPSHOT); this.markerPath = join(this.directory, IMPORT_MARKERS); }
  static async open(memoryDir: string): Promise<MemoryCatalog> { const catalog = new MemoryCatalog(memoryDir); await catalog.initialize(); return catalog; }
  private async serialized<T>(action: () => Promise<T>): Promise<T> { const next = this.chain.then(action, action); this.chain = next.then(() => undefined, () => undefined); return next; }
  private async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700).catch(() => {}); await this.loadSnapshot(); await this.replay(); await this.writeSnapshot(); }
  private async loadSnapshot(): Promise<void> { try { const raw = JSON.parse(await readFile(this.snapshotPath, "utf8")) as MemoryCatalogSnapshot; if (raw.version !== 2 || !Array.isArray(raw.records) || !raw.records.every(validRecord)) throw new MemoryCatalogError("Catalog snapshot is invalid."); this.sequence = raw.sequence; this.records = new Map(raw.records.map((r) => [r.id, r])); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") { this.records.clear(); this.sequence = 0; } } }
  private apply(event: MemoryLifecycleEvent): void { if (event.version !== 2 || !Number.isSafeInteger(event.sequence) || !validRecord(event.record)) throw new MemoryCatalogError("Catalog event is invalid."); this.records.set(event.record.id, event.record); this.events.push(structuredClone(event)); this.sequence = Math.max(this.sequence, event.sequence); }
  private async replay(): Promise<void> {
    let raw: string; try { raw = await readFile(this.logPath, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    const lines = raw.split("\n"); const lastContent = lines.reduce((last, line, index) => line ? index : last, -1); let offset = 0;
    for (let i = 0; i < lines.length; i++) { const line = lines[i]; const bytes = Buffer.byteLength(line + (i < lines.length - 1 ? "\n" : ""), "utf8"); if (!line) { offset += bytes; continue; }
      try { this.apply(JSON.parse(line) as MemoryLifecycleEvent); } catch (error) { if (i === lastContent) { await truncate(this.logPath, offset); return; } throw new MemoryCatalogError(`Catalog event log corruption at line ${i + 1}: ${(error as Error).message}`); } offset += bytes;
    }
  }
  private async append(event: MemoryLifecycleEvent): Promise<void> { const handle = await open(this.logPath, "a", 0o600); try { await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); } await chmod(this.logPath, 0o600).catch(() => {}); }
  private async writeSnapshot(): Promise<void> { const payload: MemoryCatalogSnapshot = { version: 2, sequence: this.sequence, records: [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id)) }; const tmp = `${this.snapshotPath}.${process.pid}.${Date.now()}.tmp`; const handle = await open(tmp, "wx", 0o600); try { await handle.writeFile(`${JSON.stringify(payload)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); } try { await rename(tmp, this.snapshotPath); await chmod(this.snapshotPath, 0o600).catch(() => {}); } catch (e) { await unlink(tmp).catch(() => {}); throw e; } }
  private async persist(type: MemoryLifecycleEvent["type"], record: MemoryRecordV2): Promise<void> { const event: MemoryLifecycleEvent = { version: 2, sequence: this.sequence + 1, at: Date.now(), type, record }; await this.append(event); this.apply(event); await this.writeSnapshot(); }
  list(): MemoryRecordV2[] { return [...this.records.values()].map((r) => structuredClone(r)); }
  get(id: string): MemoryRecordV2 | undefined { const r = this.records.get(id); return r && structuredClone(r); }
  /** Sanitizing callers can render this append-only lifecycle trail without opening catalog files. */
  history(id: string): MemoryLifecycleEvent[] { return this.events.filter((event) => event.record.id === id).map((event) => structuredClone(event)); }
  async upsert(draft: MemoryRecordDraft): Promise<MemoryRecordV2> { return this.serialized(async () => { const now = Date.now(); const contentHash = hash(draft.kind, draft.claim, draft.scope); const existing = [...this.records.values()].find((r) => r.contentHash === contentHash);
    if (existing) { if (existing.status === "deleted") return structuredClone(existing); const sourceRuns = [...new Set([...existing.sourceRuns, ...(draft.sourceRuns ?? [])])].sort(); const evidence = [...existing.evidence, ...(draft.evidence ?? [])]; const provenance = [...existing.provenance, ...(draft.provenance ?? [])]; const record = { ...existing, evidence, provenance, sourceRuns, lastSeenAt: now }; await this.persist("upsert", record); return structuredClone(record); }
    const claim = canonicalText(draft.claim); if (!claim) throw new MemoryCatalogError("Record claim is required."); const record: MemoryRecordV2 = { version: MEMORY_RECORD_V2_VERSION, id: `memv2_${randomUUID()}`, kind: draft.kind, claim, summary: canonicalText(draft.summary ?? claim), ...(draft.applicability ? { applicability: canonicalText(draft.applicability) } : {}), scope: { kind: draft.scope.kind, project: canonicalText(draft.scope.project), ...(draft.scope.kind === "app" ? { app: canonicalText(draft.scope.app!) } : {}) }, evidence: draft.evidence ?? [], provenance: draft.provenance ?? [], confidence: Math.max(0, Math.min(1, draft.confidence ?? 0.5)), firstSeenAt: now, lastSeenAt: now, ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}), status: "candidate", contentHash, usage: { reads: 0, helpful: 0 }, sourceRuns: [...new Set(draft.sourceRuns ?? [])].sort() }; await this.persist("upsert", record); return structuredClone(record); }); }
  async transition(id: string, status: MemoryRecordStatus): Promise<MemoryRecordV2> { return this.serialized(async () => { const old = this.records.get(id); if (!old) throw new MemoryCatalogError("Record not found."); if (!transitions[old.status].includes(status)) throw new MemoryCatalogError(`Illegal lifecycle transition ${old.status} -> ${status}.`); const record = { ...old, status, ...(status === "active" ? { lastVerifiedAt: Date.now() } : {}) }; await this.persist("status", record); return structuredClone(record); }); }
  /** Merge preserves source evidence and leaves an auditable rejected source record. */
  async merge(sourceID: string, targetID: string): Promise<MemoryRecordV2> { return this.serialized(async () => { const source = this.records.get(sourceID); const target = this.records.get(targetID); if (!source || !target || source.status !== "candidate" || target.status === "deleted") throw new MemoryCatalogError("Invalid merge records."); const merged = { ...target, evidence: [...target.evidence, ...source.evidence], provenance: [...target.provenance, ...source.provenance], sourceRuns: [...new Set([...target.sourceRuns, ...source.sourceRuns])].sort(), lastSeenAt: Date.now() }; await this.persist("merge", merged); await this.persist("merge", { ...source, status: "rejected" }); return structuredClone(merged); }); }
  /** Both records remain durable; only an already verified successor can supersede an active prior record. */
  async supersede(successorID: string, priorID: string): Promise<void> { return this.serialized(async () => { const successor = this.records.get(successorID); const prior = this.records.get(priorID); if (!successor || !prior || successor.status !== "active" || prior.status !== "active") throw new MemoryCatalogError("Supersession requires two active records."); await this.persist("supersede", { ...successor, supersedes: [...new Set([...(successor.supersedes ?? []), prior.id])] }); await this.persist("supersede", { ...prior, status: "superseded", supersededBy: successor.id }); }); }
  async promote(id: string, hermes: HermesCatalogPort): Promise<MemoryRecordV2> { return this.serialized(async () => { const old = this.records.get(id); if (!old || old.status !== "candidate") throw new MemoryCatalogError("Only candidate records can be promoted."); const pending = { ...old, pendingPromotion: true }; await this.persist("promotion-pending", pending); try { const added = await hermes.add(pending); const mapped = { ...pending, pendingPromotion: false, ...(added?.id ? { hermesID: added.id } : {}) }; await this.persist("hermes-mapped", mapped); if (!await hermes.verify(mapped, mapped.hermesID)) return structuredClone(mapped); const active = { ...mapped, status: "active" as const, lastVerifiedAt: Date.now() }; await this.persist("status", active); return structuredClone(active); } catch { return structuredClone(this.records.get(id)!); } }); }
  async revalidate(id: string, hermes: HermesCatalogPort): Promise<MemoryRecordV2> { return this.serialized(async () => { const record = this.records.get(id); if (!record || record.status !== "active") throw new MemoryCatalogError("Only active records can be revalidated."); if (!await hermes.verify(record, record.hermesID)) throw new MemoryCatalogError("Memory record could not be revalidated."); const verified = { ...record, lastVerifiedAt: Date.now() }; await this.persist("usage", verified); return structuredClone(verified); }); }
  async reconcile(hermes: HermesCatalogPort): Promise<void> { for (const record of this.list()) { if (record.status !== "candidate") continue; if (record.hermesID) { await this.serialized(async () => { const current = this.records.get(record.id)!; if (current.status === "candidate" && current.hermesID && await hermes.verify(current, current.hermesID)) await this.persist("status", { ...current, pendingPromotion: false, status: "active", lastVerifiedAt: Date.now() }); }); } else if (record.pendingPromotion) await this.promote(record.id, hermes); } }
  async importV1(): Promise<number> { let raw: string; try { raw = await readFile(join(this.directory, V1_QUEUE), "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0; throw e; } const sourceHash = createHash("sha256").update(raw, "utf8").digest("hex"); let markers: string[] = []; try { markers = JSON.parse(await readFile(this.markerPath, "utf8")) as string[]; } catch {} if (markers.includes(sourceHash)) return 0; let imported = 0; for (const line of raw.split("\n").filter(Boolean)) { const value = JSON.parse(line) as { candidate?: { claim?: string; sourceRuns?: string[]; evidence?: unknown[] }; projectRoot?: string; reason?: string }; const c = value.candidate; if (!c?.claim || !value.projectRoot) continue; await this.upsert({ kind: "episodic", claim: c.claim, scope: { kind: "project", project: value.projectRoot }, evidence: (c.evidence ?? []) as MemoryRecordV2["evidence"], provenance: [{ source: "experience-v1", importedFrom: V1_QUEUE, reason: value.reason ?? "queued" }], sourceRuns: c.sourceRuns ?? ["experience-v1"] }); imported++; } markers.push(sourceHash); const tmp = `${this.markerPath}.${process.pid}.tmp`; await mkdir(dirname(this.markerPath), { recursive: true, mode: 0o700 }); const h = await open(tmp, "wx", 0o600); try { await h.writeFile(JSON.stringify(markers), "utf8"); await h.sync(); } finally { await h.close(); } await rename(tmp, this.markerPath); return imported; }
  async permissions(): Promise<{ log?: number; snapshot?: number }> { const mode = async (p: string) => { try { return (await stat(p)).mode & 0o777; } catch { return undefined; } }; return { log: await mode(this.logPath), snapshot: await mode(this.snapshotPath) }; }
}

/** Explicit main-only entry point. The host supplies its broker state or Hermes memory directory; no checkout path is assumed. */
export async function openMainMemoryCatalog(options: { mode: "main" | "worker" | "operator"; memoryDir: string }): Promise<MemoryCatalog> {
  if (options.mode !== "main") throw new MemoryCatalogError("Memory Catalog durable writes are main-only.");
  const catalog = await MemoryCatalog.open(options.memoryDir);
  await catalog.importV1();
  return catalog;
}
