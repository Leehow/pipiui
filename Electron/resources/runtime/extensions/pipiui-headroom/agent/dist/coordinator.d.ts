export declare const CONTEXT_OPTIMIZER_STATE_KEY: unique symbol;
export declare const CONTEXT_FOLD_FALLBACK_KEY: unique symbol;
export declare const HEADROOM_OWNER = "pipiui-headroom";
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
export declare function beginSession(sessionId: string): ContextOptimizerStateV1;
export declare function acquireHeadroomPrimary(sessionId: string): boolean;
export declare function releaseHeadroomPrimary(sessionId: string): void;
export declare function headroomOwnsPrimary(sessionId: string): boolean;
export declare function contextRewriteIsAllowed(sessionId: string): boolean;
export declare function contextRewriteGateSnapshot(sessionId: string): ContextOptimizerStateV1["rewriteGate"] | undefined;
export declare function latchContextFoldFallback(sessionId: string, reason: string): void;
export declare function invokeContextFoldFallback(event: unknown, ctx: unknown): unknown;
export {};
