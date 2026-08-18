import { execFileSync } from "node:child_process";

export type StopEscalationDelays = {
  /** After abort is sent: SIGTERM each descendant of pi (not pi itself). */
  termDescendantsMs: number;
  /** After T1: SIGKILL those descendants. */
  killDescendantsMs: number;
  /** After T2: SIGKILL the pi process itself. */
  killPiMs: number;
};

export const DEFAULT_STOP_ESCALATION_DELAYS: StopEscalationDelays = {
  termDescendantsMs: 3_000,
  killDescendantsMs: 2_000,
  killPiMs: 2_000,
};

export type ProcessIdentity = {
  pid: number;
  startTime: string;
  command: string;
};

/** Snapshot pinned at abort time. Later live PID changes must not be signalled. */
export type StopEscalationSnapshot = {
  piPid: number;
  piIdentity?: ProcessIdentity;
};

export type StopEscalationHooks = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  listDescendants: (pid: number) => number[] | Promise<number[]>;
  identify: (pid: number) => ProcessIdentity | undefined | Promise<ProcessIdentity | undefined>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
};

type EscalationRun = {
  cancelled: boolean;
  timers: unknown[];
  snapshot: StopEscalationSnapshot;
  descendants?: ProcessIdentity[];
  enumerated: Promise<void>;
};

/** Recursively list child PIDs of `pid` via `pgrep -P`. Never returns `pid` itself. */
export function listDescendantPids(pid: number): number[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  const seen = new Set<number>();
  const walk = (parent: number) => {
    let stdout = "";
    try {
      stdout = execFileSync("pgrep", ["-P", String(parent)], {
        encoding: "utf8",
        timeout: 1_000,
      });
    } catch {
      return;
    }
    for (const token of stdout.split(/\s+/)) {
      const child = Number.parseInt(token, 10);
      if (!Number.isInteger(child) || child <= 0 || seen.has(child)) continue;
      seen.add(child);
      walk(child);
    }
  };
  walk(pid);
  return [...seen];
}

/** `ps` start-time + argv. Empty/missing process → undefined. */
export function readProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    const startTime = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 1_000,
    }).trim();
    const command = execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 1_000,
    }).trim();
    if (!startTime && !command) return undefined;
    return { pid, startTime, command };
  } catch {
    return undefined;
  }
}

function identityFieldPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Fail-closed: missing start time or argv on either side is a mismatch. */
export function isCompleteIdentity(identity: ProcessIdentity | undefined): identity is ProcessIdentity {
  return Boolean(
    identity &&
      Number.isInteger(identity.pid) &&
      identity.pid > 0 &&
      identityFieldPresent(identity.startTime) &&
      identityFieldPresent(identity.command),
  );
}

export function identitiesMatch(
  expected: ProcessIdentity | undefined,
  actual: ProcessIdentity | undefined,
): boolean {
  if (!isCompleteIdentity(expected) || !isCompleteIdentity(actual)) return false;
  if (expected.pid !== actual.pid) return false;
  if (expected.startTime !== actual.startTime) return false;
  if (expected.command !== actual.command) return false;
  return true;
}

