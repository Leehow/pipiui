import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeaseManager } from "../src/lease.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });
async function managers() {
  root = await mkdtemp(join(tmpdir(), "pipi-lease-"));
  const path = join(root, "session.jsonl");
  await writeFile(path, "{}\n");
  return [new LeaseManager({ sessionId: "session-1", sessionPath: path, heartbeatMs: 60_000 }), new LeaseManager({ sessionId: "session-1", sessionPath: path, heartbeatMs: 60_000 })] as const;
}
describe("LeaseManager", () => {
  it("exclusively grants one of two writers", async () => {
    const [first, second] = await managers();
    expect((await first.acquire()).writable).toBe(true);
    const blocked = await second.acquire();
    expect(blocked).toMatchObject({ writable: false, holder: { holder: "pipiui-electron" } });
    await first.release(); await second.release();
  });
  it("recovers an expired lease", async () => {
    const [first, second] = await managers();
    await first.acquire();
    await writeFile(first.leasePath, JSON.stringify({ protocolVersion: 1, holder: "pipiui-swift", pid: 1, hostname: "old", instanceId: "old", acquiredAt: "2026-01-01T00:00:00.000Z", heartbeatAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:01.000Z" }));
    expect((await second.acquire()).writable).toBe(true);
    expect((await first.heartbeat()).writable).toBe(false);
    expect(first.isOwned).toBe(false);
    await second.release();
  });
  it("reports no, expired, and self-held leases as writable", async () => {
    const [first] = await managers();
    expect(await first.query()).toMatchObject({ writable: true });
    await writeFile(first.leasePath, JSON.stringify({ protocolVersion: 1, holder: "old", pid: 1, hostname: "old", instanceId: "old", acquiredAt: "2026-01-01T00:00:00.000Z", heartbeatAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:01.000Z" }));
    expect(await first.query()).toMatchObject({ writable: true });
    expect((await first.acquire()).writable).toBe(true);
    expect((await first.query()).writable).toBe(true);
    await first.release();
  });
  it("force takeover replaces an active holder", async () => {
    const [first, second] = await managers();
    await first.acquire();
    expect((await second.forceTakeover()).writable).toBe(true);
    expect((await first.heartbeat()).writable).toBe(false);
    await second.release();
  });
  it("reclaims its own lease file after a lost in-memory owned flag", async () => {
    const [first] = await managers();
    expect((await first.acquire()).writable).toBe(true);
    (first as unknown as { owned: boolean }).owned = false;
    expect((await first.acquire()).writable).toBe(true);
    await first.release();
  });
  it("serializes concurrent acquire on the same manager so none lose to themselves", async () => {
    const [first] = await managers();
    const results = await Promise.all(Array.from({ length: 16 }, () => first.acquire()));
    expect(results.every((result) => result.writable)).toBe(true);
    await first.release();
  });
  it("reacquires when its heartbeat finds a missing lease", async () => {
    const [first] = await managers();
    await first.acquire();
    await rm(first.leasePath, { force: true });
    expect((await first.acquire()).writable).toBe(true);
    expect(first.isOwned).toBe(true);
    await first.release();
  });
  it("recovers a same-host lease whose holder pid is gone", async () => {
    const { hostname } = await import("node:os");
    const [first] = await managers();
    await writeFile(first.leasePath, JSON.stringify({
      protocolVersion: 1,
      holder: "pipiui-electron",
      pid: 999_999_999,
      hostname: hostname(),
      instanceId: "dead-process",
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    expect((await first.acquire()).writable).toBe(true);
    await first.release();
  });
  it("uses one exit hook for many leases and removes it after every release", async () => {
    const [first] = await managers();
    const sessionPath = join(root, "session.jsonl");
    const before = process.listenerCount("exit");
    const trackedHookCount = () => process.listeners("exit")
      .filter((listener) => listener.name === "releaseTrackedLeasesSync").length;
    const hooksBefore = trackedHookCount();
    const leases = [
      first,
      ...Array.from({ length: 24 }, (_, index) => new LeaseManager({
        sessionId: `session-${index + 2}`,
        sessionPath,
        heartbeatMs: 60_000,
      })),
    ];

    await Promise.all(leases.map((lease) => lease.acquire()));
    expect(trackedHookCount()).toBe(Math.max(hooksBefore, 1));
    expect(process.listenerCount("exit")).toBeLessThanOrEqual(before + 1);
    await Promise.all(leases.map((lease) => lease.release()));
    expect(trackedHookCount()).toBe(hooksBefore);
    expect(process.listenerCount("exit")).toBe(before);
    for (const lease of leases) {
      expect(lease.isOwned).toBe(false);
      expect((lease as unknown as { timer?: NodeJS.Timeout }).timer).toBeUndefined();
    }

    for (let index = 0; index < 12; index += 1) {
      const lease = new LeaseManager({
        sessionId: `sequential-${index}`,
        sessionPath,
        heartbeatMs: 60_000,
      });
      await lease.acquire();
      expect(trackedHookCount()).toBe(Math.max(hooksBefore, 1));
      await lease.release();
      expect(trackedHookCount()).toBe(hooksBefore);
      expect(process.listenerCount("exit")).toBe(before);
    }
  });
});
