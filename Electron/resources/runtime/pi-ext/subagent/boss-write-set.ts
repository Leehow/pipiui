/**
 * The Boss's own write set, so the collision machinery can see it.
 *
 * Every mechanism in this runtime for avoiding concurrent-write damage — declared `scope`,
 * overlap warnings, isolated worktrees, merge preflight — was built when the Boss could not
 * write at all. Workers were the only writers, each in its own worktree, and the Boss was
 * structurally incapable of colliding with them. That assumption is now false: the Boss holds
 * the mainline and edits the main checkout directly, while workers still branch from `HEAD`
 * and merge back into it.
 *
 * Two things go wrong, and the second is the dangerous one:
 *
 * 1. The merge fails. Git refuses to overwrite uncommitted local changes, so nothing is lost,
 *    but the worker's finished work is stuck behind an error that reads like a Git problem
 *    rather than a coordination one.
 * 2. The merge succeeds and the result is incoherent. A worker branched from `HEAD` cannot see
 *    the Boss's uncommitted edits, so it may rewrite, against the old version, a function the
 *    Boss is halfway through changing. If the two edits land in different hunks Git merges them
 *    cleanly and reports success. Nothing errors. `preflightMerge` does not catch this either:
 *    it runs `merge-tree` over committed trees, and the working tree is invisible to it.
 *
 * The fix is not new machinery, it is making the Boss a first-class writer in the machinery
 * that exists. Its write set needs no declaration — `git status --porcelain` is authoritative
 * and always current, which is better than a `scope` a model has to remember to pass.
 *
 * Everything here fails open. A dispatch must never be blocked because Git was slow, missing,
 * or in a state this parser did not expect; the worst acceptable outcome is the behaviour we
 * already had before this module existed.
 */
import type { ScopedAgent } from "./scope-overlap.ts";
import { cleanScope, pathsOverlap } from "./scope-overlap.ts";

/**
 * Reserved id for the Boss in overlap reporting. Not a real agentId — it can never be
 * dispatched, resumed or aborted — and the parenthesis keeps it outside the charset a
 * caller-chosen agentId is allowed to use, so it cannot collide with one.
 */
export const BOSS_WRITE_SET_ID = "boss(uncommitted)";

/** Cap on reported paths; a Boss mid-refactor can be holding hundreds and the line is advice. */
const MAX_REPORTED_PATHS = 12;

/**
 * Paths out of `git status --porcelain=v1 -z` (NUL-separated, so no quoting/escaping games).
 *
 * Rename and copy entries carry two NUL-terminated fields — `R  <new>\0<old>\0` — and both
 * sides matter: the Boss is holding the old path as a deletion and the new one as an addition,
 * and a worker touching either would collide.
 */
export function parsePorcelainZ(stdout: string): string[] {
	const out: string[] = [];
	const fields = stdout.split("\0");
	for (let i = 0; i < fields.length; i += 1) {
		const entry = fields[i];
		if (!entry || entry.length < 4) continue;
		const status = entry.slice(0, 2);
		out.push(entry.slice(3));
		// `git status -z` emits the rename source as its own following field.
		if (status.includes("R") || status.includes("C")) {
			const source = fields[i + 1];
			if (source) out.push(source);
			i += 1;
		}
	}
	return cleanScope(out);
}

export type GitRunner = (args: readonly string[]) => { ok: boolean; stdout: string };

/**
 * The Boss's uncommitted write set as a `ScopedAgent`, or null when there is nothing to report
 * — no repository, no main cwd, a Git failure, or a clean tree. Null is the "no constraint"
 * answer everywhere it is consumed.
 */
export function bossWriteSet(mainCwd: string | undefined, run: GitRunner): ScopedAgent | null {
	if (!mainCwd || !mainCwd.trim()) return null;
	let result: { ok: boolean; stdout: string };
	try {
		result = run(["-C", mainCwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
	} catch {
		return null;
	}
	if (!result.ok) return null;
	const scope = parsePorcelainZ(result.stdout);
	return scope.length ? { agentId: BOSS_WRITE_SET_ID, scope } : null;
}

/**
 * `[boss-write-overlap]` lines; empty when nothing overlaps or the Boss tree is clean.
 *
 * Deliberately a different marker and a different remedy from `[subagent-overlap]`. Two workers
 * that overlap are told to couple onto one worker; that advice is wrong here, because one of
 * the two writers is the session itself and cannot be folded into a dispatch. What the Boss can
 * do is keep the file or hand it over — not both at once.
 */
export function formatBossWriteOverlapWarning(
	incoming: readonly ScopedAgent[],
	boss: ScopedAgent | null,
): string {
	if (!boss) return "";
	const held = cleanScope(boss.scope);
	if (held.length === 0) return "";
	const lines: string[] = [];
	for (const item of incoming) {
		const wanted = cleanScope(item.scope);
		if (wanted.length === 0) continue;
		// Report the Boss's own files, not the `left ∩ right` pairs the worker-vs-worker
		// formatter emits: the reader already knows the scope it just passed, and repeating
		// that prefix once per held file buries the only new information in the line.
		const paths = held.filter((file) => wanted.some((prefix) => pathsOverlap(prefix, file)));
		if (paths.length === 0) continue;
		const shown = paths.slice(0, MAX_REPORTED_PATHS);
		const omitted = paths.length - shown.length;
		lines.push(
			`[boss-write-overlap] agentId=${item.agentId} declares scope you are currently editing: ` +
				`${shown.join(", ")}${omitted > 0 ? ` (+${omitted} more)` : ""}. ` +
				"This worker branches from HEAD and cannot see your uncommitted changes, so it will " +
				"work against the old version of those files and its merge will either fail or " +
				"succeed incoherently. Dispatch was not blocked. Either keep these files and give " +
				"the worker a scope that excludes them, or finish and hand them over — not both.",
		);
	}
	return lines.join("\n");
}
