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
/** True when `raw` is an HTTPS URL (the only transport real Bearers may use). */
export declare function isHttpsBaseUrl(raw: string): boolean;
/**
 * Deprecated legacy PipiUI loopback relay base (spec §D6 / US-27).
 *
 * The relay is an INDEPENDENT transport: it is only ever a loopback HTTP
 * endpoint and it is authenticated with the local relay credential
 * (`Bearer local`) — the real OAuth access token and XAI_API_KEY never go to
 * it, and it is never reached unless `ext.grok-build-oauth.compatFallback`
 * is explicitly enabled (default off). A non-loopback relay base is refused
 * (prompts/images must not be exfiltrated to a remote "relay").
 */
export declare function resolveRelayBase(): string;
/** @deprecated Use resolveRelayBase() — kept for one release for external callers. */
export declare function legacyRelayBase(): string;
