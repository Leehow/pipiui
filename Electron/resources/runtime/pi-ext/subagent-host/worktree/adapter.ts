/** Safe, shell-free Git adapter for portable worktree finalization. */

import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import * as path from "node:path";

import type { WorktreeFinalizationInputV1 } from "./schema.ts";

export type GitOperationResultV1 = {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	/** True only when this service's bounded spawn deadline expired. */
	timedOut?: boolean;
	/** True only when the supplied AbortSignal requested this service's child stop. */
	aborted?: boolean;
	/** Process signal reported by Node when available. */
	signal?: string | null;
	error?: string;
};

/** Local Git commands are expected to be quick; a hung hook must not hold main forever. */
export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
/** Swift's post-merge runner uses a 120-second verify deadline. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;
export const DEFAULT_SPAWN_TERMINATION_GRACE_MS = 1_000;

export type SpawnOptionsV1 = {
	cwd?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	terminationGraceMs?: number;
};

export type NodeGitWorktreeAdapterOptionsV1 = {
	/** Test seam / host override; production defaults to the Git executable on PATH. */
	gitExecutable?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	terminationGraceMs?: number;
};

export type GitStatusSnapshotV1 = {
	isRepo: boolean;
	branch?: string;
	head?: string;
	stagedPaths: string[];
	unstagedPaths: string[];
	untrackedPaths: string[];
	conflictPaths: string[];
	dangerousOperations: string[];
	pathsKnown: boolean;
	errors: string[];
};

export type RegisteredGitWorktreeV1 = {
	path: string;
	branch?: string;
};

export type GitWorktreeInspectionV1 = {
	main: GitStatusSnapshotV1;
	worktree: GitStatusSnapshotV1;
	registeredWorktrees: RegisteredGitWorktreeV1[];
	registeredWorktreePath?: string;
	branchExists: boolean;
	branchHead?: string;
	branchIsAncestorOfMain?: boolean;
	workerBranchChangedPaths?: string[];
	errors: string[];
};

export type GitBranchCleanupDispositionV1 =
	| "deleted"
	| "already-absent"
	| "retained-non-internal"
	| "retained-registered-worktree"
	| "retained-unique-commits"
	| "blocked"
	| "failed";

export type GitBranchCleanupResultV1 = {
	disposition: GitBranchCleanupDispositionV1;
	branch: string;
	registeredWorktreePath?: string;
	message: string;
};

export type GitWorktreeListResultV1 = {
	ok: boolean;
	worktrees: RegisteredGitWorktreeV1[];
	error?: string;
};

/**
 * Adapter boundary for Electron main. It owns Git only; scheduling, process
 * supervision, and persistence remain above it. Every mutating method is
 * called only after the service's pure policy permits it.
 */
export type GitMergeAttestationV1 = {
	agentId: string;
	runId: string;
};

export interface GitWorktreeAdapter {
	repositoryKey(mainCwd: string): Promise<string>;
	inspect(input: WorktreeFinalizationInputV1): Promise<GitWorktreeInspectionV1>;
	merge(mainCwd: string, branch: string, attestation?: GitMergeAttestationV1): Promise<GitOperationResultV1>;
	/** Optional: accident-recovery checkpoint before merge. */
	writeCheckpointRef?(mainCwd: string, agentId: string, sha: string): Promise<GitOperationResultV1>;
	/** Optional: local-only merge audit note. Failures must not block finalization. */
	addAuditNote?(mainCwd: string, commitSha: string, message: string): Promise<GitOperationResultV1>;
	removeWorktree(mainCwd: string, worktreePath: string): Promise<GitOperationResultV1>;
	cleanupMergedBranch(input: {
		mainCwd: string;
		branch: string;
		expectedWorktreePath?: string;
	}): Promise<GitBranchCleanupResultV1>;
	/** Optional listing seam used by leftover sweep; finalize-only fakes may omit it. */
	listRegisteredWorktrees?(mainCwd: string): Promise<GitWorktreeListResultV1>;
	repositoryToplevel?(mainCwd: string): Promise<string | undefined>;
}

