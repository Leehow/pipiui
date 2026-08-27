import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	applyProgressLogSampleTick,
} from "../index.ts";
import { progressIdleMs, retargetProgressLog, sampleProgressLog } from "../progress-log.ts";

/** Mirrors STALL_THRESHOLD_MS (120s); the constant itself is not exported. */
const STALL_THRESHOLD_MS = 120_000;

function source(): string {
	return readFileSync(new URL("../index.ts", import.meta.url), "utf8");
}

test("a growing progress log counts as activity for an otherwise long-silent worker", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-log-runtime-"));
	const file = join(dir, "live.log");
	writeFileSync(file, "boot\n");

	// Prime exactly like runSingleAgent does: baseline sample + offset taken at spawn.
	const t0 = 1_000_000;
	const handle: {
		progressLogPath?: string;
		progressLogSample?: ReturnType<typeof sampleProgressLog>;
		lastProgressLogAt?: number;
		lastActivityAt: number;
		finalizing?: boolean;
	} = { progressLogPath: file, lastActivityAt: t0 - 10 * 60_000 };
	handle.progressLogSample = sampleProgressLog({ path: file, now: t0 });

	// First watchdog ticks see no new bytes: no progress credit, worker stays "long silent".
	applyProgressLogSampleTick(handle, t0 + 30_000);
	assert.equal(handle.lastProgressLogAt, undefined);

	// The run appends test output; the next tick credits it even though JSONL is silent.
	writeFileSync(file, "boot\npytest 1 passed\n");
	applyProgressLogSampleTick(handle, t0 + 60_000);
	assert.equal(handle.lastProgressLogAt, t0 + 60_000);

	// The run keeps appending while its JSONL stays silent for another ~40 minutes.
	// Each 30s watchdog pass sees the grown file and refreshes lastProgressLogAt.
	const end = t0 + 41 * 60_000;
	for (let t = t0 + 90_000; t <= end; t += 30_000) {
		writeFileSync(file, `${readFileSync(file, "utf8")}tick\n`);
		applyProgressLogSampleTick(handle, t);
	}

	// Idle decisions merge the two signals: 50 minutes of JSONL silence reads as seconds old,
	// well under the stall threshold; the raw JSONL-only view would be long past "stalled".
	const later = end + 5_000;
	assert.ok(progressIdleMs(later, handle) < STALL_THRESHOLD_MS);
	assert.equal(later - handle.lastActivityAt, 51 * 60_000 + 5_000);
});

test("an unchanged or missing progress log leaves stall math untouched and never throws", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-log-runtime-missing-"));
	const missing = join(dir, "nope.log");
	const t0 = 2_000_000;
	const handle: {
		progressLogPath?: string;
		progressLogSample?: ReturnType<typeof sampleProgressLog>;
		lastProgressLogAt?: number;
		lastActivityAt: number;
	} = { progressLogPath: missing, lastActivityAt: t0 - 500_000 };

	assert.doesNotThrow(() => applyProgressLogSampleTick(handle, t0));
	assert.equal(handle.lastProgressLogAt, undefined);
	assert.equal(progressIdleMs(t0, handle), 500_000);

	// Workers without a progressLog field behave byte-for-byte like today.
	const plain = { lastActivityAt: 1234 };
	assert.doesNotThrow(() => applyProgressLogSampleTick(plain as never, 9_000));
	assert.equal((plain as { lastProgressLogAt?: number }).lastProgressLogAt, undefined);
	assert.equal(progressIdleMs(5678, plain), 4444);
});

