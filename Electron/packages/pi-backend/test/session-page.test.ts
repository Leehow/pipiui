import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiHostBackend, projectPiSessionsDir } from "../src/index.js";

function sessionRows(id: string, cwd: string, count = 1): string {
  const rows: unknown[] = [
    { type: "session", version: 3, id, timestamp: "2026-08-01T00:00:00.000Z", cwd },
    { type: "session_info", id: `${id}-name`, parentId: null, timestamp: "2026-08-01T00:00:00.001Z", name: `Session ${id}` },
    { type: "model_change", id: `${id}-model`, parentId: null, timestamp: "2026-08-01T00:00:00.002Z", provider: "openai", modelId: "gpt-5" },
    { type: "thinking_level_change", id: `${id}-thinking`, parentId: null, timestamp: "2026-08-01T00:00:00.003Z", thinkingLevel: "high" },
  ];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      type: "message",
      id: `${id}-message-${index}`,
      parentId: index ? `${id}-message-${index - 1}` : `${id}-thinking`,
      timestamp: new Date(Date.UTC(2026, 7, 1, 0, 0, index + 1)).toISOString(),
      message: { role: index % 2 ? "assistant" : "user", content: `body ${id} ${index}` },
    });
  }
  return rows.map(JSON.stringify).join("\n") + "\n";
}

describe("project-scoped lazy session pages", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });

  it("returns ten sessions at a time without starting the global index", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-page-"));
    const project = join(root, "project");
    const sessionsDir = projectPiSessionsDir(project);
    await mkdir(sessionsDir, { recursive: true });
    for (let index = 0; index < 25; index += 1) {
      const id = `session-${String(index).padStart(2, "0")}`;
      const path = join(sessionsDir, `2026-08-01T00-00-${String(index).padStart(2, "0")}-000Z_${id}.jsonl`);
      await writeFile(path, sessionRows(id, project));
      const timestamp = new Date(Date.UTC(2026, 7, 1, 0, 0, index));
      await utimes(path, timestamp, timestamp);
    }
    const backend = createPiHostBackend({
      agentDir: join(root, "profile"),
      sessionsRoot: join(root, "profile", "sessions"),
      canonicalProjectPaths: async () => undefined,
      profileMode: "isolated",
    });
    await backend.handle("setProjectPaths", [[project]]);
    const [listedProject] = await backend.handle("listProjects", []) as Array<{ id: string }>;
    const generations = (backend as unknown as { indexGenerations: number }).indexGenerations;

    const first = await backend.handle("listSessionPage" as never, [listedProject.id, undefined, 10]) as {
      sessions: Array<{ id: string }>;
      nextCursor?: string;
      hasMore: boolean;
    };
    expect(first.sessions.map(session => session.id)).toEqual(
      Array.from({ length: 10 }, (_, offset) => `session-${String(24 - offset).padStart(2, "0")}`),
    );
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    expect((backend as unknown as { indexGenerations: number }).indexGenerations).toBe(generations);

    const second = await backend.handle("listSessionPage" as never, [listedProject.id, first.nextCursor, 10]) as {
      sessions: Array<{ id: string }>;
      nextCursor?: string;
      hasMore: boolean;
    };
    expect(second.sessions.map(session => session.id)).toEqual(
      Array.from({ length: 10 }, (_, offset) => `session-${String(14 - offset).padStart(2, "0")}`),
    );
    expect(second.hasMore).toBe(true);
    await backend.close();
  });

  it("locates the remembered session directly and preloads its complete transcript", async () => {
    root = await mkdtemp(join(tmpdir(), "pipi-session-preload-"));
    const project = join(root, "project");
    const sessionsDir = projectPiSessionsDir(project);
    await mkdir(sessionsDir, { recursive: true });
    const sessionId = "remembered-session";
    await writeFile(
      join(sessionsDir, `2026-08-01T00-00-00-000Z_${sessionId}.jsonl`),
      sessionRows(sessionId, project, 1_001),
    );
    const agentDir = join(root, "profile");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "pipiui-agent-index.json"), JSON.stringify({
      version: 1,
      agents: [{ agentId: "researcher", runId: "research-run", name: "researcher", task: "inspect", state: "ok", sessionId }],
      worktrees: [],
    }));
    await writeFile(join(agentDir, "pipiui-agent-logs.json"), JSON.stringify({
      version: 1,
      logs: { [`${sessionId}\u0000researcher\u0000research-run`]: [{ itemType: "text", text: "complete log" }] },
    }));
    const backend = createPiHostBackend({
      agentDir,
      sessionsRoot: join(root, "profile", "sessions"),
      canonicalProjectPaths: async () => undefined,
      profileMode: "isolated",
    });
    await backend.handle("setProjectPaths", [[project]]);
    const [listedProject] = await backend.handle("listProjects", []) as Array<{ id: string }>;
    const generations = (backend as unknown as { indexGenerations: number }).indexGenerations;

    const session = await backend.handle("getSession" as never, [listedProject.id, sessionId]) as { id: string };
    const preload = await backend.handle("preloadSession" as never, [sessionId]) as {
      history: Array<{ id: string }>;
      agents: unknown[];
      agentLogs: unknown[];
    };
    expect(session.id).toBe(sessionId);
    expect(preload.history).toHaveLength(1_001);
    expect(preload.history[0]?.id).toBe(`${sessionId}-message-0`);
    expect(preload.history.at(-1)?.id).toBe(`${sessionId}-message-1000`);
    expect(preload.agents).toEqual([expect.objectContaining({ agentId: "researcher", runId: "research-run", sessionId })]);
    expect(preload.agentLogs).toEqual([expect.objectContaining({
      agentId: "researcher",
      runId: "research-run",
      entries: [expect.objectContaining({ text: "complete log" })],
    })]);
    expect((backend as unknown as { indexGenerations: number }).indexGenerations).toBe(generations);
    await backend.close();
  });
});