type ParsedStatusV1 = {
	stagedPaths: string[];
	unstagedPaths: string[];
	untrackedPaths: string[];
	conflictPaths: string[];
};

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const OUTPUT_LIMIT = 64 * 1024;

function pushTail(current: string, chunk: Buffer | string): string {
	const next = current + chunk.toString();
	return next.length > OUTPUT_LIMIT ? next.slice(-OUTPUT_LIMIT) : next;
}

function operationMessage(result: GitOperationResultV1): string {
	if (result.timedOut || result.aborted) {
		return (result.error || (result.timedOut ? "Git command timed out" : "Git command was aborted")).trim();
	}
	return (result.stderr || result.stdout || result.error || `git exited ${result.exitCode ?? "without a status"}`).trim();
}

function safeBranch(branch: string): boolean {
	return Boolean(branch.trim()) && !branch.startsWith("-") && !/[\u0000-\u001f]/.test(branch);
}

/** Ref-safe agent id for `refs/pipiui/checkpoints/<id>`. */
export function checkpointRefNameV1(agentId: string): string {
	const safe = agentId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
	return `refs/pipiui/checkpoints/${safe || "unknown"}`;
}

export function mergeCommitMessageV1(branch: string, attestation?: GitMergeAttestationV1): string {
	const body = `Merge branch '${branch}'`;
	if (!attestation) return body;
	return `${body}\n\nPipiUI-Agent: ${attestation.agentId}\nPipiUI-Run: ${attestation.runId}\n`;
}

function safeAbsolutePath(value: string): boolean {
	return path.isAbsolute(value) && Boolean(value.trim()) && !value.startsWith("-") && !/[\u0000]/.test(value);
}

async function exists(value: string): Promise<boolean> {
	try {
		await access(value);
		return true;
	} catch {
		return false;
	}
}

/** Parse `git worktree list --porcelain` without trusting human display output. */
export function parseWorktreeListPorcelainV1(output: string): RegisteredGitWorktreeV1[] {
	const rows: RegisteredGitWorktreeV1[] = [];
	let currentPath: string | undefined;
	let currentBranch: string | undefined;
	const flush = (): void => {
		if (currentPath) rows.push({ path: currentPath, ...(currentBranch ? { branch: currentBranch } : {}) });
		currentPath = undefined;
		currentBranch = undefined;
	};
	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith("worktree ")) {
			flush();
			currentPath = line.slice("worktree ".length);
		} else if (line.startsWith("branch ")) {
			let branch = line.slice("branch ".length).trim();
			if (branch.startsWith("refs/heads/")) branch = branch.slice("refs/heads/".length);
			currentBranch = branch || undefined;
		} else if (!line.trim()) {
			flush();
		}
	}
	flush();
	return rows;
}

/** Parse porcelain v1 `-z`, preserving both sides of rename/copy records. */
export function parsePorcelainV1Z(output: string): ParsedStatusV1 {
	const stagedPaths = new Set<string>();
	const unstagedPaths = new Set<string>();
	const untrackedPaths = new Set<string>();
	const conflictPaths = new Set<string>();
	const records = output.split("\0");
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record || record.length < 3) continue;
		const x = record[0];
		const y = record[1];
		const code = `${x}${y}`;
		const filePath = record.slice(3);
		const paths = [filePath];
		if ((x === "R" || x === "C" || y === "R" || y === "C") && records[index + 1] !== undefined) {
			paths.push(records[index + 1]);
			index += 1;
		}
		if (x === "?" && y === "?") {
			for (const item of paths) if (item) untrackedPaths.add(item);
			continue;
		}
		if (CONFLICT_CODES.has(code)) {
			for (const item of paths) if (item) conflictPaths.add(item);
			continue;
		}
		if (x !== " " && x !== "?" && x !== "!") {
			for (const item of paths) if (item) stagedPaths.add(item);
		}
		if (y !== " " && y !== "?" && y !== "!") {
			for (const item of paths) if (item) unstagedPaths.add(item);
		}
	}
	return {
		stagedPaths: [...stagedPaths].sort(),
		unstagedPaths: [...unstagedPaths].sort(),
		untrackedPaths: [...untrackedPaths].sort(),
		conflictPaths: [...conflictPaths].sort(),
	};
}

