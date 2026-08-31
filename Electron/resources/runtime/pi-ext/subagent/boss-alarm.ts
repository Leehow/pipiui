import { DeliveryObligationStore } from "./delivery-obligation.ts";

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
	store: DeliveryObligationStore | undefined,
	input: {
		agentId: string;
		runId: string;
		note?: string;
		currentJob?: { runId: string; state: string };
	},
): BossAlarmAckResult {
	if (input.currentJob && input.currentJob.runId !== input.runId) {
		return {
			ok: false,
			message: `Alarm acknowledgement rejected for agentId=${input.agentId}: stale runId=${input.runId}; currentRunId=${input.currentJob.runId}.`,
		};
	}
	if (input.currentJob?.state === "running") {
		return {
			ok: false,
			message: `Cannot acknowledge alarm for agentId=${input.agentId} runId=${input.runId}: job is still running.`,
		};
	}
	const record = store?.readAlarmEpisode(input.agentId, input.runId);
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
