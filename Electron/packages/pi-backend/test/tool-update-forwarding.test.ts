import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";
import { putSecret, mountSecret } from "../src/secret-vault.js";

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
  it("redacts historical bash before bounding both summary projections", async () => {
    const backend = await fixture();
    try {
      const secret = 'boundary-private-credential';
      await putSecret(join(root, 'agent'), { name: 'boundary', envName: 'BOUNDARY_KEY', value: secret });
      await mountSecret(join(root, 'agent'), 's1', 'boundary');
      const call = { type: 'message', id: 'm1', parentId: null, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'bash-secret', name: 'bash', arguments: { command: 'x'.repeat(115) + secret } }] } };
      await writeFile(join(root, 'sessions/project/s1.jsonl'), JSON.stringify({ type: 'session', version: 3, id: 's1', cwd: join(root, 'project') }) + '\n' + JSON.stringify(call) + '\n');
      const history: any = await backend.handle('getSessionHistory', ['s1']);
      expect(JSON.stringify(history)).not.toContain('bound');
      const assistant = history.find((row: any) => row.role === 'assistant');
      expect(assistant.tools[0].input).toBe(assistant.activities[0].tool.input);
      expect(assistant.tools[0].input.length).toBeLessThan(160);
    } finally { await backend.close(); }
  });
  it("keeps bash bodies off the broadcast and exposes them only through bounded reads", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe(event => { if (event.channel === "stream") events.push(event.event); });
    try {
      await backend.handle("sendPrompt", ["s1", "__bash_details__"]);
      await eventually(() => events.some(event => event.type === "tool_call" && event.name === "bash"));
      let snapshot: any;
      await eventually(async () => {
        snapshot = await backend.handle("getBashDetails", [{ sessionId: "s1", toolCallId: "bash-detail" }]);
        return snapshot.output === "PRIVATE_LIVE_BODY";
      });
      expect(snapshot.state).toBe("running");
      expect(snapshot.input.length).toBeGreaterThan(120);
      const unchanged = await backend.handle("getBashDetails", [{ sessionId: "s1", toolCallId: "bash-detail", sinceRevision: snapshot.revision }]);
      expect(unchanged).toMatchObject({ unchanged: true });
      expect(unchanged).not.toHaveProperty("output");
      await eventually(() => events.some(event => event.type === "tool_result" && event.toolCallId === "bash-detail"));
      snapshot = await backend.handle("getBashDetails", [{ sessionId: "s1", toolCallId: "bash-detail" }]);
      expect(snapshot).toMatchObject({ state: "completed", output: "PRIVATE_FINAL_BODY" });
      expect(JSON.stringify(events)).not.toContain("PRIVATE_");
      const call = events.find(event => event.type === "tool_call" && event.name === "bash");
      expect(JSON.parse(call.delta).command.length).toBeLessThanOrEqual(120);
    } finally { off(); await backend.close(); }
  });
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
