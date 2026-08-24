/**
 * In-memory, session-scoped one-shot Structured Output requests.
 * Never writes session/resource/settings/logs. Schema lives only in this Map.
 */
import { normalizeStructuredOutputRequest, } from "./structured-output.js";
const SAFE_SESSION_ID = /^[A-Za-z0-9._-]+$/;
export function safeStructuredOutputSessionId(raw) {
    const trimmed = raw.trim();
    if (!SAFE_SESSION_ID.test(trimmed))
        throw new Error("缺少会话");
    return trimmed;
}
export class StructuredOutputController {
    pending = new Map();
    set(sessionId, request) {
        const id = safeStructuredOutputSessionId(sessionId);
        if (request == null) {
            this.pending.delete(id);
            return undefined;
        }
        const normalized = normalizeStructuredOutputRequest(request);
        this.pending.set(id, normalized);
        return normalized;
    }
    peek(sessionId) {
        return this.pending.get(safeStructuredOutputSessionId(sessionId));
    }
    take(sessionId) {
        const id = safeStructuredOutputSessionId(sessionId);
        const current = this.pending.get(id);
        if (current)
            this.pending.delete(id);
        return current;
    }
    clear(sessionId) {
        this.pending.delete(safeStructuredOutputSessionId(sessionId));
    }
    clearAll() {
        this.pending.clear();
    }
}
export function createStructuredOutputController() {
    return new StructuredOutputController();
}
