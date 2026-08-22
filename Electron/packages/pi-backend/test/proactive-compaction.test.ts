import { describe, expect, it } from "vitest";
import {
  ProactiveCompactionPolicy,
  ProactiveCompactionScheduler,
  STANDARD_PROACTIVE_COMPACTION,
  contextUsageFraction,
} from "../src/proactive-compaction.js";

describe("contextUsageFraction", () => {
  it("prefers tokens/window and does not clamp above 100%", () => {
    // The screenshot case: a model switch re-divides the same tokens by a
    // smaller window. That is exactly when compaction is most needed, so the
    // fraction must stay >1 instead of being discarded as invalid.
    expect(contextUsageFraction({ tokens: 316_000, contextWindow: 200_000 })).toBeCloseTo(1.58);
    expect(contextUsageFraction({ tokens: 100_000, contextWindow: 200_000 })).toBe(0.5);
  });
  it("falls back to percent, and reports nothing when neither is usable", () => {
    expect(contextUsageFraction({ tokens: null, contextWindow: 200_000, percent: 85 })).toBe(0.85);
    // Post-compaction pi reports null tokens until the next assistant usage.
    expect(contextUsageFraction({ tokens: null, contextWindow: 200_000, percent: null })).toBeUndefined();
    expect(contextUsageFraction({ tokens: 10, contextWindow: 0 })).toBeUndefined();
    expect(contextUsageFraction(undefined)).toBeUndefined();
  });
});

describe("ProactiveCompactionPolicy", () => {
  const high = { tokens: 90, contextWindow: 100 };
  const low = { tokens: 10, contextWindow: 100 };

  it("schedules only at or above the high watermark", () => {
    const policy = new ProactiveCompactionPolicy();
    policy.observeFreshUsage({ tokens: 79, contextWindow: 100 }, 1);
    expect(policy.nextSchedulingDelay(0)).toBeUndefined();
    policy.observeFreshUsage({ tokens: 80, contextWindow: 100 }, 2);
    expect(policy.nextSchedulingDelay(0)).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
  });

  it("stays disarmed after a success until a newer low report arrives", () => {
    const policy = new ProactiveCompactionPolicy();
    policy.observeFreshUsage(high, 1);
    policy.recordCompactionSuccess(2);
    expect(policy.isArmed).toBe(false);

    // A stale response from a request issued before the compaction cannot re-arm.
    policy.observeFreshUsage(low, 2);
    expect(policy.isArmed).toBe(false);
    // Neither can a fresh-but-null report (pi right after compaction).
    policy.observeFreshUsage({ tokens: null, contextWindow: 100, percent: null }, 3);
    expect(policy.isArmed).toBe(false);
    // Nor a fresh report still above the low watermark.
    policy.observeFreshUsage({ tokens: 70, contextWindow: 100 }, 4);
    expect(policy.isArmed).toBe(false);

    policy.observeFreshUsage(low, 5);
    expect(policy.isArmed).toBe(true);
    policy.observeFreshUsage(high, 6);
    expect(policy.nextSchedulingDelay(0)).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
  });

  it("backs off after a failure instead of retrying immediately", () => {
    const policy = new ProactiveCompactionPolicy();
    policy.observeFreshUsage(high, 1);
    policy.recordCompactionFailure(1_000);
    expect(policy.nextSchedulingDelay(1_000)).toBe(STANDARD_PROACTIVE_COMPACTION.failureBackoffMs);
    expect(policy.nextSchedulingDelay(1_000 + STANDARD_PROACTIVE_COMPACTION.failureBackoffMs))
      .toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
  });

  it("fills wait defaults for a legacy four-field configuration", () => {
    const policy = new ProactiveCompactionPolicy({
      highWatermark: 0.8,
      lowWatermark: 0.6,
      quietDelayMs: 10,
      failureBackoffMs: 20,
    });
    expect(policy.configuration.waitWatermark).toBe(0.5);
    expect(policy.configuration.waitQuietDelayMs).toBe(30_000);
  });
});

/** Manual timer/clock so the scheduler's quiet period never costs wall-clock time. */
function harness(options: { idle?: boolean; liveAgents?: boolean; compact?: () => Promise<unknown> } = {}) {
  const timers = new Map<number, { fn: () => void; at: number }>();
  let nextHandle = 1;
  let clock = 0;
  const state = { idle: options.idle ?? true, liveAgents: options.liveAgents ?? false, compactCalls: 0 };
  const scheduler = new ProactiveCompactionScheduler({
    isIdle: () => state.idle,
    hasLiveAgents: () => state.liveAgents,
    compact: () => {
      state.compactCalls += 1;
      return options.compact ? options.compact() : Promise.resolve();
    },
    setTimer: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { fn, at: clock + ms });
      return handle;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    now: () => clock,
  });
  return {
    scheduler,
    state,
    setLiveAgents(value: boolean) {
      state.liveAgents = value;
      scheduler.liveAgentStateChanged();
    },
    get pending() {
      return timers.size;
    },
    advance(ms: number) {
      clock += ms;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= clock) {
          timers.delete(handle);
          timer.fn();
        }
      }
    },
  };
}

