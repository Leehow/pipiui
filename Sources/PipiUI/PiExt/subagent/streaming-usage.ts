/**
 * Live subagent token totals from pi 0.84+ `message_update.usage`.
 *
 * JSON/RPC streaming carries the current assistant message's cumulative usage
 * (non-zero when the provider reports it mid-stream). OpenAI-completions
 * streams report usage only in the final chunk, so providers that stay silent
 * mid-stream fall back to a local estimate from the live delta chars. Session
 * totals for the panel are "completed messages + this live message".
 * `message_end` remains the authoritative close-out.
 */

export const STREAMING_USAGE_MIN_INTERVAL_MS = 500;

export type StreamingUsageSnapshot = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
};

const emptySnapshot = (): StreamingUsageSnapshot => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
});

function finiteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readCost(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return finiteNumber((value as { total?: unknown }).total);
	}
	return 0;
}

export function readMessageUsage(raw: unknown): StreamingUsageSnapshot | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const usage = raw as Record<string, unknown>;
	return {
		input: finiteNumber(usage.input),
		output: finiteNumber(usage.output),
		cacheRead: finiteNumber(usage.cacheRead),
		cacheWrite: finiteNumber(usage.cacheWrite),
		cost: readCost(usage.cost),
		contextTokens: finiteNumber(usage.contextTokens) || finiteNumber(usage.totalTokens),
	};
}

export function usageHasTokens(usage: StreamingUsageSnapshot): boolean {
	return usage.input > 0
		|| usage.output > 0
		|| usage.cacheRead > 0
		|| usage.cacheWrite > 0
		|| usage.contextTokens > 0;
}

export function combineCompletedAndStreamingUsage(
	completed: Partial<StreamingUsageSnapshot> | undefined,
	live: StreamingUsageSnapshot,
): StreamingUsageSnapshot {
	const base = { ...emptySnapshot(), ...completed };
	return {
		input: finiteNumber(base.input) + live.input,
		output: finiteNumber(base.output) + live.output,
		cacheRead: finiteNumber(base.cacheRead) + live.cacheRead,
		cacheWrite: finiteNumber(base.cacheWrite) + live.cacheWrite,
		cost: finiteNumber(base.cost) + live.cost,
		contextTokens: live.contextTokens || finiteNumber(base.contextTokens),
	};
}

export function usageFingerprint(usage: StreamingUsageSnapshot): string {
	return [
		usage.input,
		usage.output,
		usage.cacheRead,
		usage.cacheWrite,
		usage.contextTokens,
	].join("|");
}

/**
 * Local output-token estimate for providers whose stream reports usage only in
 * the final chunk (OpenAI-compatible chat-completions). Fed by the same
 * assistantMessageEvent deltas that drive the live log preview; the message_end
 * close-out replaces it with the authoritative total.
 */
const ASCII_CHARS_PER_TOKEN = 4;
const CJK_CHARS_PER_TOKEN = 1.5;

export type EstimateCharCounts = { ascii: number; cjk: number };

const cjkChar = /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

export function addEstimateChars(counts: EstimateCharCounts, text: string): EstimateCharCounts {
	let ascii = counts.ascii;
	let cjk = counts.cjk;
	for (const ch of text) {
		if (cjkChar.test(ch)) cjk++;
		else ascii++;
	}
	return { ascii, cjk };
}

export function estimateOutputTokens(counts: EstimateCharCounts): number {
	return Math.floor(counts.ascii / ASCII_CHARS_PER_TOKEN + counts.cjk / CJK_CHARS_PER_TOKEN);
}

/**
 * Real mid-stream usage wins whenever the provider reports it (anthropic-style
 * message_start/message_delta); an all-zero/absent report falls back to the
 * local estimate so silent providers still show a growing total.
 */
export function liveUsageOrEstimate(
	raw: unknown,
	estimatedOutputTokens: number,
): StreamingUsageSnapshot | undefined {
	const real = readMessageUsage(raw);
	if (real && usageHasTokens(real)) return real;
	if (estimatedOutputTokens <= 0) return undefined;
	return { ...emptySnapshot(), output: estimatedOutputTokens };
}

export function shouldEmitStreamingUsage(input: {
	previousKey: string;
	lastEmitAt: number;
	next: StreamingUsageSnapshot;
	now: number;
	force?: boolean;
	minIntervalMs?: number;
}): { emit: boolean; key: string; at: number } {
	const key = usageFingerprint(input.next);
	if (input.force) return { emit: true, key, at: input.now };
	if (!usageHasTokens(input.next)) return { emit: false, key, at: input.lastEmitAt };
	if (key === input.previousKey) return { emit: false, key, at: input.lastEmitAt };
	const interval = input.minIntervalMs ?? STREAMING_USAGE_MIN_INTERVAL_MS;
	if (input.previousKey && input.now - input.lastEmitAt < interval) {
		return { emit: false, key, at: input.lastEmitAt };
	}
	return { emit: true, key, at: input.now };
}
