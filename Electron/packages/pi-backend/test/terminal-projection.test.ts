import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function eventually(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "pipi-terminal-projection-"));
  const agentDir = join(root, "agent");
  const sessionsRoot = join(root, "sessions");
  const cwd = join(root, "project");
  const directory = join(sessionsRoot, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "s1.jsonl"), JSON.stringify({
    type: "session", version: 3, id: "s1", timestamp: "2026-08-17T00:00:00.000Z", cwd,
  }) + "\n");
  return createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    spawn: (_bin, _args, options) => spawn(
      process.execPath,
      [new URL("./fake-pi-terminal-projection.mjs", import.meta.url).pathname],
      options,
    ) as any,
  });
}

describe("PiHostBackend terminal projection", () => {
  it("reconciles a final idle assistant turn when agent_settled is missed", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "final-without-settled"]);
    await eventually(() => statuses.includes("settled"));

    off();
    expect(statuses).toEqual(["started", "settled"]);
    await backend.close();
  });

  it("does not project settled while Pi reports queued post-run re-entry", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "final-with-reentry"]);
    await eventually(() => statuses.filter(status => status === "started").length === 2);

    off();
    expect(statuses).toEqual(["started", "started"]);
    await backend.close();
  });
});
