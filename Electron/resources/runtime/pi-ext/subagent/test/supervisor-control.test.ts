import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
	createJobSnapshot,
	createSupervisorEvent,
	type ContractResult,
	type SupervisorAction,
	type SupervisorEvent,
	type SupervisorJobSnapshot,
} from "../supervisor/contract.ts";
import {
	createSupervisorControl,
	type ImmutableDispatchSpec,
	type SupervisorLifecyclePort,
	type SupervisorTaskManifest,
} from "../supervisor/control.ts";
import {
	assertProjectScopedSupervisorStatePath,
	createFileSupervisorStateStore,
	parseSupervisorState,
	supervisorSessionStatePath,
} from "../supervisor/state-store.ts";

function unwrap<T>(result: ContractResult<T>, label: string): T {
	assert.equal(result.ok, true, `${label}: ${result.ok ? "" : result.error}`);
	return result.value;
}

function eventOf(overrides: {
	kind?: SupervisorEvent["identity"]["kind"];
	agentId?: string;
	runId?: string;
	sequence?: number;
	status?: SupervisorJobSnapshot["status"];
	summary?: string;
} = {}): SupervisorEvent {
	const agentId = overrides.agentId ?? "worker-a";
	const runId = overrides.runId ?? "run-1";
	return unwrap(createSupervisorEvent({
		kind: overrides.kind ?? "stall",
		agentId,
		runId,
		sequence: overrides.sequence ?? 1,
		occurredAt: 1_700_000_000_000,
		job: unwrap(createJobSnapshot({
			agentId,
			runId,
			status: overrides.status ?? "stalled",
		}), "job"),
		summary: overrides.summary ?? "idle",
		evidenceRefs: ["artifact://status/worker-a/run-1"],
	}), "event");
}

function stateFile(): { root: string; file: string } {
	const root = mkdtempSync(join(tmpdir(), "pipiui-supervisor-control-"));
	return { root, file: join(root, ".pi", "agent", "supervisor-state.json") };
}

interface RecordedLifecycle {
	port: SupervisorLifecyclePort;
	calls: Array<{ method: string; args: unknown }>;
	failNext?: string;
}

function recordingLifecycle(options: {
	failNext?: string;
	onStart?: (spec: ImmutableDispatchSpec) => void;
	onAbort?: (id: { agentId: string; runId: string }) => void | Promise<void>;
} = {}): RecordedLifecycle {
	const calls: Array<{ method: string; args: unknown }> = [];
	const recorded: RecordedLifecycle = {
		calls,
		failNext: options.failNext,
		port: {
			status(id) {
				calls.push({ method: "status", args: id });
				if (recorded.failNext === "status") throw new Error("status failed");
				return { agentId: id.agentId, runId: id.runId, status: "running" };
			},
			resume(id) {
				calls.push({ method: "resume", args: id });
				if (recorded.failNext === "resume") throw new Error("resume failed");
			},
			retry(id) {
				calls.push({ method: "retry", args: id });
				if (recorded.failNext === "retry") throw new Error("retry failed");
			},
			async abort(id) {
				calls.push({ method: "abort", args: id });
				if (recorded.failNext === "abort") throw new Error("abort failed");
				await options.onAbort?.(id);
			},
			resolve(id) {
				calls.push({ method: "resolve", args: id });
				if (recorded.failNext === "resolve") throw new Error("resolve failed");
			},
			startDeclared(spec) {
				calls.push({ method: "startDeclared", args: spec });
				options.onStart?.(spec);
				if (recorded.failNext === "startDeclared") throw new Error("start failed");
			},
		},
	};
	return recorded;
}

