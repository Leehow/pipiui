import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

import {
	DEFAULT_READONLY_CHILD_EXIT_GRACE_MS,
	DEFAULT_REPORT_DRAIN_BUDGET_MS,
	DEFAULT_TERMINAL_REPORT_BUDGET_MS,
	DEFAULT_WRITABLE_CHILD_EXIT_GRACE_MS,
	MAX_WRITABLE_CHILD_EXIT_GRACE_MS,
	awaitBounded,
	closeoutPhaseError,
	consumeCloseoutLate,
	createChildExitCloseout,
	createCloseoutReportQueue,
	createTimeoutAbort,
	createWorktreePhaseProber,
	isSupersededCloseoutReport,
	readonlyChildExitGraceMs,
	runAbortableRetries,
	settleCloseoutWait,
	waitAbortable,
	worktreeProbeEvent,
	writableChildExitGraceMs,
	type CloseoutProbeFields,
} from "../closeout.ts";

const SHORT_MS = 25;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectUnhandled(): { seen: unknown[]; stop(): void } {
	const seen: unknown[] = [];
	const onUnhandled = (reason: unknown): void => {
		seen.push(reason);
	};
	process.on("unhandledRejection", onUnhandled);
	return {
		seen,
		stop() {
			process.off("unhandledRejection", onUnhandled);
		},
	};
}

// Short real-process bounds for the writable TERM→KILL behavior tests.
const GRACE_MS = 120;
const KILL_GRACE_MS = 160;

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function childPid(child: ChildProcess): Promise<number> {
	if (typeof child.pid === "number" && child.pid > 0) return child.pid;
	await new Promise<void>((resolve, reject) => {
		child.once("spawn", () => resolve());
		child.once("error", reject);
	});
	return child.pid!;
}

function waitChildClose(child: ChildProcess): Promise<void> {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", () => resolve());
	});
}

/** Wait for a fixed marker line on the child's stdout — proves the SIGTERM handler
 *  is installed before we signal it, so the signal-ignore assertion is deterministic. */
async function waitStdoutMarker(child: ChildProcess, marker: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let buffered = "";
		const onData = (chunk: Buffer): void => {
			buffered += chunk.toString();
			if (buffered.includes(marker)) {
				child.stdout?.off("data", onData);
				resolve();
			}
		};
		child.stdout?.on("data", onData);
		child.once("error", reject);
	});
}

test("production closeout bounds stay short and explicit", () => {
	assert.equal(DEFAULT_READONLY_CHILD_EXIT_GRACE_MS, 5_000);
	assert.equal(DEFAULT_TERMINAL_REPORT_BUDGET_MS, 8_000);
	assert.equal(DEFAULT_REPORT_DRAIN_BUDGET_MS, 3_000);
	assert.ok(DEFAULT_READONLY_CHILD_EXIT_GRACE_MS < DEFAULT_TERMINAL_REPORT_BUDGET_MS);
	assert.equal(readonlyChildExitGraceMs({}), 5_000);
	assert.equal(readonlyChildExitGraceMs({ PIPIUI_READONLY_CHILD_EXIT_GRACE_MS: "40" }), 40);
});

test("enter/ok/terminate/exit never invent lastPhaseError; timeout/error keep codes", () => {
	for (const state of ["enter", "ok", "terminate", "exit", "late-ok"] as const) {
		assert.equal(closeoutPhaseError("child-exit", state), undefined);
		assert.equal(closeoutPhaseError("end-report", state), undefined);
		assert.equal(closeoutPhaseError("report-drain", state), undefined);
		assert.equal(closeoutPhaseError("job-finalize", state), undefined);
	}
	assert.equal(closeoutPhaseError("child-exit", "timeout"), "child-exit-timeout");
	assert.equal(closeoutPhaseError("end-report", "error"), "end-report-error");
	assert.equal(closeoutPhaseError("verify", "timeout"), "verify-timeout");
});

