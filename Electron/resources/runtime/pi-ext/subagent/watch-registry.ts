/**
 * Process-local subscription registry for the Boss-side `subagent_watch`
 * control surface.
 *
 * Pure state, deliberately dependency-free: no timers (the single shared 30s
 * subagent watchdog drives sampling through `tick`), no I/O, no imports. The
 * registry only owns subscription bookkeeping — exact `{agentId, runId}`
 * identity, deterministic interval/next-due arithmetic, compact snapshot
 * fingerprint change detection, per-pair monotonic event sequences for
 * exact-once watch receipts, and stale/terminal cleanup primitives. Whether an
 * exact run is still live stays in index.ts (`handleForRun`); an observation
 * that comes back `undefined` means "this exact run is gone" and drops the
 * subscription, because the normal completion delivery owns terminal
 * notification.
 *
 * Emission contract: no fingerprint change, no event. A duplicate `start` for
 * the already-subscribed exact run is an idempotent same-identity re-arm (the
 * way existing tools treat repeated same-target mutations): it re-baselines
 * and re-arms the cadence but never rewinds the receipt sequence. While one
 * emitted event is in flight, later changes coalesce into a single pending
 * slot — never a queue — and `ack` settles the exact sequence.
 */

export const WATCH_INTERVAL_MIN_SECS = 30;
export const WATCH_INTERVAL_MAX_SECS = 3600;
/** Cadence used when a start omits the interval: the progress-report default. */
export const DEFAULT_WATCH_INTERVAL_SECS = 60;
/** Hard subscription cap: watch is a bounded Boss-side surface, never a timer farm. */
export const MAX_WATCH_SUBSCRIPTIONS = 128;
/** Hard cap on retained sequence tombstones to ensure strictly bounded memory. */
export const MAX_WATCH_RETAINED_SEQUENCES = 1024;

/** Semantic action vocabulary of the `subagent_watch` tool. */
export const WATCH_ACTIONS = ["start", "update", "stop", "list"] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];

export interface WatchTarget {
	agentId: string;
	runId: string;
}

export interface WatchSubscriptionView {
	agentId: string;
	runId: string;
	intervalSecs: number;
	intervalMs: number;
	nextSampleAt: number;
	startedAt: number;
	/** Sequence of the most recently emitted watch event; 0 = baseline only. */
	lastEventSeq: number;
	/** An emitted event has not been settled by `ack` yet. */
	inFlight: boolean;
	/** A later change was coalesced into the single pending slot while in flight. */
	pendingChange: boolean;
}

export interface WatchTickEvent {
	agentId: string;
	runId: string;
	sequence: number;
	/** Compact snapshot fingerprint whose change earned this event. */
	fingerprint: string;
}

export type WatchRejection = { ok: false; problem: string };
export type WatchStartResult =
	| { ok: true; subscription: WatchSubscriptionView; created: boolean }
	| WatchRejection;
export type WatchUpdateResult =
	| { ok: true; subscription: WatchSubscriptionView }
	| WatchRejection;
export type WatchAckResult =
	| { ok: true; pending: boolean }
	| WatchRejection;

export interface WatchRegistry {
	readonly size: number;
	start(input: WatchTarget & { now: number; fingerprint: string; intervalSecs?: number }): WatchStartResult;
	/** Re-arms cadence only: identity, baseline, and receipt sequence stay. */
	update(input: WatchTarget & { now: number; intervalSecs?: number }): WatchUpdateResult;
	stop(input: WatchTarget): { removed: boolean };
	list(filter?: Partial<WatchTarget>): WatchSubscriptionView[];
	tick(input: { now: number; observe: (target: WatchTarget) => string | undefined }): WatchTickEvent[];
	/** Settles the exact in-flight receipt sequence; surfaces coalesced changes. */
	ack(input: WatchTarget & { sequence: number }): WatchAckResult;
	/** Drops every subscription whose exact run fails the caller's liveness check. */
	prune(isLive: (target: WatchTarget) => boolean): WatchTarget[];
	clear(): void;
}

interface WatchSubscription extends WatchTarget {
	intervalMs: number;
	nextSampleAt: number;
	startedAt: number;
	lastFingerprint: string;
	/** Monotonic per exact pair; never reset by a duplicate start. */
	eventSeq: number;
	/** Sequence handed out by the last emission, until `ack` settles it. */
	inFlightSeq: number | undefined;
	/** Single coalescing slot: latest change seen while an event was in flight. */
	pendingFingerprint: string | undefined;
}

