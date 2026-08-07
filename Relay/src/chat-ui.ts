/** Pure helpers for tunnel chat UI (send/stop + stick-to-bottom). */

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

/** Idle → send; generating or stopping → stop. */
export function composerActionMode(
  snapshot: { isGenerating?: boolean; isStopping?: boolean } | null | undefined,
): ComposerActionMode {
  if (snapshot?.isGenerating || snapshot?.isStopping) return "stop";
  return "send";
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