test("read-only final then hung child is terminated after grace and keeps later exit", async () => {
	const probes: CloseoutProbeFields[] = [];
	let terminated = 0;
	const closeout = createChildExitCloseout({
		agent: "explore-1",
		run: "run-1",
		role: "read-only",
		pid: 4242,
		graceMs: SHORT_MS,
		terminate: () => {
			terminated += 1;
		},
		onProbe: (fields) => probes.push({ ...fields }),
	});
	const started = Date.now();
	closeout.arm();
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 1);
	assert.equal(closeout.forced(), true);
	closeout.settled("ok");
	assert.ok(Date.now() - started < 1_000);
	assert.deepEqual(probes.map((item) => item.state), ["enter", "timeout", "terminate", "exit"]);
	assert.ok(probes.every((item) => item.elapsedMs !== undefined));
	assert.ok(probes.every((item) => !("prompt" in item) && !("stdout" in item) && item.agent === "explore-1"));
	assert.equal(closeoutPhaseError("child-exit", "enter"), undefined);
});

test("writable child-exit wait probes without killing", async () => {
	const probes: CloseoutProbeFields[] = [];
	let terminated = 0;
	const closeout = createChildExitCloseout({
		role: "writable",
		pid: 7,
		terminate: () => {
			terminated += 1;
		},
		onProbe: (fields) => probes.push({ ...fields }),
	});
	closeout.arm();
	await delay(SHORT_MS);
	closeout.settled("ok");
	assert.equal(terminated, 0);
	assert.equal(closeout.forced(), false);
	assert.deepEqual(probes.map((item) => item.state), ["enter", "ok"]);
});

test("writable post-final grace default is 15s, env-overridable, never unbounded", () => {
	assert.equal(DEFAULT_WRITABLE_CHILD_EXIT_GRACE_MS, 15_000);
	assert.equal(MAX_WRITABLE_CHILD_EXIT_GRACE_MS, 60_000);
	assert.equal(writableChildExitGraceMs({}), 15_000);
	assert.equal(writableChildExitGraceMs({ PIPIUI_WRITABLE_CHILD_EXIT_GRACE_MS: "40" }), 40);
	// Invalid/negative/NaN fall back to the default — they must never disable the bound.
	assert.equal(writableChildExitGraceMs({ PIPIUI_WRITABLE_CHILD_EXIT_GRACE_MS: "" }), 15_000);
	assert.equal(writableChildExitGraceMs({ PIPIUI_WRITABLE_CHILD_EXIT_GRACE_MS: "abc" }), 15_000);
	assert.equal(writableChildExitGraceMs({ PIPIUI_WRITABLE_CHILD_EXIT_GRACE_MS: "-5" }), 15_000);
	// An explicit huge override is clamped, not honoured: ordinary config can't unbind it.
	assert.equal(writableChildExitGraceMs({ PIPIUI_WRITABLE_CHILD_EXIT_GRACE_MS: "999999999" }), MAX_WRITABLE_CHILD_EXIT_GRACE_MS);
	// The default stays well below the terminal-report budget scale the closeout relies on.
	assert.ok(DEFAULT_WRITABLE_CHILD_EXIT_GRACE_MS > DEFAULT_READONLY_CHILD_EXIT_GRACE_MS);
});

test("writable post-final grace expires → terminate once, forced, exit on settle", async () => {
	const probes: CloseoutProbeFields[] = [];
	let terminated = 0;
	const closeout = createChildExitCloseout({
		agent: "write-1",
		run: "run-1",
		role: "writable",
		pid: 777,
		graceMs: SHORT_MS,
		terminate: () => {
			terminated += 1;
		},
		onProbe: (fields) => probes.push({ ...fields }),
	});
	const started = Date.now();
	closeout.arm();
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 1, "grace expiry must SIGTERM exactly once");
	assert.equal(closeout.forced(), true);
	closeout.settled("ok");
	assert.ok(Date.now() - started < 1_000);
	assert.deepEqual(probes.map((item) => item.state), ["enter", "timeout", "terminate", "exit"]);
	assert.ok(probes.every((item) => item.elapsedMs !== undefined));
	assert.equal(closeoutPhaseError("child-exit", "enter"), undefined);
});

