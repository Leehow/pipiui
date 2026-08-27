import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	effectiveLastProgressAt,
	formatProgressLogReport,
	progressIdleMs,
	readProgressLogExcerpt,
	resolveProgressLogPath,
	sampleProgressLog,
	sanitizeProgressLogInput,
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
