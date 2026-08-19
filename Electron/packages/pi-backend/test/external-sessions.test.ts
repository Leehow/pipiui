import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createPiHostBackend } from "../src/index.js";
import {
  cleanExternalTitle,
  encodeClaudeProjectDir,
  encodeCursorProjectDir,
  encodeGrokSessionDir,
  EXTERNAL_SQLITE_FORBIDDEN_TABLES,
  listExternalSessionsForProject,
  openReadonlySqlite,
  queryReadonlySqlite,
  readExternalSessionHistory,
  resolveExternalSessionRoots,
} from "../src/external-sessions.js";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function fixtureHome() {
  root = await mkdtemp(join(tmpdir(), "pipi-ext-sessions-"));
  const project = join(root, "proj");
  const other = join(root, "other");
  const home = join(root, "home");
  await mkdir(project, { recursive: true });
  await mkdir(other, { recursive: true });
  return { home, project, other };
}

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

async function writeSqlite(path: string, exec: (db: DatabaseSync) => void) {
  await mkdir(join(path, ".."), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    exec(db);
  } finally {
    db.close();
  }
}

async function seedSources(home: string, project: string, other: string, options?: { corruptClaude?: boolean; breakOpenCode?: boolean }) {
  const claudeDir = join(home, ".claude", "projects", encodeClaudeProjectDir(project));
  const otherClaudeDir = join(home, ".claude", "projects", encodeClaudeProjectDir(other));
  await mkdir(claudeDir, { recursive: true });
  await mkdir(otherClaudeDir, { recursive: true });
  await writeFile(
    join(claudeDir, "claude-keep.jsonl"),
    jsonl([
      { type: "user", cwd: project, sessionId: "claude-keep", uuid: "cu1", timestamp: "2026-08-01T00:00:00.000Z", message: { role: "user", content: "keep claude" } },
      { type: "assistant", cwd: project, sessionId: "claude-keep", uuid: "ca1", timestamp: "2026-08-01T00:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "ok claude" }, { type: "tool_use", name: "bash", input: { command: "secret" } }] } },
      { type: "custom-title", sessionId: "claude-keep", customTitle: "Claude keep" },
    ]),
  );
  if (options?.corruptClaude) {
    await writeFile(join(claudeDir, "claude-broken.jsonl"), "{not-json\n");
  }
  await writeFile(
    join(otherClaudeDir, "claude-other.jsonl"),
    jsonl([{ type: "user", cwd: other, sessionId: "claude-other", uuid: "ou1", timestamp: "2026-08-02T00:00:00.000Z", message: { role: "user", content: "other claude" } }]),
  );

  const codexSessions = join(home, ".codex", "sessions", "2026", "08", "01");
  await mkdir(codexSessions, { recursive: true });
  await writeFile(
    join(home, ".codex", "session_index.jsonl"),
    jsonl([
      { id: "codex-keep", thread_name: "Codex keep", updated_at: "2026-08-03T00:00:00.000Z" },
      { id: "codex-other", thread_name: "Codex other", updated_at: "2026-08-04T00:00:00.000Z" },
    ]),
  );
  await writeFile(
    join(codexSessions, "rollout-2026-08-01T00-00-00-codex-keep.jsonl"),
    jsonl([
      { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { id: "codex-keep", cwd: project } },
      { timestamp: "2026-08-01T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "keep codex" }] } },
      { timestamp: "2026-08-01T00:00:02.000Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: "rm -rf /" } },
    ]),
  );
  await writeFile(
    join(codexSessions, "rollout-2026-08-01T00-00-00-codex-other.jsonl"),
    jsonl([
      { timestamp: "2026-08-04T00:00:00.000Z", type: "session_meta", payload: { id: "codex-other", cwd: other } },
      { timestamp: "2026-08-04T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "other codex" }] } },
    ]),
  );

  const grokDir = join(home, ".grok", "sessions", encodeGrokSessionDir(project), "grok-keep");
  const grokOther = join(home, ".grok", "sessions", encodeGrokSessionDir(other), "grok-other");
  await mkdir(grokDir, { recursive: true });
  await mkdir(grokOther, { recursive: true });
  await writeFile(join(grokDir, "summary.json"), JSON.stringify({
    info: { id: "grok-keep", cwd: project },
    session_summary: "Grok keep",
    updated_at: "2026-08-05T00:00:00.000Z",
    last_active_at: "2026-08-05T00:00:00.000Z",
  }));
  await writeFile(join(grokDir, "chat_history.jsonl"), jsonl([
    { type: "user", content: "keep grok" },
    { type: "assistant", content: "ok grok" },
  ]));
  await writeFile(join(grokOther, "summary.json"), JSON.stringify({
    info: { id: "grok-other", cwd: other },
    session_summary: "Grok other",
    updated_at: "2026-08-06T00:00:00.000Z",
  }));

  const cursorTranscript = join(home, ".cursor", "projects", encodeCursorProjectDir(project), "agent-transcripts", "cursor-tr");
  const otherTranscript = join(home, ".cursor", "projects", encodeCursorProjectDir(other), "agent-transcripts", "cursor-tr-other");
  await mkdir(cursorTranscript, { recursive: true });
  await mkdir(otherTranscript, { recursive: true });
  await writeFile(join(cursorTranscript, "cursor-tr.jsonl"), jsonl([
    { title: "keep cursor", role: "user", message: { content: [{ type: "text", text: "do not use body" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "ok cursor" }, { type: "tool", name: "edit", input: { path: "secret" } }] } },
  ]));
  await writeFile(join(otherTranscript, "cursor-tr-other.jsonl"), jsonl([
    { role: "user", message: { content: [{ type: "text", text: "other cursor" }] } },
  ]));
  const chatDir = join(home, ".cursor", "chats", "bucket", "cursor-chat");
  const otherChatDir = join(home, ".cursor", "chats", "bucket", "cursor-chat-other");
  await mkdir(chatDir, { recursive: true });
  await mkdir(otherChatDir, { recursive: true });
  await writeFile(join(chatDir, "meta.json"), JSON.stringify({ schemaVersion: 1, cwd: project, title: "Cursor chat keep", updatedAtMs: Date.parse("2026-08-07T00:00:00.000Z") }));
  await writeFile(join(chatDir, "store.db"), "this is not opened");
  await writeFile(join(otherChatDir, "meta.json"), JSON.stringify({ schemaVersion: 1, cwd: other, updatedAtMs: Date.parse("2026-08-08T00:00:00.000Z") }));

  const opencodeDb = join(home, ".local", "share", "opencode", "opencode.db");
  if (!options?.breakOpenCode) {
    await writeSqlite(opencodeDb, (db) => {
      db.exec(`
        CREATE TABLE account (id TEXT, email TEXT, access_token TEXT);
        CREATE TABLE credential (id TEXT, value TEXT);
        CREATE TABLE message (id TEXT, session_id TEXT, data TEXT);
        CREATE TABLE session (
          id TEXT, title TEXT, directory TEXT, path TEXT, time_updated INTEGER, metadata TEXT
        );
        INSERT INTO account VALUES ('acc', 'a@b.c', 'tok-secret');
        INSERT INTO credential VALUES ('cred', 'secret');
        INSERT INTO message VALUES ('m1', 'oc-keep', 'body-secret');
        INSERT INTO session VALUES ('oc-keep', 'OpenCode keep', '${project}', '', 1786233600000, '{"prompt":"nope"}');
        INSERT INTO session VALUES ('oc-other', 'OpenCode other', '${other}', '', 1786320000000, '{}');
      `);
    });
  } else {
    await writeSqlite(opencodeDb, (db) => {
      db.exec("CREATE TABLE session (id TEXT); INSERT INTO session VALUES ('broken')");
    });
  }

  const zcodeDb = join(home, ".zcode", "v2", "tasks-index.sqlite");
  await writeSqlite(zcodeDb, (db) => {
    db.exec(`
      CREATE TABLE tasks (
        task_id TEXT, title TEXT, workspace_path TEXT, updated_at INTEGER,
        searchable_text TEXT, meta_json TEXT
      );
      CREATE TABLE automations (automation_id TEXT, prompt TEXT);
      INSERT INTO tasks VALUES ('z-keep', 'ZCode keep', '${project}', 1786406400000, 'fts-secret', '{"token":"nope"}');
      INSERT INTO tasks VALUES ('z-other', 'ZCode other', '${other}', 1786492800000, 'other', '{}');
      INSERT INTO automations VALUES ('auto', 'do not read');
    `);
  });

  return { home, project, other };
}

describe("external session aggregation", () => {
  it("lists only the current project cwd and sorts by updatedAt", async () => {
    const { home, project, other } = await fixtureHome();
    await seedSources(home, project, other);
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.map((item) => item.source).sort()).toEqual([
      "claude", "codex", "cursor", "cursor", "grok", "opencode", "zcode",
    ]);
    expect(listed.every((item) => item.cwd === project)).toBe(true);
    expect(listed.map((item) => item.id)).not.toEqual(expect.arrayContaining([
      "ext:claude:claude-other",
      "ext:codex:codex-other",
      "ext:grok:grok-other",
      "ext:opencode:oc-other",
      "ext:zcode:z-other",
    ]));
    const stamps = listed.map((item) => item.updatedAt);
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
    expect(listed.find((item) => item.source === "claude")).toMatchObject({
      title: "Claude keep",
      historyAvailability: "text",
    });
    expect(listed.find((item) => item.id === "ext:cursor:chat:cursor-chat")).toMatchObject({
      historyAvailability: "metadata",
    });
    expect(listed.find((item) => item.source === "opencode")).toMatchObject({
      title: "OpenCode keep",
      historyAvailability: "metadata",
    });
    expect(listed.find((item) => item.source === "zcode")).toMatchObject({
      title: "ZCode keep",
      historyAvailability: "metadata",
    });
    const otherListed = await listExternalSessionsForProject(other, { home });
    expect(otherListed.some((item) => item.id === "ext:claude:claude-other")).toBe(true);
    expect(otherListed.some((item) => item.id === "ext:claude:claude-keep")).toBe(false);
  });

  it("returns plaintext JSONL/summary history and refuses unsafe full-text sources", async () => {
    const { home, project, other } = await fixtureHome();
    await seedSources(home, project, other);
    const claude = await readExternalSessionHistory("ext:claude:claude-keep", [project], { home });
    expect(claude.availability).toBe("text");
    expect(claude.entries.map((entry) => entry.content)).toEqual(["keep claude", "ok claude"]);
    expect(JSON.stringify(claude)).not.toContain("secret");

    const grok = await readExternalSessionHistory("ext:grok:grok-keep", [project], { home });
    expect(grok.availability).toBe("text");
    expect(grok.summary).toBe("Grok keep");
    expect(grok.entries.map((entry) => entry.content)).toEqual(["keep grok", "ok grok"]);

    const cursorChat = await readExternalSessionHistory("ext:cursor:chat:cursor-chat", [project], { home });
    expect(cursorChat).toEqual({
      id: "ext:cursor:chat:cursor-chat",
      source: "cursor",
      availability: "metadata",
      entries: [],
    });

    const opencode = await readExternalSessionHistory("ext:opencode:oc-keep", [project], { home });
    expect(opencode.availability).toBe("metadata");
    expect(opencode.entries).toEqual([]);
    expect(JSON.stringify(opencode)).not.toMatch(/secret|prompt|token|body/i);

    await expect(readExternalSessionHistory("ext:claude:claude-other", [project], { home }))
      .rejects.toThrow(/unknown external session/);
    await expect(readExternalSessionHistory("ext:claude:claude-keep", [other], { home }))
      .rejects.toThrow(/unknown external session/);
  });

  it("isolates a broken source so the rest of the list still returns", async () => {
    const { home, project, other } = await fixtureHome();
    await seedSources(home, project, other, { corruptClaude: true, breakOpenCode: true });
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.some((item) => item.source === "codex")).toBe(true);
    expect(listed.some((item) => item.source === "zcode")).toBe(true);
    expect(listed.some((item) => item.source === "opencode")).toBe(false);
    expect(listed.filter((item) => item.source === "claude").map((item) => item.id)).toEqual(["ext:claude:claude-keep"]);
  });

  it("opens sqlite read-only and rejects forbidden tables or columns", async () => {
    const { home, project, other } = await fixtureHome();
    await seedSources(home, project, other);
    const dbPath = join(home, ".local", "share", "opencode", "opencode.db");
    const rows = queryReadonlySqlite(dbPath, { table: "session", columns: ["id", "title", "directory", "path", "time_updated"] });
    expect(rows.map((row) => row.id)).toEqual(["oc-keep", "oc-other"]);
    expect(JSON.stringify(rows)).not.toMatch(/secret|token|body|prompt/i);

    const ro = openReadonlySqlite(dbPath);
    try {
      expect(() => ro.exec("INSERT INTO session VALUES ('x', 'x', '/', '', 1, '{}')")).toThrow(/readonly/i);
    } finally {
      ro.close();
    }

    for (const table of EXTERNAL_SQLITE_FORBIDDEN_TABLES) {
      expect(() => queryReadonlySqlite(dbPath, { table, columns: ["id"] })).toThrow(/forbidden|allow-listed/);
    }
    expect(() => queryReadonlySqlite(dbPath, { table: "session", columns: ["id", "metadata"] })).toThrow(/allow-listed|forbidden/);
    expect(() => queryReadonlySqlite(join(home, ".zcode", "v2", "tasks-index.sqlite"), { table: "tasks", columns: ["task_id", "searchable_text"] })).toThrow(/forbidden|allow-listed/);
    expect(() => queryReadonlySqlite(join(home, ".zcode", "v2", "tasks-index.sqlite"), { table: "automations", columns: ["prompt"] })).toThrow(/forbidden|allow-listed/);
  });

  it("exposes the Host methods and refuses Pi lease/delete/send/resume", async () => {
    const { home, project } = await fixtureHome();
    await seedSources(home, project, join(root, "other"));
    const backend = createPiHostBackend({
      agentDir: join(root, "agent"),
      sessionsRoot: join(root, "sessions"),
      canonicalProjectPaths: async () => undefined,
      externalSessionRoots: { home },
      env: { ...process.env, HOME: home },
    });
    try {
      await backend.handle("setProjectPaths", [[project]]);
      const projects = await backend.handle("listProjects", []) as { id: string; path: string }[];
      const projectId = projects[0].id;
      const caps = await backend.handle("capabilities", []) as { externalSessions?: boolean };
      expect(caps.externalSessions).toBe(true);

      const listed = await backend.handle("listExternalSessions", [projectId]) as { id: string; source: string }[];
      expect(listed.some((item) => item.id === "ext:claude:claude-keep")).toBe(true);
      const piSessions = await backend.handle("listSessions", [projectId]) as { id: string }[];
      expect(piSessions.some((item) => item.id.startsWith("ext:"))).toBe(false);

      const history = await backend.handle("getExternalSessionHistory", ["ext:claude:claude-keep"]) as { entries: { content: string }[] };
      expect(history.entries.map((entry) => entry.content)).toContain("keep claude");

      await expect(backend.handle("resumeSession", ["ext:claude:claude-keep"])).rejects.toThrow(/read-only/);
      await expect(backend.handle("deleteSession", ["ext:claude:claude-keep"])).rejects.toThrow(/read-only/);
      await expect(backend.handle("sendPrompt", ["ext:claude:claude-keep", "hi"])).rejects.toThrow(/read-only/);
      await expect(backend.handle("getSessionLease", ["ext:claude:claude-keep"])).rejects.toThrow(/read-only/);
      await expect(backend.handle("forceTakeoverSessionLease", ["ext:claude:claude-keep"])).rejects.toThrow(/read-only/);
      await expect(backend.handle("getSessionHistory", ["ext:claude:claude-keep"])).rejects.toThrow(/read-only/);
    } finally {
      await backend.close();
    }
  });
});

describe("external session native titles", () => {
  it("prefers platform title fields for all six sources", async () => {
    const { home, project, other } = await fixtureHome();
    await seedSources(home, project, other);
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.source === "claude")?.title).toBe("Claude keep");
    expect(listed.find((item) => item.source === "codex")?.title).toBe("Codex keep");
    expect(listed.find((item) => item.source === "grok")?.title).toBe("Grok keep");
    expect(listed.find((item) => item.id === "ext:cursor:transcript:cursor-tr")?.title).toBe("keep cursor");
    expect(listed.find((item) => item.id === "ext:cursor:chat:cursor-chat")?.title).toBe("Cursor chat keep");
    expect(listed.find((item) => item.source === "opencode")?.title).toBe("OpenCode keep");
    expect(listed.find((item) => item.source === "zcode")?.title).toBe("ZCode keep");
  });

  it("falls back to source + short id only when every native title is blank", async () => {
    const { home, project } = await fixtureHome();
    const claudeDir = join(home, ".claude", "projects", encodeClaudeProjectDir(project));
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "blank-claude.jsonl"), jsonl([
      { type: "user", cwd: project, sessionId: "blank-claude", timestamp: "2026-08-01T00:00:00.000Z", customTitle: "   ", slug: "", summary: "" },
    ]));
    const grokDir = join(home, ".grok", "sessions", encodeGrokSessionDir(project), "blank-grok");
    await mkdir(grokDir, { recursive: true });
    await writeFile(join(grokDir, "summary.json"), JSON.stringify({
      info: { id: "blank-grok", cwd: project },
      title: " ",
      generated_title: "",
      session_summary: "",
      name: "",
      agent_name: "",
    }));
    const chatDir = join(home, ".cursor", "chats", "bucket", "blank-chat");
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "meta.json"), JSON.stringify({ cwd: project, title: "   " }));
    const day = join(home, ".codex", "sessions", "2026", "08", "01");
    await mkdir(day, { recursive: true });
    await writeFile(join(home, ".codex", "session_index.jsonl"), jsonl([
      { id: "blank-codex", thread_name: "  ", updated_at: "2026-08-03T00:00:00.000Z" },
    ]));
    await writeFile(join(day, "rollout-blank-codex.jsonl"), jsonl([
      { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { id: "blank-codex", cwd: project } },
      { timestamp: "2026-08-01T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "do not use body" } },
    ]));
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === "ext:claude:blank-claude")?.title).toBe("Claude blank-cl");
    expect(listed.find((item) => item.id === "ext:grok:blank-grok")?.title).toBe("Grok blank-gr");
    expect(listed.find((item) => item.id === "ext:cursor:chat:blank-chat")?.title).toBe("Cursor blank-ch");
    expect(listed.find((item) => item.id === "ext:codex:blank-codex")?.title).toBe("Codex blank-co");
  });

  it("uses Cursor chat meta.json title instead of dirname fallback", async () => {
    const { home, project } = await fixtureHome();
    const chatId = "a1b2c3d4e5f6";
    const chatDir = join(home, ".cursor", "chats", "bucket", chatId);
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "meta.json"), JSON.stringify({
      cwd: project,
      title: "Saved Cursor chat title",
    }));
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === `ext:cursor:chat:${chatId}`)?.title).toBe("Saved Cursor chat title");
    expect(listed.find((item) => item.id === `ext:cursor:chat:${chatId}`)?.title).not.toBe(`Cursor ${chatId.slice(0, 8)}`);
  });

  it("prefers Grok generated_title over session_summary and agent_name", async () => {
    const { home, project } = await fixtureHome();
    const grokDir = join(home, ".grok", "sessions", encodeGrokSessionDir(project), "grok-gen");
    await mkdir(grokDir, { recursive: true });
    await writeFile(join(grokDir, "summary.json"), JSON.stringify({
      info: { id: "grok-gen", cwd: project, title: "info title" },
      generated_title: "Generated Grok title",
      session_summary: "Summary must lose",
      agent_name: "Agent must lose",
      title: "plain title",
      name: "name field",
    }));
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === "ext:grok:grok-gen")?.title).toBe("Generated Grok title");
  });

  it("reads Cursor meta.json and store.db name, and ignores message bodies", async () => {
    const { home, project } = await fixtureHome();
    const chatDir = join(home, ".cursor", "chats", "bucket", "meta-title");
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "meta.json"), JSON.stringify({ cwd: project, title: "Meta title" }));

    const storeDir = join(home, ".cursor", "chats", "bucket", "store-title");
    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, "meta.json"), JSON.stringify({ cwd: project }));
    const payload = JSON.stringify({ agentId: "store-title", name: "Store name" });
    await writeSqlite(join(storeDir, "store.db"), (db) => {
      db.exec("CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE blobs (id TEXT, data TEXT);");
      db.prepare("INSERT INTO meta VALUES (?, ?)").run("0", Buffer.from(payload, "utf8").toString("hex"));
      db.prepare("INSERT INTO blobs VALUES (?, ?)").run("b1", "do-not-read");
    });

    const tr = join(home, ".cursor", "projects", encodeCursorProjectDir(project), "agent-transcripts", "prompt-title");
    await mkdir(tr, { recursive: true });
    await writeFile(join(tr, "prompt-title.jsonl"), jsonl([
      { role: "user", message: { content: [{ type: "text", text: `First line\nshould collapse and be truncated if it is extremely long ${"word ".repeat(40)}` }] } },
    ]));

    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === "ext:cursor:chat:meta-title")?.title).toBe("Meta title");
    expect(listed.find((item) => item.id === "ext:cursor:chat:store-title")?.title).toBe("Store name");
    expect(listed.find((item) => item.id === "ext:cursor:transcript:prompt-title")?.title).toBe("Cursor prompt-t");
  });

  it("unwraps Cursor image/timestamp envelopes into the user_query title and history", async () => {
    const envelope = [
      "[Image]",
      "<image_files>",
      "The following images were provided by the user and saved to the workspace for future use:",
      "1. /tmp/shot.png",
      "</image_files>",
      "<timestamp>Wednesday, Aug 19, 2026, 8:17 AM (UTC-4)</timestamp>",
      "<user_query>",
      "扫描所有外部 Codex/Claude/Grok 会话会出bug现在界面这样，你看看怎么回事",
      "</user_query>",
    ].join("\n");
    expect(cleanExternalTitle(envelope)).toBe("扫描所有外部 Codex/Claude/Grok 会话会出bug现在界面这样，你看看怎么回事");
    expect(cleanExternalTitle("<timestamp>Wednesday, Aug 19, 2026, 5:27 AM (UTC-4)</timestamp>")).toBeUndefined();

    const { home, project } = await fixtureHome();
    const tr = join(home, ".cursor", "projects", encodeCursorProjectDir(project), "agent-transcripts", "envelope-title");
    await mkdir(tr, { recursive: true });
    await writeFile(join(tr, "envelope-title.jsonl"), jsonl([
      { role: "user", message: { content: [{ type: "text", text: envelope }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "先看扫描链路" }] } },
    ]));
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === "ext:cursor:transcript:envelope-title")?.title)
      .toBe("Cursor envelope");
    const history = await readExternalSessionHistory("ext:cursor:transcript:envelope-title", [project], { home });
    expect(history.entries.map((entry) => entry.content)).toEqual([
      "扫描所有外部 Codex/Claude/Grok 会话会出bug现在界面这样，你看看怎么回事",
      "先看扫描链路",
    ]);
    expect(JSON.stringify(history)).not.toMatch(/image_files|<timestamp>|user_query|\[Image\]/);
  });

  it("resolves Cursor composer headers from the platform Application Support db", () => {
    const home = join("/tmp", "pipi-ext-home");
    const resolved = resolveExternalSessionRoots({ home });
    expect(resolved.cursorStateDb).toBe(join(
      home,
      process.platform === "darwin" ? join("Library", "Application Support")
        : process.platform === "win32" ? join("AppData", "Roaming")
          : ".config",
      "Cursor", "User", "globalStorage", "state.vscdb",
    ));
    expect(resolved.cursorStateDb.includes(join(home, ".cursor"))).toBe(false);
  });

  it("uses Cursor composerHeaders.name before jsonl title and id fallback", async () => {
    const { home, project } = await fixtureHome();
    const untitledId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const titledId = "11111111-2222-3333-4444-555555555555";
    const missingId = "99999999-aaaa-bbbb-cccc-dddddddddddd";
    const transcripts = join(home, ".cursor", "projects", encodeCursorProjectDir(project), "agent-transcripts");
    for (const id of [untitledId, titledId, missingId]) {
      const dir = join(transcripts, id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.jsonl`), jsonl(
        id === titledId
          ? [{ title: "Jsonl title", role: "user" }]
          : [{ role: "user", message: { content: [{ type: "text", text: "do not use body" }] } }],
      ));
    }
    await writeSqlite(resolveExternalSessionRoots({ home }).cursorStateDb, (db) => {
      db.exec("CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, value TEXT)");
      db.prepare("INSERT INTO composerHeaders VALUES (?, ?)").run(
        untitledId,
        JSON.stringify({ name: "Header name", title: null, subtitle: "not the list name" }),
      );
      db.prepare("INSERT INTO composerHeaders VALUES (?, ?)").run(
        titledId,
        JSON.stringify({ name: "Header wins", title: "Header title", subtitle: "not the list name" }),
      );
    });
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === `ext:cursor:transcript:${untitledId}`)?.title).toBe("Header name");
    expect(listed.find((item) => item.id === `ext:cursor:transcript:${untitledId}`)?.title)
      .not.toBe(`Cursor ${untitledId.slice(0, 8)}`);
    expect(listed.find((item) => item.id === `ext:cursor:transcript:${titledId}`)?.title).toBe("Header wins");
    expect(listed.find((item) => item.id === `ext:cursor:transcript:${missingId}`)?.title)
      .toBe(`Cursor ${missingId.slice(0, 8)}`);
  });

  it("keeps Cursor transcript fallback when composer headers db is missing or corrupt", async () => {
    const { home, project } = await fixtureHome();
    const id = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
    const dir = join(home, ".cursor", "projects", encodeCursorProjectDir(project), "agent-transcripts", id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.jsonl`), jsonl([
      { role: "user", message: { content: [{ type: "text", text: "do not use body" }] } },
    ]));
    const listedMissing = await listExternalSessionsForProject(project, { home });
    expect(listedMissing.find((item) => item.id === `ext:cursor:transcript:${id}`)?.title)
      .toBe(`Cursor ${id.slice(0, 8)}`);

    const dbPath = resolveExternalSessionRoots({ home }).cursorStateDb;
    await mkdir(join(dbPath, ".."), { recursive: true });
    await writeFile(dbPath, "not a sqlite database");
    await expect(listExternalSessionsForProject(project, { home })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `ext:cursor:transcript:${id}`,
          title: `Cursor ${id.slice(0, 8)}`,
        }),
      ]),
    );
  });

  it("reads Codex index, rollout metadata, and sqlite title variants", async () => {
    const { home, project } = await fixtureHome();
    const day = join(home, ".codex", "sessions", "2026", "08", "01");
    await mkdir(day, { recursive: true });
    await mkdir(join(home, ".codex", "sqlite"), { recursive: true });
    await writeFile(join(home, ".codex", "session_index.jsonl"), jsonl([
      { id: "codex-index", thread_name: "Index name", updated_at: "2026-08-03T00:00:00.000Z" },
    ]));
    await writeFile(join(day, "rollout-codex-index.jsonl"), jsonl([
      { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { id: "codex-index", cwd: project, title: "Rollout ignored" } },
    ]));
    await writeFile(join(day, "rollout-codex-meta.jsonl"), jsonl([
      { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { id: "codex-meta", cwd: project, title: "Rollout title" } },
    ]));
    await writeFile(join(day, "rollout-codex-sql.jsonl"), jsonl([
      { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { id: "codex-sql", cwd: project } },
    ]));
    await writeFile(join(day, "rollout-codex-catalog.jsonl"), jsonl([
      { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { id: "codex-catalog", cwd: project } },
    ]));
    await writeFile(join(day, "rollout-codex-prompt.jsonl"), jsonl([
      { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { id: "codex-prompt", cwd: project } },
      { timestamp: "2026-08-01T00:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "Prompt title only" } },
    ]));
    await writeSqlite(join(home, ".codex", "sqlite", "state_5.sqlite"), (db) => {
      db.exec("CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, updated_at TEXT, updated_at_ms INTEGER, first_user_message TEXT)");
      db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)").run("codex-sql", "SQLite title", project, "2026-08-01", 1, "do-not-use");
    });
    await writeSqlite(join(home, ".codex", "sqlite", "codex-dev.db"), (db) => {
      db.exec("CREATE TABLE local_thread_catalog (thread_id TEXT, display_title TEXT, cwd TEXT, source_updated_at TEXT)");
      db.prepare("INSERT INTO local_thread_catalog VALUES (?, ?, ?, ?)").run("codex-catalog", "Catalog title", project, "2026-08-01");
    });

    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === "ext:codex:codex-index")?.title).toBe("Index name");
    expect(listed.find((item) => item.id === "ext:codex:codex-meta")?.title).toBe("Rollout title");
    expect(listed.find((item) => item.id === "ext:codex:codex-sql")?.title).toBe("SQLite title");
    expect(listed.find((item) => item.id === "ext:codex:codex-catalog")?.title).toBe("Catalog title");
    expect(listed.find((item) => item.id === "ext:codex:codex-prompt")?.title).toBe("Codex codex-pr");
  });

  it("keeps only the five newest sessions per source", async () => {
    const { home, project } = await fixtureHome();
    const claudeDir = join(home, ".claude", "projects", encodeClaudeProjectDir(project));
    await mkdir(claudeDir, { recursive: true });
    const origin = Date.now() + 60_000;
    for (let i = 1; i <= 6; i += 1) {
      await writeFile(join(claudeDir, `claude-${i}.jsonl`), jsonl([
        { type: "custom-title", sessionId: `claude-${i}`, customTitle: `Claude ${i}`, timestamp: origin + i * 1000 },
        { type: "user", cwd: project, sessionId: `claude-${i}`, timestamp: origin + i * 1000, message: { role: "user", content: "hi" } },
      ]));
    }
    await mkdir(join(home, ".codex", "sqlite"), { recursive: true });
    await writeSqlite(join(home, ".codex", "sqlite", "state_5.sqlite"), (db) => {
      db.exec("CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, updated_at TEXT, updated_at_ms INTEGER)");
      for (let i = 1; i <= 6; i += 1) {
        db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(
          `codex-${i}`,
          `Codex ${i}`,
          project,
          "2026-08-01",
          origin + i * 1000,
        );
      }
    });
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.filter((item) => item.source === "claude").map((item) => item.id)).toEqual([
      "ext:claude:claude-6",
      "ext:claude:claude-5",
      "ext:claude:claude-4",
      "ext:claude:claude-3",
      "ext:claude:claude-2",
    ]);
    expect(listed.filter((item) => item.source === "codex").map((item) => item.id)).toEqual([
      "ext:codex:codex-6",
      "ext:codex:codex-5",
      "ext:codex:codex-4",
      "ext:codex:codex-3",
      "ext:codex:codex-2",
    ]);
  });

  it("lists a Codex thread from sqlite cwd without a rollout file", async () => {
    const { home, project } = await fixtureHome();
    await mkdir(join(home, ".codex", "sqlite"), { recursive: true });
    await mkdir(join(home, ".codex", "sessions"), { recursive: true });
    await writeSqlite(join(home, ".codex", "sqlite", "state_5.sqlite"), (db) => {
      db.exec("CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, updated_at TEXT, updated_at_ms INTEGER, first_user_message TEXT)");
      db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)").run(
        "codex-sql-only",
        "SQLite only title",
        project,
        "2026-08-01",
        1_780_000_000_000,
        "do-not-use",
      );
    });
    const listed = await listExternalSessionsForProject(project, { home });
    expect(listed.find((item) => item.id === "ext:codex:codex-sql-only")).toMatchObject({
      title: "SQLite only title",
      cwd: project,
      source: "codex",
    });
  });
});