test("writable settles inside grace → no terminate, not forced", async () => {
	const probes: CloseoutProbeFields[] = [];
	let terminated = 0;
	const closeout = createChildExitCloseout({
		role: "writable",
		pid: 888,
		graceMs: SHORT_MS,
		terminate: () => {
			terminated += 1;
		},
		onProbe: (fields) => probes.push({ ...fields }),
	});
	closeout.arm();
	closeout.settled("ok");
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 0, "close within the grace must not SIGTERM");
	assert.equal(closeout.forced(), false);
	assert.deepEqual(probes.map((item) => item.state), ["enter", "ok"]);
});

test("writable abort/cancel inside grace clears the terminate timer (no double kill)", async () => {
	let terminated = 0;
	const closeout = createChildExitCloseout({
		role: "writable",
		pid: 999,
		graceMs: SHORT_MS,
		terminate: () => {
			terminated += 1;
		},
		onProbe: () => {},
	});
	closeout.arm();
	closeout.cancel();
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 0, "a pre-grace abort must cancel the pending terminate");
	assert.equal(closeout.forced(), false);
});

test("writable TERM→KILL is bounded and leaves no process residue", { timeout: 15_000 }, async (t) => {
	// A single-process child that logs READY once its SIGTERM handler is installed, then
	// keeps running (ignores SIGTERM). Only the direct worker PID is targeted; it must be
	// force-killed within grace + killGrace and nothing of it may survive.
	const stubborn = spawn(process.execPath, [
		"-e", "process.on('SIGTERM', () => {}); console.log('READY'); setInterval(() => {}, 1000)",
	], { stdio: ["ignore", "pipe", "ignore"] });
	await waitStdoutMarker(stubborn, "READY");
	const pid = await childPid(stubborn);
	t.after(() => {
		try { stubborn.kill("SIGKILL"); } catch { /* best-effort cleanup */ }
	});
	let termSent = false;
	let killSent = false;
	let exited = false;
	let forceTimer: ReturnType<typeof setTimeout> | undefined;
	const terminate = () => {
		termSent = true;
		forceTimer = setTimeout(() => {
			killSent = true;
			if (!exited) { try { stubborn.kill("SIGKILL"); } catch { /* ESRCH = gone */ } }
		}, KILL_GRACE_MS);
		forceTimer.unref?.();
		return stubborn.kill("SIGTERM");
	};
	stubborn.once("close", () => { exited = true; if (forceTimer !== undefined) clearTimeout(forceTimer); });
	const closeout = createChildExitCloseout({
		role: "writable",
		pid,
		graceMs: GRACE_MS,
		terminate,
		onProbe: () => {},
	});
	const started = Date.now();
	closeout.arm();
	await waitChildClose(stubborn);
	assert.ok(Date.now() - started < GRACE_MS + KILL_GRACE_MS + 1_000, "stubborn child must be reaped within grace + killGrace + slack");
	assert.equal(termSent, true, "grace expiry must send SIGTERM");
	assert.equal(killSent, true, "a SIGTERM-ignoring child must be SIGKILLed");
	assert.equal(alive(pid), false, "no residue: the direct worker pid must be gone");
	closeout.settled("ok");
});

test("writable TERM then exit does not SIGKILL a cooperative child", { timeout: 15_000 }, async (t) => {
	// Single-process child with no SIGTERM handler: default node behavior exits on SIGTERM,
	// so the later KILL grace must NOT fire.
	const cooperative = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		stdio: "ignore",
	});
	const pid = await childPid(cooperative);
	await delay(50);
	t.after(() => {
		try { cooperative.kill("SIGKILL"); } catch { /* best-effort cleanup */ }
	});
	let termSent = false;
	let killSent = false;
	let forceTimer: ReturnType<typeof setTimeout> | undefined;
	let exited = false;
	const terminate = () => {
		termSent = true;
		forceTimer = setTimeout(() => {
			killSent = true;
			if (!exited) { try { cooperative.kill("SIGKILL"); } catch { /* ESRCH = gone */ } }
		}, KILL_GRACE_MS);
		forceTimer.unref?.();
		return cooperative.kill("SIGTERM");
	};
	cooperative.once("close", () => { exited = true; if (forceTimer !== undefined) clearTimeout(forceTimer); });
	const closeout = createChildExitCloseout({
		role: "writable",
		pid,
		graceMs: GRACE_MS,
		terminate,
		onProbe: () => {},
	});
	closeout.arm();
	await waitChildClose(cooperative);
	// The child answers SIGTERM with a prompt exit; the KILL grace must NOT fire.
	await delay(KILL_GRACE_MS + 20);
	assert.equal(termSent, true, "grace expiry must send SIGTERM");
	assert.equal(killSent, false, "a child that dies on SIGTERM must not be SIGKILLed");
	assert.equal(alive(pid), false);
	closeout.settled("ok");
});

