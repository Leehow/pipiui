/*
 * advisor.test.ts — cold detection + the price-agnostic reset yellow flag (input-token math,
 * no dollar prices anywhere).
 */
import { describe, expect, it } from "vitest";
import { advise, type AdvisorInput } from "../src/adapters/pi/advisor";
import { CacheTelemetry } from "../src/adapters/pi/cache-telemetry";

const base: AdvisorInput = {
	turns: 10,
	everWarm: true,
	lastCacheRead: 90_000,
	lastInput: 2_000,
	lastTurnAfterFold: false,
	carriedTokens: 92_000,
	contextWindow: 200_000,
	irreducibleFloor: 25_000,
	reconTokens: 18_000,
	recallCalls: 2,
	maxRecallsPerCode: 1,
	compactions: 0,
	wireDeferredFolds: 0,
};

describe("cold detection", () => {
	it("a warm session with healthy reads is not cold and raises no flags", () => {
		const a = advise(base);
		expect(a.coldNow).toBe(false);
		expect(a.flags).toEqual([]);
	});

	it("an expected-warm turn that read zero cached tokens is cold", () => {
		const a = advise({ ...base, lastCacheRead: 0, lastInput: 92_000 });
		expect(a.coldNow).toBe(true);
		expect(a.flags.some((f) => f.includes("economically free"))).toBe(true);
	});

	it("does not call the expected one-response cache miss after a fold a cold session", () => {
		const a = advise({ ...base, lastCacheRead: 0, lastInput: 92_000, lastTurnAfterFold: true });
		expect(a.coldNow).toBe(false);
		expect(a.flags.some((f) => f.includes("session is cold"))).toBe(false);
	});

	it("a session that has never been warm (broken/absent provider cache) counts as cold", () => {
		const a = advise({ ...base, everWarm: false, lastCacheRead: 0, lastInput: 5_000, carriedTokens: 8_000 });
		expect(a.coldNow).toBe(true);
		// …but with a small carry there is nothing worth flagging.
		expect(a.flags).toEqual([]);
	});

	it("turn 1 is never cold (every session starts with a prefill)", () => {
		expect(advise({ ...base, turns: 1, lastCacheRead: 0, lastInput: 50_000 }).coldNow).toBe(false);
	});
});

describe("reset payback (input-token equivalents)", () => {
	it("resetting 200k → 18k pays back in under two warm turns at any price level", () => {
		const a = advise({ ...base, carriedTokens: 200_000 });
		expect(a.paybackTurns).not.toBeNull();
		expect(a.paybackTurns!).toBeLessThan(2);
	});

	it("small carried context has no payback story", () => {
		expect(advise({ ...base, carriedTokens: 20_000 }).paybackTurns).toBeNull();
	});
});

describe("yellow flags", () => {
	it("second forced compaction → strong fresh-session recommendation, first flag", () => {
		const a = advise({ ...base, compactions: 2 });
		expect(a.flags[0]).toContain("second forced compaction");
	});

	it("irreducible context past half the window → folding can't help further", () => {
		const a = advise({ ...base, irreducibleFloor: 120_000 });
		expect(a.flags.some((f) => f.includes("irreducible"))).toBe(true);
	});

	it("recall churn by volume or by repeated code", () => {
		expect(advise({ ...base, recallCalls: 12 }).flags.some((f) => f.includes("churn"))).toBe(true);
		expect(advise({ ...base, maxRecallsPerCode: 4 }).flags.some((f) => f.includes("churn"))).toBe(true);
	});

	it("folds not observed on the wire → first flag, ahead of everything else", () => {
		const a = advise({ ...base, wireDeferredFolds: 2, compactions: 2 });
		expect(a.flags[0]).toContain("not observed on the wire");
	});
});

describe("telemetry everWarm", () => {
	it("flips only on a real non-zero cache read", () => {
		const t = new CacheTelemetry();
		t.record({ input: 1000, output: 10, cacheRead: 0, cacheWrite: 1000, totalTokens: 2010 });
		expect(t.snapshot().everWarm).toBe(false);
		t.record({ input: 50, output: 10, cacheRead: 2000, cacheWrite: 0, totalTokens: 2060 });
		expect(t.snapshot().everWarm).toBe(true);
	});
});
