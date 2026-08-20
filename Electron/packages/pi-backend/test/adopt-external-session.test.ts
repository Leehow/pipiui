import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import {
  buildAdoptedPiSessionJsonl,
  canAdoptExternalHistory,
  importableExternalEntries,
  parseAdoptedExternalMap,
  writeAdoptedExternalMap,
} from "../src/adopt-external-session.js";
import { encodeClaudeProjectDir } from "../src/external-sessions.js";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

describe("adopt converter", () => {
  it("builds a version-3 Pi session with parent chain and skips non-text roles", () => {
    const built = buildAdoptedPiSessionJsonl({
      cwd: "/tmp/proj",
      title: "Claude keep",
      source: "claude",
      externalSessionId: "ext:claude:keep",
      now: new Date("2026-08-10T00:00:00.000Z"),
      sessionId: "adopted-1",
      entries: [
        { id: "u1", role: "user", content: "hello", timestamp: Date.parse("2026-08-10T00:00:01.000Z") },
        { id: "s1", role: "system", content: "ignore", timestamp: Date.parse("2026-08-10T00:00:02.000Z") },
        { id: "a1", role: "assistant", content: "world", timestamp: Date.parse("2026-08-10T00:00:03.000Z") },
      ],
    });
    const rows = built.lines.map((line) => JSON.parse(line));
    expect(rows[0]).toMatchObject({ type: "session", version: 3, id: "adopted-1", cwd: "/tmp/proj" });
    expect(rows[1]).toMatchObject({
      type: "session_info",
      parentId: null,
      name: "Claude keep",
      adoptedFrom: { source: "claude", externalSessionId: "ext:claude:keep" },
    });
    expect(rows[2]).toMatchObject({
      type: "message",
      parentId: rows[1].id,
      message: { role: "user", content: "hello" },
    });
    expect(rows[3]).toMatchObject({
      type: "message",
      parentId: rows[2].id,
      message: { role: "assistant", content: [{ type: "text", text: "world" }] },
    });
    expect(rows).toHaveLength(4);
  });

  it("rejects histories without importable user/assistant text", () => {
    expect(canAdoptExternalHistory({ availability: "metadata", entries: [] })).toBe(false);
    expect(importableExternalEntries({
      availability: "text",
      entries: [{ id: "s", role: "system", content: "only system", timestamp: 1 }],
    })).toEqual([]);
    expect(() => buildAdoptedPiSessionJsonl({
      cwd: "/tmp/p",
      title: "x",
      source: "opencode",
      externalSessionId: "ext:opencode:x",
      entries: [],
    })).toThrow(/没有可导入的正文/);
  });

  it("parses the project-local mapping file", () => {
    expect(parseAdoptedExternalMap({
      version: 1,
      entries: { "ext:claude:a": "pi-1", nope: "x", "ext:codex:b": "  " },
    })).toEqual({ "ext:claude:a": "pi-1" });
  });
});

