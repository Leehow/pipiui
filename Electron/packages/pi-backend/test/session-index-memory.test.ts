import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiHostBackend } from "../src/index.js";

async function writeLargeSession(path: string, id: string, cwd: string): Promise<void> {
  const file = await open(path, "w");
  try {
    await file.write(JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-10T00:00:00.000Z", cwd }) + "\n");
    const line = JSON.stringify({ type: "message", id: `${id}-m`, parentId: null, timestamp: "2026-08-10T00:00:01.000Z", message: { role: "user", content: "x".repeat(60_000) } }) + "\n";
    for (let i = 0; i < 175; i++) await file.write(line);
    await file.write(JSON.stringify({ type: "session_info", id: `${id}-name`, parentId: null, timestamp: "2026-08-10T01:00:00.000Z", name: `Large ${id}` }) + "\n");
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
});
