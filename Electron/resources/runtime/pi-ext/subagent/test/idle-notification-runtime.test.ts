import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryObligationStore } from "../delivery-obligation.ts";
import { idleNotificationApi } from "../idle-notification.ts";
import { createSupervisorDelivery } from "../supervisor/delivery.ts";
import { createFakeSupervisorSession, createRecordingBossSink } from "../supervisor/route.ts";
import { classifySupervisorHostAdmission } from "../supervisor/host-seam.ts";

// This test registers the real extension. Isolate every inherited App routing path.
const root = mkdtempSync(join(tmpdir(), "pipiui-idle-runtime-"));
for (const key of Object.keys(process.env)) if (key.startsWith("PIPIUI_")) delete process.env[key];
process.env.PIPIUI_MAIN_CWD = root;
process.env.PIPIUI_PROJECT_ROOT = root;
process.env.PI_CODING_AGENT_DIR = join(root, ".pi", "agent");
process.env.PIPIUI_AGENT_DEPTH = "0";
const sessionId = "idle-notification-test";
const store = new DeliveryObligationStore(join(root, ".pi", "subagent-delivery-obligations", DeliveryObligationStore.routingDirectory(sessionId)), { routingKey: sessionId });
const legacy = store.create("legacy-worker", "legacy-run", "old long report", undefined, true);

const { default: extension, __doneLifecycleForTests: done, __watchRuntimeForTests: runtime, drainPipiuiTrackedChildren } = await import("../index.ts");
const tools = new Map<string, any>();
const handlers = new Map<string, any[]>();
const sent: any[] = [];
let idle = true;
let pendingUser = false;
const ctx = {
	cwd: root, isIdle: () => idle, hasPendingMessages: () => pendingUser,
	getContextUsage: () => undefined,
	sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined, getBranch: () => [], getEntries: () => [] },
};
const raw = {
	registerTool(tool: any) { tools.set(tool.name, tool); }, registerCommand() {},
	on(name: string, fn: any) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); },
	sendMessage(message: any, options: any) {
		assert.equal(idle, true, "only an idle native sender may be reached");
		assert.equal(pendingUser, false);
		assert.equal(options.deliverAs, undefined, "never request Pi queue delivery");
		sent.push(message);
		idle = false;
	},
	sendUserMessage() { assert.fail("must not call Pi user queue"); },
};
const pi = idleNotificationApi(raw, () => idle && !pendingUser);
extension(raw as never);
const fire = async (name: string) => {
	for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
};
await fire("session_start");
after(async () => {
	await fire("session_shutdown");
	await drainPipiuiTrackedChildren(250, 2_000);
	rmSync(root, { recursive: true, force: true });
});

function job(agentId: string, state = "ok") {
	const record = { agentId, runId: `run-${agentId}`, name: "explore", task: "test", state, startedAt: Date.now(), endedAt: Date.now(), resultText: `result-${agentId}`, cost: 0, turns: 1 };
	runtime.jobRegistry.set(agentId, record as any);
	return record;
}

test("legacy done/alarm recovery retires replay without sending or resolving failed jobs", async () => {
	assert.equal(store.read(legacy.id)?.state, "acknowledged");
	assert.deepEqual(store.recoverable(), []);
	assert.deepEqual(sent, []);
});

test("registered status tool consumes busy completions and failures without replaying or changing outcomes", async () => {
	idle = false;
	runtime.bossTurnBusy = true;
	for (const state of ["ok", "failed", "interrupted"]) {
		const row = job(`busy-${state}`, state);
		await done.deliverToBoss(pi as never, row.agentId, row.runId, `LONG-${state}`);
		assert.equal(runtime.jobRegistry.get(row.agentId)?.state, state);
		assert.equal(runtime.jobRegistry.get(row.agentId)?.closeoutDisposition, undefined);
	}
	assert.deepEqual(sent, []);
	assert.equal(runtime.heldSignals.length, 0);
	const result = await tools.get("subagent_status").execute("status-before-wait", {});
	assert.match(result.content[0].text, /busy-ok/);
	assert.match(result.content[0].text, /busy-failed/);
	assert.match(result.content[0].text, /busy-interrupted/);
	idle = true;
	await fire("agent_settled");
	assert.deepEqual(sent, [], "queried completions cannot wake after the turn ends");
});

