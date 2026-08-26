import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	IDLE_FOLD_ENGINE_KEY,
	IDLE_FOLD_FALLBACK_MS_DEFAULT,
	IDLE_FOLD_LOW_WATERMARK_DEFAULT,
	IDLE_FOLD_LOW_WATERMARK_FLOOR,
	IDLE_FOLD_TTL_FLOOR_MS,
	IDLE_FOLD_TTL_MS_DEFAULT,
	contextAboveIdleFoldWatermark,
	createIdleFoldRegistry,
	idleFoldConfigFromEnv,
	runDeterministicIdleFold,
	type IdleFoldFireInfo,
} from "../idle-fold-timer.ts";

type FakeHandle = { id: number; at: number; callback: () => void; cancelled: boolean };

function createFakeClock() {
	let now = 0;
	let nextId = 1;
	const scheduled: FakeHandle[] = [];
	return {
		now: () => now,
		schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
			const handle: FakeHandle = { id: nextId++, at: now + delayMs, callback, cancelled: false };
			scheduled.push(handle);
			return handle as unknown as ReturnType<typeof setTimeout>;
		},
		cancel(handle: ReturnType<typeof setTimeout>) {
			(handle as unknown as FakeHandle).cancelled = true;
		},
		advance(ms: number) {
			now += ms;
			for (const handle of scheduled) {
				if (handle.cancelled || handle.at > now) continue;
				handle.cancelled = true;
				handle.callback();
			}
		},
		pending() {
			return scheduled.filter((handle) => !handle.cancelled && handle.at > now).length;
		},
	};
}

function registryWithClock(
	clock: ReturnType<typeof createFakeClock>,
	overrides: {
		aboveWatermark?: boolean;
		enabled?: boolean;
		ttlMs?: number;
		nudge?: boolean;
		fallback?: boolean;
		fallbackMs?: number;
		onNudge?: (info: IdleFoldFireInfo) => boolean | void;
		onFold?: (info: IdleFoldFireInfo) => void;
	} = {},
) {
	const folds: IdleFoldFireInfo[] = [];
	const nudges: IdleFoldFireInfo[] = [];
	const registry = createIdleFoldRegistry({
		enabled: overrides.enabled,
		ttlMs: overrides.ttlMs ?? IDLE_FOLD_TTL_MS_DEFAULT,
		nudge: overrides.nudge,
		fallback: overrides.fallback,
		fallbackMs: overrides.fallbackMs,
		schedule: clock.schedule,
		cancel: clock.cancel,
		isContextAboveWatermark: () => overrides.aboveWatermark !== false,
		onNudge: overrides.onNudge
			? (info) => {
				nudges.push(info);
				return overrides.onNudge?.(info);
			}
			: undefined,
		onFold: (info) => {
			folds.push(info);
			overrides.onFold?.(info);
		},
	});
	return { registry, folds, nudges };
}

test("idle fold knobs default to 4 minutes and the 45% conservative watermark", () => {
	assert.equal(IDLE_FOLD_TTL_MS_DEFAULT, 4 * 60 * 1000);
	assert.equal(IDLE_FOLD_LOW_WATERMARK_DEFAULT, 0.45);
	assert.deepEqual(idleFoldConfigFromEnv({}), {
		enabled: true,
		ttlMs: 240_000,
		lowWatermark: 0.45,
		nudge: true,
		fallback: true,
		fallbackMs: IDLE_FOLD_FALLBACK_MS_DEFAULT,
	});
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_NUDGE: "0" }).nudge, false);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_FALLBACK: "0" }).fallback, false);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_FALLBACK_MS: "15000" }).fallbackMs, 15_000);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_ENABLED: "0" }).enabled, false);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_TTL_MS: "-1" }).ttlMs, IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_LOW_WATERMARK: "1.5" }).lowWatermark, IDLE_FOLD_LOW_WATERMARK_DEFAULT);
});

