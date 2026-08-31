import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import {
	buildCloseoutTimelineRecord,
	captureCloseoutTimelineSink,
	closeoutTimelineAgentKey,
	closeoutTimelineRunKey,
	setCloseoutTimelineSinkForTests,
	type CloseoutTimelineRecord,
} from "../closeout-timeline.ts";
import {
	CHILD_EXIT_SAMPLE_TIERS_MS,
	createChildExitTimelineProbe,
	resolveRootAlive,
	runProcessTableSample,
	sampleDescendantsViaPs,
} from "../child-exit-probe.ts";

// Production deliberately unrefs every forensic-sample handle. Keep the test
// process alive while this file awaits those promises, then release exactly
// once after every case has settled.
const testFileHold = setInterval(() => {}, 1_000);
after(() => clearInterval(testFileHold));
import { createChildExitCloseout } from "../closeout.ts";
import { recordCloseoutTimeline } from "../closeout-timeline.ts";
import type { DescendantSample } from "../child-exit-probe.ts";

const HOLD_MS = 350;

function parseLines(lines: string[]): CloseoutTimelineRecord[] {
	return lines.map((line) => JSON.parse(line) as CloseoutTimelineRecord);
}

async function flushed(sink: ReturnType<typeof captureCloseoutTimelineSink>): Promise<CloseoutTimelineRecord[]> {
	await sink.flush();
	return parseLines(sink.lines);
}

function waitClose(proc: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	return new Promise((resolve, reject) => {
		proc.once("close", (code, signal) => resolve({ code, signal }));
		proc.once("error", reject);
	});
}

function spawnNode(script: string, extra: { stdio?: ("ignore" | "pipe" | "ipc")[] } = {}): ChildProcess {
	return spawn(process.execPath, ["-e", script], {
		stdio: extra.stdio ?? ["ignore", "pipe", "pipe"],
	});
}

async function withSink<T>(fn: (sink: ReturnType<typeof captureCloseoutTimelineSink>) => Promise<T>): Promise<T> {
	const sink = captureCloseoutTimelineSink();
	setCloseoutTimelineSinkForTests(sink);
	try {
		return await fn(sink);
	} finally {
		setCloseoutTimelineSinkForTests(undefined);
	}
}


test("production sample tiers stay 5s/30s/120s — diagnostics only, no new deadline", () => {
	assert.deepEqual([...CHILD_EXIT_SAMPLE_TIERS_MS], [5_000, 30_000, 120_000]);
});

test("root process delayed exit: large assistant→exit, small exit→close", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawnNode(`setTimeout(() => {}, ${HOLD_MS})`);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "quota-pill",
			run: "run-delayed-root",
			role: "writable",
			childPid: proc.pid,
			depth: 1,
			attempt: 1,
			cause: () => "none",
		});
		probe.markFinal();
		await waitClose(proc);
		const recs = await flushed(sink);
		const details = recs.map((r) => r.detail);
		assert.ok(details.includes("final"));
		assert.ok(details.includes("exit"));
		assert.ok(details.includes("stdout-close"));
		assert.ok(details.includes("stderr-close"));
		assert.ok(details.includes("close"));
		const close = recs.find((r) => r.detail === "close")!;
		assert.ok(close.assistantToExitMs! >= HOLD_MS - 80, `assistant→exit ${close.assistantToExitMs}`);
		assert.ok(close.exitToCloseMs! < 150, `exit→close ${close.exitToCloseMs} should be small when the root itself is slow`);
		assert.ok((close.elapsedMs ?? 0) >= (close.assistantToExitMs ?? 0));
		assert.equal(close.exitCode, 0);
		assert.equal(close.childPid, proc.pid);
		assert.equal(close.depth, 1);
		assert.equal(close.role, "writable");
		assert.equal(close.cause, "none");
		assert.equal(close.agent, closeoutTimelineAgentKey("quota-pill"));
		assert.equal(close.run, closeoutTimelineRunKey("run-delayed-root"));
		for (const line of sink.lines) {
			assert.ok(!line.includes("quota-pill"), "raw agent id must not land");
			assert.ok(!line.includes("run-delayed-root"), "raw run id must not land");
		}
	});
});

