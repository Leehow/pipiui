/**
 * Opportunistic main-session compaction for the Electron host.
 *
 * Port of the retired Swift app's `ProactiveCompactionPolicy`
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
  /** Lower watermark used only while the quiet Boss still has live subagents. */
  waitWatermark?: number;
  /** Longer quiet interval for the live-subagent waiting path. */
  waitQuietDelayMs?: number;
}

export const STANDARD_PROACTIVE_COMPACTION = Object.freeze({
  highWatermark: 0.8,
  lowWatermark: 0.6,
  quietDelayMs: 2_000,
  failureBackoffMs: 60_000,
  waitWatermark: 0.5,
  waitQuietDelayMs: 30_000,
});

type ResolvedProactiveCompactionConfiguration = Required<ProactiveCompactionConfiguration>;

type ProactiveCompactionMode = "ordinary" | "wait-for-subagents";

interface ProactiveCompactionSchedulingPlan {
  mode: ProactiveCompactionMode;
  delayMs: number;
}

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
  readonly configuration: Readonly<ResolvedProactiveCompactionConfiguration>;
  private usage?: ContextUsageLike;
  /** A success cannot re-arm from a pre-compaction/stale stats response. */
  private requiredGeneration?: number;
  private backoffUntil?: number;

  constructor(
    configuration: ProactiveCompactionConfiguration = STANDARD_PROACTIVE_COMPACTION,
  ) {
    this.configuration = Object.freeze({
      highWatermark: configuration.highWatermark,
      lowWatermark: configuration.lowWatermark,
      quietDelayMs: configuration.quietDelayMs,
      failureBackoffMs: configuration.failureBackoffMs,
      waitWatermark:
        configuration.waitWatermark ?? STANDARD_PROACTIVE_COMPACTION.waitWatermark,
      waitQuietDelayMs:
        configuration.waitQuietDelayMs ?? STANDARD_PROACTIVE_COMPACTION.waitQuietDelayMs,
    });
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
    return this.nextSchedulingPlan(now, false)?.delayMs;
  }

  /** Select the ordinary fast path first, then the structured live-subagent wait path. */
  nextSchedulingPlan(
    now: number,
    allowWaitForSubagents: boolean,
  ): ProactiveCompactionSchedulingPlan | undefined {
    if (!this.isArmed) return undefined;
    const fraction = contextUsageFraction(this.usage);
    if (fraction === undefined) return undefined;
    const mode: ProactiveCompactionMode | undefined =
      fraction >= this.configuration.highWatermark
        ? "ordinary"
        : allowWaitForSubagents && fraction >= this.configuration.waitWatermark
          ? "wait-for-subagents"
          : undefined;
    if (!mode) return undefined;
    const backoff =
      this.backoffUntil === undefined ? 0 : Math.max(0, this.backoffUntil - now);
    const quietDelay = mode === "ordinary"
      ? this.configuration.quietDelayMs
      : this.configuration.waitQuietDelayMs;
    return { mode, delayMs: Math.max(quietDelay, backoff) };
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
  /** Exact host projection; never inferred from assistant text or cache state. */
  hasLiveAgents?: () => boolean;
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
  private timerMode?: ProactiveCompactionMode;
  private timerWave?: number;
  private token = 0;
  private generation = 0;
  /** True from the proactive `compact` dispatch until its lifecycle settles. */
  private rpcInFlight = false;
  /** True between `compaction_start` and `compaction_end`, whoever started it. */
  private compacting = false;
  /** Mode/wave of the proactive RPC, retained across pi compaction lifecycle events. */
  private requestMode?: ProactiveCompactionMode;
  private requestWave?: number;
  private liveAgentWaveActive = false;
  private liveAgentWave = 0;
  /** A successful wait compact is allowed once per continuous live-agent wave. */
  private waitCompactedInWave = false;
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

  /** Host agent projection changed; terminal/new-wave transitions must not wait for new stats. */
  liveAgentStateChanged(): void {
    this.reconsider();
  }

  /** Recheck all live state; arms, re-arms, or cancels the quiet-period timer. */
  reconsider(): void {
    if (this.disposed) return;
    const hasLiveAgents = this.syncLiveAgentWave();
    if (this.isCompacting || !this.options.isIdle()) {
      this.cancel();
      return;
    }
    const plan = this.policy.nextSchedulingPlan(
      this.now(),
      hasLiveAgents && !this.waitCompactedInWave,
    );
    if (!plan) {
      this.cancel();
      return;
    }
    const wave = plan.mode === "wait-for-subagents" ? this.liveAgentWave : undefined;
    if (this.timer !== undefined && this.timerMode === plan.mode && this.timerWave === wave) return;
    this.cancel();
    this.token += 1;
    const token = this.token;
    this.timerMode = plan.mode;
    this.timerWave = wave;
    this.timer = this.setTimer(() => {
      if (this.disposed || token !== this.token) return;
      this.timer = undefined;
      this.timerMode = undefined;
      this.timerWave = undefined;
      this.fire(plan.mode, wave);
    }, plan.delayMs);
  }

  cancel(): void {
    this.token += 1;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.timerMode = undefined;
    this.timerWave = undefined;
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
    const requestMode = this.requestMode;
    const requestWave = this.requestWave;
    this.compacting = false;
    this.rpcInFlight = false;
    this.requestMode = undefined;
    this.requestWave = undefined;
    const hasLiveAgents = this.syncLiveAgentWave();
    if (
      success &&
      requestMode === "wait-for-subagents" &&
      hasLiveAgents &&
      requestWave === this.liveAgentWave
    ) {
      this.waitCompactedInWave = true;
    }
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

  private fire(mode: ProactiveCompactionMode, wave?: number): void {
    if (this.isCompacting || !this.options.isIdle()) return;
    const hasLiveAgents = this.syncLiveAgentWave();
    const plan = this.policy.nextSchedulingPlan(
      this.now(),
      hasLiveAgents && !this.waitCompactedInWave,
    );
    if (!plan || plan.mode !== mode) {
      this.reconsider();
      return;
    }
    if (mode === "wait-for-subagents" && wave !== this.liveAgentWave) {
      this.reconsider();
      return;
    }
    this.rpcInFlight = true;
    this.requestMode = mode;
    this.requestWave = wave;
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

  /** Sample the exact host projection and advance/reset the continuous-wave latch. */
  private syncLiveAgentWave(): boolean {
    const hasLiveAgents = this.options.hasLiveAgents?.() === true;
    if (hasLiveAgents !== this.liveAgentWaveActive) {
      this.liveAgentWaveActive = hasLiveAgents;
      if (hasLiveAgents) this.liveAgentWave += 1;
      else this.waitCompactedInWave = false;
    }
    return hasLiveAgents;
  }
}
