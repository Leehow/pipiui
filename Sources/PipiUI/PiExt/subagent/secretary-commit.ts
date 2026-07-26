import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type SecretaryDisposition =
	| "cleaned"
	| "retained"
	| "unclassified"
	| "needs-fixer"
	| "needs-user";

export interface SecretaryCommitDisposition {
	item: string;
	disposition: SecretaryDisposition;
	reason?: string;
}

export interface SecretaryCommitInput {
	closeout: "pass" | "needs-action" | "blocked";
	integrationVerify: "pass" | "fail" | "none";
	commitMessage: string;
	paths: string[];
	allRelevantItemsClassified: boolean;
	dispositions: SecretaryCommitDisposition[];
}

export interface SecretaryCommitContext {
	processRole: string | undefined;
	mainCwd: string | undefined;
}

export interface SecretaryCommitResult {
	commit: `created:${string}` | `already-clean:${string}` | `blocked:${string}`;
	committedPaths: string[];
	remainingDirtyPaths: string[];
}

interface GitResult {
	ok: boolean;
	status: number | null;
	stdout: string;
	stderr: string;
}

function git(cwd: string, args: string[]): GitResult {
	const result = spawnSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		maxBuffer: 4 * 1024 * 1024,
	});
	return {
		ok: result.status === 0,
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function nulPaths(value: string): string[] {
	return value.split("\0").filter(Boolean);
}

function dirtyPaths(cwd: string): string[] | null {
	const result = git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
	if (!result.ok) return null;
	const records = nulPaths(result.stdout);
	const paths: string[] = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record.length < 4) continue;
		const status = record.slice(0, 2);
		paths.push(record.slice(3));
		// Porcelain v1 emits a second NUL-delimited path for renames/copies.
		if ((status.includes("R") || status.includes("C")) && index + 1 < records.length) {
			paths.push(records[index + 1]);
			index += 1;
		}
	}
	return [...new Set(paths)].sort();
}

function blocked(reason: string, cwd?: string): SecretaryCommitResult {
	return {
		commit: `blocked:${reason}`,
		committedPaths: [],
		remainingDirtyPaths: cwd ? (dirtyPaths(cwd) ?? []) : [],
	};
}

function canonicalGitRoot(mainCwd: string | undefined): string | null {
	if (!mainCwd || !path.isAbsolute(mainCwd)) return null;
	let canonicalMain: string;
	try {
		canonicalMain = fs.realpathSync.native(mainCwd);
	} catch {
		return null;
	}
	const root = git(canonicalMain, ["rev-parse", "--show-toplevel"]);
	if (!root.ok || !root.stdout.trim()) return null;
	try {
		const canonicalRoot = fs.realpathSync.native(root.stdout.trim());
		return canonicalRoot === canonicalMain ? canonicalMain : null;
	} catch {
		return null;
	}
}

function safeCommitMessage(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed.length > 200 ||
		Buffer.byteLength(trimmed, "utf8") > 500 ||
		/[\u0000-\u001f\u007f]/.test(trimmed)
	) {
		return null;
	}
	return trimmed;
}

function safeManifest(values: unknown): { ok: true; paths: string[] } | { ok: false; reason: string } {
	if (!Array.isArray(values)) return { ok: false, reason: "manifest-not-an-array" };
	const accepted: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string" || !value || value !== value.trim()) {
			return { ok: false, reason: "invalid-manifest-path" };
		}
		if (
			value.includes("\0") ||
			value.includes("\\") ||
			path.posix.isAbsolute(value) ||
			path.win32.isAbsolute(value)
		) {
			return { ok: false, reason: "invalid-manifest-path" };
		}
		const segments = value.split("/");
		if (
			segments.some(
				(segment) =>
					!segment ||
					segment === "." ||
					segment === ".." ||
					segment.toLowerCase() === ".git" ||
					segment.toLowerCase() === ".pi",
			)
		) {
			return { ok: false, reason: "invalid-manifest-path" };
		}
		if (seen.has(value)) return { ok: false, reason: "duplicate-manifest-path" };
		seen.add(value);
		accepted.push(value);
	}
	return { ok: true, paths: accepted };
}

function dispositionsAreFinal(input: SecretaryCommitInput): boolean {
	if (input.allRelevantItemsClassified !== true || !Array.isArray(input.dispositions)) {
		return false;
	}
	return input.dispositions.every(
		(item) =>
			item &&
			typeof item.item === "string" &&
			Boolean(item.item.trim()) &&
			(item.disposition === "cleaned" || item.disposition === "retained"),
	);
}

