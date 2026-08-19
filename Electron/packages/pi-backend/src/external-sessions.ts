/**
 * Read-only scanners for local sessions written by other coding agents.
 *
 * Matching is exact project-root / cwd equality after slash normalization.
 * A broken file or a changed SQLite schema in one source must not hide the
 * others. SQLite is opened read-only and only allow-listed metadata columns
 * are selected — never account / credential / token / message / FTS bodies.
 * Session titles prefer each platform's own saved title fields. Message bodies
 * are never used as default titles. Each source keeps only the five
 * newest matching sessions so a machine with years of Codex rollouts cannot
 * stall the sidebar.
 */
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

import {
  cwdMatchesProject,
  makeExternalSessionId,
  normalizeProjectCwd,
  parseExternalSessionId,
  sortExternalSessions,
  type CursorExternalKind,
  type ExternalHistoryAvailability,
  type ExternalHistoryEntry,
  type ExternalSession,
  type ExternalSessionHistory,
  type ExternalSessionSource,
} from "@pipi/host-api";

export type ExternalSessionRoots = {
  home?: string;
  claudeProjects?: string;
  codexHome?: string;
  grokSessions?: string;
  cursorHome?: string;
  cursorStateDb?: string;
  opencodeDb?: string;
  zcodeIndex?: string;
};

export type ResolvedExternalSessionRoots = {
  home: string;
  claudeProjects: string;
  codexHome: string;
  grokSessions: string;
  cursorHome: string;
  cursorStateDb: string;
  opencodeDb: string;
  zcodeIndex: string;
};

export const EXTERNAL_SQLITE_FORBIDDEN_TABLES = [
  "account",
  "account_state",
  "control_account",
  "credential",
  "message",
  "part",
  "session_message",
  "session_input",
  "session_share",
  "event",
  "blobs",
  "automations",
  "automation_runs",
  "off_peak_tasks",
] as const;

const FORBIDDEN_SQL_IDENT = /account|credential|token|message|fts|blob|prompt|searchable|secret|auth|share/i;

export const OPENCODE_SESSION_COLUMNS = ["id", "title", "directory", "path", "time_updated"] as const;
export const ZCODE_TASK_COLUMNS = ["task_id", "title", "workspace_path", "updated_at"] as const;
export const CODEX_THREAD_COLUMNS = ["id", "title", "cwd", "updated_at", "updated_at_ms"] as const;
export const CODEX_CATALOG_COLUMNS = ["thread_id", "display_title", "cwd", "source_updated_at"] as const;
export const EXTERNAL_SESSIONS_PER_SOURCE = 5;

function takeNewest(sessions: readonly ExternalSession[]): ExternalSession[] {
  return sortExternalSessions(sessions).slice(0, EXTERNAL_SESSIONS_PER_SOURCE);
}

async function newestPaths(paths: readonly string[], limit: number): Promise<string[]> {
  const ranked = await Promise.all(paths.map(async (path) => ({ path, mtime: await fileMtime(path) })));
  ranked.sort((a, b) => b.mtime - a.mtime);
  return ranked.slice(0, limit).map((item) => item.path);
}

