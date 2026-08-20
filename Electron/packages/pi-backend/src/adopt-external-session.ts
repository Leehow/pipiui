/**
 * One-shot adoption of a read-only external session into a native Pi JSONL.
 * Mapping lives in the project's `.pi/agent` home — never ~/.pi.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  isExternalSessionId,
  parseExternalSessionId,
  type ExternalHistoryEntry,
  type ExternalSessionHistory,
  type ExternalSessionSource,
} from "@pipi/host-api";

export const ADOPTED_EXTERNAL_SESSIONS_FILE = "adopted-external-sessions.json";

export type AdoptedExternalMap = Record<string, string>;

export type PiSessionJsonlRow = Record<string, unknown>;

export type BuiltAdoptedSession = {
  sessionId: string;
  fileName: string;
  lines: string[];
};

export function adoptedExternalMapPath(agentDir: string): string {
  return join(agentDir, ADOPTED_EXTERNAL_SESSIONS_FILE);
}

export function parseAdoptedExternalMap(raw: unknown): AdoptedExternalMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const entries = isRecord(record.entries) ? record.entries : record;
  const out: AdoptedExternalMap = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!isExternalSessionId(key) || typeof value !== "string" || !value.trim()) continue;
    out[key] = value.trim();
  }
  return out;
}

export async function readAdoptedExternalMap(agentDir: string): Promise<AdoptedExternalMap> {
  const path = adoptedExternalMapPath(agentDir);
  try {
    return parseAdoptedExternalMap(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return {};
  }
}

export async function writeAdoptedExternalMap(agentDir: string, map: AdoptedExternalMap): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const path = adoptedExternalMapPath(agentDir);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = JSON.stringify({ version: 1, entries: map }, null, 2) + "\n";
  await writeFile(tmp, payload);
  await rename(tmp, path);
}

export function importableExternalEntries(
  history: Pick<ExternalSessionHistory, "availability" | "entries"> | undefined,
): ExternalHistoryEntry[] {
  if (!history || history.availability !== "text") return [];
  return history.entries.filter((entry) => {
    if (entry.role !== "user" && entry.role !== "assistant") return false;
    return typeof entry.content === "string" && entry.content.trim().length > 0;
  });
}

export function canAdoptExternalHistory(
  history: Pick<ExternalSessionHistory, "availability" | "entries"> | undefined,
): boolean {
  return importableExternalEntries(history).length > 0;
}

export function buildAdoptedPiSessionJsonl(input: {
  cwd: string;
  title: string;
  source: ExternalSessionSource;
  externalSessionId: string;
  entries: readonly ExternalHistoryEntry[];
  now?: Date;
  sessionId?: string;
}): BuiltAdoptedSession {
  const importable = importableExternalEntries({ availability: "text", entries: [...input.entries] });
  if (!importable.length) {
    throw new Error("此外部会话没有可导入的正文，无法用 Pi 继续");
  }
  const now = input.now ?? new Date();
  const sessionId = input.sessionId ?? randomUUID();
  const stamp = now.toISOString();
  const fileName = `${stamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`;
  const header: PiSessionJsonlRow = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: stamp,
    cwd: input.cwd,
  };
  const infoId = randomUUID();
  const info: PiSessionJsonlRow = {
    type: "session_info",
    id: infoId,
    parentId: null,
    timestamp: stamp,
    name: input.title,
    adoptedFrom: {
      source: input.source,
      externalSessionId: input.externalSessionId,
    },
  };
  const lines = [JSON.stringify(header), JSON.stringify(info)];
  let parentId: string | null = infoId;
  for (const entry of importable) {
    const id = randomUUID();
    const timestamp = entry.timestamp > 0 ? new Date(entry.timestamp).toISOString() : stamp;
    const message = entry.role === "assistant"
      ? { role: "assistant", content: [{ type: "text", text: entry.content }] }
      : { role: "user", content: entry.content };
    lines.push(JSON.stringify({
      type: "message",
      id,
      parentId,
      timestamp,
      message,
    }));
    parentId = id;
  }
  return { sessionId, fileName, lines };
}

export async function writeAdoptedSessionFile(directory: string, built: BuiltAdoptedSession): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, built.fileName);
  await writeFile(path, built.lines.join("\n") + "\n");
  return path;
}

export async function rememberAdoption(
  agentDir: string,
  externalSessionId: string,
  piSessionId: string,
): Promise<void> {
  const map = await readAdoptedExternalMap(agentDir);
  map[externalSessionId] = piSessionId;
  await writeAdoptedExternalMap(agentDir, map);
}

export function liveAdoptedTargets(
  map: AdoptedExternalMap,
  sessionExists: (id: string) => boolean,
): AdoptedExternalMap {
  const live: AdoptedExternalMap = {};
  for (const [externalId, piId] of Object.entries(map)) {
    if (sessionExists(piId)) live[externalId] = piId;
  }
  return live;
}

export function suppressAdoptedExternalIds(
  sessions: readonly { id: string }[],
  map: AdoptedExternalMap,
  sessionExists: (id: string) => boolean,
): string[] {
  const live = liveAdoptedTargets(map, sessionExists);
  return sessions.filter((session) => !live[session.id]).map((session) => session.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

