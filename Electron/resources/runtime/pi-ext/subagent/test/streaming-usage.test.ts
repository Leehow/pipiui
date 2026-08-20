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

test("child JSON handler listens for message_update.usage and keeps message_end authoritative", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /from "\.\/streaming-usage\.ts"/);
	assert.match(source, /event\.type === "message_update"/);
	assert.match(source, /emitStreamingUsage\(event\.usage \?\? event\.message\?\.usage\)/);
	assert.match(source, /liveUsageOrEstimate\(raw, estimateOutputTokens\(liveEstimateChars\)\)/);
	assert.match(source, /combineCompletedAndStreamingUsage/);
	assert.match(source, /shouldEmitStreamingUsage/);
	assert.match(source, /countLiveEstimate\(String\(ame\.delta \?\? ""\)\)/);
	assert.match(
		source,
		/if \(event\.type === "message_end" && event\.message\)[\s\S]*emitUsageSnapshot\(\{[\s\S]*currentResult\.usage\.input[\s\S]*force: true/,
	);
	// The per-message estimate accumulator resets on the authoritative close-out.
	assert.match(
		source,
		// Tolerant of other per-resume clears landing in this block (fileChangeBuffers, …):
		// what matters is that a resume resets stream state AND the live estimate together.
		/streamParts\.clear\(\);\s*streamDirty\.clear\(\);[\s\S]{0,200}?liveEstimateChars = \{ ascii: 0, cjk: 0 \};/,
	);
});
