/*
 * retention.ts — spool GC: bounded on-disk retention for session spools.
 *
 * The spool grows without bound on a 24/7 box (one dir per session, one envelope per fold;
 * nothing ever deletes). This sweep runs once per session at `session_start` and removes WHOLE
 * per-session spool directories whose newest file is older than the retention window.
 *
 * Directory granularity is what makes deletion safe: dedup aliases only ever point at sibling
 * envelopes in the SAME directory, so removing a whole dir can never dangle an alias. And the
 * missing-spool path already fails the right way — resume revalidation drops folds whose spool
 * vanished (they render raw), and a recall on a reaped code throws the typed SpoolError
 * (fail-explicit). GC introduces no new failure mode; it just makes that path reachable
 * by age.
 *
 * The CURRENT session's dir is never touched, whatever its age. Everything here is fail-open:
 * an unreadable entry is kept, a failed delete is skipped — the sweep must never break a session
 * over housekeeping.
 *
 * Liveness vs. fold activity: file mtime alone dates a directory by when it last FOLDED, so a
 * session that folded early and then ran quietly past the retention window would be reaped by a
 * freshly started sibling while still live. Each session therefore refreshes a `.alive` heartbeat
 * in its own dir (see `touchHeartbeat`), which the sweep reads like any other file. The residual
 * edge is a stopped process: it stops heartbeating and can still be reaped.
 */
