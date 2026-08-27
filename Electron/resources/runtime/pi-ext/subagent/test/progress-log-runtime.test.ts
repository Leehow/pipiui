import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	applyProgressLogSampleTick,
} from "../index.ts";
import { progressIdleMs, sampleProgressLog } from "../progress-log.ts";

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
