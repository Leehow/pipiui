/*
 * index-store.ts — seed-index emission at fold events (docs/SEED_INDEX_SPEC.md).
 *
 * On every fold event the adapter (1) spools each masked block's full text — the durability
 * floor for exact recall after hard compaction — and (2) appends one deterministic
 * index record to
 * `<spoolDir>/seed-index.jsonl`. The JSONL is append-only and IS the persistence: resume just
 * keeps appending under later seqs, and `latest record per seq wins` is the consumer contract.
 *
 * The caller treats successful spool + index emission as a fold commit precondition. A failure
 * keeps that turn raw rather than creating an unrecallable frozen layer.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractIndex, buildIndexRecord, type IndexBlock, type IndexSpan, type SeedIndexRecord } from "../../core/index/seed-index";
import { foldCode, wireFoldable } from "../../core/digest";
import { BLOCK_OVERHEAD } from "../../core/tokens";
import { isDurableId, type WireBlock } from "../../core/block";
import type { FoldEventReport } from "./store";
import { SpoolError, type SpoolStore, type SpoolWriteResult } from "./spool";
import type { SpoolEntry, SpoolRegistry } from "../../core/spool-registry";

export const INDEX_FILENAME = "seed-index.jsonl";
export const INDEX_HARNESS = "pi-context-fold";

export class SeedIndexStore {
	private ensured = false;
	constructor(private readonly dir: string) {}

	get path(): string {
		return join(this.dir, INDEX_FILENAME);
	}

	append(record: SeedIndexRecord): void {
		if (!this.ensured) {
			mkdirSync(dirname(this.path), { recursive: true });
			this.ensured = true;
		}
		appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
	}

	/** All parseable records, file order. Tolerates junk lines and unknown higher versions. */
	readAll(): SeedIndexRecord[] {
		if (!existsSync(this.path)) return [];
		const out: SeedIndexRecord[] = [];
		for (const line of readFileSync(this.path, "utf8").split("\n")) {
			const t = line.trim();
			if (!t) continue;
			try {
				const rec = JSON.parse(t) as SeedIndexRecord;
				if (rec && rec.kind === "fold-index" && Array.isArray(rec.spans)) out.push(rec);
			} catch {
				/* junk line — skip */
			}
		}
		return out;
	}
}

/**
 * Handle one engine fold event: spool the masked blocks, build spans, extract index fields, and
 * append the record. A block may already own a spool entry (restored at resume, written at
 * compaction, or by an earlier event); reuse it rather than duplicating the payload. A
 * per-block SpoolError (fold-code collision)
 * drops only that block, reported via `droppedIds` so the engine leaves it raw and holds it.
 * Deterministic except for `now`.
 */
export function emitFoldIndex(
	event: FoldEventReport,
	deps: {
		spool: SpoolStore;
		registry: SpoolRegistry;
		index: SeedIndexStore;
		sessionId: string;
		now?: number;
		/** Persist each new spool entry before it becomes visible in the in-memory registry. */
		persistEntry?: (entry: SpoolEntry) => void;
	},
): { record: SeedIndexRecord; newEntries: SpoolEntry[]; droppedIds: string[] } {
	const byId = new Map(event.blocks.map((b) => [b.id, b] as const));
	const masked: WireBlock[] = [];
	for (const id of event.maskedIds) {
		const b = byId.get(id);
		if (b) masked.push(b);
	}

	const spans: IndexSpan[] = [];
	const newEntries: SpoolEntry[] = [];
	/** Blocks whose spool write is durably done — the only ones the record may claim as masked. */
	const spooled: WireBlock[] = [];
	const droppedIds: string[] = [];
	for (const b of masked) {
		const existing = deps.registry.get(b.id);
		if (existing) {
			// Already spooled — point at the existing envelope, don't duplicate.
			spans.push({
				blockId: b.id,
				code: existing.code,
				tool: existing.tool,
				turn: b.turn,
				log: { path: existing.spoolPath, byteStart: 0, byteEnd: existing.bytes, lines: countLines(b.text) },
				fullOutputPath: existing.fullOutputPath,
			});
			spooled.push(b);
			continue;
		}
		const code = foldCode(b.id);
		let res: SpoolWriteResult;
		try {
			res = deps.spool.write({
				blockId: b.id,
				code,
				tool: b.toolName ?? b.kind,
				input: undefined,
				isError: b.isError ?? false,
				content: b.text,
				now: deps.now,
			});
		} catch (err) {
			// A SpoolError here is per-BLOCK and permanent for this id (fold-code collision, or a
			// corrupt existing envelope at this code's path). Fail open per block: drop the collider
			// from the event and fold the rest — one unlucky hash must never end folding for the
			// session. Anything else (disk full, unwritable dir) leaves the whole event's durability
			// unproven, so it still rejects the event by rethrowing.
			if (err instanceof SpoolError) {
				droppedIds.push(b.id);
				continue;
			}
			throw err;
		}
		spans.push({
			blockId: b.id,
			code,
			tool: b.toolName ?? b.kind,
			turn: b.turn,
			log: {
				path: deps.spool.pathFor(code),
				byteStart: 0,
				byteEnd: res.envelope.bytes,
				lines: countLines(b.text),
			},
		});
		// Stage the registry entry; publish it only after the complete index record is durable.
		const entry: SpoolEntry = {
			blockId: b.id,
			code,
			fullTokens: b.tokens + BLOCK_OVERHEAD,
			tool: b.toolName ?? b.kind,
			input: undefined,
			isError: b.isError ?? false,
			bytes: res.envelope.bytes,
			fullEstTokens: res.envelope.estTokens,
			spoolPath: deps.spool.pathFor(code),
			dedupOf: res.dedupOf,
		};
		newEntries.push(entry);
		spooled.push(b);
	}

	const record = buildIndexRecord(
		{
			harness: INDEX_HARNESS,
			session: deps.sessionId,
			seq: event.seq,
			at: new Date(deps.now ?? Date.now()).toISOString(),
			trigger: event.trigger,
			usage: {
				tokens: Math.round(event.usage.tokens),
				contextWindow: event.usage.contextWindow,
				fraction: Math.round(event.usage.fraction * 1000) / 1000,
			},
		},
		// Extraction covers only the durably spooled blocks: a dropped collider stays raw in the
		// live view, so nothing of it is leaving history and nothing of it needs indexing.
		extractIndex({ masked: spooled as unknown as IndexBlock[], all: event.blocks as unknown as IndexBlock[] }),
		spans,
	);
	deps.index.append(record);
	for (const entry of newEntries) deps.persistEntry?.(entry);
	for (const entry of newEntries) deps.registry.set(entry);
	return { record, newEntries, droppedIds };
}

