/**
 * Durable record of whether catalog ingestion is actually running.
 *
 * Catalog ingestion is wired only when the Hermes backend exposes a catalog
 * port. When it is not, every submitted candidate is discarded by an optional
 * chain and the catalog simply stops growing — indistinguishable from "no
 * subagent submitted anything". This project's catalog took 109 records across
 * two days and then recorded nothing for six more; the only way to notice was
 * to count lines in the jsonl by hand.
 *
 * Console output is not a fix for that: the host keeps a 16KB rolling stderr
 * tail and surfaces it only when Pi exits abnormally, so a startup warning is
 * invisible in exactly the case that matters — a healthy session quietly
 * ingesting nothing. This writes a small file next to the catalog instead, so
 * the state can be read at any time, by a person or by a check.
 */

import { open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const INGESTION_STATE_VERSION = 1 as const;
export const INGESTION_STATE_FILE = "ingestion-state.json";

/** Why candidates cannot reach the catalog. Absent when ingestion is wired. */
export type IngestionUnwiredReason = "no-catalog" | "no-catalog-port" | "curator-unavailable";

export type IngestionState = {
  version: typeof INGESTION_STATE_VERSION;
  /** When this snapshot was written. */
  at: number;
  wired: boolean;
  reason?: IngestionUnwiredReason;
  /** Counts for the session that wrote this file, not lifetime totals. */
  session: { received: number; forwarded: number; discarded: number };
  /** Last time a candidate arrived, in any session that wrote this file. */
  lastCandidateAt?: number;
};

export function ingestionStatePath(catalogRoot: string): string {
  return join(catalogRoot, INGESTION_STATE_FILE);
}

/**
 * Publish atomically and fail soft. Diagnostics must never break a session, and
 * a torn file would be worse than none — a reader could not tell a partial
 * write from a genuine zero.
 */
export async function publishIngestionState(catalogRoot: string, state: Omit<IngestionState, "version" | "at">, now: () => number = Date.now): Promise<void> {
  const destination = ingestionStatePath(catalogRoot);
  const temporary = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
  const payload: IngestionState = { version: INGESTION_STATE_VERSION, at: now(), ...state };
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  } catch {
    await unlink(temporary).catch(() => {});
  }
}

/** Read back a published snapshot. Returns undefined for missing or unreadable state. */
export async function readIngestionState(catalogRoot: string): Promise<IngestionState | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(ingestionStatePath(catalogRoot), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const value = parsed as Partial<IngestionState>;
    if (value.version !== INGESTION_STATE_VERSION || typeof value.wired !== "boolean") return undefined;
    return value as IngestionState;
  } catch {
    return undefined;
  }
}

/**
 * Tracks one session's ingestion and decides when a snapshot is worth writing.
 *
 * Writing per candidate would be pointless I/O, but writing only at shutdown
 * would lose the evidence in a crash — which is when an operator most wants it.
 * So: publish when the state is established, again on the first discard, and
 * once more with final counts at shutdown.
 */
export class IngestionStateReporter {
  private readonly catalogRoot: string;
  private readonly now: () => number;
  private received = 0;
  private forwarded = 0;
  private discarded = 0;
  private lastCandidateAt: number | undefined;
  private wired = false;
  private reason: IngestionUnwiredReason | undefined;

  constructor(catalogRoot: string, now: () => number = Date.now) {
    this.catalogRoot = catalogRoot;
    this.now = now;
  }

  /** Record how the session started and publish the baseline. */
  async start(wired: boolean, reason?: IngestionUnwiredReason): Promise<void> {
    this.wired = wired;
    this.reason = wired ? undefined : reason;
    await this.publish();
  }

  /** A candidate reached the catalog. */
  forward(): void {
    this.received++;
    this.forwarded++;
    this.lastCandidateAt = this.now();
  }

  /** A candidate was dropped because ingestion is not wired. */
  async discard(): Promise<void> {
    this.received++;
    this.discarded++;
    this.lastCandidateAt = this.now();
    // Only the first: the condition is session-wide, so repeated writes would
    // add I/O without adding information.
    if (this.discarded === 1) await this.publish();
  }

  async finish(): Promise<void> {
    await this.publish();
  }

  private async publish(): Promise<void> {
    await publishIngestionState(
      this.catalogRoot,
      {
        wired: this.wired,
        ...(this.reason ? { reason: this.reason } : {}),
        session: { received: this.received, forwarded: this.forwarded, discarded: this.discarded },
        ...(this.lastCandidateAt ? { lastCandidateAt: this.lastCandidateAt } : {}),
      },
      this.now,
    );
  }
}