/** Newest Codex rollouts by date folder, so we never walk years of archives. */
async function newestDatedRollouts(sessionsDir: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  const years = (await listDir(sessionsDir)).filter((name) => /^\d{4}$/.test(name)).sort().reverse();
  for (const year of years) {
    const months = (await listDir(join(sessionsDir, year))).filter((name) => /^\d{2}$/.test(name)).sort().reverse();
    for (const month of months) {
      const days = (await listDir(join(sessionsDir, year, month))).filter((name) => /^\d{2}$/.test(name)).sort().reverse();
      for (const day of days) {
        const dir = join(sessionsDir, year, month, day);
        const names = (await listDir(dir)).filter((name) => name.startsWith("rollout") && name.endsWith(".jsonl"));
        for (const path of await newestPaths(names.map((name) => join(dir, name)), names.length)) {
          out.push(path);
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

const SQLITE_ALLOWLIST: Record<string, readonly string[]> = {
  session: OPENCODE_SESSION_COLUMNS,
  tasks: ZCODE_TASK_COLUMNS,
  threads: CODEX_THREAD_COLUMNS,
  local_thread_catalog: CODEX_CATALOG_COLUMNS,
};

type JsonRecord = Record<string, unknown>;

function defaultCursorStateDb(home: string): string {
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "win32") {
    return join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

export function resolveExternalSessionRoots(
  overrides: ExternalSessionRoots = {},
  fallbackHome = overrides.home ?? homedir(),
): ResolvedExternalSessionRoots {
  const home = overrides.home ?? fallbackHome;
  return {
    home,
    claudeProjects: overrides.claudeProjects ?? join(home, ".claude", "projects"),
    codexHome: overrides.codexHome ?? join(home, ".codex"),
    grokSessions: overrides.grokSessions ?? join(home, ".grok", "sessions"),
    cursorHome: overrides.cursorHome ?? join(home, ".cursor"),
    cursorStateDb: overrides.cursorStateDb ?? defaultCursorStateDb(home),
    opencodeDb: overrides.opencodeDb ?? join(home, ".local", "share", "opencode", "opencode.db"),
    zcodeIndex: overrides.zcodeIndex ?? join(home, ".zcode", "v2", "tasks-index.sqlite"),
  };
}

export function encodeClaudeProjectDir(cwd: string): string {
  return normalizeProjectCwd(cwd).replace(/\//g, "-");
}

export function encodeCursorProjectDir(cwd: string): string {
  return normalizeProjectCwd(cwd).replace(/^\//, "").replace(/\//g, "-");
}

export function encodeGrokSessionDir(cwd: string): string {
  return encodeURIComponent(normalizeProjectCwd(cwd));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

const TITLE_MAX = 120;

function unwrapCursorEnvelope(raw: string): string {
  const query = raw.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (query) return query[1].trim();
  const stripped = raw
    .replace(/\[Image\]/gi, " ")
    .replace(/<image_files>[\s\S]*?<\/image_files>/gi, " ")
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, " ")
    .trim();
  if (!stripped) return "";
  return stripped;
}

export function cleanExternalTitle(value: unknown, max = TITLE_MAX): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const unwrapped = unwrapCursorEnvelope(raw);
  const line = unwrapped.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  if (line.length <= max) return line;
  return `${line.slice(0, max).trimEnd()}\u2026`;
}

function firstTitle(...values: unknown[]): string | undefined {
  for (const value of values) {
    const cleaned = cleanExternalTitle(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

export function fallbackExternalTitle(sourceLabel: string, nativeId: string): string {
  return `${sourceLabel} ${nativeId.slice(0, 8)}`;
}

function parseTime(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return fallback;
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return parseTime(numeric, fallback);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function fileMtime(path: string, fallback = 0): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return fallback;
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function readJsonFile(path: string): Promise<JsonRecord | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function* readJsonlRecords(path: string): AsyncGenerator<JsonRecord> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const value = JSON.parse(trimmed);
        if (isRecord(value)) yield value;
      } catch {
        // skip a corrupt line; the rest of the file may still be usable
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

function extractPlainText(content: unknown): string {
  if (typeof content === "string") return unwrapCursorEnvelope(content);
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (!isRecord(part)) continue;
      const type = typeof part.type === "string" ? part.type : "";
      if (type && type !== "text" && type !== "input_text" && type !== "output_text") continue;
      if (typeof part.text === "string") parts.push(part.text);
    }
    return unwrapCursorEnvelope(parts.join("\n"));
  }
  if (isRecord(content) && typeof content.text === "string") return unwrapCursorEnvelope(content.text);
  return "";
}

function historyRole(value: unknown): ExternalHistoryEntry["role"] | null {
  return value === "user" || value === "assistant" || value === "system" ? value : null;
}

function pageHistory(
  entries: ExternalHistoryEntry[],
  before?: number | string,
  limit = 200,
): ExternalHistoryEntry[] {
  const capped = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.floor(Number(limit)))) : 200;
  let sliced = entries;
  if (typeof before === "string" && before) {
    const index = entries.findIndex((entry) => entry.id === before);
    if (index >= 0) sliced = entries.slice(0, index);
  } else if (typeof before === "number" && Number.isFinite(before) && before > 0) {
    sliced = entries.slice(0, Math.max(0, entries.length - Math.floor(before)));
  }
  return sliced.slice(-capped);
}

function emptyHistory(
  id: string,
  source: ExternalSessionSource,
  availability: ExternalHistoryAvailability,
  summary?: string,
): ExternalSessionHistory {
  return summary
    ? { id, source, availability, entries: [], summary }
    : { id, source, availability, entries: [] };
}

async function isolateSource(
  source: ExternalSessionSource,
  scan: () => Promise<ExternalSession[]>,
): Promise<ExternalSession[]> {
  try {
    return await scan();
  } catch (error) {
    console.warn(`[external-sessions] ${source} failed`, error);
    return [];
  }
}

function assertSafeSqliteIdent(kind: "table" | "column", name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`sqlite ${kind} ${name} is not a safe identifier`);
  }
  const forbiddenTable = (EXTERNAL_SQLITE_FORBIDDEN_TABLES as readonly string[]).includes(name);
  if (kind === "table" && (forbiddenTable || FORBIDDEN_SQL_IDENT.test(name))) {
    throw new Error(`sqlite table ${name} is forbidden`);
  }
  if (kind === "column" && FORBIDDEN_SQL_IDENT.test(name)) {
    throw new Error(`sqlite column ${name} is forbidden`);
  }
}

export function openReadonlySqlite(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

export function queryReadonlySqlite(
  path: string,
  spec: { table: string; columns: readonly string[] },
): JsonRecord[] {
  const allowed = SQLITE_ALLOWLIST[spec.table];
  if (!allowed) throw new Error(`sqlite table ${spec.table} is not allow-listed`);
  assertSafeSqliteIdent("table", spec.table);
  if (!spec.columns.length) throw new Error("sqlite query requires columns");
  for (const column of spec.columns) {
    assertSafeSqliteIdent("column", column);
    if (!allowed.includes(column)) throw new Error(`sqlite column ${column} is not allow-listed`);
  }
  const sql = `SELECT ${spec.columns.join(", ")} FROM ${spec.table}`;
  const db = openReadonlySqlite(path);
  try {
    return db.prepare(sql).all() as JsonRecord[];
  } finally {
    db.close();
  }
}

function claudeTitle(...values: unknown[]): string | undefined {
  return firstTitle(...values);
}

async function scanClaude(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  const dir = join(roots.claudeProjects, encodeClaudeProjectDir(projectCwd));
  const names = await listDir(dir);
  const out: ExternalSession[] = [];
  const newest = await newestPaths(
    names.filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name)),
    EXTERNAL_SESSIONS_PER_SOURCE,
  );
  for (const path of newest) {
    try {
      const name = path.split(/[/\\]/).pop() ?? "";
      const nativeId = name.slice(0, -".jsonl".length);
      let cwd = "";
      let sessionId = nativeId;
      let title: string | undefined;
      let updatedAt = await fileMtime(path);
      let seen = false;
      for await (const rec of readJsonlRecords(path)) {
        seen = true;
        if (!cwd) cwd = text(rec.cwd) ?? "";
        if (text(rec.sessionId)) sessionId = String(rec.sessionId);
        title = claudeTitle(
          rec.type === "custom-title" ? rec.customTitle : undefined,
          rec.customTitle,
          rec.summary,
          rec.slug,
          rec.title,
          rec.name,
        ) ?? title;
        const ts = parseTime(rec.timestamp, 0);
        if (ts > updatedAt) updatedAt = ts;
      }
      if (!seen) continue;
      if (cwd && !cwdMatchesProject(cwd, projectCwd)) continue;
      if (!cwd) cwd = normalizeProjectCwd(projectCwd);
      out.push({
        id: makeExternalSessionId("claude", sessionId),
        source: "claude",
        title: title ?? fallbackExternalTitle("Claude", sessionId),
        cwd,
        updatedAt,
        historyAvailability: "text",
      });
    } catch {
      // one broken JSONL must not hide the rest of Claude
    }
  }
  return out;
}

async function loadCodexIndex(codexHome: string): Promise<Map<string, { title?: string; updatedAt?: number }>> {
  const map = new Map<string, { title?: string; updatedAt?: number }>();
  const indexPath = join(codexHome, "session_index.jsonl");
  if (!existsSync(indexPath)) return map;
  for await (const rec of readJsonlRecords(indexPath)) {
    const id = text(rec.id);
    if (!id) continue;
    map.set(id, {
      title: firstTitle(rec.thread_name, rec.title, rec.name),
      updatedAt: parseTime(rec.updated_at, 0) || undefined,
    });
  }
  return map;
}

async function walkFiles(root: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && match(entry.name)) out.push(path);
    }
  };
  await walk(root);
  return out;
}

async function readCodexMeta(path: string): Promise<{
  id?: string;
  cwd?: string;
  updatedAt: number;
  title?: string;
} | null> {
  try {
    const updatedAt = await fileMtime(path);
    let id: string | undefined;
    let cwd: string | undefined;
    let title: string | undefined;
    let stamp = updatedAt;
    for await (const rec of readJsonlRecords(path)) {
      if (rec.type === "session_meta" && isRecord(rec.payload)) {
        id = text(rec.payload.id) ?? text(rec.payload.session_id) ?? id;
        cwd = text(rec.payload.cwd) ?? cwd;
        title = firstTitle(
          rec.payload.title,
          rec.payload.thread_name,
          rec.payload.session_title,
        ) ?? title;
        stamp = parseTime(rec.timestamp, stamp) || stamp;
        if (id && cwd) break;
      } else if (id && cwd) {
        break;
      }
    }
    return { id, cwd, updatedAt: stamp, title };
  } catch {
    return null;
  }
}

type CodexSqliteThread = { title?: string; cwd?: string; updatedAt?: number };

function loadCodexSqliteThreads(codexHome: string): Map<string, CodexSqliteThread> {
  const map = new Map<string, CodexSqliteThread>();
  const threadDb = join(codexHome, "sqlite", "state_5.sqlite");
  const catalogDb = join(codexHome, "sqlite", "codex-dev.db");
  try {
    if (existsSync(threadDb)) {
      for (const row of queryReadonlySqlite(threadDb, { table: "threads", columns: CODEX_THREAD_COLUMNS })) {
        const id = text(row.id);
        if (!id) continue;
        const prev = map.get(id);
        map.set(id, {
          title: firstTitle(row.title) ?? prev?.title,
          cwd: text(row.cwd) ?? prev?.cwd,
          updatedAt: parseTime(row.updated_at_ms, 0) || parseTime(row.updated_at, 0) || prev?.updatedAt,
        });
      }
    }
  } catch {
    // schema drift in one Codex db must not hide rollouts
  }
  try {
    if (existsSync(catalogDb)) {
      for (const row of queryReadonlySqlite(catalogDb, { table: "local_thread_catalog", columns: CODEX_CATALOG_COLUMNS })) {
        const id = text(row.thread_id);
        if (!id) continue;
        const prev = map.get(id);
        map.set(id, {
          title: prev?.title ?? firstTitle(row.display_title),
          cwd: prev?.cwd ?? text(row.cwd),
          updatedAt: prev?.updatedAt || parseTime(row.source_updated_at, 0),
        });
      }
    }
  } catch {
    // ignore catalog drift
  }
  return map;
}

function rolloutNativeId(path: string): string | undefined {
  const name = path.split(/[/\\]/).pop() ?? "";
  const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1];
}

