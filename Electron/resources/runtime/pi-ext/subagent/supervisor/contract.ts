/**
 * Supervisor domain contract (S1).
 *
 * Pure types, constructors, and invariant checks. No AgentSession, no
 * scheduling, and no runtime event wiring — later tasks implement against this.
 */

export const BOSS_ESCALATION_MAX_UTF8_BYTES = 8 * 1024;

export const SUPERVISOR_EVENT_KINDS = [
	"heartbeat",
	"stall",
	"completion",
	"wave",
	"upgrade_failure",
	"watch",
] as const;

/** Compact watch samples are hard-bounded so periodic ticks cannot bloat Supervisor packets. */
export const WATCH_SUMMARY_MAX_CHARS = 600;
export const WATCH_EVIDENCE_REF_MAX_CHARS = 200;
export const WATCH_MAX_EVIDENCE_REFS = 16;

export type SupervisorEventKind = (typeof SUPERVISOR_EVENT_KINDS)[number];

export const SUPERVISOR_ACTION_KINDS = [
	"status",
	"wait",
	"resume",
	"retry",
	"abort",
	"resolve",
	"start_declared",
	"forward",
	"escalate",
] as const;

export type SupervisorActionKind = (typeof SUPERVISOR_ACTION_KINDS)[number];

export const SUPERVISOR_JOB_STATUSES = [
	"running",
	"stalled",
	"waiting",
	"completed",
	"failed",
	"interrupted",
] as const;

export type SupervisorJobStatus = (typeof SUPERVISOR_JOB_STATUSES)[number];

export const SUPERVISOR_TASK_STATUSES = [
	"declared",
	"running",
	"blocked",
	"completed",
	"failed",
] as const;

export type SupervisorTaskStatus = (typeof SUPERVISOR_TASK_STATUSES)[number];

export const BOSS_ESCALATION_KINDS = ["escalate", "wave_summary"] as const;

/** Stable identity for one terminal wave closeout across concurrent worker completions. */
export const SUPERVISOR_WAVE_AGENT_ID = "wave";

export type BossEscalationKind = (typeof BOSS_ESCALATION_KINDS)[number];

const FORBIDDEN_TRANSCRIPT_KEYS = ["transcript", "messages", "findings"] as const;

export type ContractResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: string };

export interface SupervisorReceiptIdentity {
	eventId: string;
	agentId: string;
	runId: string;
	kind: SupervisorEventKind;
	sequence: number;
	waveId?: string;
}

export interface SupervisorJobSnapshot {
	agentId: string;
	runId: string;
	status: SupervisorJobStatus;
	title?: string;
	elapsedMs?: number;
	lastActivityAt?: number;
	verify?: "passed" | "failed" | "skipped" | "none";
}

export interface SupervisorTaskSnapshot {
	taskId: string;
	title: string;
	status: SupervisorTaskStatus;
	blockedBy?: string[];
}

export interface SupervisorWaveSnapshot {
	waveId: string;
	running: number;
	completed: number;
	failed: number;
	agentIds: string[];
}

export interface SupervisorEvent {
	identity: SupervisorReceiptIdentity;
	occurredAt: number;
	job: SupervisorJobSnapshot;
	summary: string;
	task?: SupervisorTaskSnapshot;
	wave?: SupervisorWaveSnapshot;
	evidenceRefs?: string[];
}

export interface SupervisorAction {
	kind: SupervisorActionKind;
	agentId?: string;
	runId?: string;
	taskId?: string;
	reason?: string;
}

export interface SupervisorDecision {
	action: SupervisorActionKind;
	taskId?: string;
	reason?: string;
	recommendedAction?: string;
	evidenceRefs?: string[];
}

export interface SupervisorInputPacket {
	event: SupervisorEvent;
	activeJobs: SupervisorJobSnapshot[];
	tasks: SupervisorTaskSnapshot[];
	priorAction?: SupervisorAction;
}

export interface BossEscalationEnvelope {
	eventId: string;
	agentId: string;
	runId: string;
	kind: BossEscalationKind;
	reason: string;
	evidenceRefs: string[];
	recommendedAction?: string;
}

export function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

export function isSupervisorEventKind(value: unknown): value is SupervisorEventKind {
	return typeof value === "string" && (SUPERVISOR_EVENT_KINDS as readonly string[]).includes(value);
}

