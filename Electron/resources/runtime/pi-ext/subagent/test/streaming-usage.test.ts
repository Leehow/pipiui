import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	addEstimateChars,
	combineCompletedAndStreamingUsage,
	estimateOutputTokens,
	liveUsageOrEstimate,
	readMessageUsage,
	shouldEmitStreamingUsage,
	STREAMING_USAGE_MIN_INTERVAL_MS,
	usageHasTokens,
	createUsageEmitter,
	type UsageEmitterSession,
	type UsageReportPayload,
} from "../streaming-usage.ts";

test("readMessageUsage accepts pi streaming usage and ignores an all-zero report", () => {
	assert.equal(readMessageUsage(undefined), undefined);
	assert.equal(readMessageUsage("nope"), undefined);
	const zero = readMessageUsage({
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { total: 0 },
	});
	assert.deepEqual(zero, {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
	});
	assert.equal(usageHasTokens(zero!), false);

	const live = readMessageUsage({
		input: 100,
		output: 7,
		cacheRead: 20,
		cacheWrite: 1,
		totalTokens: 128,
		cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
	});
	assert.deepEqual(live, {
		input: 100,
		output: 7,
		cacheRead: 20,
		cacheWrite: 1,
		cost: 0.3,
		contextTokens: 128,
	});
	assert.equal(usageHasTokens(live!), true);
});

test("combineCompletedAndStreamingUsage is completed + current message, not a replace of history", () => {
	assert.deepEqual(
		combineCompletedAndStreamingUsage(
			{ input: 1_000, output: 40, cacheRead: 10, cacheWrite: 2, cost: 0.25, contextTokens: 1_050 },
			{ input: 200, output: 9, cacheRead: 0, cacheWrite: 0, cost: 0.5, contextTokens: 1_260 },
		),
		{ input: 1_200, output: 49, cacheRead: 10, cacheWrite: 2, cost: 0.75, contextTokens: 1_260 },
	);
});

test("shouldEmitStreamingUsage throttles to ~500ms and only when tokens change", () => {
	const first = {
		input: 10,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 11,
	};
	const opened = shouldEmitStreamingUsage({
		previousKey: "",
		lastEmitAt: 0,
		next: first,
		now: 1_000,
	});
	assert.equal(opened.emit, true);

	assert.equal(shouldEmitStreamingUsage({
		previousKey: opened.key,
		lastEmitAt: opened.at,
		next: { ...first, output: 8 },
		now: 1_000 + STREAMING_USAGE_MIN_INTERVAL_MS - 1,
	}).emit, false);

	assert.equal(shouldEmitStreamingUsage({
		previousKey: opened.key,
		lastEmitAt: opened.at,
		next: { ...first, output: 8 },
		now: 1_000 + STREAMING_USAGE_MIN_INTERVAL_MS,
	}).emit, true);

	assert.equal(shouldEmitStreamingUsage({
		previousKey: opened.key,
		lastEmitAt: opened.at,
		next: first,
		now: 1_000 + STREAMING_USAGE_MIN_INTERVAL_MS,
	}).emit, false);

	assert.equal(shouldEmitStreamingUsage({
		previousKey: opened.key,
		lastEmitAt: opened.at,
		next: first,
		now: 1_000,
		force: true,
	}).emit, true);

	assert.equal(shouldEmitStreamingUsage({
		previousKey: "",
		lastEmitAt: 0,
		next: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
		now: 1_000,
	}).emit, false);
});

test("estimateOutputTokens accumulates delta chars: ASCII ~4/char, CJK ~1.5/char", () => {
	let counts = addEstimateChars({ ascii: 0, cjk: 0 }, "");
	assert.deepEqual(counts, { ascii: 0, cjk: 0 });
	assert.equal(estimateOutputTokens(counts), 0);

	// "hello world" = 11 ASCII (space included), accumulated across deltas.
	counts = addEstimateChars(counts, "hello ");
	counts = addEstimateChars(counts, "world");
	assert.deepEqual(counts, { ascii: 11, cjk: 0 });
	assert.equal(estimateOutputTokens(counts), 2);

	// 6 CJK chars + the ASCII so far → 11/4 + 6/1.5 = 2.75 + 4 = 6.75 → 6.
	counts = addEstimateChars(counts, "你好世界代码");
	assert.deepEqual(counts, { ascii: 11, cjk: 6 });
	assert.equal(estimateOutputTokens(counts), 6);
});

test("liveUsageOrEstimate prefers real mid-stream usage and estimates only for silent providers", () => {
	assert.equal(liveUsageOrEstimate(undefined, 0), undefined);
	assert.equal(liveUsageOrEstimate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 0), undefined);

	const estimated = liveUsageOrEstimate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 137);
	assert.deepEqual(estimated, {
		input: 0,
		output: 137,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
	});

	// A provider that does report mid-stream (anthropic-style) always wins over the estimate.
	const real = liveUsageOrEstimate({ input: 100, output: 7, cacheRead: 20, cacheWrite: 1 }, 999);
	assert.equal(real?.output, 7);
	assert.equal(real?.input, 100);

	// Estimate combines with completed totals like any other live snapshot.
	assert.deepEqual(
		combineCompletedAndStreamingUsage({ input: 1_000, output: 40 }, {
			input: 0,
			output: 137,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
		}),
		{ input: 1_000, output: 177, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
	);
});

