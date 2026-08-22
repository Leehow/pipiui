/**
 * Dispatch-idle deterministic fold timer (P2).
 *
 * Boss wait after a worker dispatch is otherwise silent at the model layer: the
 * 30s stall watchdog only does local health checks. Provider prompt-cache TTL is
 * ~5 minutes, so a long wait can re-enter the next turn with an unfolder prefix.
 *
 * This module owns a one-shot setTimeout per session/wave — not the watchdog
 * interval. When it fires with no remaining completion and usage still above a
 * low watermark, it runs the existing deterministic fold API once. Worker
 * completion cancels the pending agent; an empty wave cancels the timer.
 * Session shutdown / extension reload dispose every pending handle.
 */
export const IDLE_FOLD_TTL_MS_DEFAULT = 300_000;
export const IDLE_FOLD_LOW_WATERMARK_DEFAULT = 0.45;
export const IDLE_FOLD_FALLBACK_MS_DEFAULT = 60_000;

export interface IdleFoldConfig {
	enabled: boolean;
	ttlMs: number;
	lowWatermark: number;
	nudge: boolean;
	fallback: boolean;
	fallbackMs: number;
}

export interface IdleFoldUsage {
	tokens?: number | null;
	contextWindow?: number | null;
}

export interface IdleFoldFireInfo {
	key: string;
	agentIds: string[];
}

type IdleFoldTimerHandle = ReturnType<typeof setTimeout>;

export interface IdleFoldRegistryOptions {
	enabled?: boolean;
	ttlMs?: number;
	lowWatermark?: number;
	nudge?: boolean;
	fallback?: boolean;
	fallbackMs?: number;
	schedule?: (callback: () => void, delayMs: number) => IdleFoldTimerHandle;
	cancel?: (handle: IdleFoldTimerHandle) => void;
	isContextAboveWatermark?: () => boolean;
	/** Return false to treat the nudge as failed (immediate fallback if enabled). */
	onNudge?: (info: IdleFoldFireInfo) => boolean | void;
	onFold: (info: IdleFoldFireInfo) => void;
}

export interface IdleFoldRegistry {
	arm(key: string, agentId: string): void;
	noteCompleted(agentId: string): void;
	/** Cancel pending nudge/fallback after a successful fold in this idle epoch. */
	noteFolded(key?: string): void;
	sweepOrphans(aliveAgentIds: ReadonlySet<string>): void;
	dispose(key: string): void;
	disposeAll(): void;
	pendingTimerCount(): number;
	trackedAgentIds(key?: string): string[];
}

interface IdleFoldState {
	key: string;
	agentIds: Set<string>;
	timer: IdleFoldTimerHandle | undefined;
	fired: boolean;
	nudgeSent: boolean;
	folded: boolean;
}

function envFlag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
	const raw = env[name]?.trim().toLowerCase();
	if (!raw) return fallback;
	if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
	if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
	return fallback;
}

function envPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = Number.parseInt(env[name] || "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function envFraction(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const n = Number(env[name]);
	return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

/** Parse PIPIUI_IDLE_FOLD_* knobs. Defaults: enabled, 5 min TTL, 45% watermark, nudge+fallback. */
export function idleFoldConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IdleFoldConfig {
	return {
		enabled: envFlag(env, "PIPIUI_IDLE_FOLD_ENABLED", true),
		ttlMs: envPositiveInt(env, "PIPIUI_IDLE_FOLD_TTL_MS", IDLE_FOLD_TTL_MS_DEFAULT),
		lowWatermark: envFraction(env, "PIPIUI_IDLE_FOLD_LOW_WATERMARK", IDLE_FOLD_LOW_WATERMARK_DEFAULT),
		nudge: envFlag(env, "PIPIUI_IDLE_FOLD_NUDGE", true),
		fallback: envFlag(env, "PIPIUI_IDLE_FOLD_FALLBACK", true),
		fallbackMs: envPositiveInt(env, "PIPIUI_IDLE_FOLD_FALLBACK_MS", IDLE_FOLD_FALLBACK_MS_DEFAULT),
	};
}

/** Conservative: missing or non-positive usage never trips the idle fold. */
export function contextAboveIdleFoldWatermark(
	usage: IdleFoldUsage | null | undefined,
	watermark: number = IDLE_FOLD_LOW_WATERMARK_DEFAULT,
): boolean {
	const tokens = usage?.tokens;
	const contextWindow = usage?.contextWindow;
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return false;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) return false;
	if (!Number.isFinite(watermark) || watermark <= 0) return false;
	return tokens / contextWindow >= watermark;
}

/**
 * One registry per extension instance. Concurrent workers in the same session
 * share one timer (merged wave); different keys stay independent.
 */
