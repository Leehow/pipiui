type Timer = ReturnType<typeof setTimeout>;

export const COMPUTER_TASK_CONTINUATION_CUSTOM_TYPE = "pipiui-computer-task-continuation-v1";
export const COMPUTER_TASK_CONTINUATION_TIMEOUT_MS = 60_000;

type ContinuationMessageSender = {
	sendMessage(
		message: { customType: string; content: []; display: false; details: { version: 1; obligationId: string } },
		options: { triggerTurn: true },
	): unknown;
};

/** Wake Pi without fabricating a user instruction or replaying computer_task. */
export function queueComputerTaskContinuation(pi: ContinuationMessageSender, obligationId: string): boolean {
	try {
		pi.sendMessage(
			{
				customType: COMPUTER_TASK_CONTINUATION_CUSTOM_TYPE,
				content: [],
				display: false,
				details: { version: 1, obligationId },
			},
			{ triggerTurn: true },
		);
		return true;
	} catch (error) {
		console.error("[pipiui-subagent] computer_task continuation rejected:", error);
		return false;
	}
}

type ContextMessage = {
	role?: unknown;
	toolName?: unknown;
	stopReason?: unknown;
	customType?: unknown;
	details?: unknown;
};

/** A provider message_start and empty stream boundary prove no durable answer.
 * Keep the watchdog armed until an assistant update carries actual output. */
export function isComputerTaskAssistantActivity(event: unknown): boolean {
	if (!event || typeof event !== "object") return false;
	const candidate = event as {
		type?: unknown;
		assistantMessageEvent?: { delta?: unknown; content?: unknown; toolCall?: unknown };
	};
	if (candidate.type !== "message_update") return false;
	const update = candidate.assistantMessageEvent;
	if (!update || typeof update !== "object") return false;
	if (typeof update.delta === "string" && update.delta.length > 0) return true;
	if (typeof update.content === "string" && update.content.length > 0) return true;
	return Boolean(update.toolCall && typeof update.toolCall === "object");
}

/**
 * The custom message is only an ExtensionAPI trigger. Remove it from the model
 * payload, together with the empty assistant produced by our abort, so the
 * provider resumes from the already-persisted computer_task tool result.
 */
export function stripComputerTaskContinuationTrigger<T extends ContextMessage>(messages: T[], obligationId: string): T[] {
	let triggerIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		const details = message?.details;
		if (
			message?.role === "custom" &&
			message.customType === COMPUTER_TASK_CONTINUATION_CUSTOM_TYPE &&
			details && typeof details === "object" &&
			(details as { obligationId?: unknown }).obligationId === obligationId
		) {
			triggerIndex = index;
			break;
		}
	}
	if (triggerIndex < 0) return messages;
	const remove = new Set([triggerIndex]);
	const abortedIndex = triggerIndex - 1;
	const resultIndex = triggerIndex - 2;
	if (
		messages[abortedIndex]?.role === "assistant" &&
		messages[abortedIndex]?.stopReason === "aborted" &&
		messages[resultIndex]?.role === "toolResult" &&
		messages[resultIndex]?.toolName === "computer_task"
	) {
		remove.add(abortedIndex);
	}
	return messages.filter((_message, index) => !remove.has(index));
}

type ComputerTaskContinuationWatchdogOptions = {
	deadlineMs: number;
	schedule?: (callback: () => void, delayMs: number) => Timer;
	cancel?: (timer: Timer) => void;
	onContinue: () => void;
};

/**
 * Joins a post-computer_task provider request before continuing it. A silent
 * settle continues immediately; otherwise the timeout only requests abort and
 * the later settled event remains the continuation gate. Both paths are
 * monotonic, so late provider events cannot create two main-agent turns.
 */
export function createComputerTaskContinuationWatchdog(options: ComputerTaskContinuationWatchdogOptions) {
	const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const cancel = options.cancel ?? clearTimeout;
	let state: "idle" | "armed" | "abort-requested" | "continued" | "disposed" = "idle";
	let timer: Timer | undefined;
	let abortCurrent: (() => void) | undefined;

	const clearTimer = () => {
		if (timer !== undefined) cancel(timer);
		timer = undefined;
	};

	return {
		arm(abort: () => void) {
			if (state === "disposed") return;
			clearTimer();
			state = "armed";
			abortCurrent = abort;
			timer = schedule(() => {
				timer = undefined;
				if (state !== "armed") return;
				state = "abort-requested";
				const requestAbort = abortCurrent;
				abortCurrent = undefined;
				requestAbort?.();
			}, options.deadlineMs);
			(timer as { unref?: () => void })?.unref?.();
		},
		noteAssistantActivity() {
			if (state !== "armed") return;
			clearTimer();
			abortCurrent = undefined;
			state = "idle";
		},
		noteSettled() {
			if (state === "armed") {
				clearTimer();
				abortCurrent = undefined;
				state = "continued";
				options.onContinue();
				return true;
			}
			if (state !== "abort-requested") return false;
			state = "continued";
			options.onContinue();
			return true;
		},
		dispose() {
			clearTimer();
			abortCurrent = undefined;
			state = "disposed";
		},
	};
}
