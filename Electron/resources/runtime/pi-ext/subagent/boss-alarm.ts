import { createHash } from "node:crypto";

import {
	DeliveryObligationStore,
	type DeliveryObligation,
} from "./delivery-obligation.ts";

export interface BossAlarmStore {
	readAlarmEpisode(agentId: string, runId: string): DeliveryObligation | undefined;
	markAlarmEpisodeAcknowledged(agentId: string, runId: string, note?: string): DeliveryObligation[];
}

function digest(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * In-memory fail-closed fallback for a persistence-create failure. Identity is
 * stable for one process/session so duplicate callbacks never mint an
 * unacknowledgeable random alarm. It deliberately makes no restart claim.
 */
export class VolatileBossAlarmStore implements BossAlarmStore {
	private readonly rows = new Map<string, DeliveryObligation>();
	private readonly now: () => number;

	constructor(options: { now?: () => number } = {}) {
		this.now = options.now ?? Date.now;
	}

	create(agentId: string, runId: string, text: string, identityNamespace?: string): DeliveryObligation {
		const id = `volatile-${digest(`${identityNamespace ?? "completion"}\0${agentId}\0${runId}`)}`;
		const existing = this.rows.get(id);
		if (existing?.state === "acknowledged") return existing;
		const now = this.now();
		const row: DeliveryObligation = existing
			? { ...existing, text, payloadHash: digest(text), updatedAt: now }
			: {
				version: 1,
				id,
				routingKeyHash: "volatile",
				agentId,
				runId,
				payloadHash: digest(text),
				text,
				state: "pending",
				attempts: 0,
				createdAt: now,
				updatedAt: now,
				lastAttemptAt: 0,
				acknowledgementRequired: true,
			};
		this.rows.set(id, row);
		return row;
	}

	read(id: string): DeliveryObligation | undefined {
		return this.rows.get(id);
	}

	readAlarmEpisode(agentId: string, runId: string): DeliveryObligation | undefined {
		const matches = [...this.rows.values()].filter((row) => row.agentId === agentId && row.runId === runId);
		return matches.find((row) => row.state !== "acknowledged") ?? matches[0];
	}

	markAlarmEpisodeAcknowledged(agentId: string, runId: string, note?: string): DeliveryObligation[] {
		const normalizedNote = typeof note === "string"
			? note.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ").trim().replace(/\s+/gu, " ").slice(0, 500)
			: "";
		const now = this.now();
		const acknowledged: DeliveryObligation[] = [];
		for (const [id, row] of this.rows) {
			if (row.agentId !== agentId || row.runId !== runId) continue;
			const next: DeliveryObligation = {
				...row,
				state: "acknowledged",
				updatedAt: now,
				acknowledgedAt: now,
				...(normalizedNote ? { acknowledgementNote: normalizedNote } : {}),
			};
			this.rows.set(id, next);
			acknowledged.push(next);
		}
		return acknowledged;
	}
}

export interface BossAlarmAckResult {
	ok: boolean;
	message: string;
	idempotent?: boolean;
}

export function shouldArmBossAlarmForJobState(state: string | undefined): boolean {
	return state === "ok" || state === "failed" || state === "aborted" || state === "interrupted";
}

export function formatBossAlarmMessage(input: {
	text: string;
	agentId: string;
	runId: string;
}): string {
	return [
		input.text,
		`[boss-alarm] This exact terminal episode remains armed until explicit acknowledgement. Inspect it with subagent_status({agentId:"${input.agentId}"}), then handle, integrate, resume, re-dispatch, or escalate as appropriate.`,
		`After handling, call subagent_alarm_ack({agentId:"${input.agentId}", runId:"${input.runId}", note:"what you did"}) (or /subagent_alarm_ack ${input.agentId} ${input.runId} what-you-did). A text-only reply does not stop this alarm. subagent_resolve remains separate for abnormal closeout and worktree cleanup.`,
	].join("\n");
}

export function acknowledgeBossAlarm(
	store: BossAlarmStore | DeliveryObligationStore | undefined,
	input: {
		agentId: string;
		runId: string;
		note?: string;
		currentJob?: { runId: string; state: string };
	},
): BossAlarmAckResult {
	const record = store?.readAlarmEpisode(input.agentId, input.runId);
	if (!record && input.currentJob && input.currentJob.runId !== input.runId) {
		return {
			ok: false,
			message: `Alarm acknowledgement rejected for agentId=${input.agentId}: stale runId=${input.runId}; currentRunId=${input.currentJob.runId}.`,
		};
	}
	if (input.currentJob?.runId === input.runId && input.currentJob.state === "running") {
		return {
			ok: false,
			message: `Cannot acknowledge alarm for agentId=${input.agentId} runId=${input.runId}: job is still running.`,
		};
	}
	if (!record) {
		return {
			ok: false,
			message: `Cannot acknowledge alarm for agentId=${input.agentId} runId=${input.runId}: no terminal alarm exists for this exact episode in the active Pi session.`,
		};
	}
	if (record.state === "acknowledged") {
		return {
			ok: true,
			idempotent: true,
			message: `Alarm already acknowledged for agentId=${input.agentId} runId=${input.runId}.`,
		};
	}
	const acknowledged = store?.markAlarmEpisodeAcknowledged(input.agentId, input.runId, input.note) ?? [];
	if (acknowledged.length === 0) {
		return {
			ok: false,
			message: `Failed to persist alarm acknowledgement for agentId=${input.agentId} runId=${input.runId}.`,
		};
	}
	return {
		ok: true,
		idempotent: false,
		message: `Acknowledged Boss alarm for agentId=${input.agentId} runId=${input.runId}; recurring wakes stopped.`,
	};
}
