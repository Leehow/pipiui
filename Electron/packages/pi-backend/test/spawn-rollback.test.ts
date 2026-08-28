import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import { createExtensionRegistry } from "../src/extension-registry.js";

let root = "";
const backends: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.allSettled(backends.splice(0).map((backend) => backend.close()));
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function eventually(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("condition was not met before timeout");
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-spawn-rollback-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const sessionsRoot = join(root, "sessions");
  const sessionDir = join(sessionsRoot, "project");
  const sessionId = "session-1";
  const leasePath = join(sessionDir, `${sessionId}.lease.json`);
  await Promise.all([
    mkdir(agentDir, { recursive: true }),
    mkdir(cwd, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
    mkdir(join(root, "runtime"), { recursive: true }),
  ]);
  await writeFile(
    join(sessionDir, `${sessionId}.jsonl`),
    `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-08-10T00:00:00.000Z", cwd })}\n`,
  );

  const children: ChildProcess[] = [];
  const fakePi = new URL("./fake-pi.mjs", import.meta.url).pathname;
  const spawnSpy = vi.fn((_bin: string, _args: string[], options: any) => {
    const child = spawn(process.execPath, [fakePi], {
      ...options,
      env: { ...options.env, PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    children.push(child);
    return child as any;
  });
  const registry = createExtensionRegistry([]);
  const backend = createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: join(root, "runtime"),
    piPath: "node",
    features: { computerUse: true },
    computerDescriptor: { displayID: 1, width: 1280, height: 800 },
    computerUsable: () => true,
    extensionRegistry: registry,
    spawn: spawnSpy,
  });
  backends.push(backend);

  const internals = backend as any;
  // Isolate lifecycle cleanup from catalog/runtime materialization: those paths are
  // separately covered and do not allocate a per-session spawn resource here.
  vi.spyOn(internals, "loadConfiguredModels").mockResolvedValue(undefined);
  const loadSubagents = vi.spyOn(internals, "loadAndMaterializeSubagentModels").mockResolvedValue({});
  vi.spyOn(internals, "registeredExtensionsForSpawn").mockResolvedValue([]);
  vi.spyOn(internals, "goalAutoResumeForSpawn").mockResolvedValue(undefined);
  vi.spyOn(internals, "loadMemoryReviewModel").mockResolvedValue(undefined);
  vi.spyOn(internals, "mediaCompatFallbackEnv").mockResolvedValue({});
  const refreshState = vi.spyOn(internals, "refreshState").mockResolvedValue(undefined);

  let attemptLease: any;
  const originalLeaseFor = internals.leaseFor.bind(internals);
  vi.spyOn(internals, "leaseFor").mockImplementation((session: any) => {
    const lease = originalLeaseFor(session);
    attemptLease ??= lease;
    return lease;
  });

  return {
    backend,
    internals,
    sessionId,
    leasePath,
    children,
    spawnSpy,
    loadSubagents,
    refreshState,
    attemptLease: () => attemptLease,
  };
}

function expectRolledBack(
  internals: any,
  sessionId: string,
  leasePath: string,
  attemptLease: any,
  exitListenersBefore: number,
): void {
  expect(existsSync(leasePath)).toBe(false);
  expect(internals.leases.has(sessionId)).toBe(false);
  expect(internals.bridge.sessions.size).toBe(0);
  expect(internals.bridge.computers.size).toBe(0);
  expect(internals.extensions.sessionMounts.size).toBe(0);
  expect(internals.ensureInFlight.has(sessionId)).toBe(false);
  expect(internals.sessionModelSnapshots.has(sessionId)).toBe(false);
  expect(attemptLease.isOwned).toBe(false);
  expect(attemptLease.timer).toBeUndefined();
  expect(process.listenerCount("exit")).toBe(exitListenersBefore);
}

describe("PiHostBackend spawn rollback", () => {
  const failures: Array<{
    name: string;
    message: string;
    arm: (fixture: Awaited<ReturnType<typeof fixture>>) => void;
    startsChild?: boolean;
  }> = [
    {
      name: "after lease acquisition",
      message: "bridge listen failed",
      arm: ({ internals }) => {
        vi.spyOn(internals.bridge, "listen").mockRejectedValueOnce(new Error("bridge listen failed"));
      },
    },
    {
      name: "during a partial bridge capability registration",
      message: "bridge registration failed",
      arm: ({ internals }) => {
        const register = internals.bridge.register.bind(internals.bridge);
        vi.spyOn(internals.bridge, "register").mockImplementationOnce((id: string) => {
          register(id);
          throw new Error("bridge registration failed");
        });
      },
    },
    {
      name: "after bridge capability acquisition",
      message: "subagent setup failed",
      arm: ({ loadSubagents }) => {
        loadSubagents.mockRejectedValueOnce(new Error("subagent setup failed"));
      },
    },
    {
      name: "during a partial extension mount",
      message: "extension mount failed",
      arm: ({ internals }) => {
        const mountSession = internals.extensions.mountSession.bind(internals.extensions);
        vi.spyOn(internals.extensions, "mountSession").mockImplementationOnce((id: string, extensionIds: readonly string[]) => {
          mountSession(id, extensionIds);
          throw new Error("extension mount failed");
        });
      },
    },
    {
      name: "after extension mount acquisition",
      message: "Pi spawn failed",
      arm: ({ spawnSpy }) => {
        spawnSpy.mockImplementationOnce(() => {
          throw new Error("Pi spawn failed");
        });
      },
    },
    {
      name: "after the live child is installed",
      message: "live initialization failed",
      startsChild: true,
      arm: ({ refreshState }) => {
        refreshState.mockRejectedValueOnce(new Error("live initialization failed"));
      },
    },
  ];

  for (const failure of failures) {
    it(`releases every attempt resource ${failure.name} and retries immediately`, async () => {
      const current = await fixture();
      const exitListenersBefore = process.listenerCount("exit");
      failure.arm(current);

      await expect(current.internals.ensure(current.sessionId)).rejects.toThrow(failure.message);
      const attemptLease = current.attemptLease();
      expect(attemptLease).toBeTruthy();
      expectRolledBack(
        current.internals,
        current.sessionId,
        current.leasePath,
        attemptLease,
        exitListenersBefore,
      );
      if (failure.startsChild) {
        expect(current.children).toHaveLength(1);
        await eventually(() => current.children.every((child) => child.exitCode !== null || child.signalCode !== null));
      }

      await expect(current.internals.ensure(current.sessionId)).resolves.toMatchObject({
        session: { id: current.sessionId },
      });
      expect(current.internals.ensureInFlight.has(current.sessionId)).toBe(false);
    });
  }

  it("does not settle or drain a queued turn from a rollback-owned child", async () => {
    const current = await fixture();
    const queue = current.internals.queue as {
      markBusy(sessionId: string): number;
      enqueue(sessionId: string, input: { text: string }): unknown;
      listQueue(sessionId: string): Array<{ text: string; state: string }>;
    };
    queue.markBusy(current.sessionId);
    queue.enqueue(current.sessionId, { text: "must remain queued" });
    const queueIdle = vi.spyOn(current.internals, "queueIdle");
    const terminal = vi.spyOn(current.internals, "projectTurnTerminal");
    current.refreshState.mockRejectedValueOnce(new Error("live initialization failed"));

    await expect(current.internals.ensure(current.sessionId)).rejects.toThrow("live initialization failed");
    expect(queueIdle).not.toHaveBeenCalled();
    expect(terminal).not.toHaveBeenCalled();
    expect(queue.listQueue(current.sessionId)).toEqual([
      expect.objectContaining({ text: "must remain queued", state: "queued" }),
    ]);
  });

  it("does not release a lease that predates the failed spawn", async () => {
    const current = await fixture();
    await current.backend.handle("resumeSession", [current.sessionId]);
    const lease = current.internals.leases.get(current.sessionId);
    expect(lease?.isOwned).toBe(true);
    const exitListenersBefore = process.listenerCount("exit");
    vi.spyOn(current.internals.bridge, "listen").mockRejectedValueOnce(new Error("bridge listen failed"));

    await expect(current.internals.ensure(current.sessionId)).rejects.toThrow("bridge listen failed");
    expect(existsSync(current.leasePath)).toBe(true);
    expect(lease?.isOwned).toBe(true);
    expect(lease?.timer).toBeDefined();
    expect(current.internals.bridge.sessions.size).toBe(0);
    expect(current.internals.bridge.computers.size).toBe(0);
    expect(current.internals.extensions.sessionMounts.size).toBe(0);
    expect(current.internals.ensureInFlight.has(current.sessionId)).toBe(false);
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);

    await expect(current.internals.ensure(current.sessionId)).resolves.toMatchObject({
      session: { id: current.sessionId },
    });
  });

  it("releases a lease reacquired during a failed spawn", async () => {
    const current = await fixture();
    const exitListenersBefore = process.listenerCount("exit");
    await current.backend.handle("resumeSession", [current.sessionId]);
    const lease = current.internals.leases.get(current.sessionId);
    expect(lease?.isOwned).toBe(true);
    await rm(current.leasePath, { force: true });
    vi.spyOn(current.internals.bridge, "listen").mockRejectedValueOnce(new Error("bridge listen failed"));

    await expect(current.internals.ensure(current.sessionId)).rejects.toThrow("bridge listen failed");
    expect(existsSync(current.leasePath)).toBe(false);
    expect(lease?.isOwned).toBe(false);
    expect(lease?.timer).toBeUndefined();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(current.internals.leases.has(current.sessionId)).toBe(true);

    await expect(current.internals.ensure(current.sessionId)).resolves.toMatchObject({
      session: { id: current.sessionId },
    });
  });

  it("cleans child-scoped resources on normal child close before host close", async () => {
    const current = await fixture();
    await expect(current.internals.ensure(current.sessionId)).resolves.toMatchObject({
      session: { id: current.sessionId },
    });
    expect(current.internals.bridge.sessions.size).toBe(1);
    expect(current.internals.bridge.computers.size).toBe(1);
    expect(current.internals.extensions.sessionMounts.size).toBe(1);
    const lease = current.internals.leases.get(current.sessionId);
    expect(lease?.isOwned).toBe(true);

    current.children[0]!.kill("SIGTERM");
    await eventually(() =>
      current.internals.bridge.sessions.size === 0 &&
      current.internals.bridge.computers.size === 0 &&
      current.internals.extensions.sessionMounts.size === 0,
    );
    // A dead writer still owns the session until the host closes, by design.
    expect(existsSync(current.leasePath)).toBe(true);
    expect(lease?.isOwned).toBe(true);

    await current.backend.close();
    expect(existsSync(current.leasePath)).toBe(false);
    expect(current.internals.leases.size).toBe(0);
    expect(current.internals.extensions.sessionMounts.size).toBe(0);
  });
});
