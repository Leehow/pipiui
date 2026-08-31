import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	BOSS_ESCALATION_MAX_UTF8_BYTES,
	SUPERVISOR_WAVE_AGENT_ID,
	createJobSnapshot,
	createSupervisorDecision,
	serializeBossEscalation,
	utf8ByteLength,
	type ContractResult,
	type SupervisorDecision,
	type SupervisorJobSnapshot,
} from "../supervisor/contract.ts";
import {
	createSupervisorControl,
	type ImmutableDispatchSpec,
	type SupervisorLifecyclePort,
} from "../supervisor/control.ts";
import {
	createFakeSupervisorSession,
	createRecordingBossSink,
	createRecordingProviderSink,
} from "../supervisor/route.ts";
import {
	SUPERVISOR_NO_TOOLS,
	SUPERVISOR_THINKING_LEVEL,
	createSupervisorSessionRuntime,
	type SupervisorPiCreateOptions,
	type SupervisorPiSessionFactory,
	type SupervisorPiSessionHandle,
} from "../supervisor/session-runtime.ts";
import {
	createFileSupervisorStateStore,
} from "../supervisor/state-store.ts";
import {
	WATCH_FORWARD_MAX_UTF8_BYTES,
	createHostSupervisorDelivery,
	createSupervisorDelivery,
	formatSupervisorEscalationText,
	isTerminalWaveRequest,
	memorySupervisorStore,
	type SupervisorDeliveryRequest,
} from "../supervisor/delivery.ts";
import {
	SupervisorSessionRuntimeError,
} from "../supervisor/session-runtime.ts";
import {
	createPiSupervisorSessionFactory,
	extractAssistantTextFromSession,
	isResolvedSupervisorModel,
	supervisorResourceLoaderFlags,
	type PiAgentSessionLike,
	type PiSessionManagerApi,
} from "../supervisor/pi-session-adapter.ts";

function unwrap<T>(result: ContractResult<T>, label: string): T {
	assert.equal(result.ok, true, `${label}: ${result.ok ? "" : result.error}`);
	return result.value;
}

function job(status: SupervisorJobSnapshot["status"] = "running"): SupervisorJobSnapshot {
	return unwrap(createJobSnapshot({
		agentId: "worker-a",
		runId: "run-1",
		status,
		title: "scan workspace",
	}), "job");
}

function request(overrides: Partial<SupervisorDeliveryRequest> = {}): SupervisorDeliveryRequest {
	const kind = overrides.kind ?? "heartbeat";
	const status = overrides.job?.status ?? (kind === "completion" || kind === "wave" ? "completed" : "running");
	const snapshot = overrides.job ?? job(status);
	return {
		kind,
		agentId: snapshot.agentId,
		runId: snapshot.runId,
		sequence: overrides.sequence ?? 1,
		publicText: overrides.publicText ?? `[subagent-${kind}] agentId=${snapshot.agentId} runId=${snapshot.runId}`,
		job: snapshot,
		summary: overrides.summary ?? `${kind} summary`,
		occurredAt: overrides.occurredAt ?? 1_700_000_000_000,
		waveId: overrides.waveId,
		task: overrides.task,
		wave: overrides.wave,
		evidenceRefs: overrides.evidenceRefs,
		activeJobs: overrides.activeJobs,
		tasks: overrides.tasks,
		priorAction: overrides.priorAction,
		terminalReports: overrides.terminalReports,
		forceForward: overrides.forceForward,
	};
}

interface DeliveryHarness {
	delivery: ReturnType<typeof createSupervisorDelivery>;
	supervisor: ReturnType<typeof createFakeSupervisorSession>;
	boss: ReturnType<typeof createRecordingBossSink>;
	current: Array<{ kind: string; publicText: string; agentId: string; runId: string }>;
	lifecycle: { port: SupervisorLifecyclePort; calls: Array<{ method: string; args: unknown }> };
	store: ReturnType<typeof memorySupervisorStore>;
}

function harness(options: {
	decide?: (packet: unknown) => SupervisorDecision;
	active?: number | (() => number);
	fail?: Error;
	lifecycle?: SupervisorLifecyclePort;
	acceptCurrent?: boolean | (() => boolean);
} = {}): DeliveryHarness {
	const provider = createRecordingProviderSink();
	const supervisor = options.fail
		? {
			promptCount: 0,
			providerRequestCount: 0,
			prompt() {
				(this as { promptCount: number }).promptCount += 1;
				provider.record();
				throw options.fail;
			},
		} as ReturnType<typeof createFakeSupervisorSession>
		: createFakeSupervisorSession({
			decide: options.decide ?? ((): SupervisorDecision => ({ action: "status" })),
			provider,
		});
	const boss = createRecordingBossSink();
	const current: DeliveryHarness["current"] = [];
	const calls: Array<{ method: string; args: unknown }> = [];
	const lifecycle: DeliveryHarness["lifecycle"] = {
		calls,
		port: options.lifecycle ?? {
			status(id) { calls.push({ method: "status", args: id }); return { ...id, status: "running" }; },
			resume(id) { calls.push({ method: "resume", args: id }); },
			retry(id) { calls.push({ method: "retry", args: id }); },
			abort(id) { calls.push({ method: "abort", args: id }); },
			resolve(id) { calls.push({ method: "resolve", args: id }); },
			startDeclared(spec) { calls.push({ method: "startDeclared", args: spec }); },
		},
	};
	const store = memorySupervisorStore();
	const delivery = createSupervisorDelivery({
		supervisor,
		boss,
		deliverCurrent: (input) => {
			current.push({
				kind: input.kind,
				publicText: input.publicText,
				agentId: input.agentId,
				runId: input.runId,
			});
			const accept = options.acceptCurrent;
			if (typeof accept === "function") return accept();
			return accept !== false;
		},
		activeWorkerCount: () => typeof options.active === "function" ? options.active() : (options.active ?? 1),
		store,
		control: () => createSupervisorControl({
			lifecycle: lifecycle.port,
			store,
			manifest: {
				tasks: [{
					taskId: "scan",
					title: "scan workspace",
					status: "declared",
					dispatch: { taskId: "scan", agentId: "worker-a", role: "explore", title: "scan workspace" },
				}],
			},
		}),
	});
	return { delivery, supervisor, boss, current, lifecycle, store };
}

