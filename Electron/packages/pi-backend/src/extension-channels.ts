import { PIPI_HOST_PROTOCOL_VERSION } from "@pipi/host-api";
import type { ExtensionStateResultV1 } from "./bridge.js";
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

/** Read only this session's mounted extension; no emit grant or settings exposure. */
export function handleExtState(
  registry: ExtensionRegistry,
  input: { extensionId: string },
  sessionId: string,
  overlay: Record<string, boolean>,
): ExtensionStateResultV1 {
  const mounted = registry.isMounted(sessionId, input.extensionId);
  if (!mounted) {
    return { schemaVersion: 1, ok: false, error: "extension not mounted", errorCode: "capability_denied" };
  }
  const current = registry.list(overlay).find((item) => item.id === input.extensionId);
  const state = current?.state === "enabled" || current?.state === "disabled" || current?.state === "error"
    ? current.state : "unavailable";
  return { schemaVersion: 1, ok: true, enabled: state === "enabled", mounted, state };
}

/**
 * D5: project pi `tool_execution_end.result` onto StreamEvent.tool_result.details.
 * A pi ToolResultMessage is `{ content, details }` — surface only the structured
 * `details` subfield. The content array already travels via the dedicated
 * text/images channels; duplicating it here would copy typed image base64
 * into the unstructured details channel (and any logs that print it).
 */
export function toolResultDetailsField(result: unknown): { details?: unknown } {
  if (result === undefined) return {};
  if (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const details = (result as { details?: unknown }).details;
    return details === undefined ? {} : { details };
  }
  return { details: result };
}
