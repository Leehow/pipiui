/** Boss notifications are live hints, never messages queued behind a user turn. */
const INSTALLED = Symbol.for("pipiui.subagentIdleNotification.installed");
export const IDLE_NOTIFICATION_DETAIL = "pipiuiSubagentIdleOnly";
export const IDLE_NOTIFICATION_SKIPPED = "Subagent notification skipped: Boss is not idle";

interface Notification {
	customType: string;
	content: unknown;
	display?: boolean;
	details?: Record<string, unknown>;
}
interface SendOptions { triggerTurn?: boolean; deliverAs?: string }
interface NotificationSession {
	isIdle: boolean;
	isStreaming: boolean;
	isCompacting: boolean;
	pendingMessageCount: number;
}

/**
 * Same live-prototype seam as follow-up-compaction.ts. Check at the actual native
 * send boundary, not before an async cut-in/Supervisor wait. Native sendCustomMessage
 * enters _runAgentPrompt synchronously on the idle path, so the next sender sees busy.
 * Throw synchronously: ExtensionAPI.sendMessage is void, but its caller can catch this
 * refusal before the native fire-and-forget adapter swallows async errors.
 * Only explicitly marked messages are affected; user/other-extension/nested traffic is not.
 */
export function installIdleNotificationGuard(sessionClass: { prototype: object }): boolean {
	const proto = sessionClass.prototype as Record<PropertyKey, unknown>;
	if (proto[INSTALLED]) return true;
	const original = proto.sendCustomMessage;
	if (typeof original !== "function") return false;
	proto.sendCustomMessage = function (this: NotificationSession, message: Notification, options?: SendOptions) {
		if (message.details?.[IDLE_NOTIFICATION_DETAIL] === true) {
			if (!this.isIdle || this.isStreaming || this.isCompacting || this.pendingMessageCount > 0) {
				throw new Error(IDLE_NOTIFICATION_SKIPPED);
			}
			// Neither followUp nor the implicit default steer is an allowed fallback.
			return original.call(this, message, { triggerTurn: options?.triggerTurn !== false });
		}
		return original.call(this, message, options);
	};
	proto[INSTALLED] = true;
	return true;
}

/** Scope the policy to this extension's Boss API, not to the shared Pi runtime. */
export function idleNotificationApi<T extends {
	sendMessage: (...args: any[]) => unknown;
	sendUserMessage: (...args: any[]) => unknown;
}>(api: T, canSend: () => boolean): T {
	const sendMessage = (message: Notification, options?: SendOptions) => {
		if (!canSend()) throw new Error(IDLE_NOTIFICATION_SKIPPED);
		return api.sendMessage({
			...message,
			details: { ...message.details, [IDLE_NOTIFICATION_DETAIL]: true },
		}, { triggerTurn: options?.triggerTurn !== false });
	};
	return new Proxy(api, {
		get(target, key) {
			if (key === "sendMessage") return sendMessage;
			if (key === "sendUserMessage") return (content: unknown) => sendMessage({
				customType: "pipiui-subagent-notice-v1", content, display: true,
			}, { triggerTurn: true });
			return Reflect.get(target, key);
		},
	});
}

/** Only a revision is retained while busy, never a payload or a queue of events. */
export class IdleNotificationState {
	private revision = 0;
	private seen = 0;
	changed(): void { this.revision += 1; }
	read(): void { this.seen = this.revision; }
	get unread(): boolean { return this.seen < this.revision; }
	reset(): void { this.revision = 0; this.seen = 0; }

	remind(send: () => void): boolean {
		if (!this.unread) return false;
		const revision = this.revision;
		try { send(); } catch { return false; }
		// A synchronous callback may observe another completion: do not consume it.
		this.seen = revision;
		return true;
	}
}