test("timer cleanup and nextAttempt do not kill a later child", async () => {
	const probes: string[] = [];
	let terminated = 0;
	const closeout = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => {
			terminated += 1;
		},
		onProbe: (fields) => probes.push(fields.state),
	});
	closeout.arm();
	closeout.nextAttempt();
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 0);
	closeout.arm();
	closeout.cancel();
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 0);
	closeout.arm();
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 1);
	assert.ok(!probes.slice(0, -2).includes("terminate"));
});

test("abort cancel clears the grace timer", async () => {
	let terminated = 0;
	const closeout = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => {
			terminated += 1;
		},
		onProbe: () => {},
	});
	closeout.arm();
	closeout.cancel();
	await delay(SHORT_MS + 20);
	assert.equal(terminated, 0);
	assert.equal(closeout.forced(), false);
});

test("unresolved report/drain wait returns on budget and keeps late probes", async () => {
	const unhandled = collectUnhandled();
	try {
		let rejectLate: ((error: Error) => void) | undefined;
		const pending = new Promise<void>((_, reject) => {
			rejectLate = reject;
		});
		const probes: Array<{ state: string; elapsedMs: number }> = [];
		const started = Date.now();
		const outcome = await settleCloseoutWait(pending, SHORT_MS, (state, elapsedMs) => {
			probes.push({ state, elapsedMs });
		});
		assert.equal(outcome.status, "timeout");
		assert.ok(Date.now() - started < 1_000);
		assert.deepEqual(probes.map((item) => item.state), ["enter", "timeout"]);
		assert.ok(probes.every((item) => Number.isFinite(item.elapsedMs)));
		rejectLate?.(new Error("late-bridge"));
		await delay(15);
		assert.deepEqual(probes.map((item) => item.state), ["enter", "timeout", "late-error"]);
		assert.deepEqual(unhandled.seen, []);
	} finally {
		unhandled.stop();
	}
});

test("normal report path probes enter then ok with elapsed", async () => {
	const probes: Array<{ state: string; elapsedMs: number }> = [];
	const outcome = await settleCloseoutWait(Promise.resolve("end-ok"), 1_000, (state, elapsedMs) => {
		probes.push({ state, elapsedMs });
	});
	assert.deepEqual(outcome, { status: "settled", value: "end-ok" });
	assert.deepEqual(probes.map((item) => item.state), ["enter", "ok"]);
	assert.ok(probes[1]!.elapsedMs >= 0);
});

test("rejected closeout wait probes enter then error without lastPhaseError on enter", async () => {
	const probes: string[] = [];
	const outcome = await settleCloseoutWait(Promise.reject(new Error("bridge")), 1_000, (state) => {
		probes.push(state);
	});
	assert.equal(outcome.status, "rejected");
	assert.deepEqual(probes, ["enter", "error"]);
	assert.equal(closeoutPhaseError("end-report", "enter"), undefined);
	assert.equal(closeoutPhaseError("end-report", "error"), "end-report-error");
});