export function isSupervisorActionKind(value: unknown): value is SupervisorActionKind {
	return typeof value === "string" && (SUPERVISOR_ACTION_KINDS as readonly string[]).includes(value);
}

export function isRoutineEventKind(kind: SupervisorEventKind): boolean {
	// watch is a routine bounded sample: its Boss delivery is decided by the
	// Supervisor action (wait/status stay silent; forward/escalate wake Boss).
	return kind === "heartbeat" || kind === "completion" || kind === "watch";
}

export function requiresBossDelivery(decision: SupervisorDecision): boolean {
	return decision.action === "escalate";
}

function fail(error: string): { ok: false; error: string } {
	return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredToken(value: unknown, label: string): ContractResult<string> {
	if (typeof value !== "string" || value.trim().length === 0) {
		return fail(`${label} must be a non-empty string`);
	}
	return { ok: true, value: value.trim() };
}

function optionalToken(value: unknown, label: string): ContractResult<string | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	return requiredToken(value, label);
}

function requiredInt(value: unknown, label: string): ContractResult<number> {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		return fail(`${label} must be a non-negative integer`);
	}
	return { ok: true, value };
}

function optionalInt(value: unknown, label: string): ContractResult<number | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	return requiredInt(value, label);
}

function rejectTranscriptFields(value: Record<string, unknown>, label: string): ContractResult<void> {
	for (const key of FORBIDDEN_TRANSCRIPT_KEYS) {
		if (key in value) return fail(`${label} must not include ${key}`);
	}
	return { ok: true, value: undefined };
}

function parseEvidenceRefs(value: unknown, label: string): ContractResult<string[] | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
		return fail(`${label} must be an array of non-empty strings`);
	}
	return { ok: true, value: value.map((entry) => entry.trim()) };
}

function enforceWatchBounds(summary: string, evidenceRefs: string[] | undefined): ContractResult<void> {
	if (summary.length > WATCH_SUMMARY_MAX_CHARS) {
		return fail(`watch summary exceeds ${WATCH_SUMMARY_MAX_CHARS} characters`);
	}
	if (evidenceRefs && evidenceRefs.length > WATCH_MAX_EVIDENCE_REFS) {
		return fail(`watch evidenceRefs exceed ${WATCH_MAX_EVIDENCE_REFS} entries`);
	}
	if (evidenceRefs?.some((ref) => ref.length > WATCH_EVIDENCE_REF_MAX_CHARS)) {
		return fail(`watch evidence ref exceeds ${WATCH_EVIDENCE_REF_MAX_CHARS} characters`);
	}
	return { ok: true, value: undefined };
}

export function createReceiptIdentity(input: {
	kind: SupervisorEventKind;
	agentId: string;
	runId: string;
	sequence: number;
	waveId?: string;
}): ContractResult<SupervisorReceiptIdentity> {
	if (!isSupervisorEventKind(input.kind)) return fail("kind is not a bounded Supervisor event");
	const agentId = requiredToken(input.agentId, "agentId");
	if (agentId.ok === false) return agentId;
	const runId = requiredToken(input.runId, "runId");
	if (runId.ok === false) return runId;
	const sequence = requiredInt(input.sequence, "sequence");
	if (sequence.ok === false) return sequence;
	const waveId = optionalToken(input.waveId, "waveId");
	if (waveId.ok === false) return waveId;
	const parts = [input.kind, agentId.value, runId.value, waveId.value ?? "-", String(sequence.value)];
	return {
		ok: true,
		value: {
			eventId: parts.join(":"),
			kind: input.kind,
			agentId: agentId.value,
			runId: runId.value,
			sequence: sequence.value,
			...(waveId.value !== undefined ? { waveId: waveId.value } : {}),
		},
	};
}