const HIGH = { tokens: 90, contextWindow: 100 };
const WAIT_BOUNDARY = { tokens: 50, contextWindow: 100 };
const WAIT_HIGH = { tokens: 55, contextWindow: 100 };
const WAIT_LOW = { tokens: 49, contextWindow: 100 };
const LOW = { tokens: 10, contextWindow: 100 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ProactiveCompactionScheduler", () => {
  it("compacts once the quiet period elapses above the watermark", async () => {
    const h = harness();
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    expect(h.state.compactCalls).toBe(0);
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
  });

  it("never fires while the session is busy, and rearms when it goes quiet", async () => {
    const h = harness({ idle: false });
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(0);
    h.advance(10_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);

    h.state.idle = true;
    h.scheduler.reconsider();
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
  });

  it("cancels a pending timer when a turn starts before it fires", async () => {
    const h = harness();
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(1);
    h.state.idle = false;
    h.scheduler.cancel();
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(0);
  });

  it("does not stack a second compaction on pi's own", async () => {
    const h = harness();
    h.scheduler.compactionStarted();
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    h.advance(10_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);
    expect(h.scheduler.isCompacting).toBe(true);

    // Finishing pi's compaction leaves the policy disarmed until a low report.
    h.scheduler.compactionFinished(true);
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    h.advance(10_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);

    h.scheduler.observeUsage(LOW, h.scheduler.beginUsageRequest());
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
  });

  it("backs off a rejected compact instead of hammering pi", async () => {
    const h = harness({ compact: () => Promise.reject(new Error("Nothing to compact")) });
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
    expect(h.scheduler.isCompacting).toBe(false);

    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
    h.advance(STANDARD_PROACTIVE_COMPACTION.failureBackoffMs);
    await flush();
    expect(h.state.compactCalls).toBe(2);
  });

  it("settles a lifecycle that never reported its end event", async () => {
    const h = harness();
    h.scheduler.compactionStarted();
    expect(h.scheduler.isCompacting).toBe(true);
    h.scheduler.settleTurn();
    expect(h.scheduler.isCompacting).toBe(false);
  });

  it("stops scheduling once disposed", async () => {
    const h = harness();
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    h.scheduler.dispose();
    h.advance(10_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);
  });

  describe("quiet Boss wait with live subagents", () => {
    it("does not schedule between 50% and 79% without live agents", () => {
      const h = harness();
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(0);
    });

    it("does not schedule below 50% with live agents", () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(WAIT_LOW, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(0);
    });

    it("waits 30 seconds at 50-79%, then compacts only once in the same live wave", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(WAIT_BOUNDARY, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);

      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs - 1);
      await flush();
      expect(h.state.compactCalls).toBe(0);
      h.advance(1);
      await flush();
      expect(h.state.compactCalls).toBe(1);

      // 55% is below the ordinary 60% re-arm watermark. The per-wave latch,
      // not the ordinary policy, must prevent a second wait compact.
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(0);
      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);
    });

    it("keeps the existing two-second path at or above 80%", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
      await flush();
      expect(h.state.compactCalls).toBe(0);
      h.advance(1);
      await flush();
      expect(h.state.compactCalls).toBe(1);
    });

    it("replaces a pending 30-second wait with the fast path when usage rises to 80%", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      h.advance(10_000);
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
      await flush();
      expect(h.state.compactCalls).toBe(0);
      h.advance(1);
      await flush();
      expect(h.state.compactCalls).toBe(1);
    });

    it("cancels the wait timer when the live wave ends", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);
      h.setLiveAgents(false);
      expect(h.pending).toBe(0);
      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(0);
    });

    it("cancels through the ordinary idle gate when queue/follow-up/turn work arrives", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);
      h.state.idle = false;
      h.scheduler.reconsider();
      expect(h.pending).toBe(0);
      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(0);
    });

    it("resets the success latch only after all agents terminate, allowing a new wave", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(0);

      h.setLiveAgents(false);
      h.setLiveAgents(true);
      expect(h.pending).toBe(1);
      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(2);
    });

    it("does not let an old-wave in-flight success consume a newer live wave", async () => {
      let finish!: () => void;
      const inFlight = new Promise<void>((resolve) => { finish = resolve; });
      const h = harness({ liveAgents: true, compact: () => inFlight });
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);

      h.setLiveAgents(false);
      h.setLiveAgents(true);
      finish();
      await flush();
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);
    });

    it("does not consume the wave allowance on failure and retries after existing backoff", async () => {
      let attempt = 0;
      const h = harness({
        liveAgents: true,
        compact: () => (++attempt === 1 ? Promise.reject(new Error("retry")) : Promise.resolve()),
      });
      h.scheduler.observeUsage(WAIT_HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);

      h.advance(STANDARD_PROACTIVE_COMPACTION.failureBackoffMs - 1);
      await flush();
      expect(h.state.compactCalls).toBe(1);
      h.advance(1);
      await flush();
      expect(h.state.compactCalls).toBe(2);
    });
  });
});
