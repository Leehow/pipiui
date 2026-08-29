import { describe, expect, it } from "vitest";
import {
  PROACTIVE_COMPACTION_MIN_TOKENS,
  ProactiveCompactionPolicy,
  ProactiveCompactionScheduler,
  STANDARD_PROACTIVE_COMPACTION,
  contextUsageFraction,
  type ProactiveCompactionObserverEvent,
} from "../src/proactive-compaction.js";

/**
 * User-mandated policy: a non-urgent proactive compaction needs context
 * usage >= 45%, tokens >= 200_000, AND >= 4 minutes of continuous quiet.
 * Near-overflow / overflow protection is NOT tested here — it lives at the
 * pi session layer (see pi-ext follow-up/mid-turn guards) and stays live
 * while busy.
 */

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
  const high = { tokens: 450_000, contextWindow: 500_000 };
  const low = { tokens: 50_000, contextWindow: 500_000 };

  it("standard configuration enforces 45% + 200k tokens + 4-minute quiet (AND, not OR)", () => {
    expect(STANDARD_PROACTIVE_COMPACTION.highWatermark).toBe(0.45);
    expect(STANDARD_PROACTIVE_COMPACTION.waitWatermark).toBe(0.45);
    expect(STANDARD_PROACTIVE_COMPACTION.quietDelayMs).toBe(240_000);
    expect(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs).toBe(240_000);
    expect(PROACTIVE_COMPACTION_MIN_TOKENS).toBe(200_000);
    expect(STANDARD_PROACTIVE_COMPACTION.lowWatermark).toBeLessThan(
      STANDARD_PROACTIVE_COMPACTION.highWatermark,
    );
  });

  it("schedules only at or above the 45% watermark when tokens are already >= 200k", () => {
    const policy = new ProactiveCompactionPolicy();
    policy.observeFreshUsage({ tokens: 224_999, contextWindow: 500_000 }, 1);
    expect(policy.nextSchedulingDelay(0)).toBeUndefined();
    policy.observeFreshUsage({ tokens: 225_000, contextWindow: 500_000 }, 2);
    expect(policy.nextSchedulingDelay(0)).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
  });

  it("does not schedule at >=45% when tokens are below 200k", () => {
    const policy = new ProactiveCompactionPolicy();
    // 45% of a 200k window is 90k — the floor is the whole point of the rule.
    policy.observeFreshUsage({ tokens: 90_000, contextWindow: 200_000 }, 1);
    expect(policy.nextSchedulingDelay(0)).toBeUndefined();
    policy.observeFreshUsage({ tokens: 199_999, contextWindow: 400_000 }, 2);
    expect(policy.nextSchedulingDelay(0)).toBeUndefined();
  });

  it("schedules at >=45% once tokens reach 200k", () => {
    const policy = new ProactiveCompactionPolicy();
    policy.observeFreshUsage({ tokens: 200_000, contextWindow: 400_000 }, 1);
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
    policy.observeFreshUsage({ tokens: 200_000, contextWindow: 500_000 }, 4);
    expect(policy.isArmed).toBe(false);

    policy.observeFreshUsage(low, 5);
    expect(policy.isArmed).toBe(true);
    policy.observeFreshUsage(high, 6);
    expect(policy.nextSchedulingDelay(0)).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
  });

  it("backs off after a failure, but the 4-minute quiet window dominates a shorter backoff", () => {
    const policy = new ProactiveCompactionPolicy();
    policy.observeFreshUsage(high, 1);
    policy.recordCompactionFailure(1_000);
    // max(quietDelay, remaining backoff): 240s quiet > 59s backoff.
    expect(policy.nextSchedulingDelay(1_000)).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    expect(policy.nextSchedulingDelay(1_000 + STANDARD_PROACTIVE_COMPACTION.failureBackoffMs))
      .toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    // With a short quiet window the failure backoff is the binding constraint.
    const short = new ProactiveCompactionPolicy({
      highWatermark: 0.45,
      lowWatermark: 0.35,
      quietDelayMs: 10_000,
      failureBackoffMs: 60_000,
    });
    short.observeFreshUsage(high, 1);
    short.recordCompactionFailure(1_000);
    expect(short.nextSchedulingDelay(1_000)).toBe(60_000);
    expect(short.nextSchedulingDelay(1_000 + 60_000)).toBe(10_000);
  });

  it("fills wait defaults for a legacy four-field configuration", () => {
    const policy = new ProactiveCompactionPolicy({
      highWatermark: 0.5,
      lowWatermark: 0.3,
      quietDelayMs: 10,
      failureBackoffMs: 20,
    });
    // Wait-path defaults follow the standard policy numbers, not the caller's.
    expect(policy.configuration.waitWatermark).toBe(STANDARD_PROACTIVE_COMPACTION.waitWatermark);
    expect(policy.configuration.waitQuietDelayMs).toBe(STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs);
  });
});

