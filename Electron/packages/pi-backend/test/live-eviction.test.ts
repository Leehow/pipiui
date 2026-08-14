import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";
import { appendLedgerRecord } from "../src/token-ledger.js";

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition was not met before timeout");
}

const silentAuth = {
  getProviders: async () => [],
  getAvailable: async () => [],
  login: async () => undefined,
  logout: async () => undefined,
};

describe("idle live Pi reclamation", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  async function seedSession(id: string, cwd: string, sessions: string) {
    const dir = join(sessions, "project");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${id}.jsonl`),
      JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n",
    );
  }

  it("does not spawn Pi just to read ledger-backed session stats", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-stats-nospawn-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await seedSession("session-1", cwd, sessions);
    await appendLedgerRecord(join(agent, "pipiui-token-ledger.jsonl"), {
      ts: "2026-08-10T00:00:05.000Z",
      session: "session-1",
      channel: "main",
      depth: 0,
      model: "fake/fake-1",
      turn: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 15000,
      contextWindow: 262144,
    });
    let spawned = 0;
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      env: { PATH: process.env.PATH ?? "" },
      piPath: "node",
      spawn: () => {
        spawned++;
        throw new Error("stats must not spawn Pi");
      },
      authRuntime: silentAuth,
    });
    const stats = await backend.handle("getSessionStats", ["session-1"]) as { contextUsage?: { tokens?: number } };
    expect(stats.contextUsage?.tokens).toBe(15000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(spawned).toBe(0);
    await backend.close();
  });

  it("does not spawn Pi when the UI opens a cold session for reading", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-cold-open-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await seedSession("session-1", cwd, sessions);
    await appendLedgerRecord(join(agent, "pipiui-token-ledger.jsonl"), {
      ts: "2026-08-10T00:00:05.000Z",
      session: "session-1",
      channel: "main",
      depth: 0,
      model: "fake/fake-1",
      turn: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 15000,
      contextWindow: 262144,
    });
    let spawned = 0;
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      env: { PATH: process.env.PATH ?? "" },
      piPath: "node",
      spawn: () => {
        spawned++;
        throw new Error("opening a session must not spawn Pi");
      },
      authRuntime: silentAuth,
    });
    // The first sidebar click fires these together. Browsing must stay a file
    // read; Pi starts only when the user actually talks to the session.
    await Promise.all([
      backend.handle("getSessionHistory", ["session-1"]),
      backend.handle("getSessionLease", ["session-1"]),
      backend.handle("getModelState", ["session-1"]),
      backend.handle("getSessionStats", ["session-1"]),
      backend.handle("getQuotaSnapshot", ["session-1"]),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(spawned).toBe(0);
    await backend.close();
  });

  it.skip("reaps a quiet live Pi when another session needs a process", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-evict-quiet-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await seedSession("session-1", cwd, sessions);
    await seedSession("session-2", cwd, sessions);
    const children: ChildProcess[] = [];
    const fakePi = new URL("./fake-pi.mjs", import.meta.url).pathname;
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      env: { PATH: process.env.PATH ?? "" },
      piPath: "node",
      spawn: (_bin, _args, options) => {
        const child = spawn(process.execPath, [fakePi], {
          ...options,
          env: { ...options.env, PATH: process.env.PATH ?? "/usr/bin:/bin", ELECTRON_RUN_AS_NODE: "1" },
        });
        children.push(child);
        return child as any;
      },
      authRuntime: silentAuth,
    });
    await backend.handle("sendPrompt", ["session-1", "go"]);
    expect(children).toHaveLength(1);
    const first = children[0]!.pid!;
    expect(processAlive(first)).toBe(true);

    await backend.handle("sendPrompt", ["session-2", "go"]);
    expect(children).toHaveLength(2);
    await eventually(() => !processAlive(first));
    expect(processAlive(children[1]!.pid!)).toBe(true);
    await backend.close();
  });

  it.skip("deleteSession SIGTERMs a live Pi that ignores stdin EOF", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-delete-reap-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    await mkdir(agent, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await seedSession("session-1", cwd, sessions);
    let childPid = 0;
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: sessions,
      runtimeRoot: join(root, "runtime"),
      env: { PATH: process.env.PATH ?? "" },
      piPath: "node",
      spawn: (_bin, _args, options) => {
        const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
          ...options,
          env: { ...options.env, ELECTRON_RUN_AS_NODE: "1" },
        });
        childPid = child.pid ?? 0;
        return child as any;
      },
      authRuntime: silentAuth,
    });
    const pending = backend.handle("sendPrompt", ["session-1", "go"]);
    await eventually(() => childPid > 0);
    expect(processAlive(childPid)).toBe(true);
    await backend.handle("deleteSession", ["session-1"]);
    await eventually(() => !processAlive(childPid));
    await pending.catch(() => undefined);
    await backend.close();
  });
});
