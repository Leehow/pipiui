/*
 * Shared in-process ownership seam for context optimizers.
 *
 * PipiUI mounts context-fold before manifest extensions. A primary optimizer such as
 * pipiui-headroom claims this well-known Symbol only after it is healthy; context-fold then
 * stays mounted but skips its outgoing rewrite. Any primary failure latches the deterministic
 * fallback for the rest of the session, avoiding repeated prefix rewrites and failback churn.
 *
 * The contract is intentionally structural and dependency-free. Other extensions use the same
 * Symbol without importing context-fold, so either side can be absent without breaking Pi.
 */

export const CONTEXT_OPTIMIZER_STATE_KEY = Symbol.for("pipiui.contextOptimizer.state.v1");
export const CONTEXT_FOLD_FALLBACK_KEY = Symbol.for("pipiui.contextFold.applyFallback.v1");

export const CONTEXT_FOLD_OWNER = "context-fold";

export interface ContextOptimizerStateV1 {
	version: 1;
	sessionId: string;
	primaryOwner?: string;
	fallbackOwner?: string;
	fallbackReason?: string;
	rewriteGate?: {
		usageFraction: number;
		quietDelayMs: number;
		armed: boolean;
		activeTurn: boolean;
		armedAt?: number;
		lastObservedFraction?: number;
	};
}

export type ContextFoldFallbackHandler = (event: unknown, ctx: unknown) => unknown;

const globals = (): Record<string | symbol, unknown> => globalThis as Record<string | symbol, unknown>;

function isState(value: unknown): value is ContextOptimizerStateV1 {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { version?: unknown }).version === 1 &&
		typeof (value as { sessionId?: unknown }).sessionId === "string"
	);
}

export function clearContextOptimizerState(): void {
	delete globals()[CONTEXT_OPTIMIZER_STATE_KEY];
}

export function beginContextOptimizerSession(sessionId: string): ContextOptimizerStateV1 {
	const current = globals()[CONTEXT_OPTIMIZER_STATE_KEY];
	if (isState(current) && current.sessionId === sessionId) return current;
	const next: ContextOptimizerStateV1 = { version: 1, sessionId };
	globals()[CONTEXT_OPTIMIZER_STATE_KEY] = next;
	return next;
}

export function contextOptimizerState(sessionId: string): ContextOptimizerStateV1 | undefined {
	const current = globals()[CONTEXT_OPTIMIZER_STATE_KEY];
	return isState(current) && current.sessionId === sessionId ? current : undefined;
}

export function contextFoldShouldStandby(sessionId: string): boolean {
	const state = contextOptimizerState(sessionId);
	return Boolean(state?.primaryOwner && !state.fallbackOwner);
}

/** Install/update the shared model-visible rewrite gate for this session. */
export function configureContextRewriteGate(
	sessionId: string,
	usageFraction: number,
	quietDelayMs: number,
): void {
	const state = contextOptimizerState(sessionId);
	if (!state) return;
	const current = state.rewriteGate;
	state.rewriteGate = {
		usageFraction,
		quietDelayMs,
		armed: current?.armed ?? false,
		activeTurn: current?.activeTurn ?? false,
		...(current?.armedAt !== undefined ? { armedAt: current.armedAt } : {}),
		...(current?.lastObservedFraction !== undefined
			? { lastObservedFraction: current.lastObservedFraction }
			: {}),
	};
}

export function observeContextRewriteFraction(sessionId: string, fraction: number | undefined): void {
	const gate = contextOptimizerState(sessionId)?.rewriteGate;
	if (!gate) return;
	if (fraction === undefined) delete gate.lastObservedFraction;
	else gate.lastObservedFraction = fraction;
}

/** Four quiet minutes have elapsed while the fresh usage sample still satisfies the threshold. */
export function armContextRewrite(sessionId: string, armedAt: number = Date.now()): void {
	const gate = contextOptimizerState(sessionId)?.rewriteGate;
	if (!gate) return;
	gate.armed = true;
	gate.armedAt = armedAt;
}

/**
	* Open one stable rewrite epoch for the whole agent run. Once opened, every provider call in that
	* run sees the same committed substitutions; a new quiet window is required after it settles.
	*/
export function beginContextRewriteTurn(sessionId: string): void {
	const gate = contextOptimizerState(sessionId)?.rewriteGate;
	if (!gate) return;
	gate.activeTurn = gate.armed;
	gate.armed = false;
	delete gate.armedAt;
}

export function finishContextRewriteTurn(sessionId: string): void {
	const gate = contextOptimizerState(sessionId)?.rewriteGate;
	if (!gate) return;
	gate.activeTurn = false;
}

export function disarmContextRewrite(sessionId: string): void {
	const gate = contextOptimizerState(sessionId)?.rewriteGate;
	if (!gate) return;
	gate.armed = false;
	gate.activeTurn = false;
	delete gate.armedAt;
}

export function contextRewriteIsAllowed(sessionId: string): boolean {
	return contextOptimizerState(sessionId)?.rewriteGate?.activeTurn === true;
}

export function latchContextFoldFallback(sessionId: string, reason: string): boolean {
	const state = contextOptimizerState(sessionId);
	if (!state) return false;
	state.fallbackOwner = CONTEXT_FOLD_OWNER;
	state.fallbackReason = reason;
	delete state.primaryOwner;
	return true;
}

export function registerContextFoldFallback(handler: ContextFoldFallbackHandler): () => void {
	const g = globals();
	g[CONTEXT_FOLD_FALLBACK_KEY] = handler;
	return () => {
		if (g[CONTEXT_FOLD_FALLBACK_KEY] === handler) delete g[CONTEXT_FOLD_FALLBACK_KEY];
	};
}