test("env knobs cannot relax the mandatory 4-minute / 45% floors", () => {
	assert.equal(IDLE_FOLD_TTL_FLOOR_MS, 240_000);
	assert.equal(IDLE_FOLD_LOW_WATERMARK_FLOOR, 0.45);
	// Aggressively relaxed env values are clamped back up to the floors.
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_TTL_MS: "1" }).ttlMs, 240_000);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_LOW_WATERMARK: "0.01" }).lowWatermark, 0.45);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_TTL_MS: "120000" }).ttlMs, 240_000);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_LOW_WATERMARK: "0.3" }).lowWatermark, 0.45);
	// Invalid values fall back to the defaults, which equal the floors.
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_TTL_MS: "-1" }).ttlMs, 240_000);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_LOW_WATERMARK: "1.5" }).lowWatermark, 0.45);
	// More conservative (longer / higher) env values are preserved.
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_TTL_MS: "600000" }).ttlMs, 600_000);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_TTL_MS: "3600000" }).ttlMs, 3_600_000);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_LOW_WATERMARK: "0.6" }).lowWatermark, 0.6);
	assert.equal(idleFoldConfigFromEnv({ PIPIUI_IDLE_FOLD_LOW_WATERMARK: "1" }).lowWatermark, 1);
});

test("watermark is conservative when usage is missing or below the line", () => {
	assert.equal(contextAboveIdleFoldWatermark(undefined), false);
	assert.equal(contextAboveIdleFoldWatermark({ tokens: null, contextWindow: 200_000 }), false);
	assert.equal(contextAboveIdleFoldWatermark({ tokens: 80_000, contextWindow: 200_000 }), false);
	// 44.999% — idle satisfied elsewhere — still never trips the 45% line.
	assert.equal(contextAboveIdleFoldWatermark({ tokens: 89_998, contextWindow: 200_000 }), false);
	assert.equal(contextAboveIdleFoldWatermark({ tokens: 90_000, contextWindow: 200_000 }), true);
	assert.equal(contextAboveIdleFoldWatermark({ tokens: 90_000, contextWindow: 200_000 }, 0.5), false);
});

test("dispatch plus 4 minutes without completion triggers one deterministic fold", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	clock.advance(239_999);
	assert.equal(folds.length, 0);
	assert.equal(registry.pendingTimerCount(), 1);
	clock.advance(1);
	assert.equal(folds.length, 1);
	assert.deepEqual(folds[0], { key: "session-a", agentIds: ["worker-a"] });
	assert.equal(registry.pendingTimerCount(), 0);
});

test("completion at 3 minutes cancels the timer so fold never fires", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	clock.advance(180_000);
	registry.noteCompleted("worker-a");
	assert.equal(registry.pendingTimerCount(), 0);
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 0);
});

test("TTL fire below the low watermark does not fold", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock, { aboveWatermark: false });
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 0);
	assert.equal(registry.pendingTimerCount(), 0);
});

test("concurrent workers in one session share one timer; the wave folds once", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	clock.advance(60_000);
	registry.arm("session-a", "worker-b");
	assert.equal(registry.pendingTimerCount(), 1);
	assert.deepEqual(registry.trackedAgentIds("session-a").sort(), ["worker-a", "worker-b"]);
	clock.advance(179_999);
	assert.equal(folds.length, 0);
	clock.advance(1);
	assert.equal(folds.length, 1);
	assert.deepEqual(folds[0]?.agentIds.sort(), ["worker-a", "worker-b"]);
});

test("one worker finishing early does not cancel a still-running wave mate", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	registry.arm("session-a", "worker-b");
	clock.advance(180_000);
	registry.noteCompleted("worker-a");
	assert.equal(registry.pendingTimerCount(), 1);
	clock.advance(59_999);
	assert.equal(folds.length, 0);
	clock.advance(1);
	assert.equal(folds.length, 1);
	assert.deepEqual(folds[0]?.agentIds, ["worker-b"]);
});

test("all workers completing cancels the shared session timer", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	registry.arm("session-a", "worker-b");
	registry.noteCompleted("worker-a");
	registry.noteCompleted("worker-b");
	assert.equal(registry.pendingTimerCount(), 0);
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 0);
});

test("different session keys keep independent timers", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	registry.arm("session-b", "worker-b");
	assert.equal(registry.pendingTimerCount(), 2);
	registry.noteCompleted("worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 1);
	assert.equal(folds[0]?.key, "session-b");
});