test("awaitBounded timeout consumes a later fulfillment", async () => {
	const unhandled = collectUnhandled();
	try {
		let resolveLate: ((value: string) => void) | undefined;
		const pending = new Promise<string>((resolve) => {
			resolveLate = resolve;
		});
		const late: string[] = [];
		const outcome = await awaitBounded(pending, SHORT_MS, {
			onLate: (event) => late.push(event.status),
		});
		assert.equal(outcome.status, "timeout");
		resolveLate?.("too-late");
		await delay(15);
		assert.deepEqual(late, ["fulfilled"]);
		assert.deepEqual(unhandled.seen, []);
	} finally {
		unhandled.stop();
	}
});

test("worktree phase probes enter/ok/timeout in order and carry elapsed", async () => {
	const probes: Array<{ event: string; state: string; elapsedMs?: number }> = [];
	const prober = createWorktreePhaseProber((event, fields) => {
		probes.push({ event, state: fields.state, elapsedMs: fields.elapsedMs });
	});
	prober.note("queue-wait");
	await delay(5);
	prober.note("reconciling");
	prober.note("merging");
	prober.note("merging", { timedOut: true, waitedMs: 40 });
	assert.equal(worktreeProbeEvent("queue-wait"), "worktree-queue");
	assert.deepEqual(probes.map((item) => `${item.event}:${item.state}`), [
		"worktree-queue:enter",
		"worktree-queue:ok",
		"worktree-reconcile:enter",
		"worktree-reconcile:ok",
		"worktree-merge:enter",
		"worktree-merge:timeout",
	]);
	assert.equal(probes.at(-1)?.elapsedMs, 40);
	assert.ok(probes.every((item) => item.elapsedMs !== undefined));
});

test("consumeCloseoutLate swallows a later rejection", async () => {
	const unhandled = collectUnhandled();
	try {
		let rejectLate: ((error: Error) => void) | undefined;
		const pending = new Promise<void>((_, reject) => {
			rejectLate = reject;
		});
		consumeCloseoutLate(pending);
		rejectLate?.(new Error("after-return"));
		await delay(15);
		assert.deepEqual(unhandled.seen, []);
	} finally {
		unhandled.stop();
	}
});

test("forced close is accepted only after a terminal final armed the wait", async () => {
	const armed = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => {},
		onProbe: () => {},
	});
	armed.arm();
	await delay(SHORT_MS + 20);
	armed.settled("ok");
	assert.equal(armed.forced(), true);
	assert.equal(armed.accepted(), true);

	const neverArmed = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => {},
		onProbe: () => {},
	});
	neverArmed.settled("ok");
	assert.equal(neverArmed.forced(), false);
	assert.equal(neverArmed.accepted(), false);

	const aborted = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => {},
		onProbe: () => {},
	});
	aborted.arm();
	aborted.cancel();
	aborted.settled("ok");
	assert.equal(aborted.accepted(), false);
});

test("forced close is not accepted on terminate throw, false, or error settle", async () => {
	const threw = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => {
			throw new Error("kill-failed");
		},
		onProbe: () => {},
	});
	threw.arm();
	await delay(SHORT_MS + 20);
	threw.settled("ok");
	assert.equal(threw.forced(), true);
	assert.equal(threw.accepted(), false);

	const refused = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => false,
		onProbe: () => {},
	});
	refused.arm();
	await delay(SHORT_MS + 20);
	refused.settled("ok");
	assert.equal(refused.accepted(), false);

	const errored = createChildExitCloseout({
		graceMs: SHORT_MS,
		terminate: () => true,
		onProbe: () => {},
	});
	errored.arm();
	await delay(SHORT_MS + 20);
	errored.settled("error");
	assert.equal(errored.forced(), true);
	assert.equal(errored.accepted(), false);
});

test("close then error does not double-probe or keep the grace timer", async () => {
	const probes: string[] = [];
	let terminated = 0;
	const closeout = createChildExitCloseout({
		graceMs: 1_000,
		terminate: () => {
			terminated += 1;
		},
		onProbe: (fields) => probes.push(fields.state),
	});
	closeout.arm();
	closeout.settled("ok");
	closeout.settled("error");
	await delay(30);
	assert.equal(terminated, 0);
	assert.deepEqual(probes, ["enter", "ok"]);
});

