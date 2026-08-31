import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	claimProgressLogReport,
	consumeProgressLogExcerpt,
	describeProgressChannelForStall,
	effectiveLastProgressAt,
	formatProgressLogReport,
	formatProgressLogRetargetReceipt,
	progressIdleMs,
	PROGRESS_LOG_EXCERPT_MAX_BYTES,
	readProgressLogExcerpt,
	readProgressLogTail,
	releaseProgressLogReport,
	resolveProgressLogPath,
	retargetProgressLog,
	sampleProgressLog,
	sanitizeProgressLogInput,
	sanitizeProgressReportSecs,
	type ProgressLogClaimState,
	type ProgressLogRetargetState,
} from "../progress-log.ts";

test("sanitizeProgressLogInput rejects empty, control, and oversized strings", () => {
	assert.equal(sanitizeProgressLogInput(undefined), undefined);
	assert.match(sanitizeProgressLogInput("")?.problem ?? "", /progressLog/);
	assert.match(sanitizeProgressLogInput("  ")?.problem ?? "", /progressLog/);
	assert.match(sanitizeProgressLogInput("a\nb")?.problem ?? "", /progressLog/);
	assert.match(sanitizeProgressLogInput("x".repeat(501))?.problem ?? "", /progressLog/);
	assert.deepEqual(sanitizeProgressLogInput("  .pi/progress/player-thomas.log  "), {
		value: ".pi/progress/player-thomas.log",
	});
});

test("resolveProgressLogPath stays inside allowed roots and rejects escape", () => {
	const root = mkdtempSync(join(tmpdir(), "progress-log-root-"));
	const worktree = join(root, "wt");
	mkdirSync(join(worktree, ".pi", "progress"), { recursive: true });
	const allowed = [root, worktree];

	const relative = resolveProgressLogPath({
		progressLog: ".pi/progress/player-thomas.log",
		spawnCwd: worktree,
		allowedRoots: allowed,
	});
	assert.equal("path" in relative && relative.path, join(worktree, ".pi/progress/player-thomas.log"));

	const absolute = resolveProgressLogPath({
		progressLog: join(root, ".pi/progress/main.log"),
		spawnCwd: worktree,
		allowedRoots: allowed,
	});
	assert.equal("path" in absolute && absolute.path, join(root, ".pi/progress/main.log"));

	const escaped = resolveProgressLogPath({
		progressLog: "/tmp/quest-playtest-driver/send88.err",
		spawnCwd: worktree,
		allowedRoots: allowed,
	});
	assert.match(("problem" in escaped && escaped.problem) || "", /progressLog/);

	const dotdot = resolveProgressLogPath({
		progressLog: "../../outside.log",
		spawnCwd: worktree,
		allowedRoots: allowed,
	});
	assert.match(("problem" in dotdot && dotdot.problem) || "", /progressLog/);
});

test("sampleProgressLog treats size or mtime change as progress and ignores a missing file", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-log-sample-"));
	const file = join(dir, "live.log");
	const missing = sampleProgressLog({
		path: file,
		now: 1_000,
	});
	assert.equal(missing.progressed, false);
	assert.equal(missing.at, undefined);

	writeFileSync(file, "a");
	const first = sampleProgressLog({
		path: file,
		now: 2_000,
	});
	assert.equal(first.progressed, true);
	assert.equal(first.at, 2_000);
	assert.ok(first.size > 0);

	const silent = sampleProgressLog({
		path: file,
		previous: { size: first.size, mtimeMs: first.mtimeMs },
		now: 3_000,
	});
	assert.equal(silent.progressed, false);
	assert.equal(silent.at, undefined);

	writeFileSync(file, "ab");
	const grew = sampleProgressLog({
		path: file,
		previous: { size: first.size, mtimeMs: first.mtimeMs },
		now: 4_000,
	});
	assert.equal(grew.progressed, true);
	assert.equal(grew.at, 4_000);

	const later = first.mtimeMs / 1000 + 5;
	utimesSync(file, later, later);
	const touched = sampleProgressLog({
		path: file,
		previous: { size: grew.size, mtimeMs: grew.mtimeMs },
		now: 5_000,
	});
	assert.equal(touched.progressed, true);
	assert.equal(touched.at, 5_000);
});