test("root exits but grandchild holds stdout: small assistant→exit, large exit→close", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const script = `
			const { spawn } = require("node:child_process");
			const g = spawn(process.execPath, ["-e", "setTimeout(()=>{}, ${HOLD_MS})"], {
				stdio: ["ignore", "inherit", "ignore"],
			});
			g.unref();
		`;
		const proc = spawnNode(script);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "stdout-hold",
			run: "run-stdout-hold",
			role: "writable",
			childPid: proc.pid,
			depth: 0,
		});
		probe.markFinal();
		const started = Date.now();
		await waitClose(proc);
		const wall = Date.now() - started;
		const recs = await flushed(sink);
		const close = recs.find((r) => r.detail === "close")!;
		const stdout = recs.find((r) => r.detail === "stdout-close")!;
		const stderr = recs.find((r) => r.detail === "stderr-close")!;
		assert.ok(close.assistantToExitMs! < 200, `root should exit quickly, got assistant→exit ${close.assistantToExitMs}`);
		assert.ok(close.exitToCloseMs! >= HOLD_MS - 120, `exit→close ${close.exitToCloseMs} should track the grandchild hold`);
		assert.ok((stdout.elapsedMs ?? 0) > (stderr.elapsedMs ?? 0), "stdout-close must land after stderr-close when only stdout is held");
		assert.ok(wall >= HOLD_MS - 80);
		assert.ok((close.exitToStdioCloseMs ?? 0) >= HOLD_MS - 120);
	});
});

test("stderr held separately: stderr-close after stdout-close", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const script = `
			const { spawn } = require("node:child_process");
			const g = spawn(process.execPath, ["-e", "setTimeout(()=>{}, ${HOLD_MS})"], {
				stdio: ["ignore", "ignore", "inherit"],
			});
			g.unref();
		`;
		const proc = spawnNode(script);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "stderr-hold",
			run: "run-stderr-hold",
			role: "writable",
			childPid: proc.pid,
		});
		probe.markFinal();
		await waitClose(proc);
		const recs = await flushed(sink);
		const stdout = recs.find((r) => r.detail === "stdout-close")!;
		const stderr = recs.find((r) => r.detail === "stderr-close")!;
		const close = recs.find((r) => r.detail === "close")!;
		assert.ok((stderr.elapsedMs ?? 0) > (stdout.elapsedMs ?? 0), "stderr-close must be the late stream");
		assert.ok(close.exitToCloseMs! >= HOLD_MS - 120);
		assert.ok(close.assistantToExitMs! < 200);
	});
});

test("signal exit records SIGTERM and no sensitive values", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawnNode(`setTimeout(() => {}, 30_000)`);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "<script>alert(1)</script>",
			run: "sk-ant-api99-not-a-real-key",
			role: "read-only",
			childPid: proc.pid,
			cause: () => "abort",
		});
		probe.markFinal();
		assert.ok(proc.kill("SIGTERM"));
		await waitClose(proc);
		const recs = await flushed(sink);
		const exit = recs.find((r) => r.detail === "exit")!;
		const close = recs.find((r) => r.detail === "close")!;
		assert.equal(exit.signal, "SIGTERM");
		assert.equal(close.signal, "SIGTERM");
		assert.equal(close.cause, "abort");
		assert.equal(close.exitCode, undefined);
		const joined = sink.lines.join("\n");
		assert.ok(!joined.includes("<script>"));
		assert.ok(!joined.includes("sk-ant-api99"));
		assert.ok(!joined.includes("alert(1)"));
		assert.equal(close.agent, closeoutTimelineAgentKey("<script>alert(1)</script>"));
	});
});

test("post-final-grace-expired cause is a closed enum that lands on the close record", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawnNode(`setTimeout(() => {}, 30_000)`);
		assert.ok(proc.pid && proc.pid > 0);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "write-final-grace",
			run: "run-final-grace",
			role: "writable",
			childPid: proc.pid,
			cause: () => "post-final-grace-expired",
		});
		probe.markFinal();
		assert.ok(proc.kill("SIGKILL"));
		await waitClose(proc);
		const recs = await flushed(sink);
		const close = recs.find((r) => r.detail === "close")!;
		// Closed-enum, not free text: exactly the writable post-final-grace value.
		assert.equal(close.cause, "post-final-grace-expired");
		assert.equal(close.role, "writable");
		assert.equal(close.childPid, proc.pid);
		const joined = sink.lines.join("\n");
		assert.ok(!joined.includes("write-final-grace"));
		assert.ok(!joined.includes("run-final-grace"));
	});
});

test("IPC disconnect milestone fires when an IPC channel exists", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawnNode(
			`setTimeout(() => { try { process.disconnect(); } catch {} process.exit(0); }, 40)`,
			{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
		);
		assert.equal(proc.connected, true);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "ipc-probe",
			run: "run-ipc",
			childPid: proc.pid,
		});
		probe.markFinal();
		await waitClose(proc);
		const recs = await flushed(sink);
		assert.ok(recs.some((r) => r.detail === "disconnect"));
	});
});

