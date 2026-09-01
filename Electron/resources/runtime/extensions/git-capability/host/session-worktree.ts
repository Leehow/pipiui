/**
 * Session-level git worktree creation.
 *
 * Boss sessions get `pipiui/session-<slug>` at `{canonicalRoot}/.pi/worktrees/session-<slug>`.
 * Git execution goes through the worktree adapter; this module owns slug/collision/reuse.
 */

import { mkdir, rm, stat } from "node:fs/promises";
import * as path from "node:path";

import {
	DEFAULT_GIT_TIMEOUT_MS,
	NodeGitWorktreeAdapter,
	runSpawnV1,
	type GitOperationResultV1,
} from "./worktree/adapter.ts";

export const SESSION_WORKTREE_SLUG_MAX = 24;
export const SESSION_WORKTREE_DIR_PREFIX = "session-";
export const SESSION_WORKTREE_BRANCH_PREFIX = "pipiui/session-";
const FALLBACK_SLUG = "untitled";
const MAX_COLLISION_ATTEMPTS = 32;

export type SessionWorktreeExisting = {
	branch: string;
	worktreePath: string;
};

export type SessionWorktreeRequest = {
	canonicalRoot: string;
	sessionId: string;
	sessionTitle?: string;
	/** Recreate/reuse this exact branch+path (sidecar from a previous bind). */
	existing?: SessionWorktreeExisting;
};

export type SessionWorktreeOk = {
	ok: true;
	workspaceCwd: string;
	branch: string;
	worktreePath: string;
};

export type SessionWorktreeErr = {
	ok: false;
	code: "not-git" | "error";
	error: string;
};

export type SessionWorktreeResult = SessionWorktreeOk | SessionWorktreeErr;

function git(cwd: string, args: string[]): Promise<GitOperationResultV1> {
	return runSpawnV1("git", ["-C", cwd, ...args], { timeoutMs: DEFAULT_GIT_TIMEOUT_MS });
}

function gitMessage(result: GitOperationResultV1): string {
	return (result.stderr || result.stdout || result.error || `git exited ${result.exitCode ?? "without a status"}`).trim();
}

async function isDirectory(value: string): Promise<boolean> {
	try {
		return (await stat(value)).isDirectory();
	} catch {
		return false;
	}
}

async function isInsideWorkTree(cwd: string): Promise<boolean> {
	const probe = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	return probe.ok && probe.stdout.trim() === "true";
}

/**
 * Kebab-case a session title into a branch/dir slug.
 * Empty/non-latin titles fall back to a sanitized sessionId, then `untitled`.
 */
export function sessionWorktreeSlug(title: string | undefined | null, sessionId?: string): string {
	const fromTitle = kebabSlice(title ?? "");
	if (fromTitle) return fromTitle;
	const fromId = kebabSlice(sessionId ?? "");
	if (fromId) return fromId;
	return FALLBACK_SLUG;
}

function kebabSlice(raw: string): string {
	const kebab = raw
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!kebab) return "";
	let sliced = kebab.slice(0, SESSION_WORKTREE_SLUG_MAX).replace(/-+$/g, "");
	sliced = sliced.replace(/^[^a-z0-9]+/, "");
	return sliced;
}

export function sessionWorktreeBranch(slug: string): string {
	return `${SESSION_WORKTREE_BRANCH_PREFIX}${slug}`;
}

export function sessionWorktreeDirName(slug: string): string {
	return `${SESSION_WORKTREE_DIR_PREFIX}${slug}`;
}

function suffixedSlug(slug: string, attempt: number): string {
	if (attempt <= 1) return slug;
	return `${slug}-${attempt}`;
}

function isSessionBranch(branch: string | undefined): boolean {
	return typeof branch === "string" && branch.startsWith(SESSION_WORKTREE_BRANCH_PREFIX) && branch.length > SESSION_WORKTREE_BRANCH_PREFIX.length;
}

async function currentBranch(cwd: string, fallback: string): Promise<string> {
	const br = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (br.ok && br.stdout && br.stdout !== "HEAD") return br.stdout;
	return fallback;
}

/**
 * Create or reuse the session worktree. Non-git directories return `not-git` and
 * must not bind. Idempotent: a second call with the same preferred slug reuses
 * the existing tree. Collision (add fails / leftover path) appends `-2`, `-3`, …
 */