test("effectiveLastProgressAt prefers the newer of JSONL activity and the progress log", () => {
	assert.equal(effectiveLastProgressAt({ lastActivityAt: 10 }), 10);
	assert.equal(effectiveLastProgressAt({ lastActivityAt: 10, lastProgressLogAt: 8 }), 10);
	assert.equal(effectiveLastProgressAt({ lastActivityAt: 10, lastProgressLogAt: 12 }), 12);
	assert.equal(progressIdleMs(20, { lastActivityAt: 10, lastProgressLogAt: 12 }), 8);
});

test("readProgressLogExcerpt returns only new bytes and resets after a truncate", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-log-excerpt-"));
	const file = join(dir, "live.log");
	assert.equal(readProgressLogExcerpt({ path: file, offset: 0 }).grew, false);

	writeFileSync(file, "hello\n");
	const first = readProgressLogExcerpt({ path: file, offset: 0 });
	assert.equal(first.grew, true);
	assert.equal(first.excerpt, "hello\n");
	assert.equal(first.nextOffset, 6);

	const silent = readProgressLogExcerpt({ path: file, offset: first.nextOffset });
	assert.equal(silent.grew, false);
	assert.equal(silent.excerpt, "");

	writeFileSync(file, "hello\nworld\n");
	const next = readProgressLogExcerpt({ path: file, offset: first.nextOffset });
	assert.equal(next.excerpt, "world\n");
	assert.equal(next.grew, true);

	writeFileSync(file, "reset\n");
	const truncated = readProgressLogExcerpt({ path: file, offset: next.nextOffset });
	assert.equal(truncated.excerpt, "reset\n");
	assert.equal(truncated.nextOffset, 6);

	const long = "x".repeat(5_000);
	writeFileSync(file, long);
	const capped = readProgressLogExcerpt({ path: file, offset: 0, maxBytes: 10 });
	assert.equal(capped.addedBytes, 10);
	assert.match(capped.excerpt, /more bytes not forwarded/);
});

test("formatProgressLogReport marks a Supervisor-forwarded excerpt for Boss", () => {
	const text = formatProgressLogReport({
		agentId: "player-thomas",
		title: "quest playtest",
		elapsed: "3m",
		idleSec: 12,
		state: "running",
		excerpt: "HEARTBEAT waiting 32s",
		addedBytes: 21,
	});
	assert.match(text, /^\[subagent-heartbeat\]/);
	assert.match(text, /\[subagent-progress\] agentId=player-thomas \+21 bytes/);
	assert.match(text, /HEARTBEAT waiting 32s/);
	assert.match(text, /forwarded by Supervisor/);
});

test("sanitizeProgressReportSecs matches the heartbeat bounds and rejects non-integers", () => {
	assert.equal(sanitizeProgressReportSecs(undefined), undefined);
	assert.deepEqual(sanitizeProgressReportSecs(60), { ms: 60_000 });
	assert.deepEqual(sanitizeProgressReportSecs(30), { ms: 30_000 });
	assert.deepEqual(sanitizeProgressReportSecs(3600), { ms: 3_600_000 });
	assert.match(sanitizeProgressReportSecs(29)?.problem ?? "", /reportSecs/);
	assert.match(sanitizeProgressReportSecs(3601)?.problem ?? "", /reportSecs/);
	assert.match(sanitizeProgressReportSecs(60.5)?.problem ?? "", /reportSecs/);
});