export function overlappingGitPathsV1(left: readonly string[], right: readonly string[]): string[] {
	const rightPaths = new Set(right);
	return [...new Set(left.filter((item) => rightPaths.has(item)))].sort();
}

/** Canonical enough for registry matching; non-existent paths deliberately retain their lexical identity. */
export async function canonicalGitPathV1(value: string): Promise<string> {
	const resolved = path.resolve(value);
	try {
		return await realpath(resolved);
	} catch {
		return resolved;
	}
}

/**
 * Default Node adapter. Every Git invocation goes through `spawn("git", argv,
 * { shell: false })`; it never builds a shell command string.
 */
export class NodeGitWorktreeAdapter implements GitWorktreeAdapter {
	private readonly gitExecutable: string;
	private readonly timeoutMs: number;
	private readonly signal?: AbortSignal;
	private readonly terminationGraceMs?: number;

	constructor(options: NodeGitWorktreeAdapterOptionsV1 = {}) {
		this.gitExecutable = options.gitExecutable ?? "git";
		this.timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
		this.signal = options.signal;
		this.terminationGraceMs = options.terminationGraceMs;
	}

	async repositoryKey(mainCwd: string): Promise<string> {
		if (!safeAbsolutePath(mainCwd)) return path.resolve(mainCwd);
		const result = await this.runGit(mainCwd, ["rev-parse", "--git-common-dir"]);
		if (!result.ok || !result.stdout.trim()) return path.resolve(mainCwd);
		const commonDir = result.stdout.trim();
		return canonicalGitPathV1(path.isAbsolute(commonDir) ? commonDir : path.resolve(mainCwd, commonDir));
	}

	async inspect(input: WorktreeFinalizationInputV1): Promise<GitWorktreeInspectionV1> {
		const [main, worktree] = await Promise.all([
			this.inspectRepository(input.mainCwd),
			this.inspectRepository(input.worktree.path),
		]);
		const errors = [...main.errors, ...worktree.errors];
		let registeredWorktrees: RegisteredGitWorktreeV1[] = [];
		let registeredWorktreePath: string | undefined;
		let branchExists = false;
		let branchHead: string | undefined;
		let branchIsAncestorOfMain: boolean | undefined;
		let workerBranchChangedPaths: string[] | undefined;

		if (!main.isRepo) {
			return { main, worktree, registeredWorktrees, branchExists, errors };
		}
		if (!safeBranch(input.worktree.branch)) {
			errors.push("worktree branch is invalid");
			return { main, worktree, registeredWorktrees, branchExists, errors };
		}
		const branchRef = `refs/heads/${input.worktree.branch}`;
		const [list, ref, refHead] = await Promise.all([
			this.runGit(input.mainCwd, ["worktree", "list", "--porcelain"]),
			this.runGit(input.mainCwd, ["show-ref", "--verify", "--quiet", branchRef]),
			this.runGit(input.mainCwd, ["rev-parse", "--verify", branchRef]),
		]);
		if (list.ok) {
			registeredWorktrees = parseWorktreeListPorcelainV1(list.stdout);
			const expected = await canonicalGitPathV1(input.worktree.path);
			for (const row of registeredWorktrees) {
				if (row.branch !== input.worktree.branch) continue;
				if (await canonicalGitPathV1(row.path) === expected) {
					registeredWorktreePath = row.path;
					break;
				}
			}
		} else {
			errors.push(`cannot read registered worktrees: ${operationMessage(list)}`);
		}
		branchExists = ref.ok;
		if (!ref.ok && ref.exitCode !== 1) errors.push(`cannot inspect worker branch: ${operationMessage(ref)}`);
		if (refHead.ok) branchHead = refHead.stdout.trim() || undefined;
		else if (refHead.exitCode !== 128 && refHead.exitCode !== 1) errors.push(`cannot resolve worker branch HEAD: ${operationMessage(refHead)}`);

		if (branchExists) {
			const [ancestor, changed] = await Promise.all([
				this.runGit(input.mainCwd, ["merge-base", "--is-ancestor", input.worktree.branch, "HEAD"]),
				this.runGit(input.mainCwd, ["diff", "--no-renames", "--name-only", "-z", `HEAD...${input.worktree.branch}`]),
			]);
			if (ancestor.ok) branchIsAncestorOfMain = true;
			else if (ancestor.exitCode === 1) branchIsAncestorOfMain = false;
			else errors.push(`cannot compare worker branch ancestry: ${operationMessage(ancestor)}`);
			if (changed.ok) {
				workerBranchChangedPaths = changed.stdout.split("\0").filter(Boolean).sort();
			} else {
				errors.push(`cannot inspect worker branch changes: ${operationMessage(changed)}`);
			}
		}
		return {
			main,
			worktree,
			registeredWorktrees,
			...(registeredWorktreePath ? { registeredWorktreePath } : {}),
			branchExists,
			...(branchHead ? { branchHead } : {}),
			...(branchIsAncestorOfMain !== undefined ? { branchIsAncestorOfMain } : {}),
			...(workerBranchChangedPaths ? { workerBranchChangedPaths } : {}),
			errors,
		};
	}

