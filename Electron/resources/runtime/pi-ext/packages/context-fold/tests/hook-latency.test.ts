/*
 * hook-latency.test.ts — what does a context-fold turn actually COST the user?
 *
 * The whole automatic path is synchronous and model-free: linearize → conduct → lower → applyPlan.
 * That pure-CPU work is the only thing added to a turn's latency, so it is the only thing to
 * measure. Benchmarked here on a large, deeply over-budget context.
 *
 * Run: CONTEXTFOLD_BENCH=1 npx vitest run tests/hook-latency.test.ts
 */
import { describe, it, expect } from "vitest";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import type { AgentMessage } from "../src/core/block";
import { user, assistantWithCalls, bigResult, liveTokensOf } from "./helpers";

/** A long tool-heavy session: `n` exchanges, each a user ask + a call + a substantial result. */
function benchSession(n: number): AgentMessage[] {
	const out: AgentMessage[] = [user("start the project")];
	for (let i = 0; i < n; i++) {
		out.push(user(`step ${i}: read a file`));
		out.push(assistantWithCalls([{ id: `c${i}`, name: "read" }], { text: `reading file ${i}`, thinking: `plan for file ${i}` }));
		out.push(bigResult(`c${i}`, 120));
	}
	return out;
}

const BENCH = process.env.CONTEXTFOLD_BENCH === "1";

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

describe.skipIf(!BENCH)("hook latency", () => {
	it("synchronous fold cost per turn on a large context", () => {
		const messages = benchSession(120); // big, deeply over budget
		const cw = 200_000;
		const tokens = liveTokensOf(messages);
		const engine = new ContextFoldEngine(new FoldLadderPolicy(), { defaultContextWindow: cw });

		// Warm caches, then time the synchronous per-turn work.
		engine.process(messages, cw);
		const times: number[] = [];
		for (let i = 0; i < 7; i++) {
			const t = performance.now();
			engine.process(messages, cw);
			times.push(performance.now() - t);
		}
		// eslint-disable-next-line no-console
		console.log(`\n  context: ${tokens} tokens, ${messages.length} messages`);
		// eslint-disable-next-line no-console
		console.log(
			`  synchronous fold per turn: median ${median(times).toFixed(1)}ms  (min ${Math.min(...times).toFixed(1)}, max ${Math.max(...times).toFixed(1)})\n`,
		);
		expect(median(times)).toBeLessThan(500); // a fold turn adds well under half a second of CPU
	});
});
