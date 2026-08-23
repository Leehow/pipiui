import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DeliveryObligationStore } from "../delivery-obligation.ts";
import {
	createJobSnapshot,
	createRecordingBossSink,
	createSupervisorDelivery,
	createFakeSupervisorSession,
	type BossEscalationEnvelope,
	type SupervisorDeliveryRequest,
	type SupervisorJobSnapshot,
} from "../supervisor/index.ts";
import {
	createSupervisorOwnedTerminalCloseout,
	routeHostSupervisorDelivery,
	supervisorBossObligationNamespace,
} from "../supervisor/host-seam.ts";
import { SupervisorWaveIdentityTracker, summarizeSupervisorRuntimeWave } from "../supervisor/wave-identity.ts";
import { memorySupervisorStore } from "../supervisor/delivery.ts";

function job(agentId = "worker-a", runId = "run-1", status: SupervisorJobSnapshot["status"] = "stalled"): SupervisorJobSnapshot {
	const built = createJobSnapshot({ agentId, runId, status });
	assert.equal(built.ok, true);
	if (!built.ok) throw new Error(built.error);
	return built.value;
}

function request(overrides: Partial<SupervisorDeliveryRequest> = {}): SupervisorDeliveryRequest {
	const snapshot = overrides.job ?? job();
	return {
		kind: overrides.kind ?? "stall",
		agentId: overrides.agentId ?? snapshot.agentId,
		runId: overrides.runId ?? snapshot.runId,
		sequence: overrides.sequence ?? 1,
		publicText: overrides.publicText ?? "[subagent-stalled] agentId=worker-a",
		job: snapshot,
		summary: overrides.summary ?? "stalled",
		waveId: overrides.waveId,
		wave: overrides.wave,
		activeJobs: overrides.activeJobs,
	};
}

test("host seam leaves a refused Boss admission retryable and does not consume heartbeat delivery", async () => {
	let acceptBoss = false;
	let currentAttempts = 0;
	const supervisor = createFakeSupervisorSession({
		decide: () => ({ action: "escalate", reason: "needs Boss" }),
	});
	const delivery = createSupervisorDelivery({
		supervisor,
		boss: createRecordingBossSink(),
		activeWorkerCount: () => 1,
		deliverCurrent: () => {
			currentAttempts += 1;
			return acceptBoss;
		},
	});
	let heartbeatCount = 0;
	const signal = request();

	const first = await routeHostSupervisorDelivery(delivery, signal);
	if (first === "accepted") heartbeatCount += 1;
	assert.equal(first, "pending");
	assert.equal(heartbeatCount, 0, "the host counter only advances after Boss admission");
	assert.equal(supervisor.promptCount, 1);

	acceptBoss = true;
	const second = await routeHostSupervisorDelivery(delivery, signal);
	if (second === "accepted") heartbeatCount += 1;
	assert.equal(second, "accepted");
	assert.equal(heartbeatCount, 1);
	assert.equal(currentAttempts, 2, "the same pending receipt is retried at the host seam");
	assert.equal(supervisor.promptCount, 1, "redelivery bypasses a second Supervisor provider prompt");
});

test("host seam catches a rejected Boss admission without consuming counters or its receipt", async () => {
	let rejectBoss = true;
	let currentAttempts = 0;
	const store = memorySupervisorStore();
	const supervisor = createFakeSupervisorSession({
		decide: () => ({ action: "escalate", reason: "needs Boss" }),
	});
	const delivery = createSupervisorDelivery({
		supervisor,
		boss: createRecordingBossSink(),
		activeWorkerCount: () => 1,
		store,
		deliverCurrent: async () => {
			currentAttempts += 1;
			if (rejectBoss) throw new Error("Boss queue rejected admission");
			return true;
		},
	});
	const signal = request({ kind: "heartbeat", job: job("worker-a", "run-1", "running") });
	let heartbeatCount = 0;
	let stallNotifyCount = 0;

	const first = await routeHostSupervisorDelivery(delivery, signal);
	if (first === "accepted") {
		heartbeatCount += 1;
		stallNotifyCount += 1;
	}
	assert.equal(first, "pending");
	assert.equal(heartbeatCount, 0);
	assert.equal(stallNotifyCount, 0);
	assert.equal(currentAttempts, 1);
	assert.equal(supervisor.promptCount, 1);
	assert.equal(store.load().receipts[delivery.results[0]?.receiptId ?? ""], undefined, "rejected admission must not settle the receipt");

	rejectBoss = false;
	const second = await routeHostSupervisorDelivery(delivery, signal);
	if (second === "accepted") {
		heartbeatCount += 1;
		stallNotifyCount += 1;
	}
	assert.equal(second, "accepted");
	assert.equal(heartbeatCount, 1);
	assert.equal(stallNotifyCount, 1);
	assert.equal(currentAttempts, 2, "only the same pending admission is retried");
	assert.equal(supervisor.promptCount, 1, "retry does not prompt the Supervisor provider again");
	assert.equal(delivery.bossWakeCount, 1, "only the later positive admission settles the Boss wake");
});

