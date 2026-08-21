export declare function settingsSnapshot(): Record<string, unknown> | undefined;
/**
 * Agent home — `PI_COC_AGENT_DIR` > `PI_CODING_AGENT_DIR`; never the global
 * `~/.pi/agent` (fail closed per spec §D9). Returns undefined when unset so
 * non-critical helpers (session id persistence) can degrade gracefully.
 */
export declare function agentHome(): string | undefined;
/** Stable x-grok-session-id: settings > env > persisted generated UUID. */
export declare function resolveSessionId(): string;
export type ImagesConfig = {
    baseUrl: string;
    model: string;
    editModel: string;
    sessionId: string;
    tier?: string;
    compatFallback: boolean;
};
export declare function resolveImagesConfig(): ImagesConfig;
/**
 * Deprecated legacy PipiUI loopback relay. Used ONLY when
 * `ext.grok-build-oauth.compatFallback === true` and neither OAuth nor
 * XAI_API_KEY credentials are present (spec §D6 / US-27).
 */
export declare function legacyRelayBase(): string;