	async listRegisteredWorktrees(mainCwd: string): Promise<GitWorktreeListResultV1> {
		if (!safeAbsolutePath(mainCwd)) return { ok: false, worktrees: [], error: "repository path is invalid" };
		const list = await this.runGit(mainCwd, ["worktree", "list", "--porcelain"]);
		if (!list.ok) return { ok: false, worktrees: [], error: operationMessage(list) };
		return { ok: true, worktrees: parseWorktreeListPorcelainV1(list.stdout) };
	}

	async repositoryToplevel(mainCwd: string): Promise<string | undefined> {
		if (!safeAbsolutePath(mainCwd)) return undefined;
		const result = await this.runGit(mainCwd, ["rev-parse", "--show-toplevel"]);
		if (!result.ok || !result.stdout.trim()) return undefined;
		const top = result.stdout.trim();
		return canonicalGitPathV1(path.isAbsolute(top) ? top : path.resolve(mainCwd, top));
	}

	/**
	 * Merge with an explicit message so trailers survive. Author/committer stay the
	 * main-repo identity; we only add `PipiUI-Agent` / `PipiUI-Run` trailers.
	 */
	merge(mainCwd: string, branch: string, attestation?: GitMergeAttestationV1): Promise<GitOperationResultV1> {
		if (!safeBranch(branch)) return Promise.resolve(invalidOperation("branch is invalid"));
		const message = mergeCommitMessageV1(branch, attestation);
		return this.runGit(mainCwd, ["merge", "--no-ff", "-m", message, branch]);
	}

	/**
	 * Accident-recovery anchor: `git reset --hard refs/pipiui/checkpoints/<agentId>`
	 * restores main to the pre-merge SHA captured by slice 1.
	 */
	writeCheckpointRef(mainCwd: string, agentId: string, sha: string): Promise<GitOperationResultV1> {
		const ref = checkpointRefNameV1(agentId);
		if (!sha.trim() || !/^[0-9a-fA-F]{7,64}$/.test(sha.trim())) {
			return Promise.resolve(invalidOperation("checkpoint sha is invalid"));
		}
		return this.runGit(mainCwd, ["update-ref", ref, sha.trim()]);
	}

	/**
	 * Local-only audit. GitHub does not render notes; default clone/fetch does not
	 * carry `refs/notes/*`. Cross-machine needs an explicit
	 * `git push origin refs/notes/pipiui`. This adapter never auto-pushes.
	 * `-f` keeps retries idempotent.
	 */
	addAuditNote(mainCwd: string, commitSha: string, message: string): Promise<GitOperationResultV1> {
		if (!commitSha.trim() || !/^[0-9a-fA-F]{7,64}$/.test(commitSha.trim())) {
			return Promise.resolve(invalidOperation("note commit sha is invalid"));
		}
		return this.runGit(mainCwd, ["notes", "--ref=pipiui", "add", "-f", "-m", message, commitSha.trim()]);
	}

