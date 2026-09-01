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
  root = await mkdtemp(join(tmpdir(), "pipi-auto-retry-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "s1.jsonl"), JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-01T00:00:00.000Z", cwd }) + "\n");
  return createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, options) => spawn(process.execPath, [new URL("./fake-pi.mjs", import.meta.url).pathname], options) as any,
  });
}

describe("auto-retry forwarding", () => {
  it("streams pi auto_retry_start/end so the UI can surface the retrying wait", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream" && event.event.type === "auto_retry") events.push(event.event); });

    await backend.handle("sendPrompt", ["s1", "__auto_retry__"]);
    // Full-suite parallel load can starve the child spawn + its 80ms retry
    // timer far past a default deadline; stay bounded but generous.
    await eventually(() => events.some(event => event.phase === "end" && event.success === true), 10_000);

    const start = events.find(event => event.phase === "start");
    expect(start).toMatchObject({ sessionId: "s1", phase: "start", attempt: 1, maxAttempts: 3, delayMs: 50, error: "Codex error: transient 500" });
    const end = events.find(event => event.phase === "end");
    expect(end).toMatchObject({ sessionId: "s1", phase: "end", success: true });
    expect(typeof end.error).toBe("undefined");
    off();
    await backend.close();
  });
});
