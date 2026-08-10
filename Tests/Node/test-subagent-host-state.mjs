import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	decodeAgentEventV1,
	decodeJobsSnapshotV1,
	decodePlanEventV1,
	decodePlanRevisionResponseV1,
} from "../../Sources/PipiUI/PiExt/subagent-host/contract.ts";
import {
	agentRunKeyV1,
	applyAgentEventV1,
	applyPlanEventV1,
	createAgentProjectionStateV1,
	createNodeFsStorageAdapterV1,
	createPlanStateV1,
	decodeAndApplyAgentEventV1,
	loadAgentProjectionStateV1,
	loadPlanStateV1,
	reconcileInterruptedAgentRunsV1,
	reconcileJobsSnapshotV1,
	selectJobsSnapshotV1,
	saveAgentProjectionStateV1,
	savePlanStateV1,
} from "../../Sources/PipiUI/PiExt/subagent-host/state/index.ts";

const fixtureURL = (name) => new URL(
	`../../Sources/PipiUI/PiExt/subagent-host/fixtures/${name}`,
	import.meta.url,
);

async function fixture(name) {
	return JSON.parse(await readFile(fixtureURL(name), "utf8"));
}

function decodedAgent(raw) {
	const decoded = decodeAgentEventV1(raw);
	assert.equal(decoded.ok, true, JSON.stringify(decoded.diagnostics));
	return decoded.value;
}

function decodedPlan(raw) {
	const decoded = decodePlanEventV1(raw);
	assert.equal(decoded.ok, true, JSON.stringify(decoded.diagnostics));
	return decoded.value;
}

function start(agentId, runId, extra = {}) {
	return decodedAgent({
		schemaVersion: 1,
		kind: "start",
		agentId,
		runId,
		name: "worker",
		task: "work",
		depth: 1,
		...extra,
	});
}

function update(agentId, runId, extra = {}) {
	return decodedAgent({ schemaVersion: 1, kind: "update", agentId, runId, ...extra });
}

function end(agentId, runId, extra = {}) {
	return decodedAgent({ schemaVersion: 1, kind: "end", agentId, runId, ok: true, ...extra });
}

function closeout(agentId, runId, extra = {}) {
	return decodedAgent({
		schemaVersion: 1,
		kind: "closeout",
		agentId,
		runId,
		disposition: "cleaned",
		...extra,
	});
}

function applyPlan(state, event, options) {
	const result = applyPlanEventV1(state, event, options);
	const decoded = decodePlanRevisionResponseV1(result.response);
	assert.equal(decoded.ok, true, JSON.stringify(decoded.diagnostics));
	return result;
}

test("agent projection reduces every v1 fixture kind and links parent/child runs", async () => {
	const agents = await fixture("agent-events-v1.json");
	let state = createAgentProjectionStateV1();
	for (let index = 0; index < agents.events.length; index++) {
		const event = decodedAgent(agents.events[index]);
		state = applyAgentEventV1(state, event, { observedAt: 1_000 + index });
		if (event.kind === "stalled") {
			const run = state.runsByKey[agentRunKeyV1(event.agentId, event.runId)];
			assert.equal(run.stalled, true);
			assert.equal(run.stalledIdleSec, 120);
		}
	}

	const key = agentRunKeyV1("host-contract", "run-001");
	const run = state.runsByKey[key];
	assert.equal(run.title, "Host protocol");
	assert.equal(run.output, "Implemented and verified.");
	assert.equal(run.activity, "");
	assert.equal(run.cost, 0.0234);
	assert.equal(run.turns, 3);
	assert.deepEqual(run.usage, {
		input: 1200,
		output: 340,
		cacheRead: 700,
		cacheWrite: 0,
		cost: 0.0123,
		contextTokens: 5100,
		lastTurn: 2,
		model: "openai-codex/gpt-5.6",
		tools: ["read", "edit"],
	});
	assert.equal(run.worktree.lifecycle, "pendingReview");
	assert.equal(run.worktree.branch, "pipiui/host-contract");
	assert.equal(run.verify.command, "node --experimental-strip-types --test Tests/Node/test-subagent-host-protocol.mjs");
	assert.equal(run.verify.exit, 0);
	assert.equal(run.terminal, true);
	assert.deepEqual(run.terminalFlags, { ok: true, aborted: false, interrupted: false, vanished: false });
	assert.equal(run.logs.length, 4, "stream delta plus final message items are retained");

	const closed = state.runsByKey[agentRunKeyV1("closeout-contract", "run-closeout")];
	assert.equal(closed.state, "failed");
	assert.equal(closed.closeoutDisposition, "cleaned");
	assert.equal(closed.closeoutReason, "Boss marked this failed episode handled after review.");
	assert.equal(closed.closeoutAt, 1786320005000);
	assert.equal(closed.worktree.lifecycle, "pendingReview", "closeout must not schedule or erase retained worktree evidence");

	const parent = start("parent", "parent-run");
	const child = start("child", "child-run", { parentId: "parent", toolCallId: "call-child" });
	state = applyAgentEventV1(state, parent, { observedAt: 2_000 });
	state = applyAgentEventV1(state, child, { observedAt: 2_001 });
	const parentKey = agentRunKeyV1("parent", "parent-run");
	const childKey = agentRunKeyV1("child", "child-run");
	assert.equal(state.runsByKey[childKey].parentKey, parentKey);
	assert.deepEqual(state.runsByKey[parentKey].childKeys, [childKey]);
});

