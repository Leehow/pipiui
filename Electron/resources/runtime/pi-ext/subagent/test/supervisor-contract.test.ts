import test from "node:test";
import assert from "node:assert/strict";

import {
	BOSS_ESCALATION_MAX_UTF8_BYTES,
	WATCH_EVIDENCE_REF_MAX_CHARS,
	WATCH_MAX_EVIDENCE_REFS,
	WATCH_SUMMARY_MAX_CHARS,
	createBossEscalation,
	createFakeSupervisorSession,
	createJobSnapshot,
	createReceiptIdentity,
	createRecordingBossSink,
	createSupervisorDecision,
	createSupervisorEvent,
	createSupervisorRouter,
	isRoutineEventKind,
	serializeBossEscalation,
	utf8ByteLength,
	type ContractResult,
	type SupervisorDecision,
	type SupervisorEvent,
} from "../supervisor/index.ts";

function unwrap<T>(result: ContractResult<T>, label: string): T {
	assert.equal(result.ok, true, `${label}: ${result.ok ? "" : result.error}`);
	return result.value;
}

function heartbeatEvent(overrides: {
	agentId?: string;
	runId?: string;
	sequence?: number;
	waveId?: string;
} = {}): SupervisorEvent {
	const agentId = overrides.agentId ?? "worker-a";
	const runId = overrides.runId ?? "run-1";
	return unwrap(createSupervisorEvent({
		kind: "heartbeat",
		agentId,
		runId,
		sequence: overrides.sequence ?? 1,
		waveId: overrides.waveId,
		occurredAt: 1_700_000_000_000,
		job: unwrap(createJobSnapshot({
			agentId,
			runId,
			status: "running",
			title: "scan workspace",
			elapsedMs: 30_000,
			lastActivityAt: 1_700_000_000_000,
		}), "job"),
		summary: "idle 30s last=read",
	}), "heartbeat");
}

test("receipt identity is durable and stable for the same event coordinates", () => {
	const first = unwrap(createReceiptIdentity({
		kind: "completion",
		agentId: "worker-a",
		runId: "run-1",
		waveId: "wave-9",
		sequence: 3,
	}), "identity");
	const second = unwrap(createReceiptIdentity({
		kind: "completion",
		agentId: "worker-a",
		runId: "run-1",
		waveId: "wave-9",
		sequence: 3,
	}), "identity-again");
	assert.equal(first.eventId, second.eventId);
	assert.equal(first.agentId, "worker-a");
	assert.equal(first.runId, "run-1");
	assert.equal(first.kind, "completion");
	assert.equal(first.waveId, "wave-9");
	assert.equal(first.sequence, 3);
	assert.notEqual(first.eventId, unwrap(createReceiptIdentity({
		kind: "completion",
		agentId: "worker-a",
		runId: "run-2",
		waveId: "wave-9",
		sequence: 3,
	}), "other-run").eventId);
});

test("forward is a valid Supervisor decision and does not require a Boss escalation envelope", () => {
	const decision = createSupervisorDecision({
		action: "forward",
		reason: "boss can start follow-up",
	});
	assert.equal(decision.ok, true);
	if (decision.ok) {
		assert.equal(decision.value.action, "forward");
		assert.equal(decision.value.reason, "boss can start follow-up");
	}
});

test("normal heartbeat is handled by Supervisor with zero Boss provider turns", async () => {
	const boss = createRecordingBossSink();
	const supervisor = createFakeSupervisorSession({
		decide: (): SupervisorDecision => ({ action: "status" }),
	});
	const router = createSupervisorRouter({ supervisor, boss });

	const result = await router.route(heartbeatEvent());

	assert.equal(result.outcome, "handled");
	assert.equal(result.decision?.action, "status");
	assert.equal(result.supervisorPrompts, 1);
	assert.equal(result.bossRequests, 0);
	assert.equal(supervisor.promptCount, 1);
	assert.equal(supervisor.providerRequestCount, 1);
	assert.equal(boss.requestCount, 0);
	assert.equal(boss.envelopes.length, 0);
	assert.equal(router.supervisorPromptCount, 1);
	assert.equal(router.bossRequestCount, 0);
});

