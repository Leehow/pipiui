/*
 * retention.test.ts — spool GC: age-based reaping of per-session spool dirs.
 * The safety properties under test: only dirs past the window die, never the current session's,
 * freshness is judged by the newest FILE inside (not the dir), and everything fails open.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	spoolRetainMsFromEnv,
	sweepSpools,
	sweepWorkspaceSpools,
	touchHeartbeat,
	resetHeartbeatThrottle,
	SPOOL_RETAIN_DAYS_DEFAULT,
	HEARTBEAT_FILE,
	HEARTBEAT_THROTTLE_MS,
} from "../src/adapters/pi/retention";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed clock for every sweep

let root: string;

/** Create a session spool dir with one envelope file, both stamped `ageDays` old. */
function sessionDir(name: string, ageDays: number, files: string[] = ["abc123.json"]): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	const t = new Date(NOW - ageDays * DAY);
	for (const f of files) {
		const p = join(dir, f);
		writeFileSync(p, JSON.stringify({ v: 1, code: f.replace(/\.json$/, "") }));
		utimesSync(p, t, t);
	}
	utimesSync(dir, t, t);
	return dir;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "cf-retention-"));
	resetHeartbeatThrottle();
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.CONTEXTFOLD_SPOOL_RETAIN_DAYS;
});