export function defaultStopEscalationHooks(): StopEscalationHooks {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
    listDescendants: listDescendantPids,
    identify: readProcessIdentity,
    kill: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * Abort-unresponsive turn ladder (Swift scheduleStopEscalation parity).
 * Never signals a process group (`kill(-pid)`); only enumerated descendant PIDs
 * and, last, the snapshotted pi pid itself.
 */
export class StopEscalationScheduler {
  private readonly runs = new Map<string, EscalationRun>();

  constructor(
    private readonly hooks: StopEscalationHooks = defaultStopEscalationHooks(),
    private readonly delays: StopEscalationDelays = DEFAULT_STOP_ESCALATION_DELAYS,
  ) {}

  start(
    sessionId: string,
    snapshot: StopEscalationSnapshot,
    onForceStopped?: () => void,
  ): void {
    this.cancel(sessionId);
    const run: EscalationRun = {
      cancelled: false,
      timers: [],
      snapshot: { piPid: snapshot.piPid, piIdentity: snapshot.piIdentity },
      enumerated: Promise.resolve(),
    };
    this.runs.set(sessionId, run);

    const arm = (ms: number, fn: () => void) => {
      const id = this.hooks.setTimeout(() => {
        if (run.cancelled) return;
        fn();
      }, ms);
      run.timers.push(id);
    };

    const piLiveMatchesSnapshot = async (): Promise<boolean> => {
      const expected = run.snapshot.piIdentity;
      if (!isCompleteIdentity(expected)) {
        return false;
      }
      const live = await this.hooks.identify(run.snapshot.piPid);
      if (run.cancelled) return false;
      return identitiesMatch(live, expected);
    };

    const enumerate = async (): Promise<void> => {
      if (!(await piLiveMatchesSnapshot())) {
        if (!run.cancelled) {
          console.warn(
            `[stop-escalation] skip descendant enumerate of pid=${run.snapshot.piPid}: identity mismatch or incomplete`,
          );
        }
        return;
      }
      const kids = await this.hooks.listDescendants(run.snapshot.piPid);
      if (run.cancelled) return;
      const identities: ProcessIdentity[] = [];
      for (const child of kids) {
        if (run.cancelled) return;
        if (child === run.snapshot.piPid) continue;
        const identity = await this.hooks.identify(child);
        if (run.cancelled) return;
        if (isCompleteIdentity(identity)) identities.push(identity);
      }
      if (!run.cancelled) run.descendants = identities;
    };
    run.enumerated = enumerate();

    const signalDescendants = async (signal: NodeJS.Signals) => {
      await run.enumerated;
      if (run.cancelled) return;
      if (!isCompleteIdentity(run.snapshot.piIdentity)) {
        console.warn(
          `[stop-escalation] skip ${signal} descendants of pid=${run.snapshot.piPid}: incomplete abort snapshot`,
        );
        return;
      }
      if (!(await piLiveMatchesSnapshot())) {
        if (!run.cancelled) {
          console.warn(
            `[stop-escalation] skip ${signal} descendants of pid=${run.snapshot.piPid}: identity mismatch or incomplete`,
          );
        }
        return;
      }
      const targets = run.descendants;
      if (!targets) return;
      for (const expected of targets) {
        if (run.cancelled) return;
        const actual = await this.hooks.identify(expected.pid);
        if (run.cancelled) return;
        if (!identitiesMatch(expected, actual)) {
          console.warn(
            `[stop-escalation] skip ${signal} pid=${expected.pid}: identity mismatch or incomplete`,
          );
          continue;
        }
        this.hooks.kill(expected.pid, signal);
      }
    };

    const signalPi = async () => {
      if (run.cancelled) return;
      const expected = run.snapshot.piIdentity;
      if (!isCompleteIdentity(expected)) {
        console.warn(
          `[stop-escalation] skip SIGKILL pi pid=${run.snapshot.piPid}: incomplete abort snapshot`,
        );
        return;
      }
      const actual = await this.hooks.identify(run.snapshot.piPid);
      if (run.cancelled) return;
      if (!identitiesMatch(expected, actual)) {
        console.warn(
          `[stop-escalation] skip SIGKILL pi pid=${run.snapshot.piPid}: identity mismatch or incomplete`,
        );
        return;
      }
      this.hooks.kill(run.snapshot.piPid, "SIGKILL");
    };

    arm(this.delays.termDescendantsMs, () => {
      void signalDescendants("SIGTERM");
    });
    arm(this.delays.termDescendantsMs + this.delays.killDescendantsMs, () => {
      void signalDescendants("SIGKILL");
    });
    arm(
      this.delays.termDescendantsMs + this.delays.killDescendantsMs + this.delays.killPiMs,
      () => {
        void (async () => {
          await signalPi();
          if (!run.cancelled) onForceStopped?.();
        })();
      },
    );
  }

  cancel(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (!run) return;
    run.cancelled = true;
    this.runs.delete(sessionId);
    for (const id of run.timers) this.hooks.clearTimeout(id);
  }

  cancelAll(): void {
    for (const sessionId of [...this.runs.keys()]) this.cancel(sessionId);
  }
}