test("agentId reuse is isolated by runId, including late old-run updates and ends", () => {
	let state = createAgentProjectionStateV1();
	state = applyAgentEventV1(state, start("reused", "run-one"), { observedAt: 1 });
	state = applyAgentEventV1(state, update("reused", "run-one", { output: "first" }), { observedAt: 2 });
	state = applyAgentEventV1(state, end("reused", "run-one", { output: "first done" }), { observedAt: 3 });
	state = applyAgentEventV1(state, start("reused", "run-two", { title: "new episode" }), { observedAt: 4 });
	state = applyAgentEventV1(state, update("reused", "run-two", { output: "new live output", activity: "working" }), { observedAt: 5 });

	// These are deliberately old, out-of-order packets. They may refine old history,
	// but never resolve via agentId and never touch run-two.
	state = applyAgentEventV1(state, update("reused", "run-one", { output: "late old output", cost: 9 }), { observedAt: 6 });
	state = applyAgentEventV1(state, end("reused", "run-one", { interrupted: true, ok: false }), { observedAt: 7 });
	state = applyAgentEventV1(state, closeout("reused", "run-one", {
		reason: "old episode handled",
		closeoutAt: 8,
	}), { observedAt: 8 });
	const afterFirstCloseout = state;
	state = applyAgentEventV1(state, closeout("reused", "run-one", {
		reason: "late duplicate must not overwrite",
		closeoutAt: 9,
	}), { observedAt: 9 });
	assert.equal(state, afterFirstCloseout, "duplicate closeout is idempotent and does not rewrite first evidence");

	const oldRun = state.runsByKey[agentRunKeyV1("reused", "run-one")];
	const newRun = state.runsByKey[agentRunKeyV1("reused", "run-two")];
	assert.equal(oldRun.output, "late old output");
	assert.equal(oldRun.state, "interrupted");
	assert.equal(oldRun.closeoutDisposition, "cleaned");
	assert.equal(oldRun.closeoutReason, "old episode handled");
	assert.equal(newRun.output, "new live output");
	assert.equal(newRun.activity, "working");
	assert.equal(newRun.state, "running");
	assert.equal(state.latestRunKeyByAgentId.reused, newRun.key);
	assert.deepEqual(state.runKeysByAgentId.reused, [oldRun.key, newRun.key]);
});

test("JobsSnapshot selector is stable, display-only, and never leaks reducer rows", () => {
	let state = createAgentProjectionStateV1();
	state = applyAgentEventV1(state, start("zeta", "run-z"), { observedAt: 20 });
	state = applyAgentEventV1(state, update("zeta", "run-z", { output: "zeta output", cost: 0, turns: 0 }), { observedAt: 21 });
	state = applyAgentEventV1(state, start("alpha", "run-a", { title: "First" }), { observedAt: 10 });
	state = applyAgentEventV1(state, end("alpha", "run-a", { output: "done" }), { observedAt: 11 });

	const snapshot = selectJobsSnapshotV1(state, { generatedAt: "2026-08-10T00:00:00.000Z" });
	const decoded = decodeJobsSnapshotV1(snapshot);
	assert.equal(decoded.ok, true, JSON.stringify(decoded.diagnostics));
	assert.equal(snapshot.generatedAt, "2026-08-10T00:00:00.000Z");
	assert.deepEqual(snapshot.jobs.map((job) => `${job.agentId}:${job.runId}`), ["alpha:run-a", "zeta:run-z"]);
	assert.equal(snapshot.jobs[0].resultText, "done");
	assert.equal(snapshot.jobs[1].cost, 0, "zero display values must survive serialization");
	assert.equal("logs" in snapshot.jobs[0], false, "display consumers must not receive reducer log internals");

	snapshot.jobs[0].resultText = "mutated consumer copy";
	assert.equal(state.runsByKey[agentRunKeyV1("alpha", "run-a")].output, "done");
});