test("host namespaces Supervisor escalation apart from the worker final completion", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-host-obligation-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const store = new DeliveryObligationStore(directory, { routingKey: "session-a" });
	const accepted = new Set<string>();
	const escalation: BossEscalationEnvelope = {
		eventId: "escalation-1", agentId: "worker-a", runId: "run-1", kind: "escalate", reason: "needs Boss", evidenceRefs: [],
	};
	const hostDeliver = (kind: SupervisorDeliveryRequest["kind"], envelope: BossEscalationEnvelope | undefined) => {
		const namespace = supervisorBossObligationNamespace({ kind, envelope });
		const row = store.create("worker-a", "run-1", `${kind} body`, namespace);
		if (row.state === "queued" || row.state === "observed" || row.state === "fulfilled") return true;
		const attempt = store.beginAttempt(row.id);
		assert.ok(attempt);
		store.finishAttempt(row.id, true);
		accepted.add(row.id);
		return true;
	};

	assert.equal(hostDeliver("stall", escalation), true);
	assert.equal(hostDeliver("completion", undefined), true);
	assert.equal(hostDeliver("stall", escalation), true);
	assert.equal(hostDeliver("completion", undefined), true);
	assert.equal(accepted.size, 2, "escalation and final completion each admit exactly once");
	assert.notEqual(
		store.create("worker-a", "run-1", "again", "supervisor-escalation").id,
		store.create("worker-a", "run-1", "again").id,
	);
});

test("two sequential batches in one Boss session remain distinct wave deliveries", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-wave-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const tracker = new SupervisorWaveIdentityTracker(directory, "session-a");
	const firstBatch = ["frontend\0run-front", "backend\0run-back"];
	const secondBatch = [...firstBatch, "runtime\0run-runtime", "delivery\0run-delivery"];
	const wave1 = tracker.waveId(firstBatch);
	assert.equal(tracker.waveId([...firstBatch].reverse()), wave1, "duplicate closeout callbacks coalesce");
	assert.equal(new SupervisorWaveIdentityTracker(directory, "session-a").waveId(firstBatch), wave1);
	const wave2 = tracker.waveId(secondBatch);
	assert.notEqual(wave2, wave1);

	const current: string[] = [];
	const delivery = createSupervisorDelivery({
		supervisor: createFakeSupervisorSession({ decide: () => ({ action: "wait" }) }),
		boss: createRecordingBossSink(),
		activeWorkerCount: () => 0,
		deliverCurrent: ({ receiptId }) => { current.push(receiptId); return true; },
	});
	const closed = (waveId: string, agentId: string, runId: string, completed: number) => request({
		kind: "completion",
		job: job(agentId, runId, "completed"),
		waveId,
		wave: { waveId, running: 0, completed, failed: 0, agentIds: [] },
		activeJobs: [],
	});
	await Promise.all([
		delivery.handle(closed(wave1, "backend", "run-back", 2)),
		delivery.handle(closed(wave1, "backend", "run-back", 2)),
	]);
	await delivery.handle(closed(wave2, "delivery", "run-delivery", 4));
	assert.equal(current.length, 2, "one Boss receipt per wave drain");
	assert.notEqual(current[0], current[1], "later drain has a distinct durable receipt");
});