test("a fired epoch does not fold again until the wave drains and a new dispatch arms", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 1);
	registry.arm("session-a", "worker-b");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 1);
	registry.noteCompleted("worker-a");
	registry.noteCompleted("worker-b");
	registry.arm("session-a", "worker-c");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 2);
	assert.deepEqual(folds[1]?.agentIds, ["worker-c"]);
});

test("session dispose clears pending timers so later ticks cannot fold", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	registry.arm("session-b", "worker-b");
	assert.equal(registry.pendingTimerCount(), 2);
	registry.disposeAll();
	assert.equal(registry.pendingTimerCount(), 0);
	assert.equal(clock.pending(), 0);
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 0);
});

test("orphan sweep cancels agents that left runningAgents", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	registry.arm("session-a", "worker-b");
	registry.sweepOrphans(new Set(["worker-b"]));
	assert.deepEqual(registry.trackedAgentIds("session-a"), ["worker-b"]);
	registry.sweepOrphans(new Set());
	assert.equal(registry.pendingTimerCount(), 0);
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 0);
});

test("disabled registry never arms a timer", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock, { enabled: false });
	registry.arm("session-a", "worker-a");
	assert.equal(registry.pendingTimerCount(), 0);
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 0);
});

test("registered live fold engine is the preferred existing fold API", async () => {
	const g = globalThis as Record<string | symbol, unknown>;
	const prev = g[IDLE_FOLD_ENGINE_KEY];
	g[IDLE_FOLD_ENGINE_KEY] = (input: { messages: readonly unknown[] }) => ({
		folded: input.messages.length > 0,
		messages: ["folded"],
	});
	try {
		const result = await runDeterministicIdleFold({
			messages: [{ role: "user", content: "x" }],
			tokens: 90_000,
			contextWindow: 200_000,
		});
		assert.deepEqual(result, { folded: true, messages: ["folded"] });
	} finally {
		if (prev === undefined) delete g[IDLE_FOLD_ENGINE_KEY];
		else g[IDLE_FOLD_ENGINE_KEY] = prev;
	}
});

test("idle fold calls the existing FoldLadderPolicy / ContextFoldEngine API", () => {
	const source = readFileSync(new URL("../idle-fold-timer.ts", import.meta.url), "utf8");
	assert.match(source, /ContextFoldEngine/);
	assert.match(source, /FoldLadderPolicy/);
	assert.match(source, /engine\.process/);
	assert.doesNotMatch(source, /_runAutoCompaction|main-compaction/);
});

