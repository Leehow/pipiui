/**
 * Session-boundary watermark compaction for the Hermes failure memory.
 *
 * Hermes only triggers consolidation once a markdown target is already full,
 * and its consolidation prompt carries no numeric headroom target — it stops as
 * soon as the result fits. The store's stable state is therefore "pinned just
 * under the cap", and every later add pays a full consolidation subprocess plus
 * two file rewrites. Raising the cap only moves the wall; the attractor is
 * unchanged.
 *
 * This module supplies the missing deadband from outside the pinned package.
 * At session shutdown, a target above the high-water mark is compacted back to
 * the low-water mark, so the next session starts with real headroom and the
 * expensive mid-turn overflow path stays cold.
 *
 * Two deliberate constraints:
 *
 *  - Only `failures.md` is compacted. USER.md is excluded because the user
 *    profile has no recency semantics: its oldest entries are standing
 *    preferences, not stale lessons.
 *  - Entries are archived before they are removed, never dropped. The catalog
 *    does not hold copies of model-written failure entries, so a plain FIFO
 *    trim would be unrecoverable data loss.
 */

import { readFile, rename, writeFile, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

/** Hermes joins markdown memory entries with this exact separator. */
const ENTRY_DELIMITER = "\n§\n";
/** Mirrors DEFAULT_MEMORY_CHAR_LIMIT in pi-hermes-memory constants.ts. */
const DEFAULT_MEMORY_CHAR_LIMIT = 5000;
/** Hermes: charLimit("failure") === memoryCharLimit * 2 ("failures get more space"). */
const FAILURE_LIMIT_MULTIPLIER = 2;
/**
 * Deliberately a backstop, not the primary mechanism. Measured behaviour of the
 * live store is a sawtooth: Hermes consolidation fires at the cap and merges
 * back down to roughly 70%, so it already maintains the store on its own. This
 * module exists only to stop a session *ending* near the cap, which would leave
 * the next session's first few adds paying consolidation mid-turn.
 *
 * A high trigger keeps the intelligent merge in charge during normal operation
 * and reserves archival trimming for the pinned-at-cap state it is meant to
 * prevent. The gap between the two marks is the deadband: too narrow and the
 * trim fires again almost immediately.
 */
const DEFAULT_HIGH_WATER = 0.85;
const DEFAULT_LOW_WATER = 0.7;
const FAILURE_FILE = "failures.md";
const ARCHIVE_FILE = "failures-archive.md";

export type WatermarkOutcome =
  | "below-high-water"
  | "compacted"
  | "no-source"
  | "nothing-removable"
  | "raced"
  | "failed";

export type WatermarkResult = {
  outcome: WatermarkOutcome;
  /** Character count before compaction, measured the way Hermes measures it. */
  before?: number;
  after?: number;
  limit?: number;
  archived?: number;
  detail?: string;
};

type WatermarkThresholds = { highWater: number; lowWater: number };

/**
 * Resolve the agent root the same way hermes-adapter does, so this module reads
 * the configuration file that actually governs the running store.
 */
export function watermarkAgentRoot(env: Record<string, string | undefined>): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  return configured ? resolve(configured) : join(homedir(), ".pi", "agent");
}

/**
 * Mirrors memoryDirectory() in hermes-adapter: a configured memoryDir wins
 * unless it still points at the legacy location, which Hermes redirects.
 */
export function watermarkMemoryDirectory(agentRoot: string, config: Record<string, unknown>): string {
  const configured = typeof config.memoryDir === "string" ? config.memoryDir.trim() : "";
  const legacy = join(agentRoot, "memory");
  return !configured || resolve(configured) === resolve(legacy)
    ? join(agentRoot, "pi-hermes-memory")
    : configured;
}

function parseEntries(content: string): string[] {
  return content.split(ENTRY_DELIMITER).map((entry) => entry.trim()).filter(Boolean);
}

/** Hermes measures usage as the joined length, not the file's byte size. */
function usageOf(entries: string[]): number {
  return entries.length ? entries.join(ENTRY_DELIMITER).length : 0;
}

function failureLimit(config: Record<string, unknown>): number {
  const configured = config.memoryCharLimit;
  const base = typeof configured === "number" && Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MEMORY_CHAR_LIMIT;
  return base * FAILURE_LIMIT_MULTIPLIER;
}