test("index.ts drives usage through the extracted emitter, not its own inline sequence", () => {
	// Kept deliberately: a wiring check is cheap and stays true across refactors. What used to
	// live here — regexes pinning the exact call expressions — is now the behavior suite below.
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /from "\.\/streaming-usage\.ts"/);
	assert.match(source, /createUsageEmitter\(/);
	assert.match(source, /event\.type === "message_update"/);
	assert.match(source, /event\.type === "message_end" && event\.message/);
});

function harness(overrides: Partial<UsageEmitterSession> = {}) {
	const reports: UsageReportPayload[] = [];
	let clock = 100_000;
	const session: UsageEmitterSession = {
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: "test-model",
		...overrides,
	};
	const emitter = createUsageEmitter({
		report: (payload) => reports.push(payload),
		session: () => session,
		now: () => clock,
	});
	return { emitter, reports, session, advance: (ms: number) => { clock += ms; } };
}

test("real provider usage mid-stream wins and is added to the completed turns", () => {
	const h = harness();
	h.session.usage = { ...h.session.usage, input: 1_000, output: 40, turns: 2 };

	h.emitter.emitLive({ input: 7, output: 11 });

	assert.equal(h.reports.length, 1);
	assert.equal(h.reports[0].usage.input, 1_007);
	assert.equal(h.reports[0].usage.output, 51);
	assert.equal(h.reports[0].turn, 2);
	assert.equal(h.reports[0].model, "test-model");
});

test("a provider that reports nothing mid-stream falls back to the delta estimate", () => {
	const h = harness();
	// Silent provider: no usage on the event, so only counted deltas can move the number.
	h.emitter.emitLive(undefined);
	assert.equal(h.reports.length, 0, "nothing counted yet means nothing worth reporting");

	h.emitter.countDelta("x".repeat(40));
	h.emitter.emitLive(undefined);

	assert.equal(h.reports.length, 1);
	assert.equal(h.reports[0].usage.output, 10, "40 ascii chars ≈ 10 tokens");
	assert.equal(h.reports[0].usage.input, 0);
});

test("repeat and rapid emits are throttled, and a changed total reports once the window passes", () => {
	const h = harness();
	h.emitter.emitLive({ input: 5, output: 5 });
	assert.equal(h.reports.length, 1);

	h.emitter.emitLive({ input: 5, output: 5 });
	assert.equal(h.reports.length, 1, "an unchanged total is not re-reported");

	h.emitter.emitLive({ input: 6, output: 5 });
	assert.equal(h.reports.length, 1, "a change inside the throttle window waits");

	h.advance(STREAMING_USAGE_MIN_INTERVAL_MS);
	h.emitter.emitLive({ input: 6, output: 5 });
	assert.equal(h.reports.length, 2, "and lands once the window passes");
});

test("message_end reports the authoritative total even when throttling would have suppressed it", () => {
	const h = harness();
	h.emitter.emitLive({ input: 5, output: 5 });
	assert.equal(h.reports.length, 1);

	// Same tick, and a total the throttle would normally hold back.
	h.emitter.emitAuthoritative(
		{ input: 9, output: 9, cacheRead: 0, cacheWrite: 0, cost: 0.5, contextTokens: 900 },
		{ turn: 3, model: "final-model", tools: ["read", "write"] },
	);

	assert.equal(h.reports.length, 2);
	const last = h.reports[1];
	assert.equal(last.usage.input, 9);
	assert.equal(last.usage.contextTokens, 900);
	assert.equal(last.turn, 3);
	assert.equal(last.model, "final-model");
	assert.deepEqual(last.tools, ["read", "write"]);
});

test("resetting the estimate stops a closed message's chars leaking into the next one", () => {
	const h = harness();
	h.emitter.countDelta("x".repeat(80));
	assert.equal(h.emitter.estimateChars().ascii, 80);

	h.emitter.resetEstimate();
	assert.deepEqual(h.emitter.estimateChars(), { ascii: 0, cjk: 0 });

	// A silent provider now has nothing to estimate from, rather than re-reporting the old total.
	h.emitter.emitLive(undefined);
	assert.equal(h.reports.length, 0);
});

test("the emitter reads the session live, so totals that advance mid-run are not stale", () => {
	const h = harness();
	h.emitter.emitLive({ input: 1, output: 1 });
	assert.equal(h.reports[0].usage.input, 1);

	// A turn closes underneath the emitter; the next live emit must see the new base.
	h.session.usage = { ...h.session.usage, input: 500, turns: 1 };
	h.advance(STREAMING_USAGE_MIN_INTERVAL_MS);
	h.emitter.emitLive({ input: 2, output: 1 });

	assert.equal(h.reports[1].usage.input, 502);
	assert.equal(h.reports[1].turn, 1);
});

test("a known context window rides along on every report", () => {
	const h = harness();
	h.session.usage = { ...h.session.usage, contextWindow: 200_000 };
	h.emitter.emitLive({ input: 3, output: 3 });
	assert.equal(h.reports[0].usage.contextWindow, 200_000);

	const without = harness();
	without.emitter.emitLive({ input: 3, output: 3 });
	assert.equal(without.reports[0].usage.contextWindow, undefined);
});
