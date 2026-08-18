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
});
