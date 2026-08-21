/**
 * Subagent git worktree placement (isolated worker trees under .pi/worktrees).
 * Pure move from index.ts — behavior preserved.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** Optional worktree isolation metadata reported to the App bridge. */
export interface WorktreePlacement {
	/** Effective spawn cwd (worktree path or original). */
	cwd: string;
	worktreePath?: string;
	worktreeBranch?: string;
	/** Set when required worktree isolation failed. Writable workers must not spawn. */
	worktreeError?: string;
}

/** Env for git helpers: strip desktop capability (same as pipiuiChildProcessEnv default). */
function gitChildEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.PIPIUI_COMPUTER_CAPABILITY;
	return env;
}

/** Sanitize agentId for branch/dir names (filesystem + git ref safe). */
export function safeId(agentId: string): string {
	return agentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "agent";
}

const GIT_ENSURE_TIMEOUT_MS = 30_000;
const LOCAL_GIT_NAME = "PipiUI";
const LOCAL_GIT_EMAIL = "pipiui@local";
const LOCAL_INITIAL_COMMIT_MESSAGE = "PipiUI: local initial commit";
const MINIMAL_GITIGNORE = ["node_modules/", "dist/", ".DS_Store", ".env", ".env.*", ".pi/", ""].join("\n");
/** Extra pathspec so an existing `.gitignore` cannot smuggle `.env` / `.pi` into the first commit. */
const UNBORN_ADD_PATHSPEC = [".", ":(exclude).env", ":(exclude).env.*", ":(exclude).pi/"];

export function gitSpawnSync(
	args: string[],
	cwd?: string,
	timeoutMs?: number,
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		shell: false,
		env: gitChildEnv(),
		...(timeoutMs ? { timeout: timeoutMs } : {}),
	});
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	const stderr = typeof result.stderr === "string" ? result.stderr : "";
	return {
		ok: result.status === 0 && !result.error,
		stdout: stdout.trim(),
		stderr: (stderr || result.error?.message || "").trim(),
		status: result.status,
	};
}


/**
 * Parse `git worktree list --porcelain` into { path, branch? } rows.
 * branch is short name (refs/heads/ stripped); detached → branch undefined.
 */
export function parseWorktreeListPorcelain(output: string): Array<{ path: string; branch?: string }> {
	const results: Array<{ path: string; branch?: string }> = [];
	let currentPath: string | undefined;
	let currentBranch: string | undefined;

	const flush = () => {
		if (!currentPath) {
			currentPath = undefined;
			currentBranch = undefined;
			return;
		}
		results.push({ path: currentPath, branch: currentBranch });
		currentPath = undefined;
		currentBranch = undefined;
	};

	for (const raw of output.split(/\r?\n/)) {
		const line = raw;
		if (line.startsWith("worktree ")) {
			flush();
			currentPath = line.slice("worktree ".length);
		} else if (line.startsWith("branch ")) {
			let ref = line.slice("branch ".length).trim();
			if (ref.startsWith("refs/heads/")) ref = ref.slice("refs/heads/".length);
			currentBranch = ref || undefined;
		} else if (line === "detached") {
			currentBranch = undefined;
		} else if (line.trim() === "") {
			flush();
		}
	}
	flush();
	return results;
}

function headResolves(cwd: string): boolean {
	const head = gitSpawnSync(["-C", cwd, "rev-parse", "--verify", "HEAD"]);
	return head.ok && Boolean(head.stdout);
}

/**
 * Split “plain folder” from “git probe failed”.
 * `true` → isolate; explicit not-a-repo → shared cwd; anything else → fail closed.
 */
export function classifyInsideWorkTree(probe: {
	ok: boolean;
	stdout: string;
	stderr: string;
}): "inside" | "outside" | "error" {
	if (probe.ok && probe.stdout === "true") return "inside";
	if (probe.ok && probe.stdout === "false") return "outside";
	const text = `${probe.stderr}\n${probe.stdout}`;
	if (/not a git repository/i.test(text)) return "outside";
	return "error";
}

