import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiHostBackend } from "../src/index.js";

let root = "";

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

type Operation = "resumeSession" | "renameSession" | "moveSession";

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-lease-acquire-race-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const source = join(root, "source");
  const target = join(root, "target");
  const sessionDir = join(sessionsRoot, encodeURIComponent(source));
  const sessionPath = join(sessionDir, "s1.jsonl");
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(source, { recursive: true }),
    mkdir(target, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ]);
  const writeSession = async () => {
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "s1",
        timestamp: "2026-08-28T00:00:00.000Z",
        cwd: source,
      })}\n`,
    );
  };
  await writeSession();
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: join(root, "runtime"),
    queueStore: {
      load: async () => [],
      save: async () => undefined,
      remove: async () => undefined,
    },
  });
  await backend.handle("setProjectPaths", [[source, target]]);
  const projects = await backend.handle("listProjects", []) as Array<{ id: string; path: string }>;
  const targetId = projects.find((project) => project.path === target)?.id;
  if (!targetId) throw new Error("target project was not registered");
  return { backend, source, target, targetId, sessionPath, leasePath: join(sessionDir, "s1.lease.json"), writeSession };
}

function invoke(backend: any, operation: Operation, targetId: string): Promise<unknown> {
  if (operation === "resumeSession") return backend.handle(operation, ["s1"]);
  if (operation === "renameSession") return backend.handle(operation, ["s1", "after race"]);
  return backend.handle(operation, ["s1", targetId]);
}

describe("host lease acquisition lifecycle transaction", () => {
  for (const operation of ["resumeSession", "renameSession", "moveSession"] as const) {
    it(`${operation} rolls back a lease acquired after deletion starts and retries on a new lifecycle`, async () => {
      const current = await fixture();
      const internals = current.backend as any;
      const exitListenersBefore = process.listenerCount("exit");
      let releaseAcquire!: () => void;
      let acquireStarted!: () => void;
      const acquireGate = new Promise<void>((resolve) => { releaseAcquire = resolve; });
      const acquireStartedGate = new Promise<void>((resolve) => { acquireStarted = resolve; });
      let firstAcquire = true;
      let lease: any;
      const originalLeaseFor = internals.leaseFor.bind(internals);
      vi.spyOn(internals, "leaseFor").mockImplementation((session: any) => {
        const currentLease = originalLeaseFor(session);
        lease ??= currentLease;
        if (firstAcquire) {
          firstAcquire = false;
          const originalAcquire = currentLease.acquire.bind(currentLease);
          vi.spyOn(currentLease, "acquire").mockImplementation(async () => {
            acquireStarted();
            await acquireGate;
            return originalAcquire();
          });
        }
        return currentLease;
      });

      const operationPromise = invoke(internals, operation, current.targetId);
      // Attach a handler before teardown can reject the stale continuation;
      // the assertion below still observes the original rejection.
      void operationPromise.catch(() => undefined);
      await acquireStartedGate;

      const deleting = current.backend.handle("deleteSession", ["s1"]);
      // Teardown shares the ownership lane, so let the pending acquire finish
      // before waiting for teardown to release the manager.
      releaseAcquire();
      await deleting;
      await expect(operationPromise).rejects.toThrow(/disposed/);

      expect(existsSync(current.leasePath)).toBe(false);
      expect(internals.leases.has("s1")).toBe(false);
      expect(lease.isOwned).toBe(false);
      expect(lease.timer).toBeUndefined();
      expect(process.listenerCount("exit")).toBe(exitListenersBefore);
      expect(internals.leaseOperationLanes.size).toBe(0);

      await current.writeSession();
      const retried = await invoke(internals, operation, current.targetId) as any;
      expect(retried).toMatchObject({ id: "s1" });
      if (operation === "moveSession") expect(retried.projectId).toBe(current.targetId);
      await current.backend.close();
      expect(process.listenerCount("exit")).toBe(exitListenersBefore);
      expect(internals.leaseOperationLanes.size).toBe(0);
    });
  }

  it("keeps a lease when an installer rolls back after a concurrent reuse", async () => {
    const current = await fixture();
    const internals = current.backend as any;
    const exitListenersBefore = process.listenerCount("exit");
    let releaseInstaller!: () => void;
    let installerPaused!: () => void;
    const installerGate = new Promise<void>((resolve) => { releaseInstaller = resolve; });
    const installerPausedGate = new Promise<void>((resolve) => { installerPaused = resolve; });
    let failInstaller = false;
    let firstFileOperation = true;
    let lease: any;
    const originalLeaseFor = internals.leaseFor.bind(internals);
    vi.spyOn(internals, "leaseFor").mockImplementation((session: any) => {
      const currentLease = originalLeaseFor(session);
      lease ??= currentLease;
      return currentLease;
    });
    const originalSessionFileExclusive = internals.sessionFileExclusive.bind(internals);
    vi.spyOn(internals, "sessionFileExclusive").mockImplementation((...args: any[]) => {
      const barrier = originalSessionFileExclusive(...args);
      if (!firstFileOperation) return barrier;
      firstFileOperation = false;
      return async (work: any) => {
        // The lease-acquire lane has already been released here. The reuse can
        // therefore claim before this installer is allowed to fail/rollback.
        installerPaused();
        await installerGate;
        if (failInstaller) {
          failInstaller = false;
          throw new Error("installer failure");
        }
        return barrier(work);
      };
    });

    const installer = invoke(internals, "renameSession", current.targetId);
    await installerPausedGate;
    const installerGeneration = lease.ownershipGeneration;
    const reuse = invoke(internals, "renameSession", current.targetId);
    await expect(reuse).resolves.toMatchObject({ id: "s1" });
    expect(lease.ownershipGeneration).toBeGreaterThan(installerGeneration);

    failInstaller = true;
    releaseInstaller();
    await expect(installer).rejects.toThrow("installer failure");
    expect(existsSync(current.leasePath)).toBe(true);
    expect(internals.leases.get("s1")).toBe(lease);
    expect(lease.isOwned).toBe(true);
    expect(lease.timer).toBeDefined();

    await current.backend.close();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(internals.leaseOperationLanes.size).toBe(0);
  });

  it("queues reuse behind rollback I/O and reacquires a registered manager", async () => {
    const current = await fixture();
    const internals = current.backend as any;
    const exitListenersBefore = process.listenerCount("exit");
    let releaseRollback!: () => void;
    let rollbackStarted!: () => void;
    const rollbackGate = new Promise<void>((resolve) => { releaseRollback = resolve; });
    const rollbackStartedGate = new Promise<void>((resolve) => { rollbackStarted = resolve; });
    const managers: any[] = [];
    let installerLease: any;
    let acquireCalls = 0;
    let reuseQueued!: () => void;
    const reuseQueuedGate = new Promise<void>((resolve) => { reuseQueued = resolve; });
    const originalLeaseFor = internals.leaseFor.bind(internals);
    vi.spyOn(internals, "leaseFor").mockImplementation((session: any) => {
      const currentLease = originalLeaseFor(session);
      if (!managers.includes(currentLease)) managers.push(currentLease);
      if (!installerLease) {
        installerLease = currentLease;
        const originalAcquire = currentLease.acquire.bind(currentLease);
        vi.spyOn(currentLease, "acquire").mockImplementation((...args: any[]) => originalAcquire(...args));
        const originalRelease = currentLease.release.bind(currentLease);
        vi.spyOn(currentLease, "release").mockImplementation(async () => {
          rollbackStarted();
          await rollbackGate;
          return originalRelease();
        });
      }
      return currentLease;
    });
    const originalAcquireSessionLease = internals.acquireSessionLease.bind(internals);
    vi.spyOn(internals, "acquireSessionLease").mockImplementation((...args: any[]) => {
      acquireCalls += 1;
      if (acquireCalls === 2) reuseQueued();
      return originalAcquireSessionLease(...args);
    });
    let firstFileOperation = true;
    const originalSessionFileExclusive = internals.sessionFileExclusive.bind(internals);
    vi.spyOn(internals, "sessionFileExclusive").mockImplementation((...args: any[]) => {
      const barrier = originalSessionFileExclusive(...args);
      if (!firstFileOperation) return barrier;
      firstFileOperation = false;
      return async () => { throw new Error("installer failure"); };
    });

    const installer = invoke(internals, "renameSession", current.targetId);
    await rollbackStartedGate;
    const reuse = invoke(internals, "renameSession", current.targetId);
    // This barrier fires after the reuse has submitted its lane operation but
    // before lane admission, while rollback is still inside async release I/O.
    await reuseQueuedGate;
    expect(installerLease.acquire).toHaveBeenCalledTimes(1);
    expect(internals.leases.get("s1")).toBe(installerLease);
    expect(internals.leaseOperationLanes.size).toBe(1);

    releaseRollback();
    await expect(installer).rejects.toThrow("installer failure");
    await expect(reuse).resolves.toMatchObject({ id: "s1" });

    expect(managers).toHaveLength(2);
    const reusedLease = managers[1];
    expect(reusedLease).not.toBe(installerLease);
    expect(existsSync(current.leasePath)).toBe(true);
    expect(internals.leases.get("s1")).toBe(reusedLease);
    expect(reusedLease.isOwned).toBe(true);
    expect(internals.leaseOperationLanes.size).toBe(0);

    await current.backend.close();
    expect(existsSync(current.leasePath)).toBe(false);
    expect(internals.leases.has("s1")).toBe(false);
    expect(internals.leaseOperationLanes.size).toBe(0);
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
  });

  it("releases an installer-owned lease when no reuse follows", async () => {
    const current = await fixture();
    const internals = current.backend as any;
    const exitListenersBefore = process.listenerCount("exit");
    let lease: any;
    const originalLeaseFor = internals.leaseFor.bind(internals);
    vi.spyOn(internals, "leaseFor").mockImplementation((session: any) => {
      lease = originalLeaseFor(session);
      return lease;
    });
    vi.spyOn(internals, "sessionFileExclusive").mockImplementation(() =>
      async () => { throw new Error("installer failure"); });

    await expect(invoke(internals, "renameSession", current.targetId))
      .rejects.toThrow("installer failure");
    expect(existsSync(current.leasePath)).toBe(false);
    expect(internals.leases.has("s1")).toBe(false);
    expect(lease.isOwned).toBe(false);
    expect(lease.timer).toBeUndefined();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(internals.leaseOperationLanes.size).toBe(0);

    await current.backend.close();
    expect(internals.leaseOperationLanes.size).toBe(0);
  });

  it("rolls back force takeover when deletion revokes its lifecycle", async () => {
    const current = await fixture();
    const internals = current.backend as any;
    const exitListenersBefore = process.listenerCount("exit");
    let releaseTakeover!: () => void;
    let takeoverStarted!: () => void;
    const takeoverGate = new Promise<void>((resolve) => { releaseTakeover = resolve; });
    const takeoverStartedGate = new Promise<void>((resolve) => { takeoverStarted = resolve; });
    let takeoverWrapped = false;
    let lease: any;
    const originalLeaseFor = internals.leaseFor.bind(internals);
    vi.spyOn(internals, "leaseFor").mockImplementation((session: any) => {
      const currentLease = originalLeaseFor(session);
      lease ??= currentLease;
      if (!takeoverWrapped) {
        takeoverWrapped = true;
        const originalTakeover = currentLease.forceTakeover.bind(currentLease);
        vi.spyOn(currentLease, "forceTakeover").mockImplementation(async () => {
          const status = await originalTakeover();
          takeoverStarted();
          await takeoverGate;
          return status;
        });
      }
      return currentLease;
    });

    const takeover = current.backend.handle("forceTakeoverSessionLease", ["s1"]);
    void takeover.catch(() => undefined);
    await takeoverStartedGate;
    const deleting = current.backend.handle("deleteSession", ["s1"]);
    releaseTakeover();
    await deleting;
    await expect(takeover).rejects.toThrow(/disposed/);

    expect(existsSync(current.leasePath)).toBe(false);
    expect(internals.leases.has("s1")).toBe(false);
    expect(lease.isOwned).toBe(false);
    expect(lease.timer).toBeUndefined();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(internals.leaseOperationLanes.size).toBe(0);

    await current.writeSession();
    const retried = await current.backend.handle("forceTakeoverSessionLease", ["s1"]) as any;
    expect(retried).toMatchObject({ sessionId: "s1", writable: true });
    await current.backend.close();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(internals.leaseOperationLanes.size).toBe(0);
  });
});
