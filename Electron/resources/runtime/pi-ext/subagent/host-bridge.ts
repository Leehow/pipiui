/**
 * Tiny portable encoder for the one PipiUI loopback `/rpc` endpoint.
 *
 * Swift's existing bridge remains the default legacy shape. Electron's v1 host
 * opts in with PIPIUI_HOST_PROTOCOL=1 and receives canonical envelopes. This
 * module only encodes one request body; callers own timeout/retry/HTTP policy.
 */

export const PIPIUI_HOST_PROTOCOL_V1 = "1" as const;

export type PipiUIBridgeEnvironmentV1 = Readonly<{
	PIPIUI_HOST_PROTOCOL?: string;
	PIPIUI_SESSION_KEY?: string;
	PIPIUI_SESSION_CAPABILITY?: string;
}>;

/** All live subagent observations are run-scoped, including legacy bridge bodies. */
export type AgentBridgeEventPayloadV1 = Record<string, unknown> & {
	kind: string;
	agentId: string;
	runId: string;
};

/** Plan envelopes share the transport encoder but intentionally have no agent/run identity. */
export type PlanBridgeEventPayloadV1 = Record<string, unknown> & {
	event: string;
};

export type EncodedBridgeRequestV1 = Record<string, unknown>;

function nonBlankString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** Exact opt-in only: every other value, including an unset variable, stays legacy. */
export function usesCanonicalHostProtocolV1(environment: PipiUIBridgeEnvironmentV1): boolean {
	return environment.PIPIUI_HOST_PROTOCOL === PIPIUI_HOST_PROTOCOL_V1;
}

function validAgentEventIdentity(event: Record<string, unknown>): event is AgentBridgeEventPayloadV1 {
	return nonBlankString(event.kind)
		&& nonBlankString(event.agentId)
		&& nonBlankString(event.runId);
}

/**
 * Encode exactly one agent_event request. Missing identity fails closed rather
 * than letting a host infer a run from a reusable agentId.
 */
export function encodeAgentEventBridgeRequestV1(
	event: Record<string, unknown>,
	environment: PipiUIBridgeEnvironmentV1,
): EncodedBridgeRequestV1 | undefined {
	if (!validAgentEventIdentity(event)) return undefined;
	if (usesCanonicalHostProtocolV1(environment)) {
		const sessionCapability = environment.PIPIUI_SESSION_CAPABILITY;
		if (!nonBlankString(sessionCapability)) return undefined;
		return {
			schemaVersion: 1,
			sessionCapability,
			action: "agent_event",
			event: { ...event, schemaVersion: 1 },
		};
	}
	const sessionKey = environment.PIPIUI_SESSION_KEY;
	if (!nonBlankString(sessionKey)) return undefined;
	// Keep the pre-v1 Swift wire shape byte-for-byte structural compatible.
	return { sessionKey, action: "agent_event", ...event };
}

/**
 * Encode exactly one plan_event request. The Swift-generated PlanRuntimeExtension
 * remains legacy in this slice, but Electron adapters can use this canonical form.
 */
export function encodePlanEventBridgeRequestV1(
	event: Record<string, unknown>,
	environment: PipiUIBridgeEnvironmentV1,
): EncodedBridgeRequestV1 | undefined {
	if (!nonBlankString(event.event)) return undefined;
	if (usesCanonicalHostProtocolV1(environment)) {
		const sessionCapability = environment.PIPIUI_SESSION_CAPABILITY;
		if (!nonBlankString(sessionCapability)) return undefined;
		return {
			schemaVersion: 1,
			sessionCapability,
			action: "plan_event",
			event: { ...event, schemaVersion: 1 },
		};
	}
	const sessionKey = environment.PIPIUI_SESSION_KEY;
	if (!nonBlankString(sessionKey)) return undefined;
	return { sessionKey, action: "plan_event", ...event };
}
