/*
 * span-recall.test.ts — the churn guard: recovering identifiers scattered
 * across N folded pointers must cost fewer calls than N. One `search` sweep covers every folded
 * block with line numbers that agree with the per-code `lines=` slice path.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import type { AgentMessage } from "../src/core/block";
import { user, assistantText, assistantWithCalls, toolResult } from "./helpers";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** N big results, each hiding one planted needle line mid-output. */
function needledSession(n: number): { messages: AgentMessage[]; needles: string[] } {
	const messages: AgentMessage[] = [user("collect the shard capacities")];
	const needles: string[] = [];
	for (let i = 0; i < n; i++) {
		const needle = `SHARD_CAP_${i}=${40_000 + i * 7}`;
		needles.push(needle);
		const lines = Array.from({ length: 400 }, (_, j) => `row ${j}: ${"z".repeat(40)}`);
		lines[200 + i] = `    ${needle} (planted)`;
		messages.push(assistantWithCalls([{ id: `c${i}`, name: "read" }]));
		messages.push(toolResult(`c${i}`, lines.join("\n"), "read"));
	}
	messages.push(assistantText("finished collecting", "after-shards"));
	messages.push(user("now the newest question"));
	return { messages, needles };
}

describe("span recall (churn guard)", () => {
	it("one search call recovers needles from all N ladder-frozen pointers (1 call < N)", () => {
		dir = mkdtempSync(join(tmpdir(), "contextfold-span-"));
		const e = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, new MapSpoolRegistry());
		const { messages, needles } = needledSession(5);
		e.process(messages, { contextWindow: 40_000, tokens: null }); // ~25k live → ~0.63 ≥ 0.45 → fold event

		const sweep = e.searchFolded("SHARD_CAP_");
		expect(sweep.hits.length).toBe(5); // every pointer answered in ONE call
		const returned = sweep.hits.flatMap((h) => h.lines).join("\n");
		for (const needle of needles) expect(returned).toContain(needle);
	});

	it("search line numbers agree with the per-code lines= slice", () => {
		dir = mkdtempSync(join(tmpdir(), "contextfold-span-"));
		const e = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, new MapSpoolRegistry());
		const { messages } = needledSession(5);
		e.process(messages, { contextWindow: 40_000, tokens: null });
		const sweep = e.searchFolded("SHARD_CAP_0");
		expect(sweep.hits.length).toBe(1);
		const [lineNo] = sweep.hits[0].lines[0].split(":");
		const { matches } = e.resolveRecall([sweep.hits[0].code], { lines: `${lineNo}-${lineNo}` });
		expect(matches[0].text).toContain("SHARD_CAP_0");
	});

	it("caps the sweep and says how to narrow", () => {
		dir = mkdtempSync(join(tmpdir(), "contextfold-span-"));
		const e = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, new MapSpoolRegistry());
		// Every line matches → the sweep must clip, not flood.
		const messages: AgentMessage[] = [user("flood")];
		for (let i = 0; i < 6; i++) {
			messages.push(assistantWithCalls([{ id: `f${i}`, name: "read" }]));
		messages.push(toolResult(`f${i}`, Array.from({ length: 500 }, (_, j) => `match line ${j}`).join("\n"), "read"));
		}
		messages.push(user("tail"));
		e.process(messages, { contextWindow: 18_000, tokens: null });
		const sweep = e.searchFolded("match line");
		const totalLines = sweep.hits.reduce((n, h) => n + h.lines.length, 0);
		expect(totalLines).toBeLessThan(500 * 6);
		expect(sweep.note).toContain("narrow");
	});

	it("counts recall churn for the yellow flag", () => {
		dir = mkdtempSync(join(tmpdir(), "contextfold-span-"));
		const e = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, new MapSpoolRegistry());
		const { messages } = needledSession(5);
		e.process(messages, { contextWindow: 40_000, tokens: null });
		const sweep = e.searchFolded("SHARD_CAP_0");
		e.resolveRecall([sweep.hits[0].code]);
		e.resolveRecall([sweep.hits[0].code]);
		e.resolveRecall([sweep.hits[0].code]);
		expect(e.recallStats.calls).toBeGreaterThanOrEqual(4);
		expect(e.recallStats.maxPerCode).toBe(3);
	});
});
