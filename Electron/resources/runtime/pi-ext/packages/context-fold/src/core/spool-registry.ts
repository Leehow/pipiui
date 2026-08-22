/*
 * spool-registry.ts — serializable locations for the exact content behind folded blocks.
 *
 * The adapter spools each block when the pressure-driven ladder masks it, then records one entry
 * here keyed by the block's durable id. Recall can therefore recover the original after Pi hard
 * compaction removes the raw message from live history. This pure core store holds metadata only;
 * the adapter owns disk I/O and rebuilds it from the session ledger on resume.
 */

/** One spool-backed folded block. All fields are serializable for event-sourced persistence. */
export interface SpoolEntry {
	/** Durable id of the folded block. */
	blockId: string;
	/** The 6-char fold code (= foldCode(blockId)); the pointer's {#code FOLDED} handle. */
	code: string;
	/** Full-fidelity token weight, retained for backward-compatible session records. */
	fullTokens: number;
	tool: string;
	/** Original tool arguments when available in a legacy spool record. */
	input?: unknown;
	isError: boolean;
	/** Byte length of the full spooled content. */
	bytes: number;
	/** Estimated tokens in the full spooled content. */
	fullEstTokens: number;
	/** Absolute spool file path. */
	spoolPath: string;
	/** A tool-owned full-output file, when an older record supplied one. */
	fullOutputPath?: string;
	/** Set when this payload was identical to an earlier spool entry. */
	dedupOf?: string;
}

export interface SpoolRegistry {
	has(blockId: string): boolean;
	get(blockId: string): SpoolEntry | undefined;
	set(entry: SpoolEntry): void;
	readonly size: number;
	entries(): IterableIterator<SpoolEntry>;
}

/** Default in-memory registry, populated on fold and rebuilt from the session ledger on resume. */
export class MapSpoolRegistry implements SpoolRegistry {
	private readonly byId = new Map<string, SpoolEntry>();

	has(blockId: string): boolean {
		return this.byId.has(blockId);
	}
	get(blockId: string): SpoolEntry | undefined {
		return this.byId.get(blockId);
	}
	set(entry: SpoolEntry): void {
		this.byId.set(entry.blockId, entry);
	}
	/** Drop every entry when one Pi process switches sessions. */
	clear(): void {
		this.byId.clear();
	}
	get size(): number {
		return this.byId.size;
	}
	entries(): IterableIterator<SpoolEntry> {
		return this.byId.values();
	}
}
