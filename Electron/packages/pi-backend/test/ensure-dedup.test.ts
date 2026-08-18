import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

/**
 * Opening a session to read chrome must not spawn Pi. Work that still needs a
 * live RPC shares one in-flight ensure() so concurrent callers cannot race the
 * single-winner lease.
 */
describe("PiHostBackend ensure() concurrency dedup", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
    vi.restoreAllMocks();
  });

  async function fixture(
    spawnFn: (_bin: string, _args: string[], options: any) => any,
    sessionId = "session-1",
  ) {
    root = await mkdtemp(join(tmpdir(), "pipi-ensure-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    const path = join(dir, `${sessionId}.jsonl`);
    await writeFile(
      path,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: sessionId,
          timestamp: "2026-08-10T00:00:00.000Z",
          cwd,
        }),
      ].join("\n") + "\n",
    );
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: spawnFn,
    });
    await backend.handle("addProject", [cwd]);
    return { backend };
  }

  it("does not spawn Pi for concurrent chrome reads of a cold session", async () => {
    const spawnSpy = vi.fn((_bin: string, _args: string[], options: any) =>
      spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
      }) as any,
    );
    const { backend } = await fixture(spawnSpy);

    const [stats, modelState, quota] = await Promise.all([
      backend.handle("getSessionStats", ["session-1"]),
      backend.handle("getModelState", ["session-1"]),
      backend.handle("getQuotaSnapshot", ["session-1"]),
    ]);

    expect(spawnSpy).toHaveBeenCalledTimes(0);
    expect(stats).toMatchObject({
      sessionId: "session-1",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    });
    expect((modelState as any).model.provider).toBe("unknown");
    expect(quota).toBeNull();
    await backend.close();
  });

  it("shares one in-flight spawn across concurrent ensure() calls for the same session", async () => {
    const spawnSpy = vi.fn((_bin: string, _args: string[], options: any) =>
      spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
      }) as any,
    );
    const { backend } = await fixture(spawnSpy);

    await Promise.all([
      (backend as any).ensure("session-1"),
      (backend as any).ensure("session-1"),
      (backend as any).ensure("session-1"),
    ]);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    await (backend as any).ensure("session-1");
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    await backend.close();
  });

  it("does not serialize different sessions: each cold session spawns once, in parallel", async () => {
    const spawnSpy = vi.fn((_bin: string, _args: string[], options: any) =>
      spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
      }) as any,
    );
    const { backend } = await fixture(spawnSpy, "session-1");
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await writeFile(
      join(dir, "session-2.jsonl"),
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-2",
          timestamp: "2026-08-10T00:00:00.000Z",
          cwd,
        }),
      ].join("\n") + "\n",
    );

    await Promise.all([
      (backend as any).ensure("session-1"),
      (backend as any).ensure("session-2"),
    ]);

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    await backend.close();
  });

  it("clears the in-flight promise on failure so a later call can retry the spawn", async () => {
    const spawnSpy = vi
      .fn<(_bin: string, _args: string[], options: any) => any>()
      .mockImplementationOnce(() => {
        throw new Error("spawn failed");
      })
      .mockImplementation((_bin: string, _args: string[], options: any) =>
        spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
          ...options,
          env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
        }) as any,
      );
    const { backend } = await fixture(spawnSpy);

    const settled = await Promise.allSettled([
      (backend as any).ensure("session-1"),
      (backend as any).ensure("session-1"),
    ]);
    expect(settled.every((r) => r.status === "rejected")).toBe(true);
    for (const r of settled)
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/spawn failed/);
    expect(spawnSpy).toHaveBeenCalledTimes(1);

    await (backend as any).ensure("session-1");
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    await backend.close();
  });
});
