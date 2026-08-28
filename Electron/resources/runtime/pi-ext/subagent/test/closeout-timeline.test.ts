import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	CLOSEOUT_TIMELINE_ERROR_CODES,
	CLOSEOUT_TIMELINE_EXIT_DRAIN_CAP_MS,
	CLOSEOUT_TIMELINE_FLUSH_BATCH,
	CLOSEOUT_TIMELINE_HELPER_WATCHDOG_MS,
	CLOSEOUT_TIMELINE_MAX_PENDING_LINES,
	buildCloseoutTimelineRecord,
	captureCloseoutTimelineSink,
	closeoutTimelineAgentKey,
	closeoutTimelineRunKey,
	createCloseoutTimelineSink,
	drainCloseoutTimelineBeforeExit,
	formatCloseoutTimelineLine,
	__lastDrainOutcomeForTests,
	recordCloseoutTimeline,
	setCloseoutTimelineSinkForTests,
	shardNameFor,
	type CloseoutTimelineDrainOutcome,
	type CloseoutTimelineFields,
	type CloseoutTimelineRecord,
} from "../closeout-timeline.ts";
import { DeliveryObligationStore } from "../delivery-obligation.ts";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";

const MODULE_PATH = new URL("../closeout-timeline.ts", import.meta.url).pathname;
const SECRET_TOKEN = "sk-ant-api99-real-secret-token";
const readSrc = (relative: string): string =>
	readFileSync(new URL(relative, import.meta.url).pathname, "utf-8");

// One temp project root for the whole file: index.ts snapshots PIPIUI_MAIN_CWD at
// import, so all later store bindings route under this root (per-sessionId subdir).
const HARNESS_MAIN_CWD = mkdtempSync(join(tmpdir(), "ct-harness-"));
scrubSubagentRuntimeTestHostEnvironment();
process.env.PIPIUI_MAIN_CWD = HARNESS_MAIN_CWD;
// index.ts also snapshots depth/supervisor/child-invocation vars AT IMPORT. A suite
// running inside a dispatched-worker host inherits its ambient PIPIUI_* env, which
// silently flips every gate this file exercises (depth!==0 disables the done-delivery
// store binding; a SESSION_KEY binds the host supervisor; a foreign NODE_PATH points
// worker children away from this file). Pin boss-mode values BEFORE importing —
// same discipline as dispatch-seam.test.ts.
process.env.PIPIUI_AGENT_DEPTH = "0"; // this suite IS the boss (depth 0)
delete process.env.PIPIUI_SESSION_KEY; // per the comment below: supervisor path stays off
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
delete process.env.PIPIUI_AGENT_ROLE;
process.env.PIPIUI_NODE_PATH = process.execPath; // worker children re-execute THIS file

after(async () => {
	const { drainPipiuiTrackedChildren } = await import("../index.ts");
	const drained = await drainPipiuiTrackedChildren(250, 2_000);
	assert.deepEqual(drained.remainingPids, [], "all closeout harness worker children were reaped");
	setCloseoutTimelineSinkForTests(undefined);
	rmSync(HARNESS_MAIN_CWD, { recursive: true, force: true });
});

/**
 * One lazily-created, long-lived extension instance wired to recording stubs.
 * Real production fns execute against it; per-test isolation comes from fresh
 * timeline sinks + distinct Pi sessionIds (the production switch boundary).
 *
 * PIPIUI_SESSION_KEY is deliberately left unset so bindHostSupervisor stays off
 * (the same default as every other index.ts suite) and delivery stays on the
 * boss path that emits the probes under test.
 */