test("abortable retry stops on abandon and does not late-send", async () => {
	const controller = new AbortController();
	let attempts = 0;
	const resultP = runAbortableRetries(
		async () => {
			attempts += 1;
			return false;
		},
		controller.signal,
		[40, 40],
	);
	await delay(15);
	controller.abort();
	assert.equal(await resultP, "aborted");
	const after = attempts;
	await delay(80);
	assert.equal(attempts, after);
	assert.ok(attempts < 3);
});

test("superseded report is the live newer run, not a missing handle", () => {
	assert.equal(isSupersededCloseoutReport({ agentId: "explore-1", runId: "old" }, "new"), true);
	assert.equal(isSupersededCloseoutReport({ agentId: "explore-1", runId: "new" }, "new"), false);
	assert.equal(isSupersededCloseoutReport({ agentId: "explore-1", runId: "old" }, undefined), false);
});

test("ordered report queue keeps delivery and abandon blocks a late retry into the next run", async () => {
	const queue = createCloseoutReportQueue<{ agentId: string; runId: string; kind: string }>();
	const sent: string[] = [];
	let releaseFirst: (() => void) | undefined;
	const firstHold = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});

	queue.beginRun("explore-1", "run-old");
	const first = queue.enqueue({ agentId: "explore-1", runId: "run-old", kind: "end" }, async (payload, signal) => {
		await firstHold;
		if (signal.aborted) return;
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	const drain = settleCloseoutWait(queue.drain("explore-1"), SHORT_MS, () => {});
	const outcome = await drain;
	assert.equal(outcome.status, "timeout");
	assert.equal(queue.has("explore-1"), true);
	queue.abandon("explore-1", "run-old");
	assert.equal(queue.has("explore-1"), false);
	assert.equal(queue.sealedRun("explore-1"), "run-old");
	await queue.enqueue({ agentId: "explore-1", runId: "run-old", kind: "end" }, async (payload) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	queue.beginRun("explore-1", "run-new");
	await queue.enqueue({ agentId: "explore-1", runId: "run-new", kind: "start" }, async (payload) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	await queue.enqueue({ agentId: "explore-1", runId: "run-new", kind: "end" }, async (payload) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	assert.deepEqual(sent, ["run-new:start", "run-new:end"]);
	releaseFirst?.();
	await first.catch(() => {});
	await delay(15);
	assert.deepEqual(sent, ["run-new:start", "run-new:end"]);
	assert.equal(queue.isSealedRun("explore-1", "run-old"), false);
	assert.equal(queue.ignores("explore-1", "run-old"), true);
	await queue.enqueue({ agentId: "explore-1", runId: "run-old", kind: "late" }, async (payload) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	assert.deepEqual(sent, ["run-new:start", "run-new:end"]);
});

test("seal after timeout drops same-run enqueue but keeps later run ordered", async () => {
	const queue = createCloseoutReportQueue<{ agentId: string; runId: string; kind: string }>();
	const sent: string[] = [];
	let release: (() => void) | undefined;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	queue.beginRun("explore-2", "run-old");
	const late = queue.enqueue({ agentId: "explore-2", runId: "run-old", kind: "end" }, async (payload, signal) => {
		await hold;
		if (signal.aborted) return;
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	queue.seal("explore-2", "run-old");
	queue.abandon("explore-2", "run-old");
	await queue.enqueue({ agentId: "explore-2", runId: "run-old", kind: "retry" }, async (payload) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	queue.beginRun("explore-2", "run-new");
	await queue.enqueue({ agentId: "explore-2", runId: "run-new", kind: "start" }, async (payload) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	release?.();
	await late.catch(() => {});
	assert.deepEqual(sent, ["run-new:start"]);
});

test("report queue serializes a normal end after earlier updates", async () => {
	const queue = createCloseoutReportQueue<{ agentId: string; kind: string }>();
	const sent: string[] = [];
	let releaseUpdate: (() => void) | undefined;
	const hold = new Promise<void>((resolve) => {
		releaseUpdate = resolve;
	});
	const update = queue.enqueue({ agentId: "gp-1", kind: "update" }, async (payload) => {
		await hold;
		sent.push(payload.kind);
	});
	const end = queue.enqueue({ agentId: "gp-1", kind: "end" }, async (payload) => {
		sent.push(payload.kind);
	});
	assert.deepEqual(sent, []);
	releaseUpdate?.();
	await Promise.all([update, end]);
	assert.deepEqual(sent, ["update", "end"]);
});

test("waitAbortable returns immediately when already aborted", async () => {
	const controller = new AbortController();
	controller.abort();
	const started = Date.now();
	await waitAbortable(1_000, controller.signal);
	assert.ok(Date.now() - started < 50);
});

test("rejected queue post is not an unhandled rejection", async () => {
	const unhandled = collectUnhandled();
	try {
		const queue = createCloseoutReportQueue<{ agentId: string; runId: string }>();
		queue.beginRun("explore-3", "run-1");
		void queue.enqueue({ agentId: "explore-3", runId: "run-1" }, async () => {
			throw new Error("post-fail");
		});
		await delay(20);
		assert.deepEqual(unhandled.seen, []);
		assert.equal(queue.has("explore-3"), false);
	} finally {
		unhandled.stop();
	}
});

test("current-run epoch rejects the oldest late send after 20 beginRuns and keeps new-run order", async () => {
	const queue = createCloseoutReportQueue<{ agentId: string; runId: string; kind: string }>();
	const sent: string[] = [];
	const post = async (payload: { runId: string; kind: string }) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	};
	for (let index = 0; index < 20; index++) {
		queue.beginRun("explore-4", `run-${index}`);
		await queue.enqueue({ agentId: "explore-4", runId: `run-${index}`, kind: "start" }, post);
	}
	assert.equal(queue.currentRun("explore-4"), "run-19");
	await queue.enqueue({ agentId: "explore-4", runId: "run-0", kind: "late" }, post);
	assert.ok(!sent.includes("run-0:late"));
	queue.beginRun("explore-4", "run-20");
	await queue.enqueue({ agentId: "explore-4", runId: "run-20", kind: "start" }, post);
	await queue.enqueue({ agentId: "explore-4", runId: "run-20", kind: "end" }, post);
	assert.deepEqual(sent.slice(-2), ["run-20:start", "run-20:end"]);
	queue.seal("explore-4", "run-20");
	await queue.enqueue({ agentId: "explore-4", runId: "run-20", kind: "late" }, post);
	assert.ok(!sent.includes("run-20:late"));
	assert.equal(queue.isSealedRun("explore-4", "run-20"), true);
});

test("success end seals the current run so same-run late enqueue is dropped", async () => {
	const queue = createCloseoutReportQueue<{ agentId: string; runId: string; kind: string }>();
	const sent: string[] = [];
	queue.beginRun("explore-5", "run-ok");
	await queue.enqueue({ agentId: "explore-5", runId: "run-ok", kind: "end" }, async (payload) => {
		sent.push(payload.kind);
	});
	queue.seal("explore-5", "run-ok");
	await queue.enqueue({ agentId: "explore-5", runId: "run-ok", kind: "late" }, async (payload) => {
		sent.push(payload.kind);
	});
	assert.deepEqual(sent, ["end"]);
	assert.equal(queue.sealedRun("explore-5"), "run-ok");
});

test("same-run beginRun is idempotent: keeps terminal seal and does not rebuild the queue", async () => {
	const queue = createCloseoutReportQueue<{ agentId: string; runId: string; kind: string }>();
	const sent: string[] = [];
	let release: (() => void) | undefined;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	queue.beginRun("explore-6", "run-same");
	const inflight = queue.enqueue(
		{ agentId: "explore-6", runId: "run-same", kind: "end" },
		async (payload, signal) => {
			await hold;
			if (signal.aborted) return;
			sent.push(`${payload.runId}:${payload.kind}`);
		},
	);
	assert.equal(queue.has("explore-6"), true);
	queue.beginRun("explore-6", "run-same");
	assert.equal(queue.has("explore-6"), true);
	release?.();
	await inflight;
	assert.deepEqual(sent, ["run-same:end"]);
	queue.seal("explore-6", "run-same");
	queue.beginRun("explore-6", "run-same");
	assert.equal(queue.ignores("explore-6", "run-same"), true);
	assert.equal(queue.isSealedRun("explore-6", "run-same"), true);
	assert.equal(queue.sealedRun("explore-6"), "run-same");
	let posts = 0;
	await queue.enqueue({ agentId: "explore-6", runId: "run-same", kind: "late" }, async () => {
		posts += 1;
	});
	assert.equal(posts, 0);
	queue.beginRun("explore-6", "run-next");
	assert.equal(queue.currentRun("explore-6"), "run-next");
	assert.equal(queue.ignores("explore-6", "run-same"), true);
	assert.equal(queue.ignores("explore-6", "run-next"), false);
	await queue.enqueue({ agentId: "explore-6", runId: "run-next", kind: "start" }, async (payload) => {
		sent.push(`${payload.runId}:${payload.kind}`);
	});
	assert.deepEqual(sent, ["run-same:end", "run-next:start"]);
});

test("timeout abort is a real signal fetch can observe and dispose clears the timer", async () => {
	const parent = new AbortController();
	const live = createTimeoutAbort(1_000, parent.signal);
	try {
		assert.equal(live.signal.aborted, false);
		parent.abort();
		assert.equal(live.signal.aborted, true);
	} finally {
		live.dispose();
	}
	const disposed = createTimeoutAbort(SHORT_MS);
	disposed.dispose();
	await delay(SHORT_MS + 20);
	assert.equal(disposed.signal.aborted, false);
});

test("retry attempt sees the same abort signal used by fetch", async () => {
	const controller = new AbortController();
	const seen: boolean[] = [];
	const resultP = runAbortableRetries(
		async (signal) => {
			seen.push(signal.aborted);
			const timeout = createTimeoutAbort(40, signal);
			try {
				if (timeout.signal.aborted) return false;
				await waitAbortable(40, timeout.signal);
				return !timeout.signal.aborted;
			} finally {
				timeout.dispose();
			}
		},
		controller.signal,
		[40],
	);
	await delay(10);
	controller.abort();
	assert.equal(await resultP, "aborted");
	assert.equal(seen[0], false);
});

test("index wires closeout helpers onto the live finalization path", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const closeout = readFileSync(new URL("../closeout.ts", import.meta.url), "utf8");
	assert.match(source, /from "\.\/closeout\.ts"/);
	assert.match(source, /childExitCloseout\.arm\(\)/);
	assert.match(source, /childExitCloseout\.accepted\(\)/);
	assert.match(source, /if \(!useNestedRpc\) \{[\s\S]*?childExitCloseout\.arm\(\)/);
	assert.match(source, /residentRpcShutdownWaker\?\.consume\(event\)[\s\S]{0,500}childExitCloseout\.arm\(\)/);
	assert.match(source, /residentRpcShutdownWaker\?\.consume\(event\)[\s\S]{0,500}childExitProbe\.markFinal\(\)/);
	assert.match(source, /settleCloseoutWait\(flight, DEFAULT_TERMINAL_REPORT_BUDGET_MS/);
	assert.match(source, /createCloseoutReportQueue/);
	assert.match(source, /abandonPipiuiReports\(/);
	assert.match(source, /logCloseoutProbe\("lease-release"/);
	assert.match(source, /createTimeoutAbort\(PIPIUI_REPORT_TIMEOUT_MS, signal\)/);
	assert.match(source, /signal: timeout\.signal/);
	assert.match(source, /clearChildExitTimers\(\)/);
	assert.match(source, /pipiuiReportQueue\.beginRun\(/);
	assert.match(source, /return proc\.kill\("SIGTERM"\)/);
	assert.match(source, /else pipiuiReportQueue\.seal\(/);
	assert.doesNotMatch(source, /error: "job-finalize-error"[\s\S]{0,400}throw error/);
	assert.match(closeout, /void flight\.then\(cleanup, cleanup\)/);
	assert.doesNotMatch(closeout, /flight\.finally/);
	assert.doesNotMatch(closeout, /MAX_SEALED_RUNS/);
});
