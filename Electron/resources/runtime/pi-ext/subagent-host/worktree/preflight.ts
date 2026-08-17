/** Best-effort merge preflight and in-flight overlap helpers. Git via runSpawnV1 only. */

import { runSpawnV1, type GitOperationResultV1 } from "./adapter.ts";

export type PreflightMergeResult = {
	clean: boolean;
	conflictPaths: string[];
	message?: string;
};

export type InflightWritableWorker = {
	agentId: string;
	worktreePath?: string;
	branch?: string;
	readOnly?: boolean;
};

export type BaseAdvanceAlert = {
	agentId: string;
	overlap: string[];
	conflicts: string[];
};

const GIT_TIMEOUT_MS = 15_000;

async function git(cwd: string, args: readonly string[]): Promise<GitOperationResultV1> {
	return runSpawnV1("git", ["-C", cwd, ...args], { timeoutMs: GIT_TIMEOUT_MS });
}

function splitNames(text: string): string[] {
	return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].sort();
}

/** Parse `git merge-tree --write-tree` stdout/stderr into conflict path names. */
export function parseMergeTreeConflicts(stdout: string, stderr = ""): string[] {
	const paths = new Set<string>();
	const text = `${stdout}\n${stderr}`;
	for (const line of text.split(/\r?\n/)) {
		const conflict = line.match(/^CONFLICT \([^)]+\):.*\b(?:Merge conflict in| in) (.+)$/);
		if (conflict?.[1]) {
			paths.add(conflict[1].trim());
			continue;
		}
		const stage = line.match(/^\d{6} [0-9a-f]+ [1-3]\t(.+)$/i);
		if (stage?.[1]) paths.add(stage[1]);
	}
	const lines = stdout.split(/\r?\n/);
	if (/^[0-9a-f]{40,}$/i.test((lines[0] ?? "").trim())) {
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (!line) break;
			if (
				line.startsWith("Auto-merging") ||
				line.startsWith("CONFLICT") ||
				/^\d{6} /.test(line)
			) {
				break;
			}
			if (!line.includes("\t") && !line.startsWith(" ")) paths.add(line.trim());
		}
	}
	return [...paths].sort();
}

/**
 * Dry-run merge of `branch` into `baseRef` (`git merge-tree --write-tree`).
 * Exit 0 is clean; non-zero collects conflict paths. Never throws.
 */
