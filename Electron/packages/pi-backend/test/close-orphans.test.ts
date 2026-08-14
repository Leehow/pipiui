import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
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

async function eventually(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

describe("PiHostBackend close() process reaping", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("kills a Pi child that ignores stdin EOF so close() cannot leave an orphan", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-close-orphan-"));
    const agent = join(root, "agent");
    const cwd = join(root, "project");
    const sessions = join(root, "sessions");
    const dir = join(sessions, "project");
    await mkdir(agent, { recursive: true });
    await mkdir(dir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(
      join(dir, "session-1.jsonl"),
      JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n",
    );
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
      authRuntime: {
        getProviders: async () => [],
        getAvailable: async () => [],
        login: async () => undefined,
        logout: async () => undefined,
      },
    });
    const pending = (backend as any).ensure("session-1") as Promise<unknown>;
    await eventually(() => childPid > 0);
    expect(processAlive(childPid)).toBe(true);

    const verdict = await Promise.race([
      backend.close().then(() => "closed" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);
    expect(verdict).toBe("closed");
    expect(processAlive(childPid)).toBe(false);
    await pending.catch(() => undefined);
  });
});