import { existsSync, readdirSync, rmdirSync, rmSync, statSync, utimesSync, writeFileSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";

/** PipiUI default retention window: 30 days. A spool is a working artifact for the session that made it
 *  (plus later resume), not an archive — Pi's session JSONL keeps the raw payload forever,
 *  so a reaped spool loses only the recall-optimized copy. Reviving genuinely stale sessions is
 *  not a supported workflow; raise CONTEXTFOLD_SPOOL_RETAIN_DAYS if a machine needs one. */
export const SPOOL_RETAIN_DAYS_DEFAULT = 30;
const DAY_MS = 86_400_000;

/** Liveness marker refreshed by a running session; counts as a normal file to the sweep. */
export const HEARTBEAT_FILE = ".alive";
/** Refresh at most this often — the sweep's resolution is days, so an hour is ample. */
export const HEARTBEAT_THROTTLE_MS = 3_600_000;

/** Per-directory last-write times, so the per-turn call is a Map lookup in the common case. */
const lastBeat = new Map<string, number>();

/**
 * Refresh `<spoolDir>/.alive` so the GC sweep can tell a quiet live session from an abandoned one.
 *
 * No-ops when the directory does not exist: a session that has never folded has nothing to
 * protect, and creating the dir here would litter one empty spool per session. Throttled to
 * `HEARTBEAT_THROTTLE_MS`, and fail-open — a read-only spool must not break the turn.
 *
 * @returns true when the heartbeat was written on this call.
 */
export function touchHeartbeat(spoolDir: string, now = Date.now(), throttleMs = HEARTBEAT_THROTTLE_MS): boolean {
	const prev = lastBeat.get(spoolDir);
	if (prev !== undefined && now - prev < throttleMs) return false;
	try {
		if (!existsSync(spoolDir)) return false;
		const file = join(spoolDir, HEARTBEAT_FILE);
		// Create once, then stamp. The stamp is always applied explicitly from `now` rather than
		// left to the filesystem clock, so the sweep and the heartbeat read the same time source
		// (and a fixed-clock test is possible at all).
		if (!existsSync(file)) writeFileSync(file, "context-fold session heartbeat\n");
		const t = new Date(now);
		utimesSync(file, t, t);
		lastBeat.set(spoolDir, now);
		return true;
	} catch {
		// Unwritable spool: without a heartbeat the sweep judges this dir by fold mtimes alone,
		// so a long-quiet session may be reaped early.
		lastBeat.set(spoolDir, now); // do not retry every turn
		return false;
	}
}

/** Test seam: forget throttle state so a test can beat twice without waiting an hour. */
export function resetHeartbeatThrottle(): void {
	lastBeat.clear();
}

/**
 * Resolve CONTEXTFOLD_SPOOL_RETAIN_DAYS to a retention window in ms. `0`/`off`/`false` disables
 * GC entirely (returns 0); unset or unparsable → the default.
 */
export function spoolRetainMsFromEnv(): number {
	const raw = process.env.CONTEXTFOLD_SPOOL_RETAIN_DAYS?.trim().toLowerCase();
	if (raw === "0" || raw === "off" || raw === "false") return 0;
	const n = Number(raw);
	const days = raw && Number.isFinite(n) && n > 0 ? n : SPOOL_RETAIN_DAYS_DEFAULT;
	return days * DAY_MS;
}

export interface SweepResult {
	/** Session ids whose spool dirs were deleted. */
	reaped: string[];
	/** Session spool dirs left in place (fresh, current, or unreadable-kept). */
	kept: number;
}

/**
 * Sweep `<spoolRoot>/<sessionId>/` dirs, deleting any (other than `keepSessionId`'s) whose
 * newest contained file is older than `retainMs`. Freshness is the newest file mtime inside the
 * dir — an actively-appended old session stays; an empty dir ages by its own mtime.
 */
export function sweepSpools(spoolRoot: string, keepSessionId: string, retainMs: number, now = Date.now()): SweepResult {
	const result: SweepResult = { reaped: [], kept: 0 };
	if (retainMs <= 0) return result;

	let entries: Dirent[];
	try {
		entries = readdirSync(spoolRoot, { withFileTypes: true });
	} catch {
		return result; // no spool yet — nothing to do
	}

	for (const ent of entries) {
		if (!ent.isDirectory()) continue;
		if (ent.name === keepSessionId) {
			result.kept++;
			continue;
		}
		const dir = join(spoolRoot, ent.name);
		try {
			let newest = statSync(dir).mtimeMs;
			for (const f of readdirSync(dir)) {
				try {
					const m = statSync(join(dir, f)).mtimeMs;
					if (m > newest) newest = m;
				} catch {
					// raced delete of one file — judge by what remains
				}
			}
			if (now - newest > retainMs) {
				rmSync(dir, { recursive: true, force: true });
				result.reaped.push(ent.name);
			} else {
				result.kept++;
			}
		} catch {
			result.kept++; // unreadable/undeletable → keep, never break the session over GC
		}
	}
	return result;
}

/**
 * Sweep sibling WORKSPACE spool roots (`<sessionsRoot>/<workspace>/spool/`). Pi keys session dirs
 * by workspace, and `sweepSpools` alone only runs for a workspace when a new session starts *in
 * it* — so a workspace that stops being used would retain its last spools forever. Same window as
 * the per-session sweep: one number answers "how long is a spool worth keeping".
 *
 * The current workspace's root is skipped (its own sweep just ran, with the live session's dir
 * protected); live sessions in other workspaces are protected by their hourly heartbeat like any
 * fresh file. Only the `spool/` subdir of a workspace is ever touched, and a root left empty is
 * removed. Fail-open throughout, like everything else in this file.
 */
export function sweepWorkspaceSpools(
	sessionsRoot: string,
	currentSpoolRoot: string,
	retainMs: number,
	now = Date.now(),
): SweepResult {
	const result: SweepResult = { reaped: [], kept: 0 };
	if (retainMs <= 0) return result;

	let entries: Dirent[];
	try {
		entries = readdirSync(sessionsRoot, { withFileTypes: true });
	} catch {
		return result; // no sessions root — nothing to do
	}

	for (const ent of entries) {
		if (!ent.isDirectory()) continue;
		const spoolRoot = join(sessionsRoot, ent.name, "spool");
		try {
			if (resolve(spoolRoot) === resolve(currentSpoolRoot)) continue;
			if (!existsSync(spoolRoot)) continue;
			// No session of ours lives there: keepSessionId "" matches no dir.
			const swept = sweepSpools(spoolRoot, "", retainMs, now);
			result.reaped.push(...swept.reaped.map((sid) => `${ent.name}/${sid}`));
			result.kept += swept.kept;
			if (swept.kept === 0) rmdirSync(spoolRoot); // throws if anything remains — that's the guard
		} catch {
			// unreadable/undeletable/non-empty → leave it; never break a session over housekeeping
		}
	}
	return result;
}
