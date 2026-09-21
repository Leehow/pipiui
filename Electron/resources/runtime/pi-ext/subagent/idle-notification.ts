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

/**
 * Only worker identities are retained while busy, never a payload or a queue of events.
 *
 * Consumption is scoped, because a whole-board read is not the only way the Boss looks:
 * inspecting one worker answers that worker just as completely. A revision counter cannot
 * express that — the Boss read one worker, the counter stayed unread, and the hint fired
 * again at the next settle for a result the Boss had already reported. Keys are
 * `<agentId>\0<runId>` so a scoped read can retire exactly the workers it covered.
 *
 * Only an explicit status read consumes. Reading a findings file is deliberately NOT
 * consumption: that artifact is the worker's own final text, so it cannot stand in for a
 * Supervisor decision on the same run, and it would retire notices the Boss never saw.
 */
export class IdleNotificationState {
	private unreadKeys = new Set<string>();
	changed(key: string): void { this.unreadKeys.add(key); }
	/** No argument consumes the whole board; an agent id consumes only that worker's runs. */
	read(agentId?: string): void {
		if (!agentId) { this.unreadKeys.clear(); return; }
		const prefix = `${agentId}\0`;
		for (const key of [...this.unreadKeys]) if (key.startsWith(prefix)) this.unreadKeys.delete(key);
	}
	get unread(): boolean { return this.unreadKeys.size > 0; }
	reset(): void { this.unreadKeys.clear(); }

	remind(send: () => void): boolean {
		if (!this.unreadKeys.size) return false;
		const pending = [...this.unreadKeys];
		try { send(); } catch { return false; }
		// A synchronous callback may observe another completion: do not consume it.
		for (const key of pending) this.unreadKeys.delete(key);
		return true;
	}
}
