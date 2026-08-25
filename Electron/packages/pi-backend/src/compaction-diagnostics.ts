import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Best-effort JSONL probe for real compaction behavior: one schema-checked
 * line per record in `pipiui-compaction-diagnostics.jsonl` under the agent
 * dir. This is diagnostics plumbing, never business logic: every entry is
 * built from an allowlisted metadata schema — no conversation text, no
 * summaries, no tool args can reach the file because unknown keys are dropped
 * at serialization time and every string field is capped to a short length.
 * Write failures are swallowed behind a throttled warning.
 */

export const COMPACTION_DIAGNOSTICS_FILENAME = "pipiui-compaction-diagnostics.jsonl";
export const COMPACTION_DIAGNOSTICS_BACKUP_SUFFIX = ".1";
export const COMPACTION_DIAGNOSTICS_SCHEMA_VERSION = 1 as const;
/** Default cap for the live JSONL. One rotated backup is kept, so total is ~2× this. */
export const COMPACTION_DIAGNOSTICS_MAX_BYTES = 2 * 1024 * 1024;
/** Default minimum spacing between write-failure warnings. */
export const COMPACTION_DIAGNOSTICS_WARN_INTERVAL_MS = 300_000;
/** Host close waits this long for already-queued writes, then returns anyway. */
export const COMPACTION_DIAGNOSTICS_CLOSE_TIMEOUT_MS = 250;
/** Cap for every string field: fields here are short metadata tokens, never content. */
const STRING_FIELD_MAX = 256;
/** The only free-text field, `error`, gets a tighter cap. */
const ERROR_TEXT_MAX = 200;

/** Mirror of the host's compaction operations; `context_fold` reserved for future wiring. */
export type CompactionDiagnosticsOperation = "context_compaction" | "context_fold";

/** Mirror of the host's CompactionTrigger classification plus `unclassified`. */
export type CompactionDiagnosticsTrigger =
  | "manual"
  | "proactive_idle"
  | "near_overflow"
  | "overflow"
  | "mid_turn"
  | "idle_fold"
  | "auto_fold"
  | "unclassified";

/**
 * One diagnostics line. `schemaVersion`/`timestamp` are stamped by the writer.
 * `operationId` is null on scheduler decisions taken before any compaction
 * lifecycle exists; it pairs `compaction_start` with its `compaction_end`.
 */
export type CompactionDiagnosticsEntry = {
  sessionId: string;
  event: "compaction_start" | "compaction_end" | "scheduler_decision";
  operation: CompactionDiagnosticsOperation;
  trigger: CompactionDiagnosticsTrigger;
  /** Present to pair start/end. Omitted when there is no start to pair with. */
  operationId?: string | null;
  reason?: string;
  decision?: string;
  skipReason?: string;
  executed?: boolean;
  contextTokens?: number;
  contextWindow?: number;
  usagePercent?: number;
  idleMs?: number;
  requiredIdleMs?: number;
  remainingIdleMs?: number;
  highWatermark?: number;
  lowWatermark?: number;
  beforeTokens?: number;
  afterTokens?: number;
  durationMs?: number;
  success?: boolean;
  aborted?: boolean;
  /** Redacted + truncated by the caller; the writer truncates again. */
  error?: string;
  errorKind?: string;
};

export type CompactionDiagnosticsRecord = CompactionDiagnosticsEntry & {
  schemaVersion: typeof COMPACTION_DIAGNOSTICS_SCHEMA_VERSION;
  timestamp: string;
};

const ALLOWED_KEYS = [
  "schemaVersion",
  "timestamp",
  "sessionId",
  "event",
  "operation",
  "trigger",
  "operationId",
  "reason",
  "decision",
  "skipReason",
  "executed",
  "contextTokens",
  "contextWindow",
  "usagePercent",
  "idleMs",
  "requiredIdleMs",
  "remainingIdleMs",
  "highWatermark",
  "lowWatermark",
  "beforeTokens",
  "afterTokens",
  "durationMs",
  "success",
  "aborted",
  "error",
  "errorKind",
] as const;

function sanitizeString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.slice(0, max).trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Copy only allowlisted fields with sanitized values. Unknown keys — the only
 * route conversation content could take into this file — are dropped here.
 */
export function sanitizeCompactionDiagnosticsEntry(
  entry: CompactionDiagnosticsEntry,
): Partial<CompactionDiagnosticsRecord> {
  const source = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (key === "schemaVersion" || key === "timestamp") continue;
    if (!(key in source)) continue;
    const value = source[key];
    if (value === undefined) continue;
    if (key === "operationId") {
      if (typeof value === "string" && value) out.operationId = value.slice(0, STRING_FIELD_MAX);
      else out.operationId = null;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      // Finite non-negative only: every metric here is a count, fraction, or duration.
      if (Number.isFinite(value) && value >= 0) out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const sanitized = sanitizeString(value, key === "error" ? ERROR_TEXT_MAX : STRING_FIELD_MAX);
      if (sanitized !== undefined) out[key] = sanitized;
      continue;
    }
    if (value === null) continue;
  }
  return out as Partial<CompactionDiagnosticsRecord>;
}