test("force-forward heartbeat wakes Boss without a Supervisor prompt", async () => {
	const h = harness({ decide: () => ({ action: "wait" }) });
	const result = await h.delivery.handle(request({
		kind: "heartbeat",
		forceForward: true,
		publicText: "[subagent-heartbeat] outstanding=1\n[subagent-progress] agentId=worker-a +12 bytes\nhello log",
	}));

	assert.equal(result.outcome, "boss_direct");
	assert.equal(result.decisionAction, "forward");
	assert.equal(result.supervisorPrompts, 0);
	assert.equal(result.bossWakes, 1);
	assert.equal(h.supervisor.promptCount, 0);
	assert.equal(h.current.length, 1);
	assert.match(h.current[0]!.publicText, /\[subagent-progress\]/);
});

test("normal heartbeat causes one Supervisor prompt and zero Boss provider requests", async () => {
	const h = harness({ decide: () => ({ action: "wait" }) });
	const result = await h.delivery.handle(request({ kind: "heartbeat" }));

	assert.equal(result.outcome, "supervisor");
	assert.equal(result.supervisorPrompts, 1);
	assert.equal(result.bossRequests, 0);
	assert.equal(result.bossWakes, 0);
	assert.equal(result.createBossObligation, false);
	assert.equal(h.supervisor.promptCount, 1);
	assert.equal(h.supervisor.providerRequestCount, 1);
	assert.equal(h.boss.requestCount, 0);
	assert.equal(h.current.length, 0);
	assert.equal(h.delivery.bossWakeCount, 0);
});

test("supervisor wait holds a successful completion instead of waking Boss", async () => {
	const h = harness({
		decide: () => ({ action: "wait", reason: "must compare both designs" }),
		active: 2,
	});
	const event = request({
		kind: "completion",
		job: job("completed"),
		wave: { waveId: "wave-hold", running: 1, completed: 1, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-hold",
		publicText: "[subagent-done] agentId=worker-a compare-design-a",
	});

	const result = await h.delivery.handle(event);
	assert.equal(result.outcome, "supervisor");
	assert.equal(result.createBossObligation, false);
	assert.equal(result.bossWakes, 0);
	assert.equal(h.current.length, 0);
	assert.equal(h.boss.requestCount, 0);
	const claim = h.store.load().receipts[result.receiptId];
	assert.ok(claim);
	assert.equal(claim?.action, "wait");
	assert.equal(claim?.kind, "completion");
});

test("successful completion defaults to forwarding even when Supervisor says status", async () => {
	const h = harness({
		decide: () => ({ action: "status" }),
		active: 2,
	});
	const publicText = "[subagent-done] agentId=worker-a independent follow-up is ready";
	const result = await h.delivery.handle(request({
		kind: "completion",
		job: job("completed"),
		wave: { waveId: "wave-default", running: 1, completed: 1, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-default",
		publicText,
	}));
	assert.equal(result.outcome, "boss_direct");
	assert.equal(h.current[0]?.publicText, publicText);
	assert.equal(h.boss.requestCount, 0);
});

test("failed completion cannot be held by wait", async () => {
	const h = harness({
		decide: () => ({ action: "wait", reason: "observe longer" }),
		active: 2,
	});
	const publicText = "[subagent-done] agentId=worker-a ok=false verify failed";
	const result = await h.delivery.handle(request({
		kind: "completion",
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "failed",
			verify: "failed",
		}), "failed-job"),
		wave: { waveId: "wave-fail", running: 1, completed: 0, failed: 1, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-fail",
		publicText,
	}));
	assert.equal(result.outcome, "boss_direct");
	assert.equal(h.current.length, 1);
	assert.equal(h.current[0]?.publicText, publicText);
});

test("failed completion is forwarded to Boss when Supervisor says forward", async () => {
	const h = harness({
		decide: () => ({ action: "forward", reason: "worker failed; notify Boss immediately" }),
		active: 2,
	});
	const publicText = "[subagent-done] agentId=worker-a ok=false provider stall";
	const result = await h.delivery.handle(request({
		kind: "completion",
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "failed",
			verify: "none",
		}), "failed-job"),
		wave: { waveId: "wave-forward-fail", running: 1, completed: 0, failed: 1, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-forward-fail",
		publicText,
	}));
	assert.equal(result.outcome, "boss_direct");
	assert.equal(h.current.length, 1);
	assert.equal(h.current[0]?.publicText, publicText);
	// 失败必须被 boss 感知，不得记成 supervisor 已处理
	assert.equal(result.createBossObligation, true);
});

