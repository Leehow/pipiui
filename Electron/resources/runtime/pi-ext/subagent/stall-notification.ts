/**
 * Wake channel for stall / post-stall recovery signals.
 *
 * Completions already use ExtensionAPI.sendMessage({ triggerTurn: true }).
 * sendUserMessage({ deliverAs: "followUp" }) only queues/displays when the Boss
 * is idle, so a settled session would see [subagent-stalled] and never start a
 * turn. This helper is the stall equivalent of queueCompletionNotification.
 */

export const SUBAGENT_STALL_CUSTOM_TYPE = "pipiui-subagent-stall-v1";

export interface StallNotifyState {
	lastStallNotifyAt: number;
	stallNotifyCount: number;
	stallNotifyInFlight?: boolean;
}

interface StallMessageSender {
	sendMessage(
		message: {
			customType: string;
			content: string;
			display: boolean;
			details: Record<string, unknown>;
		},
		options: { triggerTurn: true; deliverAs: "followUp" },
	): unknown;
}

export function isStallWakeSignal(kind: string | undefined): boolean {
	return kind === "stall" || kind === "blocked";
}

/**
 * Enqueue one stall/recovery signal through Pi's native extension-message
 * channel so an idle Boss starts a turn. A normal return proves only that the
 * call was queued, never that Pi persisted or consumed the message.
 */
export function queueStallNotification(pi: StallMessageSender, text: string): boolean {
	try {
		pi.sendMessage(
			{
				customType: SUBAGENT_STALL_CUSTOM_TYPE,
				content: text,
				display: true,
				details: { version: 1 },
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		return true;
	} catch (err) {
		console.error("[pipiui-subagent] stall notification enqueue rejected:", err);
		return false;
	}
}

/** Preserve cut-in ordering; admission/quiet stay in the caller via shouldSend. */
export async function queueStallAfterCutIn(
	pi: StallMessageSender,
	text: string,
	hooks: { waitForCutIn: () => Promise<void>; shouldSend?: () => boolean },
): Promise<boolean> {
	await hooks.waitForCutIn();
	if (hooks.shouldSend && !hooks.shouldSend()) return false;
	return queueStallNotification(pi, text);
}

/**
 * Reserve one interval-spaced attempt. Sets lastStallNotifyAt so a hold/fail
 * cannot stampede, but does not increment stallNotifyCount until confirm.
 */
export function claimStallNotification(
	handle: StallNotifyState,
	now: number,
	maxNotifies: number,
	intervalMs: number,
): boolean {
	if (handle.stallNotifyInFlight) return false;
	if (handle.stallNotifyCount >= maxNotifies) return false;
	if (handle.lastStallNotifyAt > 0 && now - handle.lastStallNotifyAt < intervalMs) return false;
	handle.stallNotifyInFlight = true;
	handle.lastStallNotifyAt = now;
	return true;
}

/** Count only a successful enqueue. A hold/drop/throw leaves the budget intact. */
export function confirmStallNotification(handle: StallNotifyState, delivered: boolean): void {
	handle.stallNotifyInFlight = false;
	if (delivered) handle.stallNotifyCount += 1;
}
