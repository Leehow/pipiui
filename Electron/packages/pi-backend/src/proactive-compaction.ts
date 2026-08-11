/**
 * Opportunistic main-session compaction for the Electron host.
 *
 * Port of Swift `ProactiveCompactionPolicy` (Sources/PipiUI/ProactiveCompactionPolicy.swift)
 * plus the scheduling half that lives in `ChatSession`. Same reason to exist:
 * pi only checks its own threshold (`contextWindow - 16384`) at `agent_end` and
 * immediately before a prompt is submitted, so a session can idle far above the
 * line and a long tool loop can run hundreds of steps past it. This starts a
 * bounded compaction earlier, while the session is genuinely quiet.
 *
 * `ProactiveCompactionPolicy` deliberately knows nothing about RPCs or session
 * events — it only consumes fresh context-usage observations. The scheduler owns
 * timers and the compact request, and takes every live gate as an injected
 * predicate so the host keeps ownership of what "idle" means.
 */

export interface ProactiveCompactionConfiguration {
  /** Start compacting before pi's hard overflow path. Fractions, not percents. */
  highWatermark: number;
  /** A successful compaction stays disarmed until a newer usage report is below this. */
  lowWatermark: number;
  /** Require a short truly-idle interval before making the RPC. */
  quietDelayMs: number;
  /** Avoid repeatedly retrying an unsuccessful compaction while context stays high. */
  failureBackoffMs: number;
}

export const STANDARD_PROACTIVE_COMPACTION: ProactiveCompactionConfiguration =
  Object.freeze({
    highWatermark: 0.8,
    lowWatermark: 0.6,
    quietDelayMs: 2_000,
    failureBackoffMs: 60_000,
  });

/** A single fresh context report. `percent` keeps pi/UI's 0…100 convention. */
export interface ContextUsageLike {
  tokens?: number | null;
  contextWindow?: number | null;
  percent?: number | null;
}

/**
 * Occupancy as a 0…n fraction, or undefined when the report carries no usable
 * number. Tokens over the window win over `percent` and are deliberately not
 * clamped: a model switch can legitimately put a session above 100%.
 */
export function contextUsageFraction(
  usage: ContextUsageLike | null | undefined,
): number | undefined {
  if (!usage) return undefined;
  const { tokens, contextWindow, percent } = usage;
  if (
    typeof tokens === "number" &&
    typeof contextWindow === "number" &&
    Number.isFinite(tokens) &&
    Number.isFinite(contextWindow) &&
    tokens >= 0 &&
    contextWindow > 0
  ) {
    return tokens / contextWindow;
  }
  if (
    typeof percent === "number" &&
    Number.isFinite(percent) &&
    percent >= 0 &&
    percent <= 100
  ) {
    return percent / 100;
  }
  return undefined;
}

export class ProactiveCompactionPolicy {
  readonly configuration: ProactiveCompactionConfiguration;
  private usage?: ContextUsageLike;
  /** A success cannot re-arm from a pre-compaction/stale stats response. */
  private requiredGeneration?: number;
  private backoffUntil?: number;

  constructor(
    configuration: ProactiveCompactionConfiguration = STANDARD_PROACTIVE_COMPACTION,
  ) {
    this.configuration = configuration;
  }

  get latestUsage(): ContextUsageLike | undefined {
    return this.usage;
  }
  get isArmed(): boolean {
    return this.requiredGeneration === undefined;
  }

  /**
   * Records a stats response that was issued with `requestGeneration`.
   * Invalid/absent usage intentionally clears the scheduling sample but never
   * re-arms — right after a compaction pi reports null tokens, and that must
   * not be mistaken for "context is low again".
   */
  observeFreshUsage(
    usage: ContextUsageLike | undefined,
    requestGeneration: number,
  ): void {
    this.usage = usage;
    if (this.requiredGeneration === undefined) return;
    if (requestGeneration <= this.requiredGeneration) return;
    const fraction = contextUsageFraction(usage);
    if (fraction === undefined) return;
    if (fraction >= this.configuration.lowWatermark) return;
    this.requiredGeneration = undefined;
  }

  /**
   * Earliest delay (ms) at which a quiet-period timer may be armed. `undefined`
   * means the policy is disarmed or context sits below the high watermark.
   */
  nextSchedulingDelay(now: number): number | undefined {
    if (!this.isArmed) return undefined;
    const fraction = contextUsageFraction(this.usage);
    if (fraction === undefined) return undefined;
    if (fraction < this.configuration.highWatermark) return undefined;
    const backoff =
      this.backoffUntil === undefined ? 0 : Math.max(0, this.backoffUntil - now);
    return Math.max(this.configuration.quietDelayMs, backoff);
  }