async function scanCodex(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  const [index, sqlite] = await Promise.all([
    loadCodexIndex(roots.codexHome),
    Promise.resolve(loadCodexSqliteThreads(roots.codexHome)),
  ]);
  const fromStore: ExternalSession[] = [];
  for (const [id, row] of sqlite) {
    if (!row.cwd || !cwdMatchesProject(row.cwd, projectCwd)) continue;
    const indexed = index.get(id);
    fromStore.push({
      id: makeExternalSessionId("codex", id),
      source: "codex",
      title: firstTitle(indexed?.title, row.title) ?? fallbackExternalTitle("Codex", id),
      cwd: normalizeProjectCwd(row.cwd),
      updatedAt: indexed?.updatedAt || row.updatedAt || 0,
      historyAvailability: "metadata",
    });
  }
  let out = takeNewest(fromStore);
  if (out.length >= EXTERNAL_SESSIONS_PER_SOURCE) return out;

  const have = new Set(
    out.flatMap((session) => {
      const parsed = parseExternalSessionId(session.id);
      return parsed?.source === "codex" ? [parsed.nativeId] : [];
    }),
  );
  const files = await newestDatedRollouts(
    join(roots.codexHome, "sessions"),
    EXTERNAL_SESSIONS_PER_SOURCE + have.size,
  );
  for (const path of files) {
    if (out.length >= EXTERNAL_SESSIONS_PER_SOURCE) break;
    const namedId = rolloutNativeId(path);
    if (namedId && have.has(namedId)) continue;
    const meta = await readCodexMeta(path);
    if (!meta?.id || !meta.cwd || !cwdMatchesProject(meta.cwd, projectCwd)) continue;
    if (have.has(meta.id)) continue;
    const indexed = index.get(meta.id);
    const storedTitle = firstTitle(indexed?.title, sqlite.get(meta.id)?.title, meta.title);
    out.push({
      id: makeExternalSessionId("codex", meta.id),
      source: "codex",
      title: storedTitle ?? fallbackExternalTitle("Codex", meta.id),
      cwd: normalizeProjectCwd(meta.cwd),
      updatedAt: indexed?.updatedAt || meta.updatedAt,
      historyAvailability: "text",
    });
    have.add(meta.id);
  }
  return takeNewest(out);
}

