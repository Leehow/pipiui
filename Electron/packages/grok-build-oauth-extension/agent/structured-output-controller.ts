/**
 * In-memory, session-scoped one-shot Structured Output requests.
 * Never writes session/resource/settings/logs. Schema lives only in this Map.
 */
import {
  normalizeStructuredOutputRequest,
  type StructuredOutputRequest,
} from "./structured-output.js";

const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export function safeStructuredOutputSessionId(raw: string): string {
  const trimmed = raw.trim();
  if (!SAFE_SESSION_ID.test(trimmed)) throw new Error("缺少会话");
  return trimmed;
}

export class StructuredOutputController {
  private readonly pending = new Map<string, StructuredOutputRequest>();

  set(sessionId: string, request: unknown): StructuredOutputRequest | undefined {
    const id = safeStructuredOutputSessionId(sessionId);
    if (request == null) {
      this.pending.delete(id);
      return undefined;
    }
    const normalized = normalizeStructuredOutputRequest(request);
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
}

export function createStructuredOutputController(): StructuredOutputController {
  return new StructuredOutputController();
}