test("probe/OS query failure never blocks or fails completion", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		let sampled = false;
		const proc = spawnNode(`setTimeout(() => {}, 80)`);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "os-fail",
			run: "run-os-fail",
			childPid: proc.pid,
			sampleTiersMs: [20],
			sampleDescendants: async () => {
				sampled = true;
				throw new Error("ps exploded with /Users/secret and API_KEY=sk-live");
			},
			cause: () => {
				throw new Error("cause getter boom");
			},
		});
		probe.markFinal();
		const started = Date.now();
		await waitClose(proc);
		assert.ok(Date.now() - started < 2_000, "close must not wait on the failed OS query");
		// Give the rejected sample a tick to emit.
		await new Promise((r) => setTimeout(r, 40));
		const recs = await flushed(sink);
		assert.ok(recs.some((r) => r.detail === "close"), "close record still lands");
		assert.equal(recs.find((r) => r.detail === "close")!.exitCode, 0);
		const sample = recs.find((r) => r.status === "sample");
		assert.ok(sampled);
		assert.equal(sample?.sampleSrc, "error");
		assert.equal(sample?.cause, "unknown", "throwing cause getter degrades to unknown");
		const joined = sink.lines.join("\n");
		assert.ok(!joined.includes("sk-live"));
		assert.ok(!joined.includes("/Users/secret"));
		assert.ok(!joined.includes("ps exploded"));
	});
});

test("hanging OS sample never delays ChildProcess.close observation", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawnNode(`setTimeout(() => {}, 40)`);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "hang-sample",
			run: "run-hang",
			childPid: proc.pid,
			sampleTiersMs: [5],
			sampleDescendants: () => new Promise(() => { /* never settles */ }),
		});
		probe.markFinal();
		const started = Date.now();
		await waitClose(proc);
		assert.ok(Date.now() - started < 1_500, "close path independent of hanging forensics");
		const recs = await flushed(sink);
		assert.ok(recs.some((r) => r.detail === "close"));
		probe.dispose();
	});
});

test("null stdio / missing pid attach does not throw; close still records", { timeout: 10_000 }, async () => {
	await withSink(async (sink) => {
		const fake = new EventEmitter() as EventEmitter & { pid?: number; stdout: null; stderr: null; connected: false };
		fake.stdout = null;
		fake.stderr = null;
		fake.connected = false;
		assert.doesNotThrow(() => {
			const probe = createChildExitTimelineProbe({
				proc: fake,
				agent: "no-stdio",
				run: "run-no-stdio",
			});
			probe.markFinal();
			fake.emit("exit", 1, null);
			fake.emit("close", 1, null);
		});
		const recs = await flushed(sink);
		assert.ok(recs.some((r) => r.detail === "final"));
		assert.ok(recs.some((r) => r.detail === "exit"));
		assert.ok(recs.some((r) => r.detail === "close"));
		assert.equal(recs.find((r) => r.detail === "close")!.exitCode, 1);
	});
});

test("tier sample records descendant count, rootAlive, stdioOpen, cause — numeric columns only", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawnNode(`setTimeout(() => {}, 250)`);
		assert.ok(proc.pid);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "tier-sample",
			run: "run-tier",
			role: "writable",
			childPid: proc.pid,
			depth: 2,
			sampleTiersMs: [30],
			cause: () => "runtime-budget",
		});
		probe.markFinal();
		await waitClose(proc);
		await new Promise((r) => setTimeout(r, 50));
		const recs = await flushed(sink);
		const sample = recs.find((r) => r.status === "sample");
		assert.ok(sample, "tier crossing must emit a sample");
		assert.equal(sample!.detail, "sample");
		assert.equal(sample!.tierMs, 30);
		assert.equal(sample!.cause, "runtime-budget");
		assert.ok(sample!.rootAlive === "yes" || sample!.rootAlive === "no" || sample!.rootAlive === "unknown");
		assert.ok(["both", "stdout", "stderr", "none"].includes(sample!.stdioOpen ?? ""));
		assert.ok(sample!.sampleSrc === "ps" || sample!.sampleSrc === "error" || sample!.sampleSrc === "unsupported");
		if (sample!.sampleSrc === "ps") {
			assert.equal(typeof sample!.descendants, "number");
		}
		const joined = sink.lines.join("\n");
		assert.ok(!joined.includes("node -e"));
		assert.ok(!joined.includes("setTimeout"));
	});
});

