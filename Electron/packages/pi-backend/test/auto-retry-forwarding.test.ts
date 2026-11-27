import { spawn } from "node:child_process";
import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  it("keeps completed tool results and only the final error on history reload", async () => {
    const backend = await fixture();
    const message = { role: "assistant", stopReason: "error", content: [], errorMessage: "overloaded" };
    const rows = [
      { type: "message", id: "tool", parentId: null, message: { role: "toolResult", toolCallId: "done", toolName: "read", content: "completed" } },
      { type: "message", id: "attempt", parentId: "tool", message },
      { type: "context_edit", id: "omit", parentId: "attempt", targetId: "attempt", replacement: null },
      { type: "message", id: "final", parentId: "omit", message },
    ];
    try {
      await appendFile(join(root, "sessions/project/s1.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
      const history = await backend.handle("getSessionHistory", ["s1"]) as { id: string }[];
      expect(history.map(entry => entry.id)).toEqual(["tool", "final"]);
    } finally {
      await backend.close();
    }
  });

  it.each(["__auto_retry__", "__retry_exhausted__"])("keeps completed tool work and one terminal outcome for %s", async prompt => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream") events.push(event.event); });
    try {
      await backend.handle("sendPrompt", ["s1", prompt]);
      await eventually(() => events.some(e => e.type === "auto_retry" && e.phase === "end"), 10_000);
      const exhausted = prompt === "__retry_exhausted__";
      await eventually(() => events.some(e => e.type === "status" && e.status === (exhausted ? "stopped" : "settled")));
      expect(events.filter(e => e.type === "error")).toHaveLength(exhausted ? 1 : 0);
      expect(events.filter(e => e.type === "tool_result")).toHaveLength(1);
      expect(events.filter(e => e.type === "status" && ["stopped", "settled"].includes(e.status))).toHaveLength(1);
      const retryEnd = events.findIndex(e => e.type === "auto_retry" && e.phase === "end");
      expect(events.slice(0, retryEnd).some(e => e.type === "error")).toBe(false);
    } finally {
      off();
      await backend.close();
    }
  });

  it("preserves native retry telemetry for both silent attempts", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream" && event.event.type === "auto_retry") events.push(event.event); });

    await backend.handle("sendPrompt", ["s1", "__auto_retry__"]);
    // Full-suite parallel load can starve the child spawn + its 80ms retry
    // timer far past a default deadline; stay bounded but generous.
    await eventually(() => events.some(event => event.phase === "end" && event.success === true), 10_000);

    const start = events.find(event => event.phase === "start");
    expect(start).toMatchObject({ sessionId: "s1", phase: "start", attempt: 1, maxAttempts: 2, delayMs: 50, error: "Codex error: transient 500" });
    expect(events.filter(event => event.phase === "start").map(event => event.attempt)).toEqual([1, 2]);
    const end = events.find(event => event.phase === "end");
    expect(end).toMatchObject({ sessionId: "s1", phase: "end", success: true });
    expect(typeof end.error).toBe("undefined");
    off();
    await backend.close();
  });
});