test("Supervisor failure on a completion fail-opens to the original done text", async () => {
	const h = harness({
		fail: new Error("provider 429"),
		active: 2,
	});
	const publicText = "[subagent-done] agentId=worker-a still usable after supervisor timeout";
	const result = await h.delivery.handle(request({
		kind: "completion",
		job: job("completed"),
		wave: { waveId: "wave-open", running: 1, completed: 1, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-open",
		publicText,
	}));
	assert.equal(result.outcome, "fallback");
	assert.equal(result.bossWakes, 1);
	assert.equal(h.current[0]?.publicText, publicText);
	assert.doesNotMatch(h.current[0]?.publicText ?? "", /\[subagent-supervisor\]/);
});

test("successful intermediate completion forwards the original done text to Boss", async () => {
	const h = harness({
		decide: () => ({ action: "forward", reason: "boss can start follow-up" }),
		active: 2,
	});
	const publicText = [
		"[subagent-done] agentId=worker-a runId=run-1 ok=true",
		"Title: scan workspace",
		"Result: auth module is ready",
	].join("\n");
	const event = request({
		kind: "completion",
		job: job("completed"),
		wave: { waveId: "wave-9", running: 1, completed: 1, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-9",
		publicText,
	});

	const result = await h.delivery.handle(event);
	assert.equal(result.outcome, "boss_direct");
	assert.equal(result.createBossObligation, true);
	assert.equal(result.bossWakes, 1);
	assert.equal(result.decisionAction, "forward");
	assert.equal(result.supervisorPrompts, 1);
	assert.equal(h.delivery.fallbackCount, 0);
	assert.equal(h.current.length, 1);
	assert.equal(h.current[0]?.publicText, publicText);
	assert.doesNotMatch(h.current[0]?.publicText ?? "", /\[subagent-supervisor\]/);
	assert.equal(h.boss.requestCount, 0);

	const claim = h.store.load().receipts[result.receiptId];
	assert.ok(claim, "Supervisor receipt must be durable");
	assert.equal(claim?.status, "completed");
	assert.equal(claim?.kind, "completion");
	assert.equal(claim?.action, "forward");
});

test("last successful completion delivers the original done instead of a sibling wave dump", async () => {
	const h = harness({ active: 0 });
	const publicText = "[subagent-done] agentId=worker-a result sentinel: frontend is ready; Wave: 0 other workers still running";
	const event = request({
		kind: "completion",
		job: job("completed"),
		wave: { waveId: "wave-9", running: 0, completed: 2, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-9",
		publicText,
		evidenceRefs: ["artifact://status/worker-a/run-1", "artifact://status/worker-b/run-2"],
		activeJobs: [job("completed")],
		terminalReports: [
			{ agentId: "worker-a", runId: "run-1", status: "completed", findings: "frontend is ready", statusRef: "artifact://status/worker-a/run-1" },
			{ agentId: "worker-b", runId: "run-2", status: "completed", findings: "backend is ready", statusRef: "artifact://status/worker-b/run-2" },
		],
	});

	const result = await h.delivery.handle(event);
	assert.equal(isTerminalWaveRequest(event, 0), false);
	assert.equal(result.outcome, "boss_direct");
	assert.equal(result.supervisorPrompts, 0);
	assert.equal(h.supervisor.promptCount, 0);
	assert.equal(h.current.length, 1);
	assert.equal(h.current[0]?.publicText, publicText);
	assert.doesNotMatch(h.current[0]?.publicText ?? "", /\[subagent-supervisor\]/);
	assert.doesNotMatch(h.current[0]?.publicText ?? "", /backend is ready/);
	assert.equal(h.current[0]?.agentId, "worker-a");
});

test("held completions flush after a delivery restart from durable wait receipts", async () => {
	const store = memorySupervisorStore();
	const make = (active: number) => createSupervisorDelivery({
		supervisor: createFakeSupervisorSession({
			decide: () => ({ action: "wait", reason: "must compare designs" }),
		}),
		boss: createRecordingBossSink(),
		deliverCurrent: (input) => {
			current.push(input.publicText);
			return true;
		},
		activeWorkerCount: () => active,
		store,
		control: () => createSupervisorControl({
			lifecycle: {
				status(id) { return { ...id, status: "running" }; },
				resume() {},
				retry() {},
				abort() {},
				resolve() {},
				startDeclared() {},
			},
			store,
			manifest: { tasks: [] },
		}),
	});
	const current: string[] = [];
	const first = make(2);
	const hold = await first.handle(request({
		kind: "completion",
		job: unwrap(createJobSnapshot({ agentId: "worker-a", runId: "run-1", status: "completed" }), "held-job"),
		wave: { waveId: "wave-restart", running: 1, completed: 1, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-restart",
		publicText: "[subagent-done] agentId=worker-a UNIQUE-RESTART-HELD",
		evidenceRefs: ["artifact://status/worker-a/run-1", "artifact://wave/wave-restart"],
		activeJobs: [unwrap(createJobSnapshot({ agentId: "worker-b", runId: "run-2", status: "running" }), "running-b")],
	}));
	assert.equal(hold.outcome, "supervisor");
	assert.equal(current.length, 0);

	const restarted = createSupervisorDelivery({
		supervisor: createFakeSupervisorSession({ decide: () => ({ action: "forward" }) }),
		boss: createRecordingBossSink(),
		deliverCurrent: (input) => {
			current.push(input.publicText);
			return true;
		},
		activeWorkerCount: () => 0,
		store,
		control: () => createSupervisorControl({
			lifecycle: {
				status(id) { return { ...id, status: "running" }; },
				resume() {},
				retry() {},
				abort() {},
				resolve() {},
				startDeclared() {},
			},
			store,
			manifest: { tasks: [] },
		}),
	});
	await restarted.handle(request({
		kind: "completion",
		job: unwrap(createJobSnapshot({ agentId: "worker-b", runId: "run-2", status: "completed" }), "last-job"),
		agentId: "worker-b",
		runId: "run-2",
		wave: { waveId: "wave-restart", running: 0, completed: 2, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-restart",
		publicText: "[subagent-done] agentId=worker-b UNIQUE-RESTART-LAST",
		activeJobs: [],
		terminalReports: [
			{ agentId: "worker-a", runId: "run-1", status: "completed", findings: "UNIQUE-RESTART-HELD-findings", statusRef: "artifact://status/worker-a/run-1" },
			{ agentId: "worker-b", runId: "run-2", status: "completed", findings: "UNIQUE-RESTART-LAST-findings", statusRef: "artifact://status/worker-b/run-2" },
		],
	}));
	assert.equal(current.length, 2);
	assert.equal(current[0], "[subagent-done] agentId=worker-b UNIQUE-RESTART-LAST");
	assert.match(current[1] ?? "", /UNIQUE-RESTART-HELD-findings/);
	assert.doesNotMatch(current[1] ?? "", /UNIQUE-RESTART-LAST-findings/);
});

test("wave close flushes only held completions and does not resend forwarded ones", async () => {
	let active = 2;
	const h = harness({
		active: () => active,
		decide: (packet) => {
			const agentId = (packet as { event: { identity: { agentId: string } } }).event.identity.agentId;
			return agentId === "worker-a"
				? { action: "wait", reason: "must compare designs" }
				: { action: "forward", reason: "independent follow-up" };
		},
	});
	const hold = await h.delivery.handle(request({
		kind: "completion",
		job: unwrap(createJobSnapshot({ agentId: "worker-a", runId: "run-1", status: "completed" }), "held-job"),
		wave: { waveId: "wave-mix", running: 1, completed: 1, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-mix",
		publicText: "[subagent-done] agentId=worker-a UNIQUE-HELD",
		activeJobs: [unwrap(createJobSnapshot({ agentId: "worker-b", runId: "run-2", status: "running" }), "running-b")],
	}));
	assert.equal(hold.outcome, "supervisor");
	assert.equal(h.current.length, 0);

	active = 0;
	const last = await h.delivery.handle(request({
		kind: "completion",
		job: unwrap(createJobSnapshot({ agentId: "worker-b", runId: "run-2", status: "completed" }), "fwd-job"),
		agentId: "worker-b",
		runId: "run-2",
		wave: { waveId: "wave-mix", running: 0, completed: 2, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-mix",
		publicText: "[subagent-done] agentId=worker-b UNIQUE-FORWARDED; Wave: 0 other workers still running",
		activeJobs: [],
		terminalReports: [
			{ agentId: "worker-a", runId: "run-1", status: "completed", findings: "UNIQUE-HELD-findings", statusRef: "artifact://status/worker-a/run-1" },
			{ agentId: "worker-b", runId: "run-2", status: "completed", findings: "UNIQUE-FORWARDED-findings", statusRef: "artifact://status/worker-b/run-2" },
		],
	}));
	assert.equal(last.outcome, "boss_direct");
	assert.equal(h.current.length, 2, "last done plus held flush");
	assert.equal(h.current[0]?.publicText, "[subagent-done] agentId=worker-b UNIQUE-FORWARDED; Wave: 0 other workers still running");
	assert.match(h.current[1]?.publicText ?? "", /\[subagent-supervisor\]/);
	assert.match(h.current[1]?.publicText ?? "", /UNIQUE-HELD-findings/);
	assert.doesNotMatch(h.current[1]?.publicText ?? "", /UNIQUE-FORWARDED-findings/);
});

test("escalation yields exactly one bounded Boss request", async () => {
	const h = harness({
		decide: () => ({
			action: "escalate",
			reason: "verify failed",
			recommendedAction: "ask the user",
			evidenceRefs: ["artifact://verify/worker-a/run-1"],
		}),
	});
	const result = await h.delivery.handle(request({
		kind: "upgrade_failure",
		job: job("failed"),
		evidenceRefs: ["artifact://verify/worker-a/run-1"],
		summary: "verify exit 1",
	}));

	assert.equal(result.outcome, "escalated");
	assert.equal(result.bossRequests, 1);
	assert.equal(result.bossWakes, 1);
	assert.equal(result.createBossObligation, true);
	assert.equal(h.boss.requestCount, 1);
	assert.equal(h.current.length, 1);
	assert.match(h.current[0]?.publicText ?? "", /\[subagent-supervisor\]/);
	assert.ok(utf8ByteLength(h.current[0]?.publicText ?? "") <= BOSS_ESCALATION_MAX_UTF8_BYTES + 32);
	const envelope = h.boss.envelopes[0];
	assert.ok(envelope);
	assert.equal(envelope?.kind, "escalate");
	assert.equal(envelope?.reason, "verify failed");
	assert.equal(envelope?.recommendedAction, "ask the user");
	assert.deepEqual(envelope?.evidenceRefs, ["artifact://verify/worker-a/run-1"]);
	assert.equal("transcript" in (envelope as object), false);
	const serialized = unwrap(serializeBossEscalation(envelope!), "esc");
	assert.ok(serialized.byteLength <= BOSS_ESCALATION_MAX_UTF8_BYTES);
	assert.equal(serialized.byteLength, utf8ByteLength(serialized.json));
	assert.match(formatSupervisorEscalationText(envelope!), /\[subagent-supervisor\]/);
});

test("one transient active stall self-heals with one bounded abort and no Boss escalation", async () => {
	const h = harness({
		decide: () => ({ action: "abort", reason: "stalled too long" }),
	});
	const event = request({ kind: "stall", job: job("stalled"), sequence: 3 });

	const first = await h.delivery.handle(event);
	const second = await h.delivery.handle(event);
	const third = await h.delivery.handle(event);

	assert.equal(first.outcome, "supervisor");
	assert.equal(second.outcome, "duplicate");
	assert.equal(third.outcome, "duplicate");
	assert.equal(h.supervisor.promptCount, 1);
	assert.equal(h.supervisor.providerRequestCount, 1);
	assert.equal(h.lifecycle.calls.length, 1);
	assert.deepEqual(h.lifecycle.calls[0], { method: "abort", args: { agentId: "worker-a", runId: "run-1" } });
	assert.equal(h.boss.requestCount, 0);
	assert.equal(h.current.length, 0);
});

test("unsupported retry keeps its receipt and reaches Boss once without claiming a lifecycle action", async () => {
	const h = harness({ decide: () => ({ action: "retry", reason: "try the exact run again" }) });
	const event = request({ kind: "stall", job: job("stalled"), sequence: 33 });

	const first = await h.delivery.handle(event);
	const second = await h.delivery.handle(event);

	assert.equal(first.outcome, "escalated");
	assert.equal(first.decisionAction, "retry");
	assert.equal(first.bossWakes, 1);
	assert.equal(second.outcome, "duplicate");
	assert.deepEqual(h.lifecycle.calls, []);
	assert.equal(h.current.length, 1);
	assert.equal(h.boss.requestCount, 1);
	const claim = h.store.load().receipts[first.receiptId];
	assert.equal(claim?.status, "completed");
	assert.equal(claim?.action, "escalate");
	assert.equal(claim?.outcome, "escalation_required");
	assert.deepEqual(h.store.load().usage, {});
});

test("Supervisor failure falls back exactly once to current Boss delivery", async () => {
	const h = harness({ fail: new Error("provider 429") });
	const event = request({
		kind: "heartbeat",
		publicText: "[subagent-heartbeat] outstanding=1",
	});

	const first = await h.delivery.handle(event);
	const second = await h.delivery.handle(event);

	assert.equal(first.outcome, "fallback");
	assert.equal(first.bossWakes, 1);
	assert.equal(first.createBossObligation, true);
	assert.equal(first.supervisorPrompts, 1);
	assert.equal(h.current.length, 1);
	assert.equal(h.current[0]?.publicText, event.publicText);
	assert.equal(h.boss.requestCount, 0);
	assert.equal(h.delivery.fallbackCount, 1);

	assert.equal(second.outcome, "duplicate");
	assert.equal(second.bossWakes, 0);
	assert.equal(h.current.length, 1);
	assert.equal(h.supervisor.promptCount, 1);
});

test("no active workers yields zero Supervisor requests", async () => {
	const h = harness({ active: 0, decide: () => ({ action: "status" }) });
	const result = await h.delivery.handle(request({
		kind: "heartbeat",
		activeJobs: [job("completed")],
	}));

	assert.equal(result.outcome, "ignored");
	assert.equal(result.supervisorPrompts, 0);
	assert.equal(h.supervisor.promptCount, 0);
	assert.equal(h.supervisor.providerRequestCount, 0);
	assert.equal(h.boss.requestCount, 0);
	assert.equal(h.current.length, 0);
});

test("last successful completion reaches Boss once as the original done text", async () => {
	const h = harness({ active: 0 });
	const publicText = "[subagent-done] worker-a result sentinel: frontend and backend are ready; Wave: 0 other workers still running";
	const event = request({
		kind: "completion",
		job: job("completed"),
		wave: { waveId: "wave-9", running: 0, completed: 2, failed: 0, agentIds: ["worker-a", "worker-b"] },
		waveId: "wave-9",
		publicText,
		evidenceRefs: ["artifact://status/worker-a/run-1", "artifact://status/worker-b/run-2"],
		activeJobs: [job("completed")],
	});

	const first = await h.delivery.handle(event);
	const second = await h.delivery.handle(event);

	assert.equal(isTerminalWaveRequest(event, 0), false);
	assert.equal(first.outcome, "boss_direct");
	assert.equal(first.supervisorPrompts, 0);
	assert.equal(first.bossWakes, 1);
	assert.equal(first.createBossObligation, true);
	assert.equal(h.supervisor.promptCount, 0);
	assert.equal(h.current.length, 1);
	assert.equal(h.current[0]?.publicText, publicText);
	assert.doesNotMatch(h.current[0]?.publicText ?? "", /\[subagent-supervisor\]/);
	assert.equal(h.current[0]?.agentId, "worker-a");
	assert.equal(second.outcome, "duplicate");
	assert.equal(h.current.length, 1);
});

test("terminal wave fairly preserves eight multilingual worker pointers and findings within 8 KiB", async () => {
	const h = harness({ active: 0 });
	const terminalReports = Array.from({ length: 8 }, (_, index) => {
		const ordinal = index + 1;
		return {
			agentId: `worker-${ordinal}`,
			runId: `run-${ordinal}`,
			status: ordinal === 8 ? "failed" as const : "completed" as const,
			findings: `UNIQUE-${ordinal}-结论-${"中文结果".repeat(180)}`,
			statusRef: `artifact://status/worker-${ordinal}/run-${ordinal}`,
		};
	});
	const event = request({
		kind: "wave",
		agentId: "wave",
		runId: "wave-eight",
		waveId: "wave-eight",
		job: unwrap(createJobSnapshot({ agentId: "wave", runId: "wave-eight", status: "completed" }), "wave-eight-job"),
		wave: { waveId: "wave-eight", running: 0, completed: 7, failed: 1, agentIds: terminalReports.map((item) => item.agentId) },
		summary: "wave closed completed=7 failed=1",
		publicText: "legacy aggregate must not decide fairness",
		evidenceRefs: terminalReports.map((item) => item.statusRef),
		terminalReports,
		activeJobs: [],
	});

	const result = await h.delivery.handle(event);
	const envelope = h.boss.envelopes[0];
	assert.equal(result.outcome, "escalated");
	assert.ok(envelope);
	for (const item of terminalReports) {
		assert.match(envelope!.reason, new RegExp(`agentId=${item.agentId} runId=${item.runId} status=${item.status}`));
		assert.match(envelope!.reason, new RegExp(`findings=UNIQUE-${item.agentId.slice("worker-".length)}-结论`));
		assert.match(envelope!.reason, new RegExp(`statusRef=${item.statusRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		assert.ok(envelope!.evidenceRefs.includes(item.statusRef));
	}
	const serialized = unwrap(serializeBossEscalation(envelope!), "eight-worker-envelope");
	assert.ok(serialized.byteLength <= BOSS_ESCALATION_MAX_UTF8_BYTES);
});

test("abnormal terminal wave is analyzed once and escalated even when Supervisor asks to wait", async () => {
	const h = harness({
		active: 0,
		decide: () => ({ action: "wait", reason: "observe longer" }),
	});
	const event = request({
		kind: "completion",
		job: job("interrupted"),
		waveId: "wave-aborted",
		wave: { waveId: "wave-aborted", running: 0, completed: 3, failed: 1, agentIds: ["worker-a"] },
		publicText: "[subagent-aborted] worker-a ended by SIGTERM; remaining blocker: runtime verification",
		summary: "wave closed completed=3 failed=1",
		evidenceRefs: ["artifact://status/worker-a/run-1", "artifact://wave/wave-aborted"],
		activeJobs: [],
	});

	const first = await h.delivery.handle(event);
	const duplicate = await h.delivery.handle(event);

	assert.equal(first.outcome, "escalated");
	assert.equal(first.supervisorPrompts, 1);
	assert.equal(first.bossWakes, 1);
	assert.equal(duplicate.outcome, "duplicate");
	assert.equal(h.supervisor.promptCount, 1);
	assert.equal(h.current.length, 1);
	assert.equal(h.boss.requestCount, 1);
	assert.match(h.boss.envelopes[0]?.reason ?? "", /failed=1/);
	assert.match(h.boss.envelopes[0]?.reason ?? "", /SIGTERM/);
	assert.deepEqual(h.boss.envelopes[0]?.evidenceRefs, [
		"artifact://status/worker-a/run-1",
		"artifact://wave/wave-aborted",
	]);
});

test("abnormal terminal escalation preserves Supervisor cause, recommended action, and evidence once", async () => {
	const h = harness({
		active: 0,
		decide: () => ({
			action: "escalate",
			reason: "cause: verification failed; safe actions attempted: status once; remaining blocker: failing assertion",
			recommendedAction: "Boss should inspect the failing assertion and explicitly redispatch",
			evidenceRefs: ["artifact://verify/worker-a/run-1"],
		}),
	});
	const event = request({
		kind: "wave",
		job: job("failed"),
		waveId: "wave-failed",
		wave: { waveId: "wave-failed", running: 0, completed: 0, failed: 1, agentIds: ["worker-a"] },
		publicText: "[subagent-done] test sentinel: assertion expected 2 got 1",
		summary: "wave closed completed=0 failed=1",
		evidenceRefs: ["artifact://status/worker-a/run-1"],
		activeJobs: [],
	});

	const first = await h.delivery.handle(event);
	const duplicate = await h.delivery.handle(event);
	const envelope = h.boss.envelopes[0];
	assert.equal(first.outcome, "escalated");
	assert.equal(duplicate.outcome, "duplicate");
	assert.match(envelope?.reason ?? "", /^cause: verification failed; safe actions attempted: status once; remaining blocker: failing assertion/);
	assert.match(envelope?.reason ?? "", /test sentinel: assertion expected 2 got 1/);
	assert.equal(envelope?.recommendedAction, "Boss should inspect the failing assertion and explicitly redispatch");
	assert.deepEqual(envelope?.evidenceRefs, ["artifact://verify/worker-a/run-1"]);
	assert.equal(h.current.length, 1);
	assert.equal(h.supervisor.promptCount, 1);
});

test("existing stall and completion obligation split remains correct", async () => {
	const h = harness({
		decide: (packet) => {
			const kind = (packet as { event: { identity: { kind: string } } }).event.identity.kind;
			return kind === "stall"
				? { action: "escalate", reason: "repeated stall", evidenceRefs: ["artifact://stall/worker-a/run-1"] }
				: { action: "wait" };
		},
		active: 2,
	});

	const completion = await h.delivery.handle(request({
		kind: "completion",
		job: job("completed"),
		sequence: 1,
		wave: { waveId: "w1", running: 1, completed: 1, failed: 0, agentIds: ["worker-a"] },
		publicText: "[subagent-done] intermediate",
	}));
	const stall = await h.delivery.handle(request({
		kind: "stall",
		job: job("stalled"),
		sequence: 2,
		publicText: "[subagent-stalled] agentId=worker-a",
		evidenceRefs: ["artifact://stall/worker-a/run-1"],
	}));

	assert.equal(completion.outcome, "supervisor");
	assert.equal(completion.createBossObligation, false, "intermediate completion must not keep a Boss obligation");
	assert.equal(completion.bossWakes, 0);
	assert.ok(h.store.load().receipts[completion.receiptId], "completion is acknowledged by Supervisor receipt");

	assert.equal(stall.outcome, "escalated");
	assert.equal(stall.createBossObligation, true, "Boss escalation keeps a Boss-delivery obligation");
	assert.equal(h.boss.requestCount, 1);
	assert.equal(h.current.length, 1);
	assert.match(h.current[0]?.publicText ?? "", /\[subagent-supervisor\]/);
	assert.doesNotMatch(h.current[0]?.publicText ?? "", /\[subagent-stalled\]/);
});

test("production adapter extracts assistant JSON from AgentSession messages, not prompt() return", async () => {
	const created: SupervisorPiCreateOptions[] = [];
	const sessionCalls = { open: 0, continueRecent: 0, create: 0 };
	const SessionManager: PiSessionManagerApi = {
		create(cwd, sessionDir) {
			sessionCalls.create += 1;
			return { cwd, sessionDir, kind: "fresh" };
		},
		open() {
			sessionCalls.open += 1;
			throw new Error("must not open Boss history");
		},
		continueRecent() {
			sessionCalls.continueRecent += 1;
			throw new Error("must not continue Boss history");
		},
	};
	const session: PiAgentSessionLike & { messages: unknown[] } = {
		sessionId: "sup-1",
		messages: [],
		async prompt(text: string) {
			assert.match(String(text), /"kind":"heartbeat"/);
			this.messages.push({ role: "user", content: text });
			this.messages.push({
				role: "assistant",
				content: [{ type: "text", text: '{"action":"wait","reason":"still running"}' }],
			});
			return undefined;
		},
		dispose() {},
	};
	const factory = createPiSupervisorSessionFactory({
		SessionManager,
		async createAgentSession(options) {
			assert.equal(options.thinkingLevel, SUPERVISOR_THINKING_LEVEL);
			assert.equal(options.noTools, SUPERVISOR_NO_TOOLS);
			assert.deepEqual(options.tools, []);
			assert.deepEqual(options.customTools, []);
			assert.equal((options.sessionManager as { kind?: string }).kind, "fresh");
			return { session };
		},
	});

	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s4",
		factory,
		models: { boss: "anthropic/claude-haiku-4" },
	});
	await runtime.setActiveWorkerCount(1);
	const decision = await runtime.prompt({
		event: {
			identity: {
				eventId: "heartbeat:worker-a:run-1:-:1",
				agentId: "worker-a",
				runId: "run-1",
				kind: "heartbeat",
				sequence: 1,
			},
			occurredAt: 1,
			job: job(),
			summary: "idle",
		},
		activeJobs: [job()],
		tasks: [],
	});

	assert.equal(decision.action, "wait");
	assert.equal(sessionCalls.create, 1);
	assert.equal(sessionCalls.open, 0);
	assert.equal(sessionCalls.continueRecent, 0);
	assert.equal(extractAssistantTextFromSession(session), '{"action":"wait","reason":"still running"}');
	void created;
});

test("host delivery composes session runtime, control, and split acknowledgements", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pipiui-supervisor-s4-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const prompts: string[] = [];
	const factory: SupervisorPiSessionFactory = {
		async create(options) {
			assert.equal(options.thinkingLevel, "off");
			assert.deepEqual(options.tools, []);
			return {
				async prompt(text) {
					prompts.push(text);
					return '{"action":"status"}';
				},
				dispose() {},
			} satisfies SupervisorPiSessionHandle;
		},
	};
	const current: string[] = [];
	const boss = createRecordingBossSink();
	const lifecycleCalls: string[] = [];
	const host = createHostSupervisorDelivery({
		projectRoot: root,
		factory,
		models: { generalPurpose: "openai/gpt-4.1-mini" },
		store: createFileSupervisorStateStore(join(root, ".pi", "agent", "supervisor-state.json")),
		activeWorkerCount: () => 1,
		manifest: () => ({ tasks: [] }),
		lifecycle: {
			status(id) { lifecycleCalls.push(`status:${id.agentId}`); return { ...id, status: "running" }; },
			resume() { lifecycleCalls.push("resume"); },
			retry() { lifecycleCalls.push("retry"); },
			abort() { lifecycleCalls.push("abort"); },
			resolve() { lifecycleCalls.push("resolve"); },
			startDeclared(spec: ImmutableDispatchSpec) { lifecycleCalls.push(`start:${spec.taskId}`); },
		},
		boss,
		deliverCurrent: (input) => { current.push(input.publicText); },
	});

	const result = await host.delivery.handle(request({ kind: "heartbeat" }));
	assert.equal(result.outcome, "supervisor");
	assert.equal(prompts.length, 1);
	assert.equal(current.length, 0);
	assert.equal(boss.requestCount, 0);
	assert.equal(lifecycleCalls[0], "status:worker-a");
	assert.doesNotMatch(prompts[0] ?? "", /transcript|messages|findings/);
	await host.dispose();
});

test("false Boss delivery is not acknowledged and redelivers exactly once without a second Supervisor prompt", async () => {
	let accept = false;
	const h = harness({
		decide: () => ({ action: "escalate", reason: "need boss", evidenceRefs: ["artifact://stall/worker-a/run-1"] }),
		acceptCurrent: () => accept,
	});
	const event = request({
		kind: "stall",
		job: job("stalled"),
		evidenceRefs: ["artifact://stall/worker-a/run-1"],
	});

	const first = await h.delivery.handle(event);
	assert.equal(first.outcome, "pending");
	assert.equal(first.bossWakes, 0);
	assert.equal(h.boss.requestCount, 0);
	assert.equal(h.store.load().receipts[first.receiptId], undefined);
	assert.equal(h.supervisor.promptCount, 1);

	accept = true;
	const second = await h.delivery.handle(event);
	assert.equal(second.outcome, "escalated");
	assert.equal(second.bossWakes, 1);
	assert.equal(h.boss.requestCount, 1);
	assert.equal(h.supervisor.promptCount, 1);
	assert.equal(h.current.length, 2);
	assert.ok(h.store.load().receipts[second.receiptId]);

	const third = await h.delivery.handle(event);
	assert.equal(third.outcome, "duplicate");
	assert.equal(h.boss.requestCount, 1);
	assert.equal(h.supervisor.promptCount, 1);
});

test("two concurrent last completions each forward their own done text", async () => {
	const h = harness({ active: 0 });
	const wave = { waveId: "wave-9", running: 0, completed: 2, failed: 0, agentIds: ["worker-a", "worker-b"] };
	const first = request({
		kind: "completion",
		job: job("completed"),
		wave,
		waveId: "wave-9",
		publicText: "[subagent-done] worker-a UNIQUE-A; Wave: 0 other workers still running",
		activeJobs: [job("completed")],
	});
	const secondJob = unwrap(createJobSnapshot({ agentId: "worker-b", runId: "run-2", status: "completed" }), "job-b");
	const second = request({
		kind: "completion",
		job: secondJob,
		agentId: "worker-b",
		runId: "run-2",
		wave,
		waveId: "wave-9",
		publicText: "[subagent-done] worker-b UNIQUE-B; Wave: 0 other workers still running",
		activeJobs: [secondJob],
	});

	const [a, b] = await Promise.all([h.delivery.handle(first), h.delivery.handle(second)]);
	assert.equal(h.current.length, 2, "independent last completions must not wait for each other");
	assert.equal(a.outcome, "boss_direct");
	assert.equal(b.outcome, "boss_direct");
	const texts = h.current.map((item) => item.publicText).sort();
	assert.deepEqual(texts, [
		"[subagent-done] worker-a UNIQUE-A; Wave: 0 other workers still running",
		"[subagent-done] worker-b UNIQUE-B; Wave: 0 other workers still running",
	]);
});

test("explicit wave summaries stay inside the 8 KiB envelope and never dump raw transcripts", async () => {
	const h = harness({ active: 0 });
	const huge = "raw-transcript-dump ".repeat(3000);
	assert.ok(utf8ByteLength(huge) > BOSS_ESCALATION_MAX_UTF8_BYTES);
	const result = await h.delivery.handle(request({
		kind: "wave",
		agentId: SUPERVISOR_WAVE_AGENT_ID,
		runId: "wave-8k",
		waveId: "wave-8k",
		job: unwrap(createJobSnapshot({ agentId: SUPERVISOR_WAVE_AGENT_ID, runId: "wave-8k", status: "completed" }), "wave-job"),
		wave: { waveId: "wave-8k", running: 0, completed: 1, failed: 0, agentIds: ["worker-a"] },
		publicText: huge,
		summary: "wave closed",
		activeJobs: [],
	}));
	assert.equal(result.outcome, "boss_direct");
	assert.equal(h.current.length, 1);
	assert.ok(utf8ByteLength(h.current[0]?.publicText ?? "") <= BOSS_ESCALATION_MAX_UTF8_BYTES + 32);
	assert.doesNotMatch(h.current[0]?.publicText ?? "", /raw-transcript-dump/);
});

test("taskId reaches control and a declared task starts from the immutable spec", async () => {
	const parsed = createSupervisorDecision({
		action: "start_declared",
		taskId: "scan",
		reason: "dependency cleared",
	});
	assert.equal(parsed.ok, true);
	if (parsed.ok) assert.equal(parsed.value.taskId, "scan");
	const rejected = createSupervisorDecision({
		action: "start_declared",
		taskId: "scan",
		transcript: "nope",
	});
	assert.equal(rejected.ok, false);

	const h = harness({
		decide: () => ({ action: "start_declared", taskId: "scan" }),
	});
	const result = await h.delivery.handle(request({ kind: "completion", job: job("completed"), active: undefined }));
	assert.equal(result.outcome, "boss_direct");
	assert.deepEqual(h.lifecycle.calls, [{
		method: "startDeclared",
		args: { taskId: "scan", agentId: "worker-a", role: "explore", title: "scan workspace" },
	}]);
	assert.equal(h.current.length, 1);
});

test("unresolved Supervisor model fails closed and never creates a default-model session", async () => {
	let created = 0;
	const factory = createPiSupervisorSessionFactory({
		SessionManager: { create: () => ({}) },
		resolveModel: async () => undefined,
		async createAgentSession() {
			created += 1;
			throw new Error("must not create a default-model session");
		},
	});
	await assert.rejects(
		() => factory.create({
			cwd: "/tmp/pipiui-supervisor-s4",
			projectScopedPath: "/tmp/pipiui-supervisor-s4/.pi/agent/supervisor",
			model: "anthropic/claude-haiku-4",
			thinkingLevel: "off",
			tools: [],
			customTools: [],
			noTools: "all",
			systemPrompt: "x",
			epochGeneration: 1,
		}),
		(error: unknown) => {
			assert.ok(error instanceof SupervisorSessionRuntimeError);
			assert.equal(error.code, "no_model");
			return true;
		},
	);
	assert.equal(created, 0);
	assert.equal(isResolvedSupervisorModel(undefined), false);
	assert.equal(isResolvedSupervisorModel("claude-haiku-4"), false);
});

test("APPEND_SYSTEM cannot enter the Supervisor resource loader", () => {
	const flags = supervisorResourceLoaderFlags("explicit supervisor prompt only");
	assert.equal(flags.noContextFiles, true);
	assert.deepEqual(flags.appendSystemPrompt, []);
	assert.deepEqual(flags.appendSystemPromptOverride(), []);
	assert.equal(flags.systemPromptOverride(), "explicit supervisor prompt only");
	assert.doesNotMatch(flags.systemPromptOverride(), /APPEND_SYSTEM/);
});

function watchRequest(overrides: Partial<SupervisorDeliveryRequest> = {}): SupervisorDeliveryRequest {
	return request({
		kind: "watch",
		summary: "status=running phase=generating activity=+128B verify=none",
		evidenceRefs: ["artifact://status/worker-a/run-1"],
		...overrides,
	});
}

test("watch wait and status stay silent with no Boss wake", async () => {
	const h = harness({
		decide: (packet) => {
			const sequence = (packet as { event: { identity: { sequence: number } } }).event.identity.sequence;
			return sequence === 1 ? { action: "wait", reason: "ordinary progress" } : { action: "status" };
		},
	});

	const waitResult = await h.delivery.handle(watchRequest({ sequence: 1 }));
	const statusResult = await h.delivery.handle(watchRequest({ sequence: 2 }));

	assert.equal(waitResult.outcome, "supervisor");
	assert.equal(waitResult.bossWakes, 0);
	assert.equal(waitResult.createBossObligation, false);
	assert.equal(statusResult.outcome, "supervisor");
	assert.equal(statusResult.bossWakes, 0);
	assert.equal(statusResult.createBossObligation, false);
	assert.equal(h.supervisor.promptCount, 2);
	assert.equal(h.current.length, 0);
	assert.equal(h.boss.requestCount, 0);
	assert.equal(h.delivery.bossWakeCount, 0);
	const claim = h.store.load().receipts[waitResult.receiptId];
	assert.ok(claim);
	assert.equal(claim?.kind, "watch");
	assert.equal(claim?.action, "wait");
});

test("watch forward wakes Boss once with the compact text and duplicate receipts stay exact-once", async () => {
	const h = harness({ decide: () => ({ action: "forward", reason: "important progress" }) });
	const publicText = "[subagent-watch] agentId=worker-a runId=run-1 status=verifying verify=none";
	const event = watchRequest({
		sequence: 3,
		publicText,
		summary: "status=running phase=verifying activity=+3.1KB verify=none",
	});

	const first = await h.delivery.handle(event);
	const second = await h.delivery.handle(event);

	assert.equal(first.outcome, "boss_direct");
	assert.equal(first.decisionAction, "forward");
	assert.equal(first.supervisorPrompts, 1);
	assert.equal(first.bossWakes, 1);
	assert.equal(first.createBossObligation, true);
	assert.equal(h.current.length, 1);
	assert.equal(h.current[0]?.publicText, publicText);
	assert.equal(h.boss.requestCount, 0, "watch forward carries compact text, not an escalation envelope");

	assert.equal(second.outcome, "duplicate");
	assert.equal(h.current.length, 1);
	assert.equal(h.supervisor.promptCount, 1, "duplicates do not re-prompt the Supervisor");

	const claim = h.store.load().receipts[first.receiptId];
	assert.ok(claim);
	assert.equal(claim?.kind, "watch");
	assert.equal(claim?.action, "forward");
});

test("watch forward public text is hard-bounded", async () => {
	const h = harness({ decide: () => ({ action: "forward" }) });
	const result = await h.delivery.handle(watchRequest({
		sequence: 4,
		publicText: "[subagent-watch] agentId=worker-a " + "x".repeat(10_000),
	}));

	assert.equal(result.outcome, "boss_direct");
	assert.equal(h.current.length, 1);
	const delivered = h.current[0]?.publicText ?? "";
	assert.ok(delivered.startsWith("[subagent-watch] agentId=worker-a"));
	assert.ok(utf8ByteLength(delivered) <= WATCH_FORWARD_MAX_UTF8_BYTES);
});

test("watch escalation produces one bounded Boss envelope and stays exact-once", async () => {
	const h = harness({
		decide: () => ({
			action: "escalate",
			reason: "stall-like quiet during watch",
			evidenceRefs: ["artifact://stall/worker-a/run-1"],
		}),
	});
	const event = watchRequest({
		sequence: 5,
		job: job("stalled"),
		summary: "status=stalled quiet=120s",
		evidenceRefs: ["artifact://stall/worker-a/run-1"],
	});

	const first = await h.delivery.handle(event);
	const second = await h.delivery.handle(event);

	assert.equal(first.outcome, "escalated");
	assert.equal(first.bossRequests, 1);
	assert.equal(first.bossWakes, 1);
	assert.equal(h.boss.requestCount, 1);
	const envelope = h.boss.envelopes[0];
	assert.equal(envelope?.eventId, first.receiptId);
	assert.equal(envelope?.kind, "escalate");
	assert.equal(envelope?.reason, "stall-like quiet during watch");
	assert.deepEqual(envelope?.evidenceRefs, ["artifact://stall/worker-a/run-1"]);
	const serialized = unwrap(serializeBossEscalation(envelope!), "watch-escalation");
	assert.ok(serialized.byteLength <= BOSS_ESCALATION_MAX_UTF8_BYTES);

	assert.equal(second.outcome, "duplicate");
	assert.equal(h.boss.requestCount, 1);
	assert.equal(h.current.length, 1);
});

test("zero-active watch with failed verify is escalated even when Supervisor asks to wait", async () => {
	const h = harness({ active: 0, decide: () => ({ action: "wait", reason: "observe longer" }) });
	const result = await h.delivery.handle(watchRequest({
		sequence: 6,
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "running",
			verify: "failed",
		}), "watch-verify-job"),
		summary: "status=running verify=failed",
		evidenceRefs: ["artifact://verify/worker-a/run-1"],
		activeJobs: [],
	}));

	assert.equal(result.outcome, "escalated");
	assert.equal(result.supervisorPrompts, 1);
	assert.equal(result.bossWakes, 1);
	assert.match(h.boss.envelopes[0]?.reason ?? "", /verify=failed/);
});

test("zero-active ordinary watch samples are ignored and cannot duplicate the completion receipt", async () => {
	const h = harness({ active: 0, decide: () => ({ action: "forward" }) });
	const result = await h.delivery.handle(watchRequest({
		sequence: 7,
		summary: "status=completed verify=passed",
		activeJobs: [job("completed")],
	}));

	assert.equal(result.outcome, "ignored");
	assert.equal(result.supervisorPrompts, 0);
	assert.equal(result.bossWakes, 0);
	assert.equal(h.current.length, 0);
	assert.equal(h.supervisor.promptCount, 0);
});
