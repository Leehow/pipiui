import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	IDLE_NOTIFICATION_DETAIL,
	IDLE_NOTIFICATION_SKIPPED,
	IdleNotificationState,
	idleNotificationApi,
	installIdleNotificationGuard,
} from "../idle-notification.ts";

const message = (marked = true) => ({
	customType: "pipiui-subagent-complete-v1", content: "result", display: false,
	details: marked ? { [IDLE_NOTIFICATION_DETAIL]: true } : {},
});

// Execute the installed Pi sendCustomMessage, including its real queue/idle branches.
// No provider, real session files or user-owned process is involved.
function harness() {
	const session = Object.create(AgentSession.prototype) as any;
	const followUps: unknown[] = [];
	const steering: unknown[] = [];
	const prompts: unknown[] = [];
	session._isAgentRunActive = false;
	session._steeringMessages = [];
	session._followUpMessages = [];
	session._pendingNextTurnMessages = [];
	session.agent = {
		followUp: (value: unknown) => followUps.push(value),
		steer: (value: unknown) => steering.push(value),
	};
	session._runAgentPrompt = async (value: unknown) => {
		session._isAgentRunActive = true;
		prompts.push(value);
	};
	return { session, followUps, steering, prompts };
}

assert.equal(installIdleNotificationGuard(AgentSession), true);

test("native boundary refuses busy notifications instead of queueing either followUp or steer", () => {
	for (const deliverAs of ["followUp", "steer", "nextTurn", undefined]) {
		const h = harness();
		h.session._isAgentRunActive = true;
		assert.throws(() => h.session.sendCustomMessage(message(), { triggerTurn: true, deliverAs }),
			{ message: IDLE_NOTIFICATION_SKIPPED });
		assert.deepEqual(h.followUps, []);
		assert.deepEqual(h.steering, []);
		assert.deepEqual(h.session._pendingNextTurnMessages, []);
		assert.deepEqual(h.prompts, []);
	}
});

test("native boundary rejects compaction and queued user input even if streaming is false", () => {
	for (const key of ["_compactionAbortController", "_autoCompactionAbortController", "_branchSummaryAbortController", "_followUpMessages", "_steeringMessages"]) {
		const h = harness();
		h.session[key] = key.endsWith("Messages") ? ["user input"] : new AbortController();
		assert.throws(() => h.session.sendCustomMessage(message(), { triggerTurn: true }),
			{ message: IDLE_NOTIFICATION_SKIPPED });
		assert.equal(h.prompts.length, 0);
	}
});

test("idle notification starts directly and a concurrent sibling cannot queue behind it", async () => {
	const h = harness();
	await h.session.sendCustomMessage(message(), { triggerTurn: true, deliverAs: "followUp" });
	assert.equal(h.prompts.length, 1);
	assert.throws(() => h.session.sendCustomMessage(message(), { triggerTurn: true }),
		{ message: IDLE_NOTIFICATION_SKIPPED });
	assert.deepEqual(h.followUps, []);
	assert.deepEqual(h.steering, []);
});

test("unmarked traffic from users, other extensions and nested parents is unchanged", async () => {
	const h = harness();
	h.session._isAgentRunActive = true;
	await h.session.sendCustomMessage(message(false), { triggerTurn: true, deliverAs: "followUp" });
	assert.equal(h.followUps.length, 1);
	assert.equal(h.prompts.length, 0);
});

test("extension facade covers questions and unknown notices without calling sendUserMessage", () => {
	const calls: any[] = [];
	let idle = false;
	const raw = { sendMessage: (...args: any[]) => calls.push(args), sendUserMessage: () => assert.fail("must use a guarded custom wake"), other: 42 };
	const pi = idleNotificationApi(raw, () => idle);
	for (const text of ["[subagent-question] help", "[subagent-future] state"]) {
		assert.throws(() => pi.sendUserMessage(text, { deliverAs: "followUp" }), { message: IDLE_NOTIFICATION_SKIPPED });
	}
	assert.deepEqual(calls, []);
	idle = true;
	pi.sendUserMessage("[subagent-question] help", { deliverAs: "followUp" });
	assert.equal(calls[0][0].details[IDLE_NOTIFICATION_DETAIL], true);
	assert.deepEqual(calls[0][1], { triggerTurn: true });
	assert.equal(pi.other, 42);
});

test("native guard closes the race after an extension idle check", () => {
	const h = harness();
	const raw = {
		sendMessage: (m: any, o: any) => {
			h.session._isAgentRunActive = true; // user prompt wins between checks
			h.session.sendCustomMessage(m, o);
		},
		sendUserMessage: () => assert.fail(),
	};
	const pi = idleNotificationApi(raw, () => true);
	assert.throws(() => pi.sendMessage(message(), { triggerTurn: true, deliverAs: "followUp" }),
		{ message: IDLE_NOTIFICATION_SKIPPED });
	assert.deepEqual(h.followUps, []);
	assert.deepEqual(h.steering, []);
});

test("busy revisions coalesce; a status read consumes them without a later wake", () => {
	const state = new IdleNotificationState();
	for (let i = 0; i < 100; i++) state.changed(`busy-${i}\0run-${i}`);
	assert.equal(state.remind(() => { throw new Error(IDLE_NOTIFICATION_SKIPPED); }), false);
	assert.equal(state.unread, true);
	state.read();
	assert.equal(state.remind(() => assert.fail("already queried, do not wake")), false);
});

test("a per-worker read retires only that worker and a later change re-arms it", () => {
	const state = new IdleNotificationState();
	state.changed("alpha\0run-1");
	state.changed("beta\0run-2");
	state.read("alpha");
	assert.equal(state.unread, true, "beta is still unread");
	let sends = 0;
	assert.equal(state.remind(() => { sends++; }), true);
	assert.equal(state.unread, false);
	state.changed("alpha\0run-3");
	assert.equal(state.remind(() => { sends++; }), true, "the same worker re-arms on a new change");
	assert.equal(sends, 2);
});

test("completion after the final status read gets one short idle hint, never old payloads", () => {
	const state = new IdleNotificationState();
	state.read();
	state.changed("late-a\0run");
	let sends = 0;
	assert.equal(state.remind(() => { sends++; }), true);
	assert.equal(state.remind(() => { sends++; }), false);
	assert.equal(sends, 1);
	state.reset();
	assert.equal(state.unread, false);
});

test("new completion during send remains unread and install is idempotent", () => {
	const state = new IdleNotificationState();
	state.changed("first\0run");
	state.remind(() => state.changed("second\0run"));
	assert.equal(state.unread, true);
	assert.equal(installIdleNotificationGuard(AgentSession), true);
	assert.equal(installIdleNotificationGuard({ prototype: {} }), false);
});