	/** Non-force only: dirty registered worktrees remain intact. */
	removeWorktree(mainCwd: string, worktreePath: string): Promise<GitOperationResultV1> {
		if (!safeAbsolutePath(worktreePath)) return Promise.resolve(invalidOperation("worktree path is invalid"));
		return this.runGit(mainCwd, ["worktree", "remove", worktreePath]);
	}

	/**
	 * The sole automatic branch deletion path. It requires runtime ownership,
	 * no registered worktree, and reachability from main HEAD, then uses the
	 * non-force branch deletion command.
	 */
	async cleanupMergedBranch(input: {
		mainCwd: string;
		branch: string;
		expectedWorktreePath?: string;
	}): Promise<GitBranchCleanupResultV1> {
		const { mainCwd, branch } = input;
		if (!safeBranch(branch)) return { disposition: "blocked", branch, message: "branch is invalid" };
		const main = await this.inspectRepository(mainCwd);
		if (!main.isRepo) return { disposition: "blocked", branch, message: "main cwd is not a readable Git repository" };
		const branchRef = `refs/heads/${branch}`;
		const existsResult = await this.runGit(mainCwd, ["show-ref", "--verify", "--quiet", branchRef]);
		if (!existsResult.ok) {
			if (existsResult.exitCode === 1) return { disposition: "already-absent", branch, message: "branch is already absent" };
			return { disposition: "blocked", branch, message: `cannot inspect branch: ${operationMessage(existsResult)}` };
		}
		const list = await this.runGit(mainCwd, ["worktree", "list", "--porcelain"]);
		if (!list.ok) return { disposition: "blocked", branch, message: `cannot read registered worktrees: ${operationMessage(list)}` };
		const registration = parseWorktreeListPorcelainV1(list.stdout).find((row) => row.branch === branch);
		if (registration) {
			return {
				disposition: "retained-registered-worktree",
				branch,
				registeredWorktreePath: registration.path,
				message: "branch remains registered to a worktree",
			};
		}
		if (!branch.startsWith("pipiui/")) {
			return { disposition: "retained-non-internal", branch, message: "branch is not runtime-owned" };
		}
		const ancestor = await this.runGit(mainCwd, ["merge-base", "--is-ancestor", branch, "HEAD"]);
		if (!ancestor.ok) {
			if (ancestor.exitCode === 1) {
				return { disposition: "retained-unique-commits", branch, message: "branch has commits not reachable from main HEAD" };
			}
			return { disposition: "blocked", branch, message: `cannot prove branch is integrated: ${operationMessage(ancestor)}` };
		}
		const deleted = await this.runGit(mainCwd, ["branch", "-d", branch]);
		if (!deleted.ok) return { disposition: "failed", branch, message: `non-force branch deletion failed: ${operationMessage(deleted)}` };
		return { disposition: "deleted", branch, message: "integrated runtime-owned branch deleted" };
	}