test("a failed first batch cannot pollute the next successful batch summary", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-wave-scope-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const tracker = new SupervisorWaveIdentityTracker(directory, "session-a");
	const first = summarizeSupervisorRuntimeWave(tracker, [
		{ agentId: "frontend", runId: "run-front", state: "failed" },
		{ agentId: "backend", runId: "run-back", state: "ok" },
	]);
	assert.equal(first.failed, 1);
	assert.deepEqual(first.agentIds, ["backend", "frontend"]);

	const second = summarizeSupervisorRuntimeWave(tracker, [
		{ agentId: "frontend", runId: "run-front", state: "failed" },
		{ agentId: "backend", runId: "run-back", state: "ok" },
		{ agentId: "runtime", runId: "run-runtime", state: "ok" },
		{ agentId: "delivery", runId: "run-delivery", state: "ok" },
	]);
	assert.notEqual(second.waveId, first.waveId);
	assert.equal(second.running, 0);
	assert.equal(second.completed, 2);
	assert.equal(second.failed, 0);
	assert.deepEqual(second.agentIds, ["delivery", "runtime"]);
});

test("wave identity persists open members across restart and advances for a disjoint next batch", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-wave-restart-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const firstTracker = new SupervisorWaveIdentityTracker(directory, "session-restart");
	const open = summarizeSupervisorRuntimeWave(firstTracker, [
		{ agentId: "old-worker", runId: "old-run", state: "running" },
	]);
	const persistedOpen = JSON.parse(readFileSync(join(directory, "supervisor-wave-identity.json"), "utf8")) as {
		openRunKeys?: string[];
	};
	assert.deepEqual(persistedOpen.openRunKeys, ["old-worker\0old-run"]);

	const duplicateTracker = new SupervisorWaveIdentityTracker(directory, "session-restart");
	const duplicateClose = summarizeSupervisorRuntimeWave(duplicateTracker, [
		{ agentId: "old-worker", runId: "old-run", state: "ok" },
	]);
	assert.equal(duplicateClose.waveId, open.waveId, "old member callback after restart keeps the same receipt");

	const abandonedDirectory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-wave-abandoned-"));
	t.after(() => rmSync(abandonedDirectory, { recursive: true, force: true }));
	const abandoned = new SupervisorWaveIdentityTracker(abandonedDirectory, "session-restart");
	const abandonedWave = summarizeSupervisorRuntimeWave(abandoned, [
		{ agentId: "stale-worker", runId: "stale-run", state: "running" },
	]);
	const restarted = new SupervisorWaveIdentityTracker(abandonedDirectory, "session-restart");
	const next = summarizeSupervisorRuntimeWave(restarted, [
		{ agentId: "new-worker", runId: "new-run", state: "running" },
	]);
	assert.notEqual(next.waveId, abandonedWave.waveId, "disjoint post-restart run keys start a new generation");
	assert.deepEqual(next.agentIds, ["new-worker"]);
});

test("wave identity v1 migration retains closed callbacks and advances for new runs", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-wave-v1-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(join(directory, "supervisor-wave-identity.json"), JSON.stringify({
		version: 1,
		sessionId: "session-v1",
		generation: 4,
		terminalRunKeys: ["old-worker\0old-run"],
	}));
	const tracker = new SupervisorWaveIdentityTracker(directory, "session-v1");
	assert.equal(tracker.waveId(["old-worker\0old-run"]), "session-v1:wave:4");
	assert.equal(tracker.waveId(["old-worker\0old-run", "new-worker\0new-run"]), "session-v1:wave:5");
});