test("sampleDescendantsViaPs is bounded, numeric-only, and never rejects", { timeout: 10_000 }, async () => {
	const live = await sampleDescendantsViaPs(process.pid, 1_500);
	assert.equal(live.rootAlive, "yes");
	assert.ok(live.sampleSrc === "ps" || live.sampleSrc === "error");
	if (live.sampleSrc === "ps") {
		assert.equal(typeof live.descendants, "number");
		assert.ok((live.descendants ?? 0) >= 0);
	}
	const dead = await sampleDescendantsViaPs(2_147_483_646, 800);
	assert.equal(dead.rootAlive, "no");
	const bad = await sampleDescendantsViaPs(undefined, 50);
	assert.equal(bad.sampleSrc, "unsupported");
	assert.doesNotThrow(() => resolveRootAlive(process.pid));
	assert.equal(resolveRootAlive(process.pid), "yes");
	assert.equal(resolveRootAlive(-1), "unknown");
});

test("builder still drops command-line shaped keys on a probe-shaped record", () => {
	const record = buildCloseoutTimelineRecord("child-exit", {
		status: "sample",
		detail: "sample",
		argv0: "/usr/bin/node",
		commandLine: "node -e secret",
		cwd: "/Users/haoli/secret-project",
	} as never);
	assert.ok(!("argv0" in record));
	assert.ok(!("commandLine" in record));
	assert.ok(!("cwd" in record));
});


test("table read caps terminate the source process early and mark error/cap", { timeout: 15_000 }, async () => {
	const started = Date.now();
	const sample = await runProcessTableSample(
		["sh", "-c", "yes '1 2 3 4'"], // infinite rows, far beyond any cap
		process.pid,
		10_000,
		{ maxBytes: 4 * 1024 * 1024, maxRows: 2_000 },
		false,
	);
	assert.equal(sample.sampleSrc, "error");
	assert.equal(sample.failReason, "cap");
	assert.equal(sample.descendants, undefined, "failed samples never fabricate a count");
	assert.ok(Date.now() - started < 2_000, "cap must terminate far before the 10s wall clock");
});

test("ps nonzero exit resolves error/exit, never a fake ps success", { timeout: 15_000 }, async () => {
	const sample = await runProcessTableSample(
		["sh", "-c", "printf '1 0 0 0\\n'; exit 3"],
		process.pid,
		1_500,
		{ maxBytes: 4 * 1024 * 1024, maxRows: 20_000 },
		false,
	);
	assert.equal(sample.sampleSrc, "error");
	assert.equal(sample.failReason, "exit");
	assert.equal(sample.descendants, undefined);
});

test("wall-clock cap kills a slow table and resolves error/timeout", { timeout: 15_000 }, async () => {
	const started = Date.now();
	const sample = await runProcessTableSample(
		["sh", "-c", "sleep 5"],
		process.pid,
		80,
		{ maxBytes: 4 * 1024 * 1024, maxRows: 20_000 },
		false,
	);
	assert.equal(sample.sampleSrc, "error");
	assert.equal(sample.failReason, "timeout");
	assert.ok(Date.now() - started < 1_500);
});

test("root row missing from a successful table: liveness no, descendants unknown", { timeout: 15_000 }, async () => {
	const sample = await runProcessTableSample(
		["sh", "-c", "printf '999999 0 5 0\\n'"], // table has no row for childPid 12345
		12345,
		1_500,
		{ maxBytes: 4 * 1024 * 1024, maxRows: 20_000 },
		false,
	);
	assert.equal(sample.sampleSrc, "ps");
	assert.equal(sample.rootAlive, "no");
	assert.equal(sample.descendants, undefined, "root-gone means unknown, never zero");
});

test("post-exit row without identity on file is unattributable: error/identity", { timeout: 15_000 }, async () => {
	const sample = await sampleDescendantsViaPs(process.pid, 1_500, { rootExited: true });
	assert.equal(sample.sampleSrc, "error");
	assert.equal(sample.failReason, "identity");
	assert.equal(sample.rootAlive, "unknown");
	assert.equal(sample.descendants, undefined);
	assert.equal(sample.pgid, undefined);
	assert.equal(sample.sess, undefined);
});