function manifest(overrides: Partial<SupervisorTaskManifest> = {}): SupervisorTaskManifest {
	return {
		tasks: overrides.tasks ?? [
			{
				taskId: "scan",
				title: "scan workspace",
				status: "completed",
				dispatch: { taskId: "scan", agentId: "worker-a", role: "explore", title: "scan workspace" },
			},
			{
				taskId: "fix",
				title: "apply fix",
				status: "declared",
				blockedBy: ["scan"],
				dispatch: { taskId: "fix", agentId: "worker-b", role: "general-purpose", title: "apply fix" },
			},
			{
				taskId: "blocked-fix",
				title: "blocked fix",
				status: "blocked",
				blockedBy: ["missing-dep"],
				dispatch: { taskId: "blocked-fix", agentId: "worker-c", role: "general-purpose", title: "blocked fix" },
			},
			{
				taskId: "held",
				title: "held fix",
				status: "declared",
				blockedBy: ["not-ready"],
				dispatch: { taskId: "held", agentId: "worker-d", role: "general-purpose", title: "held fix" },
			},
		],
	};
}

test("duplicate completed receipt is exact-once and never repeats a lifecycle action", async (t) => {
	const { root, file } = stateFile();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const lifecycle = recordingLifecycle();
	const control = createSupervisorControl({
		lifecycle: lifecycle.port,
		store: createFileSupervisorStateStore(file),
		manifest: manifest(),
	});
	const event = eventOf();
	const action: SupervisorAction = { kind: "abort", agentId: "worker-a", runId: "run-1" };

	const first = await control.apply(event, action);
	const second = await control.apply(event, action);
	const third = await control.apply(event, { kind: "retry", agentId: "worker-a", runId: "run-1" });

	assert.equal(first.outcome, "applied");
	assert.equal(second.outcome, "duplicate");
	assert.equal(third.outcome, "duplicate");
	assert.equal(lifecycle.calls.length, 1);
	assert.deepEqual(lifecycle.calls[0], { method: "abort", args: { agentId: "worker-a", runId: "run-1" } });
});

test("undeclared or blocked tasks cannot start; start_declared uses only the immutable manifest spec", async (t) => {
	const { root, file } = stateFile();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const started: ImmutableDispatchSpec[] = [];
	const lifecycle = recordingLifecycle({ onStart: (spec) => started.push(spec) });
	const control = createSupervisorControl({
		lifecycle: lifecycle.port,
		store: createFileSupervisorStateStore(file),
		manifest: manifest(),
	});

	const undeclared = await control.apply(eventOf({ sequence: 2, kind: "completion", status: "completed" }), {
		kind: "start_declared",
		taskId: "never-declared",
	});
	const blocked = await control.apply(eventOf({ sequence: 3, kind: "completion", status: "completed" }), {
		kind: "start_declared",
		taskId: "blocked-fix",
	});
	const waiting = await control.apply(eventOf({ sequence: 4, kind: "completion", status: "completed" }), {
		kind: "start_declared",
		taskId: "held",
	});
	const override = await control.apply(eventOf({ sequence: 5, kind: "completion", status: "completed" }), {
		kind: "start_declared",
		taskId: "fix",
		agentId: "invented-worker",
	});
	const scopeChange = await control.apply(eventOf({ sequence: 6, kind: "completion", status: "completed" }), {
		kind: "start_declared",
		taskId: "fix",
		scope: ["Electron/secret/"],
		goal: "rewrite the plan",
	} as SupervisorAction);

	assert.equal(undeclared.outcome, "rejected");
	assert.match(undeclared.reason ?? "", /not declared/);
	assert.equal(blocked.outcome, "rejected");
	assert.match(blocked.reason ?? "", /blocked/);
	assert.equal(waiting.outcome, "rejected");
	assert.match(waiting.reason ?? "", /blocked by not-ready/);
	assert.equal(override.outcome, "rejected");
	assert.match(override.reason ?? "", /cannot override/);
	assert.equal(scopeChange.outcome, "rejected");
	assert.match(scopeChange.reason ?? "", /scope|goal/);
	assert.equal(lifecycle.calls.length, 0);

	const startedOk = await control.apply(eventOf({ sequence: 7, kind: "completion", status: "completed" }), {
		kind: "start_declared",
		taskId: "fix",
	});
	assert.equal(startedOk.outcome, "applied");
	assert.equal(started.length, 1);
	assert.deepEqual(started[0], {
		taskId: "fix",
		agentId: "worker-b",
		role: "general-purpose",
		title: "apply fix",
	});
	assert.equal("scope" in (started[0] as object), false);
	assert.equal("brief" in (started[0] as object), false);
	assert.equal("goal" in (started[0] as object), false);
});