test("retargetProgressLog rebases the offset so pre-existing bytes are never replayed as new", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-retarget-"));
	const real = join(dir, "pytest.log");
	writeFileSync(real, "hundreds of lines already written before Boss looked\n");
	const now = 5_000_000;

	const handle = {
		progressLogPath: join(dir, "wrong.log"),
		progressLogOffset: 0,
		lastProgressLogAt: now - 600_000,
		lastStallNotifyAt: now - 60_000,
		stallNotifyCount: 2,
		stallNotifyInFlight: true,
	};
	const result = retargetProgressLog(handle, { path: real, now });

	assert.equal(result.previousPath, join(dir, "wrong.log"));
	assert.equal(result.existed, true);
	assert.equal(result.intervalMs, 60_000);
	assert.equal(handle.progressLogPath, real);
	// Only appends after the correction are forwarded; the backlog is not dumped at Boss.
	assert.equal(handle.progressLogOffset, result.baselineBytes);
	const firstRead = readProgressLogExcerpt({ path: real, offset: handle.progressLogOffset });
	assert.equal(firstRead.grew, false);

	writeFileSync(real, `${"hundreds of lines already written before Boss looked\n"}pytest 3 passed\n`);
	const second = readProgressLogExcerpt({ path: real, offset: handle.progressLogOffset });
	assert.equal(second.excerpt, "pytest 3 passed\n");

	// The idle verdict that was measured against the wrong file is withdrawn, not kept.
	assert.equal(handle.lastProgressLogAt, now);
	assert.equal(handle.stallNotifyCount, 0);
	assert.equal(handle.lastStallNotifyAt, 0);
	assert.equal(handle.stallNotifyInFlight, false);
});

test("retargetProgressLog accepts a not-yet-created log and keeps the run's own cadence", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-retarget-missing-"));
	const handle = {
		progressLogIntervalMs: 120_000,
		lastStallNotifyAt: 0,
		stallNotifyCount: 0,
	};
	const result = retargetProgressLog(handle, { path: join(dir, "not-yet.log"), now: 42 });
	assert.equal(result.existed, false);
	assert.equal(result.baselineBytes, 0);
	assert.equal(result.previousPath, undefined);
	// Absent reportSecs keeps whatever cadence this run already had.
	assert.equal(result.intervalMs, 120_000);
	assert.equal(handle.progressLogIntervalMs, 120_000);

	const faster = retargetProgressLog(handle, { path: join(dir, "not-yet.log"), now: 43, intervalMs: 30_000 });
	assert.equal(faster.intervalMs, 30_000);
});

test("the retarget receipt states what is watched, what was replaced, and that idle was reset", () => {
	const text = formatProgressLogRetargetReceipt({
		agentId: "playtest-one",
		runId: "run-7",
		path: "/proj/.pi/progress/playtest-one.log",
		result: { previousPath: "/proj/wrong.log", baselineBytes: 900, existed: true, intervalMs: 60_000 },
	});
	assert.match(text, /agentId=playtest-one runId=run-7/);
	assert.match(text, /now watching \/proj\/\.pi\/progress\/playtest-one\.log \(already 900 bytes/);
	assert.match(text, /was watching \/proj\/wrong\.log/);
	assert.match(text, /every 60s/);
	assert.match(text, /idle clock and this run's stall-notification budget reset/);
	// Never sold as a way to keep a wedged worker alive.
	assert.match(text, /it will be reported stalled again/);

	const firstTime = formatProgressLogRetargetReceipt({
		agentId: "a",
		runId: "r",
		path: "/proj/x.log",
		result: { baselineBytes: 0, existed: false, intervalMs: 30_000 },
	});
	assert.match(firstTime, /not created yet; that is not a failure/);
	assert.match(firstTime, /no progress log was set for this run before now/);
});

test("a stalled worker's progress channel reports the command that never returned", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-stall-evidence-"));
	const file = join(dir, "ev5.log");
	// The real 2026-08-27 log, verbatim in shape: three suites ran, the fourth stopped mid-line.
	writeFileSync(file, [
		"06:28:11 recovery start: prior hang suspected in combined pytest run",
		"06:28:18 run: pytest tests/test_operation_module_architecture.py (alone)",
		"52 passed in 0.57s",
		"06:28:23 run: pytest tests/test_toolbox.py (alone)",
		"...F.............................................F....................... [ 42%]",
		".F",
	].join("\n"));

	const now = 1_000_000;
	const text = describeProgressChannelForStall({
		path: file,
		now,
		lastProgressLogAt: now - 130_000,
		setAt: now - 200_000,
		tail: readProgressLogTail({ path: file }),
	});
	assert.match(text, /last grew 130s ago/);
	// The whole point: the boss reads which suite hung instead of re-deriving it from the disk.
	assert.match(text, /pytest tests\/test_toolbox\.py/);
	assert.match(text, /\[ 42%\]/);

	// A log that never appeared accuses the instrument, not the worker — and names the
	// buffering trap that makes a healthy pipeline look dead.
	const missing = describeProgressChannelForStall({
		path: join(dir, "never.log"),
		now,
		setAt: now - 45_000,
		tail: readProgressLogTail({ path: join(dir, "never.log") }),
	});
	assert.match(missing, /never written since it was set 45s ago/);
	assert.match(missing, /PYTHONUNBUFFERED=1/);
	assert.doesNotMatch(missing, /last grew/);
});

test("readProgressLogTail keeps the end of a long log and is independent of the forward offset", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-tail-"));
	const file = join(dir, "big.log");
	writeFileSync(file, `${"o".repeat(5000)}\nTAIL MARKER`);
	const tail = readProgressLogTail({ path: file });
	assert.ok(tail && tail.tail.endsWith("TAIL MARKER"));
	assert.ok(tail.tail.length <= 600);
	assert.equal(tail.size, 5012);
	assert.equal(readProgressLogTail({ path: join(dir, "absent.log") }), undefined);
});

