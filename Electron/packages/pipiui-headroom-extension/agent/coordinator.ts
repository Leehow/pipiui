export const CONTEXT_OPTIMIZER_STATE_KEY = Symbol.for("pipiui.contextOptimizer.state.v1");
export const CONTEXT_FOLD_FALLBACK_KEY = Symbol.for("pipiui.contextFold.applyFallback.v1");
export const HEADROOM_OWNER = "pipiui-headroom";

interface ContextOptimizerStateV1 {
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

const globals = (): Record<string | symbol, unknown> => globalThis as Record<string | symbol, unknown>;

function isState(value: unknown): value is ContextOptimizerStateV1 {
  return typeof value === "object" && value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { sessionId?: unknown }).sessionId === "string";
}

export function beginSession(sessionId: string): ContextOptimizerStateV1 {
  const current = globals()[CONTEXT_OPTIMIZER_STATE_KEY];
  if (isState(current) && current.sessionId === sessionId) return current;
  const next: ContextOptimizerStateV1 = { version: 1, sessionId };
  globals()[CONTEXT_OPTIMIZER_STATE_KEY] = next;
  return next;
}

function stateFor(sessionId: string): ContextOptimizerStateV1 | undefined {
  const current = globals()[CONTEXT_OPTIMIZER_STATE_KEY];
  return isState(current) && current.sessionId === sessionId ? current : undefined;
}

export function acquireHeadroomPrimary(sessionId: string): boolean {
  const state = stateFor(sessionId);
  if (!state || state.fallbackOwner || (state.primaryOwner && state.primaryOwner !== HEADROOM_OWNER)) return false;
  state.primaryOwner = HEADROOM_OWNER;
  return true;
}

export function releaseHeadroomPrimary(sessionId: string): void {
  const state = stateFor(sessionId);
  if (state?.primaryOwner === HEADROOM_OWNER) delete state.primaryOwner;
}

export function headroomOwnsPrimary(sessionId: string): boolean {
  const state = stateFor(sessionId);
  return state?.primaryOwner === HEADROOM_OWNER && !state.fallbackOwner;
}

export function contextRewriteIsAllowed(sessionId: string): boolean {
  return stateFor(sessionId)?.rewriteGate?.activeTurn === true;
}

export function contextRewriteGateSnapshot(sessionId: string): ContextOptimizerStateV1["rewriteGate"] | undefined {
  const gate = stateFor(sessionId)?.rewriteGate;
  return gate ? { ...gate } : undefined;
}

export function latchContextFoldFallback(sessionId: string, reason: string): void {
  const state = stateFor(sessionId);
  if (!state) return;
  state.fallbackOwner = "context-fold";
  state.fallbackReason = reason;
  delete state.primaryOwner;
}

export function invokeContextFoldFallback(event: unknown, ctx: unknown): unknown {
  const handler = globals()[CONTEXT_FOLD_FALLBACK_KEY];
  return typeof handler === "function" ? (handler as (event: unknown, ctx: unknown) => unknown)(event, ctx) : undefined;
}