	private async inspectRepository(cwd: string): Promise<GitStatusSnapshotV1> {
		const empty = (): GitStatusSnapshotV1 => ({
			isRepo: false,
			stagedPaths: [],
			unstagedPaths: [],
			untrackedPaths: [],
			conflictPaths: [],
			dangerousOperations: [],
			pathsKnown: false,
			errors: [],
		});
		if (!safeAbsolutePath(cwd)) {
			const result = empty();
			result.errors.push("repository path is invalid");
			return result;
		}
		const inside = await this.runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
		if (!inside.ok || inside.stdout.trim() !== "true") {
			const result = empty();
			result.errors.push(`not a readable Git worktree: ${operationMessage(inside)}`);
			return result;
		}
		const [branch, head, status, operations] = await Promise.all([
			this.runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
			this.runGit(cwd, ["rev-parse", "--verify", "HEAD"]),
			this.runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
			this.dangerousOperations(cwd),
		]);
		const errors: string[] = [];
		if (!branch.ok) errors.push(`cannot read branch: ${operationMessage(branch)}`);
		if (!head.ok) errors.push(`cannot read HEAD: ${operationMessage(head)}`);
		if (!status.ok) errors.push(`cannot read worktree status: ${operationMessage(status)}`);
		const parsed = status.ok ? parsePorcelainV1Z(status.stdout) : {
			stagedPaths: [], unstagedPaths: [], untrackedPaths: [], conflictPaths: [],
		};
		return {
			isRepo: true,
			...(branch.ok && branch.stdout.trim() && branch.stdout.trim() !== "HEAD" ? { branch: branch.stdout.trim() } : {}),
			...(head.ok && head.stdout.trim() ? { head: head.stdout.trim() } : {}),
			...parsed,
			dangerousOperations: operations.operations,
			pathsKnown: status.ok,
			errors: [...errors, ...operations.errors],
		};
	}

	private async dangerousOperations(cwd: string): Promise<{ operations: string[]; errors: string[] }> {
		const names = [
			["MERGE_HEAD", "merge"],
			["CHERRY_PICK_HEAD", "cherry-pick"],
			["REVERT_HEAD", "revert"],
			["rebase-merge", "rebase"],
			["rebase-apply", "rebase"],
			["BISECT_LOG", "bisect"],
		] as const;
		const entries = await Promise.all(names.map(async ([gitPathName, label]) => {
			const resolved = await this.runGit(cwd, ["rev-parse", "--git-path", gitPathName]);
			if (!resolved.ok || !resolved.stdout.trim()) {
				return { label, exists: false, error: `cannot inspect ${label} state: ${operationMessage(resolved)}` };
			}
			const candidate = resolved.stdout.trim();
			return { label, exists: await exists(path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate)) };
		}));
		return {
			operations: [...new Set(entries.filter((entry) => entry.exists).map((entry) => entry.label))],
			errors: entries.flatMap((entry) => "error" in entry ? [entry.error] : []),
		};
	}

	private runGit(cwd: string, args: string[]): Promise<GitOperationResultV1> {
		return runSpawnV1(this.gitExecutable, ["-C", cwd, ...args], {
			timeoutMs: this.timeoutMs,
			...(this.signal ? { signal: this.signal } : {}),
			...(this.terminationGraceMs !== undefined ? { terminationGraceMs: this.terminationGraceMs } : {}),
		});
	}
}

export function invalidOperation(message: string): GitOperationResultV1 {
	return { ok: false, exitCode: null, stdout: "", stderr: "", error: message };
}

/**
 * Generic direct-argv spawn primitive shared by the default adapter and
 * verifier. On POSIX every child gets its own detached process group, so a
 * timeout only signals descendants started by this invocation — never the
 * Electron/PipiUI host or an unrelated process.
 */