test("tier firing between exit and close starts no OS query and records no row fields", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const fake = new EventEmitter();
		let samplerCalls = 0;
		const probe = createChildExitTimelineProbe({
			proc: fake,
			agent: "post-exit-tier",
			run: "run-post-exit-tier",
			childPid: 424242,
			sampleTiersMs: [10],
			sampleDescendants: async () => {
				samplerCalls += 1;
				return { sampleSrc: "ps", rootAlive: "yes", descendants: 9, pgid: 555 };
			},
		});
		probe.markFinal();
		fake.emit("exit", 0, null); // exit BEFORE the tier deadline
		await new Promise((r) => setTimeout(r, 40)); // tier fires at 10ms, post-exit
		fake.emit("close", 0, null);
		await sink.flush();
		assert.equal(samplerCalls, 0, "no OS query may start after exit");
		const recs = parseLines(sink.lines);
		const sample = recs.find((r) => r.status === "sample");
		assert.ok(sample, "a minimal non-attribution marker is still recorded");
		assert.equal(sample!.sampleSrc, "unsupported");
		assert.equal(sample!.rootAlive, "no");
		assert.equal(sample!.descendants, undefined);
		assert.equal(sample!.pgid, undefined);
		assert.equal(sample!.sess, undefined);
	});
});

test("in-flight sample resolving after exit: ps results dropped entirely", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const fake = new EventEmitter();
		const seenOpts: Array<{ rootExited: boolean; expected?: unknown }> = [];
		let release!: () => void;
		const gate = new Promise<void>((r) => { release = r; });
		const probe = createChildExitTimelineProbe({
			proc: fake,
			agent: "exit-guard",
			run: "run-exit-guard",
			childPid: 424242,
			sampleTiersMs: [5],
			sampleDescendants: async (_pid, _cap, opts) => {
				seenOpts.push(opts);
				await gate;
				return { sampleSrc: "ps", rootAlive: "yes", descendants: 7, pgid: 111, sess: 222 };
			},
		});
		probe.markFinal();
		await new Promise((r) => setTimeout(r, 20)); // tier fired pre-exit
		fake.emit("exit", 0, null); // death observed while the sample is in flight
		release();
		await new Promise((r) => setTimeout(r, 20));
		fake.emit("close", 0, null);
		await sink.flush();
		assert.equal(seenOpts[0]?.rootExited, false, "tier fired before exit was observed");
		const recs = parseLines(sink.lines);
		// A post-exit ps result is dropped ENTIRELY: the row (even a matching one)
		// can never be attributed to the child again.
		assert.ok(!recs.some((r) => r.status === "sample"), "post-exit ps sample must not land");
		assert.equal(recs[recs.length - 1]!.detail, "close");
	});
});

test("in-flight ERROR sample resolving after exit lands without any attribution field", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const fake = new EventEmitter();
		let release!: () => void;
		const gate = new Promise<void>((r) => { release = r; });
		const probe = createChildExitTimelineProbe({
			proc: fake,
			agent: "exit-err",
			run: "run-exit-err",
			childPid: 424242,
			sampleTiersMs: [5],
			sampleDescendants: async () => {
				await gate;
				return { sampleSrc: "error", rootAlive: "unknown", failReason: "timeout" };
			},
		});
		probe.markFinal();
		await new Promise((r) => setTimeout(r, 20));
		fake.emit("exit", 0, null);
		release();
		await new Promise((r) => setTimeout(r, 20));
		fake.emit("close", 0, null);
		await sink.flush();
		const recs = parseLines(sink.lines);
		const sample = recs.find((r) => r.status === "sample");
		assert.ok(sample, "non-ps outcomes keep a field-less stale/error marker");
		assert.equal(sample!.sampleSrc, "error");
		assert.equal(sample!.error, "child-exit-sample-timeout");
		assert.equal(sample!.rootAlive, "no", "liveness comes from the observed exit, never the stale query");
		assert.equal(sample!.descendants, undefined);
		assert.equal(sample!.pgid, undefined);
		assert.equal(sample!.sess, undefined);
	});
});

test("close drops in-flight samples: no sample lands after the terminal", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const pending: Array<(s: DescendantSample) => void> = [];
		const proc = spawnNode(`setTimeout(() => {}, 50)`);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "inflight",
			run: "run-inflight",
			childPid: proc.pid,
			sampleTiersMs: [5],
			sampleDescendants: () => new Promise((resolve) => pending.push(resolve)),
		});
		probe.markFinal();
		await waitClose(proc);
		await sink.flush();
		assert.ok(!sink.lines.some((l) => l.includes('"status":"sample"')));
		for (const resolve of pending) resolve({ sampleSrc: "ps", rootAlive: "yes", descendants: 99 });
		await new Promise((r) => setTimeout(r, 30));
		await sink.flush();
		assert.ok(!sink.lines.some((l) => l.includes('"status":"sample"')), "late-resolved sample must be dropped");
		const recs = parseLines(sink.lines);
		assert.equal(recs[recs.length - 1]!.detail, "close", "close stays the last probe record");
	});
});