describe("adoptExternalSession API", () => {
  it("imports text history once, is idempotent, and does not write the original file", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-adopt-"));
    const home = join(root, "home");
    const project = join(root, "proj");
    const claudeDir = join(home, ".claude", "projects", encodeClaudeProjectDir(project));
    await mkdir(project, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    const originalPath = join(claudeDir, "claude-keep.jsonl");
    const original = jsonl([
      { type: "user", cwd: project, sessionId: "claude-keep", uuid: "cu1", timestamp: "2026-08-01T00:00:00.000Z", message: { role: "user", content: "keep claude" } },
      { type: "assistant", cwd: project, sessionId: "claude-keep", uuid: "ca1", timestamp: "2026-08-01T00:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "ok claude" }] } },
      { type: "custom-title", sessionId: "claude-keep", customTitle: "Claude keep" },
    ]);
    await writeFile(originalPath, original);

    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
      externalSessionRoots: { home },
      env: { ...process.env, HOME: home },
    });
    try {
      await backend.handle("setProjectPaths", [[project]]);
      const projects = await backend.handle("listProjects", []) as { id: string }[];
      const projectId = projects[0].id;
      const first = await backend.handle("adoptExternalSession", ["ext:claude:claude-keep"]) as {
        id: string;
        name: string;
        adoptedFrom?: { source: string; externalSessionId: string };
      };
      expect(first.name).toBe("Claude keep");
      expect(first.adoptedFrom).toEqual({ source: "claude", externalSessionId: "ext:claude:claude-keep" });

      const second = await backend.handle("adoptExternalSession", ["ext:claude:claude-keep"]) as { id: string };
      expect(second.id).toBe(first.id);

      const listed = await backend.handle("listExternalSessions", [projectId]) as { id: string }[];
      expect(listed.some((item) => item.id === "ext:claude:claude-keep")).toBe(false);
      const sessions = await backend.handle("listSessions", [projectId]) as { id: string; adoptedFrom?: { source: string } }[];
      expect(sessions.filter((item) => item.id === first.id)).toHaveLength(1);
      expect(sessions.find((item) => item.id === first.id)?.adoptedFrom?.source).toBe("claude");

      const history = await backend.handle("getSessionHistory", [first.id]) as { role: string; content: string }[];
      expect(history.map((item) => `${item.role}:${item.content}`)).toEqual([
        "user:keep claude",
        "assistant:ok claude",
      ]);

      expect(await readFile(originalPath, "utf8")).toBe(original);

      await backend.handle("deleteSession", [first.id]);
      const restored = await backend.handle("listExternalSessions", [projectId]) as { id: string }[];
      expect(restored.some((item) => item.id === "ext:claude:claude-keep")).toBe(true);
    } finally {
      await backend.close();
    }
  });

  it("refuses metadata-only sources and leaves the mapping empty", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-adopt-meta-"));
    const home = join(root, "home");
    const project = join(root, "proj");
    await mkdir(project, { recursive: true });
    await mkdir(join(home, ".local", "share", "opencode"), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(home, ".local", "share", "opencode", "opencode.db"));
    db.exec("CREATE TABLE session (id TEXT, title TEXT, directory TEXT, path TEXT, time_updated INTEGER, metadata TEXT)");
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run("oc-keep", "OpenCode keep", project, project, Date.now(), "{}");
    db.close();

    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
      externalSessionRoots: { home },
      env: { ...process.env, HOME: home },
    });
    try {
      await backend.handle("setProjectPaths", [[project]]);
      await expect(backend.handle("adoptExternalSession", ["ext:opencode:oc-keep"])).rejects.toThrow(/没有可导入的正文/);
      const projects = await backend.handle("listProjects", []) as { id: string }[];
      const listed = await backend.handle("listExternalSessions", [projects[0].id]) as { id: string }[];
      expect(listed.some((item) => item.id === "ext:opencode:oc-keep")).toBe(true);
    } finally {
      await backend.close();
    }
  });

  it("does not hide the original row when a stale mapping points at a missing session", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-adopt-stale-"));
    const home = join(root, "home");
    const project = join(root, "proj");
    const claudeDir = join(home, ".claude", "projects", encodeClaudeProjectDir(project));
    await mkdir(project, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "claude-keep.jsonl"), jsonl([
      { type: "user", cwd: project, sessionId: "claude-keep", uuid: "cu1", timestamp: "2026-08-01T00:00:00.000Z", message: { role: "user", content: "keep claude" } },
    ]));
    await writeAdoptedExternalMap(join(project, ".pi", "agent"), { "ext:claude:claude-keep": "missing-pi" });

    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
      externalSessionRoots: { home },
      env: { ...process.env, HOME: home },
    });
    try {
      await backend.handle("setProjectPaths", [[project]]);
      const projects = await backend.handle("listProjects", []) as { id: string }[];
      const listed = await backend.handle("listExternalSessions", [projects[0].id]) as { id: string }[];
      expect(listed.some((item) => item.id === "ext:claude:claude-keep")).toBe(true);
    } finally {
      await backend.close();
    }
  });
});
