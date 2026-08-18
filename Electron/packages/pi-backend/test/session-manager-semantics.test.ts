import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiHostBackend } from "../src/index.js";

function userContents(history: { role?: string; content?: string }[]) {
  return history.filter(entry => entry.role === "user").map(entry => entry.content);
}

describe("SessionManager session semantics", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  it("matches pi title/cwd and keeps the full leaf branch visible", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-semantic-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "semantic.jsonl");
    const rows = [
      { type: "session", version: 3, id: "semantic", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "first" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-10T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "last active" }] } },
      { type: "session_info", id: "n1", parentId: "a1", timestamp: "2026-08-10T00:00:03.000Z", name: "Official title" },
    ];
    await writeFile(path, rows.map(JSON.stringify).join("\n") + "\n");
    const manager = SessionManager.open(path);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const [project] = await backend.handle("listProjects", []) as any[];
    const [session] = await backend.handle("listSessions", [project.id]) as any[];
    const history = await backend.handle("getSessionHistory", ["semantic", 0, 500]) as any[];
    expect(project.path).toBe(manager.getCwd());
    expect(session.name).toBe(manager.getSessionName());
    expect(userContents(history)).toEqual(["first"]);
    expect(history.map(entry => entry.content)).toEqual(["first", "last active"]);
  });

  it("keeps pre-compaction users in getSessionHistory after firstKept", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-history-compact-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "compacted.jsonl");
    const rows = [
      { type: "session", version: 3, id: "compacted", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "user1" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-10T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "asst1" }] } },
      { type: "message", id: "u2", parentId: "a1", timestamp: "2026-08-10T00:00:03.000Z", message: { role: "user", content: "user2" } },
      { type: "message", id: "a2", parentId: "u2", timestamp: "2026-08-10T00:00:04.000Z", message: { role: "assistant", content: [{ type: "text", text: "asst2" }] } },
      { type: "compaction", id: "c1", parentId: "a2", timestamp: "2026-08-10T00:00:05.000Z", summary: "compacted earlier turns", firstKeptEntryId: "u2", tokensBefore: 99 },
      { type: "message", id: "u3", parentId: "c1", timestamp: "2026-08-10T00:00:06.000Z", message: { role: "user", content: "user3" } },
      { type: "message", id: "a3", parentId: "u3", timestamp: "2026-08-10T00:00:07.000Z", message: { role: "assistant", content: [{ type: "text", text: "asst3" }] } },
    ];
    await writeFile(path, rows.map(JSON.stringify).join("\n") + "\n");
    const manager = SessionManager.open(path);
    const contextUsers = manager.buildContextEntries()
      .filter((entry: any) => entry.type === "message" && entry.message?.role === "user")
      .map((entry: any) => entry.message.content);
    expect(contextUsers).not.toContain("user1");

    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const history = await backend.handle("getSessionHistory", ["compacted", 0, 500]) as any[];
    expect(userContents(history)).toEqual(["user1", "user2", "user3"]);
    expect(history.map(entry => ({ id: entry.id, role: entry.role }))).toEqual([
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
      { id: "u2", role: "user" },
      { id: "a2", role: "assistant" },
      { id: "c1", role: "compaction" },
      { id: "u3", role: "user" },
      { id: "a3", role: "assistant" },
    ]);
    expect(history.find(entry => entry.id === "c1")).toMatchObject({ role: "compaction", content: "compacted earlier turns" });
  });

  it("keeps every pre-compaction bubble across multiple compact points and empty summaries", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-history-multi-compact-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "multi.jsonl");
    const rows = [
      { type: "session", version: 3, id: "multi", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "old" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-10T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "a1" }] } },
      { type: "compaction", id: "c1", parentId: "a1", timestamp: "2026-08-10T00:00:03.000Z", summary: "first cut", firstKeptEntryId: "u1" },
      { type: "message", id: "u2", parentId: "c1", timestamp: "2026-08-10T00:00:04.000Z", message: { role: "user", content: "mid" } },
      { type: "message", id: "a2", parentId: "u2", timestamp: "2026-08-10T00:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "a2" }] } },
      { type: "compaction", id: "c2", parentId: "a2", timestamp: "2026-08-10T00:00:06.000Z", firstKeptEntryId: "u2" },
      { type: "message", id: "u3", parentId: "c2", timestamp: "2026-08-10T00:00:07.000Z", message: { role: "user", content: "new" } },
    ];
    await writeFile(path, rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const history = await backend.handle("getSessionHistory", ["multi", 0, 500]) as any[];
    expect(history.map(entry => entry.id)).toEqual(["u1", "a1", "c1", "u2", "a2", "c2", "u3"]);
    expect(history.filter(entry => entry.role === "compaction").map(entry => entry.content)).toEqual(["first cut", ""]);
  });

  it("stitches a metadata parentId=null reroot so earlier users stay visible", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-history-reroot-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "reroot.jsonl");
    const rows = [
      { type: "session", version: 3, id: "reroot", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "user1" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-10T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "asst1" }] } },
      { type: "thinking_level_change", id: "t-null", parentId: null, timestamp: "2026-08-10T00:00:03.000Z", thinkingLevel: "xhigh" },
      { type: "message", id: "u2", parentId: "t-null", timestamp: "2026-08-10T00:00:04.000Z", message: { role: "user", content: "user2" } },
      { type: "message", id: "a2", parentId: "u2", timestamp: "2026-08-10T00:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "asst2" }] } },
    ];
    await writeFile(path, rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const history = await backend.handle("getSessionHistory", ["reroot", 0, 500]) as any[];
    expect(userContents(history)).toEqual(["user1", "user2"]);
  });

  it("parents a cold thinking_level_change to the current JSONL leaf", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-cold-think-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    const agent = join(root, "agent");
    await mkdir(dir, { recursive: true });
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, "models.json"), JSON.stringify({
      providers: {
        relay: {
          apiKey: "k",
          models: [{ id: "model-a", name: "Model A", reasoning: true }],
        },
      },
    }));
    const path = join(dir, "cold.jsonl");
    await writeFile(path, [
      JSON.stringify({ type: "session", version: 3, id: "cold", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
      JSON.stringify({ type: "message", id: "leaf-u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "hello" } }),
    ].join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: agent,
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
      env: { RELAY_KEY: "present" },
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    await backend.handle("setThinkingLevel", ["cold", "high"]);
    const { readFile } = await import("node:fs/promises");
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.type).toBe("thinking_level_change");
    expect(last.parentId).toBe("leaf-u1");
  });
});