test("sample freezes elapsed/cause/stdio at tier fire, not at resolution", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		let phase = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => { release = r; });
		const proc = spawnNode(`setTimeout(() => {}, 300)`);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "freeze",
			run: "run-freeze",
			childPid: proc.pid,
			sampleTiersMs: [20],
			sampleDescendants: async () => {
				phase = 1; // by resolution time the cause getter says "abort"...
				await gate;
				return { sampleSrc: "ps", rootAlive: "yes", descendants: 1 };
			},
			cause: () => (phase === 0 ? "none" : "abort"),
		});
		probe.markFinal();
		await new Promise((r) => setTimeout(r, 60));
		release();
		await waitClose(proc);
		await new Promise((r) => setTimeout(r, 30));
		const recs = await flushed(sink);
		const sample = recs.find((r) => r.status === "sample");
		assert.ok(sample);
		assert.equal(sample!.cause, "none", "cause must be the tier-fire value, not the resolution value");
		assert.equal(sample!.stdioOpen, "both");
		assert.ok((sample!.elapsedMs ?? 1e9) < 120, "elapsed frozen at fire time, not at resolution");
	});
});

test("process error is its own milestone, never a close; real close still follows", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const fake = new EventEmitter();
		const probe = createChildExitTimelineProbe({
			proc: fake,
			agent: "err-sep",
			run: "run-err-sep",
			childPid: 424242,
			sampleTiersMs: [5],
			sampleDescendants: () => new Promise(() => {}), // in-flight at error time
		});
		probe.markFinal();
		fake.emit("error", new Error("spawn ENOENT"));
		await new Promise((r) => setTimeout(r, 30));
		let recs = await flushed(sink);
		assert.ok(recs.some((r) => r.detail === "error" && r.status === "mark"));
		assert.ok(!recs.some((r) => r.detail === "close"), "error must not masquerade as close");
		assert.ok(!recs.some((r) => r.status === "sample"), "sampling stops at the error");
		fake.emit("close", 0, null); // Node emits close after error (verified live)
		await sink.flush();
		recs = parseLines(sink.lines);
		const errIdx = recs.findIndex((r) => r.detail === "error");
		const closeIdx = recs.findIndex((r) => r.detail === "close");
		assert.ok(errIdx >= 0 && closeIdx > errIdx, "real close recorded after the error milestone");
		assert.equal(recs[recs.length - 1]!.detail, "close");
	});
});

test("malformed ps output is error/parse — never a fake root-missing success", { timeout: 15_000 }, async () => {
	for (const script of [
		"printf 'not numbers here\\n'", // three text columns
		"printf '1 2 3\\n'", // only three columns
		"printf 'a b c d\\n'", // four non-integer columns
		"printf '999999 0 5\\n'\\nprintf 'x\\n'", // one short row then garbage
	]) {
		const sample = await runProcessTableSample(
			["sh", "-c", script],
			12345,
			1_500,
			{ maxBytes: 4 * 1024 * 1024, maxRows: 20_000 },
			false,
		);
		assert.equal(sample.sampleSrc, "error", script);
		assert.equal(sample.failReason, "parse", script);
		assert.equal(sample.descendants, undefined, script);
	}
	// EMPTY output (exit 0, zero bytes) is the one legitimate no-row case: root
	// absent, liveness "no" — distinct from a format error.
	const empty = await runProcessTableSample(
		["sh", "-c", "printf ''"],
		12345,
		1_500,
		{ maxBytes: 4 * 1024 * 1024, maxRows: 20_000 },
		false,
	);
	assert.equal(empty.sampleSrc, "ps");
	assert.equal(empty.rootAlive, "no");
	assert.equal(empty.failReason, undefined);
});

