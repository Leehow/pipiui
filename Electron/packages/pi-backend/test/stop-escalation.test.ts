import { describe, expect, it } from "vitest";

import { StopEscalationScheduler, identitiesMatch } from "../src/stop-escalation.js";

const flush = async (times = 8) => {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
};

function identity(pid: number, startTime = "t0", command = "pi --mode rpc") {
  return { pid, startTime, command };
}

describe("StopEscalationScheduler", () => {
  it("signals descendants SIGTERM then SIGKILL then kills snapshotted pi", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void; ms: number }[] = [];
    const idents = new Map([
      [10, identity(10)],
      [11, identity(11)],
      [12, identity(12)],
    ]);
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn, ms) => {
          timeouts.push({ fn, ms });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        listDescendants: (pid) => (pid === 10 ? [11, 12] : []),
        identify: (pid) => idents.get(pid),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 3, killDescendantsMs: 2, killPiMs: 2 },
    );

    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) });
    expect(timeouts.map((item) => item.ms)).toEqual([3, 5, 7]);
    await flush();
    timeouts[0].fn();
    await flush();
    timeouts[1].fn();
    await flush();
    expect(signals).toEqual([
      { pid: 11, signal: "SIGTERM" },
      { pid: 12, signal: "SIGTERM" },
      { pid: 11, signal: "SIGKILL" },
      { pid: 12, signal: "SIGKILL" },
    ]);
    timeouts[2].fn();
    await flush();
    expect(signals.at(-1)).toEqual({ pid: 10, signal: "SIGKILL" });
  });

  it("cancel aborts in-flight descendant enumeration and later signals", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void }[] = [];
    let releaseEnum!: (pids: number[]) => void;
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn) => {
          timeouts.push({ fn });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        listDescendants: () => new Promise<number[]>((resolve) => {
          releaseEnum = resolve;
        }),
        identify: (pid) => identity(pid),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 3, killDescendantsMs: 2, killPiMs: 2 },
    );
    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) });
    await flush();
    scheduler.cancel("s1");
    releaseEnum([11, 12]);
    await Promise.resolve();
    await Promise.resolve();
    for (const item of timeouts) item.fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(signals).toEqual([]);
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
    timeouts[2].fn();
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
    timeouts[2].fn();
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

  it("does not signal descendants whose identity cannot be read at enumerate time", async () => {
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const timeouts: { fn: () => void }[] = [];
    const scheduler = new StopEscalationScheduler(
      {
        setTimeout: (fn) => {
          timeouts.push({ fn });
          return timeouts.length - 1;
        },
        clearTimeout: () => undefined,
        listDescendants: () => [11, 12],
        identify: (pid) => (pid === 11 ? undefined : identity(pid)),
        kill: (pid, signal) => {
          signals.push({ pid, signal });
        },
      },
      { termDescendantsMs: 3, killDescendantsMs: 2, killPiMs: 2 },
    );
    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) });
    await flush();
    timeouts[0].fn();
    await flush();
    timeouts[1].fn();
    await flush();
    expect(signals).toEqual([
      { pid: 12, signal: "SIGTERM" },
      { pid: 12, signal: "SIGKILL" },
    ]);
  });

  it("does not signal descendants when snapshotted pi PID was reused", async () => {
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
    await flush();
    piIdentity = identity(10, "reused", "unrelated-process");
    timeouts[0].fn();
    await flush();
    timeouts[1].fn();
    await flush();
    expect(signals).toEqual([]);
  });

  it("still signals descendants when live pi identity matches abort snapshot", async () => {
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
    scheduler.start("s1", { piPid: 10, piIdentity: identity(10) });
    await flush();
    timeouts[0].fn();
    await flush();
    timeouts[1].fn();
    await flush();
    expect(signals).toEqual([
      { pid: 11, signal: "SIGTERM" },
      { pid: 11, signal: "SIGKILL" },
    ]);
  });
});
