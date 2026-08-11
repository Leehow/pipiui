import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

/**
 * End-to-end context compaction against the fake pi: the `compact` host method,
 * the compaction stream events pi's own lifecycle produces, and the idle-time
 * scheduler that fires when the session parks above the high watermark.
 */

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function fixture(compaction?: { quietDelayMs?: number }) {
  root = await mkdtemp(join(tmpdir(), "pipi-compact-"));
  const cwd = join(root, "project");
  const dir = join(root, "sessions", "project");
  await mkdir(dir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(dir, "session.jsonl"),
    JSON.stringify({ type: "session", version: 3, id: "session-1", timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n",
  );
  const backend = createPiHostBackend({
    agentDir: join(root, "agent"),
    sessionsRoot: join(root, "sessions"),
    runtimeRoot: join(root, "runtime"),
    piPath: "node",
    compaction: {
      highWatermark: 0.8,
      lowWatermark: 0.6,
      // Keep the quiet period short; the watermark logic is unit-tested separately.
      quietDelayMs: compaction?.quietDelayMs ?? 20,
      failureBackoffMs: 60_000,
    },
    spawn: (_bin, _args, options) =>
      spawn("/usr/local/bin/node", [new URL("./fake-pi.mjs", import.meta.url).pathname], {
        ...options,
        env: { ...options.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
      }) as any,
  });
  await backend.handle("addProject", [cwd]);
  return backend;
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
/** Polls a condition; the fake pi's lifecycle is event-driven, not clock-driven. */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await settle(10);
  }
}
const compactionEvents = (events: any[]) =>
  events.filter((e) => e.channel === "stream" && e.event.type === "compaction").map((e) => e.event);

describe("context compaction", () => {
  it("runs `compact` on demand and reports the lifecycle as stream events", async () => {
    const backend = await fixture();
    await backend.handle("sendPrompt", ["session-1", "go"]);
    await settle();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("compact", ["session-1"]);
    await settle();
    off();

    expect(compactionEvents(events)).toEqual([
      { type: "compaction", sessionId: "session-1", phase: "start", reason: "manual" },
      { type: "compaction", sessionId: "session-1", phase: "end", reason: "manual", aborted: undefined, error: undefined },
    ]);
    // The post-compaction snapshot is what drops the stale context number.
    expect(events.some((e) => e.channel === "session_stats" && e.event.stats.contextUsage?.tokens === 12000)).toBe(true);
    await backend.close();
  });

  it("surfaces a refused compact as a rejection, with no lifecycle events", async () => {
    const backend = await fixture();
    await backend.handle("sendPrompt", ["session-1", "fill-context-no-compact"]);
    await settle();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await expect(backend.handle("compact", ["session-1"])).rejects.toThrow(/Nothing to compact/);
    off();
    expect(compactionEvents(events)).toEqual([]);
    await backend.close();
  });

  it("compacts on its own once an idle session parks above the high watermark", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    // 240000/262144 ≈ 92%: pi's own threshold check only runs on the next turn,
    // which is exactly the gap this scheduler closes.
    await backend.handle("sendPrompt", ["session-1", "fill-context"]);
    await settle(200);
    off();

    expect(compactionEvents(events).map((e) => e.phase)).toEqual(["start", "end"]);
    expect((await backend.handle("getSessionStats", ["session-1"])) as any).toMatchObject({
      contextUsage: { tokens: 12000 },
    });
    await backend.close();
  });

  it("leaves a session below the watermark alone", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "go"]);
    await settle(200);
    off();

    expect(compactionEvents(events)).toEqual([]);
    await backend.close();
  });

  it("holds a prompt sent during an idle-time compaction instead of racing pi", async () => {
    const backend = await fixture();
    const events: any[] = [];
    const off = backend.subscribe((e) => events.push(e));

    await backend.handle("sendPrompt", ["session-1", "fill-context-slow"]);
    // Wait for the scheduler's compact to be under way but not yet finished.
    await waitFor(() => compactionEvents(events).some((e) => e.phase === "start"));
    expect(compactionEvents(events).some((e) => e.phase === "end")).toBe(false);

    const result = (await backend.handle("enqueueMessage", ["session-1", "during"])) as any;
    expect(result.outcome).toBe("queued");

    // Releasing the hold drains the queue: the held prompt reaches pi afterwards.
    await waitFor(() => compactionEvents(events).some((e) => e.phase === "end"));
    await waitFor(async () => ((await backend.handle("listQueue", ["session-1"])) as any[]).length === 0);
    off();
    await backend.close();
  });

  it("advertises the capability", async () => {
    const backend = await fixture();
    expect(await backend.handle("capabilities", [])).toMatchObject({ compact: true });
    await backend.close();
  });
});
