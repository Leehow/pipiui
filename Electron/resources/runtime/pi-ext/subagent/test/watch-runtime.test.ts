import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	buildWatchFingerprint,
	createWatchRegistry,
	DEFAULT_WATCH_INTERVAL_SECS,
	sanitizeWatchIntervalSecs,
	WATCH_INTERVAL_MAX_SECS,
	WATCH_INTERVAL_MIN_SECS,
	WATCH_ACTIONS,
} from "../watch-registry.ts";
import { runSubagentWatch, watchObservationFor, __watchRuntimeForTests } from "../index.ts";

function source(): string {
	return readFileSync(new URL("../index.ts", import.meta.url), "utf8");
}

test("the watch action vocabulary and interval bounds match the shared watchdog cadence", () => {
	assert.deepEqual([...WATCH_ACTIONS], ["start", "update", "stop", "list"]);
	assert.equal(WATCH_INTERVAL_MIN_SECS, 30);
	assert.equal(WATCH_INTERVAL_MAX_SECS, 3600);
	assert.equal(DEFAULT_WATCH_INTERVAL_SECS, 60);

	assert.equal(sanitizeWatchIntervalSecs(undefined).secs, DEFAULT_WATCH_INTERVAL_SECS);
	assert.equal(sanitizeWatchIntervalSecs(30).secs, 30);
	assert.equal(sanitizeWatchIntervalSecs(3600).secs, 3600);
	assert.equal("problem" in sanitizeWatchIntervalSecs(29), true);
	assert.equal("problem" in sanitizeWatchIntervalSecs(3601), true);
	assert.equal("problem" in sanitizeWatchIntervalSecs(60.5), true);
});

test("runSubagentWatch rejects malformed actions and incomplete identities before touching anything", () => {
	const badAction = runSubagentWatch({ action: "pause" });
	assert.equal(badAction.ok, false);
	assert.match(badAction.message, /start \| update \| stop \| list/);

	const missingRun = runSubagentWatch({ action: "start", agentId: "quota-pill" });
	assert.equal(missingRun.ok, false);
	assert.match(missingRun.message, /requires both agentId and the exact runId/);

	const missingBoth = runSubagentWatch({ action: "stop", runId: "mtfa1b2-3c4d5e6f7a8b" });
	assert.equal(missingBoth.ok, false);
	assert.match(missingBoth.message, /requires both agentId and the exact runId/);
});

test("mutations bind an exact live run: unknown and stale pairs are named, never re-targeted", () => {
	// Empty runtime: no live run under this agentId at all.
	const start = runSubagentWatch({ action: "start", agentId: "quota-pill", runId: "mtfa1b2-3c4d5e6f7a8b" });
	assert.equal(start.ok, false);
	assert.match(start.message, /no live run with runId=/);
	assert.match(start.message, /subagent_status/);

	const update = runSubagentWatch({ action: "update", agentId: "quota-pill", runId: "mtfa1b2-3c4d5e6f7a8b" });
	assert.equal(update.ok, false);
	assert.match(update.message, /no live run with runId=/);

	const stop = runSubagentWatch({ action: "stop", agentId: "quota-pill", runId: "mtfa1b2-3c4d5e6f7a8b" });
	assert.equal(stop.ok, false);
	assert.match(stop.message, /no subscription for runId=/);
});

test("list is read-only: empty registry answers quietly and a half filter is rejected", () => {
	const all = runSubagentWatch({ action: "list" });
	assert.equal(all.ok, true);
	assert.match(all.message, /No active watch subscriptions\./);

	const half = runSubagentWatch({ action: "list", agentId: "quota-pill" });
	assert.equal(half.ok, false);
	assert.match(half.message, /either both agentId and runId|neither/);

	const otherHalf = runSubagentWatch({ action: "list", runId: "mtfa1b2-3c4d5e6f7a8b" });
	assert.equal(otherHalf.ok, false);
	assert.match(otherHalf.message, /either both agentId and runId|neither/);

	const exact = runSubagentWatch({ action: "list", agentId: "quota-pill", runId: "mtfa1b2-3c4d5e6f7a8b" });
	assert.equal(exact.ok, true);
	assert.match(exact.message, /No watch subscription for agentId=quota-pill/);
});