type Handler = (event: unknown, ctx: unknown) => void | Promise<void>;
type FakePi = {
	registerTool(tool: { name: string }): void;
	registerCommand(): void;
	on(type: string, fn: Handler): void;
	sendMessage(message: unknown, options?: unknown): void;
	ui: { notify(): void };
};
type HarnessToolShape = {
	prepareArguments?: (a: unknown) => unknown;
	execute: (toolCallId: string, args: unknown, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => Promise<{
		content?: Array<{ type: string; text: string }>;
	}>;
};
type SentMessage = { message: { details?: Record<string, unknown> }; options?: unknown };
let harness: {
	extensionPi: FakePi;
	handlers: Map<string, Handler[]>;
	tools: Map<string, HarnessToolShape>;
	sentMessages: SentMessage[];
	sendThrow?: Error;
	fireSessionStart(sessionId: string): void;
	fire(type: string, event?: unknown, ctx?: unknown): void;
} | undefined;

async function loadExtensionHarness(): Promise<NonNullable<typeof harness>> {
	if (harness) return harness;
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, HarnessToolShape>();
	const sentMessages: SentMessage[] = [];
	const smCtx = (sessionId: string) => ({ sessionManager: { getSessionId: () => sessionId, getBranch: () => [] as unknown[] } });
	const holder: { sendThrow?: Error } = {};
	const extensionPi: FakePi = {
		registerTool(tool) { tools.set(tool.name, tool as unknown as HarnessToolShape); },
		registerCommand() {},
		on(type, fn) { (handlers.get(type) ?? handlers.set(type, []).get(type)!).push(fn); },
		sendMessage(message, options) {
			if (holder.sendThrow) throw holder.sendThrow;
			sentMessages.push({ message: message as never, options });
		},
		ui: { notify() {} },
	};
	const { default: loadExtension } = await import("../index.ts");
	await loadExtension(extensionPi as never);
	harness = {
		extensionPi,
		handlers,
		tools,
		sentMessages,
		fire(type, event = {}, ctx) {
			for (const fn of handlers.get(type) ?? []) {
				try { void fn(event, ctx ?? smCtx("sess-current")); } catch { /* other listeners must not block bind */ }
			}
		},
		fireSessionStart(sessionId) {
			for (const fn of handlers.get("session_start") ?? []) {
				try { void fn({}, smCtx(sessionId)); } catch { /* other listeners must not block bind */ }
			}
		},
	};
	Object.defineProperty(harness, "sendThrow", {
		get: () => holder.sendThrow,
		set: (v: Error | undefined) => { holder.sendThrow = v; },
	});
	return harness;
}

function line(event: string, fields: CloseoutTimelineFields): string {
	return formatCloseoutTimelineLine(buildCloseoutTimelineRecord(event, fields));
}

function parseLines(lines: readonly string[]): Array<Record<string, unknown>> {
	return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Default transport = DETACHED helper processes: bytes land asynchronously from the
 * main process's perspective, so direct-disk assertions must poll instead of trusting
 * flush() timing.
 */
async function waitForShardContent(shard: string, needle: string, timeoutMs = 8_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let bytes = "";
	while (Date.now() < deadline) {
		try { bytes = readFileSync(shard, "utf-8"); } catch { /* not yet */ }
		if (bytes.includes(needle)) return bytes;
		await delay(50);
	}
	return bytes;
}

function deliverRecords(lines: readonly string[], agentId: string): CloseoutTimelineRecord[] {
	const key = closeoutTimelineAgentKey(agentId);
	return (parseLines(lines) as CloseoutTimelineRecord[]).filter((r) => r.event === "done-deliver" && r.agent === key);
}

function holdRecords(lines: readonly string[], agentId: string): CloseoutTimelineRecord[] {
	const key = closeoutTimelineAgentKey(agentId);
	return (parseLines(lines) as CloseoutTimelineRecord[]).filter((r) => r.event === "done-hold" && r.agent === key);
}

/* ================================================================== */
/* 1. Correlation digests: per-field domains, one-way, joinable        */
/* ================================================================== */

test("agent and run use SEPARATE hash domains: same literal never cross-equals", () => {
	const agentKey = closeoutTimelineAgentKey(SECRET_TOKEN)!;
	const runKey = closeoutTimelineRunKey(SECRET_TOKEN)!;
	assert.match(agentKey, /^[0-9a-f]{16}$/);
	assert.notEqual(agentKey, runKey, "cross-field equality must not leak");
	assert.equal(closeoutTimelineAgentKey("quota-pill"), closeoutTimelineAgentKey("quota-pill"), "stable within field");
	assert.notEqual(closeoutTimelineAgentKey("quota-pill"), closeoutTimelineAgentKey("quota-pil"));
	assert.equal(closeoutTimelineAgentKey(""), undefined);
	assert.equal(closeoutTimelineAgentKey(undefined), undefined);
});

test("records carry domain-separated keys; raw tokens and foreign error codes never land", async () => {
	const root = mkdtempSync(join(tmpdir(), "ct-domain-"));
	const agentDir = join(root, ".pi", "agent");
	const sink = createCloseoutTimelineSink(agentDir);
	sink.write(line("verify", { agent: SECRET_TOKEN, run: SECRET_TOKEN, status: "ok", elapsedMs: 4 }));
	sink.write(line("findings", { agent: SECRET_TOKEN, status: "error", error: "totally-custom-prose" }));
	// Detached-helper transport: poll until the helper's append becomes visible.
	const bytes = await waitForShardContent(join(agentDir, shardNameFor(Date.now())), '"event":"findings"');
	assert.ok(bytes.includes('"event":"verify"'), "expected both records to reach the shard");
	assert.ok(!bytes.includes(SECRET_TOKEN) && !bytes.includes("sk-ant") && !bytes.includes("totally-custom"));
	const records = parseLines(bytes.trim().split("\n")) as Array<CloseoutTimelineRecord>;
	assert.equal(records[0]!.agent, closeoutTimelineAgentKey(SECRET_TOKEN));
	assert.equal(records[0]!.run, closeoutTimelineRunKey(SECRET_TOKEN));
	assert.equal(records[0]!.agent !== records[0]!.run, true, "same literal must map to different fields' keys");
	assert.equal(records[0]!.pid, process.pid, "recorder pid stamped by the sink, never passed by callers");
	assert.equal(records[1]!.agent, closeoutTimelineAgentKey(SECRET_TOKEN), "joinable across events");
	assert.equal(records[1]!.error, undefined, "outside the closed error domain the field drops entirely");
	rmSync(root, { recursive: true, force: true });
});

test("closed error domain admits exactly event-derived codes plus fixed extras", () => {
	for (const allowed of ["verify-timeout", "worktree-post-verify-error", "done-not-queued", "findings-error"]) {
		assert.equal(CLOSEOUT_TIMELINE_ERROR_CODES.includes(allowed), true);
	}
	assert.ok(!CLOSEOUT_TIMELINE_ERROR_CODES.some((code) => code.includes("sk-")));
});

test("numerics clamp; pid stamped; unknown keys dropped wholesale", () => {
	const record = buildCloseoutTimelineRecord("verify", {
		elapsedMs: -5.6,
		attempt: 5000,
		prompt: "user prompt",
		envHome: "/Users/x",
	} as unknown as CloseoutTimelineFields);
	assert.equal(record.elapsedMs, 0);
	assert.equal(record.attempt, 999);
	assert.equal(record.pid, process.pid);
	assert.ok(!("prompt" in record) && !("envHome" in record));
});

test("child-exit probe fields clamp; closed enums only; secrets never land", () => {
	const record = buildCloseoutTimelineRecord("child-exit", {
		status: "mark",
		detail: "close",
		cause: "none",
		childPid: -5.2,
		pgid: 12.4,
		sess: 0,
		depth: 500,
		exitCode: -5000,
		signal: "SIGKILL",
		descendants: 1e9,
		rootAlive: "yes",
		stdioOpen: "stderr",
		sampleSrc: "ps",
		tierMs: -1,
		assistantToExitMs: 12.6,
		exitToStdioCloseMs: 3.1,
		exitToCloseMs: 4.9,
		cmd: "node --secret",
		envHome: "/Users/x",
		prompt: "do the thing",
	} as unknown as CloseoutTimelineFields);
	assert.equal(record.childPid, 0);
	assert.equal(record.pgid, 12);
	assert.equal(record.sess, undefined, "sess=0 is not available on this platform");
	assert.equal(record.depth, 99);
	assert.equal(record.exitCode, -999);
	assert.equal(record.signal, "SIGKILL");
	assert.equal(record.descendants, 99_999);
	assert.equal(record.rootAlive, "yes");
	assert.equal(record.stdioOpen, "stderr");
	assert.equal(record.sampleSrc, "ps");
	assert.equal(record.tierMs, 0);
	assert.equal(record.assistantToExitMs, 13);
	assert.equal(record.exitToStdioCloseMs, 3);
	assert.equal(record.exitToCloseMs, 5);
	assert.ok(!("cmd" in record) && !("envHome" in record) && !("prompt" in record));

	const dropped = buildCloseoutTimelineRecord("child-exit", {
		status: "sample",
		detail: "not-a-detail",
		cause: "DROP TABLE agents",
		signal: "SIGFAKE",
		rootAlive: "maybe",
		stdioOpen: "fd3",
		sampleSrc: "lsof",
	} as unknown as CloseoutTimelineFields);
	assert.equal(dropped.detail, undefined);
	assert.equal(dropped.cause, undefined);
	assert.equal(dropped.signal, undefined);
	assert.equal(dropped.rootAlive, undefined);
	assert.equal(dropped.stdioOpen, undefined);
	assert.equal(dropped.sampleSrc, undefined);
});

/* ================================================================== */
/* 2. Hot path + congestion                                            */
/* ================================================================== */

test("hot path stays non-blocking against a stalling writer", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const dir = mkdtempSync(join(tmpdir(), "ct-stall-")) + "/.pi/agent";
	const stallingSink = createCloseoutTimelineSink(dir, { writer: async (_file) => { await gate; } });
	const startedAt = performance.now();
	for (let i = 0; i < 200; i++) stallingSink.write(line("verify", { agent: "a", status: "enter" }));
	assert.ok(performance.now() - startedAt < 100, "buffer pushes are microseconds, never synchronous IO");
	assert.equal(stallingSink.stats().pending, 200);
	release();
	await stallingSink.flush();
	assert.equal(stallingSink.stats().pending, 0);
	rmSync(dir.split(".pi")[0]!, { recursive: true, force: true });
});

test("overflow drops with a counter; broken sinks never surface to callers", async () => {
	const stubborn = captureCloseoutTimelineSink({ maxPendingLines: 4, rejectWrites: true });
	for (let i = 0; i < CLOSEOUT_TIMELINE_MAX_PENDING_LINES * 3; i++) stubborn.write(line("e", {}));
	assert.equal(stubborn.stats().pending, 4);
	assert.ok(stubborn.stats().dropped >= CLOSEOUT_TIMELINE_MAX_PENDING_LINES * 2);
	await stubborn.flush();
	assert.equal(stubborn.lines.length, 0);

	setCloseoutTimelineSinkForTests(captureCloseoutTimelineSink({ rejectWrites: true }));
	try {
		assert.doesNotThrow(() => {
			for (let i = 0; i < 50; i++) recordCloseoutTimeline("verify", { agent: "a", status: "enter" });
		});
	} finally {
		setCloseoutTimelineSinkForTests(undefined);
	}
});

test("a full batch coalesces into one concatenated append", async () => {
	const writes: string[] = [];
	const sink = createCloseoutTimelineSink("/does/not/matter", {
		writer: async (_file, text) => { writes.push(text); },
	});
	for (let i = 0; i < CLOSEOUT_TIMELINE_FLUSH_BATCH; i++) sink.write(line("ev", { agent: "a", status: "enter" }));
	await sink.flush();
	assert.equal(writes.length, 1);
	assert.equal(writes[0]!.trim().split("\n").length, CLOSEOUT_TIMELINE_FLUSH_BATCH);
});

/* ================================================================== */
/* 3. Exit tail: isolated worker thread, ack-fast, terminate-bounded   */
/* ================================================================== */

function runNode(script: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--experimental-strip-types", "-e", script], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		child.stdout.on("data", (d) => { stdout += String(d); });
		child.stderr.on("data", (d) => { stderr += String(d); });
		child.on("exit", (code) => { clearTimeout(killer); resolve({ code, stdout, stderr }); });
		child.on("error", reject);
	});
}

