export const CONTEXT_OPTIMIZER_STATE_KEY = Symbol.for("pipiui.contextOptimizer.state.v1");
export const CONTEXT_FOLD_FALLBACK_KEY = Symbol.for("pipiui.contextFold.applyFallback.v1");
export const HEADROOM_OWNER = "pipiui-headroom";
const globals = () => globalThis;
function isState(value) {
    return typeof value === "object" && value !== null &&
        value.version === 1 &&
        typeof value.sessionId === "string";
}
export function beginSession(sessionId) {
    const current = globals()[CONTEXT_OPTIMIZER_STATE_KEY];
    if (isState(current) && current.sessionId === sessionId)
        return current;
    const next = { version: 1, sessionId };
    globals()[CONTEXT_OPTIMIZER_STATE_KEY] = next;
    return next;
}
function stateFor(sessionId) {
    const current = globals()[CONTEXT_OPTIMIZER_STATE_KEY];
    return isState(current) && current.sessionId === sessionId ? current : undefined;
}
export function acquireHeadroomPrimary(sessionId) {
    const state = stateFor(sessionId);
    if (!state || state.fallbackOwner || (state.primaryOwner && state.primaryOwner !== HEADROOM_OWNER))
        return false;
    state.primaryOwner = HEADROOM_OWNER;
    return true;
}
export function releaseHeadroomPrimary(sessionId) {
    const state = stateFor(sessionId);
    if (state?.primaryOwner === HEADROOM_OWNER)
        delete state.primaryOwner;
}
export function headroomOwnsPrimary(sessionId) {
    const state = stateFor(sessionId);
    return state?.primaryOwner === HEADROOM_OWNER && !state.fallbackOwner;
}
export function contextRewriteIsAllowed(sessionId) {
    return stateFor(sessionId)?.rewriteGate?.activeTurn === true;
}
export function contextRewriteGateSnapshot(sessionId) {
    const gate = stateFor(sessionId)?.rewriteGate;
    return gate ? { ...gate } : undefined;
}
export function latchContextFoldFallback(sessionId, reason) {
    const state = stateFor(sessionId);
    if (!state)
        return;
    state.fallbackOwner = "context-fold";
    state.fallbackReason = reason;
    delete state.primaryOwner;
}
export function invokeContextFoldFallback(event, ctx) {
    const handler = globals()[CONTEXT_FOLD_FALLBACK_KEY];
    return typeof handler === "function" ? handler(event, ctx) : undefined;
}