test("late update cannot reopen a terminal worktree projection", () => {
	let state = createAgentProjectionStateV1();
	state = applyAgentEventV1(state, start("review", "run", {
		worktreePath: "/tmp/review-original",
		worktreeBranch: "pipiui/review",
	}), { observedAt: 1 });
	state = applyAgentEventV1(state, end("review", "run"), { observedAt: 2 });
	state = applyAgentEventV1(state, update("review", "run", {
		activity: "late telemetry",
		worktreePath: "/tmp/late-update-must-not-apply",
		worktreeBranch: "pipiui/late-update",
		worktreeError: "late worktree metadata",
	}), { observedAt: 3 });

	const run = state.runsByKey[agentRunKeyV1("review", "run")];
	assert.equal(run.terminal, true);
	assert.equal(run.state, "ok");
	assert.equal(run.activity, "late telemetry");
	assert.equal(run.worktree.lifecycle, "pendingReview");
	assert.equal(run.worktree.path, "/tmp/review-original");
	assert.equal(run.worktree.branch, "pipiui/review");
	assert.equal(run.worktree.error, undefined);
});

test("agent logs are cumulative-slot upserts, turn-bounded, and capped", () => {
	let state = createAgentProjectionStateV1();
	state = applyAgentEventV1(state, start("logs", "run"), { maxLogs: 2 });
	state = applyAgentEventV1(state, decodedAgent({
		schemaVersion: 1, kind: "log_delta", agentId: "logs", runId: "run", contentIndex: 0, itemType: "text", text: "hel",
	}), { maxLogs: 2 });
	state = applyAgentEventV1(state, decodedAgent({
		schemaVersion: 1, kind: "log_delta", agentId: "logs", runId: "run", contentIndex: 0, itemType: "text", text: "hello",
	}), { maxLogs: 2 });
	state = applyAgentEventV1(state, decodedAgent({
		schemaVersion: 1,
		kind: "log",
		agentId: "logs",
		runId: "run",
		items: [
			{ itemType: "tool", name: "bash", text: "one" },
			{ itemType: "toolResult", name: "bash", text: "two" },
		],
	}), { maxLogs: 2 });
	let run = state.runsByKey[agentRunKeyV1("logs", "run")];
	assert.deepEqual(run.logs.map((item) => item.text), ["one", "two"], "oldest stream row was evicted at cap");

	state = applyAgentEventV1(state, decodedAgent({
		schemaVersion: 1, kind: "log_delta", agentId: "logs", runId: "run", contentIndex: 0, itemType: "text", text: "next turn",
	}), { maxLogs: 2 });
	run = state.runsByKey[agentRunKeyV1("logs", "run")];
	assert.deepEqual(run.logs.map((item) => item.text), ["two", "next turn"], "log boundary resets stream slots");
});

test("snapshot reconnect is projection-only, preserves terminal history, and reconciles missing live runs", async () => {
	const rawSnapshot = await fixture("jobs-snapshot-v1.json");
	const decodedSnapshot = decodeJobsSnapshotV1(rawSnapshot);
	assert.equal(decodedSnapshot.ok, true, JSON.stringify(decodedSnapshot.diagnostics));

	let state = createAgentProjectionStateV1();
	state = applyAgentEventV1(state, start("ghost", "missing-live", { worktreePath: "/tmp/ghost", worktreeBranch: "pipiui/ghost" }), { observedAt: 1 });
	state = applyAgentEventV1(state, start("history", "completed"), { observedAt: 2 });
	state = applyAgentEventV1(state, end("history", "completed"), { observedAt: 3 });
	state = reconcileJobsSnapshotV1(state, decodedSnapshot.value, { observedAt: 4_000 });

	const ghost = state.runsByKey[agentRunKeyV1("ghost", "missing-live")];
	const history = state.runsByKey[agentRunKeyV1("history", "completed")];
	const live = state.runsByKey[agentRunKeyV1("host-contract", "run-001")];
	assert.equal(ghost.state, "interrupted");
	assert.equal(ghost.reconciled, true);
	assert.equal(ghost.activity, "");
	assert.equal(ghost.worktree.lifecycle, "pendingReview");
	assert.equal(history.state, "ok", "snapshot reconciliation never erases terminal history");
	assert.equal(live.state, "running");
	assert.equal(live.activity, "write contract.ts");
	assert.equal(live.cost, 0.0123);
	assert.equal(state.runsByKey[agentRunKeyV1("finished-worker", "run-002")].state, "ok");
	assert.equal(state.runsByKey[agentRunKeyV1("closed-worker", "run-003")].closeoutDisposition, "cleaned");
});