test("index.ts arms, cancels, and disposes the idle-fold timer off the 30s watchdog tick", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /from "\.\/idle-fold-timer\.ts"/);
	assert.match(source, /createIdleFoldRegistry/);
	assert.match(source, /armIdleFoldForDispatch/);
	assert.match(source, /noteIdleFoldActivity/);
	assert.match(source, /noteIdleFoldCompleted/);
	assert.match(source, /disposeAllIdleFoldTimers/);
	assert.match(source, /runDeterministicIdleFold/);
	assert.match(source, /!contextFoldIsStandby\(\).*contextAboveIdleFoldWatermark/);
	assert.match(source, /function runProductionIdleFold\(\): void \{\s*if \(contextFoldIsStandby\(\)\) return;/);
	assert.match(source, /registerContextManageTool/);
	assert.match(source, /handleIdleFoldNudge/);
	assert.match(source, /onNudge/);
	assert.match(source, /noteFolded/);
	assert.match(source, /restoreNudgeThinking/);
	assert.match(source, /onSuccessfulFold/);
	assert.match(source, /runningAgents\.set\([\s\S]*?armIdleFoldForDispatch/);
	assert.match(source, /function noteAgentActivity\([\s\S]*?noteIdleFoldActivity/);
	assert.match(source, /function notifySubagentDone\([\s\S]*?noteIdleFoldCompleted/);
	assert.match(source, /function markWorkerInterrupted\([\s\S]*?noteIdleFoldCompleted/);
	assert.match(source, /session_shutdown[\s\S]*?disposeAllIdleFoldTimers/);
	assert.match(source, /process\.on\("exit"[\s\S]*?disposeAllIdleFoldTimers/);
	assert.match(source, /sweepOrphans/);
	assert.doesNotMatch(
		source,
		/const stallWatchdog = setInterval\([\s\S]{0,200}armIdleFoldForDispatch/,
	);
});

test("TTL above watermark injects one nudge and does not fold immediately", () => {
	const clock = createFakeClock();
	const { registry, folds, nudges } = registryWithClock(clock, {
		nudge: true,
		fallback: true,
		fallbackMs: 60_000,
		onNudge: () => true,
	});
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(nudges.length, 1);
	assert.equal(folds.length, 0);
	clock.advance(59_999);
	assert.equal(folds.length, 0);
	clock.advance(1);
	assert.equal(folds.length, 1);
});

test("the same idle epoch only nudges once", () => {
	const clock = createFakeClock();
	const { registry, folds, nudges } = registryWithClock(clock, {
		nudge: true,
		fallback: false,
		onNudge: () => true,
	});
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	registry.arm("session-a", "worker-b");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(nudges.length, 1);
	assert.equal(folds.length, 0);
});

test("below the low watermark does not inject a nudge", () => {
	const clock = createFakeClock();
	const { registry, folds, nudges } = registryWithClock(clock, {
		aboveWatermark: false,
		nudge: true,
		onNudge: () => true,
	});
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(nudges.length, 0);
	assert.equal(folds.length, 0);
});

test("a failed nudge falls back to deterministic fold immediately", () => {
	const clock = createFakeClock();
	const { registry, folds, nudges } = registryWithClock(clock, {
		nudge: true,
		fallback: true,
		onNudge: () => false,
	});
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(nudges.length, 1);
	assert.equal(folds.length, 1);
});

test("a successful fold cancels the 60s deterministic fallback", () => {
	const clock = createFakeClock();
	const { registry, folds, nudges } = registryWithClock(clock, {
		nudge: true,
		fallback: true,
		fallbackMs: 60_000,
		onNudge: () => true,
	});
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(nudges.length, 1);
	assert.equal(folds.length, 0);
	assert.equal(registry.pendingTimerCount(), 1);
	registry.noteFolded("session-a");
	assert.equal(registry.pendingTimerCount(), 0);
	clock.advance(60_000);
	assert.equal(folds.length, 0);
});

test("fallback still runs when the nudge is ignored", () => {
	const clock = createFakeClock();
	const { registry, folds, nudges } = registryWithClock(clock, {
		nudge: true,
		fallback: true,
		fallbackMs: 60_000,
		onNudge: () => true,
	});
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(nudges.length, 1);
	clock.advance(60_000);
	assert.equal(folds.length, 1);
});

test("activity just before 4 minutes does not fold; fold waits 4 minutes from last activity", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	clock.advance(239_999);
	registry.noteActivity("worker-a");
	assert.equal(folds.length, 0);
	assert.equal(registry.pendingTimerCount(), 1);
	clock.advance(1);
	assert.equal(folds.length, 0);
	clock.advance(239_998);
	assert.equal(folds.length, 0);
	clock.advance(1);
	assert.equal(folds.length, 1);
	assert.deepEqual(folds[0], { key: "session-a", agentIds: ["worker-a"] });
});

test("any worker activity in a shared session re-arms the session timer", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	registry.arm("session-a", "worker-b");
	clock.advance(120_000);
	registry.noteActivity("worker-b");
	clock.advance(239_999);
	assert.equal(folds.length, 0);
	clock.advance(1);
	assert.equal(folds.length, 1);
	assert.deepEqual(folds[0]?.agentIds.sort(), ["worker-a", "worker-b"]);
});

test("activity after a fired epoch does not start another fold", () => {
	const clock = createFakeClock();
	const { registry, folds } = registryWithClock(clock);
	registry.arm("session-a", "worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 1);
	registry.noteActivity("worker-a");
	clock.advance(IDLE_FOLD_TTL_MS_DEFAULT);
	assert.equal(folds.length, 1);
});
