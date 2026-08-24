/**
 * Generic durable follow-up wake.
 *
 * Shares DeliveryObligationStore + deliveryRetryDue with [subagent-done], but is
 * intentionally not CompletionWaveBroker. That broker hardcodes
 * pipiui-subagent-complete-v1, batches by completion identity, and is the
 * [subagent-done] path — extracting it would mix channels and risk a
 * compatibility break. Stall / context-manage nudge / office-doc-shot-gate /
 * computer-task continuation each wrap sendMessage themselves; there is no
 * shared inject helper to reuse.
 *
 * Callers that need durable/retry (browser-watch) use this sibling deliverer
 * with their own store directory + identityNamespace so recoverable() rows
 * never enter the completion reconciler.
 */

import {
	deliveryRetryDue,
	type DeliveryObligation,
	type DeliveryObligationStore,
} from "./delivery-obligation.ts";

export const FOLLOW_UP_WAKE_OPTIONS = { triggerTurn: true, deliverAs: "followUp" } as const;

export const DEFAULT_FOLLOW_UP_MAX_ATTEMPTS = 5;
export const DEFAULT_FOLLOW_UP_RETRY_MIN_INTERVAL_MS = 60_000;

export interface FollowUpMessageSender {
	sendMessage(
		message: {
			customType: string;
			content: string;
			display: boolean;
			details: Record<string, unknown>;
		},
		options: { triggerTurn: boolean; deliverAs: "followUp" },
	): unknown;
}

export interface FollowUpEnvelope {
	customType: string;
	content: string;
	display: boolean;
	details: Record<string, unknown>;
}

export interface DurableFollowUpMeta {
	customType: string;
	display?: boolean;
	details?: Record<string, unknown>;
	/** Obligation identity coordinate (watchId, agentId, …). */
	agentId: string;
	runId: string;
	/** Must differ from the default completion namespace so IDs never collide. */
	identityNamespace: string;
}

export interface DurableFollowUpContext {
	pi: FollowUpMessageSender;
	store?: DeliveryObligationStore;
	currentSessionKey?: () => string | undefined;
	maxAttempts?: number;
	retryMinIntervalMs?: number;
	logLabel?: string;
}

function logRejected(label: string, err: unknown): void {
	console.error(`[${label}] follow-up wake enqueue rejected:`, err);
}

/** Fire-and-forget sendMessage({ triggerTurn, deliverAs:"followUp" }). */
export function queueFollowUpWake(pi: FollowUpMessageSender, envelope: FollowUpEnvelope, logLabel = "pipiui"): boolean {
	try {
		pi.sendMessage(envelope, FOLLOW_UP_WAKE_OPTIONS);
		return true;
	} catch (err) {
		logRejected(logLabel, err);
		return false;
	}
}

export function followUpEnvelope(messageText: string, meta: DurableFollowUpMeta): FollowUpEnvelope {
	return {
		customType: meta.customType,
		content: messageText,
		display: meta.display !== false,
		details: { ...(meta.details ?? {}) },
	};
}

/**
 * Persist-then-send follow-up. `sessionKey` + `messageText` + `meta` are the
 * public coordinates; `ctx` supplies ExtensionAPI and the shared store class.
 * Without a store this degrades to the stall-style one-shot send.
 */
export function deliverDurableFollowUp(
	sessionKey: string,
	messageText: string,
	meta: DurableFollowUpMeta,
	ctx: DurableFollowUpContext,
): boolean {
	const label = ctx.logLabel ?? "pipiui";
	if (ctx.currentSessionKey && ctx.currentSessionKey() !== sessionKey) return false;
	const envelope = followUpEnvelope(messageText, meta);
	const store = ctx.store;
	if (!store || !sessionKey) return queueFollowUpWake(ctx.pi, envelope, label);

	const maxAttempts = ctx.maxAttempts ?? DEFAULT_FOLLOW_UP_MAX_ATTEMPTS;
	const retryMinIntervalMs = ctx.retryMinIntervalMs ?? DEFAULT_FOLLOW_UP_RETRY_MIN_INTERVAL_MS;
	let record: DeliveryObligation;
	try {
		record = store.create(meta.agentId, meta.runId, messageText, meta.identityNamespace);
	} catch (err) {
		console.error(`[${label}] follow-up obligation create failed:`, err);
		return queueFollowUpWake(ctx.pi, envelope, label);
	}
	if (record.state === "fulfilled" || record.state === "observed" || record.state === "queued") return true;
	if (record.attempts >= maxAttempts) return false;
	if (record.attempts > 0 && !deliveryRetryDue(record, Date.now(), retryMinIntervalMs, maxAttempts)) return false;

	let attempting: DeliveryObligation | undefined;
	try {
		attempting = store.beginAttempt(record.id);
	} catch (err) {
		console.error(`[${label}] follow-up obligation begin failed:`, err);
		return queueFollowUpWake(ctx.pi, envelope, label);
	}
	if (!attempting) {
		// Another live owner holds the claim, or the row vanished. Do not double-send.
		return Boolean(store.read(record.id));
	}

	const queued = queueFollowUpWake(ctx.pi, {
		...envelope,
		details: { ...envelope.details, obligationId: attempting.id },
	}, label);
	try {
		store.finishAttempt(attempting.id, queued);
	} catch (err) {
		console.error(`[${label}] follow-up obligation ${queued ? "queue" : "fail"} failed:`, err);
	}
	return queued;
}

/**
 * Session-start replay. Uses store.recoverable() (queued rows included) rather
 * than deliveryRetryDue, matching [subagent-done] restore. Replays the existing
 * row — never create() a second identity.
 */
export function recoverDurableFollowUps(
	sessionKey: string,
	ctx: DurableFollowUpContext & { store: DeliveryObligationStore },
	envelopeFor?: (record: DeliveryObligation) => Pick<DurableFollowUpMeta, "customType" | "display" | "details">,
): number {
	if (ctx.currentSessionKey && ctx.currentSessionKey() !== sessionKey) return 0;
	const label = ctx.logLabel ?? "pipiui";
	let sent = 0;
	for (const { record, ambiguous } of ctx.store.recoverable()) {
		let attempting: DeliveryObligation | undefined;
		try {
			attempting = ctx.store.beginAttempt(record.id);
		} catch (err) {
			console.error(`[${label}] follow-up obligation recover begin failed:`, err);
			continue;
		}
		if (!attempting) continue;
		const overlay = envelopeFor?.(record);
		const prefix = ambiguous
			? `(recovered delivery: this follow-up may already have been queued or persisted before restart; obligationId=${record.id}; treat it as the same event.)\n`
			: record.attempts > 0
				? `(re-delivery #${attempting.attempts}: Pi did not confirm the prior follow-up; obligationId=${record.id}; treat it as the same event.)\n`
				: "";
		const queued = queueFollowUpWake(ctx.pi, {
			customType: overlay?.customType ?? "pipiui-follow-up-v1",
			content: `${prefix}${record.text}`,
			display: overlay?.display !== false,
			details: { ...(overlay?.details ?? {}), obligationId: attempting.id },
		}, label);
		try {
			ctx.store.finishAttempt(attempting.id, queued);
		} catch (err) {
			console.error(`[${label}] follow-up obligation recover ${queued ? "queue" : "fail"} failed:`, err);
		}
		if (queued) sent += 1;
	}
	return sent;
}