test("abort and resolve honor exact run identity and small budgets", async (t) => {
	const { root, file } = stateFile();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const lifecycle = recordingLifecycle();
	const control = createSupervisorControl({
		lifecycle: lifecycle.port,
		store: createFileSupervisorStateStore(file),
		manifest: manifest(),
		budgets: { retry: 1, abort: 1, resolve: 1, start: 1 },
	});

	const wrongRun = await control.apply(eventOf(), {
		kind: "abort",
		agentId: "worker-a",
		runId: "run-other",
	});
	const wrongAgent = await control.apply(eventOf({ sequence: 2 }), {
		kind: "resolve",
		agentId: "worker-other",
		runId: "run-1",
	});
	assert.equal(wrongRun.outcome, "rejected");
	assert.match(wrongRun.reason ?? "", /runId/);
	assert.equal(wrongAgent.outcome, "rejected");
	assert.match(wrongAgent.reason ?? "", /agentId/);
	assert.equal(lifecycle.calls.length, 0);

	const abort = await control.apply(eventOf({ sequence: 3 }), {
		kind: "abort",
		agentId: "worker-a",
		runId: "run-1",
	});
	const abortAgain = await control.apply(eventOf({ sequence: 4 }), {
		kind: "abort",
		agentId: "worker-a",
		runId: "run-1",
	});
	const retry = await control.apply(eventOf({ sequence: 5 }), {
		kind: "retry",
		agentId: "worker-a",
		runId: "run-1",
	});
	const retryAgain = await control.apply(eventOf({ sequence: 6 }), {
		kind: "retry",
		agentId: "worker-a",
		runId: "run-1",
	});
	const resolve = await control.apply(eventOf({ sequence: 7, kind: "completion", status: "failed" }), {
		kind: "resolve",
		agentId: "worker-a",
		runId: "run-1",
	});
	const resolveAgain = await control.apply(eventOf({ sequence: 8, kind: "completion", status: "failed" }), {
		kind: "resolve",
		agentId: "worker-a",
		runId: "run-1",
	});

	assert.equal(abort.outcome, "applied");
	assert.equal(abortAgain.outcome, "escalation_required");
	assert.match(abortAgain.reason ?? "", /budget exhausted/);
	assert.equal(retry.outcome, "escalation_required");
	assert.match(retry.reason ?? "", /unsupported/);
	assert.equal(retryAgain.outcome, "escalation_required");
	assert.match(retryAgain.reason ?? "", /unsupported/);
	assert.equal(resolve.outcome, "applied");
	assert.equal(resolveAgain.outcome, "escalation_required");
	assert.match(resolveAgain.reason ?? "", /budget exhausted/);
	assert.deepEqual(lifecycle.calls.map((call) => call.method), ["abort", "resolve"]);

	const wait = await control.apply(eventOf({ sequence: 9, kind: "heartbeat", status: "running" }), { kind: "wait" });
	const escalate = await control.apply(eventOf({ sequence: 10, kind: "upgrade_failure", status: "failed" }), {
		kind: "escalate",
		reason: "need the boss",
	});
	assert.equal(wait.outcome, "noop");
	assert.equal(escalate.outcome, "escalation_required");
	assert.deepEqual(lifecycle.calls.map((call) => call.method), ["abort", "resolve"]);
});

