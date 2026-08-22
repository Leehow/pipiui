/*
 * recall-spool.test.ts — exact, bounded recovery from spool-backed ladder folds.
 *
 * Covers byte integrity, grep/line slices, missing-spool errors, and recovery after hard
 * compaction removes a folded block from the live snapshot.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, rmSync as removeFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { SpoolStore } from "../src/adapters/pi/spool";
import { foldCode } from "../src/core/digest";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import type { AgentMessage } from "../src/core/block";
import { assistantText, assistantWithCalls, toolResult, user } from "./helpers";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cf-recall-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function floodWith(buried: string): string {
	const lines: string[] = [];
	for (let i = 0; i < 300; i++) lines.push(`row ${i}: ordinary tabular content spanning the width of the terminal for bulk`);
	lines.push(buried);
	for (let i = 300; i < 600; i++) lines.push(`row ${i}: further ordinary tabular content to keep the payload large`);
	return lines.join("\n");
}

function engineWith(registry: MapSpoolRegistry): ContextFoldEngine {
	return new ContextFoldEngine(new FoldLadderPolicy(), { defaultContextWindow: 400_000, tailTarget: 100 }, registry);
}

function spoolOne(content: string, callId = "c1", fullOutputPath?: string): { registry: MapSpoolRegistry; code: string } {
	const registry = new MapSpoolRegistry();
	const store = new SpoolStore(dir);
	const blockId = `r:${callId}`;
	const code = foldCode(blockId);
	const written = store.write({ blockId, code, tool: "read", input: undefined, isError: false, content });
	registry.set({
		blockId,
		code,
		fullTokens: written.envelope.estTokens + 4,
		tool: "read",
		isError: false,
		bytes: written.envelope.bytes,
		fullEstTokens: written.envelope.estTokens,
		spoolPath: store.pathFor(code),
		fullOutputPath,
	});
	return { registry, code };
}

describe("spool recall — byte integrity within the re-flood cap", () => {
	it("returns a byte-exact prefix and keeps buried detail reachable through grep", () => {
		const content = floodWith("BURIED: the load-bearing value is 7788");
		const { registry, code } = spoolOne(content);
		const engine = engineWith(registry);

		const { matches, missing, errors } = engine.resolveRecall([code]);
		expect(missing).toEqual([]);
		expect(errors).toEqual([]);
		expect(content.startsWith(matches[0].text)).toBe(true);
		expect(matches[0].text.length).toBeLessThan(content.length / 2);
		expect(matches[0].note).toContain("lines=");
		expect(engine.resolveRecall([code], { grep: "load-bearing value" }).matches[0].text).toContain("7788");
	});

	it("returns an under-cap result byte-identically", () => {
		const content = ["short result with a", "BURIED: small value 42", "few lines"].join("\n");
		const { registry, code } = spoolOne(content, "small");
		const text = engineWith(registry).resolveRecall([code]).matches[0].text;
		expect(text).toBe(content);
		expect(sha(text)).toBe(sha(content));
	});

	it("recalls several independent spool entries", () => {
		const registry = new MapSpoolRegistry();
		const store = new SpoolStore(dir);
		const contents: Record<string, string> = {};
		for (let i = 0; i < 3; i++) {
			const blockId = `r:call${i}`;
			const code = foldCode(blockId);
			const content = floodWith(`BURIED marker unique ${i} value ${i * 111}`);
			const written = store.write({ blockId, code, tool: "read", input: undefined, isError: false, content });
			registry.set({ blockId, code, fullTokens: written.envelope.estTokens + 4, tool: "read", isError: false, bytes: written.envelope.bytes, fullEstTokens: written.envelope.estTokens, spoolPath: store.pathFor(code) });
			contents[code] = content;
		}
		const { matches } = engineWith(registry).resolveRecall(Object.keys(contents));
		expect(matches).toHaveLength(3);
		for (const match of matches) expect(contents[match.code].startsWith(match.text)).toBe(true);
	});
});

describe("spool recall — partial retrieval", () => {
	it("grep returns only matching lines with 1-based numbers", () => {
		const content = floodWith("BURIED: the load-bearing value is 7788");
		const { registry, code } = spoolOne(content);
		const match = engineWith(registry).resolveRecall([code], { grep: "load-bearing value" }).matches[0];
		expect(match.text).toMatch(/^301: BURIED/);
		expect(match.text).not.toContain("row 0:");
	});

	it("line-range returns exactly that numbered slice", () => {
		const content = floodWith("BURIED here");
		const { registry, code } = spoolOne(content);
		const out = engineWith(registry).resolveRecall([code], { lines: "2-4" }).matches[0].text.split("\n");
		expect(out).toHaveLength(3);
		expect(out[0]).toBe("2: row 1: ordinary tabular content spanning the width of the terminal for bulk");
		expect(out[2]).toMatch(/^4: row 3:/);
	});

	it("reports an empty grep without dumping the payload", () => {
		const { registry, code } = spoolOne(floodWith("BURIED here"));
		const match = engineWith(registry).resolveRecall([code], { grep: "no such string anywhere zzz" }).matches[0];
		expect(match.text).toBe("");
		expect(match.note).toMatch(/no lines match/);
	});
});

describe("spool recall — failure and compaction surfaces", () => {
	it("a never-folded block's code does not resolve — recall serves folded content only", () => {
		const engine = new ContextFoldEngine(new FoldLadderPolicy(), { defaultContextWindow: 1_000_000, tailTarget: 100 }, new MapSpoolRegistry());
		const messages: AgentMessage[] = [
			user("read it"),
			assistantWithCalls([{ id: "c9", name: "read" }]),
			toolResult("c9", floodWith("NEVER-FOLDED")),
			assistantText("ok"),
			user("tail"),
		];
		engine.process(messages, 1_000_000); // far under threshold: nothing folds
		const code = foldCode("r:c9");
		expect(engine.resolveRecall([code]).missing).toEqual([code]);
		const un = engine.markUnfold([code]);
		expect(un.matches).toEqual([]);
		expect(un.missing).toEqual([code]);
	});

	it("names the path when the spool file is gone and the block left history", () => {
		const { registry, code } = spoolOne(floodWith("BURIED here"));
		const entry = registry.get("r:c1")!;
		removeFile(entry.spoolPath, { force: true });
		const { matches, errors } = engineWith(registry).resolveRecall([code]);
		expect(matches).toEqual([]);
		expect(errors[0].message).toContain(entry.spoolPath);
	});

	it("falls back to the live snapshot, bounded, when the spool read fails on a live block", () => {
		const content = floodWith("BURIED: still live 6363");
		const { registry, code } = spoolOne(content);
		const engine = engineWith(registry);
		const messages: AgentMessage[] = [
			user("read it"),
			assistantWithCalls([{ id: "c1", name: "read" }]),
			toolResult("c1", content),
			assistantText("finished reading", "after-c1"),
			user("tail"),
		];
		engine.process(messages, 20_000); // block is in the snapshot
		removeFile(registry.get("r:c1")!.spoolPath, { force: true });

		const whole = engine.resolveRecall([code]);
		expect(whole.errors).toEqual([]); // DESIGN §7: a live block still resolves
		expect(whole.matches).toHaveLength(1);
		expect(whole.matches[0].note).toContain("live history");
		expect(whole.matches[0].text.length).toBeLessThan(content.length / 2); // still capped

		const sliced = engine.resolveRecall([code], { grep: "still live" });
		expect(sliced.matches[0].text).toContain("6363"); // grep honored on the fallback too
	});

	it("live-history recall honors grep and the whole-recall cap (dropped spool entry after resume)", () => {
		// Resume-degraded shape: frozen layer restored, spool entry dropped by revalidation.
		const registry = new MapSpoolRegistry();
		const engine = engineWith(registry);
		const blockId = "r:c1";
		const code = foldCode(blockId);
		engine.restoreLayers([{ seq: 1, entries: [{ id: blockId, digestText: `{#${code} FOLDED} read → folded` }] }]);
		const content = floodWith("BURIED: dropped-spool needle 9494");
		const messages: AgentMessage[] = [
			user("read it"),
			assistantWithCalls([{ id: "c1", name: "read" }]),
			toolResult("c1", content),
			assistantText("ok"),
			user("tail"),
		];
		engine.process(messages, 20_000);

		const whole = engine.resolveRecall([code]);
		expect(content.startsWith(whole.matches[0].text)).toBe(true); // verbatim prefix…
		expect(whole.matches[0].text.length).toBeLessThan(content.length / 2); // …not a re-flood
		expect(whole.matches[0].note).toContain("lines=");

		const sliced = engine.resolveRecall([code], { grep: "dropped-spool needle" });
		expect(sliced.matches[0].text).toContain("9494");
		expect(sliced.matches[0].text).not.toContain("row 0:"); // grep no longer ignored
	});

	it("searches a folded block after hard compaction removes it from the snapshot", () => {
		const content = floodWith("BURIED: the compacted needle is 4242");
		const { registry, code } = spoolOne(content);
		const result = engineWith(registry).searchFolded("compacted needle");
		expect(result.scanned).toBe(1);
		expect(result.hits[0].code).toBe(code);
		expect(result.hits[0].lines[0]).toContain("4242");
		expect(result.hits[0].label).toContain("compacted");
	});

	it("does not double-scan a folded block still present in the snapshot", () => {
		const content = floodWith("BURIED: the live needle is 5151");
		const { registry } = spoolOne(content);
		const engine = engineWith(registry);
		const messages: AgentMessage[] = [
			user("read it"),
			assistantWithCalls([{ id: "c1", name: "read" }]),
			toolResult("c1", content),
			assistantText("finished reading", "after-c1"),
			user("tail"),
		];
		engine.process(messages, 20_000);
		const result = engine.searchFolded("live needle");
		expect(result.scanned).toBe(1);
		expect(result.hits).toHaveLength(1);
	});
});