export function createJobSnapshot(input: {
	agentId: string;
	runId: string;
	status: SupervisorJobStatus;
	title?: string;
	elapsedMs?: number;
	lastActivityAt?: number;
	verify?: SupervisorJobSnapshot["verify"];
}): ContractResult<SupervisorJobSnapshot> {
	if (!isRecord(input)) return fail("job snapshot must be an object");
	const transcript = rejectTranscriptFields(input, "job snapshot");
	if (transcript.ok === false) return transcript;
	const agentId = requiredToken(input.agentId, "job.agentId");
	if (agentId.ok === false) return agentId;
	const runId = requiredToken(input.runId, "job.runId");
	if (runId.ok === false) return runId;
	if (!(SUPERVISOR_JOB_STATUSES as readonly string[]).includes(input.status)) {
		return fail("job.status is not a compact snapshot status");
	}
	const elapsedMs = optionalInt(input.elapsedMs, "job.elapsedMs");
	if (elapsedMs.ok === false) return elapsedMs;
	const lastActivityAt = optionalInt(input.lastActivityAt, "job.lastActivityAt");
	if (lastActivityAt.ok === false) return lastActivityAt;
	const title = optionalToken(input.title, "job.title");
	if (title.ok === false) return title;
	return {
		ok: true,
		value: {
			agentId: agentId.value,
			runId: runId.value,
			status: input.status,
			...(title.value !== undefined ? { title: title.value } : {}),
			...(elapsedMs.value !== undefined ? { elapsedMs: elapsedMs.value } : {}),
			...(lastActivityAt.value !== undefined ? { lastActivityAt: lastActivityAt.value } : {}),
			...(input.verify !== undefined ? { verify: input.verify } : {}),
		},
	};
}

export function createSupervisorEvent(input: {
	kind: SupervisorEventKind;
	agentId: string;
	runId: string;
	sequence: number;
	occurredAt: number;
	job: SupervisorJobSnapshot;
	summary: string;
	waveId?: string;
	task?: SupervisorTaskSnapshot;
	wave?: SupervisorWaveSnapshot;
	evidenceRefs?: string[];
}): ContractResult<SupervisorEvent> {
	if (!isRecord(input)) return fail("event must be an object");
	const transcript = rejectTranscriptFields(input, "event");
	if (transcript.ok === false) return transcript;
	const identity = createReceiptIdentity(input);
	if (identity.ok === false) return identity;
	const occurredAt = requiredInt(input.occurredAt, "occurredAt");
	if (occurredAt.ok === false) return occurredAt;
	const summary = requiredToken(input.summary, "summary");
	if (summary.ok === false) return summary;
	const job = createJobSnapshot(input.job);
	if (job.ok === false) return job;
	if (job.value.agentId !== identity.value.agentId || job.value.runId !== identity.value.runId) {
		return fail("job snapshot identity must match the event receipt");
	}
	const evidenceRefs = parseEvidenceRefs(input.evidenceRefs, "evidenceRefs");
	if (evidenceRefs.ok === false) return evidenceRefs;
	if (identity.value.kind === "watch") {
		const bounds = enforceWatchBounds(summary.value, evidenceRefs.value);
		if (bounds.ok === false) return bounds;
	}
	if (input.wave && identity.value.waveId && input.wave.waveId !== identity.value.waveId) {
		return fail("wave snapshot must match the receipt waveId");
	}
	return {
		ok: true,
		value: {
			identity: identity.value,
			occurredAt: occurredAt.value,
			job: job.value,
			summary: summary.value,
			...(input.task ? { task: input.task } : {}),
			...(input.wave ? { wave: input.wave } : {}),
			...(evidenceRefs.value ? { evidenceRefs: evidenceRefs.value } : {}),
		},
	};
}

export function validateSupervisorEvent(value: unknown): ContractResult<SupervisorEvent> {
	if (!isRecord(value)) return fail("event must be an object");
	const transcript = rejectTranscriptFields(value, "event");
	if (transcript.ok === false) return transcript;
	if (!isRecord(value.identity)) return fail("event.identity is required");
	if (!isRecord(value.job)) return fail("event.job is required");
	const identity = createReceiptIdentity({
		kind: value.identity.kind as SupervisorEventKind,
		agentId: String(value.identity.agentId ?? ""),
		runId: String(value.identity.runId ?? ""),
		sequence: value.identity.sequence as number,
		waveId: value.identity.waveId as string | undefined,
	});
	if (identity.ok === false) return identity;
	if (typeof value.identity.eventId === "string" && value.identity.eventId !== identity.value.eventId) {
		return fail("event.identity.eventId does not match durable receipt coordinates");
	}
	return createSupervisorEvent({
		kind: identity.value.kind,
		agentId: identity.value.agentId,
		runId: identity.value.runId,
		sequence: identity.value.sequence,
		waveId: identity.value.waveId,
		occurredAt: value.occurredAt as number,
		job: value.job as unknown as SupervisorJobSnapshot,
		summary: String(value.summary ?? ""),
		task: value.task as SupervisorTaskSnapshot | undefined,
		wave: value.wave as SupervisorWaveSnapshot | undefined,
		evidenceRefs: value.evidenceRefs as string[] | undefined,
	});
}