test("agent persistence stages then renames, is restart-safe, and protects corrupt/future files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pipiui-portable-state-"));
	try {
		const storage = createNodeFsStorageAdapterV1();
		const path = join(directory, "agents.json");
		let state = createAgentProjectionStateV1();
		state = applyAgentEventV1(state, start("restart-live", "r1"), { observedAt: 10 });
		state = applyAgentEventV1(state, start("finished", "r2"), { observedAt: 11 });
		state = applyAgentEventV1(state, end("finished", "r2"), { observedAt: 12 });
		const saved = await saveAgentProjectionStateV1(storage, path, state);
		assert.equal(saved.ok, true);
		assert.equal(saved.stagingPath, `${path}.staging`);

		const loaded = await loadAgentProjectionStateV1(storage, path, { observedAt: 99 });
		assert.equal(loaded.status, "loaded");
		assert.equal(loaded.reconciled, true);
		assert.equal(loaded.state.runsByKey[agentRunKeyV1("restart-live", "r1")].state, "interrupted");
		assert.equal(loaded.state.runsByKey[agentRunKeyV1("finished", "r2")].state, "ok");
		assert.equal(reconcileInterruptedAgentRunsV1(loaded.state, { observedAt: 100 }), loaded.state, "restart reconciliation is idempotent once terminal");

		const corruptPath = join(directory, "corrupt.json");
		await writeFile(corruptPath, "{not json", "utf8");
		const corrupt = await loadAgentProjectionStateV1(storage, corruptPath);
		assert.equal(corrupt.status, "corrupt");
		assert.equal(corrupt.writable, false);
		const refusedCorrupt = await saveAgentProjectionStateV1(storage, corruptPath, state);
		assert.equal(refusedCorrupt.ok, false);
		assert.equal(refusedCorrupt.reason, "corrupt_existing");
		assert.equal(await readFile(corruptPath, "utf8"), "{not json");

		const futurePath = join(directory, "future.json");
		await writeFile(futurePath, JSON.stringify({ schemaVersion: 2, preserved: true }), "utf8");
		const future = await loadAgentProjectionStateV1(storage, futurePath);
		assert.equal(future.status, "future_schema");
		assert.equal(future.writable, false);
		const refusedFuture = await saveAgentProjectionStateV1(storage, futurePath, state);
		assert.deepEqual(refusedFuture, { ok: false, reason: "future_schema" });
		assert.deepEqual(JSON.parse(await readFile(futurePath, "utf8")), { schemaVersion: 2, preserved: true });

		const files = new Map();
		const operations = [];
		const injected = {
			async readText(file) { return files.get(file); },
			async writeText(file, text) { operations.push(["write", file]); files.set(file, text); },
			async rename(from, to) { operations.push(["rename", from, to]); files.set(to, files.get(from)); files.delete(from); },
		};
		const injectedSave = await saveAgentProjectionStateV1(injected, "/electron-owned/agents.json", state);
		assert.equal(injectedSave.ok, true);
		assert.deepEqual(operations, [
			["write", "/electron-owned/agents.json.staging"],
			["rename", "/electron-owned/agents.json.staging", "/electron-owned/agents.json"],
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("PlanEventV1 fixture preserves approval boundary, revision responses, and cancellation", async () => {
	const plans = await fixture("plan-events-v1.json");
	let state = createPlanStateV1();
	const revisions = [];
	for (const raw of plans.events) {
		const result = applyPlan(state, decodedPlan(raw));
		state = result.state;
		revisions.push(result.response.revision);
	}
	assert.deepEqual(revisions, [1, 2, 3, 4]);
	assert.equal(state.plan.id, "host-contract-plan");
	assert.equal(state.plan.tasks[0].state, "completed");
	assert.equal(state.plan.lifecycle, "cancelled");

	const rejected = applyPlan(state, decodedPlan({
		schemaVersion: 1,
		event: "task_update",
		planId: "host-contract-plan",
		task: { id: "contract", state: "running" },
	}));
	assert.equal(rejected.response.ok, false);
	assert.equal(rejected.response.error, "plan is cancelled");
	assert.equal(rejected.response.currentRevision, 4);
});

test("plan reducer rejects stale/revision-conflict paths, validates transitions and duplicate IDs", () => {
	const publish = decodedPlan({
		schemaVersion: 1,
		event: "publish",
		plan: {
			id: "plan-a",
			title: "Ship",
			tasks: [{ id: "task-a", title: "Implement", state: "pending", detail: "" }],
		},
	});
	let state = createPlanStateV1();
	let result = applyPlan(state, publish);
	state = result.state;
	assert.equal(state.plan.lifecycle, "awaitingApproval");

	const preApproval = applyPlan(state, decodedPlan({
		schemaVersion: 1,
		event: "task_update",
		planId: "plan-a",
		task: { id: "task-a", state: "running" },
	}));
	assert.equal(preApproval.response.error, "plan is awaiting approval");
	assert.equal(preApproval.response.currentRevision, 1, "rejection returns the authoritative revision");

	result = applyPlan(state, decodedPlan({ schemaVersion: 1, event: "approve", planId: "plan-a" }));
	state = result.state;
	result = applyPlan(state, decodedPlan({ schemaVersion: 1, event: "task_update", planId: "plan-a", task: { id: "task-a", state: "running" } }));
	state = result.state;
	assert.equal(state.plan.tasks[0].detail, undefined, "running clears stale detail when no replacement is provided");
	result = applyPlan(state, decodedPlan({ schemaVersion: 1, event: "task_update", planId: "plan-a", task: { id: "task-a", state: "completed" } }));
	state = result.state;
	const illegal = applyPlan(state, decodedPlan({ schemaVersion: 1, event: "task_update", planId: "plan-a", task: { id: "task-a", state: "failed" } }));
	assert.equal(illegal.response.error, "illegal task transition completed → failed");
	assert.equal(illegal.response.currentRevision, state.plan.revision);

	result = applyPlan(state, decodedPlan({ schemaVersion: 1, event: "cancel", planId: "plan-a" }));
	state = result.state;
	const reused = applyPlan(state, publish);
	assert.equal(reused.response.error, "plan.id was already used in this session");

	const duplicate = {
		schemaVersion: 1,
		event: "publish",
		plan: {
			id: "plan-b",
			title: "Duplicate",
			tasks: [
				{ id: "same", title: "One", state: "pending" },
				{ id: "same", title: "Two", state: "pending" },
			],
		},
	};
	const decoderRejects = decodePlanEventV1(duplicate);
	assert.equal(decoderRejects.ok, false, "contract decoder is the first duplicate-ID boundary");
	assert.ok(decoderRejects.diagnostics.some((entry) => entry.code === "duplicate_task_id"));
	const reducerRejects = applyPlanEventV1(state, duplicate);
	assert.equal(reducerRejects.response.error, "duplicate task id same", "reducer also protects direct typed callers");
});

test("plan persistence is optional and caller-path injected", async () => {
	const files = new Map();
	const storage = {
		async readText(path) { return files.get(path); },
		async writeText(path, text) { files.set(path, text); },
		async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
	};
	let state = createPlanStateV1();
	const published = applyPlan(state, decodedPlan({
		schemaVersion: 1,
		event: "publish",
		plan: { id: "persisted-plan", title: "Persist", tasks: [{ id: "one", title: "One", state: "pending" }] },
	}));
	state = published.state;
	assert.equal((await savePlanStateV1(storage, "/electron-owned/plan.json", state)).ok, true);
	const loaded = await loadPlanStateV1(storage, "/electron-owned/plan.json");
	assert.equal(loaded.status, "loaded");
	assert.equal(loaded.state.plan.id, "persisted-plan");
	assert.deepEqual(loaded.state.usedPlanIds, ["persisted-plan"]);

	const decodedResult = decodeAndApplyAgentEventV1(createAgentProjectionStateV1(), {
		schemaVersion: 1, kind: "update", agentId: "missing", runId: "run", output: "ignored",
	});
	assert.equal(decodedResult.applied, true, "typed decoder boundary accepts valid but unknown-run telemetry without creating a row");
	assert.equal(Object.keys(decodedResult.state.runsByKey).length, 0);
});