function writeMinimalGitignore(root: string): { ok: boolean; error?: string } {
	const gitignore = path.join(root, ".gitignore");
	if (fs.existsSync(gitignore)) return { ok: true };
	try {
		fs.writeFileSync(gitignore, MINIMAL_GITIGNORE);
		return { ok: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `write .gitignore: ${msg}` };
	}
}

/**
 * Fill an unborn HEAD so `git worktree add … HEAD` works.
 * GitHub is not required: never add origin, never push, never clone, never touch remotes.
 * Plain (non-git) folders are a no-op — do not `git init`. Repos with HEAD are unchanged.
 * Duplicate of host `ensureLocalGitForWorktrees` — packages cannot share this helper.
 */
export function ensureResolvableHead(cwd: string): { ok: boolean; error?: string } {
	const inside = gitSpawnSync(["-C", cwd, "rev-parse", "--is-inside-work-tree"]);
	if (!inside.ok || inside.stdout !== "true") return { ok: true };
	if (headResolves(cwd)) return { ok: true };

	const top = gitSpawnSync(["-C", cwd, "rev-parse", "--show-toplevel"]);
	const root = top.ok && top.stdout ? path.resolve(top.stdout) : cwd;
	if (headResolves(root)) return { ok: true };

	const gitignore = writeMinimalGitignore(root);
	if (!gitignore.ok) return gitignore;

	const add = gitSpawnSync(
		["-C", root, "add", "-A", "--", ...UNBORN_ADD_PATHSPEC],
		undefined,
		GIT_ENSURE_TIMEOUT_MS,
	);
	if (!add.ok) return { ok: false, error: add.stderr || "git add failed" };

	const porcelain = gitSpawnSync(["-C", root, "status", "--porcelain"], undefined, GIT_ENSURE_TIMEOUT_MS);
	const empty = !porcelain.stdout;
	const commit = gitSpawnSync(
		[
			"-C",
			root,
			"-c",
			`user.name=${LOCAL_GIT_NAME}`,
			"-c",
			`user.email=${LOCAL_GIT_EMAIL}`,
			"commit",
			...(empty ? ["--allow-empty"] : []),
			"-m",
			LOCAL_INITIAL_COMMIT_MESSAGE,
		],
		undefined,
		GIT_ENSURE_TIMEOUT_MS,
	);
	if (!commit.ok) return { ok: false, error: commit.stderr || "git commit failed" };
	return { ok: true };
}

/**
 * Default: create an isolated git worktree under <toplevel>/.pi/worktrees/<safeId>
 * on branch pipiui/<safeId> so non-read-only subagents write without polluting the main dirty tree.
 * Read-only roles run directly in their fallback cwd and never create a worktree or branch.
 *
 * Resume / continue same agentId:
 * - Reuses preferred path when it is already a valid git worktree.
 * - If branch `pipiui/<safeId>` is already checked out in *any* registered worktree
 *   (even when preferred path differs), reuses that path so续作 lands on the same tree.
 * - The process is a fresh spawn, but a non-read-only worker resumes its own stored
 *   conversation (see agentSessionDir), so cwd, branch AND context all continue.
 *
 * Off when:
 * - agent is read-only
 * - PIPIUI_WORKTREE=0
 * - caller passed explicit cwd (respect; do not wrap)
 * - effective cwd is not a git work tree (user decision: do not silently `git init`;
 *   writable workers run in the project directory, same as PIPIUI_WORKTREE=0).
 *   A git probe that is not a clear not-a-repo answer fails closed.
 *
 * TS never auto remove / commit / merge (Swift SubagentStore owns lifecycle).
 * On failure creating required isolation, return worktreeError; runSingleAgent fails closed
 * before spawning a child. Read-only, explicit-cwd and explicit PIPIUI_WORKTREE=0 paths remain
 * deliberate shared-cwd semantics rather than isolation failures.
 * TS end handlers do not merge. Swift SubagentStore auto-merges a writable worker when it
 * ends ok with verifyExit==0 (or verifyExit absent); verifyExit≠0 keeps pendingReview.
 * failed/aborted/interrupted writable workers → keep pendingReview for续作; GUI merge/discard remains as fallback.
 */
