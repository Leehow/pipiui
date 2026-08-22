/*
 * compact.test.ts — the deterministic hard-compaction summary (Pi decides when it fires): rendering,
 * the final "compact" index record, and the guarantee that ladder-masked content stays
 * recallable AFTER compaction removes the raw messages from live history.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import { SpoolStore } from "../src/adapters/pi/spool";
import { SeedIndexStore, emitFoldIndex, emitCompactIndex, spoolCompactedBlocks } from "../src/adapters/pi/index-store";
import { renderDetCompactionSummary } from "../src/adapters/pi/compact";
import { linearize, type WireBlock } from "../src/core/block";
import type { AgentMessage } from "../src/core/block";
import { user, assistantText, assistantWithCalls, bigResult, toolResult } from "./helpers";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup() {
	dir = mkdtempSync(join(tmpdir(), "contextfold-compact-"));
	const registry = new MapSpoolRegistry();
	const spool = new SpoolStore(dir);
	const index = new SeedIndexStore(dir);
	const e = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, registry);
	e.onFoldEvent = (ev) => emitFoldIndex(ev, { spool, registry, index, sessionId: "s-compact", now: 1_722_200_000_000 });
	return { e, registry, spool, index };
}

function needled(): { messages: AgentMessage[]; needle: string } {
	const needle = "CAP_X9_LIMIT=52418";
	const messages: AgentMessage[] = [user("dig through the dumps")];
	for (let i = 0; i < 7; i++) {
		messages.push(assistantWithCalls([{ id: `c${i}`, name: "read" }]));
		messages.push(bigResult(`c${i}`, 400));
	}
	const lines = Array.from({ length: 300 }, (_, j) => `r${j}: ${"q".repeat(40)}`);
	lines[144] = `   ${needle} (planted)`;
	messages.push(assistantWithCalls([{ id: "cx", name: "read" }]));
	messages.push(toolResult("cx", lines.join("\n"), "read"));
	messages.push(assistantText("finished reading", "after-cx"));
	messages.push(user("newest question"));
	return { messages, needle };
}

describe("recall survives hard compaction", () => {
	it("a ladder-masked block resolves from the spool once its raw message left history", () => {
		const { e, index } = setup();
		const { messages, needle } = needled();
		e.process(messages, { contextWindow: 80_000, tokens: null }); // fold event → spool + registry

		const rec = index.readAll()[0];
		const span = rec.spans.find((s) => s.blockId === "r:cx");
		expect(span).toBeDefined();

		// Simulate post-compaction history: the old messages are GONE from the array Pi sends.
		const postCompact: AgentMessage[] = [user("fresh start after compaction")];
		e.process(postCompact, { contextWindow: 80_000, tokens: null }); // snapshot no longer has r:cx

		const { matches, missing, errors } = e.resolveRecall([span!.code!], { grep: "CAP_X9_LIMIT" });
		expect(missing).toEqual([]);
		expect(errors).toEqual([]);
		expect(matches[0].text).toContain(needle);
	});

	it("spool-at-compaction makes a NEVER-folded block recallable after it leaves history", () => {
		const { e, registry, spool, index } = setup();
		// A short session compacted before any fold event: nothing is in the registry yet.
		const needle = "UNFOLDED_NEEDLE_Z7=140072";
		const lines = Array.from({ length: 200 }, (_, j) => `u${j}: ${"w".repeat(30)}`);
		lines[99] = `   ${needle} (planted)`;
		const messages: AgentMessage[] = [
			user("quick look"),
			assistantWithCalls([{ id: "cu", name: "read" }]),
			toolResult("cu", lines.join("\n"), "read"),
			assistantText("done", "after-cu"),
		];
		expect(registry.size).toBe(0);

		// Hard compaction: spool the leaving span, then emit the compact record.
		const blocks = linearize(messages) as unknown as WireBlock[];
		const added = spoolCompactedBlocks(blocks, { spool, registry, now: 1_722_200_200_000 });
		expect(added.map((a) => a.blockId)).toContain("r:cu");
		const rec = emitCompactIndex(blocks, {
			registry, index, sessionId: "s-compact", tokensBefore: 5_000, contextWindow: 80_000, now: 1_722_200_200_000,
		});
		expect(rec.spans.some((s) => s.blockId === "r:cu")).toBe(true); // recovery pointer exists

		// Post-compaction history: the block is gone from the live array, recall still serves it.
		e.process([user("fresh start")], { contextWindow: 80_000, tokens: null });
		const { matches, missing } = e.resolveRecall([foldCodeOf("r:cu")], { grep: "UNFOLDED_NEEDLE_Z7" });
		expect(missing).toEqual([]);
		expect(matches[0].text).toContain(needle);
	});
});

import { foldCode as foldCodeOf } from "../src/core/digest";

describe("compact index record + deterministic summary", () => {
	it("emitCompactIndex indexes the whole leaving span and the renderer carries it verbatim", () => {
		const { e, registry, index } = setup();
		const { messages, needle } = needled();
		e.process(messages, { contextWindow: 80_000, tokens: null });

		// Hard compaction fires: everything except the newest exchange is summarized away.
		const leaving = messages.slice(0, -1);
		const blocks = linearize(leaving) as unknown as WireBlock[];
		const rec = emitCompactIndex(blocks, {
			registry,
			index,
			sessionId: "s-compact",
			tokensBefore: 40_000,
			contextWindow: 80_000,
			now: 1_722_200_100_000,
		});
		expect(rec.trigger).toBe("compact");
		expect(rec.identifiers).toContain("CAP_X9_LIMIT");
		expect(rec.spans.length).toBeGreaterThan(0); // spooled blocks carry recovery pointers

		const summary = renderDetCompactionSummary({
			records: index.readAll(),
			spoolDir: dir,
			previousSummary: "Earlier narrative summary.",
		});
		expect(summary).toContain("deterministic seed index — no model involved");
		expect(summary).toContain("CAP_X9_LIMIT");
		expect(summary).toContain("recall_folded search=");
		expect(summary).toContain("dig through the dumps");
		expect(summary).toContain("UNTRUSTED");
		expect(summary).toContain("Earlier narrative summary.");
		// Recovery pointers name real codes.
		expect(summary).toMatch(/\{#[a-z0-9]{1,8} FOLDED\}/);
	});

	it("renders a usable (if sparse) summary even with no records", () => {
		dir = mkdtempSync(join(tmpdir(), "contextfold-compact-"));
		const summary = renderDetCompactionSummary({ records: [], spoolDir: dir });
		expect(summary).toContain("deterministic seed index");
		expect(summary).toContain(dir);
	});
});