test("real subprocess normal exit persists buffered tail WITHOUT explicit flush", { timeout: 25_000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), "ct-exit-ok-"));
	const { code, stderr } = await runNode(`
		const m = await import(${JSON.stringify(MODULE_PATH)});
		m.setCloseoutTimelineDir(${JSON.stringify(join(root, ".pi", "agent"))});
		m.recordCloseoutTimeline("verify", { agent: "exit-probe", run: "r1", phase: "verifying", status: "enter" });
		m.recordCloseoutTimeline("verify", { agent: "exit-probe", run: "r1", phase: "verifying", status: "ok", elapsedMs: 33 });
	`, 15_000);
	assert.equal(code, 0, stderr);
	const shard = join(root, ".pi", "agent", shardNameFor(Date.now()));
	assert.ok(existsSync(shard), "isolated-worker beforeExit drain must persist the tail");
	const records = readFileSync(shard, "utf-8").trim().split("\n")
		.map((l) => JSON.parse(l) as { status?: string });
	assert.deepEqual(records.map((r) => r.status), ["enter", "ok"]);
	rmSync(root, { recursive: true, force: true });
});

test("worker ack path is immediate: drain resolves far below the cap on healthy disks", async () => {
	const root = mkdtempSync(join(tmpdir(), "ct-exit-fast-"));
	setCloseoutTimelineSinkForTests({
		write: () => true,
		flush: async () => {},
		stats: () => ({ pending: 5, dropped: 0 }),
		drainPending: () => [line("verify", { agent: "fast", status: "ok", elapsedMs: 1 }), line("findings", { agent: "fast", status: "ok" })],
		cancelScheduledFlush: () => {},
		directory: join(root, ".pi", "agent"),
	});
	try {
		const startedAt = Date.now();
		await drainCloseoutTimelineBeforeExit(CLOSEOUT_TIMELINE_EXIT_DRAIN_CAP_MS);
		const tookMs = Date.now() - startedAt;
		assert.ok(tookMs < 1500, `ack fast path must not wait out the cap (took ${tookMs}ms)`);
		// Healthy helper exit(0) is the ONLY path allowed to claim success.
		assert.equal(__lastDrainOutcomeForTests()?.status, "ack");
		const shard = join(root, ".pi", "agent", shardNameFor(Date.now()));
		const records = readFileSync(shard, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as { event?: string });
		assert.deepEqual(records.map((r) => r.event), ["verify", "findings"], "stolen tail written intact by the helper");
	} finally {
		setCloseoutTimelineSinkForTests(undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test("cap path terminates a wedged ACTIVE fs op: subprocess exits promptly even mid-open", { timeout: 40_000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), "ct-exit-fifo-"));
	const agentDir = join(root, ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });
	// The shard itself is a FIFO with no reader: the helper's appendFile blocks
	// forever inside open() on a libuv pool thread. This is a REAL active kernel
	// operation at drain time — not a merely never-resolving promise — so passing
	// proves terminate() + unref tear down genuine wedged I/O within the cap.
	const fifoShard = join(agentDir, shardNameFor(Date.now()));
	execFileSync("mkfifo", [fifoShard]);
	const startedAt = Date.now();
	const { code, stdout, stderr } = await runNode(`
		const m = await import(${JSON.stringify(MODULE_PATH)});
		m.setCloseoutTimelineDir(${JSON.stringify(agentDir)});
		m.recordCloseoutTimeline("verify", { agent: "fifo-wedge", status: "enter" });
		await m.drainCloseoutTimelineBeforeExit(400);
		// No process.exit mask: the capped drain reaps its helper via exit/ESRCH
		// evidence, leaving no referenced handle; the script ends NATURALLY.
		console.log(JSON.stringify({ marker: "fifo-outcome", outcome: m.__lastDrainOutcomeForTests(), helper: m.__lastTimelineHelperForTests() }));
	`, 20_000);
	const waitedMs = Date.now() - startedAt;
	assert.equal(code, 0, stderr);
	// Bounded regardless of outcome — cap(400ms) + confirm/reap bound + slack.
	assert.ok(waitedMs < 6_000, `wedged drain must be bounded (took ${waitedMs}ms)`);
	const markerLine = stdout.split("\n").reverse().find((l) => l.includes("fifo-outcome")) ?? "";
	assert.ok(markerLine, "drain outcome marker missing from child stdout");
	const probe = JSON.parse(markerLine) as {
		outcome?: CloseoutTimelineDrainOutcome;
		helper?: { pid?: number };
	};
	// The verdict must come from REAL evidence: a kill path was taken and the
	// drain never claims the chunk was delivered (only healthy exit can ack).
	assert.ok(probe.outcome, "drain outcome must be recorded");
	assert.notEqual(probe.outcome.status, "ack", "a FIFO-wedged append can never be an ack");
	assert.equal(probe.outcome.ok, false);
	assert.ok(probe.outcome.status !== "no-spawn", "helper must have actually spawned");
	// Parent-side independent proof that the PID is no longer runnable after the
	// capped drain (exit event or ESRCH probe settled it; its self-watchdog is the
	// backstop). Generous bound: watchdog(cap+reapCap)=900ms plus scheduling.
	assert.ok(probe.helper?.pid, "drain helper pid must be observable");
	let goneAfterDrain = false;
	for (let i = 0; i < 300 && !goneAfterDrain; i++) {
		try { process.kill(probe.helper.pid, 0); await delay(50); } catch { goneAfterDrain = true; }
	}
	assert.ok(goneAfterDrain, `drain helper pid ${probe.helper!.pid} still runnable after cap`);
	rmSync(root, { recursive: true, force: true });
});

