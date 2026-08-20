/**
 * Read-only aggregation of sessions written by other local coding agents.
 *
 * These records are never Pi sessions: they must not enter lease / delete /
 * send / resume. The list contract is metadata only; history is whatever the
 * source can expose without opening credential, account, token, FTS, or
 * message-body stores.
 */

export const EXTERNAL_SESSION_ID_PREFIX = "ext:" as const;

export const EXTERNAL_SESSION_SOURCES = [
  "claude",
  "codex",
  "grok",
  "cursor",
  "opencode",
  "zcode",
] as const;
export type ExternalSessionSource = (typeof EXTERNAL_SESSION_SOURCES)[number];

export const EXTERNAL_HISTORY_AVAILABILITY = ["none", "metadata", "summary", "text"] as const;
export type ExternalHistoryAvailability = (typeof EXTERNAL_HISTORY_AVAILABILITY)[number];

export const CURSOR_EXTERNAL_KINDS = ["transcript", "chat"] as const;
export type CursorExternalKind = (typeof CURSOR_EXTERNAL_KINDS)[number];

/** Sidebar / Host API list row. Keep this set closed — no message bodies. */
export type ExternalSession = {
  id: string;
  source: ExternalSessionSource;
  title: string;
  cwd: string;
  updatedAt: number;
  historyAvailability: ExternalHistoryAvailability;
};

export type ExternalHistoryEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
};

/** Read-only history payload. `entries` is empty unless availability is `text`. */
export type ExternalSessionHistory = {
  id: string;
  source: ExternalSessionSource;
  availability: ExternalHistoryAvailability;
  entries: ExternalHistoryEntry[];
  summary?: string;
};

export type ParsedExternalSessionId =
  | { source: Exclude<ExternalSessionSource, "cursor">; nativeId: string }
  | { source: "cursor"; kind: CursorExternalKind; nativeId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isExternalSessionSource(value: unknown): value is ExternalSessionSource {
  return typeof value === "string" && (EXTERNAL_SESSION_SOURCES as readonly string[]).includes(value);
}

export function isExternalHistoryAvailability(value: unknown): value is ExternalHistoryAvailability {
  return typeof value === "string" && (EXTERNAL_HISTORY_AVAILABILITY as readonly string[]).includes(value);
}

export function isExternalSessionId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(EXTERNAL_SESSION_ID_PREFIX) && id.length > EXTERNAL_SESSION_ID_PREFIX.length;
}

export function makeExternalSessionId(source: Exclude<ExternalSessionSource, "cursor">, nativeId: string): string;
export function makeExternalSessionId(source: "cursor", nativeId: string, kind: CursorExternalKind): string;
export function makeExternalSessionId(source: ExternalSessionSource, nativeId: string, kind?: CursorExternalKind): string {
  const id = nativeId.trim();
  if (!id) throw new Error("external session id is empty");
  if (source === "cursor") {
    if (!kind || !(CURSOR_EXTERNAL_KINDS as readonly string[]).includes(kind)) {
      throw new Error("cursor external session requires a kind");
    }
    return `${EXTERNAL_SESSION_ID_PREFIX}cursor:${kind}:${id}`;
  }
  return `${EXTERNAL_SESSION_ID_PREFIX}${source}:${id}`;
}

export function parseExternalSessionId(id: string): ParsedExternalSessionId | null {
  if (!isExternalSessionId(id)) return null;
  const rest = id.slice(EXTERNAL_SESSION_ID_PREFIX.length);
  const sourceEnd = rest.indexOf(":");
  if (sourceEnd <= 0) return null;
  const source = rest.slice(0, sourceEnd);
  const remainder = rest.slice(sourceEnd + 1);
  if (!remainder || !isExternalSessionSource(source)) return null;
  if (source === "cursor") {
    const kindEnd = remainder.indexOf(":");
    if (kindEnd <= 0) return null;
    const kind = remainder.slice(0, kindEnd);
    const nativeId = remainder.slice(kindEnd + 1);
    if (!nativeId || !(CURSOR_EXTERNAL_KINDS as readonly string[]).includes(kind)) return null;
    return { source, kind: kind as CursorExternalKind, nativeId };
  }
  return { source, nativeId: remainder };
}

/** Compare session cwd values without following symlinks or collapsing worktrees. */
export function normalizeProjectCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return "";
  const withPosix = trimmed.replace(/\\/g, "/");
  const collapsed = withPosix.replace(/\/{2,}/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
  return collapsed;
}

export function cwdMatchesProject(sessionCwd: string, projectCwd: string): boolean {
  const session = normalizeProjectCwd(sessionCwd);
  const project = normalizeProjectCwd(projectCwd);
  return Boolean(session) && session === project;
}

export function sortExternalSessions(sessions: readonly ExternalSession[]): ExternalSession[] {
  return [...sessions].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.id.localeCompare(b.id);
  });
}

export function isExternalSession(value: unknown): value is ExternalSession {
  if (!isRecord(value)) return false;
  return isExternalSessionId(value.id)
    && isExternalSessionSource(value.source)
    && typeof value.title === "string"
    && typeof value.cwd === "string"
    && typeof value.updatedAt === "number"
    && Number.isFinite(value.updatedAt)
    && isExternalHistoryAvailability(value.historyAvailability);
}

const SHORT_SOURCE_LABELS: Record<ExternalSessionSource, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  cursor: "Cursor",
  opencode: "OpenCode",
  zcode: "ZCode",
};

export function shortExternalSourceLabel(source: ExternalSessionSource | string | undefined): string {
  if (source && source in SHORT_SOURCE_LABELS) return SHORT_SOURCE_LABELS[source as ExternalSessionSource];
  return "外部";
}

export function adoptedSourceBadge(source: ExternalSessionSource | string | undefined): string {
  return `${shortExternalSourceLabel(source)} → Pi`;
}

/** Scanner advertised text history — still confirm entries before creating a session. */
export function externalSessionLooksAdoptable(session: Pick<ExternalSession, "historyAvailability">): boolean {
  return session.historyAvailability === "text";
}

export function importableExternalHistoryEntries(history: Pick<ExternalSessionHistory, "availability" | "entries"> | undefined): ExternalHistoryEntry[] {
  if (!history || history.availability !== "text") return [];
  return history.entries.filter((entry) =>
    (entry.role === "user" || entry.role === "assistant") && Boolean(entry.content?.trim()),
  );
}

export function canAdoptExternalHistory(history: Pick<ExternalSessionHistory, "availability" | "entries"> | undefined): boolean {
  return importableExternalHistoryEntries(history).length > 0;
}

export type SessionAdoptedFrom = {
  source: ExternalSessionSource;
  externalSessionId: string;
};

export function isSessionAdoptedFrom(value: unknown): value is SessionAdoptedFrom {
  if (!isRecord(value)) return false;
  return isExternalSessionSource(value.source) && isExternalSessionId(value.externalSessionId);
}
