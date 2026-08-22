/*
 * persistence.ts — event-sourced fold state across restarts (DESIGN.md §6).
 *
 * Spool locations, agent unfolds, and committed frozen layers live in memory during a session, so
 * they are persisted as custom entries and replayed on resume. Legacy `kind:"gate"` records remain
 * readable so old folded handles keep resolving after the arrival-time ingestion gate's removal.
 *
 * Custom entries don't enter LLM context; they exist purely to reconstruct state (CustomEntry docs).
 */
import { readEnvelopeAt, SpoolError } from "./spool";
import type { SpoolEntry } from "../../core/spool-registry";

/** The customType tag for every context-fold state entry. */
export const FOLD_CUSTOM_TYPE = "contextfold.fold";

/** One committed prefix-stable layer: substitution BYTES are persisted verbatim, because a
 *  byte-exact head across resume is the whole point — recomputing digests after a code change
 *  would silently shift the cached prefix. Custom entries never enter LLM context, so the cost
 *  is disk only. */
export interface FrozenLayerRecord {
	seq: number;
	entries: { id: string; digestText: string }[];
}

/** One event on the fold ledger. `gate` is a legacy arrival-gate spool record. Unknown kinds are
 * ignored on restore. */
export type FoldRecord =
	| { kind: "spool"; entry: SpoolEntry }
	| { kind: "gate"; entry: SpoolEntry }
	| { kind: "unfold"; ids: string[] }
	| { kind: "layer"; layer: FrozenLayerRecord };

/** The subset of the pi API this module uses (kept minimal so it is trivially fakeable in tests). */
export interface EntryAppender {
	appendEntry(customType: string, data?: unknown): void;
}

/** The shape of a session entry we read back (CustomEntry: `{type,customType,data}`). */
export interface EntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
}

/** Record the exact-content spool location for a newly folded block. */
export function recordSpoolEntry(pi: EntryAppender, entry: SpoolEntry): void {
	pi.appendEntry(FOLD_CUSTOM_TYPE, { kind: "spool", entry } satisfies FoldRecord);
}

/** Record that the agent unfolded one or more blocks (sticky across resume). */
export function recordUnfold(pi: EntryAppender, ids: string[]): void {
	if (ids.length) pi.appendEntry(FOLD_CUSTOM_TYPE, { kind: "unfold", ids } satisfies FoldRecord);
}

/** Record a committed prefix-stable layer (byte-exact resume). */
export function recordLayer(pi: EntryAppender, layer: FrozenLayerRecord): void {
	if (layer.entries.length) pi.appendEntry(FOLD_CUSTOM_TYPE, { kind: "layer", layer } satisfies FoldRecord);
}

/**
 * Left-fold the session's context-fold entries into the restored state: the latest spool entry per
 * block wins, and every unfolded id accumulates. Pure — no disk, deterministic in entry order.
 */
export function restoreFoldState(entries: EntryLike[]): {
	spoolEntries: SpoolEntry[];
	unfoldedIds: Set<string>;
	layers: FrozenLayerRecord[];
} {
	const byBlock = new Map<string, SpoolEntry>();
	const unfoldedIds = new Set<string>();
	const layersBySeq = new Map<number, FrozenLayerRecord>();
	for (const e of entries) {
		if (e.customType !== FOLD_CUSTOM_TYPE) continue;
		const rec = e.data as FoldRecord | undefined;
		if (!rec || typeof rec !== "object") continue;
		if ((rec.kind === "spool" || rec.kind === "gate") && rec.entry?.blockId) byBlock.set(rec.entry.blockId, rec.entry);
		else if (rec.kind === "unfold" && Array.isArray(rec.ids)) for (const id of rec.ids) unfoldedIds.add(id);
		else if (rec.kind === "layer" && rec.layer && typeof rec.layer.seq === "number" && Array.isArray(rec.layer.entries))
			layersBySeq.set(rec.layer.seq, rec.layer);
	}
	const layers = [...layersBySeq.values()].sort((a, b) => a.seq - b.seq);
	return { spoolEntries: [...byBlock.values()], unfoldedIds, layers };
}

/**
 * Revalidate restored entries against their spool files. A missing/corrupt entry is dropped from
 * recall's durable route; a still-live folded block remains recoverable from the session snapshot.
 */
export function revalidateSpools(entries: SpoolEntry[]): {
	valid: SpoolEntry[];
	dropped: { code: string; path: string; reason: string }[];
} {
	const valid: SpoolEntry[] = [];
	const dropped: { code: string; path: string; reason: string }[] = [];
	for (const e of entries) {
		try {
			readEnvelopeAt(e.spoolPath);
			valid.push(e);
		} catch (err) {
			dropped.push({ code: e.code, path: e.spoolPath, reason: err instanceof SpoolError ? err.message : String(err) });
		}
	}
	return { valid, dropped };
}