test("identity: first sample establishes, mismatched later row is error/identity with no fields", { timeout: 15_000 }, async () => {
	const childPid = process.pid;
	const argv: readonly string[] = ["sh", "-c", `printf '${childPid} 0 111 222\\n'`];
	const caps = { maxBytes: 4 * 1024 * 1024, maxRows: 20_000 };
	// First alive sample establishes identity {pgid:111, sess:222} — plain success.
	const first = await runProcessTableSample(argv, childPid, 1_500, caps, false);
	assert.equal(first.sampleSrc, "ps");
	assert.equal(first.rootAlive, "yes");
	assert.equal(first.pgid, 111);
	assert.equal(first.sess, 222);
	// Matching identity → still a success.
	const match = await runProcessTableSample(argv, childPid, 1_500, caps, false, { pgid: 111, sess: 222 });
	assert.equal(match.sampleSrc, "ps");
	assert.equal(match.rootAlive, "yes");
	// A row with a DIFFERENT pgid is a reused pid: closed identity failure, and NONE
	// of the foreign process's fields leak into the record.
	const mismatch = await runProcessTableSample(argv, childPid, 1_500, caps, false, { pgid: 999 });
	assert.equal(mismatch.sampleSrc, "error");
	assert.equal(mismatch.failReason, "identity");
	assert.equal(mismatch.rootAlive, "unknown");
	assert.equal(mismatch.descendants, undefined);
	assert.equal(mismatch.pgid, undefined);
	assert.equal(mismatch.sess, undefined);
});

test("post-exit row even with MATCHING pgid/sess is unattributable: error/identity, no fields", { timeout: 15_000 }, async () => {
	// A reused PID inside the same process group shares pgid/sess — a matching row
	// proves nothing once the child exited. No row field may be recorded.
	const childPid = process.pid;
	const argv: readonly string[] = ["sh", "-c", `printf '${childPid} 0 111 222\\n9999 ${childPid} 0 0\\n'`];
	const sample = await runProcessTableSample(
		argv,
		childPid,
		1_500,
		{ maxBytes: 4 * 1024 * 1024, maxRows: 20_000 },
		true, // exit observed
		{ pgid: 111, sess: 222 }, // identity matches exactly — still unattributable
	);
	assert.equal(sample.sampleSrc, "error");
	assert.equal(sample.failReason, "identity");
	assert.equal(sample.rootAlive, "unknown");
	assert.equal(sample.descendants, undefined);
	assert.equal(sample.pgid, undefined);
	assert.equal(sample.sess, undefined);
});

test("whitespace-only table output is error/parse, only true 0 bytes is empty", { timeout: 15_000 }, async () => {
	const ws = await runProcessTableSample(
		["sh", "-c", "printf '  \\n\\n\\t  \\n'"],
		12345,
		1_500,
		{ maxBytes: 4 * 1024 * 1024, maxRows: 20_000 },
		false,
	);
	assert.equal(ws.sampleSrc, "error");
	assert.equal(ws.failReason, "parse");
	assert.equal(ws.descendants, undefined);
});

test("probe passes expected identity and records identity failures without foreign fields", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const { EventEmitter } = await import("node:events");
		const fake = new EventEmitter();
		const seenExpected: Array<unknown> = [];
		let call = 0;
		const probe = createChildExitTimelineProbe({
			proc: fake,
			agent: "identity",
			run: "run-identity",
			childPid: 424242,
			sampleTiersMs: [5, 40],
			sampleDescendants: async (_pid, _cap, opts) => {
				seenExpected.push(opts.expected);
				call += 1;
				if (call === 1) return { sampleSrc: "ps", rootAlive: "yes", descendants: 2, pgid: 111, sess: 222 };
				// Second sample: the OS now reports a row with a DIFFERENT identity.
				return { sampleSrc: "error", rootAlive: "unknown", failReason: "identity" };
			},
		});
		probe.markFinal();
		await new Promise((r) => setTimeout(r, 80));
		fake.emit("close", 0, null);
		await sink.flush();
		assert.deepEqual(seenExpected[0], undefined, "first sample has no identity to compare");
		assert.deepEqual(seenExpected[1], { pgid: 111, sess: 222 }, "second sample carries the established identity");
		const recs = parseLines(sink.lines);
		const samples = recs.filter((r) => r.status === "sample");
		assert.equal(samples.length, 2);
		assert.equal(samples[0]!.sampleSrc, "ps");
		assert.equal(samples[0]!.descendants, 2);
		assert.equal(samples[1]!.sampleSrc, "error");
		assert.equal(samples[1]!.error, "child-exit-sample-identity");
		assert.equal(samples[1]!.descendants, undefined);
		assert.equal(samples[1]!.pgid, undefined);
		assert.equal(samples[1]!.rootAlive, "unknown");
	});
});

