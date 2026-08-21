import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-reconcile-pending-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-08-17T00:00:00.000Z", cwd }) + "\n");
  return createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    env: { ...process.env, PIPIUI_TEST_SESSION_PATH: sessionPath },
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi-terminal-projection.mjs", import.meta.url).pathname], options) as any,
  });
}

describe("reconcile pending retry (fix 1)", () => {
  it("does not permanently abandon when first get_state has pending work — retries until clear and settles without enqueue", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });
    // final-pending-then-clear: first get_state pendingMessageCount=1, then after ~80ms clears.
    // Old code returned immediately at first_state_pending and never settled without enqueue.
    await backend.handle("sendPrompt", ["s1", "final-pending-then-clear"]);
    await eventually(() => statuses.includes("settled"), 2_500);
    off();
    expect(statuses).toEqual(["started", "settled"]);
    await backend.close();
  });
});
