/**
 * The packed-guess tell.
 *
 * The retrieval philosophy states the tell in sequential form — *your own second
 * keyword is the tell*. Models do not guess sequentially. They pack the guesses
 * into one alternation and fire once (`retry|recover|classify|failure|failed`),
 * so the stated tell never fires even though the behaviour it describes is the
 * single most common shape of search in the ledger. This module recognises the
 * packed form as well as the sequential one; the grep `tool_result` hook in
 * index.ts appends one line at the moment either holds.
 *
 * Three deliberate limits, because a rule that fires on every qualifying grep is
 * noise and noise is how a correct rule gets tuned out:
 *   - a per-session budget (a nudge is a reminder, not a policy);
 *   - one nudge per distinct pattern;
 *   - silence for the rest of the session once indexed retrieval is actually
 *     used, since the point is to reach a session that never enters the choice.
 *
 * Pure and side-effect free: no clock, no fs, no pi imports. `at` is supplied by
 * the caller so the retry window is testable.
 */

/** Arms beyond which an alternation reads as packed guessing rather than a known pair. */
export const PACKED_ARMS_THRESHOLD = 3;
/** Nudges per session. Ledger replay: ~1.5k lines over 879 sessions at this cap. */
export const DEFAULT_MAX_TELLS_PER_SESSION = 3;
/** Two greps on one path inside this window read as one guess-and-retry loop. */
export const DEFAULT_RETRY_WINDOW_MS = 120_000;
/** Bound on retained per-path / per-pattern state; a long session clears rather than grows. */
const STATE_BOUND = 64;
/** Arms echoed back to the model, when they are clean enough to quote. */
const ARM_ECHO_BOUND = 5;

export type GrepTellKind = "packed" | "retry";

export type GrepTell = {
  kind: GrepTellKind;
  /** Alternation arms in the pattern that triggered it; 1 for a sequential retry. */
  arms: number;
  /** The single line appended to the grep result. */
  line: string;
};

export type GrepCall = {
  pattern?: string;
  path?: string;
  /** True when the caller asked for literal matching, which makes `|` an ordinary character. */
  literal?: boolean;
  /** Epoch ms. Defaults to 0, which disables the retry window rather than inventing a clock. */
  at?: number;
};

/**
 * Split a regex on its top-level alternation.
 *
 * Escapes are consumed in pairs and character classes are skipped, so `\|` and
 * `[a|b]` are not arms. A group alternation (`(a|b)`) splits into `(a` and `b)`:
 * still two guesses, which is what the count is for — the fragments themselves
 * are only echoed when they come out clean.
 */
export function alternationArms(pattern: string): string[] {
  const arms: string[] = [];
  let current = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      current += ch + (pattern[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      current += ch;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      current += ch;
      continue;
    }
    if (ch === "|") {
      arms.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  arms.push(current);
  return arms.map(arm => arm.trim()).filter(arm => arm.length > 0);
}

/** Bare words only: a fragment safe to quote back without showing the model regex debris. */
function echoable(arms: string[]): string[] | undefined {
  if (arms.length === 0 || arms.length > ARM_ECHO_BOUND) return undefined;
  return arms.every(arm => /^[\w.-]+$/.test(arm)) ? arms : undefined;
}

function packedLine(arms: string[]): string {
  const echo = echoable(arms);
  const words = echo ? ` (${echo.join(", ")})` : "";
  return (
    `[code-retrieval] That pattern packs ${arms.length} keyword guesses into one match${words}. ` +
    `Weighing candidate words against each other is the job code_search does — ask it the sentence ` +
    `you were describing and it returns ranked spans instead of every arm's hits mixed together.`
  );
}

function retryLine(): string {
  return (
    `[code-retrieval] Second keyword on the same path inside a minute. ` +
    `That is the guess-and-retry loop code_search replaces — hand it the sentence, not the next synonym.`
  );
}

/**
 * Per-session tell detector. One instance per agent session; `reset()` on
 * session_start, `silence()` once the session uses indexed retrieval.
 */
export class GrepTellBudget {
  private readonly maxPerSession: number;
  private readonly retryWindowMs: number;
  private spent = 0;
  private silenced = false;
  private readonly told = new Set<string>();
  private readonly lastByPath = new Map<string, { pattern: string; at: number }>();

  constructor(options?: { maxPerSession?: number; retryWindowMs?: number }) {
    this.maxPerSession = options?.maxPerSession ?? DEFAULT_MAX_TELLS_PER_SESSION;
    this.retryWindowMs = options?.retryWindowMs ?? DEFAULT_RETRY_WINDOW_MS;
  }

  get remaining(): number {
    return this.silenced ? 0 : Math.max(0, this.maxPerSession - this.spent);
  }

  get muted(): boolean {
    return this.silenced;
  }

  /** The session used indexed retrieval on its own; it is past needing the reminder. */
  silence(): void {
    this.silenced = true;
  }

  reset(): void {
    this.spent = 0;
    this.silenced = false;
    this.told.clear();
    this.lastByPath.clear();
  }

  /**
   * Record a grep and return the tell it triggers, if any. Always records, so
   * the retry window stays honest even while the budget is spent or silenced.
   */
  consider(call: GrepCall): GrepTell | undefined {
    const pattern = typeof call.pattern === "string" ? call.pattern.trim() : "";
    if (pattern.length === 0) return undefined;

    const pathKey = call.path ?? "";
    const at = call.at ?? 0;
    const previous = this.lastByPath.get(pathKey);
    this.remember(pathKey, pattern, at);

    if (this.silenced || this.spent >= this.maxPerSession) return undefined;
    if (this.told.has(pattern)) return undefined;

    // A literal search takes `|` as an ordinary character, so only the
    // sequential form can hold.
    const arms = call.literal === true ? [pattern] : alternationArms(pattern);

    let tell: GrepTell | undefined;
    if (arms.length >= PACKED_ARMS_THRESHOLD) {
      tell = { kind: "packed", arms: arms.length, line: packedLine(arms) };
    } else if (
      previous !== undefined &&
      previous.pattern !== pattern &&
      at > 0 &&
      previous.at > 0 &&
      at - previous.at <= this.retryWindowMs
    ) {
      tell = { kind: "retry", arms: arms.length, line: retryLine() };
    }

    if (tell) {
      this.spent += 1;
      if (this.told.size >= STATE_BOUND) this.told.clear();
      this.told.add(pattern);
    }
    return tell;
  }

  private remember(pathKey: string, pattern: string, at: number): void {
    if (this.lastByPath.size >= STATE_BOUND) this.lastByPath.clear();
    this.lastByPath.set(pathKey, { pattern, at });
  }
}