export function createSupervisorDecision(input: unknown): ContractResult<SupervisorDecision> {
	if (!isRecord(input)) return fail("decision must be an object");
	const transcript = rejectTranscriptFields(input, "decision");
	if (transcript.ok === false) return transcript;
	if (!isSupervisorActionKind(input.action)) return fail("decision.action is not a Supervisor action");
	const reason = optionalToken(input.reason, "decision.reason");
	if (reason.ok === false) return reason;
	const recommendedAction = optionalToken(input.recommendedAction, "decision.recommendedAction");
	if (recommendedAction.ok === false) return recommendedAction;
	const taskId = optionalToken(input.taskId, "decision.taskId");
	if (taskId.ok === false) return taskId;
	const evidenceRefs = parseEvidenceRefs(input.evidenceRefs, "decision.evidenceRefs");
	if (evidenceRefs.ok === false) return evidenceRefs;
	return {
		ok: true,
		value: {
			action: input.action,
			...(reason.value !== undefined ? { reason: reason.value } : {}),
			...(recommendedAction.value !== undefined ? { recommendedAction: recommendedAction.value } : {}),
			...(taskId.value !== undefined ? { taskId: taskId.value } : {}),
			...(evidenceRefs.value ? { evidenceRefs: evidenceRefs.value } : {}),
		},
	};
}

export function waveReceiptIdentity(waveId: string): ContractResult<SupervisorReceiptIdentity> {
	return createReceiptIdentity({
		kind: "wave",
		agentId: SUPERVISOR_WAVE_AGENT_ID,
		runId: waveId,
		sequence: 1,
		waveId,
	});
}

export function createBossEscalation(input: unknown): ContractResult<BossEscalationEnvelope> {
	if (!isRecord(input)) return fail("escalation must be an object");
	const transcript = rejectTranscriptFields(input, "escalation");
	if (transcript.ok === false) return transcript;
	const eventId = requiredToken(input.eventId, "eventId");
	if (eventId.ok === false) return eventId;
	const agentId = requiredToken(input.agentId, "agentId");
	if (agentId.ok === false) return agentId;
	const runId = requiredToken(input.runId, "runId");
	if (runId.ok === false) return runId;
	if (!(BOSS_ESCALATION_KINDS as readonly string[]).includes(input.kind as string)) {
		return fail("escalation.kind must be escalate or wave_summary");
	}
	const reason = requiredToken(input.reason, "reason");
	if (reason.ok === false) return reason;
	const recommendedAction = optionalToken(input.recommendedAction, "recommendedAction");
	if (recommendedAction.ok === false) return recommendedAction;
	const evidenceRefs = parseEvidenceRefs(input.evidenceRefs ?? [], "evidenceRefs");
	if (evidenceRefs.ok === false) return evidenceRefs;
	const envelope: BossEscalationEnvelope = {
		eventId: eventId.value,
		agentId: agentId.value,
		runId: runId.value,
		kind: input.kind as BossEscalationKind,
		reason: reason.value,
		evidenceRefs: evidenceRefs.value ?? [],
		...(recommendedAction.value !== undefined ? { recommendedAction: recommendedAction.value } : {}),
	};
	const serialized = serializeBossEscalation(envelope);
	if (serialized.ok === false) return serialized;
	return { ok: true, value: envelope };
}

export function serializeBossEscalation(
	envelope: BossEscalationEnvelope,
): ContractResult<{ json: string; byteLength: number }> {
	const json = JSON.stringify(envelope);
	const byteLength = utf8ByteLength(json);
	if (byteLength > BOSS_ESCALATION_MAX_UTF8_BYTES) {
		return fail(`escalation exceeds 8 KiB UTF-8 limit (${byteLength} > ${BOSS_ESCALATION_MAX_UTF8_BYTES})`);
	}
	return { ok: true, value: { json, byteLength } };
}

export function escalationKindFor(event: SupervisorEvent): BossEscalationKind {
	return event.identity.kind === "wave" ? "wave_summary" : "escalate";
}