async function scanGrok(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  const dir = join(roots.grokSessions, encodeGrokSessionDir(projectCwd));
  const names = await newestPaths(
    (await listDir(dir)).map((name) => join(dir, name)),
    EXTERNAL_SESSIONS_PER_SOURCE,
  );
  const out: ExternalSession[] = [];
  for (const sessionDir of names) {
    const name = sessionDir.split(/[/\\]/).pop() ?? "";
    try {
      const summaryPath = join(sessionDir, "summary.json");
      const summary = await readJsonFile(summaryPath);
      if (!summary) continue;
      const info = isRecord(summary.info) ? summary.info : {};
      const cwd = text(info.cwd) ?? text(summary.git_root_dir) ?? projectCwd;
      if (!cwdMatchesProject(cwd, projectCwd)) continue;
      const nativeId = text(info.id) ?? name;
      const title = firstTitle(
        summary.generated_title,
        summary.title,
        summary.session_summary,
        summary.agent_name,
        summary.name,
        info.title,
        info.name,
      ) ?? fallbackExternalTitle("Grok", nativeId);
      const updatedAt = parseTime(summary.last_active_at, 0)
        || parseTime(summary.updated_at, 0)
        || await fileMtime(summaryPath);
      const hasChat = existsSync(join(sessionDir, "chat_history.jsonl"));
      out.push({
        id: makeExternalSessionId("grok", nativeId),
        source: "grok",
        title,
        cwd: normalizeProjectCwd(cwd),
        updatedAt,
        historyAvailability: hasChat ? "text" : "summary",
      });
    } catch {
      // skip one broken Grok session dir
    }
  }
  return out;
}