function exactPathSet(actual: string[], expected: string[]): boolean {
	if (actual.length !== expected.length) return false;
	const left = [...actual].sort();
	const right = [...expected].sort();
	return left.every((value, index) => value === right[index]);
}

function literalPathspec(value: string): string {
	return `:(literal)${value}`;
}

function clearHelperIndex(cwd: string): void {
	// The precondition guarantees the index was empty. `read-tree HEAD` restores only
	// that index state and intentionally leaves every worktree file untouched.
	git(cwd, ["read-tree", "HEAD"]);
}

/**
 * Runtime-owned commit gate for the closeout secretary.
 *
 * Raw Git mutation remains denied by the secretary bash policy. This helper is the
 * sole commit path and owns its narrow staging transaction.
 */
export function runSecretaryCommit(
	input: SecretaryCommitInput,
	context: SecretaryCommitContext,
): SecretaryCommitResult {
	if (context.processRole !== "closeout-secretary") return blocked("wrong-runtime-role");
	const cwd = canonicalGitRoot(context.mainCwd);
	if (!cwd) return blocked("main-cwd-is-not-canonical-git-root");
	if (input.closeout !== "pass") return blocked("closeout-not-pass", cwd);
	if (input.integrationVerify !== "pass") return blocked("integration-verify-not-pass", cwd);
	if (!dispositionsAreFinal(input)) return blocked("dispositions-not-final", cwd);

	const preStaged = git(cwd, ["diff", "--cached", "--name-only", "-z", "--"]);
	if (!preStaged.ok) return blocked("cannot-inspect-index", cwd);
	const preStagedQuiet = git(cwd, ["diff-index", "--cached", "--quiet", "HEAD", "--"]);
	if (preStagedQuiet.status === null || preStagedQuiet.status > 1) {
		return blocked("cannot-inspect-index", cwd);
	}
	if (preStagedQuiet.status === 1 || nulPaths(preStaged.stdout).length > 0) {
		return blocked("pre-staged-changes", cwd);
	}

	const message = safeCommitMessage(input.commitMessage);
	if (!message) return blocked("invalid-commit-message", cwd);

	const manifest = safeManifest(input.paths);
	if (!manifest.ok) return blocked(manifest.reason, cwd);

	const initialDirty = dirtyPaths(cwd);
	if (!initialDirty) return blocked("cannot-inspect-worktree", cwd);
	if (initialDirty.length === 0) {
		const head = git(cwd, ["rev-parse", "HEAD"]);
		if (!head.ok || !head.stdout.trim()) return blocked("cannot-resolve-head", cwd);
		return {
			commit: `already-clean:${head.stdout.trim()}`,
			committedPaths: [],
			remainingDirtyPaths: [],
		};
	}
	if (manifest.paths.length === 0) return blocked("empty-manifest-for-dirty-repository", cwd);

	const pathspecs = manifest.paths.map(literalPathspec);
	const staged = git(cwd, ["add", "--", ...pathspecs]);
	if (!staged.ok) {
		clearHelperIndex(cwd);
		return blocked("stage-failed", cwd);
	}

	const cached = git(cwd, ["diff", "--cached", "--name-only", "-z", "--"]);
	if (!cached.ok || !exactPathSet(nulPaths(cached.stdout), manifest.paths)) {
		clearHelperIndex(cwd);
		return blocked("staged-set-does-not-match-manifest", cwd);
	}
	const checked = git(cwd, ["diff", "--cached", "--check", "--"]);
	if (!checked.ok) {
		clearHelperIndex(cwd);
		return blocked("cached-diff-check-failed", cwd);
	}

	const committed = git(cwd, ["commit", "-m", message, "--", ...pathspecs]);
	if (!committed.ok) {
		clearHelperIndex(cwd);
		return blocked("commit-failed", cwd);
	}
	const head = git(cwd, ["rev-parse", "HEAD"]);
	if (!head.ok || !head.stdout.trim()) {
		return blocked("commit-created-but-head-unavailable", cwd);
	}
	return {
		commit: `created:${head.stdout.trim()}`,
		committedPaths: [...manifest.paths],
		remainingDirtyPaths: dirtyPaths(cwd) ?? [],
	};
}

export function formatSecretaryCommitResult(result: SecretaryCommitResult): string {
	return [
		`commit=${result.commit}`,
		`committed_paths=${JSON.stringify(result.committedPaths)}`,
		`remaining_dirty_paths=${JSON.stringify(result.remainingDirtyPaths)}`,
	].join("\n");
}