  /** Suppress further proactive compactions until a post-success low report. */
  recordCompactionSuccess(requiringUsageRequestAfter: number): void {
    this.requiredGeneration = requiringUsageRequestAfter;
    this.backoffUntil = undefined;
  }

  recordCompactionFailure(now: number): void {
    this.backoffUntil = now + this.configuration.failureBackoffMs;
  }
}

export interface ProactiveCompactionSchedulerOptions {
  /**
   * Every live gate the host owns: process alive, no turn running, nothing
   * queued. Re-checked both when arming and when the timer fires — the timer is
   * only a hint.
   */
  isIdle: () => boolean;
  /** Issues the `compact` RPC. Must reject when pi refuses the request. */
  compact: () => Promise<unknown>;
  configuration?: ProactiveCompactionConfiguration;
  /** Timer/clock seams; tests drive these instead of waiting on wall clock. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

/**
 * Per-session scheduler. Mirrors `ChatSession`'s half: a cancellable quiet-period
 * timer that never aborts an already-started compaction, plus the in-flight
 * bookkeeping that keeps a second compact from stacking on the first.
 */
export class ProactiveCompactionScheduler {
  private readonly options: ProactiveCompactionSchedulerOptions;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;
  private policy: ProactiveCompactionPolicy;
  private timer?: unknown;
  private token = 0;
  private generation = 0;
  /** True from the proactive `compact` dispatch until its lifecycle settles. */
  private rpcInFlight = false;
  /** True between `compaction_start` and `compaction_end`, whoever started it. */
  private compacting = false;
  private disposed = false;

  constructor(options: ProactiveCompactionSchedulerOptions) {
    this.options = options;
    this.setTimer =
      options.setTimer ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        (handle as { unref?: () => void }).unref?.();
        return handle;
      });
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as never));
    this.now = options.now ?? (() => Date.now());
    this.policy = new ProactiveCompactionPolicy(options.configuration);
  }

  /** True while any compaction is running or settling (own RPC or pi's own). */
  get isCompacting(): boolean {
    return this.compacting || this.rpcInFlight;
  }

  /** Issue order lets a post-compaction policy reject callbacks from older stats RPCs. */
  beginUsageRequest(): number {
    this.generation += 1;
    return this.generation;
  }

  observeUsage(
    usage: ContextUsageLike | undefined,
    requestGeneration: number,
  ): void {
    this.policy.observeFreshUsage(usage, requestGeneration);
    this.reconsider();
  }

  /** Recheck all live state; arms, re-arms, or cancels the quiet-period timer. */
  reconsider(): void {
    if (this.disposed) return;
    if (this.isCompacting || !this.options.isIdle()) {
      this.cancel();
      return;
    }
    const delay = this.policy.nextSchedulingDelay(this.now());
    if (delay === undefined) {
      this.cancel();
      return;
    }
    if (this.timer !== undefined) return;
    this.token += 1;
    const token = this.token;
    this.timer = this.setTimer(() => {
      if (this.disposed || token !== this.token) return;
      this.timer = undefined;
      this.fire();
    }, delay);
  }

  cancel(): void {
    this.token += 1;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** `compaction_start` from pi — manual, overflow, threshold, or ours. */
  compactionStarted(): void {
    this.cancel();
    this.compacting = true;
  }

  /**
   * Any completed compaction invalidates the old high sample; only a newer
   * explicitly low report can re-arm.
   */
  compactionFinished(success: boolean): void {
    this.compacting = false;
    this.rpcInFlight = false;
    if (success) this.policy.recordCompactionSuccess(this.generation);
    else this.policy.recordCompactionFailure(this.now());
    this.reconsider();
  }

  /**
   * Final authority when a compact lifecycle omitted its end event: a settled
   * turn must never leave the scheduler wedged as "still compacting".
   */
  settleTurn(): void {
    if (this.isCompacting) this.compactionFinished(true);
    else this.reconsider();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private fire(): void {
    if (this.isCompacting || !this.options.isIdle()) return;
    if (this.policy.nextSchedulingDelay(this.now()) === undefined) return;
    this.rpcInFlight = true;
    void Promise.resolve()
      .then(() => this.options.compact())
      .then(
        () => this.requestCompleted(),
        () => this.requestFailed(),
      );
  }

  /** pi answers only after the compaction finished; the events normally settle first. */
  private requestCompleted(): void {
    if (!this.rpcInFlight) return;
    this.compactionFinished(true);
  }

  private requestFailed(): void {
    if (!this.rpcInFlight) return;
    this.compactionFinished(false);
  }
}