test("runtime wiring: schemas, containment gate, watchdog order, and idle call sites", () => {
	const src = source();

	// Strict sanitizer boundary: both public schemas must declare the field or providers drop it.
	assert.match(src, /const ChainItem = Type\.Object\(\{[\s\S]*?timeoutSecs: TimeoutSecsParam,\n\tprogressLog: ProgressLogParam,/);
	const singleSchema = src.slice(src.indexOf("const SubagentParams"), src.indexOf("const SubagentChainParams"));
	assert.match(singleSchema, /progressLog: ProgressLogParam,/);

	// Containment gate sits right after spawnCwd resolution and names every allowed root.
	assert.match(
		src,
		/const spawnCwd = placement\.cwd;\n[\s\S]{0,400}?resolveProgressLogPath\(\{\n\t\t\tprogressLog: executionPolicy\.progressLog,\n\t\t\tspawnCwd,\n\t\t\tallowedRoots: \[PIPIUI_MAIN_CWD, spawnCwd, placement\.worktreePath\],/,
	);

	// Watchdog samples the log BEFORE the stall passes, so the same tick's idle decision is fresh.
	const sampleIdx = src.indexOf("applyProgressLogSampleTick(handle, now)");
	const stallPassIdx = src.indexOf("// (3) stall 推送");
	assert.ok(sampleIdx > 0 && stallPassIdx > sampleIdx);

	// Every idle computation that feeds a stall/runtime-budget decision merges the log signal.
	for (const needle of [
		"const idleMs = progressIdleMs(now, handle);",
		"if (progressIdleMs(now, handle) >= STALL_THRESHOLD_MS) return \"stalled\";",
		"const idleMs = handle ? progressIdleMs(now, handle) : Number.POSITIVE_INFINITY;",
		"&& progressIdleMs(now, handle) >= LIVENESS_SAMPLE_AFTER_MS,",
	]) {
		assert.ok(src.includes(needle), `expected runtime to compute idle via progressIdleMs: ${needle}`);
	}
	// ...and never recomputes those decisions from bare JSONL activity.
	assert.ok(!src.includes("now - handle.lastActivityAt >= STALL_THRESHOLD_MS"));
	assert.ok(!src.includes("idleMs = now - handle.lastActivityAt"));

	// Forward path forces the Boss wake and never touches noteAgentActivity.
	const forwardIdx = src.indexOf("forceForward: true,");
	const noteIdx = src.indexOf("async function deliverProgressLogReport");
	assert.ok(noteIdx > 0 && forwardIdx > noteIdx);
	const fnBody = src.slice(noteIdx, src.indexOf("\n}", src.indexOf("sendUserMessageAfterCutIn(pi, text)", noteIdx)));
	assert.ok(!fnBody.includes("noteAgentActivity"));
});

test("a mid-run retarget makes the corrected log the live progress signal", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-log-retarget-runtime-"));
	const named = join(dir, "guessed.log");
	const real = join(dir, "driver.log");
	writeFileSync(named, "");
	writeFileSync(real, "already 40 minutes of playtest output\n");

	// A worker blocked in a driver that reports through `real`: its JSONL has been silent for
	// 50 minutes and the file the dispatch named never gets a byte, so the watchdog is right
	// about the silence and wrong about the worker.
	const t0 = 7_000_000;
	const handle = {
		progressLogPath: named,
		progressLogSample: sampleProgressLog({ path: named, now: t0 }),
		progressLogOffset: 0,
		lastActivityAt: t0 - 50 * 60_000,
		lastStallNotifyAt: t0 - 60_000,
		stallNotifyCount: 2,
	};
	applyProgressLogSampleTick(handle, t0);
	assert.ok(progressIdleMs(t0, handle) > STALL_THRESHOLD_MS);

	retargetProgressLog(handle, { path: real, now: t0 });
	assert.ok(progressIdleMs(t0, handle) < STALL_THRESHOLD_MS);
	// The backlog is a baseline, not progress: a tick with no new bytes must not credit it.
	applyProgressLogSampleTick(handle, t0 + 30_000);
	assert.equal(handle.lastProgressLogAt, t0);

	// From here the corrected file drives the same watchdog credit the dispatch field would have.
	writeFileSync(real, `${readFileSync(real, "utf8")}turn 41 resolved\n`);
	applyProgressLogSampleTick(handle, t0 + 60_000);
	assert.equal(handle.lastProgressLogAt, t0 + 60_000);
	assert.ok(progressIdleMs(t0 + 65_000, handle) < STALL_THRESHOLD_MS);
	// JSONL activity is untouched: log bytes never masquerade as the worker's own stream.
	assert.equal(handle.lastActivityAt, t0 - 50 * 60_000);
});

test("runtime wiring: the retarget is Boss-side, run-bound, and fenced exactly like dispatch", () => {
	const src = source();

	// One public tool, strict-sanitized like its abort/resolve siblings, delegating to the
	// shared execute rather than reaching into runningAgents from a second place.
	assert.match(src, /name: "subagent_progress",/);
	assert.match(src, /parameters: SubagentProgressParams,\n\t\tprepareArguments: bindSanitizeStrictToolArguments\(SubagentProgressParams\),/);
	assert.match(src, /action: "progress",/);
	const progressSchema = src.slice(src.indexOf("const SubagentProgressParams"), src.indexOf("const SubagentResolveParams"));
	for (const field of ["agentId", "runId", "progressLog"]) {
		assert.match(progressSchema, new RegExp(`\\n\\t${field}: Type\\.String\\(`), `${field} must be required on the retarget`);
	}
	assert.match(progressSchema, /reportSecs: Type\.Optional\(Type\.Integer\(\{\n\t\tminimum: 30,\n\t\tmaximum: 3600,/);

	// The gates, in order: live run, exact runId, not finalizing, and the same bundled
	// general-purpose gate the dispatch field passes.
	const fn = src.slice(src.indexOf("function retargetRunningProgressLog"), src.indexOf("function abortRunningAgent"));
	const order = ["runningAgents.get(agentId)", "handle.runId !== runId", "handle.finalizing", "handle.progressLogEligible"];
	let cursor = -1;
	for (const needle of order) {
		const at = fn.indexOf(needle);
		assert.ok(at > cursor, `retarget gate out of order or missing: ${needle}`);
		cursor = at;
	}
	// Containment is judged against THIS run's own roots, not the Boss's cwd alone.
	assert.match(fn, /spawnCwd: handle\.spawnCwd \?\? PIPIUI_MAIN_CWD,\n\t\tallowedRoots: \[PIPIUI_MAIN_CWD, handle\.spawnCwd \?\? "", handle\.worktreePath \?\? ""\],/);
	// Those roots only exist because the dispatch records them on the handle.
	assert.match(src, /\t\t\tspawnCwd,\n\t\t\t\.\.\.\(executionPolicy \? \{ progressLogEligible: true \} : \{\}\),/);

	// The detail view names the file the idle clock actually reads, so the correction is aimed
	// at a known target rather than guessed at.
	assert.match(src, /progress log: \$\{live\.progressLogPath\}/);
	assert.match(src, /} else if \(live\?\.progressLogEligible\) \{/);

	// A stall signal must offer the correction, or the Boss aborts a healthy test run instead.
	const stall = readFileSync(new URL("../stall-notification.ts", import.meta.url), "utf8");
	assert.match(stall, /subagent_progress\(\{agentId:"\$\{input\.agentId\}", runId:"\$\{input\.runId\}"/);
});
