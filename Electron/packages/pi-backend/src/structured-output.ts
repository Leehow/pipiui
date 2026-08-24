import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { Model, StructuredOutputRequest } from "@pipi/host-api";

const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export type StructuredOutputNormalize = (request: unknown) => StructuredOutputRequest;
export type StructuredOutputsEnabled = (capabilities: unknown) => boolean;

export function safeStructuredOutputSessionId(raw: string): string {
  const trimmed = raw.trim();
  if (!SAFE_SESSION_ID.test(trimmed)) throw new Error("缺少会话");
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Capability-driven; never infer from provider id. Object with jsonSchema:false is off. */
export function structuredOutputsCapabilityEnabled(capabilities: unknown): boolean {
  if (!isRecord(capabilities)) return false;
  const flag = capabilities.structuredOutputs;
  if (flag === true) return true;
  if (!isRecord(flag)) return false;
  return flag.jsonSchema !== false;
}

export function modelDeclaresStructuredOutputs(
  model: { capabilities?: unknown } | undefined,
): boolean {
  return structuredOutputsCapabilityEnabled(model?.capabilities);
}

export function modelUsesResponsesApi(model: Model | undefined): boolean {
  const api = typeof model?.api === "string" ? model.api.trim().toLowerCase() : "";
  if (!api) return true;
  return api === "openai-responses" || api.endsWith("-responses") || api === "responses";
}

type GrokStructuredOutputModule = {
  normalizeStructuredOutputRequest?: StructuredOutputNormalize;
  structuredOutputsEnabled?: StructuredOutputsEnabled;
};

export async function loadGrokStructuredOutputNormalize(
  runtimeRoot: string,
): Promise<{ normalize: StructuredOutputNormalize; enabled: StructuredOutputsEnabled } | undefined> {
  const url = pathToFileURL(join(runtimeRoot, "extensions/grok-build-oauth/agent/dist/host.js")).href;
  try {
    const mod = await import(url) as GrokStructuredOutputModule;
    if (typeof mod.normalizeStructuredOutputRequest !== "function") return undefined;
    const enabled = typeof mod.structuredOutputsEnabled === "function"
      ? mod.structuredOutputsEnabled
      : structuredOutputsCapabilityEnabled;
    return { normalize: mod.normalizeStructuredOutputRequest, enabled };
  } catch {
    return undefined;
  }
}

/**
 * Host-side in-memory one-shot store. Validates immediately via the Grok
 * `normalizeStructuredOutputRequest` (injected or dynamically loaded).
 * Never writes session/resource/settings/logs.
 */
export class StructuredOutputController {
  private readonly pending = new Map<string, StructuredOutputRequest>();

  constructor(
    private readonly normalize: StructuredOutputNormalize,
    private readonly resolveModel: (sessionId: string) => Model | undefined,
    private readonly capabilityEnabled: StructuredOutputsEnabled = structuredOutputsCapabilityEnabled,
  ) {}

  set(sessionId: string, request: unknown): StructuredOutputRequest | undefined {
    const id = safeStructuredOutputSessionId(sessionId);
    if (request == null) {
      this.pending.delete(id);
      return undefined;
    }
    this.assertSendable(this.resolveModel(id));
    const normalized = this.normalize(request);
    this.pending.set(id, normalized);
    return normalized;
  }

  peek(sessionId: string): StructuredOutputRequest | undefined {
    return this.pending.get(safeStructuredOutputSessionId(sessionId));
  }

  take(sessionId: string): StructuredOutputRequest | undefined {
    const id = safeStructuredOutputSessionId(sessionId);
    const current = this.pending.get(id);
    if (current) this.pending.delete(id);
    return current;
  }

  clear(sessionId: string): void {
    this.pending.delete(safeStructuredOutputSessionId(sessionId));
  }

  clearAll(): void {
    this.pending.clear();
  }

  /**
   * Fail-closed send seam for capability / non-Responses — before prompt RPC.
   * Hook take/normalize/apply failures are a tagged fatal that PipiUI's runner
   * rethrows so the provider is never called. Failure here consumes the pending
   * request so it cannot leak to another turn.
   */
  assertReadyToSend(sessionId: string): void {
    const id = safeStructuredOutputSessionId(sessionId);
    if (!this.pending.has(id)) return;
    try {
      this.assertSendable(this.resolveModel(id));
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
  }

  private assertSendable(model: Model | undefined): void {
    if (!this.capabilityEnabled(model?.capabilities)) {
      throw new Error("该模型未声明 structuredOutputs 能力，拒绝静默退化为普通发送");
    }
    if (!modelUsesResponsesApi(model)) {
      throw new Error("Structured Outputs 仅支持 Responses，拒绝普通发送");
    }
  }
}