export async function ensureSessionWorktree(input: SessionWorktreeRequest): Promise<SessionWorktreeResult> {
	const canonicalRoot = path.resolve(input.canonicalRoot);
	if (!(await isInsideWorkTree(canonicalRoot))) {
		return { ok: false, code: "not-git", error: "not a git repository" };
	}
	const top = await git(canonicalRoot, ["rev-parse", "--show-toplevel"]);
	if (!top.ok || !top.stdout.trim()) {
		return { ok: false, code: "error", error: gitMessage(top) || "git rev-parse --show-toplevel failed" };
	}
	const toplevel = path.resolve(top.stdout.trim());
	const head = await git(toplevel, ["rev-parse", "--verify", "HEAD"]);
	if (!head.ok) {
		return { ok: false, code: "error", error: gitMessage(head) || "HEAD does not resolve" };
	}

	const worktreesRoot = path.join(toplevel, ".pi", "worktrees");
	try {
		await mkdir(worktreesRoot, { recursive: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, code: "error", error: `mkdir .pi/worktrees: ${msg}` };
	}

	const adapter = new NodeGitWorktreeAdapter();

	if (input.existing && isSessionBranch(input.existing.branch) && input.existing.worktreePath) {
		const reused = await restoreExisting(adapter, toplevel, input.existing);
		if (reused.ok || reused.code === "not-git") return reused;
		// Fall through to a fresh slug placement when the recorded path cannot be restored.
	}

	const baseSlug = sessionWorktreeSlug(input.sessionTitle, input.sessionId);
	const listed = await adapter.listRegisteredWorktrees(toplevel);
	const rows = listed.ok ? listed.worktrees : [];

	for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt++) {
		const slug = suffixedSlug(baseSlug, attempt);
		const branch = sessionWorktreeBranch(slug);
		const absPath = path.resolve(worktreesRoot, sessionWorktreeDirName(slug));

		if (await isDirectory(absPath) && (await isInsideWorkTree(absPath))) {
			const actual = await currentBranch(absPath, branch);
			return { ok: true, workspaceCwd: absPath, branch: actual, worktreePath: absPath };
		}

		const attached = rows.find((row) => row.branch === branch && row.path);
		if (attached) {
			const abs = path.resolve(attached.path);
			if (await isInsideWorkTree(abs)) {
				return { ok: true, workspaceCwd: abs, branch, worktreePath: abs };
			}
		}

		if (await isDirectory(absPath)) {
			if (!(await isInsideWorkTree(absPath))) {
				try {
					await rm(absPath, { recursive: true, force: true });
				} catch {
					if (attempt < MAX_COLLISION_ATTEMPTS) continue;
					return { ok: false, code: "error", error: `leftover path is not a worktree: ${absPath}` };
				}
			}
		}

		const branchExists = await git(toplevel, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
		const added = branchExists.ok
			? await adapter.addWorktree(toplevel, absPath, branch, { createBranch: false })
			: await adapter.addWorktree(toplevel, absPath, branch, { createBranch: true, startPoint: "HEAD" });
		if (added.ok) {
			return { ok: true, workspaceCwd: absPath, branch, worktreePath: absPath };
		}
		if (attempt === MAX_COLLISION_ATTEMPTS) {
			return { ok: false, code: "error", error: gitMessage(added) || "git worktree add failed" };
		}
	}

	return { ok: false, code: "error", error: "git worktree add failed" };
}

async function restoreExisting(
	adapter: NodeGitWorktreeAdapter,
	toplevel: string,
	existing: SessionWorktreeExisting,
): Promise<SessionWorktreeResult> {
	const absPath = path.resolve(existing.worktreePath);
	const branch = existing.branch;
	if (await isDirectory(absPath) && (await isInsideWorkTree(absPath))) {
		const actual = await currentBranch(absPath, branch);
		return { ok: true, workspaceCwd: absPath, branch: actual, worktreePath: absPath };
	}
	const listed = await adapter.listRegisteredWorktrees(toplevel);
	if (listed.ok) {
		const hit = listed.worktrees.find((row) => row.branch === branch && row.path);
		if (hit) {
			const abs = path.resolve(hit.path);
			if (await isInsideWorkTree(abs)) {
				return { ok: true, workspaceCwd: abs, branch, worktreePath: abs };
			}
		}
	}
	try {
		await mkdir(path.dirname(absPath), { recursive: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, code: "error", error: `mkdir worktree parent: ${msg}` };
	}
	if (await isDirectory(absPath) && !(await isInsideWorkTree(absPath))) {
		try {
			await rm(absPath, { recursive: true, force: true });
		} catch {
			return { ok: false, code: "error", error: `cannot clear leftover at ${absPath}` };
		}
	}
	const branchExists = await git(toplevel, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
	const added = branchExists.ok
		? await adapter.addWorktree(toplevel, absPath, branch, { createBranch: false })
		: await adapter.addWorktree(toplevel, absPath, branch, { createBranch: true, startPoint: "HEAD" });
	if (!added.ok) return { ok: false, code: "error", error: gitMessage(added) || "git worktree add failed" };
	return { ok: true, workspaceCwd: absPath, branch, worktreePath: absPath };
}