export function resolveSubagentWorktree(opts: {
	agentId: string;
	defaultCwd: string;
	explicitCwd?: string;
	readOnly: boolean;
	policy: { worktree: "isolated" | "direct" | "main-session" };
	/** App-owned session root; was module opts.mainCwd. */
	mainCwd?: string;
	/** Bundled general-purpose isolation cannot be disabled by process-global legacy state. */
	allowEnvironmentOptOut?: boolean;
}): WorktreePlacement {
	const fallbackCwd = opts.explicitCwd ?? opts.defaultCwd;

	if (opts.policy.worktree === "main-session") {
		// Ignore caller cwd and nested worker cwd: the trusted bundled secretary is a
		// session-management role and must not manufacture another branch/worktree.
		return { cwd: path.resolve(opts.mainCwd || opts.defaultCwd) };
	}
	// Declarative `worktree: none` is intentionally less privileged than the
	// main-session role: it merely respects the caller/default cwd and never
	// receives the secretary role or its write/commit policy exemptions.
	if (opts.policy.worktree === "direct") return { cwd: fallbackCwd };
	if (opts.readOnly || (opts.allowEnvironmentOptOut !== false && process.env.PIPIUI_WORKTREE === "0")) {
		return { cwd: fallbackCwd };
	}
	// Explicit cwd from tool caller → respect, no worktree wrap
	if (opts.explicitCwd) {
		return { cwd: opts.explicitCwd };
	}

	const effectiveCwd = opts.defaultCwd;
	const inside = gitSpawnSync(["-C", effectiveCwd, "rev-parse", "--is-inside-work-tree"]);
	const kind = classifyInsideWorkTree(inside);
	if (kind === "outside") {
		// User decision: a non-git project skips isolation. Do not silently
		// create a git repo, `.gitignore`, or worktree — run in the folder.
		return { cwd: effectiveCwd };
	}
	if (kind === "error") {
		return {
			cwd: effectiveCwd,
			worktreeError:
				inside.stderr || "git rev-parse --is-inside-work-tree failed; refusing shared-cwd fallback",
		};
	}
	// Unborn HEAD (`git init` with no commit) cannot `worktree add … HEAD`.
	// Fill HEAD locally; GitHub is not required. Failure stays fail-closed.
	const head = ensureResolvableHead(effectiveCwd);
	if (!head.ok) {
		return {
			cwd: effectiveCwd,
			worktreeError: head.error || "unborn HEAD could not be committed; refusing shared-cwd fallback",
		};
	}

	const top = gitSpawnSync(["-C", effectiveCwd, "rev-parse", "--show-toplevel"]);
	if (!top.ok || !top.stdout) {
		return {
			cwd: effectiveCwd,
			worktreeError: top.stderr || "git rev-parse --show-toplevel failed",
		};
	}
	const toplevel = path.resolve(top.stdout);
	const id = safeId(opts.agentId);
	const worktreesRoot = path.join(toplevel, ".pi", "worktrees");
	try {
		fs.mkdirSync(worktreesRoot, { recursive: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { cwd: effectiveCwd, worktreeError: `mkdir .pi/worktrees: ${msg}` };
	}

	const preferredPath = path.resolve(worktreesRoot, id);
	const preferredBranch = `pipiui/${id}`;

	// 1) Reuse existing directory if it is already a valid worktree
	if (fs.existsSync(preferredPath)) {
		const reuse = gitSpawnSync(["-C", preferredPath, "rev-parse", "--is-inside-work-tree"]);
		if (reuse.ok && reuse.stdout === "true") {
			const br = gitSpawnSync(["-C", preferredPath, "rev-parse", "--abbrev-ref", "HEAD"]);
			const branch =
				br.ok && br.stdout && br.stdout !== "HEAD" ? br.stdout : preferredBranch;
			return {
				cwd: preferredPath,
				worktreePath: preferredPath,
				worktreeBranch: branch,
			};
		}
	}

	// 2) Resume by branch: if pipiui/<id> is already attached somewhere in worktree list, reuse that path
	//    (even when preferred path differs — e.g. previous alt path/suffix).
	const listOut = gitSpawnSync(["-C", toplevel, "worktree", "list", "--porcelain"], toplevel);
	if (listOut.ok && listOut.stdout) {
		const rows = parseWorktreeListPorcelain(listOut.stdout);
		const hit = rows.find((r) => r.branch === preferredBranch && r.path);
		if (hit) {
			const abs = path.resolve(hit.path);
			const still = gitSpawnSync(["-C", abs, "rev-parse", "--is-inside-work-tree"]);
			if (still.ok && still.stdout === "true") {
				return {
					cwd: abs,
					worktreePath: abs,
					worktreeBranch: preferredBranch,
				};
			}
		}
		// Also match any pipiui/<id>-* suffix branch already checked out (prior collision rename)
		const prefix = `pipiui/${id}`;
		const prefixed = rows.find(
			(r) =>
				r.branch &&
				(r.branch === prefix || r.branch.startsWith(`${prefix}-`)) &&
				r.path,
		);
		if (prefixed && prefixed.branch) {
			const abs = path.resolve(prefixed.path);
			const still = gitSpawnSync(["-C", abs, "rev-parse", "--is-inside-work-tree"]);
			if (still.ok && still.stdout === "true") {
				return {
					cwd: abs,
					worktreePath: abs,
					worktreeBranch: prefixed.branch,
				};
			}
		}
	}

	const tryAdd = (absPath: string, branch: string): { ok: boolean; error: string } => {
		const r = gitSpawnSync(
			["-C", toplevel, "worktree", "add", "-b", branch, absPath, "HEAD"],
			toplevel,
		);
		if (r.ok) return { ok: true, error: "" };
		return { ok: false, error: r.stderr || r.stdout || "git worktree add failed" };
	};

	// 3) Create new worktree on preferred path/branch
	let add = tryAdd(preferredPath, preferredBranch);
	if (add.ok) {
		return {
			cwd: preferredPath,
			worktreePath: preferredPath,
			worktreeBranch: preferredBranch,
		};
	}

	// Branch (or path) collision → unique suffix
	const suffix = Date.now().toString(36).slice(-6);
	const altBranch = `pipiui/${id}-${suffix}`;
	// Clean a failed non-git leftover at preferred path when possible
	if (fs.existsSync(preferredPath)) {
		const stillGit = gitSpawnSync(["-C", preferredPath, "rev-parse", "--is-inside-work-tree"]);
		if (!(stillGit.ok && stillGit.stdout === "true")) {
			try {
				fs.rmSync(preferredPath, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}

	// Spec: worktree add ${absPath} -b pipiui/${id}-${suffix} HEAD
	const altAddSamePath = gitSpawnSync(
		["-C", toplevel, "worktree", "add", preferredPath, "-b", altBranch, "HEAD"],
		toplevel,
	);
	if (altAddSamePath.ok) {
		return {
			cwd: preferredPath,
			worktreePath: preferredPath,
			worktreeBranch: altBranch,
		};
	}

	const altPath = path.resolve(worktreesRoot, `${id}-${suffix}`);
	add = tryAdd(altPath, altBranch);
	if (add.ok) {
		return {
			cwd: altPath,
			worktreePath: altPath,
			worktreeBranch: altBranch,
		};
	}

	const errParts = [add.error, altAddSamePath.stderr || altAddSamePath.stdout]
		.filter(Boolean)
		.join("; ");
	return {
		cwd: effectiveCwd,
		worktreeError: errParts || "git worktree add failed; refusing shared-cwd fallback",
	};
}