/**
 * Thresholds are overridable through the same configuration file, which
 * mergeHermesConfiguration preserves because it spreads the existing record.
 */
export function watermarkThresholds(config: Record<string, unknown>): WatermarkThresholds {
  const readFraction = (value: unknown, fallback: number): number => (
    typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback
  );
  const highWater = readFraction(config.failureHighWater, DEFAULT_HIGH_WATER);
  const lowWater = readFraction(config.failureLowWater, DEFAULT_LOW_WATER);
  // A low-water mark at or above the high-water mark would remove the deadband
  // this module exists to create, so fall back rather than honour it.
  return lowWater < highWater ? { highWater, lowWater } : { highWater: DEFAULT_HIGH_WATER, lowWater: DEFAULT_LOW_WATER };
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Publish via a same-directory temp file so a reader never sees a partial store. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.watermark-${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

function archiveBlock(entries: string[], at: Date): string {
  const header = `<!-- archived-at=${at.toISOString()} count=${entries.length} -->`;
  return [header, ...entries].join(ENTRY_DELIMITER);
}

/**
 * Archive-then-trim `failures.md` back to the low-water mark.
 *
 * Ordering is the durability contract: the archive is appended and flushed
 * before the source is rewritten. A crash in between duplicates entries into
 * the archive, which is recoverable; the reverse order would lose them.
 */
export async function compactFailureMemory(options: {
  memoryDir: string;
  config?: Record<string, unknown>;
  now?: () => Date;
  /** Test seam: runs between the archive flush and the compare-and-swap. */
  afterArchive?: () => Promise<void> | void;
}): Promise<WatermarkResult> {
  const config = options.config ?? {};
  const now = options.now ?? (() => new Date());
  const sourcePath = join(options.memoryDir, FAILURE_FILE);
  const archivePath = join(options.memoryDir, ARCHIVE_FILE);

  try {
    const original = await readIfPresent(sourcePath);
    if (original === null) return { outcome: "no-source" };

    const limit = failureLimit(config);
    const { highWater, lowWater } = watermarkThresholds(config);
    const entries = parseEntries(original);
    const before = usageOf(entries);
    if (before <= limit * highWater) return { outcome: "below-high-water", before, limit };

    // Hermes appends new entries, so index 0 is the oldest. Always leave one
    // entry behind: an empty failure store would read as "no lessons learned"
    // rather than "lessons archived".
    const target = limit * lowWater;
    const remaining = [...entries];
    const removed: string[] = [];
    while (remaining.length > 1 && usageOf(remaining) > target) {
      removed.push(remaining.shift()!);
    }
    if (!removed.length) return { outcome: "nothing-removable", before, limit };

    const existingArchive = await readIfPresent(archivePath);
    const block = archiveBlock(removed, now());
    await writeAtomic(archivePath, existingArchive ? `${existingArchive}${ENTRY_DELIMITER}${block}` : block);
    await options.afterArchive?.();

    // Compare-and-swap: only publish the trimmed store if nothing wrote to it
    // while the archive was being flushed. Hermes owns this file through its own
    // mutation lock, which this module cannot join from outside the package.
    const current = await readIfPresent(sourcePath);
    if (current !== original) return { outcome: "raced", before, limit, archived: removed.length };

    await writeAtomic(sourcePath, remaining.join(ENTRY_DELIMITER));
    return { outcome: "compacted", before, after: usageOf(remaining), limit, archived: removed.length };
  } catch (error) {
    return { outcome: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Session-shutdown entry point. Resolves the live store from the environment and
 * never throws: shutdown must not be blocked by opportunistic maintenance.
 */
export async function compactFailureMemoryAtShutdown(
  env: Record<string, string | undefined> = process.env,
): Promise<WatermarkResult> {
  try {
    const agentRoot = watermarkAgentRoot(env);
    const raw = await readIfPresent(join(agentRoot, "hermes-memory-config.json"));
    let config: Record<string, unknown> = {};
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    }
    return await compactFailureMemory({ memoryDir: watermarkMemoryDirectory(agentRoot, config), config });
  } catch (error) {
    return { outcome: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}