test("escalation sends exactly one bounded Boss request with evidence refs", async () => {
	const boss = createRecordingBossSink();
	const supervisor = createFakeSupervisorSession({
		decide: (): SupervisorDecision => ({
			action: "escalate",
			reason: "verify failed after stall",
			recommendedAction: "ask the user whether to retry or abandon",
			evidenceRefs: ["artifact://verify/worker-a/run-1"],
		}),
	});
	const router = createSupervisorRouter({ supervisor, boss });
	const event = unwrap(createSupervisorEvent({
		kind: "upgrade_failure",
		agentId: "worker-a",
		runId: "run-1",
		sequence: 4,
		occurredAt: 1_700_000_000_100,
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "failed",
			verify: "failed",
		}), "failed-job"),
		summary: "verify exit 1",
		evidenceRefs: ["artifact://verify/worker-a/run-1"],
	}), "upgrade");

	const result = await router.route(event);

	assert.equal(result.outcome, "escalated");
	assert.equal(result.supervisorPrompts, 1);
	assert.equal(result.bossRequests, 1);
	assert.equal(boss.requestCount, 1);
	assert.equal(boss.envelopes.length, 1);
	const envelope = boss.envelopes[0];
	assert.equal(envelope.eventId, event.identity.eventId);
	assert.equal(envelope.agentId, "worker-a");
	assert.equal(envelope.runId, "run-1");
	assert.equal(envelope.kind, "escalate");
	assert.deepEqual(envelope.evidenceRefs, ["artifact://verify/worker-a/run-1"]);
	assert.equal("transcript" in envelope, false);
	assert.equal("messages" in envelope, false);
	assert.equal("findings" in envelope, false);
	const serialized = unwrap(serializeBossEscalation(envelope), "serialize");
	assert.ok(serialized.byteLength <= BOSS_ESCALATION_MAX_UTF8_BYTES);
	assert.equal(serialized.byteLength, utf8ByteLength(serialized.json));
});

test("duplicate event receipt identity does not re-prompt Supervisor or Boss", async () => {
	const boss = createRecordingBossSink();
	const supervisor = createFakeSupervisorSession({
		decide: (): SupervisorDecision => ({
			action: "escalate",
			reason: "wave closed",
			evidenceRefs: ["wave://wave-9"],
		}),
	});
	const router = createSupervisorRouter({ supervisor, boss });
	const event = unwrap(createSupervisorEvent({
		kind: "wave",
		agentId: "worker-a",
		runId: "run-1",
		waveId: "wave-9",
		sequence: 8,
		occurredAt: 1_700_000_000_200,
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "completed",
		}), "done-job"),
		summary: "wave complete",
		wave: { waveId: "wave-9", running: 0, completed: 2, failed: 0, agentIds: ["worker-a", "worker-b"] },
	}), "wave");

	const first = await router.route(event);
	const second = await router.route(event);

	assert.equal(first.outcome, "escalated");
	assert.equal(first.bossRequests, 1);
	assert.equal(second.outcome, "duplicate");
	assert.equal(second.receiptId, first.receiptId);
	assert.equal(second.supervisorPrompts, 0);
	assert.equal(second.bossRequests, 0);
	assert.equal(supervisor.promptCount, 1);
	assert.equal(boss.requestCount, 1);
	assert.equal(router.supervisorPromptCount, 1);
	assert.equal(router.bossRequestCount, 1);
});

test("invalid events and oversized Boss payloads are rejected without a Boss send", async () => {
	const boss = createRecordingBossSink();
	const supervisor = createFakeSupervisorSession({
		decide: (): SupervisorDecision => ({
			action: "escalate",
			reason: "x".repeat(BOSS_ESCALATION_MAX_UTF8_BYTES + 32),
			evidenceRefs: ["artifact://too-large"],
		}),
	});
	const router = createSupervisorRouter({ supervisor, boss });

	const invalid = await router.route({
		identity: {
			eventId: "",
			agentId: "",
			runId: "",
			kind: "heartbeat",
			sequence: 1,
		},
		occurredAt: 0,
		job: { agentId: "", runId: "", status: "running" },
		summary: "",
	} as SupervisorEvent);

	assert.equal(invalid.outcome, "rejected");
	assert.equal(invalid.supervisorPrompts, 0);
	assert.equal(invalid.bossRequests, 0);
	assert.equal(supervisor.promptCount, 0);

	const oversized = await router.route(unwrap(createSupervisorEvent({
		kind: "upgrade_failure",
		agentId: "worker-a",
		runId: "run-1",
		sequence: 9,
		occurredAt: 1_700_000_000_300,
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "failed",
		}), "oversized-job"),
		summary: "provider error",
	}), "oversized-event"));

	assert.equal(oversized.outcome, "rejected");
	assert.equal(oversized.supervisorPrompts, 1);
	assert.equal(oversized.bossRequests, 0);
	assert.equal(boss.requestCount, 0);
	assert.match(oversized.error ?? "", /8 KiB|8192|too large|oversized/i);

	const withTranscript = createBossEscalation({
		eventId: "evt-1",
		agentId: "worker-a",
		runId: "run-1",
		kind: "escalate",
		reason: "need help",
		evidenceRefs: ["artifact://ok"],
		transcript: "full worker log",
	} as Record<string, unknown>);
	assert.equal(withTranscript.ok, false);
	if (!withTranscript.ok) {
		assert.match(withTranscript.error, /transcript/i);
	}
});