export function sanitizeWatchTarget(agentId: string, runId: string): { value: WatchTarget } | { problem: string } {
	const trimmedAgentId = typeof agentId === "string" ? agentId.trim() : "";
	const trimmedRunId = typeof runId === "string" ? runId.trim() : "";
	if (!trimmedAgentId) return { problem: "agentId must be a non-empty string." };
	if (!trimmedRunId) return { problem: "runId must be a non-empty string." };
	return { value: { agentId: trimmedAgentId, runId: trimmedRunId } };
}

export function sanitizeWatchIntervalSecs(raw: number | undefined): { secs: number } | { problem: string } {
	if (raw === undefined) return { secs: DEFAULT_WATCH_INTERVAL_SECS };
	if (!Number.isInteger(raw) || raw < WATCH_INTERVAL_MIN_SECS || raw > WATCH_INTERVAL_MAX_SECS) {
		return { problem: `intervalSecs must be an integer from ${WATCH_INTERVAL_MIN_SECS} to ${WATCH_INTERVAL_MAX_SECS} seconds.` };
	}
	return { secs: raw };
}

/**
 * Canonical compact fingerprint over bounded worker-state fields. Keys are
 * sorted and `undefined` fields omitted so the same observation always
 * serializes identically; fingerprint equality is what suppresses a tick.
 */
export function buildWatchFingerprint(fields: Record<string, string | number | boolean | undefined>): string {
	const parts: string[] = [];
	for (const key of Object.keys(fields).sort()) {
		const value = fields[key];
		if (value === undefined) continue;
		parts.push(`${key}=${String(value)}`);
	}
	return parts.join("\u0001");
}

function viewOf(sub: WatchSubscription): WatchSubscriptionView {
	return {
		agentId: sub.agentId,
		runId: sub.runId,
		intervalSecs: sub.intervalMs / 1000,
		intervalMs: sub.intervalMs,
		nextSampleAt: sub.nextSampleAt,
		startedAt: sub.startedAt,
		lastEventSeq: sub.eventSeq,
		inFlight: sub.inFlightSeq !== undefined,
		pendingChange: sub.pendingFingerprint !== undefined,
	};
}

function compareTargets(a: WatchTarget, b: WatchTarget): number {
	if (a.agentId !== b.agentId) return a.agentId < b.agentId ? -1 : 1;
	if (a.runId !== b.runId) return a.runId < b.runId ? -1 : 1;
	return 0;
}