test("completion after the last status read produces one short idle hint, with no old payload or retry", async () => {
	await tools.get("subagent_status").execute("last-read", {});
	idle = false;
	runtime.bossTurnBusy = true;
	const a = job("late-a");
	const b = job("late-b");
	await done.deliverToBoss(pi as never, a.agentId, a.runId, "LONG-A".repeat(1000));
	await done.deliverToBoss(pi as never, b.agentId, b.runId, "LONG-B".repeat(1000));
	assert.deepEqual(sent, []);
	idle = true;
	await fire("agent_settled");
	assert.equal(sent.length, 1);
	assert.ok(sent[0].content.length < 200);
	assert.match(sent[0].content, /subagent_status/);
	assert.doesNotMatch(sent[0].content, /LONG-|re-delivery/);
	idle = true;
	await fire("agent_settled");
	await done.deliverToBoss(pi as never, a.agentId, a.runId, "duplicate");
	assert.equal(sent.length, 1, "even a failed Boss response cannot re-arm this notification");
});

test("an idle completion yields to user input and sends only a current hint after the user is served", async () => {
	pendingUser = true;
	const row = job("user-first");
	await done.deliverToBoss(pi as never, row.agentId, row.runId, "deferred long text");
	assert.equal(sent.length, 1);
	await fire("agent_settled");
	assert.equal(sent.length, 1);
	pendingUser = false;
	await fire("agent_settled");
	assert.equal(sent.length, 2);
	assert.doesNotMatch(sent[1].content, /deferred long text/);
});

test("Supervisor busy completion is recorded without a false wake count or pending replay", async () => {
	idle = false;
	const row = job("supervisor-busy");
	let deliveries = 0;
	const delivery = createSupervisorDelivery({
		supervisor: createFakeSupervisorSession({ decide: () => ({ action: "forward" }) }),
		boss: createRecordingBossSink(), activeWorkerCount: () => 0,
		deliverCurrent: ({ agentId, runId, publicText }) => {
			deliveries++;
			return done.deliverToBoss(pi as never, agentId, runId, publicText);
		},
	});
	const request = { kind: "completion" as const, agentId: row.agentId, runId: row.runId, sequence: 1,
		job: { agentId: row.agentId, runId: row.runId, status: "completed" as const }, summary: "done", publicText: "full result" };
	const result = await delivery.handle(request);
	assert.equal(result.outcome, "recorded");
	assert.equal(result.bossWakes, 0);
	assert.equal(result.bossRequests, 0);
	assert.equal(delivery.bossWakeCount, 0);
	assert.equal(classifySupervisorHostAdmission(result), "absorbed");
	assert.equal((await delivery.handle(request)).outcome, "duplicate");
	assert.equal(deliveries, 1, "recorded is not a retryable pending payload");
});

test("running-worker escalation remains queryable and reopens status without a state transition", async () => {
	idle = false;
	const row = job("decision-worker", "running");
	const poll = async () => {
		const verdicts = [];
		for (const handler of handlers.get("tool_call") ?? []) verdicts.push(await handler({ toolName: "subagent_status", input: {} }, ctx));
		return verdicts.find(item => item?.block);
	};
	assert.equal(await poll(), undefined);
	await tools.get("subagent_status").execute("prime-state", {});
	assert.ok(await poll(), "unchanged worker board is gated");
	const delivery = createSupervisorDelivery({
		supervisor: createFakeSupervisorSession({ decide: () => ({ action: "escalate", reason: "verification needs a decision", recommendedAction: "inspect test evidence" }) }),
		boss: createRecordingBossSink(), activeWorkerCount: () => 1,
		deliverCurrent: ({ agentId, runId, publicText }) => runtime.deliverSupervisorNotice(pi as never, agentId, runId, publicText),
	});
	const result = await delivery.handle({ kind: "stall", agentId: row.agentId, runId: row.runId, sequence: 1,
		job: { agentId: row.agentId, runId: row.runId, status: "stalled" }, summary: "requires decision", publicText: "stall",
		evidenceRefs: ["artifact://status/decision-worker/run-decision-worker"] });
	assert.equal(result.outcome, "recorded");
	assert.equal(result.bossWakes, 0);
	assert.equal(runtime.jobRegistry.get(row.agentId)?.state, "running");
	assert.equal(await poll(), undefined, "new decision is actionable despite unchanged running state");
	const status = await tools.get("subagent_status").execute("new-decision", {});
	assert.match(status.content[0].text, /verification needs a decision/);
	assert.match(status.content[0].text, /inspect test evidence/);
	assert.match(status.content[0].text, /artifact:\/\/status\/decision-worker/);
	assert.match((await poll()).reason, /verification needs a decision/, "blocked duplicate still carries the decision");
	runtime.jobRegistry.delete(row.agentId);
});