test("unsupported resume and retry escalate before lifecycle mutation or durable applied claims", async (t) => {
	const { root, file } = stateFile();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const store = createFileSupervisorStateStore(file);
	const lifecycle = recordingLifecycle();
	const control = createSupervisorControl({ lifecycle: lifecycle.port, store, manifest: manifest() });
	const resumeEvent = eventOf({ agentId: "worker-a", runId: "run-1", sequence: 30 });
	const retryEvent = eventOf({ agentId: "worker-b", runId: "run-2", sequence: 31 });

	const resumed = await control.apply(resumeEvent, {
		kind: "resume", agentId: "worker-a", runId: "run-1",
	});
	const retried = await control.apply(retryEvent, {
		kind: "retry", agentId: "worker-b", runId: "run-2",
	});

	assert.equal(resumed.outcome, "escalation_required");
	assert.match(resumed.reason ?? "", /unsupported/i);
	assert.equal(retried.outcome, "escalation_required");
	assert.match(retried.reason ?? "", /unsupported/i);
	assert.deepEqual(lifecycle.calls, []);
	assert.equal(store.load().receipts[resumeEvent.identity.eventId], undefined);
	assert.equal(store.load().receipts[retryEvent.identity.eventId], undefined);
	assert.deepEqual(store.load().usage, {});
});

test("concurrent distinct actions serialize without losing either receipt or usage counter", async (t) => {
	const { root, file } = stateFile();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const firstEntered = Promise.withResolvers<void>();
	const releaseFirst = Promise.withResolvers<void>();
	const lifecycle = recordingLifecycle({
		async onAbort(id) {
			if (id.agentId !== "worker-a") return;
			firstEntered.resolve();
			await releaseFirst.promise;
		},
	});
	const store = createFileSupervisorStateStore(file);
	const control = createSupervisorControl({ lifecycle: lifecycle.port, store, manifest: manifest() });
	const firstEvent = eventOf({ agentId: "worker-a", runId: "run-1", sequence: 40 });
	const secondEvent = eventOf({ agentId: "worker-b", runId: "run-2", sequence: 41 });

	const first = control.apply(firstEvent, { kind: "abort", agentId: "worker-a", runId: "run-1" });
	await firstEntered.promise;
	const second = control.apply(secondEvent, { kind: "abort", agentId: "worker-b", runId: "run-2" });
	await new Promise<void>((resolve) => setImmediate(resolve));
	const lifecycleCallsBeforeRelease = lifecycle.calls.length;
	releaseFirst.resolve();
	const results = await Promise.all([first, second]);

	assert.equal(lifecycleCallsBeforeRelease, 1, "the second host mutation waits behind the first");
	assert.deepEqual(results.map(result => result.outcome), ["applied", "applied"]);
	const state = store.load();
	assert.equal(state.receipts[firstEvent.identity.eventId]?.outcome, "applied");
	assert.equal(state.receipts[secondEvent.identity.eventId]?.outcome, "applied");
	assert.equal(state.usage["abort:worker-a"], 1);
	assert.equal(state.usage["abort:worker-b"], 1);
});

