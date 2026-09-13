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
  root = await mkdtemp(join(tmpdir(), "pipi-tool-update-"));
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

describe("tool_update forwarding", () => {
  it("projects tool_execution_update partials as last-line, truncated tool_update events", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream" && event.event.type === "tool_update") events.push(event.event); });

    await backend.handle("sendPrompt", ["s1", "__tool_update__"]);
    // Two non-empty updates are expected; the blank one must not surface.
    await eventually(() => events.length >= 2, 10_000);

    expect(events[0]).toMatchObject({ sessionId: "s1", toolCallId: "tool-1", name: "narrate", text: "second line" });
    expect(events[1]).toMatchObject({ sessionId: "s1", toolCallId: "tool-1", name: "narrate" });
    expect(events[1].text).toHaveLength(120);
    expect(events).toHaveLength(2);
    off();
    await backend.close();
  });
});