export function createIdleFoldRegistry(options: IdleFoldRegistryOptions): IdleFoldRegistry {
	const enabled = options.enabled !== false;
	const ttlMs = options.ttlMs ?? IDLE_FOLD_TTL_MS_DEFAULT;
	const nudgeEnabled = options.nudge === true && typeof options.onNudge === "function";
	const fallbackEnabled = options.fallback !== false;
	const fallbackMs = options.fallbackMs ?? IDLE_FOLD_FALLBACK_MS_DEFAULT;
	const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const cancel = options.cancel ?? clearTimeout;
	const states = new Map<string, IdleFoldState>();

	const clearTimer = (state: IdleFoldState): void => {
		if (state.timer === undefined) return;
		cancel(state.timer);
		state.timer = undefined;
	};

	const dropIfEmpty = (state: IdleFoldState): void => {
		if (state.agentIds.size > 0) return;
		clearTimer(state);
		states.delete(state.key);
	};

	const markFolded = (state: IdleFoldState): void => {
		state.folded = true;
		state.fired = true;
		clearTimer(state);
	};

	const runFold = (state: IdleFoldState, info: IdleFoldFireInfo): void => {
		if (state.folded) return;
		state.folded = true;
		options.onFold(info);
	};

	const fire = (key: string): void => {
		const state = states.get(key);
		if (!state || state.fired || state.folded) return;
		state.timer = undefined;
		if (state.agentIds.size === 0) {
			states.delete(key);
			return;
		}
		// One idle epoch: at most one nudge. Deterministic fold is a same-epoch
		// fallback only when that nudge is not answered with a successful fold.
		state.fired = true;
		if (options.isContextAboveWatermark && !options.isContextAboveWatermark()) return;
		const info: IdleFoldFireInfo = { key, agentIds: [...state.agentIds] };
		if (nudgeEnabled && options.onNudge) {
			state.nudgeSent = true;
			let nudged = false;
			try {
				nudged = options.onNudge(info) !== false;
			} catch {
				nudged = false;
			}
			if (!fallbackEnabled) return;
			if (!nudged) {
				runFold(state, info);
				return;
			}
			if (fallbackMs <= 0) return;
			const timer = schedule(() => {
				const current = states.get(key);
				if (!current || current.agentIds.size === 0 || current.folded) return;
				current.timer = undefined;
				runFold(current, { key, agentIds: [...current.agentIds] });
			}, fallbackMs);
			(timer as { unref?: () => void }).unref?.();
			state.timer = timer;
			return;
		}
		runFold(state, info);
	};

	return {
		arm(key, agentId) {
			if (!enabled || !key || !agentId) return;
			let state = states.get(key);
			if (!state) {
				state = { key, agentIds: new Set(), timer: undefined, fired: false, nudgeSent: false, folded: false };
				states.set(key, state);
			}
			state.agentIds.add(agentId);
			// Merge: later workers join the same wait. Do not reset TTL, and do not
			// re-arm after this epoch has already folded once.
			if (state.fired || state.timer !== undefined) return;
			const timer = schedule(() => fire(key), ttlMs);
			(timer as { unref?: () => void }).unref?.();
			state.timer = timer;
		},
		noteCompleted(agentId) {
			if (!agentId) return;
			for (const state of [...states.values()]) {
				if (!state.agentIds.delete(agentId)) continue;
				dropIfEmpty(state);
			}
		},
		noteFolded(key) {
			if (key !== undefined) {
				const state = states.get(key);
				if (state) markFolded(state);
				return;
			}
			for (const state of states.values()) markFolded(state);
		},
		sweepOrphans(aliveAgentIds) {
			for (const state of [...states.values()]) {
				for (const agentId of [...state.agentIds]) {
					if (!aliveAgentIds.has(agentId)) state.agentIds.delete(agentId);
				}
				dropIfEmpty(state);
			}
		},
		dispose(key) {
			const state = states.get(key);
			if (!state) return;
			clearTimer(state);
			states.delete(key);
		},
		disposeAll() {
			for (const state of states.values()) clearTimer(state);
			states.clear();
		},
		pendingTimerCount() {
			let count = 0;
			for (const state of states.values()) if (state.timer !== undefined) count += 1;
			return count;
		},
		trackedAgentIds(key) {
			if (key !== undefined) return [...(states.get(key)?.agentIds ?? [])];
			const ids: string[] = [];
			for (const state of states.values()) ids.push(...state.agentIds);
			return ids;
		},
	};
}

export interface DeterministicIdleFoldResult {
	folded: boolean;
	messages: unknown[];
}

/** Live context-fold engine may register here so idle fold shares session frozen layers. */
export const IDLE_FOLD_ENGINE_KEY = Symbol.for("pipiui.contextFold.runDeterministic");

type IdleFoldEngineFn = (input: {
	messages: readonly unknown[];
	tokens?: number | null;
	contextWindow?: number | null;
}) => DeterministicIdleFoldResult | Promise<DeterministicIdleFoldResult>;

/**
 * Existing fold API: FoldLadderPolicy + ContextFoldEngine.process.
 * No LLM summary, no nudge. Prefer a live-engine runner when context-fold registered
 * one; otherwise load the same classes the context hook uses.
 */
export async function runDeterministicIdleFold(input: {
	messages: readonly unknown[];
	tokens?: number | null;
	contextWindow?: number | null;
}): Promise<DeterministicIdleFoldResult> {
	const registered = (globalThis as Record<string | symbol, unknown>)[IDLE_FOLD_ENGINE_KEY];
	if (typeof registered === "function") {
		return await (registered as IdleFoldEngineFn)(input);
	}
	const [{ ContextFoldEngine }, { FoldLadderPolicy }, { adapterConfigFromEnv, configFromEnv }] = await Promise.all([
		import("../packages/context-fold/src/adapters/pi/store.ts"),
		import("../packages/context-fold/src/core/policy/fold-ladder.ts"),
		import("../packages/context-fold/src/adapters/pi/config.ts"),
	]);
	const engine = new ContextFoldEngine(new FoldLadderPolicy(adapterConfigFromEnv().ladder), configFromEnv());
	const messages = engine.process(input.messages as never, {
		contextWindow: input.contextWindow ?? null,
		tokens: input.tokens ?? null,
	});
	return { folded: messages !== input.messages, messages };
}
