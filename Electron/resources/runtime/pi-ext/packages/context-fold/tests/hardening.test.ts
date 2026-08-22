/*
 * hardening.test.ts — adapter-level regressions: error-lexicon coverage, spool collision safety,
 * and the lines= re-flood cap.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpoolStore, SpoolError } from "../src/adapters/pi/spool";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { SeedIndexStore, emitFoldIndex } from "../src/adapters/pi/index-store";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { foldCode } from "../src/core/digest";
import { categorize } from "../src/core/policy/ledger";
import type { AgentMessage } from "../src/core/block";
import { user, assistantText, assistantWithCalls, toolResult } from "./helpers";
let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cf-hardening-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("error lexicon covers real failure spellings", () => {
	const spellings = [
		"3 failed | 12 passed (15)",
		"fatal: not a git repository",
		"npm ERR! code ELIFECYCLE",
		"Segmentation fault (core dumped)",
		"Permission denied (publickey)",
		"✗ should compute the sum",
		"Aborted (signal 6)",
	];
	for (const line of spellings) {
		it(`detects: "${line}"`, () => {
			expect(categorize(line).errors.length).toBeGreaterThan(0);
		});
	}

});

describe("spool collision guard", () => {
	it("refuses to overwrite another block's envelope under the same code", () => {
		const store = new SpoolStore(dir);
		store.write({ blockId: "r:AAA", code: "col111", tool: "read", input: {}, isError: false, content: "first payload" });
		expect(() =>
			store.write({ blockId: "r:BBB", code: "col111", tool: "read", input: {}, isError: false, content: "second payload" }),
		).toThrow(SpoolError);
		expect(store.read("col111").content).toBe("first payload"); // original intact
	});

	it("same block re-spooled with new content overwrites cleanly and drops the stale dedup key", () => {
		const store = new SpoolStore(dir);
		store.write({ blockId: "r:AAA", code: "col222", tool: "read", input: {}, isError: false, content: "v1 content" });
		store.write({ blockId: "r:AAA", code: "col222", tool: "read", input: {}, isError: false, content: "v2 content" });
		expect(store.read("col222").content).toBe("v2 content");
		// A later identical-to-v1 payload must NOT alias to the rewritten file.
		const r = store.write({ blockId: "r:CCC", code: "col333", tool: "read", input: {}, isError: false, content: "v1 content" });
		expect(r.dedupOf).toBeUndefined();
		expect(store.read("col333").content).toBe("v1 content");
	});

	it("a collision drops only the colliding block — folding continues for everything else", () => {
		// Two REAL colliding durable ids (birthday search over the 36^6 code space, <100ms).
		const seen = new Map<string, string>();
		let a = "", b = "";
		for (let i = 0; ; i++) {
			const id = `r:call_${i.toString(36)}`;
			const c = foldCode(id);
			const prev = seen.get(c);
			if (prev !== undefined) { a = prev; b = id; break; }
			seen.set(c, id);
		}

		const registry = new MapSpoolRegistry();
		const spool = new SpoolStore(join(dir, "spool"));
		const index = new SeedIndexStore(join(dir, "spool"));
		const engine = new ContextFoldEngine(new FoldLadderPolicy(), { defaultContextWindow: 20_000, tailTarget: 100 }, registry);
		// Wired exactly as adapters/pi/index.ts wires it: droppedIds flow back to the engine.
		engine.onFoldEvent = (ev) => {
			const { droppedIds } = emitFoldIndex(ev, { spool, registry, index, sessionId: "t", persistEntry: () => {} });
			return droppedIds.length ? droppedIds : true;
		};
		engine.onLayerCommit = () => true;

		const big = (marker: string) =>
			Array.from({ length: 600 }, (_, i) => `row ${i}: bulk content for pressure ${"x".repeat(30)}`).join("\n") + `\n${marker}`;

		// Turn 1: block A folds and spools normally under the shared code.
		const turn1: AgentMessage[] = [
			user("first"),
			assistantWithCalls([{ id: a.slice(2), name: "read" }]),
			toolResult(a.slice(2), big("A-marker")),
			assistantText("done A"),
			user("next"),
		];
		expect(JSON.stringify(engine.process(turn1, 20_000))).toContain("FOLDED");

		// Turn 2: colliding block B arrives alongside an innocent block C. B is dropped (raw),
		// C folds — the event survives.
		const turn2: AgentMessage[] = [
			...turn1,
			assistantWithCalls([{ id: b.slice(2), name: "read" }, { id: "c_innocent", name: "read" }]),
			toolResult(b.slice(2), big("B-marker")),
			toolResult("c_innocent", big("C-marker")),
			assistantText("done B C"),
			user("go on"),
		];
		const out2 = JSON.stringify(engine.process(turn2, 20_000));
		expect(out2).toContain("B-marker"); // collider stays raw
		expect(out2).not.toContain("C-marker"); // innocent block folded

		// Turn 3: folding still works for new blocks; the collider stays held, not retried forever.
		const turn3: AgentMessage[] = [
			...turn2,
			assistantWithCalls([{ id: "d_later", name: "read" }]),
			toolResult("d_later", big("D-marker")),
			assistantText("done D"),
			user("more"),
		];
		const out3 = JSON.stringify(engine.process(turn3, 20_000));
		expect(out3).not.toContain("D-marker"); // later folds proceed
		expect(out3).toContain("B-marker"); // collider still raw, still delivered
	});
});

describe("recall lines= is capped (no re-flood path)", () => {
	it("an unbounded range comes back token-capped with a paging note", () => {
		const flood = Array.from({ length: 800 }, (_, i) => `row ${i}: bulky line for the lines-cap scenario ${"y".repeat(40)}`).join("\n");
		const reg = new MapSpoolRegistry();
		const store = new SpoolStore(dir);
		const code = foldCode("r:cL");
		const written = store.write({ blockId: "r:cL", code, tool: "read", input: undefined, isError: false, content: flood });
		reg.set({ blockId: "r:cL", code, fullTokens: 10_000, tool: "read", isError: false, bytes: written.envelope.bytes, fullEstTokens: written.envelope.estTokens, spoolPath: store.pathFor(code) });
		const engine = new ContextFoldEngine(new FoldLadderPolicy(), { defaultContextWindow: 400_000 }, reg);

		const { matches } = engine.resolveRecall([code], { lines: "1-999999" });
		expect(matches).toHaveLength(1);
		expect(matches[0].text.length).toBeLessThan(flood.length / 3); // capped, not the whole flood
		expect(matches[0].note).toContain("narrow");

		const malformed = engine.resolveRecall([code], { lines: "banana" });
		expect(malformed.matches[0].text).toBe(""); // malformed spec no longer dumps everything
		expect(malformed.matches[0].note).toContain("malformed");
	});
});
