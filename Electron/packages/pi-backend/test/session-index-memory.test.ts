import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiHostBackend } from "../src/index.js";

async function writeLargeSession(path: string, id: string, cwd: string): Promise<void> {
  const file = await open(path, "w");
  try {
    await file.write(JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
    for (let i = 0; i < 175; i++) {
      await file.write(JSON.stringify({ type: "message", id: `${id}-m-${i}`, parentId: i ? `${id}-m-${i - 1}` : null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "x".repeat(60_000) } }) + "\n");
    }
    await file.write(JSON.stringify({ type: "session_info", id: `${id}-name`, parentId: `${id}-m-174`, timestamp: "2026-08-10T01:00:00.000Z", name: `Large ${id}` }) + "\n");
  } finally {
    await file.close();
  }
}

describe("lazy session metadata index", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("lists projects and sessions without loading synthetic large JSONL bodies", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-index-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "--project--");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 12; i++) await writeLargeSession(join(dir, `large-${i}.jsonl`), `large-${i}`, cwd);
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const before = process.memoryUsage().heapUsed;
    const projects = (await backend.handle("listProjects", [])) as { id: string }[];
    const sessions = (await backend.handle("listSessions", [projects[0].id])) as { name: string; id: string }[];
    const growth = process.memoryUsage().heapUsed - before;
    expect(sessions).toHaveLength(12);
    expect(sessions[0].name).toMatch(/^Large /);
    expect(growth).toBeLessThan(200 * 1024 * 1024);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await backend.handle("getSessionHistory", [sessions[0].id, 0, 1])).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("SessionManager skipped"));
    warning.mockRestore();
    await backend.close();
  });

  it("looks up a known session without rescanning files added after the last index", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-lookup-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "a.jsonl"),
      [
        JSON.stringify({ type: "session", version: 3, id: "session-a", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
        JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "keep" } }),
      ].join("\n") + "\n",
    );
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const projects = (await backend.handle("listProjects", [])) as { id: string }[];
    await backend.handle("listSessions", [projects[0].id]);
    await writeFile(
      join(dir, "b.jsonl"),
      [
        JSON.stringify({ type: "session", version: 3, id: "session-b", timestamp: "2026-08-10T00:00:00.000Z", cwd }),
        JSON.stringify({ type: "message", id: "u2", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "late" } }),
      ].join("\n") + "\n",
    );
    const generations = (backend as { indexGenerations: number }).indexGenerations;
    const history = (await backend.handle("getSessionHistory", ["session-a"])) as { content: string }[];
    expect(history[0]?.content).toBe("keep");
    expect((backend as { indexGenerations: number }).indexGenerations).toBe(generations);
    const late = (await backend.handle("getSessionHistory", ["session-b"])) as { content: string }[];
    expect(late[0]?.content).toBe("late");
    expect((backend as { indexGenerations: number }).indexGenerations).toBe(generations + 1);
    await backend.close();
  });

  it("opens the newest page of a long session and pages backward without gaps or duplicates", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-history-pages-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const rows: unknown[] = [
      { type: "session", version: 3, id: "long-session", timestamp: "2026-08-10T00:00:00.000Z", cwd },
    ];
    for (let i = 0; i < 1_201; i++) {
      rows.push({
        type: "message",
        id: `m-${i}`,
        parentId: i ? `m-${i - 1}` : null,
        timestamp: new Date(Date.UTC(2026, 7, 10, 0, 0, i)).toISOString(),
        message: { role: "user", content: `${i}:${"x".repeat(4_000)}` },
      });
    }
    await writeFile(join(dir, "long.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);

    const latest = await backend.handle("getSessionHistory", ["long-session"]) as any[];
    const previous = await backend.handle("getSessionHistory", ["long-session", 500, 500]) as any[];
    const oldest = await backend.handle("getSessionHistory", ["long-session", 1_000, 500]) as any[];

    expect(latest).toHaveLength(500);
    expect(latest[0].id).toBe("m-701");
    expect(latest.at(-1).id).toBe("m-1200");
    expect(previous[0].id).toBe("m-201");
    expect(previous.at(-1).id).toBe("m-700");
    expect(oldest.map(entry => entry.id)).toEqual(Array.from({ length: 201 }, (_, i) => `m-${i}`));
    const allIds = [...oldest, ...previous, ...latest].map(entry => entry.id);
    expect(new Set(allIds).size).toBe(1_201);
    await backend.close();
  });

  it("keeps SessionManager active-branch semantics in the large-file streaming fallback", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-large-branch-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const rows = [
      { type: "session", version: 3, id: "large-branch", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      { type: "message", id: "u1", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "root" } },
      { type: "message", id: "abandoned", parentId: "u1", timestamp: "2026-08-10T00:00:02.000Z", message: { role: "assistant", content: `abandoned ${"x".repeat(4_200_000)}` } },
      { type: "message", id: "active", parentId: "u1", timestamp: "2026-08-10T00:00:03.000Z", message: { role: "assistant", content: "active leaf" } },
    ];
    await writeFile(join(dir, "large-branch.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions"), canonicalProjectPaths: async () => undefined });
    await backend.handle("setProjectPaths", [[cwd]]);

    const entries = await backend.handle("getSessionHistory", ["large-branch"]) as any[];
    expect(entries.map(entry => entry.id)).toEqual(["u1", "active"]);
    await backend.close();
  });

  it("matches SessionManager visible ordering when compaction moves its summary before retained context", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-large-compaction-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "large-compaction.jsonl");
    const rows = [
      { type: "session", version: 3, id: "large-compaction", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      { type: "message", id: "u0", parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "old root" } },
      { type: "message", id: "a0", parentId: "u0", timestamp: "2026-08-10T00:00:02.000Z", message: { role: "assistant", content: `old body ${"x".repeat(4_200_000)}` } },
      { type: "message", id: "u1", parentId: "a0", timestamp: "2026-08-10T00:00:03.000Z", message: { role: "user", content: "retained user" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-10T00:00:04.000Z", message: { role: "assistant", content: "retained assistant" } },
      { type: "compaction", id: "compact", parentId: "a1", timestamp: "2026-08-10T00:00:05.000Z", summary: "summary", firstKeptEntryId: "u1", tokensBefore: 100 },
      { type: "message", id: "u2", parentId: "compact", timestamp: "2026-08-10T00:00:06.000Z", message: { role: "user", content: "after" } },
    ];
    await writeFile(path, rows.map(JSON.stringify).join("\n") + "\n");
    const manager = SessionManager.open(path);
    const expectedIds = manager.buildContextEntries()
      .filter((entry: any) => entry.type === "message" || (entry.type === "custom_message" && entry.display) || (entry.type === "compaction" && entry.summary))
      .map((entry: any) => entry.id);
    const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions"), canonicalProjectPaths: async () => undefined });
    await backend.handle("setProjectPaths", [[cwd]]);

    const entries = await backend.handle("getSessionHistory", ["large-compaction"]) as any[];
    expect(entries.map(entry => entry.id)).toEqual(expectedIds);
    await backend.close();
  });

  it("uses an exclusive entry-id cursor without shifting when new messages append between pages", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-stable-cursor-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "stable-cursor.jsonl");
    const rows: any[] = [{ type: "session", version: 3, id: "stable-cursor", timestamp: "2026-08-10T00:00:00.000Z", cwd }];
    for (let i = 0; i < 601; i++) rows.push({ type: "message", id: `m-${i}`, parentId: i ? `m-${i - 1}` : null, timestamp: new Date(Date.UTC(2026, 7, 10, 0, 0, i)).toISOString(), message: { role: "user", content: `${i}:${"x".repeat(7_000)}` } });
    await writeFile(path, rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({ agentDir: join(root, "agent"), sessionsRoot: join(root, "sessions"), canonicalProjectPaths: async () => undefined });
    await backend.handle("setProjectPaths", [[cwd]]);
    const latest = await backend.handle("getSessionHistory", ["stable-cursor"]) as any[];
    expect(latest[0].id).toBe("m-101");

    const appended: any[] = [];
    for (let i = 601; i < 621; i++) appended.push({ type: "message", id: `m-${i}`, parentId: `m-${i - 1}`, timestamp: new Date(Date.UTC(2026, 7, 10, 0, 0, i)).toISOString(), message: { role: "user", content: `${i}:${"y".repeat(7_000)}` } });
    await writeFile(path, appended.map(JSON.stringify).join("\n") + "\n", { flag: "a" });
    const older = await backend.handle("getSessionHistory", ["stable-cursor", latest[0].id, 500]) as any[];
    const originalIds = [...older, ...latest].map(entry => entry.id);
    expect(originalIds).toEqual(Array.from({ length: 601 }, (_, i) => `m-${i}`));
    expect(new Set(originalIds).size).toBe(601);
    await writeFile(path, JSON.stringify({ type: "compaction", id: "new-compaction", parentId: "m-620", timestamp: "2026-08-10T01:00:00.000Z", summary: "new summary", firstKeptEntryId: "m-500", tokensBefore: 1_000 }) + "\n", { flag: "a" });
    await expect(backend.handle("getSessionHistory", ["stable-cursor", latest[0].id, 500]))
      .rejects.toThrow(`history cursor no longer exists: ${latest[0].id}`);
    await backend.close();
  });

  it("finds the latest valid metadata even when it is outside both fixed metadata windows", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-middle-meta-"));
    const cwd = join(root, "project");
    const dir = join(root, "sessions", "project");
    await mkdir(dir, { recursive: true });
    const padding = (id: string) => ({
      type: "message",
      id,
      parentId: null,
      timestamp: "2026-08-10T00:00:01.000Z",
      message: { role: "user", content: "x".repeat(2_200_000) },
    });
    const rows = [
      { type: "session", version: 3, id: "middle-meta", timestamp: "2026-08-10T00:00:00.000Z", cwd },
      padding("before"),
      { type: "session_info", id: "name", parentId: "before", timestamp: "2026-08-10T00:00:02.000Z", name: "Middle title" },
      { type: "model_change", id: "model", parentId: "name", timestamp: "2026-08-10T00:00:03.000Z", provider: "openai", modelId: "gpt-5" },
      { type: "thinking_level_change", id: "thinking", parentId: "model", timestamp: "2026-08-10T00:00:04.000Z", thinkingLevel: "high" },
      padding("after"),
    ];
    await writeFile(join(dir, "middle-meta.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
    });
    await backend.handle("setProjectPaths", [[cwd]]);
    const [project] = await backend.handle("listProjects", []) as any[];
    const [session] = await backend.handle("listSessions", [project.id]) as any[];

    expect(session).toMatchObject({
      id: "middle-meta",
      name: "Middle title",
      model: { provider: "openai", modelId: "gpt-5" },
    });
    expect((backend as any).sessionById.get("middle-meta")?.thinkingLevel).toBe("high");
    await backend.close();
  });
});
