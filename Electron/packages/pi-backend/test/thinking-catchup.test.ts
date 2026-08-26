import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

// kimi k3 and similar routes can persist a full reasoning block while streaming
// few or no thinking_delta events. message_end must diff the final thinking
// against what actually streamed and repair the missing suffix live — the same
// repair text already had.
describe("PiHostBackend thinking catch-up on message_end", () => {
  let root = "";
  afterEach(async () => {
    if (root) await (await import("node:fs/promises")).rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
  });
  const backendFor = async (label: string) => {
    root = await mkdtemp(join(tmpdir(), label));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(dir, "session.jsonl"), JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      runtimeRoot: join(root, "runtime"),
      canonicalProjectPaths: async () => undefined,
      piPath: "node",
      spawn: (_bin, _args, options) =>
        spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], { ...options, env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" } }) as any,
    });
    await backend.handle("addProject", [cwd]);
    return backend;
  };
  const streamEvents = async (backend: any, message: string) => {
    const events: any[] = [];
    const off = backend.subscribe((e: any) => events.push(e));
    await backend.handle("sendPrompt", ["session-1", message]);
    await new Promise((r) => setTimeout(r, 20));
    off();
    return events.filter((e) => e.channel === "stream").map((e) => e.event);
  };

  it("repairs silent thinking: no thinking_delta streamed, yet message_end persists the block", async () => {
    const backend = await backendFor("pipi-pi-think-silent-");
    const events = await streamEvents(backend, "__silent_think__");
    await backend.close();
    const thinking = events.filter((e) => e.type === "thinking").map((e) => e.delta);
    expect(thinking).toEqual(["hidden reasoning"]);
    // The streamed text path is untouched by the thinking repair.
    expect(events.filter((e) => e.type === "text").map((e) => e.delta)).toEqual(["hello"]);
  });

  it("repairs a dropped thinking tail against the final block", async () => {
    const backend = await backendFor("pipi-pi-think-partial-");
    const events = await streamEvents(backend, "__partial_think__");
    await backend.close();
    const thinking = events.filter((e) => e.type === "thinking").map((e) => e.delta);
    expect(thinking).toEqual(["think", " more"]);
  });

  it("does not re-emit thinking that streamed intact", async () => {
    const backend = await backendFor("pipi-pi-think-healthy-");
    const events = await streamEvents(backend, "__healthy_think__");
    await backend.close();
    const thinking = events.filter((e) => e.type === "thinking").map((e) => e.delta);
    expect(thinking).toEqual(["all good"]);
  });
});