test("main reaches beforeExit naturally even while its detached flush helper wedges on a FIFO", { timeout: 30_000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), "ct-nat-exit-"));
	const agentDir = join(root, ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });
	execFileSync("mkfifo", [join(agentDir, shardNameFor(Date.now()))]);
	const startedAt = Date.now();
	const { code, stdout } = await runNode(`
		const m = await import(${JSON.stringify(MODULE_PATH)});
		m.setCloseoutTimelineDir(${JSON.stringify(agentDir)});
		for (let i = 0; i < ${CLOSEOUT_TIMELINE_FLUSH_BATCH}; i++) {
			m.recordCloseoutTimeline("verify", { agent: "nat-stall", status: "enter" });
		}
		// Yield one real macrotask so the batch-full detached handoff (a microtask
		// continuation) actually spawns its wedged helper before we observe it.
		await new Promise((resolve) => setTimeout(resolve, 50));
		// Batch-full triggered the immediate DETACHED one-shot handoff; that helper
		// wedges forever on the FIFO open(). The main process holds no fs handle and
		// no referenced timer, so ending here still reaches beforeExit (drain sees
		// empty pending) and exits NATURALLY — the helper's own watchdog is its only
		// lifecycle manager from here. No parent kill timer exists to lose.
		console.log(JSON.stringify({ marker: "nat-exit-ok", helper: m.__lastTimelineHelperForTests() }));
	`, 20_000);
	const waitedMs = Date.now() - startedAt;
	assert.equal(code, 0, "a wedged detached helper must never keep the main process alive");
	assert.ok(waitedMs < 6_000, `main must exit fast despite wedged helper (took ${waitedMs}ms)`);
	const markerLine = stdout.split("\n").reverse().find((l) => l.includes("nat-exit-ok")) ?? "";
	assert.ok(markerLine, "natural-exit marker missing from child stdout");
	const probe = JSON.parse(markerLine) as { helper?: { pid?: number } };
	assert.ok(probe.helper?.pid, "handoff helper spawn recorded");
	// NO test-side cleanup anywhere: the ONLY lifecycle owner left is the helper's
	// own self-watchdog (" + CLOSEOUT_TIMELINE_HELPER_WATCHDOG_MS + "ms). Prove the production path leaves no
	// permanent orphan by polling until the PID is unrunnable on its own.
	let goneByItself = false;
	const orphanDeadline = Date.now() + CLOSEOUT_TIMELINE_HELPER_WATCHDOG_MS + 7_000;
	while (Date.now() < orphanDeadline) {
		try { process.kill(probe.helper!.pid!, 0); await delay(100); } catch { goneByItself = true; break; }
	}
	assert.ok(goneByItself,
		`ORPHAN: steady-state helper pid ${probe.helper!.pid} outlived watchdog+slack without any external killer`);
	rmSync(root, { recursive: true, force: true });
});

