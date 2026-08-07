/** Pure helpers for tunnel chat UI (send/stop + stick-to-bottom + queue). */

export const STICK_THRESHOLD_PX = 80;

/** True when the viewport is within `threshold` px of the scroll bottom. */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number = STICK_THRESHOLD_PX,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

export type ComposerActionMode = "send" | "stop";

/**
 * Legacy single-button mode. Prefer `composerButtons` for the dual-button UI.
 * Idle → send; generating or stopping → stop.
 */
export function composerActionMode(
  snapshot: { isGenerating?: boolean; isStopping?: boolean } | null | undefined,
): ComposerActionMode {
  if (snapshot?.isGenerating || snapshot?.isStopping) return "stop";
  return "send";
}

/**
 * Dual composer actions:
 * - Idle: always show Send (enabled when canSendPrompt).
 * - Busy + non-empty text: Send (enqueue via host) + Stop side by side.
 * - Busy + empty text: Stop only.
 */
export function composerButtons(input: {
  isGenerating?: boolean;
  isStopping?: boolean;
  hasText: boolean;
}): { showSend: boolean; showStop: boolean } {
  const busy = Boolean(input.isGenerating || input.isStopping);
  if (busy) {
    return { showSend: input.hasText, showStop: true };
  }
  return { showSend: true, showStop: false };
}

export function canSendPrompt(input: {
  connected: boolean;
  hasSession: boolean;
  text: string;
  processAlive?: boolean;
  sending?: boolean;
}): boolean {
  return (
    input.connected
    && input.hasSession
    && input.text.trim().length > 0
    && input.processAlive === true
    && !input.sending
  );
}

export type QueueItem = { id: string; text: string };

/** Normalize snapshot.queue → stable {id,text}[]; missing/invalid → []. */
export function normalizeQueue(
  snapshot: { queue?: unknown } | null | undefined,
): QueueItem[] {
  const raw = snapshot?.queue;
  if (!Array.isArray(raw)) return [];
  const out: QueueItem[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    const id = typeof record.id === "string" && record.id.length > 0
      ? record.id
      : `q-${i}`;
    out.push({ id, text });
  }
  return out;
}

/** One-line summary for a queue row (first line, truncated). */
export function queueItemSummary(text: string, maxLen = 48): string {
  const firstLine = (text.split("\n")[0] ?? "").trim();
  if (!firstLine) return "(空)";
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen)}…`;
}

/**
 * Extract restored draft text from queue.restore response.
 * Falls back to joining the pre-call queue texts (host bulk-restore semantics).
 */
export function draftFromQueueRestore(
  response: unknown,
  fallbackQueue: readonly QueueItem[],
): string {
  if (response !== null && typeof response === "object" && !Array.isArray(response)) {
    const record = response as Record<string, unknown>;
    for (const key of ["text", "draft", "draftText"] as const) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return fallbackQueue
    .map((item) => item.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/** Merge restored queue draft into the current composer (local InputBar parity). */
export function mergeRestoredDraft(current: string, restored: string): string {
  const cur = current.trim();
  const rest = restored.trim();
  if (!cur) return restored;
  if (!rest) return current;
  return `${current.replace(/\s+$/, "")}\n\n${restored.replace(/^\s+/, "")}`;
}

/** Stable key so UI can drop optimistic queue overrides when host snapshot changes. */
export function queueSourceKey(items: readonly QueueItem[]): string {
  return items.map((item) => `${item.id}\0${item.text}`).join("\n");
}