function decodeCursorStoreValue(value: unknown): JsonRecord | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const tryParse = (raw: string): JsonRecord | null => {
    try {
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      return tryParse(Buffer.from(trimmed, "hex").toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

function readCursorStoreTitle(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const db = openReadonlySqlite(path);
    try {
      const rows = db.prepare("SELECT key, value FROM meta").all() as Array<{ key?: unknown; value?: unknown }>;
      for (const row of rows) {
        const decoded = decodeCursorStoreValue(row.value);
        const titled = firstTitle(decoded?.name, decoded?.title, decoded?.threadName);
        if (titled) return titled;
      }
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readCursorTranscriptTitle(path: string): Promise<string | undefined> {
  for await (const rec of readJsonlRecords(path)) {
    const titled = firstTitle(
      rec.title,
      rec.name,
      rec.customTitle,
      isRecord(rec.message) ? rec.message.title : undefined,
    );
    if (titled) return titled;
  }
  return undefined;
}

function readCursorComposerHeaderNames(path: string): Map<string, string> {
  const names = new Map<string, string>();
  if (!existsSync(path)) return names;
  try {
    const db = openReadonlySqlite(path);
    try {
      const rows = db.prepare(
        "SELECT composerId, json_extract(value, '$.name') AS name FROM composerHeaders",
      ).all() as Array<{ composerId?: unknown; name?: unknown }>;
      for (const row of rows) {
        const id = text(row.composerId);
        const name = firstTitle(row.name);
        if (id && name) names.set(id, name);
      }
    } finally {
      db.close();
    }
  } catch {
    return names;
  }
  return names;
}

async function scanCursorTranscripts(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  const dir = join(roots.cursorHome, "projects", encodeCursorProjectDir(projectCwd), "agent-transcripts");
  const names = await newestPaths(
    (await listDir(dir)).map((name) => join(dir, name)),
    EXTERNAL_SESSIONS_PER_SOURCE,
  );
  const headerNames = readCursorComposerHeaderNames(roots.cursorStateDb);
  const out: ExternalSession[] = [];
  for (const sessionDir of names) {
    const name = sessionDir.split(/[/\\]/).pop() ?? "";
    try {
      const file = join(sessionDir, `${name}.jsonl`);
      if (!existsSync(file)) continue;
      out.push({
        id: makeExternalSessionId("cursor", name, "transcript"),
        source: "cursor",
        title: firstTitle(headerNames.get(name), await readCursorTranscriptTitle(file))
          ?? fallbackExternalTitle("Cursor", name),
        cwd: normalizeProjectCwd(projectCwd),
        updatedAt: await fileMtime(file),
        historyAvailability: "text",
      });
    } catch {
      // skip one broken transcript
    }
  }
  return out;
}

async function scanCursorChats(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  const root = join(roots.cursorHome, "chats");
  const buckets = await listDir(root);
  const out: ExternalSession[] = [];
  for (const bucket of buckets) {
    const bucketDir = join(root, bucket);
    for (const name of await listDir(bucketDir)) {
      try {
        const metaPath = join(bucketDir, name, "meta.json");
        const meta = await readJsonFile(metaPath);
        if (!meta) continue;
        const cwd = text(meta.cwd);
        if (!cwd || !cwdMatchesProject(cwd, projectCwd)) continue;
        out.push({
          id: makeExternalSessionId("cursor", name, "chat"),
          source: "cursor",
          title: firstTitle(meta.title, meta.name, readCursorStoreTitle(join(bucketDir, name, "store.db")))
            ?? fallbackExternalTitle("Cursor", name),
          cwd: normalizeProjectCwd(cwd),
          updatedAt: parseTime(meta.updatedAtMs, 0) || await fileMtime(metaPath),
          historyAvailability: "metadata",
        });
      } catch {
        // skip one broken chat; never open store.db
      }
    }
  }
  return out;
}

async function scanCursor(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  const [transcripts, chats] = await Promise.all([
    scanCursorTranscripts(projectCwd, roots),
    scanCursorChats(projectCwd, roots),
  ]);
  return takeNewest([...transcripts, ...chats]);
}

async function scanOpenCode(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  if (!existsSync(roots.opencodeDb)) return [];
  const rows = queryReadonlySqlite(roots.opencodeDb, { table: "session", columns: OPENCODE_SESSION_COLUMNS });
  const out: ExternalSession[] = [];
  for (const row of rows) {
    const nativeId = text(row.id);
    if (!nativeId) continue;
    const cwd = text(row.directory) ?? text(row.path) ?? "";
    if (!cwd || !cwdMatchesProject(cwd, projectCwd)) continue;
    out.push({
      id: makeExternalSessionId("opencode", nativeId),
      source: "opencode",
      title: firstTitle(row.title) || fallbackExternalTitle("OpenCode", nativeId),
      cwd: normalizeProjectCwd(cwd),
      updatedAt: parseTime(row.time_updated, 0),
      historyAvailability: "metadata",
    });
  }
  return out;
}

async function scanZcode(projectCwd: string, roots: ResolvedExternalSessionRoots): Promise<ExternalSession[]> {
  if (!existsSync(roots.zcodeIndex)) return [];
  const rows = queryReadonlySqlite(roots.zcodeIndex, { table: "tasks", columns: ZCODE_TASK_COLUMNS });
  const out: ExternalSession[] = [];
  for (const row of rows) {
    const nativeId = text(row.task_id);
    if (!nativeId) continue;
    const cwd = text(row.workspace_path) ?? "";
    if (!cwd || !cwdMatchesProject(cwd, projectCwd)) continue;
    out.push({
      id: makeExternalSessionId("zcode", nativeId),
      source: "zcode",
      title: firstTitle(row.title) || fallbackExternalTitle("ZCode", nativeId),
      cwd: normalizeProjectCwd(cwd),
      updatedAt: parseTime(row.updated_at, 0),
      historyAvailability: "metadata",
    });
  }
  return out;
}

const SOURCE_SCANNERS: Record<ExternalSessionSource, (cwd: string, roots: ResolvedExternalSessionRoots) => Promise<ExternalSession[]>> = {
  claude: scanClaude,
  codex: scanCodex,
  grok: scanGrok,
  cursor: scanCursor,
  opencode: scanOpenCode,
  zcode: scanZcode,
};

export async function listExternalSessionsForProject(
  projectCwd: string,
  roots: ExternalSessionRoots = {},
  fallbackHome?: string,
): Promise<ExternalSession[]> {
  const cwd = normalizeProjectCwd(projectCwd);
  if (!cwd) return [];
  const resolved = resolveExternalSessionRoots(roots, fallbackHome);
  const groups = await Promise.all(
    (Object.keys(SOURCE_SCANNERS) as ExternalSessionSource[]).map((source) =>
      isolateSource(source, async () => takeNewest(await SOURCE_SCANNERS[source](cwd, resolved))),
    ),
  );
  return sortExternalSessions(groups.flat());
}

function claudeHistoryEntry(rec: JsonRecord, index: number): ExternalHistoryEntry | null {
  if (rec.type !== "user" && rec.type !== "assistant" && rec.type !== "system") return null;
  const message = isRecord(rec.message) ? rec.message : rec;
  const role = historyRole(message.role) ?? (rec.type === "user" || rec.type === "assistant" || rec.type === "system" ? rec.type : null);
  if (!role) return null;
  const content = extractPlainText(message.content ?? rec.content).trim();
  if (!content) return null;
  return {
    id: text(rec.uuid) ?? text(rec.sessionId) ?? `claude-${index}`,
    role,
    content,
    timestamp: parseTime(rec.timestamp, 0),
  };
}

async function readClaudeHistory(nativeId: string, projectPaths: string[], roots: ResolvedExternalSessionRoots): Promise<ExternalSessionHistory | null> {
  for (const projectCwd of projectPaths) {
    const path = join(roots.claudeProjects, encodeClaudeProjectDir(projectCwd), `${nativeId}.jsonl`);
    if (!existsSync(path)) continue;
    const entries: ExternalHistoryEntry[] = [];
    let cwd = "";
    for await (const rec of readJsonlRecords(path)) {
      if (!cwd) cwd = text(rec.cwd) ?? "";
      const entry = claudeHistoryEntry(rec, entries.length);
      if (entry) entries.push(entry);
    }
    if (cwd && !projectPaths.some((candidate) => cwdMatchesProject(cwd, candidate))) continue;
    return { id: makeExternalSessionId("claude", nativeId), source: "claude", availability: "text", entries };
  }
  return null;
}

function codexHistoryEntry(rec: JsonRecord, index: number): ExternalHistoryEntry | null {
  if (rec.type === "response_item" && isRecord(rec.payload)) {
    const role = historyRole(rec.payload.role);
    if (!role) return null;
    const content = extractPlainText(rec.payload.content).trim();
    if (!content) return null;
    return {
      id: text(rec.payload.id) ?? `codex-${index}`,
      role,
      content,
      timestamp: parseTime(rec.timestamp, 0),
    };
  }
  if (rec.type === "event_msg" && isRecord(rec.payload) && rec.payload.type === "user_message") {
    const content = (text(rec.payload.message) ?? extractPlainText(rec.payload.message)).trim();
    if (!content) return null;
    return {
      id: `codex-user-${index}`,
      role: "user",
      content,
      timestamp: parseTime(rec.timestamp, 0),
    };
  }
  return null;
}

async function readCodexHistory(nativeId: string, projectPaths: string[], roots: ResolvedExternalSessionRoots): Promise<ExternalSessionHistory | null> {
  const files = await walkFiles(join(roots.codexHome, "sessions"), (name) => name.includes(nativeId) && name.endsWith(".jsonl"));
  for (const path of files) {
    const meta = await readCodexMeta(path);
    if (!meta?.cwd || !projectPaths.some((candidate) => cwdMatchesProject(meta.cwd!, candidate))) continue;
    const entries: ExternalHistoryEntry[] = [];
    for await (const rec of readJsonlRecords(path)) {
      const entry = codexHistoryEntry(rec, entries.length);
      if (entry) entries.push(entry);
    }
    return { id: makeExternalSessionId("codex", nativeId), source: "codex", availability: "text", entries };
  }
  return null;
}

async function readGrokHistory(nativeId: string, projectPaths: string[], roots: ResolvedExternalSessionRoots): Promise<ExternalSessionHistory | null> {
  for (const projectCwd of projectPaths) {
    const dir = join(roots.grokSessions, encodeGrokSessionDir(projectCwd), nativeId);
    const summaryPath = join(dir, "summary.json");
    const summary = await readJsonFile(summaryPath);
    if (!summary) continue;
    const info = isRecord(summary.info) ? summary.info : {};
    const cwd = text(info.cwd) ?? text(summary.git_root_dir) ?? projectCwd;
    if (!projectPaths.some((candidate) => cwdMatchesProject(cwd, candidate))) continue;
    const chatPath = join(dir, "chat_history.jsonl");
    const summaryText = text(summary.session_summary);
    if (!existsSync(chatPath)) {
      return emptyHistory(makeExternalSessionId("grok", nativeId), "grok", "summary", summaryText);
    }
    const entries: ExternalHistoryEntry[] = [];
    let index = 0;
    for await (const rec of readJsonlRecords(chatPath)) {
      const role = historyRole(rec.type) ?? historyRole(rec.role);
      const content = extractPlainText(rec.content).trim();
      if (!role || !content) continue;
      entries.push({ id: text(rec.id) ?? `grok-${index}`, role, content, timestamp: parseTime(rec.ts ?? rec.timestamp, 0) });
      index += 1;
    }
    return {
      id: makeExternalSessionId("grok", nativeId),
      source: "grok",
      availability: "text",
      entries,
      ...(summaryText ? { summary: summaryText } : {}),
    };
  }
  return null;
}

function cursorTranscriptEntry(rec: JsonRecord, index: number): ExternalHistoryEntry | null {
  const role = historyRole(rec.role);
  if (!role) return null;
  const message = isRecord(rec.message) ? rec.message : rec;
  const content = extractPlainText(message.content).trim();
  if (!content) return null;
  return {
    id: text(rec.id) ?? `cursor-${index}`,
    role,
    content,
    timestamp: parseTime(rec.timestamp, 0),
  };
}

async function readCursorHistory(
  kind: CursorExternalKind,
  nativeId: string,
  projectPaths: string[],
  roots: ResolvedExternalSessionRoots,
): Promise<ExternalSessionHistory | null> {
  const id = makeExternalSessionId("cursor", nativeId, kind);
  if (kind === "chat") {
    for (const projectCwd of projectPaths) {
      const listed = await scanCursorChats(projectCwd, roots);
      if (listed.some((session) => session.id === id)) {
        return emptyHistory(id, "cursor", "metadata");
      }
    }
    return null;
  }
  for (const projectCwd of projectPaths) {
    const path = join(
      roots.cursorHome,
      "projects",
      encodeCursorProjectDir(projectCwd),
      "agent-transcripts",
      nativeId,
      `${nativeId}.jsonl`,
    );
    if (!existsSync(path)) continue;
    const entries: ExternalHistoryEntry[] = [];
    for await (const rec of readJsonlRecords(path)) {
      const entry = cursorTranscriptEntry(rec, entries.length);
      if (entry) entries.push(entry);
    }
    return { id, source: "cursor", availability: "text", entries };
  }
  return null;
}

async function readOpenCodeHistory(nativeId: string, projectPaths: string[], roots: ResolvedExternalSessionRoots): Promise<ExternalSessionHistory | null> {
  if (!existsSync(roots.opencodeDb)) return null;
  const rows = queryReadonlySqlite(roots.opencodeDb, { table: "session", columns: OPENCODE_SESSION_COLUMNS });
  const row = rows.find((item) => text(item.id) === nativeId);
  if (!row) return null;
  const cwd = text(row.directory) ?? text(row.path) ?? "";
  if (!cwd || !projectPaths.some((candidate) => cwdMatchesProject(cwd, candidate))) return null;
  return emptyHistory(makeExternalSessionId("opencode", nativeId), "opencode", "metadata");
}

async function readZcodeHistory(nativeId: string, projectPaths: string[], roots: ResolvedExternalSessionRoots): Promise<ExternalSessionHistory | null> {
  if (!existsSync(roots.zcodeIndex)) return null;
  const rows = queryReadonlySqlite(roots.zcodeIndex, { table: "tasks", columns: ZCODE_TASK_COLUMNS });
  const row = rows.find((item) => text(item.task_id) === nativeId);
  if (!row) return null;
  const cwd = text(row.workspace_path) ?? "";
  if (!cwd || !projectPaths.some((candidate) => cwdMatchesProject(cwd, candidate))) return null;
  return emptyHistory(makeExternalSessionId("zcode", nativeId), "zcode", "metadata");
}

export async function readExternalSessionHistory(
  sessionId: string,
  projectPaths: readonly string[],
  roots: ExternalSessionRoots = {},
  before?: number | string,
  limit?: number,
  fallbackHome?: string,
): Promise<ExternalSessionHistory> {
  const parsed = parseExternalSessionId(sessionId);
  if (!parsed) throw new Error(`unknown external session ${sessionId}`);
  const resolved = resolveExternalSessionRoots(roots, fallbackHome);
  const opened = projectPaths.map(normalizeProjectCwd).filter((path): path is string => path.length > 0);
  if (!opened.length) throw new Error(`unknown external session ${sessionId}`);

  let history: ExternalSessionHistory | null = null;
  try {
    if (parsed.source === "claude") history = await readClaudeHistory(parsed.nativeId, opened, resolved);
    else if (parsed.source === "codex") history = await readCodexHistory(parsed.nativeId, opened, resolved);
    else if (parsed.source === "grok") history = await readGrokHistory(parsed.nativeId, opened, resolved);
    else if (parsed.source === "cursor") history = await readCursorHistory(parsed.kind, parsed.nativeId, opened, resolved);
    else if (parsed.source === "opencode") history = await readOpenCodeHistory(parsed.nativeId, opened, resolved);
    else history = await readZcodeHistory(parsed.nativeId, opened, resolved);
  } catch (error) {
    console.warn(`[external-sessions] history ${parsed.source} failed`, error);
    history = emptyHistory(sessionId, parsed.source, "none");
  }
  if (!history) throw new Error(`unknown external session ${sessionId}`);
  if (history.availability !== "text") return history;
  return { ...history, entries: pageHistory(history.entries, before, limit) };
}