export function createWatchRegistry(): WatchRegistry {
	const subscriptions = new Map<string, WatchSubscription>();
	const retainedSequences = new Map<string, number>();
	const watchKey = (target: WatchTarget): string => `${target.agentId}\u0000${target.runId}`;

	function recordSequence(key: string, seq: number): void {
		retainedSequences.delete(key);
		retainedSequences.set(key, seq);
		if (retainedSequences.size > MAX_WATCH_RETAINED_SEQUENCES) {
			for (const oldestKey of retainedSequences.keys()) {
				if (!subscriptions.has(oldestKey)) {
					retainedSequences.delete(oldestKey);
					break;
				}
			}
		}
	}

	return {
		get size(): number {
			return subscriptions.size;
		},

		start(input) {
			const target = sanitizeWatchTarget(input.agentId, input.runId);
			if ("problem" in target) return { ok: false, problem: target.problem };
			const interval = sanitizeWatchIntervalSecs(input.intervalSecs);
			if ("problem" in interval) return { ok: false, problem: interval.problem };
			const key = watchKey(target.value);
			const existing = subscriptions.get(key);
			if (!existing && subscriptions.size >= MAX_WATCH_SUBSCRIPTIONS) {
				return {
					ok: false,
					problem: `Watch subscription cap reached (${MAX_WATCH_SUBSCRIPTIONS}); stop unused subscriptions before starting more.`,
				};
			}
			const intervalMs = interval.secs * 1000;
			const eventSeq = existing ? existing.eventSeq : (retainedSequences.get(key) ?? 0);
			const inFlightSeq = existing ? existing.inFlightSeq : undefined;
			const next: WatchSubscription = {
				...target.value,
				intervalMs,
				nextSampleAt: input.now + intervalMs,
				startedAt: input.now,
				lastFingerprint: input.fingerprint,
				eventSeq,
				inFlightSeq,
				pendingFingerprint: undefined,
			};
			subscriptions.set(key, next);
			return { ok: true, subscription: viewOf(next), created: !existing };
		},

		update(input) {
			const target = sanitizeWatchTarget(input.agentId, input.runId);
			if ("problem" in target) return { ok: false, problem: target.problem };
			const existing = subscriptions.get(watchKey(target.value));
			if (!existing) {
				return {
					ok: false,
					problem: `No watch subscription for agentId=${target.value.agentId} runId=${target.value.runId}; start it before updating.`,
				};
			}
			if (input.intervalSecs !== undefined) {
				const interval = sanitizeWatchIntervalSecs(input.intervalSecs);
				if ("problem" in interval) return { ok: false, problem: interval.problem };
				existing.intervalMs = interval.secs * 1000;
			}
			existing.nextSampleAt = input.now + existing.intervalMs;
			return { ok: true, subscription: viewOf(existing) };
		},

		stop(input) {
			const target = sanitizeWatchTarget(input.agentId, input.runId);
			if ("problem" in target) return { removed: false };
			const key = watchKey(target.value);
			const existing = subscriptions.get(key);
			if (!existing) return { removed: false };
			recordSequence(key, existing.eventSeq);
			return { removed: subscriptions.delete(key) };
		},

		list(filter) {
			const views = [...subscriptions.values()]
				.filter((sub) =>
					(filter?.agentId === undefined || sub.agentId === filter.agentId)
					&& (filter?.runId === undefined || sub.runId === filter.runId))
				.map(viewOf);
			views.sort(compareTargets);
			return views;
		},

		tick(input) {
			const events: WatchTickEvent[] = [];
			for (const [key, sub] of subscriptions) {
				if (input.now < sub.nextSampleAt) continue;
				// One sample per due tick, always re-armed from `now`: missed
				// intervals collapse into a single observation, never a burst.
				sub.nextSampleAt = input.now + sub.intervalMs;
				const fingerprint = input.observe({ agentId: sub.agentId, runId: sub.runId });
				if (fingerprint === undefined) {
					// The exact run is gone (terminal/stale): drop the subscription so
					// completion delivery stays the only terminal notification.
					recordSequence(key, sub.eventSeq);
					subscriptions.delete(key);
					continue;
				}
				if (fingerprint === sub.lastFingerprint) continue;
				if (sub.inFlightSeq !== undefined) {
					// Coalesce into the single pending slot; never queue.
					sub.pendingFingerprint = fingerprint;
					continue;
				}
				sub.eventSeq += 1;
				sub.lastFingerprint = fingerprint;
				sub.inFlightSeq = sub.eventSeq;
				recordSequence(key, sub.eventSeq);
				events.push({ agentId: sub.agentId, runId: sub.runId, sequence: sub.eventSeq, fingerprint });
			}
			return events;
		},

		ack(input) {
			const target = sanitizeWatchTarget(input.agentId, input.runId);
			if ("problem" in target) return { ok: false, problem: target.problem };
			const sub = subscriptions.get(watchKey(target.value));
			if (!sub) {
				return {
					ok: false,
					problem: `No watch subscription for agentId=${target.value.agentId} runId=${target.value.runId}.`,
				};
			}
			if (sub.inFlightSeq !== input.sequence) {
				return {
					ok: false,
					problem: `Watch receipt mismatch for agentId=${target.value.agentId} runId=${target.value.runId}: sequence=${input.sequence} is not the in-flight event${sub.inFlightSeq === undefined ? " (none)" : ` (sequence=${sub.inFlightSeq})`}.`,
				};
			}
			sub.inFlightSeq = undefined;
			const pending = sub.pendingFingerprint !== undefined;
			sub.pendingFingerprint = undefined;
			return { ok: true, pending };
		},

		prune(isLive) {
			const removed: WatchTarget[] = [];
			for (const [key, sub] of subscriptions) {
				if (isLive({ agentId: sub.agentId, runId: sub.runId })) continue;
				recordSequence(key, sub.eventSeq);
				subscriptions.delete(key);
				removed.push({ agentId: sub.agentId, runId: sub.runId });
			}
			return removed;
		},

		clear() {
			for (const [key, sub] of subscriptions) {
				recordSequence(key, sub.eventSeq);
			}
			subscriptions.clear();
		},
	};
}