/**
 * Spool-at-compaction: write every foldable, durable, not-yet-spooled block that is about to
 * leave live history, so recall covers the ENTIRE compacted span rather than only the blocks a
 * fold event happened to reach first (a result inside the protected tail at compaction time, or
 * a session compacted before its first fold, would otherwise leave no recall route). Runs before
 * `emitCompactIndex` so the new entries carry recovery spans in the compact record.
 *
 * Per-block fail-open: an unspoolable block just isn't recallable afterwards — Pi's session JSONL
 * still keeps it — and compaction itself never fails over spooling.
 */
export function spoolCompactedBlocks(
	blocks: WireBlock[],
	deps: {
		spool: SpoolStore;
		registry: SpoolRegistry;
		now?: number;
		/** Persist each new spool entry so the durable route survives resume. */
		persistEntry?: (entry: SpoolEntry) => void;
	},
): SpoolEntry[] {
	const added: SpoolEntry[] = [];
	for (const b of blocks) {
		if (!wireFoldable(b) || !isDurableId(b.id) || !b.text || deps.registry.has(b.id)) continue;
		const code = foldCode(b.id);
		let res: SpoolWriteResult;
		try {
			res = deps.spool.write({
				blockId: b.id,
				code,
				tool: b.toolName ?? b.kind,
				input: undefined,
				isError: b.isError ?? false,
				content: b.text,
				now: deps.now,
			});
		} catch {
			continue;
		}
		const entry: SpoolEntry = {
			blockId: b.id,
			code,
			fullTokens: b.tokens + BLOCK_OVERHEAD,
			tool: b.toolName ?? b.kind,
			input: undefined,
			isError: b.isError ?? false,
			bytes: res.envelope.bytes,
			fullEstTokens: res.envelope.estTokens,
			spoolPath: deps.spool.pathFor(code),
			dedupOf: res.dedupOf,
		};
		deps.persistEntry?.(entry);
		deps.registry.set(entry);
		added.push(entry);
	}
	return added;
}

/**
 * Emit the FINAL index record at hard compaction: the whole span being summarized is about to
 * leave live history, so index it all (Pi's session JSONL keeps the raw entries; spooled blocks
 * additionally carry spans here). Returns the record for the det-summary renderer.
 */
export function emitCompactIndex(
	blocks: WireBlock[],
	deps: {
		registry: SpoolRegistry;
		index: SeedIndexStore;
		sessionId: string;
		tokensBefore: number;
		contextWindow: number | null;
		now?: number;
	},
): SeedIndexRecord {
	const masked = blocks.filter((b) => b.kind !== "user");
	const spans: IndexSpan[] = [];
	for (const b of masked) {
		const e = deps.registry.get(b.id);
		if (!e) continue;
		spans.push({
			blockId: b.id,
			code: e.code,
			tool: e.tool,
			turn: b.turn,
			log: { path: e.spoolPath, byteStart: 0, byteEnd: e.bytes, lines: countLines(b.text) },
			fullOutputPath: e.fullOutputPath,
		});
	}
	const seq = deps.index.readAll().reduce((m, r) => Math.max(m, r.seq), 0) + 1;
	const cw = deps.contextWindow ?? 0;
	const record = buildIndexRecord(
		{
			harness: INDEX_HARNESS,
			session: deps.sessionId,
			seq,
			at: new Date(deps.now ?? Date.now()).toISOString(),
			trigger: "compact",
			usage: {
				tokens: deps.tokensBefore,
				contextWindow: cw,
				fraction: cw > 0 ? Math.round((deps.tokensBefore / cw) * 1000) / 1000 : 0,
			},
		},
		extractIndex({ masked: masked as unknown as IndexBlock[], all: blocks as unknown as IndexBlock[] }),
		spans,
	);
	deps.index.append(record);
	return record;
}

function countLines(s: string): number {
	if (!s) return 0;
	let n = 1;
	for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
	return n;
}