test("claimProgressLogReport is single-flight and re-arms only on the holder's release", () => {
	// Reusable: works on a bare claim state, no retarget fields required.
	const state: ProgressLogClaimState = {};
	const first = claimProgressLogReport(state);
	assert.ok(first);
	// A concurrent claimant is refused, not queued: it retries on its next tick instead.
	assert.equal(claimProgressLogReport(state), undefined);
	assert.equal(state.progressReportInFlight, true);

	// A wrong token is a failed release: the claim stays held by its owner.
	assert.equal(releaseProgressLogReport(state, { token: first.token + 1 }), false);
	assert.equal(state.progressReportInFlight, true);
	assert.equal(claimProgressLogReport(state), undefined);

	// The holder's release succeeds and re-arms the gate for the next delivery.
	assert.equal(releaseProgressLogReport(state, first), true);
	assert.equal(state.progressReportInFlight, false);
	assert.equal(state.progressReportClaim, undefined);

	// Tokens never repeat, so a stale token can never free a later claimant's gate.
	const second = claimProgressLogReport(state);
	assert.ok(second);
	assert.notEqual(second.token, first.token);
	assert.equal(releaseProgressLogReport(state, second), true);
	assert.equal(releaseProgressLogReport(state, second), false); // double release refused
	assert.equal(releaseProgressLogReport(state, first), false); // long-stale release refused
	assert.equal(claimProgressLogReport({ progressReportInFlight: false, progressReportClaim: 7 })?.token, 1);
});

test("one cursor, single-flight: no duplicate excerpt and no lost append across concurrent attempts", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-single-flight-"));
	const file = join(dir, "live.log");
	const state: ProgressLogRetargetState = { progressLogOffset: 0, lastStallNotifyAt: 0, stallNotifyCount: 0 };

	appendFileSync(file, "one\n");
	const a = claimProgressLogReport(state);
	assert.ok(a);
	const first = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(first.excerpt, "one\n");
	assert.equal(first.nextOffset, 4);
	assert.equal(state.progressLogOffset, 4);

	// While that delivery is in flight, a competing attempt cannot start a second read.
	assert.equal(claimProgressLogReport(state), undefined);

	// The append lands while the delivery is still outstanding — it must not be lost.
	appendFileSync(file, "two\n");
	assert.equal(releaseProgressLogReport(state, a), true);

	const b = claimProgressLogReport(state);
	assert.ok(b);
	const second = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(second.excerpt, "two\n"); // exactly the new bytes, nothing replayed
	assert.equal(releaseProgressLogReport(state, b), true);

	// Drained: another attempt is a silent no-op with the cursor intact.
	const c = claimProgressLogReport(state);
	assert.ok(c);
	const drained = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(drained.grew, false);
	assert.equal(drained.excerpt, "");
	assert.equal(state.progressLogOffset, 8);
	assert.equal(releaseProgressLogReport(state, c), true);
});

