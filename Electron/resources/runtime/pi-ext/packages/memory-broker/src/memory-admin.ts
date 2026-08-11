import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { containsLikelySecret, type MemoryRecordStatus, type MemoryRecordV2 } from "#memory-broker-contract";
import type { HermesCatalogPort, MemoryCatalog } from "./memory-catalog.ts";

export const MEMORY_ADMIN_API_VERSION = "v1" as const;
export const MEMORY_ADMIN_PATH = "/v1/memory-admin" as const;
const TTL_MS = 5 * 60_000;
const MAX_BODY = 24_000;
const RECORD_STATUSES: readonly MemoryRecordStatus[] = ["active", "candidate", "stale", "superseded", "rejected", "deleted"];
const RAW = /(?:https?:\/\/|screenshot|accessibility tree|\bAX[A-Z_]*\b|coordinates?|foregroundapp|window title|typed text|transcript)/iu;

type Metrics = { query: { triggered: number; skipped: number; abstain: number; resultCount: number; latency: number }; candidate: number; promotion: number; reject: number };
export type MemoryAdminDescriptor = { version: typeof MEMORY_ADMIN_API_VERSION; origin: string; path: string; bootstrapFragment: string; expiresAt: number };
export type MemoryAdminResult = { status: number; body: unknown; headers?: Record<string, string> };
type Session = { token: string; csrf: string; expiresAt: number; revoked: boolean };

function safe(value: unknown, limit = 800): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000\r\n]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit);
  return text && !containsLikelySecret(text) && !RAW.test(text) ? text : undefined;
}
function same(a: string, b: string): boolean { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function page(value: string | null): number { const n = Number(value ?? "1"); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 10_000) : 1; }
function limit(value: string | null): number { const n = Number(value ?? "30"); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100) : 30; }
function dto(record: MemoryRecordV2) {
  return { version: 1, id: record.id, kind: record.kind, claim: safe(record.claim, 1800) ?? "[redacted]", summary: safe(record.summary, 900) ?? "[redacted]", applicability: safe(record.applicability, 400), scope: { kind: record.scope.kind, project: safe(record.scope.project, 300) ?? "[redacted]", ...(record.scope.app ? { app: safe(record.scope.app, 300) ?? "[redacted]" } : {}) }, confidence: record.confidence, status: record.status, firstSeenAt: record.firstSeenAt, lastSeenAt: record.lastSeenAt, lastVerifiedAt: record.lastVerifiedAt, expiresAt: record.expiresAt, pendingPromotion: !!record.pendingPromotion, supersedes: record.supersedes ?? [], supersededBy: record.supersededBy };
}
function evidence(record: MemoryRecordV2) { return record.evidence.map((e, index) => ({ id: `${record.id}:${index}`, summary: safe(e.summary, 700) ?? "[redacted]", observedAt: e.observedAt, sourceRun: safe(e.sourceRun, 160) })).slice(0, 24); }

