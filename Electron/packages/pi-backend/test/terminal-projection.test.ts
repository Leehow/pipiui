import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPiHostBackend } from "../src/index.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); root = ""; });

async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
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
  const sessionPath = join(directory, "s1.jsonl");
  await writeFile(sessionPath, JSON.stringify({
    type: "session", version: 3, id: "s1", timestamp: "2026-08-17T00:00:00.000Z", cwd,
  }) + "\n");
  return createPiHostBackend({
    agentDir,
    sessionsRoot,
    runtimeRoot: root,
    piPath: process.execPath,
    env: { ...process.env, PIPIUI_TEST_SESSION_PATH: sessionPath },
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

  it("logs a bounded privacy-safe reason when final-turn reconciliation cannot settle", async () => {
    const previous = process.env.PIPIUI_STREAM_DEBUG;
    process.env.PIPIUI_STREAM_DEBUG = "1";
    const warnings: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(value => warnings.push(String(value)));
    const backend = await fixture();
    try {
      await backend.handle("sendPrompt", ["s1", "final-with-reentry"]);
      await eventually(() => warnings.some(line => line.includes("reason=first_state_pending")));
      const diagnostic = warnings.find(line => line.includes("[terminal-reconcile]")) ?? "";
      expect(diagnostic).toContain("pending=1");
      expect(diagnostic).toContain("queue=0");
      expect(diagnostic).not.toContain("final-with-reentry");
      expect(diagnostic).not.toContain("response-final-with-reentry");
    } finally {
      await backend.close();
      warn.mockRestore();
      if (previous === undefined) delete process.env.PIPIUI_STREAM_DEBUG;
      else process.env.PIPIUI_STREAM_DEBUG = previous;
    }
  });

  it("reconciles a durably persisted final assistant when Pi stays streaming and omits agent_settled", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "persisted-final-stuck-streaming"]);
    await eventually(() => statuses.includes("settled"));

    off();
    expect(statuses).toEqual(["started", "settled"]);
    await backend.close();
  });

  it("waits for message_end persistence before reconciling stale streaming state", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "delayed-persisted-final-stuck-streaming"]);
    await eventually(() => statuses.includes("settled"));

    off();
    expect(statuses).toEqual(["started", "settled"]);
    await backend.close();
  });

  it("settles after delayed durable persistence and replays terminal agents missed by the renderer", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const localAgents = new Map<string, string>([
      ["root", "running"],
      ["operator", "running"],
    ]);
    const offStatus = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "delayed-durable-terminal-agent-replay"]);
    await eventually(async () => {
      const agents = await backend.handle("listAgents", ["s1"]);
      return agents.length === 2 && agents.every((agent: any) => agent.state !== "running");
    });
    const offAgents = backend.subscribe(event => {
      if (event.channel !== "agents" || event.event.type !== "agent") return;
      localAgents.set(event.event.agent.agentId, event.event.agent.state);
    });

    await eventually(() => statuses.includes("settled"), 2_000);
    await eventually(() => [...localAgents.values()].every(state => state !== "running"));

    offAgents();
    offStatus();
    expect(statuses).toEqual(["started", "settled"]);
    expect(Object.fromEntries(localAgents)).toEqual({ root: "failed", operator: "ok" });
    await backend.close();
  });

  it("ignores orphan preview events and replays the exact current terminal runs", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const projected = new Map<string, { runId: string; state: string }>();
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
      if (event.channel === "agents" && event.event.type === "agent") {
        projected.set(event.event.agent.agentId, {
          runId: event.event.agent.runId,
          state: event.event.agent.state,
        });
      }
    });

    await backend.handle("sendPrompt", ["s1", "terminal-rows-with-orphan-previews"]);
    await eventually(() => statuses.includes("settled"));

    off();
    expect(statuses).toEqual(["started", "settled"]);
    expect(Object.fromEntries(projected)).toEqual({
      root: { runId: "root-run", state: "failed" },
      operator: { runId: "operator-run", state: "ok" },
    });
    await expect(backend.handle("listAgents", ["s1"])).resolves.toMatchObject([
      { agentId: "root", runId: "root-run", state: "failed" },
      { agentId: "operator", runId: "operator-run", state: "ok" },
    ]);
    await backend.close();
  });

  it("emits a bounded privacy-safe terminal projection trace", async () => {
    const previous = process.env.PIPIUI_STREAM_DEBUG;
    process.env.PIPIUI_STREAM_DEBUG = "1";
    const lines: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(value => lines.push(String(value)));
    const log = vi.spyOn(console, "log").mockImplementation(value => lines.push(String(value)));
    const backend = await fixture();
    const off = backend.subscribe(() => undefined);
    try {
      await backend.handle("sendPrompt", ["s1", "terminal-rows-with-orphan-previews"]);
      await eventually(() => lines.some(line => line.includes("reason=terminal_projected")));
      await backend.handle("listAgents", ["s1"]);

      const trace = lines.join("\n");
      expect(trace).toMatch(/projection-debug.*reason=subscribe.*listeners=1/);
      expect(trace).toMatch(/projection-debug.*reason=agent_event.*kind=start.*before=missing.*after=running/);
      expect(trace).toMatch(/projection-debug.*reason=agent_event.*kind=end.*before=running.*after=(?:failed|ok)/);
      expect(trace).toMatch(/projection-debug.*reason=final_seen.*epoch=/);
      expect(trace).toMatch(/projection-debug.*reason=reconcile_invoke.*active=/);
      expect(trace).toMatch(/projection-debug.*reason=terminal_replay.*active=0/);
      expect(trace).toMatch(/projection-debug.*reason=agent_broadcast.*source=terminal_replay.*listeners=1/);
      expect(trace).toMatch(/projection-debug.*reason=terminal_projected/);
      expect(trace).toMatch(/projection-debug.*reason=list_agents.*active=0/);
      expect(trace).not.toMatch(/\bs1\b|root-run|operator-run|Run GUI task|response-terminal-rows|late preview/);
      expect(lines.every(line => line.length < 2_000)).toBe(true);
    } finally {
      off();
      await backend.close();
      warn.mockRestore();
      log.mockRestore();
      if (previous === undefined) delete process.env.PIPIUI_STREAM_DEBUG;
      else process.env.PIPIUI_STREAM_DEBUG = previous;
    }
  });

  it("appends the privacy-safe trace to an explicit existing file only while debug is enabled", async () => {
    const previousDebug = process.env.PIPIUI_STREAM_DEBUG;
    const previousFile = process.env.PIPIUI_STREAM_DEBUG_FILE;
    const debugRoot = await mkdtemp(join(tmpdir(), "pipi-terminal-debug-file-"));
    const output = join(debugRoot, "projection.log");
    await writeFile(output, "seed\n");
    process.env.PIPIUI_STREAM_DEBUG = "1";
    process.env.PIPIUI_STREAM_DEBUG_FILE = output;
    const backend = await fixture();
    const enabledFixtureRoot = root;
    const off = backend.subscribe(() => undefined);
    try {
      await backend.handle("sendPrompt", ["s1", "terminal-rows-with-orphan-previews"]);
      await eventually(async () => (await readFile(output, "utf8")).includes("reason=terminal_projected"));
      await backend.handle("listAgents", ["s1"]);
      off();
      await backend.close();

      const trace = await readFile(output, "utf8");
      expect(trace).toMatch(/^seed\n/);
      expect(trace).toMatch(/projection-debug.*reason=subscribe.*listeners=1/);
      expect(trace).toMatch(/projection-debug.*reason=agent_event.*kind=start/);
      expect(trace).toMatch(/projection-debug.*reason=terminal_projected/);
      expect(trace).toMatch(/projection-debug.*reason=list_agents.*active=0/);
      expect(trace).not.toMatch(/\bs1\b|root-run|operator-run|Run GUI task|response-terminal-rows|late preview/);
      expect(trace.trimEnd().split("\n").every(line => line.length < 2_000)).toBe(true);

      await rm(enabledFixtureRoot, { recursive: true, force: true });
      if (root === enabledFixtureRoot) root = "";
      await writeFile(output, "disabled\n");
      delete process.env.PIPIUI_STREAM_DEBUG;
      const disabled = await fixture();
      const disabledOff = disabled.subscribe(() => undefined);
      await disabled.handle("sendPrompt", ["s1", "terminal-rows-with-orphan-previews"]);
      await new Promise(resolve => setTimeout(resolve, 150));
      disabledOff();
      await disabled.close();
      await expect(readFile(output, "utf8")).resolves.toBe("disabled\n");
    } finally {
      if (previousDebug === undefined) delete process.env.PIPIUI_STREAM_DEBUG;
      else process.env.PIPIUI_STREAM_DEBUG = previousDebug;
      if (previousFile === undefined) delete process.env.PIPIUI_STREAM_DEBUG_FILE;
      else process.env.PIPIUI_STREAM_DEBUG_FILE = previousFile;
      await rm(debugRoot, { recursive: true, force: true });
    }
  });

  it("does not settle while a real started agent remains running", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "final-with-real-running-agent"]);
    await new Promise(resolve => setTimeout(resolve, 250));

    off();
    expect(statuses).toEqual(["started"]);
    await expect(backend.handle("listAgents", ["s1"])).resolves.toMatchObject([
      { agentId: "active", runId: "active-run", state: "running" },
    ]);
    await backend.close();
  });

  it("retries terminal reconciliation when the last real agent ends after the final message", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const projected = new Map<string, string>();
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
      if (event.channel === "agents" && event.event.type === "agent") {
        projected.set(event.event.agent.agentId, event.event.agent.state);
      }
    });

    await backend.handle("sendPrompt", ["s1", "final-before-agent-terminal"]);
    await eventually(() => statuses.includes("settled"));

    off();
    expect(statuses).toEqual(["started", "settled"]);
    expect(Object.fromEntries(projected)).toEqual({ active: "ok" });
    await backend.close();
  });

  it("does not settle from a different durable assistant identity", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "persisted-final-identity-mismatch"]);
    await new Promise(resolve => setTimeout(resolve, 750));

    off();
    expect(statuses).toEqual(["started"]);
    await backend.close();
  });

  it("does not settle a tool-use message_end while the turn is still streaming", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "tool-use-still-streaming"]);
    await new Promise(resolve => setTimeout(resolve, 250));

    off();
    expect(statuses).toEqual(["started"]);
    await backend.close();
  });

  it("deduplicates a late agent_settled against durable-final reconciliation", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "persisted-final-late-settled"]);
    await eventually(() => statuses.includes("settled"));
    await new Promise(resolve => setTimeout(resolve, 150));

    off();
    expect(statuses).toEqual(["started", "settled"]);
    await backend.close();
  });

  it("settles a missed agent_settled turn and drains a user message queued in that window", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "persisted-final-stuck-streaming"]);
    const queued = await backend.handle("enqueueMessage", ["s1", "做吧"]) as { outcome: string };
    expect(queued.outcome).toBe("queued");

    await eventually(() => statuses.includes("settled"));
    await eventually(async () => ((await backend.handle("listQueue", ["s1"])) as unknown[]).length === 0);

    off();
    expect(statuses.filter(status => status === "started").length).toBeGreaterThanOrEqual(2);
    await backend.close();
  });

  it("retries missed-settled reconciliation when a user message queues after the first attempt aborted", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "final-pending-then-clear"]);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(statuses).toEqual(["started"]);

    const queued = await backend.handle("enqueueMessage", ["s1", "做吧"]) as { outcome: string };
    expect(queued.outcome).toBe("queued");

    await eventually(() => statuses.includes("settled"), 2_000);
    await eventually(async () => ((await backend.handle("listQueue", ["s1"])) as unknown[]).length === 0);

    off();
    expect(statuses.filter(status => status === "started").length).toBeGreaterThanOrEqual(2);
    await backend.close();
  });

  it("reconciles a final idle assistant turn when message_end timestamp is an ISO string", async () => {
    const backend = await fixture();
    const statuses: string[] = [];
    const off = backend.subscribe(event => {
      if (event.channel === "stream" && event.event.type === "status") statuses.push(event.event.status);
    });

    await backend.handle("sendPrompt", ["s1", "iso-timestamp-without-settled"]);
    await eventually(() => statuses.includes("settled"));

    off();
    expect(statuses).toEqual(["started", "settled"]);
    await backend.close();
  });
});