test("drain cap SIGKILL waits for the helper's own exit and leaves no orphan", { timeout: 30_000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), "ct-reap-"));
	const agentDir = join(root, ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });
	execFileSync("mkfifo", [join(agentDir, shardNameFor(Date.now()))]);
	const startedAt = Date.now();
	const { code, stderr, stdout } = await runNode(`
		const m = await import(${JSON.stringify(MODULE_PATH)});
		m.setCloseoutTimelineDir(${JSON.stringify(agentDir)});
		m.recordCloseoutTimeline("verify", { agent: "reap-probe", status: "enter" });
		await m.drainCloseoutTimelineBeforeExit(400);
		// Bounded grace so the observability snapshot below is deterministic.
		await new Promise((resolve) => setTimeout(resolve, 60));
		console.log(JSON.stringify({ marker: "reap-evidence", outcome: m.__lastDrainOutcomeForTests(), helper: m.__lastTimelineHelperForTests() }));
		// Natural end: the drain only settles on REAL evidence (helper exit event or
		// ESRCH probe), so nothing referenced remains here.
	`, 20_000);
	const waitedMs = Date.now() - startedAt;
	assert.equal(code, 0, `draining child should exit naturally after reap; stderr=${stderr}`);
	assert.ok(waitedMs < 6_000, `cap+reap bound must hold (took ${waitedMs}ms)`);
	const markerLine = stdout.split("\n").reverse().find((l) => l.includes("reap-evidence")) ?? "";
	assert.ok(markerLine, "reap evidence marker missing from child stdout");
	const probe = JSON.parse(markerLine) as {
		outcome?: CloseoutTimelineDrainOutcome;
		helper?: { pid?: number; reaped: boolean };
	};
	assert.ok(probe.helper?.pid, "helper pid captured by module observability seam");
	assert.equal(probe.helper.reaped, true, "module observed the killed helper's exit event");
	// The verdict carries REAL evidence semantics: killed ⇒ chunk lost, never ack.
	assert.ok(probe.outcome, "drain outcome must be recorded");
	assert.equal(probe.outcome.ok, false, "a SIGKILLed helper cannot have persisted the tail");
	assert.ok(
		probe.outcome.status === "exit-failed" || probe.outcome.status === "os-dead",
		`kill must settle on exit/ESRCH evidence, got ${String(probe.outcome.status)}`,
	);
	// PARENT-side independent proof: pid absent means fully reaped — no orphan, no
	// zombie (the middle child itself waited for the exit event before resolving).
	let gone = false;
	for (let i = 0; i < 40 && !gone; i++) {
		try { process.kill(probe.helper!.pid!, 0); await delay(50); } catch { gone = true; }
	}
	assert.ok(gone, `helper pid ${probe.helper!.pid} must not exist after drain`);
	rmSync(root, { recursive: true, force: true });
});

