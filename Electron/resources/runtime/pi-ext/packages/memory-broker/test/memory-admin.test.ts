import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MemoryCatalog } from "../src/memory-catalog.ts";
import { MemoryAdminService } from "../src/memory-admin.ts";
import { MemoryBrokerServer } from "../src/server.ts";

const root = resolve(import.meta.dirname, "..");
const hermes = { add: async () => ({ id: "h" }), verify: async () => true };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pipiui-admin-")); const catalog = await MemoryCatalog.open(dir);
  const candidate = await catalog.upsert({ kind: "procedural", claim: "Build safely", summary: "safe summary", scope: { kind: "project", project: "/repo" }, evidence: [{ summary: "verified steps and conditions" }, { summary: "second verified success" }], sourceRuns: ["verified:a", "verified:b"] });
  const admin = new MemoryAdminService(catalog, hermes, join(root, "ui"), async () => ({ ready: true })); const server = new MemoryBrokerServer({ projectRoot: "/repo", adminService: admin }); const conn = await server.start(); const descriptor = server.issueAdminSession()!;
  const bootstrap = new URL(descriptor.url).hash.slice(1); const credentials = new URLSearchParams(bootstrap);
  const call = async (path: string, init: RequestInit = {}) => fetch(new URL(path, conn.url).origin + path, { ...init, headers: { "x-pipiui-memory-admin": credentials.get("admin")!, "x-pipiui-memory-csrf": credentials.get("csrf")!, ...(init.headers ?? {}) } });
  return { dir, catalog, candidate, admin, server, conn, descriptor, call };
}
test("admin is isolated from query token, loopback Host/Origin/CSRF guard, TTL revoke, and worker lacks routes", async () => { const f = await fixture(); try {
  assert.notEqual(f.descriptor.url.includes(f.conn.token), true); assert.equal(new URL(f.descriptor.url).origin, new URL(f.conn.url).origin);
  assert.equal((await f.call("/v1/memory-admin/status", { headers: { "x-pipiui-memory-admin": f.conn.token } })).status, 403);
  assert.equal((await f.call("/v1/memory-admin/status", { headers: { Origin: "http://evil.invalid" } })).status, 403);
  assert.equal((await f.call("/v1/memory-admin/records/" + f.candidate.id + "/reject", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status, 415);
  assert.equal((await f.call("/v1/memory-admin/records/" + f.candidate.id + "/reject", { method: "POST", headers: { "content-type": "application/json", "x-pipiui-memory-csrf": "bad" }, body: "{}" })).status, 403);
  f.server.revokeAdminSession(); assert.equal((await f.call("/v1/memory-admin/status")).status, 403);
  const worker = new MemoryBrokerServer({ projectRoot: "/repo" }); const wc = await worker.start(); assert.equal((await fetch(new URL("/v1/memory-admin/status", wc.url))).status, 404); await worker.close();
} finally { await f.server.close(); await rm(f.dir, { recursive: true }); } });
test("list/filter/page, lifecycle mutations, edit history, tombstones, DTO sanitization, command parity, assets and CSP", async () => { const f = await fixture(); try {
  const list = await f.call("/v1/memory-admin/records?status=candidate&page=1&limit=1"); const page = await list.json() as any; assert.equal(page.total, 1); assert.equal(page.records[0].id, f.candidate.id);
  const detail = await f.call("/v1/memory-admin/records/" + f.candidate.id); assert.equal((await detail.json() as any).evidence[0].summary.includes("transcript"), false);
  const promoted = await f.call("/v1/memory-admin/records/" + f.candidate.id + "/promote", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert.equal((await promoted.json() as any).record.status, "active");
  const edited = await f.call("/v1/memory-admin/records/" + f.candidate.id + "/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim: "Build safely revised" }) }); const revised = (await edited.json() as any).record; assert.notEqual(revised.id, f.candidate.id); assert.equal(f.catalog.get(f.candidate.id)?.status, "superseded");
  await f.call("/v1/memory-admin/records/" + revised.id + "/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "delete" }) }); assert.equal(f.catalog.get(revised.id)?.status, "deleted"); assert.equal((await f.catalog.upsert({ kind: "procedural", claim: "Build safely revised", scope: { kind: "project", project: "/repo" } })).status, "deleted");
  const command = await f.admin.executeCommand("list status=deleted") as any; assert.equal(command.records.length, 1);
  const asset = await f.call("/memory-center/"); assert.match(asset.headers.get("content-security-policy") ?? "", /connect-src 'self'/); assert.match(asset.headers.get("content-type") ?? "", /^text\/html/); assert.doesNotMatch(await asset.text(), /https?:\/\//);
  // Under `style-src 'self'` a stylesheet served as text/html is refused on MIME grounds.
  for (const [file, type] of [["memory-center.css", /^text\/css/], ["memory-center.js", /^application\/javascript/]] as const) { const served = await f.call("/memory-center/" + file); assert.equal(served.status, 200); assert.match(served.headers.get("content-type") ?? "", type); }
  assert.equal((await f.call("/memory-center/../src/server.ts")).status, 404);
} finally { await f.server.close(); await rm(f.dir, { recursive: true }); } });
