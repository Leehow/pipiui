/**
 * Auto-compaction idle policy + follow-up/heartbeat guard (PipiUI).
 *
 * POLICY (user-mandated, AND semantics)
 * -------------------------------------
 * A non-urgent automatic compaction may run ONLY when ALL hold:
 *   A) context usage >= 45% of the model window, and
 *   B) absolute tokens >= 200_000, and
 *   C) the session has been continuously idle for >= 4 minutes.
 * Busy periods (user/extension prompt, tool loop provider requests,
 * subagent-driven turns) reset the idle clock, so no ordinary
 * threshold/proactive compaction may run while the session is busy.
 *
 * Exemptions (always allowed, even while busy):
 *   - `overflow`: real provider context-overflow recovery.
 *   - Near-overflow / model-safety line: `tokens > contextWindow -
 *     reserveTokens` (pi default 16384). This is the same line pi's own
 *     `shouldCompact` and the mid-turn guard use; compaction there protects
 *     the next provider request, not context hygiene.
 *   - Manual `/compact` never routes through `_runAutoCompaction` and is not
 *     gated anywhere in this module.
 *
 * GENUINELY IDLE normal compaction is owned by the idle-fold timer (boss
 * waves, 45% watermark + 4-minute TTL, activity re-arms; no 200k floor) and
 * by the host ProactiveCompactionScheduler (45% + 200k tokens + 4-minute
 * continuous quiet). This module's 45%+200k+idle branch is defense-in-depth:
 * any threshold call that fires BELOW the near-overflow line must satisfy it.
 *
 * WRAPS (same mechanism as mid-turn-compaction.ts)
 * ------------------------------------------------
 *   - `prompt` notes session activity (any source) and, for
 *     `source === "extension"` turns, gates `_runAutoCompaction` for the
 *     whole turn — covers native pre-prompt checks *and* mid-turn's official
 *     `_runAutoCompaction` call during heartbeat-driven turns.
 *   - `_checkCompaction` is gated on EVERY turn (pre-prompt and post-
 *     agent_end, user/RPC/extension alike): a "threshold" decision below the
 *     near-overflow line is vetoed unless 45% + 200k tokens + 4-minute idle hold.
 *
 * node_modules is not patched; fetch-pi-runtime cannot overwrite this wrap.
 */

const INSTALLED = Symbol.for("pipiui.followUpCompaction.installed");
const EXTENSION_TURN = Symbol.for("pipiui.followUpCompaction.extensionTurn");
const LAST_ACTIVITY = Symbol.for("pipiui.autoCompaction.lastActivityMs");

const LOG_PREFIX = "[pipiui-follow-up-compaction]";

/** Policy A: usage fraction at or above this enables normal auto-compaction. */
export const AUTO_COMPACTION_USAGE_FRACTION_DEFAULT = 0.45;
/** Policy B: continuous idle required for normal auto-compaction. */
export const AUTO_COMPACTION_IDLE_MS_DEFAULT = 4 * 60 * 1000;
/** pi default compaction reserve; the near-overflow/model-safety line. */
export const AUTO_COMPACTION_RESERVE_TOKENS_DEFAULT = 16_384;
/** Absolute token floor for non-urgent auto-compaction. 200k-window models almost never trip this. */
export const PROACTIVE_COMPACTION_MIN_TOKENS = 200_000;

export type FollowUpUsageLike = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	[key: string]: unknown;
};

export type FollowUpAssistantLike = {
	role?: string;
	stopReason?: string;
	usage?: FollowUpUsageLike;
	errorMessage?: string;
	[key: string]: unknown;
};

export type FollowUpCompactionSettings = {
	enabled?: boolean;
	reserveTokens?: number;
	[key: string]: unknown;
};

export type FollowUpSession = {
	model?: { contextWindow?: number } | null;
	settingsManager?: {
		getCompactionSettings?: () => FollowUpCompactionSettings | undefined;
	};
	agent?: { state?: { messages?: FollowUpAssistantLike[] } };
	_runAutoCompaction?: (reason: string, willRetry: boolean) => Promise<unknown>;
	_checkCompaction?: (
		assistantMessage: FollowUpAssistantLike,
		skipAbortedCheck?: boolean,
	) => Promise<unknown>;
	prompt?: (text: string, options?: { source?: string }) => unknown;
	[EXTENSION_TURN]?: boolean;
	[LAST_ACTIVITY]?: number;
	[key: symbol]: unknown;
};

export type FollowUpSessionCtor = {
	prototype: object;
};

/**
 * Native `calculateContextTokens`: prefer totalTokens, else sum components.
 */
export function contextTokensFromUsage(usage?: FollowUpUsageLike | null): number {
	if (!usage || typeof usage !== "object") return 0;
	if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) return usage.totalTokens;
	const input = typeof usage.input === "number" ? usage.input : 0;
	const output = typeof usage.output === "number" ? usage.output : 0;
	const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
	const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
	return input + output + cacheRead + cacheWrite;
}