test("the observation fingerprint samples state, phase, tool, and verify — never log bytes", () => {
	// Composed exactly like watchObservationFor does: canonical key=value join over the
	// bounded field set, undefined fields omitted, identical observations identical.
	const fingerprint = buildWatchFingerprint({
		state: "running",
		phase: "tool-active",
		tool: "bash",
		verify: undefined,
	});
	assert.equal(fingerprint, "phase=tool-active\u0001state=running\u0001tool=bash");

	const src = source();
	const fnStart = src.indexOf("export function watchObservationFor");
	const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart));
	assert.ok(fnStart > 0);
	// The done boundary: from done-await-host the completion receipt is imminent, so the
	// observation returns undefined and the registry drops the subscription silently.
	assert.match(fnBody, /finalizationPhase === "done-await-host"[\s\S]{0,80}return undefined/);
	// Log bytes are deliberately absent: progress growth has its own single-flight channel.
	assert.ok(!fnBody.includes("progressLogSample"), "watch fingerprint must not sample log bytes");
	// Verify is read off the existing record — never re-run.
	assert.match(fnBody, /record\.runId === runId && record\.verify/);
	assert.match(fnBody, /record\.verify\.timedOut \|\| record\.verify\.exitCode !== 0 \? "failed" : "passed"/);
});

test("the shared 30s watchdog is the only scheduler: the watch sweep rides it, timerless", () => {
	const src = source();

	// Sweep order: after the progress-log sample/forward passes, before the stall pass.
	const tickIdx = src.indexOf("watchRegistry.tick({ now, observe:");
	const claimIdx = src.indexOf("claimProgressLogReport(progressHandle)");
	const stallIdx = src.indexOf("// (3) stall 推送");
	assert.ok(tickIdx > 0 && claimIdx > 0 && stallIdx > 0);
	assert.ok(claimIdx < tickIdx, "watch sweep must come after the progress forward pass");
	assert.ok(tickIdx < stallIdx, "watch sweep must come before the stall pass");

	// No timer of its own: the sweep body may not create one.
	const sweepBody = src.slice(tickIdx, src.indexOf("// (2c)", tickIdx));
	assert.ok(!sweepBody.includes("setInterval"));
	assert.ok(!sweepBody.includes("setTimeout"));

	// The existing single 30s watchdog keeps its reload guard; watch adds no second one.
	assert.match(src, /const STALL_WATCHDOG_KEY = "__pipiuiSubagentStallWatchdog";/);

	// Emission rides the Supervisor watch kind — judged, not forced — and settles the
	// registry slot in `finally` so a failed route cannot wedge the subscription.
	const emitStart = src.indexOf("async function deliverWatchSample");
	const emitBody = src.slice(emitStart, src.indexOf("\n}", emitStart));
	assert.match(emitBody, /kind: "watch",/);
	assert.ok(!emitBody.includes("forceForward"), "watch samples are judged by Supervisor, never force-forwarded");
	assert.match(emitBody, /watchRegistry\.ack\(\{ agentId: event\.agentId, runId: event\.runId, sequence: event\.sequence \}\);/);
	const tryIdx = emitBody.indexOf("try {");
	const finallyIdx = emitBody.indexOf("} finally {");
	assert.ok(tryIdx > 0 && finallyIdx > tryIdx, "routing must be wrapped so ack always settles");
	// The watch summary is hard-capped at the Supervisor contract bound.
	assert.match(emitBody, /\.slice\(0, 600\)/);
});