test("production error path: immediate error terminal LAST; late close fully silenced", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawn("definitely-missing-binary-xyz-9x", [], { stdio: ["ignore", "pipe", "pipe"] });
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "err-order",
			run: "run-err-order",
		});
		const closeout = createChildExitCloseout({
			agent: "err-order",
			run: "run-err-order",
			role: "writable",
			terminate: () => true,
			onProbe: (fields) => {
				recordCloseoutTimeline("child-exit", {
					agent: fields.agent,
					run: fields.run,
					role: fields.role,
					phase: fields.phase,
					status: fields.state,
					elapsedMs: fields.elapsedMs,
				});
			},
		});
		closeout.arm();
		// Exactly the production error wiring: fine mark (probe listener, first) →
		// immediate first-layer terminal → probe sealed; late close drops silently.
		proc.once("error", () => {
			closeout.settled("error");
			probe.seal();
		});
		await new Promise((resolve) => proc.once("close", resolve));
		await new Promise((r) => setTimeout(r, 60)); // give any suppressed late event a chance
		const recs = await flushed(sink);
		const statuses = recs.map((r) => r.status);
		assert.equal(statuses[statuses.length - 1]!, "error", "first-layer error terminal is the LAST record");
		assert.equal(statuses.filter((st) => st === "error").length, 1, "exactly one terminal");
		assert.ok(!recs.some((r) => r.detail === "close"), "late close must be fully silenced after seal");
		assert.ok(!recs.some((r) => r.detail === "stdout-close" || r.detail === "stderr-close"), "no stdio marks after seal");
		const errMark = recs.find((r) => r.detail === "error")!;
		const terminal = recs[recs.length - 1]!;
		assert.ok(terminal.tMs - errMark.tMs < 500, `terminal immediate, not deferred (delta=${terminal.tMs - errMark.tMs}ms)`);
	});
});

test("real spawn failure records error then close, without fake durations", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawn("definitely-missing-binary-xyz-9x", [], { stdio: ["ignore", "pipe", "pipe"] });
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "enoent",
			run: "run-enoent",
			childPid: undefined,
		});
		await new Promise((resolve) => proc.once("close", resolve));
		const recs = await flushed(sink);
		assert.ok(recs.some((r) => r.detail === "error"));
		const close = recs.find((r) => r.detail === "close");
		assert.ok(close, "Node emits close after error (verified on this Node)");
		assert.equal(close!.assistantToExitMs, undefined, "no fabricated final→exit duration");
		assert.equal(close!.exitToCloseMs, undefined);
	});
});

test("terminal-last: probe close mark is the last mark, first-layer ok is the last record", { timeout: 15_000 }, async () => {
	await withSink(async (sink) => {
		const proc = spawnNode(`setTimeout(() => {}, 80)`);
		const probe = createChildExitTimelineProbe({
			proc,
			agent: "order",
			run: "run-order",
			role: "writable",
			childPid: proc.pid,
			depth: 1,
			attempt: 1,
		});
		// Registered AFTER the probe, exactly like production index.ts wiring.
		const closeout = createChildExitCloseout({
			agent: "order",
			run: "run-order",
			role: "writable",
			pid: proc.pid,
			terminate: () => true,
			onProbe: (fields) => {
				recordCloseoutTimeline("child-exit", {
					agent: fields.agent,
					run: fields.run,
					role: fields.role,
					phase: fields.phase,
					status: fields.state,
					elapsedMs: fields.elapsedMs,
				});
			},
		});
		proc.once("close", () => closeout.settled("ok"));
		probe.markFinal();
		closeout.arm();
		await waitClose(proc);
		const recs = await flushed(sink);
		const marks = recs.filter((r) => r.status === "mark");
		// stdio EOF may arrive before the `exit` event (same-tick delivery order is
		// not guaranteed); what IS pinned: final first, close last, all milestones present.
		assert.deepEqual(
			[...marks.map((r) => r.detail)].sort(),
			["close", "exit", "final", "stderr-close", "stdout-close"],
			"all milestones present",
		);
		assert.equal(marks[0]!.detail, "final");
		assert.equal(marks[marks.length - 1]!.detail, "close", "close is the last probe milestone");
		assert.equal(recs[recs.length - 1]!.status, "ok", "first-layer terminal is the LAST child-exit record");
		assert.equal(recs[recs.length - 2]!.detail, "close", "probe close mark directly precedes the terminal");
		const close = marks[marks.length - 1]!;
		assert.ok((close.exitToCloseMs ?? 1e9) < 150, "synchronous close capture, no microtask inflation");
	});
});