/* ================================================================== */
/* 4. done-deliver / hold lifecycle — REAL behavior                    */
/* ================================================================== */

/**
 * Minimal child protocol branch — mirrors dispatch-seam's proven pattern: this file
 * re-executes itself as the worker ("-p --mode json"), speaks one scripted turn keyed
 * by the prompt marker, then exits. Never falls through into the tests.
 */
async function runProbeWorkerChild(): Promise<never> {
	const argv = process.argv;
	const prompt = argv[argv.length - 1] ?? "";
	const marker = prompt.match(/\[probe-seam:([a-z0-9_-]+)\]/);
	const agentId = marker?.[1] ?? "unknown";
	const reply = (event: unknown): void => { process.stdout.write(JSON.stringify(event) + "\n"); };
	reply({ type: "session_start", cwd: process.cwd() });
	reply({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `probe-ok:${agentId}` }] } });
	process.exit(0);
}

if (process.argv.includes("-p") && process.argv.includes("--mode") && process.argv.includes("json")) {
	await runProbeWorkerChild();
}

test("REAL extension end-to-end: summary → findings → done-deliver all probed and paired", { timeout: 60_000 }, async () => {
	process.env.PIPIUI_AGENTS_DIR = new URL("../../agents/", import.meta.url).pathname;
	process.env.PIPIUI_NODE_PATH = process.execPath;
	process.env.PIPIUI_WORKTREE = "0";

	const h = await loadExtensionHarness();
	const timeline = captureCloseoutTimelineSink();
	try {
		setCloseoutTimelineSinkForTests(timeline);
		h.fireSessionStart("sess-e2e");

		const subagent = h.tools.get("subagent")!;
		assert.ok(subagent, "subagent tool must be registered");
		const preparedArgs = {
			prompt: "Behavioral probe [probe-seam:e2epair].",
			description: "behavioral probe",
			subagent_type: "explore",
			agentId: "e2epair",
			// Background is REQUIRED here: a foreground (run_in_background:false) dispatch at
			// depth 0 returns the result as the tool output and intentionally never emits the
			// findings/done-delivery probes — there is no [subagent-done] follow-up to deliver.
			// The closeout chain under test only runs on the background completion path.
			run_in_background: true,
		};
		const prepared = typeof subagent.prepareArguments === "function"
			? subagent.prepareArguments(preparedArgs)
			: preparedArgs;
		const result = await subagent.execute(
			"e2e-1", prepared as never, undefined, undefined, { cwd: tmpdir(), model: undefined } as never,
		);
		assert.match(result.content?.[0]?.text ?? "", /e2epair/, "dispatch receipt names the agent");

		let doneMessage: { message: { details?: Record<string, unknown> } } | undefined;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			if (timeline.lines.some((l) => l.includes('"done-deliver"') && l.includes('"status":"ok"'))) {
				doneMessage = h.sentMessages.find(
					(m) => (m.message as { customType?: string }).customType === "pipiui-subagent-complete-v1",
				);
				if (doneMessage) break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.ok(doneMessage, "[subagent-done] wake reached Pi through the real completion channel");
		assert.match(String((doneMessage!.message as { content?: string }).content ?? ""), /\[subagent-done\]/);
	} finally {
		// Flush BEFORE inspection: buffered lines reach `lines` only after the 20ms
		// lazy flush timer fires; a fast test body would otherwise read them empty.
		await timeline.flush();
		setCloseoutTimelineSinkForTests(undefined);
	}

	const records = parseLines(timeline.lines) as Array<CloseoutTimelineRecord>;
	const intervals = new Map<string, string[]>();
	for (const record of records) {
		const key = `${record.phase ?? record.event}`;
		const list = intervals.get(key) ?? [];
		list.push(record.status!);
		intervals.set(key, list);
	}
	const deliverStates = intervals.get("done-deliver");
	assert.ok(deliverStates && deliverStates.length >= 2, `done-deliver probes observed: ${timeline.lines.length} records`);
	assert.equal(deliverStates![0], "enter", "exactly one open for done-deliver");
	assert.equal(deliverStates![deliverStates!.length - 1], "ok", "real delivery closes with ok");
	assert.equal(deliverStates!.length, 2, `no dangling/repeat enter allowed: ${deliverStates!.join(",")}`);
	const findingsStates = intervals.get("findings");
	assert.ok(findingsStates && findingsStates.length === 2, "findings enter/terminal pair present");
	assert.deepEqual(findingsStates, ["enter", "ok"]);
	for (const [phase, states] of intervals) {
		if (states.includes("enter")) {
			assert.notEqual(states[states.length - 1], "enter", `${phase} left an unmatched enter`);
		}
	}
	const serialized = timeline.lines.join("\n");
	assert.ok(!serialized.includes("[probe-seam:"), "prompt markers must never reach the timeline");
	assert.ok(serialized.includes(closeoutTimelineAgentKey("e2epair")!), "digest key present for correlation");
});

test("done-deliver ok: production send pairs enter/ok and hands Pi the message", { timeout: 15_000 }, async () => {
	const h = await loadExtensionHarness();
	const { __doneLifecycleForTests } = await import("../index.ts");
	const timeline = captureCloseoutTimelineSink();
	const before = h.sentMessages.length;
	try {
		setCloseoutTimelineSinkForTests(timeline);
		h.fireSessionStart("sess-dok");
		const queued = await __doneLifecycleForTests.deliverToBoss(h.extensionPi as never, "ok-probe", "run-ok", "hello done");
		assert.equal(queued, true);
	} finally {
		await timeline.flush(); // terminal record must be visible to the sync asserts below
		setCloseoutTimelineSinkForTests(undefined);
	}
	const recs = deliverRecords(timeline.lines, "ok-probe");
	assert.deepEqual(recs.map((r) => r.status), ["enter", "ok"]);
	assert.equal(recs[1]!.error, undefined);
	assert.ok((recs[1]!.elapsedMs ?? 0) >= 0);
	assert.equal(h.sentMessages.length, before + 1);
	assert.ok(!timeline.lines.join("\n").includes("ok-probe"), "raw agent id stays off disk");
});

test("done-deliver queue false: sendMessage throw closes enter with done-not-queued", { timeout: 15_000 }, async () => {
	const h = await loadExtensionHarness();
	const { __doneLifecycleForTests } = await import("../index.ts");
	const timeline = captureCloseoutTimelineSink();
	const before = h.sentMessages.length;
	try {
		setCloseoutTimelineSinkForTests(timeline);
		h.fireSessionStart("sess-nq");
		h.sendThrow = new Error("host-rejected-followup");
		const queued = await __doneLifecycleForTests.deliverToBoss(h.extensionPi as never, "nq-probe", "run-nq", "late text");
		assert.equal(queued, false);
	} finally {
		await timeline.flush(); // capture the error pair before detaching the sink
		h.sendThrow = undefined;
		setCloseoutTimelineSinkForTests(undefined);
	}
	const recs = deliverRecords(timeline.lines, "nq-probe");
	assert.deepEqual(recs.map((r) => r.status), ["enter", "error"]);
	assert.equal(recs[1]!.error, "done-not-queued");
	assert.equal(h.sentMessages.length, before, "throwing send never records a queued message");
});

test("done-deliver rejection: cut-in reject closes enter with done-deliver-error and propagates", { timeout: 15_000 }, async () => {
	const h = await loadExtensionHarness();
	const { __doneLifecycleForTests, setDoneDeliverCutInOverrideForTests } = await import("../index.ts");
	const timeline = captureCloseoutTimelineSink();
	try {
		setCloseoutTimelineSinkForTests(timeline);
		h.fireSessionStart("sess-rej");
		setDoneDeliverCutInOverrideForTests(() => Promise.reject(new Error("probe-cut-in-reject")));
		await assert.rejects(
			() => __doneLifecycleForTests.deliverToBoss(h.extensionPi as never, "rej-probe", "run-rej", "x"),
			/probe-cut-in-reject/,
		);
	} finally {
		setDoneDeliverCutInOverrideForTests(undefined);
		await timeline.flush(); // rejection path's enter/error pair lands before inspection
		setCloseoutTimelineSinkForTests(undefined);
	}
	const recs = deliverRecords(timeline.lines, "rej-probe");
	assert.deepEqual(recs.map((r) => r.status), ["enter", "error"]);
	assert.equal(recs[1]!.error, "done-deliver-error");
});

test("done-deliver ownership: live foreign claim resolves true with no probes and no send", { timeout: 15_000 }, async () => {
	const h = await loadExtensionHarness();
	const { __doneLifecycleForTests } = await import("../index.ts");
	const timeline = captureCloseoutTimelineSink();
	const holder = spawn("sleep", ["30"]);
	const before = h.sentMessages.length;
	try {
		setCloseoutTimelineSinkForTests(timeline);
		h.fireSessionStart("sess-own");
		const routingDir = join(
			HARNESS_MAIN_CWD,
			".pi",
			"subagent-delivery-obligations",
			DeliveryObligationStore.routingDirectory("sess-own"),
		);
		const twin = new DeliveryObligationStore(routingDir, { routingKey: "sess-own" });
		const row = twin.create("own-probe", "run-own", "held elsewhere");
		writeFileSync(join(routingDir, `${row.id}.claim`), JSON.stringify({
			pid: holder.pid,
			ownerToken: "foreign-owner-probe",
			createdAt: Date.now(),
		}));
		const queued = await __doneLifecycleForTests.deliverToBoss(h.extensionPi as never, "own-probe", "run-own", "held elsewhere");
		assert.equal(queued, true);
	} finally {
		holder.kill("SIGKILL");
		await timeline.flush(); // pin whatever the ownership run wrote before asserting absence
		setCloseoutTimelineSinkForTests(undefined);
	}
	assert.equal(deliverRecords(timeline.lines, "own-probe").length, 0, "ownership early-return emits no enter");
	assert.equal(h.sentMessages.length, before);
});

test("session switch skip: live holds close with skip when session_start rebinds", { timeout: 15_000 }, async () => {
	const h = await loadExtensionHarness();
	const { __doneLifecycleForTests } = await import("../index.ts");
	const timeline = captureCloseoutTimelineSink();
	try {
		setCloseoutTimelineSinkForTests(timeline);
		h.fireSessionStart("sess-hbase");
		h.fire("before_agent_start", { systemPrompt: "" });
		const pA = __doneLifecycleForTests.deliverToBoss(h.extensionPi as never, "hold-a", "run-a", "t-a");
		const pB = __doneLifecycleForTests.deliverToBoss(h.extensionPi as never, "hold-b", "run-b", "t-b");
		assert.equal(await pA, false);
		assert.equal(await pB, false);
		await timeline.flush(); // enters land via the lazy flush timer; reads below are synchronous
		assert.deepEqual(holdRecords(timeline.lines, "hold-a").map((r) => r.status), ["enter"]);
		assert.deepEqual(holdRecords(timeline.lines, "hold-b").map((r) => r.status), ["enter"]);
		await new Promise((resolve) => setTimeout(resolve, 80));
		h.fireSessionStart("sess-hnext");
		h.fire("agent_settled", {}, { sessionManager: { getSessionId: () => "sess-hnext", getBranch: () => [] as unknown[] } });
	} finally {
		await timeline.flush(); // hold skip pairs must be inspectable before the sync asserts below
		setCloseoutTimelineSinkForTests(undefined);
	}
	for (const id of ["hold-a", "hold-b"]) {
		const recs = holdRecords(timeline.lines, id);
		assert.deepEqual(recs.map((r) => r.status), ["enter", "skip"], `${id} hold pair`);
		assert.equal(recs[1]!.phase, "done-await-host");
		assert.ok((recs[1]!.elapsedMs ?? 0) >= 40, `${id} skip carries hold duration: ${recs[1]!.elapsedMs}`);
		assert.equal(deliverRecords(timeline.lines, id).length, 0, `${id} never entered done-deliver while held`);
	}
	const serialized = timeline.lines.join("\n");
	for (const id of ["hold-a", "hold-b"]) assert.ok(!serialized.includes(`"${id}"`), "raw agent ids stay off disk");
});

/* ------------------------------------------------------------------ */
/* Structural pins (secondary layer alongside the behavioral tests)    */
/* ------------------------------------------------------------------ */

test("structural pins: forget sites guarded, deliver chain carries both outcomes", () => {
	const indexSrc = readSrc("../index.ts");
	assert.ok((indexSrc.match(/clearDoneHoldOnForget\(/g)?.length ?? 0) >= 7);
	assert.match(indexSrc, /for \(const entry of pendingDone\.values\(\)\) clearDoneHoldOnForget\(entry\);\s*\n\s*pendingDone\.clear\(\)/);
	assert.match(indexSrc, /\.catch\(\(err: unknown\) => \{[\s\S]*?error: "done-deliver-error"[\s\S]*?throw err;/);
	assert.match(indexSrc, /export const __doneLifecycleForTests/);
	assert.match(indexSrc, /doneDeliverCutInOverride \?\? awaitCutInHoldRelease/);
	const fnStart = indexSrc.indexOf("function sendDoneWithConfirmation");
	const body = indexSrc.slice(fnStart, indexSrc.indexOf("\nfunction ", fnStart + 10));
	const enterIdx = body.indexOf('logCloseoutProbe("done-deliver"');
	const guardsEnd = body.indexOf("// The delivery clock starts HERE");
	assert.ok(guardsEnd > -1 && guardsEnd <= enterIdx, "all early returns precede the single enter emit");
	assert.match(readSrc("../closeout.ts"), /\|\s*"skip"/);
});

test("query docs stay synced with the two domains", () => {
	const moduleSrc = readSrc("../closeout-timeline.ts");
	assert.match(moduleSrc, /pipiui-closeout-agent-v1/);
	assert.match(moduleSrc, /pipiui-closeout-run-v1/);
	assert.doesNotMatch(moduleSrc, /pipiui-closeout-v1/);
});