describe("sweepSpools", () => {
	it("reaps dirs past the window and keeps fresh ones", () => {
		const old = sessionDir("old-session", 30);
		const fresh = sessionDir("fresh-session", 2);
		const res = sweepSpools(root, "current-session", 14 * DAY, NOW);
		expect(res.reaped).toEqual(["old-session"]);
		expect(res.kept).toBe(1);
		expect(existsSync(old)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
	});

	it("never touches the current session's dir, whatever its age", () => {
		const current = sessionDir("current-session", 400);
		const res = sweepSpools(root, "current-session", 14 * DAY, NOW);
		expect(res.reaped).toEqual([]);
		expect(existsSync(current)).toBe(true);
	});

	it("judges freshness by the newest file inside, not the dir mtime", () => {
		// Dir stamped ancient, but one envelope written recently — an actively-used spool stays.
		const dir = sessionDir("active-old", 30, ["stale.json"]);
		const freshFile = join(dir, "fresh.json");
		writeFileSync(freshFile, "{}");
		const t = new Date(NOW - 1 * DAY);
		utimesSync(freshFile, t, t);
		const res = sweepSpools(root, "current", 14 * DAY, NOW);
		expect(res.reaped).toEqual([]);
		expect(existsSync(dir)).toBe(true);
	});

	it("reaps an empty dir by its own mtime", () => {
		const dir = join(root, "empty-old");
		mkdirSync(dir);
		const t = new Date(NOW - 30 * DAY);
		utimesSync(dir, t, t);
		const res = sweepSpools(root, "current", 14 * DAY, NOW);
		expect(res.reaped).toEqual(["empty-old"]);
		expect(existsSync(dir)).toBe(false);
	});

	it("retainMs 0 disables the sweep entirely", () => {
		const old = sessionDir("old-session", 400);
		const res = sweepSpools(root, "current", 0, NOW);
		expect(res.reaped).toEqual([]);
		expect(existsSync(old)).toBe(true);
	});

	it("a missing spool root is a no-op, not a throw", () => {
		const res = sweepSpools(join(root, "does-not-exist"), "current", 14 * DAY, NOW);
		expect(res).toEqual({ reaped: [], kept: 0 });
	});

	it("ignores stray plain files in the spool root", () => {
		const stray = join(root, "stray.txt");
		writeFileSync(stray, "not a session dir");
		const t = new Date(NOW - 30 * DAY);
		utimesSync(stray, t, t);
		const res = sweepSpools(root, "current", 14 * DAY, NOW);
		expect(res.reaped).toEqual([]);
		expect(existsSync(stray)).toBe(true);
	});

	it("a dir exactly at the boundary is kept (strictly-older-than semantics)", () => {
		sessionDir("boundary", 14);
		const res = sweepSpools(root, "current", 14 * DAY, NOW);
		expect(res.reaped).toEqual([]);
		expect(res.kept).toBe(1);
	});
});

describe("sweepWorkspaceSpools", () => {
	/** Create `<root>/<workspace>/spool/<session>` with one aged envelope file. */
	function workspaceSession(workspace: string, session: string, ageDays: number): string {
		const dir = join(root, workspace, "spool", session);
		mkdirSync(dir, { recursive: true });
		const t = new Date(NOW - ageDays * DAY);
		const p = join(dir, "abc123.json");
		writeFileSync(p, "{}");
		utimesSync(p, t, t);
		utimesSync(dir, t, t);
		return dir;
	}

	it("reaps stale sessions in sibling workspaces and removes an emptied spool root", () => {
		const stale = workspaceSession("ws-abandoned", "s1", 30);
		const fresh = workspaceSession("ws-active", "s2", 0.5);
		const res = sweepWorkspaceSpools(root, join(root, "ws-current", "spool"), 1 * DAY, NOW);
		expect(res.reaped).toEqual(["ws-abandoned/s1"]);
		expect(existsSync(stale)).toBe(false);
		expect(existsSync(join(root, "ws-abandoned", "spool"))).toBe(false); // emptied root removed
		expect(existsSync(join(root, "ws-abandoned"))).toBe(true); // workspace dir itself untouched
		expect(existsSync(fresh)).toBe(true);
	});

	it("never descends into the current workspace's spool root", () => {
		const mine = workspaceSession("ws-current", "s-old", 400);
		const res = sweepWorkspaceSpools(root, join(root, "ws-current", "spool"), 1 * DAY, NOW);
		expect(res.reaped).toEqual([]);
		expect(existsSync(mine)).toBe(true);
	});

	it("a sibling workspace's heartbeating session survives", () => {
		const live = workspaceSession("ws-other", "s-live", 30);
		touchHeartbeat(live, NOW);
		const res = sweepWorkspaceSpools(root, join(root, "ws-current", "spool"), 1 * DAY, NOW);
		expect(res.reaped).toEqual([]);
		expect(existsSync(live)).toBe(true);
	});

	it("workspaces without a spool subdir and a missing sessions root are no-ops", () => {
		mkdirSync(join(root, "ws-no-spool"), { recursive: true });
		expect(sweepWorkspaceSpools(root, join(root, "ws-current", "spool"), 1 * DAY, NOW)).toEqual({ reaped: [], kept: 0 });
		expect(sweepWorkspaceSpools(join(root, "nope"), join(root, "ws-current", "spool"), 1 * DAY, NOW)).toEqual({ reaped: [], kept: 0 });
	});
});

describe("touchHeartbeat", () => {
	it("keeps a quiet but live session's spool from being reaped", () => {
		// The bug this fixes: the dir and every envelope in it are 30 days old because the session
		// folded early and then ran quietly. Without a heartbeat a sibling's sweep reaps it.
		const dir = sessionDir("live-but-quiet", 30);
		expect(sweepSpools(root, "current", 14 * DAY, NOW)).toMatchObject({ reaped: ["live-but-quiet"] });

		// Same setup, but the live session beat recently.
		resetHeartbeatThrottle();
		const dir2 = sessionDir("live-but-quiet", 30);
		expect(touchHeartbeat(dir2, NOW)).toBe(true);
		const res = sweepSpools(root, "current", 14 * DAY, NOW);
		expect(res.reaped).toEqual([]);
		expect(existsSync(dir2)).toBe(true);
		expect(existsSync(join(dir2, HEARTBEAT_FILE))).toBe(true);
		expect(dir).toBe(dir2); // same path, rebuilt
	});

	it("no-ops when the session has never spooled, rather than creating an empty dir", () => {
		const dir = join(root, "never-folded");
		expect(touchHeartbeat(dir, NOW)).toBe(false);
		expect(existsSync(dir)).toBe(false);
	});

	it("throttles to at most one write per window, then beats again after it", () => {
		const dir = sessionDir("s", 1);
		expect(touchHeartbeat(dir, NOW)).toBe(true);
		expect(touchHeartbeat(dir, NOW + 1000)).toBe(false);
		expect(touchHeartbeat(dir, NOW + HEARTBEAT_THROTTLE_MS - 1)).toBe(false);
		expect(touchHeartbeat(dir, NOW + HEARTBEAT_THROTTLE_MS)).toBe(true);
	});

	it("refreshes the mtime of an existing heartbeat instead of rewriting it", () => {
		const dir = sessionDir("s", 30);
		touchHeartbeat(dir, NOW - 20 * DAY);
		const file = join(dir, HEARTBEAT_FILE);
		const before = statSync(file).mtimeMs;
		resetHeartbeatThrottle();
		expect(touchHeartbeat(dir, NOW)).toBe(true);
		expect(statSync(file).mtimeMs).toBeGreaterThan(before);
	});

	it("a stale heartbeat does not save a dead session", () => {
		const dir = sessionDir("dead", 30);
		touchHeartbeat(dir, NOW - 30 * DAY); // last beat 30 days ago
		const res = sweepSpools(root, "current", 14 * DAY, NOW);
		expect(res.reaped).toEqual(["dead"]);
		expect(existsSync(dir)).toBe(false);
	});
});

describe("spoolRetainMsFromEnv", () => {
	it("defaults to SPOOL_RETAIN_DAYS_DEFAULT days when unset", () => {
		expect(SPOOL_RETAIN_DAYS_DEFAULT).toBe(30);
		expect(spoolRetainMsFromEnv()).toBe(SPOOL_RETAIN_DAYS_DEFAULT * DAY);
	});
	it("0 / off / false disable GC", () => {
		for (const v of ["0", "off", "OFF", "false"]) {
			process.env.CONTEXTFOLD_SPOOL_RETAIN_DAYS = v;
			expect(spoolRetainMsFromEnv()).toBe(0);
		}
	});
	it("a numeric value sets the window in days", () => {
		process.env.CONTEXTFOLD_SPOOL_RETAIN_DAYS = "7";
		expect(spoolRetainMsFromEnv()).toBe(7 * DAY);
	});
	it("garbage falls back to the default (never accidentally 0)", () => {
		for (const v of ["banana", "-3", "NaN", ""]) {
			process.env.CONTEXTFOLD_SPOOL_RETAIN_DAYS = v;
			expect(spoolRetainMsFromEnv()).toBe(SPOOL_RETAIN_DAYS_DEFAULT * DAY);
		}
	});
});
