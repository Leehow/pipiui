export const SUBAGENT_COMPLETION_CUSTOM_TYPE = "pipiui-subagent-complete-v1";

export interface CompletionNotificationInput {
	sessionId: string;
	agentId: string;
	runId: string;
	obligationId: string;
	text: string;
}

export interface CompletionObservation {
	version: 1;
	sessionId: string;
	agentId: string;
	runId: string;
	obligationId: string;
}

interface CompletionMessageSender {
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

/**
 * Enqueue one completion through Pi's native extension-message channel.
 * ExtensionAPI.sendMessage is void/fire-and-forget: a normal return proves only
 * that the call was queued, never that Pi persisted or consumed the message.
 */
export function queueCompletionNotification(
	pi: CompletionMessageSender,
	input: CompletionNotificationInput,
): boolean {
	try {
		pi.sendMessage(
			{
				customType: SUBAGENT_COMPLETION_CUSTOM_TYPE,
				content: input.text,
				display: false,
				details: {
					version: 1,
					sessionId: input.sessionId,
					agentId: input.agentId,
					runId: input.runId,
					obligationId: input.obligationId,
				},
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		return true;
	} catch (err) {
		console.error("[pipiui-subagent] completion notification enqueue rejected:", err);
		return false;
	}
}

/** Preserve cut-in ordering and reject a stale session before the fire-and-forget call. */
export async function queueCompletionAfterCutIn(
	pi: CompletionMessageSender,
	input: CompletionNotificationInput,
	hooks: { waitForCutIn: () => Promise<void>; currentSessionId: () => string | undefined },
): Promise<boolean> {
	await hooks.waitForCutIn();
	if (!input.sessionId || hooks.currentSessionId() !== input.sessionId) return false;
	return queueCompletionNotification(pi, input);
}

/** Parse either a live custom message or its persisted CustomMessageEntry form. */
export function completionObservation(value: unknown): CompletionObservation | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const message = value as { role?: unknown; type?: unknown; customType?: unknown; details?: unknown };
	if (message.role !== "custom" && message.type !== "custom_message") return undefined;
	if (message.customType !== SUBAGENT_COMPLETION_CUSTOM_TYPE) return undefined;
	if (!message.details || typeof message.details !== "object" || Array.isArray(message.details)) return undefined;
	const details = message.details as Partial<CompletionObservation>;
	if (
		details.version !== 1 ||
		typeof details.sessionId !== "string" || !details.sessionId ||
		typeof details.agentId !== "string" || !details.agentId ||
		typeof details.runId !== "string" || !details.runId ||
		typeof details.obligationId !== "string" || !details.obligationId
	) return undefined;
	return details as CompletionObservation;
}

export function completionObservationMatches(
	observed: CompletionObservation,
	expected: Pick<CompletionNotificationInput, "sessionId" | "agentId" | "runId" | "obligationId">,
): boolean {
	return observed.sessionId === expected.sessionId &&
		observed.agentId === expected.agentId &&
		observed.runId === expected.runId &&
		observed.obligationId === expected.obligationId;
}

/**
 * Session-order proof: custom persistence is observed; only a later successful
 * assistant entry proves the Boss produced a persisted response for that wake.
 */
export function completionPersistenceState(
	entries: readonly unknown[],
	expected: Pick<CompletionNotificationInput, "sessionId" | "agentId" | "runId" | "obligationId">,
): "absent" | "observed" | "retryable" | "fulfilled" {
	let state: "absent" | "observed" | "indeterminate" | "retryable" | "fulfilled" = "absent";
	for (const value of entries) {
		const observed = completionObservation(value);
		if (observed && completionObservationMatches(observed, expected)) {
			// A replay with the same obligation ID begins a new logical delivery
			// attempt. Only its own first subsequent assistant decides that attempt.
			state = "observed";
			continue;
		}
		if (state !== "observed" || !value || typeof value !== "object" || Array.isArray(value)) continue;
		const entry = value as { type?: unknown; message?: { role?: unknown; stopReason?: unknown } };
		if (entry.type === "message" && entry.message?.role === "assistant") {
			// Pi's loop persists/emits toolUse before executing tools, then emits a
			// later terminal assistant. It is activity, not this attempt's outcome.
			if (entry.message.stopReason === "toolUse") continue;
			if (entry.message.stopReason === "stop") state = "fulfilled";
			else if (
				entry.message.stopReason === "error" ||
				entry.message.stopReason === "aborted" ||
				entry.message.stopReason === "length"
			) state = "retryable";
			// Unknown/pending/deferred states are not proven terminal here. Keep the
			// attempt observed rather than inventing success or failure.
			else state = "indeterminate";
		}
	}
	return state === "indeterminate" ? "observed" : state;
}