/** Serialize one entry as a single JSON line (trailing `\n`), stamped with version + time. */
export function compactionDiagnosticsLine(
  entry: CompactionDiagnosticsEntry,
  nowMs: number,
): string {
  const sanitized = sanitizeCompactionDiagnosticsEntry(entry);
  const record: Record<string, unknown> = {
    schemaVersion: COMPACTION_DIAGNOSTICS_SCHEMA_VERSION,
    timestamp: new Date(nowMs).toISOString(),
  };
  for (const key of ALLOWED_KEYS) {
    if (key === "schemaVersion" || key === "timestamp") continue;
    if (key in sanitized) record[key] = (sanitized as Record<string, unknown>)[key];
  }
  return JSON.stringify(record) + "\n";
}

export function compactionDiagnosticsPath(agentDir: string): string {
  return join(agentDir, COMPACTION_DIAGNOSTICS_FILENAME);
}

export function compactionDiagnosticsBackupPath(agentDir: string): string {
  return compactionDiagnosticsPath(agentDir) + COMPACTION_DIAGNOSTICS_BACKUP_SUFFIX;
}

export type CompactionDiagnosticsOptions = {
  agentDir: string;
  now?: () => number;
  append?: (file: string, line: string) => Promise<void>;
  stat?: (file: string) => Promise<{ size: number }>;
  rotate?: (file: string, backup: string) => Promise<void>;
  maxBytes?: number;
  warnIntervalMs?: number;
  warn?: (message: string) => void;
};

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT");
}

async function defaultAppend(file: string, line: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.appendFile(file, line, "utf8");
}

async function defaultStat(file: string): Promise<{ size: number }> {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (isNotFound(error)) return { size: 0 };
    throw error;
  }
}

export type CompactionDiagnosticsRotateIo = {
  rename: (file: string, backup: string) => Promise<void>;
};

/**
 * Replace `backup` with `file` in one rename. On macOS a file-to-file rename
 * atomically swaps the destination; if it throws, the previous `.1` is left
 * untouched. Never delete the backup first — a failed rename would otherwise
 * destroy the only copy.
 */
export async function rotateCompactionDiagnosticsFile(
  file: string,
  backup: string,
  io: CompactionDiagnosticsRotateIo = { rename: (src, dest) => fs.rename(src, dest) },
): Promise<void> {
  try {
    await io.rename(file, backup);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
}

async function defaultRotate(file: string, backup: string): Promise<void> {
  await rotateCompactionDiagnosticsFile(file, backup);
}

function errorKind(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}

function waitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

export function createCompactionDiagnostics(options: CompactionDiagnosticsOptions) {
  const file = compactionDiagnosticsPath(options.agentDir);
  const backup = compactionDiagnosticsBackupPath(options.agentDir);
  const now = options.now ?? (() => Date.now());
  const append = options.append ?? defaultAppend;
  const stat = options.stat ?? defaultStat;
  const rotate = options.rotate ?? defaultRotate;
  const maxBytes = options.maxBytes ?? COMPACTION_DIAGNOSTICS_MAX_BYTES;
  const warnIntervalMs = options.warnIntervalMs ?? COMPACTION_DIAGNOSTICS_WARN_INTERVAL_MS;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  /** Rotation + append share one chain so lines stay whole and ordered. */
  let chain = Promise.resolve();
  let lastWarnAt: number | undefined;

  function warnThrottled(detail: string): void {
    const at = now();
    if (lastWarnAt !== undefined && at - lastWarnAt < warnIntervalMs) return;
    lastWarnAt = at;
    warn(`[compaction-diagnostics] ${detail}`);
  }

  function record(entry: CompactionDiagnosticsEntry): void {
    let line: string;
    try {
      line = compactionDiagnosticsLine(entry, now());
    } catch {
      warnThrottled("record serialization failed");
      return;
    }
    chain = chain.then(async () => {
      try {
        const size = (await stat(file)).size;
        if (size >= maxBytes) await rotate(file, backup);
      } catch (error) {
        warnThrottled(`size check/rotation failed: ${errorKind(error)}`);
      }
      try {
        await append(file, line);
      } catch (error) {
        warnThrottled(`append failed: ${errorKind(error)}`);
      }
    });
  }

  async function close(timeoutMs = COMPACTION_DIAGNOSTICS_CLOSE_TIMEOUT_MS): Promise<void> {
    await waitWithTimeout(chain, timeoutMs);
  }

  return {
    file,
    record,
    close,
    pending: () => chain,
  };
}

export type CompactionDiagnostics = ReturnType<typeof createCompactionDiagnostics>;