test("watch is a distinct routine kind whose receipts cannot collide with heartbeat", () => {
	const heartbeat = heartbeatEvent();
	const watch = unwrap(createSupervisorEvent({
		kind: "watch",
		agentId: "worker-a",
		runId: "run-1",
		sequence: 1,
		occurredAt: 1_700_000_000_500,
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "running",
			verify: "none",
			lastActivityAt: 1_700_000_000_500,
		}), "watch-job"),
		summary: "status=running phase=generating activity=+128B verify=none",
		evidenceRefs: ["artifact://status/worker-a/run-1"],
	}), "watch");

	assert.equal(watch.identity.kind, "watch");
	assert.notEqual(watch.identity.eventId, heartbeat.identity.eventId);
	assert.equal(watch.identity.eventId, "watch:worker-a:run-1:-:1");
	assert.equal(isRoutineEventKind("watch"), true);
	assert.deepEqual(watch.evidenceRefs, ["artifact://status/worker-a/run-1"]);
});

type SupervisorEventInput = Parameters<typeof createSupervisorEvent>[0];

function watchInput(overrides: Partial<SupervisorEventInput> = {}): SupervisorEventInput {
	return {
		kind: "watch",
		agentId: "worker-a",
		runId: "run-1",
		sequence: 2,
		occurredAt: 1_700_000_000_600,
		job: { agentId: "worker-a", runId: "run-1", status: "running", verify: "none" },
		summary: "status=running phase=generating verify=none",
		evidenceRefs: ["artifact://status/worker-a/run-1"],
		...overrides,
	};
}

test("watch packets are bounded: summary and evidence refs stay compact", () => {
	const oversizedSummary = createSupervisorEvent(watchInput({
		summary: "x".repeat(WATCH_SUMMARY_MAX_CHARS + 1),
	}));
	assert.equal(oversizedSummary.ok, false);
	if (!oversizedSummary.ok) assert.match(oversizedSummary.error, /watch summary exceeds/);

	const tooManyRefs = createSupervisorEvent(watchInput({
		evidenceRefs: Array.from({ length: WATCH_MAX_EVIDENCE_REFS + 1 }, (_, i) => `artifact://ref/${i}`),
	}));
	assert.equal(tooManyRefs.ok, false);
	if (!tooManyRefs.ok) assert.match(tooManyRefs.error, /watch evidenceRefs exceed/);

	const overlongRef = createSupervisorEvent(watchInput({
		evidenceRefs: ["artifact://ref/" + "y".repeat(WATCH_EVIDENCE_REF_MAX_CHARS)],
	}));
	assert.equal(overlongRef.ok, false);
	if (!overlongRef.ok) assert.match(overlongRef.error, /watch evidence ref exceeds/);

	const atBounds = createSupervisorEvent(watchInput({
		summary: "x".repeat(WATCH_SUMMARY_MAX_CHARS),
		evidenceRefs: Array.from({ length: WATCH_MAX_EVIDENCE_REFS }, (_, i) => `artifact://ref/${i}`),
	}));
	assert.equal(atBounds.ok, true, `${atBounds.ok ? "" : atBounds.error}`);

	const withTranscript = createSupervisorEvent(watchInput({ transcript: "full worker log" } as Partial<SupervisorEventInput>));
	assert.equal(withTranscript.ok, false);
	if (!withTranscript.ok) assert.match(withTranscript.error, /transcript/i);
});