/** Main-only domain and loopback admin policy. No worker/operator construction path exists. */
export class MemoryAdminService {
  private session: Session | undefined;
  private readonly metrics: Metrics = { query: { triggered: 0, skipped: 0, abstain: 0, resultCount: 0, latency: 0 }, candidate: 0, promotion: 0, reject: 0 };
  private readonly catalog: MemoryCatalog;
  private readonly hermes: HermesCatalogPort | undefined;
  private readonly assetRoot: string;
  private readonly backendStatus: () => Promise<{ ready: boolean; detail?: string }>;
  constructor(catalog: MemoryCatalog, hermes: HermesCatalogPort | undefined, assetRoot: string, backendStatus: () => Promise<{ ready: boolean; detail?: string }>) { this.catalog = catalog; this.hermes = hermes; this.assetRoot = assetRoot; this.backendStatus = backendStatus; }
  issueAdminSession(origin: string): MemoryAdminDescriptor {
    const session = { token: randomBytes(32).toString("base64url"), csrf: randomBytes(24).toString("base64url"), expiresAt: Date.now() + TTL_MS, revoked: false };
    this.session = session; // single in-memory session; issuing again revokes the prior grant.
    return { version: MEMORY_ADMIN_API_VERSION, origin, path: "/memory-center/", bootstrapFragment: `#admin=${session.token}&csrf=${session.csrf}`, expiresAt: session.expiresAt };
  }
  revokeAdminSession(): void { if (this.session) this.session.revoked = true; }
  /** Bare Pi command adapter: deliberately delegates to the same list/detail/mutation domain. */
  async executeCommand(args: string): Promise<unknown> {
    const [verb = "list", ...parts] = args.trim().split(/\s+/u).filter(Boolean);
    if (verb === "list") return this.list(new URLSearchParams(parts.join("&")));
    const [id = "", ...rest] = parts;
    if (verb === "show") return this.detail(id);
    if (["promote", "reject", "mark-stale", "revalidate"].includes(verb)) return this.mutate(id, verb, {});
    if (verb === "delete") return this.mutate(id, verb, { confirm: rest[0] });
    if (verb === "edit") return this.mutate(id, verb, { claim: rest.join(" ") });
    throw new Error("usage: /memory list [status=active] | show <id> | promote|reject|mark-stale|revalidate <id> | edit <id> <claim> | delete <id> delete");
  }
  noteRetrieval(telemetry: { triggered: boolean; skipped: boolean; abstained: boolean; resultCount: number; latencyMs: number }): void { this.metrics.query.triggered += Number(telemetry.triggered); this.metrics.query.skipped += Number(telemetry.skipped); this.metrics.query.abstain += Number(telemetry.abstained); this.metrics.query.resultCount += Math.max(0, telemetry.resultCount); this.metrics.query.latency += Math.max(0, telemetry.latencyMs); }
  async handle(method: string, path: string, query: URLSearchParams, headers: Record<string, string | string[] | undefined>, body: unknown, origin: string): Promise<MemoryAdminResult> {
    const base = MEMORY_ADMIN_PATH;
    if (method === "GET" && path.startsWith("/memory-center/")) return this.asset(path);
    if (!path.startsWith(base)) return { status: 404, body: { version: MEMORY_ADMIN_API_VERSION, error: "not-found" } };
    if (!this.authorized(method, headers, origin)) return { status: 403, body: { version: MEMORY_ADMIN_API_VERSION, error: "forbidden" } };
    const suffix = path.slice(base.length) || "/";
    try {
      if (method === "GET" && suffix === "/status") { const status = await this.backendStatus(); return { status: 200, body: { version: MEMORY_ADMIN_API_VERSION, status: { ready: status.ready, ...(safe(status.detail, 240) ? { detail: safe(status.detail, 240) } : {}) }, metrics: this.metrics } }; }
      if (method === "GET" && suffix === "/records") return { status: 200, body: this.list(query) };
      const match = /^\/records\/([^/]+)(?:\/(promote|reject|mark-stale|delete|revalidate|edit))?$/u.exec(suffix);
      if (match) {
        const id = decodeURIComponent(match[1]!); const action = match[2];
        if (!action && method === "GET") return { status: 200, body: this.detail(id) };
        if (action && method === "POST") return { status: 200, body: await this.mutate(id, action, body) };
      }
      return { status: 404, body: { version: MEMORY_ADMIN_API_VERSION, error: "not-found" } };
    } catch { return { status: 400, body: { version: MEMORY_ADMIN_API_VERSION, error: "invalid-request" } }; }
  }
  private authorized(method: string, headers: Record<string, string | string[] | undefined>, origin: string): boolean {
    const token = headers["x-pipiui-memory-admin"];
    const csrf = headers["x-pipiui-memory-csrf"];
    const session = this.session;
    if (!session || session.revoked || Date.now() >= session.expiresAt || typeof token !== "string" || !same(session.token, token)) return false;
    if (method !== "GET" && (typeof csrf !== "string" || !same(session.csrf, csrf))) return false;
    return origin.length > 0;
  }
  private list(query: URLSearchParams) {
    const status = query.get("status"); if (status && !RECORD_STATUSES.includes(status as MemoryRecordStatus)) throw new Error("status");
    const project = safe(query.get("project"), 300); const app = safe(query.get("app"), 300); const kind = query.get("kind");
    let records = this.catalog.list().filter((r) => (!status || r.status === status) && (!project || r.scope.project === project) && (!app || r.scope.app === app) && (!kind || r.kind === kind));
    records = records.sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.id.localeCompare(b.id)); const size = limit(query.get("limit")); const current = page(query.get("page"));
    return { version: MEMORY_ADMIN_API_VERSION, page: current, limit: size, total: records.length, records: records.slice((current - 1) * size, current * size).map(dto) };
  }
  private detail(id: string) { const record = this.catalog.get(id); if (!record) throw new Error("missing"); return { version: MEMORY_ADMIN_API_VERSION, record: dto(record), evidence: evidence(record), audit: this.catalog.history(id).map((x) => ({ at: x.at, sequence: x.sequence, type: x.type, status: x.record.status })) }; }
  private async mutate(id: string, action: string, body: unknown) {
    const record = this.catalog.get(id); if (!record) throw new Error("missing"); const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    let result: MemoryRecordV2;
    if (action === "promote") { if (!this.hermes) throw new Error("offline"); result = await this.catalog.promote(id, this.hermes); this.metrics.promotion++; }
    else if (action === "reject") { result = await this.catalog.transition(id, "rejected"); this.metrics.reject++; }
    else if (action === "mark-stale") result = await this.catalog.transition(id, "stale");
    else if (action === "delete") { if (input.confirm !== "delete") throw new Error("confirmation"); result = await this.catalog.transition(id, "deleted"); }
    else if (action === "revalidate") { if (!this.hermes) throw new Error("offline"); result = await this.catalog.revalidate(id, this.hermes); }
    else if (action === "edit") {
      const claim = safe(input.claim, 1800); if (!claim) throw new Error("claim");
      const revised = await this.catalog.upsert({ kind: record.kind, claim, summary: safe(input.summary, 900) ?? claim, applicability: safe(input.applicability, 400), scope: record.scope, evidence: record.evidence, provenance: [...record.provenance, { source: "memory-center", reason: "versioned-edit" }], confidence: record.confidence, sourceRuns: record.sourceRuns });
      if (record.status === "active" && revised.id !== record.id) { if (!this.hermes) throw new Error("offline"); const promoted = await this.catalog.promote(revised.id, this.hermes); if (promoted.status === "active") await this.catalog.supersede(promoted.id, record.id); }
      result = this.catalog.get(revised.id)!;
    } else throw new Error("action");
    return { version: MEMORY_ADMIN_API_VERSION, record: dto(result) };
  }
  private async asset(path: string): Promise<MemoryAdminResult> {
    const relative = path === "/memory-center/" ? "index.html" : path.slice("/memory-center/".length);
    if (!/^[a-zA-Z0-9._-]+$/u.test(relative)) return { status: 404, body: "not found" };
    try { const file = await readFile(resolve(this.assetRoot, relative)); return { status: 200, body: file, headers: { "content-type": relative.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", "cache-control": "no-store" } }; } catch { return { status: 404, body: "not found" }; }
  }
}
export { MAX_BODY as MEMORY_ADMIN_MAX_BODY_BYTES };
