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

/** Explicit dispatch pins to be validated against the host's canonical catalog authority. */
export type ModelPinValidateRequestV1 = Readonly<{ refs: readonly string[] }>;
/** Mirrors the backend bridge contract (pi-backend/src/bridge.ts). */
export type ModelPinValidateDecisionV1 =
	| { schemaVersion: 1; decision: "allow"; authorityRevision: number }
	| {
			schemaVersion: 1;
			decision: "deny";
			code: "catalog_unavailable" | "model_unavailable";
			invalidIndex?: number;
			authorityRevision: number;
			retryable: boolean;
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

const MAX_MODEL_PIN_REFS = 1000;
const MAX_MODEL_PIN_REF_LENGTH = 300;

function validModelPinRefs(refs: readonly unknown[]): refs is string[] {
	if (refs.length === 0 || refs.length > MAX_MODEL_PIN_REFS) return false;
	return refs.every((ref) => {
		if (typeof ref !== "string") return false;
		const trimmed = ref.trim();
		return trimmed.length > 0 && trimmed.length <= MAX_MODEL_PIN_REF_LENGTH;
	});
}

/**
 * Encode exactly one `model_pin_validate` request. CANONICAL V1 ONLY — the legacy Swift
 * bridge has no pin endpoint, so a missing protocol marker or capability returns undefined
 * and every caller must fail closed. The body carries ONLY model refs; project paths,
 * catalog files and credentials are never part of the wire contract.
 */
export function encodeModelPinValidateBridgeRequestV1(
	refs: readonly string[],
	environment: PipiUIBridgeEnvironmentV1,
): EncodedBridgeRequestV1 | undefined {
	if (!usesCanonicalHostProtocolV1(environment)) return undefined;
	const sessionCapability = environment.PIPIUI_SESSION_CAPABILITY;
	if (!nonBlankString(sessionCapability)) return undefined;
	if (!Array.isArray(refs) || !validModelPinRefs(refs)) return undefined;
	return {
		schemaVersion: 1,
		sessionCapability,
		action: "model_pin_validate",
		event: { schemaVersion: 1, refs: [...refs] },
	};
}

/** Structural guard mirroring the backend envelope; anything else is treated as transport noise. */
export function parseModelPinValidateDecisionV1(value: unknown): ModelPinValidateDecisionV1 | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = value as { schemaVersion?: unknown; decision?: unknown; authorityRevision?: unknown };
	if (candidate.schemaVersion !== 1) return undefined;
	if (!Number.isSafeInteger(candidate.authorityRevision)) return undefined;
	if (candidate.decision === "allow") {
		return { schemaVersion: 1, decision: "allow", authorityRevision: candidate.authorityRevision as number };
	}
	if (candidate.decision !== "deny") return undefined;
	const deny = candidate as { code?: unknown; invalidIndex?: unknown; retryable?: unknown };
	if (deny.code !== "catalog_unavailable" && deny.code !== "model_unavailable") return undefined;
	if (typeof deny.retryable !== "boolean") return undefined;
	if (deny.invalidIndex !== undefined && !Number.isSafeInteger(deny.invalidIndex)) return undefined;
	return {
		schemaVersion: 1,
		decision: "deny",
		code: deny.code,
		...(deny.invalidIndex !== undefined ? { invalidIndex: deny.invalidIndex as number } : {}),
		authorityRevision: candidate.authorityRevision as number,
		retryable: deny.retryable,
	};
}