test("existing progress delivery is now truly single-flight through the landed claim helpers", () => {
	const src = source();

	// The watchdog's forward loop claims before dispatching and releases exactly its token.
	const loopStart = src.indexOf("const claim = claimProgressLogReport(progressHandle);");
	assert.ok(loopStart > 0);
	assert.match(src.slice(loopStart, loopStart + 400), /if \(!claim\) continue;/);
	assert.match(src, /\.finally\(\(\) => \{\n\t\t\t\t\treleaseProgressLogReport\(progressHandle, claim\);\n\t\t\t\t\}\);/);

	// The bare in-flight flag is no longer hand-managed anywhere in the runtime.
	assert.ok(!src.includes("progressReportInFlight = true"), "claim helper owns the flag now");
	assert.ok(!src.includes("progressReportInFlight = false;"));

	// The forward path reads through the state's single cursor — no private offset copy.
	assert.match(src, /const excerpt = consumeProgressLogExcerpt\(handle, \{ path: handle\.progressLogPath! \}\);/);
	assert.ok(!src.includes("readProgressLogExcerpt({ path: handle.progressLogPath!"));
});

test("session start, shutdown, and the tool surface wire the registry the same way", () => {
	const src = source();

	// Both lifecycle handlers clear: subscriptions never outlive the session that made them.
	const startIdx = src.indexOf('pi.on("session_start"');
	const shutdownIdx = src.indexOf('pi.on("session_shutdown"');
	const startBody = src.slice(startIdx, src.indexOf("\t});", startIdx));
	const shutdownBody = src.slice(shutdownIdx, src.indexOf("\t});", shutdownIdx));
	assert.match(startBody, /watchRegistry\.clear\(\);/);
	assert.match(shutdownBody, /watchRegistry\.clear\(\);/);

	// One public strict tool: same registration shape as its abort/progress/resolve siblings.
	assert.match(src, /name: "subagent_watch",/);
	assert.match(src, /parameters: SubagentWatchParams,\n\t\tprepareArguments: bindSanitizeStrictToolArguments\(SubagentWatchParams\),/);

	const schemaStart = src.indexOf("const SubagentWatchParams");
	const schema = src.slice(schemaStart, src.indexOf("type SubagentExecuteParams", schemaStart));
	assert.match(schema, /action: StringEnum\(WATCH_ACTIONS,/);
	assert.match(schema, /agentId: Type\.Optional\(Type\.String\(/);
	assert.match(schema, /runId: Type\.Optional\(Type\.String\(/);
	assert.match(schema, /intervalSecs: Type\.Optional\(Type\.Integer\(\{\n\t\tminimum: 30,\n\t\tmaximum: 3600,/);
	assert.match(schema, /additionalProperties: false/);

	// The handler gates, in order: exact live run, not finalizing, then interval, then the
	// optional progress aim — mutation only after every check passed.
	const fnStart = src.indexOf("export function runSubagentWatch");
	const fnEnd = src.indexOf("\tpi.registerTool({", fnStart);
	const fn = src.slice(fnStart, fnEnd);
	const order = [
		"handleForRun(pair.agentId, pair.runId)",
		"handle.finalizing",
		"sanitizeWatchIntervalSecs(input.intervalSecs)",
		"handle.progressLogEligible",
		"resolveProgressLogPath({",
		"watchRegistry.update({",
		"watchRegistry.start({",
	];
	let cursor = -1;
	for (const needle of order) {
		const at = fn.indexOf(needle);
		assert.ok(at > cursor, `watch gate out of order or missing: ${needle}`);
		cursor = at;
	}
	// The optional aim judges the same roots as subagent_progress — this run's own, not the
	// Boss's cwd alone — and borrows retargetProgressLog rather than a second mechanism.
	assert.match(fn, /spawnCwd: handle\.spawnCwd \?\? PIPIUI_MAIN_CWD,\n\t\tallowedRoots: \[PIPIUI_MAIN_CWD, handle\.spawnCwd \?\? "", handle\.worktreePath \?\? ""\],/);
	assert.match(fn, /retargetProgressLog\(handle, \{/);
});

test("the philosophy surfaces expose the tool to the Boss and nobody else", () => {
	const capabilities = JSON.parse(
		readFileSync(new URL("../../../pi-philosophy/capabilities.json", import.meta.url), "utf8"),
	);
	assert.equal(capabilities.capabilities.delegate_watch.tool, "subagent_watch");
	assert.equal(capabilities.capabilities.delegate_watch.required, false);

	const attribution = readFileSync(
		new URL("../../../pi-philosophy/retrieval-attribution.ts", import.meta.url),
		"utf8",
	);
	const group = attribution.slice(attribution.indexOf("orchestration: ["), attribution.indexOf("]", attribution.indexOf("orchestration: [")));
	assert.match(group, /"subagent_watch"/);

	// The orchestration layer (Boss-only prose) references it by capability placeholder.
	const layer = readFileSync(
		new URL("../layers/30-orchestration.md", import.meta.url),
		"utf8",
	);
	assert.match(layer, /\{\{delegate_watch\}\}/);
	assert.ok(!layer.includes("subagent_watch"), "layer bodies never name a tool directly");
});

test("registry smoke: the wired contract stays silent on unchanged ticks and emits once on change", () => {
	// End-to-end over the same primitives the runtime wires: fake clock, observation via the
	// canonical fingerprint composition, ack settling, terminal drop on a gone run.
	const registry = createWatchRegistry();
	const t0 = 1_000_000;
	const baseline = buildWatchFingerprint({ state: "running", phase: "generating" });
	const started = registry.start({ agentId: "quota-pill", runId: "mtfa1b2-3c4d5e6f7a8b", now: t0, fingerprint: baseline });
	assert.equal(started.ok, true);
	if (!started.ok) return;

	let observed = baseline;
	let gone = false;
	assert.deepEqual(registry.tick({ now: t0 + 60_000, observe: () => (gone ? undefined : observed) }), []);

	observed = buildWatchFingerprint({ state: "running", phase: "tool-active", tool: "bash" });
	const events = registry.tick({ now: t0 + 120_000, observe: () => (gone ? undefined : observed) });
	assert.equal(events.length, 1);
	assert.equal(events[0].sequence, 1);
	// The runtime settles the exact sequence once its delivery resolves; nothing is pending.
	assert.deepEqual(registry.ack({ agentId: "quota-pill", runId: "mtfa1b2-3c4d5e6f7a8b", sequence: 1 }), { ok: true, pending: false });

	// The same change again emits nothing (ack already settled it; fingerprint matches).
	assert.deepEqual(registry.tick({ now: t0 + 180_000, observe: () => (gone ? undefined : observed) }), []);
	assert.deepEqual(registry.list(), [{
		agentId: "quota-pill",
		runId: "mtfa1b2-3c4d5e6f7a8b",
		intervalSecs: 60,
		intervalMs: 60_000,
		nextSampleAt: t0 + 240_000,
		startedAt: t0,
		lastEventSeq: 1,
		inFlight: false,
		pendingChange: false,
	}]);

	// A gone run drops its subscription instead of fabricating a terminal event.
	gone = true;
	assert.deepEqual(registry.tick({ now: t0 + 240_000, observe: () => (gone ? undefined : observed) }), []);
	assert.equal(registry.size, 0);
});

test("watchObservationFor reports unknown runs as gone without throwing", () => {
	// No live run in this process: the undefined the registry treats as "drop silently".
	assert.equal(watchObservationFor("no-such-worker", "mtfa1b2-3c4d5e6f7a8b", Date.now()), undefined);
});

test("41 busy-session samples are dropped without a Pi or extension backlog", async () => {
	const runtime = __watchRuntimeForTests;
	const now = Date.now();
	const ids = ["watch-baseline", "watch-knowledge", "watch-pdf", "watch-viewer"];
	const sent: string[] = [];
	const pi = {
		sendUserMessage: async (text: string) => { sent.push(text); runtime.bossTurnBusy = true; },
		sendMessage: (message: { content: string }) => { sent.push(message.content); runtime.bossTurnBusy = true; },
	} as any;
	try {
		runtime.bossTurnBusy = true;
		for (const agentId of ids) {
			runtime.runningAgents.set(agentId, {
				runId: "run-watch", controller: new AbortController(), name: "general-purpose", title: agentId,
				task: "watch fixture", lastActivityAt: now, startedAt: now, lastStallNotifyAt: 0, stallNotifyCount: 0,
				diagnostics: { eventSeq: 0, supervisorPid: process.pid, processGeneration: "watch-test", stdoutBytes: 0, stderrBytes: 0 },
			} as any);
			runtime.registry.start({ agentId, runId: "run-watch", now, fingerprint: watchObservationFor(agentId, "run-watch", now)! });
		}
		for (let seq = 1; seq <= 11; seq++) {
			const tick = now + seq * 60_000;
			for (const [index, agentId] of ids.entries()) {
				const handle = runtime.runningAgents.get(agentId)!;
				handle.lastActivityAt = tick;
				if ((index === 2 && seq > 10) || (index === 3 && seq > 9)) continue;
				handle.diagnostics.finalizationPhase = seq % 2 ? "tool-active" : "generating";
			}
			for (const event of runtime.registry.tick({ now: tick, observe: target => watchObservationFor(target.agentId, target.runId, tick) })) {
				await runtime.deliverWatchSample(pi, event);
			}
		}
		assert.equal(sent.length, 0, "no sample may enter Pi's follow-up queue while busy");
		assert.equal(runtime.heldSignals.length, 0, "busy samples do not retain notification text");
		runtime.bossTurnBusy = false;
		runtime.flushHeldSignals(pi);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(sent.length, 0, "settling does not replay old watch samples");
	} finally {
		runtime.bossTurnBusy = false;
		runtime.heldSignals.length = 0;
		runtime.registry.clear();
		for (const agentId of ids) runtime.runningAgents.delete(agentId);
	}
});

test("busy watch forwards cannot outlive their run or session", async () => {
	const runtime = __watchRuntimeForTests;
	const agentId = "watch-expired";
	const runId = "run-expired";
	const now = Date.now();
	const handle = { runId, controller: new AbortController(), name: "general-purpose", task: "fixture", lastActivityAt: now, startedAt: now, lastStallNotifyAt: 0, stallNotifyCount: 0, diagnostics: { eventSeq: 0 } } as any;
	const sent: string[] = [];
	const pi = { sendUserMessage: async (text: string) => { sent.push(text); } } as any;
	const text = `[subagent-watch] ${agentId} (Expired) — state=running\nrunId=${runId} seq=1.`;
	try {
		for (const expire of [() => runtime.runningAgents.delete(agentId), () => { runtime.generation += 1; }]) {
			runtime.runningAgents.set(agentId, handle);
			runtime.registry.start({ agentId, runId, now, fingerprint: "state=running" });
			runtime.bossTurnBusy = true;
			await runtime.sendUserMessage(pi, text);
			assert.equal(runtime.heldSignals.length, 0);
			expire();
			runtime.bossTurnBusy = false;
			runtime.flushHeldSignals(pi);
			await new Promise(resolve => setImmediate(resolve));
			assert.equal(runtime.heldSignals.length, 0);
			assert.equal(sent.length, 0);
		}
	} finally {
		runtime.bossTurnBusy = false;
		runtime.heldSignals.length = 0;
		runtime.registry.clear();
		runtime.runningAgents.delete(agentId);
	}
});

test("the void extension sender reserves admission and drops siblings instead of replaying", async () => {
	const runtime = __watchRuntimeForTests;
	runtime.notificationContext = { isIdle: () => true, hasPendingMessages: () => false };
	const now = Date.now();
	const sent: string[] = [];
	const pi = {
		sendUserMessage: (text: string) => { sent.push(text); },
		sendMessage: (message: { content: string }) => { sent.push(message.content); },
	} as any;
	const ids = ["watch-first", "watch-second"];
	const sample = (id: string, seq: number) => `[subagent-watch] ${id} (${id}) — state=running\nrunId=run-race seq=${seq}.`;
	try {
		runtime.bossTurnBusy = false;
		for (const agentId of ids) {
			runtime.runningAgents.set(agentId, { runId: "run-race", controller: new AbortController(), diagnostics: {}, name: "general-purpose" } as any);
			runtime.registry.start({ agentId, runId: "run-race", now, fingerprint: "state=running" });
		}
		assert.equal(await runtime.sendUserMessage(pi, sample(ids[0], 1)), true);
		assert.equal(await runtime.sendUserMessage(pi, sample(ids[1], 1)), false);
		assert.equal(await runtime.sendUserMessage(pi, sample(ids[1], 2)), false);
		assert.equal(sent.length, 1, "void return is not a delivery acknowledgement");
		assert.equal(runtime.heldSignals.length, 0);
		runtime.bossTurnBusy = true; // before_agent_start takes over the reservation
		runtime.flushHeldSignals(pi);
		assert.equal(sent.length, 1);
		runtime.bossTurnBusy = false;
		runtime.flushHeldSignals(pi);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(sent.length, 1, "no queued sibling to replay");
	} finally {
		runtime.notificationContext = undefined;
		runtime.bossTurnBusy = false;
		runtime.heldSignals.length = 0;
		runtime.registry.clear();
		for (const id of ids) runtime.runningAgents.delete(id);
	}
});

test("activity counters stay silent while semantic state changes emit once", () => {
	const agentId = "worker-activity-test";
	const runId = "run-act-100";
	const t0 = 1_000_000;

	const handle = {
		runId,
		controller: new AbortController(),
		name: "general-purpose",
		task: "execute code",
		lastActivityAt: t0,
		lastStallNotifyAt: 0,
		stallNotifyCount: 0,
		startedAt: t0,
		finalizing: false,
		diagnostics: {
			processGeneration: "1:1000",
			supervisorPid: process.pid,
			eventSeq: 0,
			stdoutBytes: 0,
			stderrBytes: 0,
		},
	};
	__watchRuntimeForTests.runningAgents.set(agentId, handle as any);

	try {
		const baseline = watchObservationFor(agentId, runId, t0);
		assert.ok(baseline !== undefined);
		assert.doesNotMatch(baseline, /lastActivityAt|eventSeq/);
		assert.match(baseline, /state=running/);
		// No transcript/raw log bytes exposed
		assert.ok(!baseline.includes("stdout"));
		assert.ok(!baseline.includes("stderr"));
		assert.ok(!baseline.includes("progressLog"));

		const registry = createWatchRegistry();
		const started = registry.start({ agentId, runId, now: t0, fingerprint: baseline });
		assert.equal(started.ok, true);

		// Tick 1 at t0 + 60s: no worker activity occurred (lastActivityAt still t0, eventSeq still 0)
		const tick1 = registry.tick({
			now: t0 + 60_000,
			observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 60_000),
		});
		// Fingerprint is identical so tick returns nothing (silent!)
		assert.deepEqual(tick1, []);

		// Real worker activity occurs at t0 + 75s
		handle.lastActivityAt = t0 + 75_000;
		handle.diagnostics.eventSeq += 1;

		// Tick 2: ordinary output/telemetry does not wake the Boss.
		const tick2 = registry.tick({
			now: t0 + 120_000,
			observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 120_000),
		});
		assert.deepEqual(tick2, []);

		// Tick 3 at t0 + 150s: no new worker activity occurred (idle 75s < stall threshold)
		const tick3 = registry.tick({
			now: t0 + 150_000,
			observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 150_000),
		});
		// Stays completely silent!
		assert.deepEqual(tick3, []);

		// Tick 4 at t0 + 180s: still no new activity (idle 105s < stall threshold) -> still silent
		const tick4 = registry.tick({
			now: t0 + 180_000,
			observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 180_000),
		});
		assert.deepEqual(tick4, []);

		// Tick 5 at t0 + 240s: idle reaches stall threshold (idle 165s >= 120s) -> state transitions to stalled!
		const tick5 = registry.tick({
			now: t0 + 240_000,
			observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 240_000),
		});
		assert.equal(tick5.length, 1);
		assert.equal(tick5[0].sequence, 1);
		assert.match(tick5[0].fingerprint, /state=stalled/);
	} finally {
		__watchRuntimeForTests.runningAgents.delete(agentId);
		__watchRuntimeForTests.jobRegistry.delete(agentId);
	}
});

test("a held watch delivery cannot route after terminal removal and ack does not resurrect", async () => {
	const agentId = "worker-term-test";
	const runId = "run-term-200";
	const t0 = 1_000_000;

	const handle = {
		runId,
		controller: new AbortController(),
		name: "general-purpose",
		task: "execute code",
		lastActivityAt: t0,
		lastStallNotifyAt: 0,
		stallNotifyCount: 0,
		startedAt: t0,
		finalizing: false,
		diagnostics: {
			processGeneration: "1:1000",
			supervisorPid: process.pid,
			eventSeq: 0,
			stdoutBytes: 0,
			stderrBytes: 0,
		},
	};
	__watchRuntimeForTests.runningAgents.set(agentId, handle as any);

	// Start watch subscription in runtime registry
	const baseline = watchObservationFor(agentId, runId, t0)!;
	__watchRuntimeForTests.registry.start({ agentId, runId, now: t0, fingerprint: baseline });

	// Worker activity happens
	handle.lastActivityAt = t0 + 30_000;
	handle.diagnostics.eventSeq += 1;
	(handle.diagnostics as any).finalizationPhase = "tool-active";

	// Tick fires and produces an event in flight (seq 1)
	const events = __watchRuntimeForTests.registry.tick({
		now: t0 + 60_000,
		observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 60_000),
	});
	assert.equal(events.length, 1);
	const event = events[0];

	// Now simulate worker terminal removal while delivery is held in flight
	handle.finalizing = true;
	__watchRuntimeForTests.jobRegistry.set(agentId, {
		agentId,
		runId,
		name: "general-purpose",
		task: "execute code",
		state: "ok",
		startedAt: t0,
		endedAt: t0 + 65_000,
	});
	__watchRuntimeForTests.runningAgents.delete(agentId);
	__watchRuntimeForTests.registry.stop({ agentId, runId });

	// Verification: isWatchDeliveryValid must be false
	const valid = __watchRuntimeForTests.isWatchDeliveryValid(
		event.agentId,
		event.runId,
		event.sequence,
		__watchRuntimeForTests.generation,
	);
	assert.equal(valid, false, "validation must fail after terminal removal");
	assert.equal(__watchRuntimeForTests.isWatchDeliveryValidForAgent(event.agentId, event.runId), false);

	// deliverWatchSample must not wake Boss
	let wakeSent = false;
	const mockPi = {
		sendUserMessage: () => { wakeSent = true; },
	} as any;

	await __watchRuntimeForTests.deliverWatchSample(mockPi, event);
	assert.equal(wakeSent, false, "held delivery must not wake Boss after terminal removal");

	// ack in deliverWatchSample finally must not resurrect the removed subscription
	assert.equal(__watchRuntimeForTests.registry.list({ agentId, runId }).length, 0);

	// Clean up
	__watchRuntimeForTests.jobRegistry.delete(agentId);
});

test("a held watch delivery cannot route after session shutdown or generation change", async () => {
	const agentId = "worker-shutdown-test";
	const runId = "run-shut-300";
	const t0 = 1_000_000;

	const handle = {
		runId,
		controller: new AbortController(),
		name: "general-purpose",
		task: "execute code",
		lastActivityAt: t0,
		lastStallNotifyAt: 0,
		stallNotifyCount: 0,
		startedAt: t0,
		finalizing: false,
		diagnostics: {
			processGeneration: "1:1000",
			supervisorPid: process.pid,
			eventSeq: 0,
			stdoutBytes: 0,
			stderrBytes: 0,
		},
	};
	__watchRuntimeForTests.runningAgents.set(agentId, handle as any);

	const baseline = watchObservationFor(agentId, runId, t0)!;
	__watchRuntimeForTests.registry.start({ agentId, runId, now: t0, fingerprint: baseline });

	handle.lastActivityAt = t0 + 30_000;
	handle.diagnostics.eventSeq += 1;
	(handle.diagnostics as any).finalizationPhase = "tool-active";

	const events = __watchRuntimeForTests.registry.tick({
		now: t0 + 60_000,
		observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 60_000),
	});
	assert.equal(events.length, 1);
	const event = events[0];
	const initialGen = __watchRuntimeForTests.generation;

	// Simulate session shutdown / lifecycle generation bump + clear
	__watchRuntimeForTests.generation += 1;
	__watchRuntimeForTests.registry.clear();

	// Verification: isWatchDeliveryValid must be false for initial generation
	assert.equal(
		__watchRuntimeForTests.isWatchDeliveryValid(event.agentId, event.runId, event.sequence, initialGen),
		false,
		"validation must fail for stale lifecycle generation",
	);

	let wakeSent = false;
	const mockPi = {
		sendUserMessage: () => { wakeSent = true; },
	} as any;

	await __watchRuntimeForTests.deliverWatchSample(mockPi, event, initialGen);
	assert.equal(wakeSent, false, "held delivery must not wake Boss after shutdown");

	// Clean up
	__watchRuntimeForTests.runningAgents.delete(agentId);
});

test("isWatchDeliveryValid gates every terminal, shutdown, and sequence boundary", () => {
	const agentId = "worker-gate-test";
	const runId = "run-gate-400";
	const t0 = 1_000_000;

	const handle = {
		runId,
		controller: new AbortController(),
		name: "general-purpose",
		task: "execute code",
		lastActivityAt: t0,
		lastStallNotifyAt: 0,
		stallNotifyCount: 0,
		startedAt: t0,
		finalizing: false,
		diagnostics: {
			processGeneration: "1:1000",
			supervisorPid: process.pid,
			eventSeq: 0,
			stdoutBytes: 0,
			stderrBytes: 0,
		},
	};
	__watchRuntimeForTests.runningAgents.set(agentId, handle as any);

	try {
		const baseline = watchObservationFor(agentId, runId, t0)!;
		__watchRuntimeForTests.registry.start({ agentId, runId, now: t0, fingerprint: baseline });

		// A semantic phase change emits event seq 1.
		handle.lastActivityAt = t0 + 10_000;
		handle.diagnostics.eventSeq += 1;
		(handle.diagnostics as any).finalizationPhase = "tool-active";
		const events = __watchRuntimeForTests.registry.tick({
			now: t0 + 60_000,
			observe: (target) => watchObservationFor(target.agentId, target.runId, t0 + 60_000),
		});
		assert.equal(events.length, 1);
		const gen = __watchRuntimeForTests.generation;

		// 1. Live + inFlight + matching sequence -> valid
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, runId, 1, gen), true);
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValidForAgent(agentId, runId), true);

		// 2. Generation mismatch -> invalid
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, runId, 1, gen + 1), false);

		// 3. Sequence mismatch -> invalid
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, runId, 2, gen), false);

		// 4. Stale runId -> invalid
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, "other-run", 1, gen), false);

		// 5. Finalizing handle -> invalid
		handle.finalizing = true;
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, runId, 1, gen), false);
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValidForAgent(agentId, runId), false);
		handle.finalizing = false;

		// 6. done-await-host phase -> invalid
		(handle.diagnostics as any).finalizationPhase = "done-await-host";
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, runId, 1, gen), false);
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValidForAgent(agentId, runId), false);
		(handle.diagnostics as any).finalizationPhase = undefined;

		// 7. Terminal job in jobRegistry -> invalid
		__watchRuntimeForTests.jobRegistry.set(agentId, {
			agentId,
			runId,
			name: "general-purpose",
			task: "task",
			state: "failed",
			startedAt: t0,
			endedAt: t0 + 20_000,
		});
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, runId, 1, gen), false);
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValidForAgent(agentId, runId), false);
		__watchRuntimeForTests.jobRegistry.delete(agentId);

		// 8. Stopped subscription in registry -> invalid
		__watchRuntimeForTests.registry.stop({ agentId, runId });
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValid(agentId, runId, 1, gen), false);
		assert.equal(__watchRuntimeForTests.isWatchDeliveryValidForAgent(agentId, runId), false);
	} finally {
		__watchRuntimeForTests.runningAgents.delete(agentId);
		__watchRuntimeForTests.jobRegistry.delete(agentId);
		__watchRuntimeForTests.registry.clear();
	}
});