test("rotation and truncation restart the cursor deterministically", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-rotation-"));
	const file = join(dir, "live.log");
	const state: ProgressLogRetargetState = { progressLogOffset: 0, lastStallNotifyAt: 0, stallNotifyCount: 0 };

	writeFileSync(file, "first-generation-output\n");
	const gen1 = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(gen1.excerpt, "first-generation-output\n");
	assert.equal(gen1.nextOffset, 24);

	// Rotation to a shorter log: the size fell below the cursor, so the read restarts at 0
	// and forwards exactly the replacement's bytes — same replacement, same bytes, every time.
	writeFileSync(file, "rotated\n");
	const gen2 = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(gen2.excerpt, "rotated\n");
	assert.equal(gen2.nextOffset, 8);
	writeFileSync(file, "cut\n");
	const gen2b = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(gen2b.excerpt, "cut\n");
	assert.equal(gen2b.nextOffset, 4);

	// Truncation to empty observes the cursor reset at 0; re-growth then reads the new bytes whole.
	writeFileSync(file, "");
	const emptied = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(emptied.grew, false);
	assert.equal(emptied.nextOffset, 0);
	appendFileSync(file, "regrown\n");
	const gen4 = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(gen4.excerpt, "regrown\n");
	assert.equal(gen4.nextOffset, 8);

	// A replacement larger than the cursor is indistinguishable from an append at this layer
	// (no inode tracking), so the policy stays consume-on-attempt: suffix only, no replay of
	// bytes Boss already received.
	writeFileSync(file, "rotated-again\n");
	const gen3 = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(gen3.excerpt, "again\n");
	assert.equal(gen3.nextOffset, 14);
});

test("retarget resets the baseline without replay and re-arms a held claim", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-retarget-claim-"));
	const real = join(dir, "harness.log");
	writeFileSync(real, "pre-existing bytes\n");
	const now = 9_000_000;
	const state: ProgressLogRetargetState = {
		progressLogPath: join(dir, "old.log"),
		progressLogOffset: 3, // mid-file cursor left over against the old path
		lastProgressLogAt: now - 600_000,
		lastStallNotifyAt: now - 60_000,
		stallNotifyCount: 4,
		stallNotifyInFlight: true,
	};
	const stale = claimProgressLogReport(state);
	assert.ok(stale);

	const result = retargetProgressLog(state, { path: real, now });
	assert.equal(result.baselineBytes, 19);
	assert.equal(state.progressLogOffset, 19); // baseline, not zero: no backlog replay
	// The retarget re-armed the claim; the abandoned delivery's late release must not take it.
	assert.equal(state.progressReportInFlight, false);
	assert.equal(releaseProgressLogReport(state, stale), false);

	appendFileSync(real, "fresh tail\n");
	const fresh = claimProgressLogReport(state); // immediately claimable again
	assert.ok(fresh);
	const excerpt = consumeProgressLogExcerpt(state, { path: real });
	assert.equal(excerpt.excerpt, "fresh tail\n"); // only appends after the retarget
	assert.equal(state.progressLogOffset, 30);
	assert.equal(releaseProgressLogReport(state, fresh), true);

	// The withdrawn verdicts stay withdrawn.
	assert.equal(state.stallNotifyCount, 0);
	assert.equal(state.lastStallNotifyAt, 0);
	assert.equal(state.lastProgressLogAt, now);
});

test("consume bounds: 4KB cap holds, offsets clamp, and a missing file stays silent", () => {
	const dir = mkdtempSync(join(tmpdir(), "progress-bounds-"));
	const file = join(dir, "live.log");
	const state: ProgressLogRetargetState = { progressLogOffset: -5, lastStallNotifyAt: 0, stallNotifyCount: 0 };

	// Missing file: silent no-op, and the cursor never goes negative.
	const absent = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(absent.grew, false);
	assert.equal(absent.excerpt, "");
	assert.equal(state.progressLogOffset, 0);

	appendFileSync(file, "x".repeat(5_000));
	const capped = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(capped.addedBytes, PROGRESS_LOG_EXCERPT_MAX_BYTES);
	assert.equal(state.progressLogOffset, PROGRESS_LOG_EXCERPT_MAX_BYTES);
	assert.match(capped.excerpt, /more bytes not forwarded/);

	// The bytes beyond the cap are picked up by the next attempt, in order, exactly once.
	const rest = consumeProgressLogExcerpt(state, { path: file });
	assert.equal(rest.addedBytes, 5_000 - PROGRESS_LOG_EXCERPT_MAX_BYTES);
	assert.equal(state.progressLogOffset, 5_000);
	assert.doesNotMatch(rest.excerpt, /more bytes not forwarded/);
});