/** Hard overflow: tokens have reached or passed the model window. */
export function isHardContextOverflow(tokens: number, contextWindow: number): boolean {
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return false;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return false;
	}
	return tokens >= contextWindow;
}

/**
 * Near-overflow / model-safety line: pi's own `shouldCompact` reserve
 * (`tokens > contextWindow - reserveTokens`). Compaction at or beyond this
 * line protects the next provider request and stays allowed while busy.
 */
export function isNearContextOverflow(
	tokens: number,
	contextWindow: number,
	reserveTokens: number = AUTO_COMPACTION_RESERVE_TOKENS_DEFAULT,
): boolean {
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return false;
	if (
		typeof contextWindow !== "number" ||
		!Number.isFinite(contextWindow) ||
		contextWindow <= 0
	) {
		return false;
	}
	if (!Number.isFinite(reserveTokens) || reserveTokens < 0) return false;
	return tokens > contextWindow - reserveTokens;
}

/**
 * The unified auto-compaction gate.
 *
 * - `overflow` (real provider context-overflow recovery): always allowed.
 * - `threshold`: allowed when near-overflow (model safety, busy included), or
 *   when usage >= 45% AND tokens >= 200_000 AND `idleMs` >= 4 minutes of
 *   continuous idleness.
 * - Any other reason (manual never routes here; unknown future reasons stay
 *   permissive): allowed.
 */
export function shouldAllowAutoCompaction(args: {
	reason: string;
	tokens: number;
	contextWindow: number;
	idleMs?: number;
	reserveTokens?: number;
	usageFraction?: number;
	idleThresholdMs?: number;
}): boolean {
	if (args.reason === "overflow") return true;
	if (args.reason !== "threshold") return true;
	if (isNearContextOverflow(args.tokens, args.contextWindow, args.reserveTokens)) return true;
	const fraction = args.usageFraction ?? AUTO_COMPACTION_USAGE_FRACTION_DEFAULT;
	const idleThresholdMs = args.idleThresholdMs ?? AUTO_COMPACTION_IDLE_MS_DEFAULT;
	if (typeof args.contextWindow !== "number" || !Number.isFinite(args.contextWindow) || args.contextWindow <= 0) {
		return false;
	}
	if (!Number.isFinite(fraction) || fraction <= 0) return false;
	if (typeof args.idleMs !== "number" || !Number.isFinite(args.idleMs)) return false;
	if (args.tokens / args.contextWindow < fraction) return false;
	if (args.tokens < PROACTIVE_COMPACTION_MIN_TOKENS) return false;
	if (args.idleMs < idleThresholdMs) return false;
	return true;
}

/** Note session activity (a prompt or a provider request) on the idle clock. */
export function noteAutoCompactionActivity(session: FollowUpSession, atMs: number = Date.now()): void {
	session[LAST_ACTIVITY] = atMs;
}

/** Continuous-idle milliseconds since the last noted activity, else undefined. */
export function autoCompactionIdleMs(session: FollowUpSession, now: number = Date.now()): number | undefined {
	const last = session[LAST_ACTIVITY];
	if (typeof last !== "number" || !Number.isFinite(last)) return undefined;
	return Math.max(0, now - last);
}

function compactionReserveTokens(session: FollowUpSession): number {
	try {
		const reserve = session.settingsManager?.getCompactionSettings?.()?.reserveTokens;
		if (typeof reserve === "number" && Number.isFinite(reserve) && reserve >= 0) return reserve;
	} catch {
		// fall through to the default
	}
	return AUTO_COMPACTION_RESERVE_TOKENS_DEFAULT;
}

function lastValidContextTokens(
	session: FollowUpSession,
	assistantMessage: FollowUpAssistantLike | undefined,
): number {
	const direct = contextTokensFromUsage(assistantMessage?.usage);
	const stop = assistantMessage?.stopReason;
	if (direct > 0 && stop !== "error" && stop !== "aborted") return direct;
	const messages = session.agent?.state?.messages;
	if (!Array.isArray(messages)) return direct;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || msg.role !== "assistant") continue;
		if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;
		const tokens = contextTokensFromUsage(msg.usage);
		if (tokens > 0) return tokens;
	}
	return direct;
}

function wrapPrototypeMethod(
	proto: Record<PropertyKey, unknown>,
	name: string,
	createWrapper: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
): boolean {
	const original = proto[name];
	if (typeof original !== "function") return false;
	proto[name] = createWrapper(original as (...args: unknown[]) => unknown);
	return true;
}

function restoreAfter(result: unknown, restore: () => void): unknown {
	if (result != null && typeof (result as { then?: unknown }).then === "function") {
		return Promise.resolve(result).finally(restore);
	}
	restore();
	return result;
}