export function runSpawnV1(
	program: string,
	args: readonly string[],
	options: SpawnOptionsV1 = {},
): Promise<GitOperationResultV1> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
	const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_SPAWN_TERMINATION_GRACE_MS;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1_000) {
		return Promise.resolve({
			ok: false,
			exitCode: null,
			stdout: "",
			stderr: "",
			error: "timeoutMs must be a positive safe integer no greater than 24 hours",
		});
	}
	if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0 || terminationGraceMs > 60_000) {
		return Promise.resolve({
			ok: false,
			exitCode: null,
			stdout: "",
			stderr: "",
			error: "terminationGraceMs must be a safe integer between 0 and 60000",
		});
	}
	if (options.signal?.aborted) {
		return Promise.resolve({
			ok: false,
			exitCode: null,
			stdout: "",
			stderr: "",
			aborted: true,
			error: "process aborted before spawn",
		});
	}

	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut: ReturnType<typeof setTimeout> | undefined;
		let forceTerminate: ReturnType<typeof setTimeout> | undefined;
		let forceSettle: ReturnType<typeof setTimeout> | undefined;
		let termination: "timeout" | "aborted" | undefined;
		let escalated = false;
		let child: ReturnType<typeof spawn> | undefined;
		const isPosix = process.platform !== "win32";

		const terminationResult = (
			exitCode: number | null,
			signal: string | null = null,
			detail?: string,
		): GitOperationResultV1 => {
			const base = termination === "timeout"
				? `process timed out after ${timeoutMs}ms`
				: "process aborted by AbortSignal";
			return {
				ok: false,
				exitCode,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				...(termination === "timeout" ? { timedOut: true } : {}),
				...(termination === "aborted" ? { aborted: true } : {}),
				...(signal ? { signal } : {}),
				error: [base, escalated ? "SIGKILL escalation requested" : "SIGTERM requested", detail]
					.filter((entry): entry is string => Boolean(entry))
					.join("; "),
			};
		};

		const clearTimers = (): void => {
			if (timedOut) clearTimeout(timedOut);
			if (forceTerminate) clearTimeout(forceTerminate);
			if (forceSettle) clearTimeout(forceSettle);
			timedOut = undefined;
			forceTerminate = undefined;
			forceSettle = undefined;
		};

		const cleanup = (): void => {
			clearTimers();
			options.signal?.removeEventListener("abort", onAbort);
			child?.stdout?.off("data", onStdout);
			child?.stderr?.off("data", onStderr);
			child?.stdout?.destroy();
			child?.stderr?.destroy();
			child?.off("error", onError);
			child?.off("close", onClose);
		};

		const finish = (result: GitOperationResultV1): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};

		/** Signal only the detached group created by this exact spawn; fall back to its direct child. */
		const terminateOwnedChild = (signal: NodeJS.Signals): void => {
			if (!child || child.exitCode !== null || child.signalCode !== null) return;
			if (isPosix && typeof child.pid === "number" && child.pid > 0) {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch {
					// The group may already have exited; the direct-child fallback below is still scoped.
				}
			}
			try {
				child.kill(signal);
			} catch {
				// Exit/error listeners or the bounded fallback settle the operation.
			}
		};

		const requestTermination = (cause: "timeout" | "aborted"): void => {
			if (settled || termination) return;
			termination = cause;
			terminateOwnedChild("SIGTERM");
			forceTerminate = setTimeout(() => {
				if (settled) return;
				escalated = true;
				terminateOwnedChild("SIGKILL");
				// A misbehaving platform/child must not keep the per-main queue occupied.
				forceSettle = setTimeout(() => {
					if (!settled) finish(terminationResult(null));
				}, 25);
			}, terminationGraceMs);
		};

		function onStdout(chunk: Buffer | string): void {
			stdout = pushTail(stdout, chunk);
		}
		function onStderr(chunk: Buffer | string): void {
			stderr = pushTail(stderr, chunk);
		}
		function onAbort(): void {
			requestTermination("aborted");
		}
		function onError(error: Error): void {
			if (termination) {
				finish(terminationResult(null, null, error.message));
				return;
			}
			finish({ ok: false, exitCode: null, stdout: stdout.trim(), stderr: stderr.trim(), error: error.message });
		}
		function onClose(exitCode: number | null, signal: string | null): void {
			if (termination) {
				finish(terminationResult(exitCode, signal));
				return;
			}
			finish({
				ok: exitCode === 0,
				exitCode,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				...(signal ? { signal, error: `process exited from signal ${signal}` } : {}),
			});
		}

		try {
			child = spawn(program, [...args], {
				...(options.cwd ? { cwd: options.cwd } : {}),
				// This is the group targeted above. It is never inherited from PipiUI.
				detached: isPosix,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			finish({ ok: false, exitCode: null, stdout, stderr, error: error instanceof Error ? error.message : String(error) });
			return;
		}
		child.stdout?.on("data", onStdout);
		child.stderr?.on("data", onStderr);
		child.once("error", onError);
		child.once("close", onClose);
		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.signal?.aborted) {
			requestTermination("aborted");
			return;
		}
		timedOut = setTimeout(() => requestTermination("timeout"), timeoutMs);
	});
}
