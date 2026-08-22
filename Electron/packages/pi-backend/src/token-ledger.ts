import { promises as fs } from "node:fs";
import { dirname } from "node:path";

/**
 * Ledger line shape carried over from the retired Swift app's TokenLedger:
 * one JSON record per line in `pipiui-token-ledger.jsonl`, using the exact
 * line shape — `ts`/`session`/`channel`/`depth`/`model`/`turn`/`input`/
 * `output`/`cacheRead`/`cacheWrite`/`cost`/`contextTokens`, sorted keys, nulls
 * stripped — so historical ledger files stay readable across host
 * restarts and even a Swift ↔ Electron host switch on the same machine.
 *
 * `contextWindow` is an Electron-only extra field: Swift's parser reads only
 * the known keys and ignores it, so writing it keeps the shared format intact
 * while letting this host restore the ring's denominator on cold start.
 *
 * Billing semantics: assistant `message_end` rows carry that response's exact
 * provider usage. `get_session_stats` is cumulative across the whole session,
 * so context-only observations keep the billing fields at zero rather than
 * append a session total that Swift's per-turn reader would double count.
 */

export type LedgerContextRecord = {
  /** ISO-8601 with fractional seconds, e.g. `2026-08-10T00:00:05.000Z`. */
  ts: string;
  session: string;
  channel: string;
  depth: number;
  model: string;
  turn: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  contextWindow?: number;
};

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type ExactAssistantUsage = Pick<
  LedgerContextRecord,
  "input" | "output" | "cacheRead" | "cacheWrite" | "cost" | "contextTokens"
>;

const nonNegativeFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * Extract one provider response's exact usage. Missing/invalid fields fail
 * closed: this ledger never estimates tokens from text length or substitutes a
 * cumulative session total for a per-response value.
 */
export function exactAssistantUsage(value: unknown): ExactAssistantUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const cost = usage.cost;
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) return undefined;
  const costTotal = (cost as Record<string, unknown>).total;
  if (
    !nonNegativeFinite(usage.input) ||
    !nonNegativeFinite(usage.output) ||
    !nonNegativeFinite(usage.cacheRead) ||
    !nonNegativeFinite(usage.cacheWrite) ||
    !nonNegativeFinite(usage.totalTokens) ||
    !nonNegativeFinite(costTotal)
  ) return undefined;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost: costTotal,
    contextTokens: usage.totalTokens,
  };
}

/** Parse one ledger line. Returns null for malformed/unrelated lines. */
export function parseLedgerLine(line: string): LedgerContextRecord | null {
  if (!line.trim()) return null;
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (typeof obj.session !== "string" || !obj.session) return null;
  if (typeof obj.channel !== "string") return null;
  if (typeof obj.contextTokens !== "number" || !Number.isFinite(obj.contextTokens))
    return null;
  return {
    ts: typeof obj.ts === "string" ? obj.ts : "",
    session: obj.session,
    channel: obj.channel,
    depth: numberOrZero(obj.depth),
    model: typeof obj.model === "string" ? obj.model : "",
    turn: numberOrZero(obj.turn),
    input: numberOrZero(obj.input),
    output: numberOrZero(obj.output),
    cacheRead: numberOrZero(obj.cacheRead),
    cacheWrite: numberOrZero(obj.cacheWrite),
    cost: numberOrZero(obj.cost),
    contextTokens: obj.contextTokens,
    ...(typeof obj.contextWindow === "number" &&
    obj.contextWindow > 0 &&
    Number.isFinite(obj.contextWindow)
      ? { contextWindow: obj.contextWindow }
      : {}),
  };
}

/** Serialize one record as a single Swift-format JSON line (trailing `\n`). */
export function ledgerLine(record: LedgerContextRecord): string {
  const obj: Record<string, unknown> = {
    ts: record.ts,
    session: record.session,
    channel: record.channel,
    depth: record.depth,
    model: record.model,
    turn: record.turn,
    input: record.input,
    output: record.output,
    cacheRead: record.cacheRead,
    cacheWrite: record.cacheWrite,
    cost: record.cost,
    contextTokens: record.contextTokens,
  };
  if (typeof record.contextWindow === "number" && record.contextWindow > 0)
    obj.contextWindow = record.contextWindow;
  // Swift sorts keys and strips nulls for human-readable diffs; a replacer
  // array also pins the field order regardless of insertion sequence.
  return JSON.stringify(obj, Object.keys(obj).sort()) + "\n";
}

/** Read and parse every valid line of a ledger file. Missing file → []. */
export async function readLedgerFile(file: string): Promise<LedgerContextRecord[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const records: LedgerContextRecord[] = [];
  for (const line of text.split("\n")) {
    const record = parseLedgerLine(line);
    if (record) records.push(record);
  }
  return records;
}

/** Best-effort append; failures are dropped (a missed snapshot is fine). */
export async function appendLedgerRecord(
  file: string,
  record: LedgerContextRecord,
): Promise<void> {
  try {
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.appendFile(file, ledgerLine(record), "utf8");
  } catch {
    /* best-effort telemetry */
  }
}

export type SessionLastContext = {
  tokens: number;
  contextWindow?: number;
  /** Derived tokens/window fraction (0–100), null when no window is known. */
  percent: number | null;
};

/**
 * Per-session latest context sample from a batch of records. Mirrors Swift's
 * `TokenUsageStats.sessionUsage`: the newest record by `ts` wins (records are
 * not guaranteed to arrive in order), only `channel === "main"` records count.
 * Records without a `contextWindow` (e.g. Swift-written) yield `percent: null`.
 */
export function latestContextBySession(
  records: readonly LedgerContextRecord[],
  channel = "main",
): Map<string, SessionLastContext> {
  const newest = new Map<
    string,
    { ts: string; tokens: number; contextWindow?: number }
  >();
  for (const record of records) {
    if (record.channel !== channel) continue;
    const previous = newest.get(record.session);
    if (previous && (!record.ts || (previous.ts && record.ts <= previous.ts)))
      continue;
    newest.set(record.session, {
      ts: record.ts,
      tokens: record.contextTokens,
      ...(record.contextWindow !== undefined
        ? { contextWindow: record.contextWindow }
        : {}),
    });
  }
  const out = new Map<string, SessionLastContext>();
  for (const [session, entry] of newest) {
    const percent =
      entry.contextWindow && entry.contextWindow > 0
        ? Math.min(100, (entry.tokens / entry.contextWindow) * 100)
        : null;
    out.set(session, {
      tokens: entry.tokens,
      ...(entry.contextWindow !== undefined
        ? { contextWindow: entry.contextWindow }
        : {}),
      percent,
    });
  }
  return out;
}
