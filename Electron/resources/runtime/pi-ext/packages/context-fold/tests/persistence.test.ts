/*
 * persistence.test.ts — event-sourced fold state across restarts.
 *
 * A fresh engine rebuilds spool locations, frozen layers, and unfolds from custom session entries.
 * Legacy `kind:"gate"` records remain readable so handles from pre-removal sessions still resolve.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FOLD_CUSTOM_TYPE,
	recordLayer,
	recordSpoolEntry,
	recordUnfold,
	restoreFoldState,
	revalidateSpools,
	type EntryAppender,
} from "../src/adapters/pi/persistence";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { SpoolStore } from "../src/adapters/pi/spool";
import { linearize, type AgentMessage } from "../src/core/block";
import { digest, foldCode } from "../src/core/digest";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry, type SpoolEntry } from "../src/core/spool-registry";
import { assistantWithCalls, toolResult, user } from "./helpers";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cf-persist-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

class FakeLedger implements EntryAppender {
	entries: { type: string; customType: string; data: unknown }[] = [];
	appendEntry(customType: string, data?: unknown): void {
		this.entries.push({ type: "custom", customType, data });
	}
}

function flood(tag: string): string {
	return Array.from({ length: 300 }, (_, i) => `row ${i}: ${tag} bulky tabular content spanning the terminal width for size`).join("\n");
}

function twoReadSession(a: string, b: string): AgentMessage[] {
	return [
		user("read both files"),
		assistantWithCalls([{ id: "c1", name: "read" }], { text: "reading a" }),
		toolResult("c1", a),
		user("and the second"),
		assistantWithCalls([{ id: "c2", name: "read" }], { text: "reading b" }),
		toolResult("c2", b),
	];
}

function spoolEntry(store: SpoolStore, callId: string, content: string): SpoolEntry {
	const blockId = `r:${callId}`;
	const code = foldCode(blockId);
	const written = store.write({ blockId, code, tool: "read", input: undefined, isError: false, content });
	return {
		blockId,
		code,
		fullTokens: written.envelope.estTokens + 4,
		tool: "read",
		isError: false,
		bytes: written.envelope.bytes,
		fullEstTokens: written.envelope.estTokens,
		spoolPath: store.pathFor(code),
	};
}

describe("fold ledger round-trip", () => {
	it("restores current spool records, unfolds, and legacy gate records", () => {
		const ledger = new FakeLedger();
		const first = { blockId: "r:c1", code: "aaa", fullTokens: 100, tool: "read", isError: false, bytes: 1, fullEstTokens: 90, spoolPath: "/x/aaa.json" };
		const second = { blockId: "r:c2", code: "bbb", fullTokens: 200, tool: "read", isError: false, bytes: 2, fullEstTokens: 180, spoolPath: "/x/bbb.json" };
		recordSpoolEntry(ledger, first);
		ledger.appendEntry(FOLD_CUSTOM_TYPE, { kind: "gate", entry: second });
		recordUnfold(ledger, ["r:c1"]);

		const { spoolEntries, unfoldedIds } = restoreFoldState(ledger.entries);
		expect(spoolEntries.map((entry) => entry.blockId).sort()).toEqual(["r:c1", "r:c2"]);
		expect([...unfoldedIds]).toEqual(["r:c1"]);
	});

	it("ignores unrelated custom entries", () => {
		const entries = [{ type: "custom", customType: "someone.else", data: { kind: "spool" } }];
		expect(restoreFoldState(entries).spoolEntries).toEqual([]);
	});
});

describe("resume restores folds and recall", () => {
	it("rebuilds frozen layers while every persisted handle still resolves", () => {
		const a = flood("ALPHA");
		const b = flood("BETA");
		const messages = twoReadSession(a, b);
		const blocks = linearize(messages);
		const ledger = new FakeLedger();
		const store = new SpoolStore(dir);
		for (const [callId, content] of [["c1", a], ["c2", b]] as const) recordSpoolEntry(ledger, spoolEntry(store, callId, content));
		recordLayer(ledger, {
			seq: 1,
			entries: blocks
				.filter((block) => block.id === "r:c1" || block.id === "r:c2")
				.map((block) => ({ id: block.id, digestText: digest(block) })),
		});
		recordUnfold(ledger, ["r:c1"]);

		const restored = restoreFoldState(ledger.entries);
		const { valid, dropped } = revalidateSpools(restored.spoolEntries);
		expect(dropped).toEqual([]);
		const registry = new MapSpoolRegistry();
		for (const entry of valid) registry.set(entry);
		const engine = new ContextFoldEngine(new FoldLadderPolicy(), { defaultContextWindow: 400_000 }, registry);
		engine.restoreLayers(restored.layers);
		engine.restoreUnfolded(restored.unfoldedIds);

		const results = engine.process(messages, 400_000).filter((message) => message.role === "toolResult");
		const first = (results[0].content as { text: string }[])[0].text;
		const second = (results[1].content as { text: string }[])[0].text;
		expect(first).toContain("row 200:");
		expect(first).not.toContain("FOLDED");
		expect(second).toContain(`{#${foldCode("r:c2")} FOLDED}`);
		expect(b.startsWith(engine.resolveRecall([foldCode("r:c2")]).matches[0].text)).toBe(true);
	});

	it("drops a restored entry whose spool vanished", () => {
		const ledger = new FakeLedger();
		const entry = spoolEntry(new SpoolStore(dir), "c1", flood("GAMMA"));
		recordSpoolEntry(ledger, entry);
		rmSync(dir, { recursive: true, force: true });

		const { valid, dropped } = revalidateSpools(restoreFoldState(ledger.entries).spoolEntries);
		expect(valid).toEqual([]);
		expect(dropped[0].code).toBe(foldCode("r:c1"));
	});
});