test("restart recovers completed receipts and refuses to replay orphaned in-progress claims", async (t) => {
	const { root, file } = stateFile();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const store = createFileSupervisorStateStore(file);

	const completedLifecycle = recordingLifecycle();
	const completedControl = createSupervisorControl({
		lifecycle: completedLifecycle.port,
		store,
		manifest: manifest(),
	});
	const completedEvent = eventOf({ sequence: 11 });
	const completed = await completedControl.apply(completedEvent, {
		kind: "abort",
		agentId: "worker-a",
		runId: "run-1",
	});
	assert.equal(completed.outcome, "applied");

	const restartedCompleted = createSupervisorControl({
		lifecycle: completedLifecycle.port,
		store,
		manifest: manifest(),
	});
	const replayCompleted = await restartedCompleted.apply(completedEvent, {
		kind: "abort",
		agentId: "worker-a",
		runId: "run-1",
	});
	assert.equal(replayCompleted.outcome, "duplicate");
	assert.equal(completedLifecycle.calls.length, 1);

	const crashing = recordingLifecycle({ failNext: "resolve" });
	const crashingControl = createSupervisorControl({
		lifecycle: crashing.port,
		store,
		manifest: manifest(),
	});
	const orphanEvent = eventOf({ sequence: 12, kind: "completion", status: "failed" });
	const crashed = await crashingControl.apply(orphanEvent, {
		kind: "resolve",
		agentId: "worker-a",
		runId: "run-1",
	});
	assert.equal(crashed.outcome, "escalation_required");
	assert.match(crashed.reason ?? "", /uncertain/);
	assert.equal(crashing.calls.length, 1);

	const recoveredLifecycle = recordingLifecycle();
	const recovered = createSupervisorControl({
		lifecycle: recoveredLifecycle.port,
		store,
		manifest: manifest(),
	});
	const orphans = recovered.recover();
	assert.equal(orphans.length, 1);
	assert.equal(orphans[0]?.outcome, "escalation_required");
	assert.equal(orphans[0]?.receiptId, orphanEvent.identity.eventId);
	assert.match(orphans[0]?.reason ?? "", /uncertain|in-progress|orphan/i);

	const replayOrphan = await recovered.apply(orphanEvent, {
		kind: "resolve",
		agentId: "worker-a",
		runId: "run-1",
	});
	assert.equal(replayOrphan.outcome, "escalation_required");
	assert.equal(recoveredLifecycle.calls.length, 0);
	assert.equal(crashing.calls.length, 1);
});

test("file-backed state stays compact, transcript-free, and project-scoped", async (t) => {
	const { root, file } = stateFile();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const lifecycle = recordingLifecycle();
	const control = createSupervisorControl({
		lifecycle: lifecycle.port,
		store: createFileSupervisorStateStore(file),
		manifest: manifest(),
	});
	await control.apply(eventOf({ sequence: 20, summary: "full worker log should never be persisted" }), {
		kind: "status",
		agentId: "worker-a",
		runId: "run-1",
	});

	const raw = readFileSync(file, "utf8");
	assert.doesNotMatch(raw, /transcript|messages|findings|full worker log/i);
	assert.ok(raw.length < 2_000, `state file should stay compact, got ${raw.length} bytes`);
	const parsed = parseSupervisorState(JSON.parse(raw) as unknown);
	assert.equal(parsed.version, 1);
	assert.equal(Object.keys(parsed).sort().join(","), "receipts,usage,version");
	const claim = parsed.receipts[eventOf({ sequence: 20 }).identity.eventId];
	assert.ok(claim);
	assert.equal(claim?.status, "completed");
	assert.equal(claim?.outcome, "applied");
	assert.equal("transcript" in (claim as object), false);
	assert.deepEqual(claim?.evidenceRefs, ["artifact://status/worker-a/run-1"]);

	assert.throws(() => assertProjectScopedSupervisorStatePath(join(homedir(), ".pi", "agent", "supervisor-state.json")), /global ~\/\.pi/);
	assert.throws(() => createFileSupervisorStateStore(join(tmpdir(), "supervisor-state.json")), /project \.pi\/agent/);
});

test("Supervisor state is isolated by exact Boss session without persisting the raw session key", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "pipiui-supervisor-session-state-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const sessionA = "boss/session:a?secret-shaped";
	const sessionB = "boss/session:b?secret-shaped";
	const fileA = supervisorSessionStatePath(root, sessionA);
	const fileB = supervisorSessionStatePath(root, sessionB);
	assert.notEqual(fileA, fileB);
	assert.equal(fileA.includes(sessionA), false);
	assert.equal(fileB.includes(sessionB), false);

	const controlA = createSupervisorControl({
		lifecycle: recordingLifecycle().port,
		store: createFileSupervisorStateStore(fileA),
		manifest: manifest(),
	});
	const event = eventOf({ sequence: 91 });
	await controlA.apply(event, { kind: "status", agentId: "worker-a", runId: "run-1" });

	assert.ok(createFileSupervisorStateStore(fileA).load().receipts[event.identity.eventId]);
	assert.equal(createFileSupervisorStateStore(fileB).load().receipts[event.identity.eventId], undefined);
});