export async function preflightMerge(
	mainCwd: string,
	baseRef: string,
	branch: string,
): Promise<PreflightMergeResult> {
	try {
		if (!mainCwd.trim() || !baseRef.trim() || !branch.trim() || branch.startsWith("-")) {
			return { clean: true, conflictPaths: [], message: "preflight skipped: invalid refs" };
		}
		const result = await git(mainCwd, ["merge-tree", "--write-tree", "--name-only", baseRef, branch]);
		if (result.ok) return { clean: true, conflictPaths: [] };
		const conflictPaths = parseMergeTreeConflicts(result.stdout, result.stderr);
		return {
			clean: false,
			conflictPaths,
			message: result.error || result.stderr.trim() || `merge-tree exited ${result.exitCode ?? "?"}`,
		};
	} catch (error) {
		return {
			clean: true,
			conflictPaths: [],
			message: `preflight failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/** `git diff --name-only $(merge-base HEAD branch)...branch` — committed branch changes. */
export async function branchChangedFiles(mainCwd: string, branch: string): Promise<string[]> {
	try {
		if (!mainCwd.trim() || !branch.trim() || branch.startsWith("-")) return [];
		const base = await git(mainCwd, ["merge-base", "HEAD", branch]);
		if (!base.ok || !base.stdout.trim()) return [];
		const diff = await git(mainCwd, ["diff", "--name-only", `${base.stdout.trim()}...${branch}`]);
		if (!diff.ok) return [];
		return splitNames(diff.stdout);
	} catch {
		return [];
	}
}

/** Uncommitted + untracked paths in a worktree (`git status --porcelain`). */
export async function worktreeDirtyFiles(worktreePath: string): Promise<string[]> {
	try {
		if (!worktreePath.trim()) return [];
		const status = await git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"]);
		if (!status.ok) return [];
		const paths = new Set<string>();
		for (const line of status.stdout.split(/\r?\n/)) {
			if (line.length < 4) continue;
			const rest = line.slice(3);
			const rename = rest.split(" -> ");
			const name = (rename.length > 1 ? rename[rename.length - 1] : rest)?.trim();
			if (name) paths.add(name);
		}
		return [...paths].sort();
	} catch {
		return [];
	}
}

export function overlappingPaths(left: readonly string[], right: readonly string[]): string[] {
	const rightSet = new Set(right);
	return [...new Set(left.filter((item) => rightSet.has(item)))].sort();
}

export async function revParse(cwd: string, rev: string): Promise<string | undefined> {
	try {
		if (!cwd.trim() || !rev.trim() || rev.startsWith("-")) return undefined;
		const result = await git(cwd, ["rev-parse", "--verify", rev]);
		const sha = result.stdout.trim();
		return result.ok && sha ? sha : undefined;
	} catch {
		return undefined;
	}
}

export async function evaluateBaseAdvanceAlerts(input: {
	mainCwd: string;
	landedFiles: readonly string[];
	workers: readonly InflightWritableWorker[];
	skipAgentId?: string;
}): Promise<BaseAdvanceAlert[]> {
	const alerts: BaseAdvanceAlert[] = [];
	for (const worker of input.workers) {
		if (worker.readOnly || !worker.worktreePath || !worker.branch) continue;
		if (input.skipAgentId && worker.agentId === input.skipAgentId) continue;
		try {
			const [changed, dirty, preflight] = await Promise.all([
				branchChangedFiles(input.mainCwd, worker.branch),
				worktreeDirtyFiles(worker.worktreePath),
				preflightMerge(input.mainCwd, "HEAD", worker.branch),
			]);
			const union = new Set([...changed, ...dirty]);
			const overlap = [...new Set(input.landedFiles.filter((file) => union.has(file)))].sort();
			if (overlap.length > 0 || !preflight.clean) {
				alerts.push({
					agentId: worker.agentId,
					overlap,
					conflicts: preflight.conflictPaths,
				});
			}
		} catch {
			// best-effort per worker
		}
	}
	return alerts;
}

export function formatBaseAdvancedSignal(alert: BaseAdvanceAlert): string {
	const overlap = alert.overlap.length > 0 ? alert.overlap.join(",") : "(none)";
	const conflicts = alert.conflicts.length > 0 ? alert.conflicts.join(",") : "(none)";
	return [
		`[subagent-base-advanced] agentId=${alert.agentId} overlap=${overlap} conflicts=${conflicts}`,
		"Main checkout HEAD advanced and this in-flight writable worker overlaps the landed files or merge-tree reports a conflict.",
		"Have that worker merge the main checkout HEAD before continuing. Do not treat this as a new user request.",
	].join("\n");
}

export function formatPreflightConflictSignal(input: {
	agentId: string;
	conflictPaths: readonly string[];
}): string {
	const conflicts = input.conflictPaths.length > 0 ? input.conflictPaths.join(",") : "(unknown)";
	return [
		`[subagent-base-advanced] agentId=${input.agentId} overlap=(preflight) conflicts=${conflicts}`,
		"This in-flight worker's branch tip moved and merge-tree now conflicts with the main checkout HEAD.",
		"Have that worker merge the main checkout HEAD before continuing. Do not treat this as a new user request.",
	].join("\n");
}

/** 60s injection window, same shape as worktree-recovery EscalationDeduperV1. */
export class BaseAdvanceDeduper {
	private readonly lastInjected = new Map<string, number>();
	private readonly windowMs: number;
	private readonly now: () => number;

	constructor(options?: { windowMs?: number; now?: () => number }) {
		this.windowMs = options?.windowMs ?? 60_000;
		this.now = options?.now ?? Date.now;
	}

	shouldInject(agentId: string, detail: string): boolean {
		const key = `${agentId}|${detail}`;
		const current = this.now();
		const previous = this.lastInjected.get(key);
		if (previous !== undefined && current - previous < this.windowMs) return false;
		this.lastInjected.set(key, current);
		return true;
	}
}

/**
 * Heartbeat helper: remember last seen branch tip; preflight only when the tip moves;
 * emit only on clean → conflict flip.
 */
export function createTipPreflightTracker(): {
	onTick: (input: {
		agentId: string;
		mainCwd: string;
		branch: string;
		tip?: string;
	}) => Promise<PreflightMergeResult | undefined>;
	lastTip: (agentId: string) => string | undefined;
	lastClean: (agentId: string) => boolean | undefined;
} {
	const tips = new Map<string, string>();
	const clean = new Map<string, boolean>();
	return {
		lastTip: (agentId) => tips.get(agentId),
		lastClean: (agentId) => clean.get(agentId),
		async onTick(input) {
			const tip = input.tip ?? (await revParse(input.mainCwd, input.branch));
			if (!tip) return undefined;
			const previous = tips.get(input.agentId);
			tips.set(input.agentId, tip);
			if (previous === undefined) {
				const first = await preflightMerge(input.mainCwd, "HEAD", input.branch);
				clean.set(input.agentId, first.clean);
				return undefined;
			}
			if (previous === tip) return undefined;
			const next = await preflightMerge(input.mainCwd, "HEAD", input.branch);
			const wasClean = clean.get(input.agentId);
			clean.set(input.agentId, next.clean);
			if (wasClean === true && !next.clean) return next;
			return undefined;
		},
	};
}