test("UI exact abort is observed before mutation and emits one terminal wave without subagent-done", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-ui-abort-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const obligations = new DeliveryObligationStore(directory, { routingKey: "session-ui-abort" });
	const exact = { agentId: "agent-51dd23fa72cb6276", runId: "run-hung" };
	let uiAbortMutations = 0;
	const closeout = createSupervisorOwnedTerminalCloseout({ mutate() { throw new Error("not Supervisor-owned"); } });
	const delivered: string[] = [];
	const supervisor = createFakeSupervisorSession({ decide: () => ({ action: "wait", reason: "terminal abort cannot self-heal" }) });
	const delivery = createSupervisorDelivery({
		supervisor,
		boss: createRecordingBossSink(),
		activeWorkerCount: () => 0,
		deliverCurrent(input) {
			delivered.push(input.publicText);
			const row = obligations.create(
				input.agentId,
				input.runId,
				input.publicText,
				supervisorBossObligationNamespace({ kind: input.kind, envelope: input.envelope }),
			);
			const attempt = obligations.beginAttempt(row.id);
			assert.ok(attempt);
			obligations.finishAttempt(row.id, true);
			return true;
		},
	});

	assert.equal(closeout.requestExternal(exact, () => { uiAbortMutations += 1; }), true);
	assert.equal(closeout.requestExternal(exact, () => { uiAbortMutations += 1; }), false);
	const terminal = request({
		kind: "completion",
		job: job(exact.agentId, exact.runId, "interrupted"),
		publicText: `[subagent-aborted] agentId=${exact.agentId} runId=${exact.runId}`,
		waveId: "wave-ui-abort",
		wave: { waveId: "wave-ui-abort", running: 0, completed: 3, failed: 1, agentIds: [] },
		activeJobs: [],
	});
	const first = await closeout.terminalize(exact, () => routeHostSupervisorDelivery(delivery, terminal));
	const duplicate = await closeout.terminalize(exact, () => routeHostSupervisorDelivery(delivery, terminal));

	assert.equal(first, true);
	assert.equal(duplicate, false);
	assert.equal(uiAbortMutations, 1, "the UI abort mutates the exact run once");
	assert.equal(supervisor.promptCount, 1, "the abnormal zero-active wave is analyzed by Supervisor once");
	assert.equal(delivered.length, 1, "no duplicate terminal delivery and no subagent-done dependency");
	assert.match(delivered[0] ?? "", /terminal abort cannot self-heal/);
	assert.equal(obligations.recoverable().length, 1, "the aborted wave has one durable Boss obligation");
});

test("Supervisor-owned final abort mutates the exact run once and emits one bounded durable terminal wave", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pipiui-supervisor-owned-abort-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const obligations = new DeliveryObligationStore(directory, { routingKey: "session-abort" });
	const exact = { agentId: "worker-a", runId: "run-1" };
	let active = 1;
	let mutations = 0;
	const closeout = createSupervisorOwnedTerminalCloseout({
		mutate(id) {
			assert.deepEqual(id, exact);
			mutations += 1;
			active = 0;
		},
	});
	const delivered: string[] = [];
	const delivery = createSupervisorDelivery({
		supervisor: createFakeSupervisorSession({ decide: () => ({ action: "wait" }) }),
		boss: createRecordingBossSink(),
		activeWorkerCount: () => active,
		deliverCurrent(input) {
			delivered.push(input.publicText);
			const row = obligations.create(
				input.agentId,
				input.runId,
				input.publicText,
				supervisorBossObligationNamespace({ kind: input.kind, envelope: input.envelope }),
			);
			const attempt = obligations.beginAttempt(row.id);
			assert.ok(attempt);
			obligations.finishAttempt(row.id, true);
			return true;
		},
	});

	assert.equal(closeout.request(exact), true);
	assert.equal(closeout.request(exact), false, "the same immutable run cannot be mutated twice");
	const terminal = request({
		kind: "completion",
		job: job(exact.agentId, exact.runId, "interrupted"),
		publicText: `[subagent-aborted] agentId=${exact.agentId} runId=${exact.runId}`,
		waveId: "wave-abort",
		wave: { waveId: "wave-abort", running: 0, completed: 0, failed: 1, agentIds: [] },
		activeJobs: [],
	});
	const first = await closeout.terminalize(exact, () => routeHostSupervisorDelivery(delivery, terminal));
	const duplicate = await closeout.terminalize(exact, () => routeHostSupervisorDelivery(delivery, terminal));

	assert.equal(first, true);
	assert.equal(duplicate, false);
	assert.equal(mutations, 1);
	assert.equal(delivered.length, 1);
	assert.ok(Buffer.byteLength(delivered[0] ?? "", "utf8") <= 8 * 1024);
	assert.equal(obligations.recoverable().length, 1, "the single terminal wave has a durable Boss obligation");
});