/** Manual timer/clock so the scheduler's quiet period never costs wall-clock time. */
function harness(options: {
  idle?: boolean;
  liveAgents?: boolean;
  compact?: () => Promise<unknown>;
  shouldCompact?: () => boolean;
  observer?: (event: ProactiveCompactionObserverEvent) => void;
} = {}) {
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
    ...(options.shouldCompact ? { shouldCompact: options.shouldCompact } : {}),
    ...(options.observer ? { observer: options.observer } : {}),
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

const HIGH = { tokens: 450_000, contextWindow: 500_000 };
const POLICY_LINE = { tokens: 225_000, contextWindow: 500_000 };
const BELOW_LINE = { tokens: 224_999, contextWindow: 500_000 };
const LOW = { tokens: 50_000, contextWindow: 500_000 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ProactiveCompactionScheduler", () => {
  it("never schedules below 45%, however idle the session is", async () => {
    const h = harness();
    h.scheduler.observeUsage(BELOW_LINE, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(0);
    h.advance(10 * 60_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);
  });

  it("never schedules at >=45% when tokens are below 200k", async () => {
    const h = harness();
    h.scheduler.observeUsage({ tokens: 90_000, contextWindow: 200_000 }, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(0);
    h.advance(10 * 60_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);

    h.scheduler.observeUsage({ tokens: 199_999, contextWindow: 400_000 }, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(0);
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(0);
  });

  it("compacts at >=45% once tokens reach 200k", async () => {
    const h = harness();
    h.scheduler.observeUsage({ tokens: 200_000, contextWindow: 400_000 }, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(1);
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
  });

  it("at 45% it arms, but fires only after 4 continuous quiet minutes", async () => {
    const h = harness();
    h.scheduler.observeUsage(POLICY_LINE, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(1);
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
    await flush();
    expect(h.state.compactCalls).toBe(0);
    h.advance(1);
    await flush();
    expect(h.state.compactCalls).toBe(1);
  });

  it("compacts once the quiet period elapses above the watermark", async () => {
    const h = harness();
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    expect(h.state.compactCalls).toBe(0);
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
  });

  it("falls back to host summary compaction when lossless rewrite leaves usage at or above 45%", async () => {
    // Production closes the legacy summary gate so Headroom/context-fold can
    // own the epoch. If their rewrite never drops the sample, the quiet timer
    // must still issue the compact RPC — otherwise 585k/1m sits forever.
    const events: ProactiveCompactionObserverEvent[] = [];
    const h = harness({
      shouldCompact: () => false,
      observer: (event) => events.push(event),
    });
    h.scheduler.observeUsage({ tokens: 584_556, contextWindow: 1_000_000 }, h.scheduler.beginUsageRequest());
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(1);
    expect(events.map((e) => e.decision)).toContain("timer_fired");
    expect(events.some((e) => e.skipReason === "lossless_optimizer_primary")).toBe(false);
  });

  it("never fires while the session is busy, and rearms a fresh full window when it goes quiet", async () => {
    const h = harness({ idle: false });
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(0);
    h.advance(10_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);

    h.state.idle = true;
    h.scheduler.reconsider();
    // Busy time must not count toward the 4 quiet minutes: the re-armed
    // window is a full one from the idle transition.
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
    await flush();
    expect(h.state.compactCalls).toBe(0);
    h.advance(1);
    await flush();
    expect(h.state.compactCalls).toBe(1);
  });

  it("cancels a pending timer when a turn starts before it fires (activity re-arm)", async () => {
    const h = harness();
    h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
    expect(h.pending).toBe(1);
    // Host behavior on agent_start: the quiet timer dies immediately.
    h.state.idle = false;
    h.scheduler.cancel();
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
    await flush();
    expect(h.state.compactCalls).toBe(0);

    // Turn settles: a fresh full 4-minute window must pass before firing.
    h.state.idle = true;
    h.scheduler.settleTurn();
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
    await flush();
    expect(h.state.compactCalls).toBe(0);
    h.advance(1);
    await flush();
    expect(h.state.compactCalls).toBe(1);
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

    // Retry cadence is max(4-minute quiet, failure backoff) = another full
    // quiet window; one millisecond before it elapses nothing has fired.
    h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
    await flush();
    expect(h.state.compactCalls).toBe(1);
    h.advance(1);
    await flush();
    expect(h.state.compactCalls).toBe(2);
  });

  it("settles a lifecycle that never reported its end event", () => {
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
    h.advance(10 * 60_000);
    await flush();
    expect(h.state.compactCalls).toBe(0);
  });

  describe("quiet Boss wait with live subagents", () => {
    // Under the unified policy (45% + 4 minutes, AND) the former
    // wait-for-subagents fast path (50% + 30s) collapsed into the ordinary
    // path: waitWatermark == highWatermark, so a quiet Boss with live agents
    // compacts on exactly the same terms as one without. These tests pin
    // that no live-agent configuration can bypass the AND policy.
    it("does not schedule below 45% even with live agents", () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(BELOW_LINE, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(0);
    });

    it("requires the same full 4-minute quiet window with live agents at 45%+", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(POLICY_LINE, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);

      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
      await flush();
      expect(h.state.compactCalls).toBe(0);
      h.advance(1);
      await flush();
      expect(h.state.compactCalls).toBe(1);
    });

    it("compacts only once while usage stays high: disarm, not a wave latch", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);

      // Fresh high reports cannot re-arm; only a below-low-watermark report can.
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(0);
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);

      h.scheduler.observeUsage(LOW, h.scheduler.beginUsageRequest());
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(2);
    });

    it("keeps a pending quiet timer across rising usage within the same mode", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(POLICY_LINE, h.scheduler.beginUsageRequest());
      h.advance(60_000);
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      // Same mode/wave: the timer is not restarted, quiet stays continuous.
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 60_000 - 1);
      await flush();
      expect(h.state.compactCalls).toBe(0);
      h.advance(1);
      await flush();
      expect(h.state.compactCalls).toBe(1);
    });

    it("agent-wave transitions alone never cancel a continuously quiet timer", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);
      h.setLiveAgents(false);
      expect(h.pending).toBe(1);
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);
    });

    it("cancels through the ordinary idle gate when queue/follow-up/turn work arrives", async () => {
      const h = harness({ liveAgents: true });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);
      h.state.idle = false;
      h.scheduler.reconsider();
      expect(h.pending).toBe(0);
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(0);
    });

    it("does not let an in-flight success re-arm against fresh high reports", async () => {
      let finish!: () => void;
      const inFlight = new Promise<void>((resolve) => { finish = resolve; });
      const h = harness({ liveAgents: true, compact: () => inFlight });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);

      finish();
      await flush();
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(0);
    });

    it("does not retry a failed compact before the full quiet window elapses again", async () => {
      let attempt = 0;
      const h = harness({
        liveAgents: true,
        compact: () => (++attempt === 1 ? Promise.reject(new Error("retry")) : Promise.resolve()),
      });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);

      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs - 1);
      await flush();
      expect(h.state.compactCalls).toBe(1);
      h.advance(1);
      await flush();
      expect(h.state.compactCalls).toBe(2);
    });
  });

  describe("decision observer", () => {
    it("reports below_threshold with the usage sample and a coarse skip reason", () => {
      const events: ProactiveCompactionObserverEvent[] = [];
      const h = harness({ observer: (event) => events.push(event) });
      h.scheduler.liveAgentStateChanged();
      h.scheduler.observeUsage(BELOW_LINE, h.scheduler.beginUsageRequest());
      expect(events.map((e) => e.decision)).toEqual([
        "below_threshold",
        "below_threshold",
      ]);
      expect(events[0]!.skipReason).toBe("no_usage_sample");
      expect(events[1]!.usage).toEqual(BELOW_LINE);
      expect(events[1]!.skipReason).toBe("usage_below_watermark");
    });

    it("reports not_idle while the host gates say busy or a compaction runs", () => {
      const events: ProactiveCompactionObserverEvent[] = [];
      const h = harness({ idle: false, observer: (event) => events.push(event) });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      expect(events).toEqual([
        { decision: "not_idle", usage: HIGH, skipReason: "busy" },
      ]);
      expect(h.pending).toBe(0);
    });

    it("reports timer_armed → timer_fired → rpc_succeeded and disarms afterwards", async () => {
      const events: ProactiveCompactionObserverEvent[] = [];
      const h = harness({ observer: (event) => events.push(event) });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      expect(events.map((e) => e.decision)).toEqual(["timer_armed"]);
      expect(events[0]!.requiredIdleMs).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      expect(events[0]!.usage).toEqual(HIGH);

      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);
      // requestCompleted → compactionFinished → reconsider also reports the post-success disarm.
      expect(events.map((e) => e.decision)).toEqual([
        "timer_armed",
        "timer_fired",
        "rpc_succeeded",
        "below_threshold",
      ]);
      expect(events[0]!.requiredIdleMs).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      expect(events[0]!.remainingIdleMs).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      expect(events[0]!.usage).toEqual(HIGH);
      expect(events[1]!.requiredIdleMs).toBe(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      expect(events[1]!.remainingIdleMs).toBe(0);
      expect(events[3]!.skipReason).toBe("disarmed_until_low_report");
    });

    it("reports rpc_failed with the error kind as skip reason", async () => {
      const events: ProactiveCompactionObserverEvent[] = [];
      const h = harness({
        observer: (event) => events.push(event),
        compact: () => Promise.reject(new Error("pi refused")),
      });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(events.map((e) => e.decision)).toEqual([
        "timer_armed",
        "timer_fired",
        "rpc_failed",
        "timer_armed",
      ]);
      expect(events[2]!.skipReason).toBe("Error");
    });

    it("reports gate_failed when the quiet timer fires into a busy session", async () => {
      const events: ProactiveCompactionObserverEvent[] = [];
      const h = harness({ observer: (event) => events.push(event) });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      // Go busy without telling the scheduler: the timer is only a hint.
      h.state.idle = false;
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(0);
      expect(events.map((e) => e.decision)).toEqual(["timer_armed", "gate_failed"]);
      expect(events.at(-1)!.skipReason).toBe("busy");
    });

    it("bounds identical below_threshold/not_idle repeats without changing gates", () => {
      const events: ProactiveCompactionObserverEvent[] = [];
      const h = harness({ observer: (event) => events.push(event) });
      for (let i = 0; i < 40; i++) {
        h.scheduler.observeUsage(BELOW_LINE, h.scheduler.beginUsageRequest());
      }
      expect(events.filter((e) => e.decision === "below_threshold")).toHaveLength(1);
      expect(h.pending).toBe(0);
      expect(h.state.compactCalls).toBe(0);

      h.state.idle = false;
      for (let i = 0; i < 40; i++) {
        h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      }
      const notIdle = events.filter((e) => e.decision === "not_idle");
      expect(notIdle).toHaveLength(1);
      expect(notIdle[0]!.skipReason).toBe("busy");
      expect(h.pending).toBe(0);
      expect(h.state.compactCalls).toBe(0);

      // A usage/skipReason change must still be recorded.
      h.scheduler.observeUsage({ tokens: 10, contextWindow: 100 }, h.scheduler.beginUsageRequest());
      expect(events.filter((e) => e.decision === "not_idle")).toHaveLength(2);
    });

    it("never dedupes timer_armed, timer_fired, or RPC outcomes", async () => {
      const events: ProactiveCompactionObserverEvent[] = [];
      const h = harness({ observer: (event) => events.push(event) });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(events.map((e) => e.decision)).toEqual([
        "timer_armed",
        "timer_fired",
        "rpc_succeeded",
        "below_threshold",
      ]);
    });

    it("swallows a throwing observer and changes no scheduling behavior", async () => {
      const h = harness({ observer: () => { throw new Error("observer bug"); } });
      h.scheduler.observeUsage(HIGH, h.scheduler.beginUsageRequest());
      expect(h.pending).toBe(1);
      h.advance(STANDARD_PROACTIVE_COMPACTION.quietDelayMs);
      await flush();
      expect(h.state.compactCalls).toBe(1);
    });
  });
});