/** Gate `_runAutoCompaction` with the unified policy for the whole turn. */
function gateThresholdAutoCompaction(session: FollowUpSession): () => void {
	const origRun = session._runAutoCompaction;
	if (typeof origRun !== "function") return () => {};
	session._runAutoCompaction = async (reason: string, willRetry: boolean) => {
		const contextWindow = session.model?.contextWindow ?? 0;
		const tokens = lastValidContextTokens(session, undefined);
		if (
			!shouldAllowAutoCompaction({
				reason,
				tokens,
				contextWindow,
				idleMs: autoCompactionIdleMs(session),
				reserveTokens: compactionReserveTokens(session),
			})
		) {
			return false;
		}
		return origRun.call(session, reason, willRetry);
	};
	return () => {
		session._runAutoCompaction = origRun;
	};
}

/**
 * Patch `AgentSession.prototype` once. Returns whether this call applied the patch.
 */
export function installFollowUpCompactionGuard(sessionClass?: FollowUpSessionCtor): boolean {
	const proto = sessionClass?.prototype;
	if (!proto || (typeof proto !== "object" && typeof proto !== "function")) return false;
	const record = proto as Record<PropertyKey, unknown>;
	if (record[INSTALLED]) return false;

	const wrappedPrompt = wrapPrototypeMethod(record, "prompt", (original) => {
		return function wrappedPrompt(this: FollowUpSession, ...args: unknown[]) {
			// Any prompt — user, RPC, or extension-injected — is session
			// activity and restarts the 4-minute idle window.
			noteAutoCompactionActivity(this);
			const options = args[1] as { source?: string } | undefined;
			const prev = this[EXTENSION_TURN];
			const restoreFns: Array<() => void> = [
				() => {
					this[EXTENSION_TURN] = prev;
				},
			];
			if (options?.source === "extension") {
				this[EXTENSION_TURN] = true;
				restoreFns.push(gateThresholdAutoCompaction(this));
			}
			const restore = () => {
				for (let i = restoreFns.length - 1; i >= 0; i--) restoreFns[i]?.();
			};
			try {
				return restoreAfter(original.apply(this, args), restore);
			} catch (error) {
				restore();
				throw error;
			}
		};
	});

	const wrappedCheck = wrapPrototypeMethod(record, "_checkCompaction", (original) => {
		return function wrappedCheckCompaction(this: FollowUpSession, ...args: unknown[]) {
			// Gate every `_checkCompaction` call — pre-prompt and
			// post-agent_end, on user/RPC turns as well as extension turns.
			// A threshold decision is vetoed unless it is near-overflow or the
			// 45% + 200k + 4-minute-idle policy holds; overflow always passes.
			const origRun = this._runAutoCompaction;
			if (typeof origRun !== "function") return original.apply(this, args);

			const assistantMessage = args[0] as FollowUpAssistantLike | undefined;
			const contextWindow = this.model?.contextWindow ?? 0;
			const tokens = lastValidContextTokens(this, assistantMessage);
			this._runAutoCompaction = async (reason: string, willRetry: boolean) => {
				if (
					!shouldAllowAutoCompaction({
						reason,
						tokens,
						contextWindow,
						idleMs: autoCompactionIdleMs(this),
						reserveTokens: compactionReserveTokens(this),
					})
				) {
					return false;
				}
				return origRun.call(this, reason, willRetry);
			};
			const restore = () => {
				this._runAutoCompaction = origRun;
			};
			try {
				return restoreAfter(original.apply(this, args), restore);
			} catch (error) {
				restore();
				throw error;
			}
		};
	});

	if (!wrappedPrompt || !wrappedCheck) {
		console.error(
			`${LOG_PREFIX} prompt/_checkCompaction missing on prototype; guard not installed`,
		);
		return false;
	}

	record[INSTALLED] = true;
	return true;
}

/**
 * Extension entry: patch `AgentSession.prototype` once.
 *
 * Must receive the live class from an ESM import (same constraint as
 * mid-turn-compaction.ts). Never edits node_modules / fetch-pi-runtime.
 */
export function registerFollowUpCompactionGuard(sessionClass?: FollowUpSessionCtor): void {
	try {
		if (!sessionClass) {
			console.error(`${LOG_PREFIX} AgentSession not found; follow-up guard not installed`);
			return;
		}
		installFollowUpCompactionGuard(sessionClass);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} install failed: ${message}`);
	}
}

/** Test helper: is this session currently marked as an extension-injected turn? */
export function isExtensionInjectedTurn(session: FollowUpSession): boolean {
	return session[EXTENSION_TURN] === true;
}

/** Test helper: force the extension-turn mark without going through `prompt`. */
export function markExtensionInjectedTurn(session: FollowUpSession, marked: boolean): void {
	session[EXTENSION_TURN] = marked;
}
