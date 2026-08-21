import { PIPI_HOST_PROTOCOL_VERSION } from "@pipi/host-api";
import {
  authorizeExtEmit,
  type ExtEmitAuth,
  type ExtInvokeErrorCode,
  type ExtensionRegistry,
} from "./extension-registry.js";

export type ExtEmitInput = {
  extensionId: string;
  event: string;
  payload?: unknown;
};

export type ExtHostEvent = {
  protocolVersion: typeof PIPI_HOST_PROTOCOL_VERSION;
  channel: `ext.${string}`;
  event: { type: string; payload?: unknown };
};
export type ExtEmitOk = { ok: true; event: ExtHostEvent };
export type ExtEmitDenied = Extract<ExtEmitAuth, { ok: false }>;
export type ExtEmitResult = ExtEmitOk | ExtEmitDenied;

/** D4: sessionCapability is checked by HostBridge; this seam checks mount + capability + lifecycle. */
export function handleExtEmit(
  registry: ExtensionRegistry,
  input: ExtEmitInput,
  sessionId: string,
): ExtEmitResult {
  const auth = authorizeExtEmit(registry, sessionId, input.extensionId);
  if (!auth.ok) return auth;
  if (typeof input.event !== "string" || !input.event.trim()) {
    return { ok: false, error: "missing event", errorCode: "agent_error" };
  }
  return {
    ok: true,
    event: {
      protocolVersion: PIPI_HOST_PROTOCOL_VERSION,
      channel: `ext.${input.extensionId}`,
      event: { type: input.event, payload: input.payload },
    },
  };
}

/** D5: project pi `tool_execution_end.result` onto StreamEvent.tool_result.details. */
export function toolResultDetailsField(result: unknown): { details?: unknown } {
  return result === undefined ? {} : { details: result };
}
