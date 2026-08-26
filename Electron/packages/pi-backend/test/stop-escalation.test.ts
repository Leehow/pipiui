import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STOP_ESCALATION_DELAYS,
  StopEscalationScheduler,
  identitiesMatch,
} from "../src/stop-escalation.js";

const flush = async (times = 8) => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};

function identity(pid: number, startTime = "t0", command = "pi --mode rpc") {
  return { pid, startTime, command };
}

describe("StopEscalationScheduler", () => {
  it("escalates only the snapshotted pi and never signals descendants", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void; ms: number }[] = [];
    let listedDescendants = 0;
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn, ms) => {
          timeouts.push({ fn, ms });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        // A live worker (11) and a turn tool child (12) under the same pi.
        listDescendants: (pid) => {
          listedDescendants += 1;
          return pid === 10 ? [11, 12] : [];
        },
        identify: (pid) => identity(pid),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 3, killDescendantsMs: 2, killPiMs: 2 },
    );

    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) });
    // One bounded timer: the full 3s + 2s + 2s window, pi itself only.
    expect(timeouts.map((item) => item.ms)).toEqual([7]);
    for (const item of timeouts) item.fn();
    await flush();
    expect(signals).toEqual([{ pid: 10, signal: "SIGKILL" }]);
    expect(listedDescendants).toBe(0);
  });

  it("spares background worker descendants across the full default 3s/5s/7s escalation windows", async () => {
    vi.useFakeTimers();
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    let listedDescendants = 0;
    let forceStopped = 0;
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
        listDescendants: (pid) => {
          listedDescendants += 1;
          return pid === 10 ? [11, 12] : [];
        },
        identify: (pid) => identity(pid),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      DEFAULT_STOP_ESCALATION_DELAYS,
    );

    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) }, () => {
      forceStopped += 1;
    });

    // Past the old 3s SIGTERM-descendants window.
    await vi.advanceTimersByTimeAsync(DEFAULT_STOP_ESCALATION_DELAYS.termDescendantsMs + 1);
    expect(signals).toEqual([]);
    // Past the old 5s SIGKILL-descendants window.
    await vi.advanceTimersByTimeAsync(DEFAULT_STOP_ESCALATION_DELAYS.killDescendantsMs + 1);
    expect(signals).toEqual([]);
    // Not yet at the 7s bound.
    await vi.advanceTimersByTimeAsync(DEFAULT_STOP_ESCALATION_DELAYS.killPiMs - 3);
    expect(signals).toEqual([]);
    // At the bound: the pi itself is escalated, exactly once, and reported.
    await vi.advanceTimersByTimeAsync(3);
    expect(signals).toEqual([{ pid: 10, signal: "SIGKILL" }]);
    expect(forceStopped).toBe(1);
    expect(listedDescendants).toBe(0);
  });

  it("cancel stops the ladder before the pi is signalled", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void }[] = [];
    let forceStopped = 0;
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn) => {
          timeouts.push({ fn });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        listDescendants: () => [11],
        identify: (pid) => identity(pid),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 3, killDescendantsMs: 2, killPiMs: 2 },
    );
    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) }, () => {
      forceStopped += 1;
    });
    await flush();
    scheduler.cancel("s1");
    for (const item of timeouts) item.fn();
    await flush();
    expect(signals).toEqual([]);
    expect(forceStopped).toBe(0);
  });

  it("does not signal when PID identity no longer matches the abort snapshot", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void }[] = [];
    let piIdentity = identity(10, "old");
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn) => {
          timeouts.push({ fn });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        listDescendants: () => [11],
        identify: (pid) => (pid === 10 ? piIdentity : identity(pid)),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 3, killDescendantsMs: 2, killPiMs: 2 },
    );
    scheduler.start("s1", { piPid: 10, piIdentity: identity(10, "old") });
    await Promise.resolve();
    await Promise.resolve();
    piIdentity = identity(10, "reused");
    timeouts[0].fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(signals.some((item) => item.pid === 10)).toBe(false);
  });

  it("does not follow a live PID change after the snapshot is pinned", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void }[] = [];
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn) => {
          timeouts.push({ fn });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        listDescendants: () => [],
        identify: (pid) => identity(pid),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 1, killDescendantsMs: 1, killPiMs: 1 },
    );
    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) });
    await Promise.resolve();
    timeouts[0].fn();
    await Promise.resolve();
    expect(signals).toEqual([{ pid: 10, signal: "SIGKILL" }]);
  });

  it("identitiesMatch requires start time or command continuity", () => {
    expect(identitiesMatch(identity(1, "a", "pi"), identity(1, "a", "pi"))).toBe(true);
    expect(identitiesMatch(identity(1, "a", "pi"), identity(1, "b", "pi"))).toBe(false);
    expect(identitiesMatch(undefined, identity(1))).toBe(false);
  });

  it("identitiesMatch is fail-closed when either side lacks start time or argv", () => {
    expect(identitiesMatch(identity(1, "", "pi"), identity(1, "a", "pi"))).toBe(false);
    expect(identitiesMatch(identity(1, "a", "pi"), identity(1, "", "pi"))).toBe(false);
    expect(identitiesMatch(identity(1, "a", ""), identity(1, "a", "pi"))).toBe(false);
    expect(identitiesMatch(identity(1, "a", "pi"), identity(1, "a", ""))).toBe(false);
    expect(identitiesMatch({ pid: 1, startTime: "   ", command: "pi" }, identity(1, "   ", "pi"))).toBe(
      false,
    );
  });

  it("does not signal anything when abort-time pi identity is missing", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void }[] = [];
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn) => {
          timeouts.push({ fn });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        listDescendants: () => [11],
        identify: (pid) => identity(pid),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 3, killDescendantsMs: 2, killPiMs: 2 },
    );
    scheduler.start("s1", { piPid: 10 });
    await flush();
    for (const item of timeouts) item.fn();
    await flush();
    expect(signals).toEqual([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
