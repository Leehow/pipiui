/** Non-force leftover worktree sweep for retained-but-settled `.pi/worktrees` trees. */

import { readdir, rmdir } from "node:fs/promises";
import * as path from "node:path";

import type { WorktreeFinalizationInputV1 } from "./schema.ts";
import type {
	GitWorktreeAdapter,
	GitWorktreeInspectionV1,
	RegisteredGitWorktreeV1,
} from "./adapter.ts";
import {
	canonicalGitPathV1,
	NodeGitWorktreeAdapter,
} from "./adapter.ts";

type SweepLoggerV1 = {
	debug?(event: string, fields?: Record<string, unknown>): void;
	info?(event: string, fields?: Record<string, unknown>): void;
	warn?(event: string, fields?: Record<string, unknown>): void;
	error?(event: string, fields?: Record<string, unknown>): void;
};

export type LeftoverWorktreeLeaseStatusV1 = "absent" | "live" | "stale" | "blocked";

export type LeftoverWorktreeLeaseHooksV1 = {
	inspect(agentId: string): LeftoverWorktreeLeaseStatusV1 | Promise<LeftoverWorktreeLeaseStatusV1>;
	reapStale?(agentId: string): boolean | Promise<boolean>;
};

export type LeftoverWorktreeSweepDispositionV1 =
	| "pruned"
	| "kept-live"
	| "kept-active"
	| "kept-dirty"
	| "kept-unique"
	| "kept-blocked"
	| "orphan-removed";

export type LeftoverWorktreeSweepItemV1 = {
	path: string;
	branch?: string;
	agentId?: string;
	disposition: LeftoverWorktreeSweepDispositionV1;
	message: string;
};

export type LeftoverWorktreeSweepSummaryV1 = {
	pruned: number;
	kept: number;
	dirty: number;
	items: LeftoverWorktreeSweepItemV1[];
};

export type LeftoverWorktreeSweepInputV1 = {
	mainCwd: string;
	activeAgentIds?: Iterable<string>;
	adapter?: GitWorktreeAdapter;
	logger?: SweepLoggerV1;
	lease?: LeftoverWorktreeLeaseHooksV1;
};

function worktreesRootFor(toplevel: string): string {
	return path.join(toplevel, ".pi", "worktrees");
}

function agentIdFromWorktree(worktreePath: string, branch?: string): string {
	if (branch?.startsWith("pipiui/")) {
		const rest = branch.slice("pipiui/".length);
		if (rest) return rest;
	}
	return path.basename(worktreePath);
}

function matchesActiveAgent(agentId: string, worktreePath: string, branch: string | undefined, active: ReadonlySet<string>): boolean {
	if (active.has(agentId) || active.has(path.basename(worktreePath))) return true;
	for (const id of active) {
		if (!id) continue;
		if (path.basename(worktreePath) === id) return true;
		if (branch === `pipiui/${id}` || (branch?.startsWith(`pipiui/${id}-`) ?? false)) return true;
	}
	return false;
}

function worktreeIsDirty(inspection: GitWorktreeInspectionV1): boolean {
	return inspection.worktree.stagedPaths.length > 0
		|| inspection.worktree.unstagedPaths.length > 0
		|| inspection.worktree.untrackedPaths.length > 0
		|| inspection.worktree.conflictPaths.length > 0;
}

function isUnderWorktreesRoot(worktreePath: string, root: string): boolean {
	const relative = path.relative(root, worktreePath);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function inspectInput(mainCwd: string, worktreePath: string, branch: string, agentId: string): WorktreeFinalizationInputV1 {
	return {
		schemaVersion: 1,
		agentId,
		runId: "leftover-sweep",
		mainCwd,
		worktree: {
			path: worktreePath,
			branch,
			ownership: {
				mode: "isolated",
				role: "worker",
				agentId,
				runId: "leftover-sweep",
			},
		},
		terminal: { state: "ok" },
	};
}

function countSummary(items: LeftoverWorktreeSweepItemV1[]): LeftoverWorktreeSweepSummaryV1 {
	let pruned = 0;
	let dirty = 0;
	for (const item of items) {
		if (item.disposition === "pruned" || item.disposition === "orphan-removed") pruned += 1;
		if (item.disposition === "kept-dirty") dirty += 1;
	}
	return { pruned, kept: items.length - pruned, dirty, items };
}

async function listRegistered(adapter: GitWorktreeAdapter, mainCwd: string): Promise<{ ok: boolean; worktrees: RegisteredGitWorktreeV1[]; error?: string }> {
	if (adapter.listRegisteredWorktrees) return adapter.listRegisteredWorktrees(mainCwd);
	return { ok: false, worktrees: [], error: "adapter cannot list registered worktrees" };
}

async function resolveToplevel(adapter: GitWorktreeAdapter, mainCwd: string): Promise<string> {
	const top = adapter.repositoryToplevel ? await adapter.repositoryToplevel(mainCwd) : undefined;
	return top ?? path.resolve(mainCwd);
}

/**
 * Reap stale leases, then non-force-remove settled leftover trees under `.pi/worktrees`.
 * Live leases, active jobs, dirty trees, and unique unmerged commits are left intact.
 */
export async function sweepLeftoverWorktreesV1(
	input: LeftoverWorktreeSweepInputV1,
): Promise<LeftoverWorktreeSweepSummaryV1> {
	const adapter = input.adapter ?? new NodeGitWorktreeAdapter();
	const logger = input.logger ?? {};
	const active = new Set(input.activeAgentIds ?? []);
	const items: LeftoverWorktreeSweepItemV1[] = [];

	let toplevel: string;
	try {
		toplevel = await resolveToplevel(adapter, input.mainCwd);
	} catch (error) {
		const summary = countSummary([{
			path: input.mainCwd,
			disposition: "kept-blocked",
			message: `cannot resolve repository toplevel: ${error instanceof Error ? error.message : String(error)}`,
		}]);
		logger.warn?.("worktree-leftover-sweep", { pruned: summary.pruned, kept: summary.kept, dirty: summary.dirty });
		return summary;
	}

	const worktreesRoot = worktreesRootFor(toplevel);
	const listed = await listRegistered(adapter, input.mainCwd);
	if (!listed.ok) {
		logger.warn?.("worktree-leftover-sweep", {
			pruned: 0,
			kept: 0,
			dirty: 0,
			error: listed.error ?? "cannot read registered worktrees",
		});
		return { pruned: 0, kept: 0, dirty: 0, items: [] };
	}

	const registeredCanonical = new Set<string>();
	const rootCanonical = await canonicalGitPathV1(worktreesRoot);
	const mainCanonical = await canonicalGitPathV1(input.mainCwd);
	const topCanonical = await canonicalGitPathV1(toplevel);
	for (const row of listed.worktrees) {
		const canonical = await canonicalGitPathV1(row.path);
		registeredCanonical.add(canonical);
		if (!isUnderWorktreesRoot(canonical, rootCanonical)) continue;
		if (canonical === mainCanonical || canonical === topCanonical) {
			items.push({
				path: canonical,
				...(row.branch ? { branch: row.branch } : {}),
				disposition: "kept-blocked",
				message: "refusing to remove the main checkout",
			});
			continue;
		}
		items.push(await sweepRegisteredWorktree({
			mainCwd: input.mainCwd,
			row,
			canonical,
			active,
			adapter,
			lease: input.lease,
		}));
	}

	try {
		const names = await readdir(worktreesRoot);
		for (const name of names) {
			const abs = path.join(worktreesRoot, name);
			const canonical = await canonicalGitPathV1(abs);
			if (registeredCanonical.has(canonical)) continue;
			items.push(await sweepOrphanDirectory(abs));
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			items.push({
				path: worktreesRoot,
				disposition: "kept-blocked",
				message: `cannot read worktrees root: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	const summary = countSummary(items);
	logger.info?.("worktree-leftover-sweep", {
		pruned: summary.pruned,
		kept: summary.kept,
		dirty: summary.dirty,
	});
	return summary;
}

async function sweepRegisteredWorktree(input: {
	mainCwd: string;
	row: RegisteredGitWorktreeV1;
	canonical: string;
	active: ReadonlySet<string>;
	adapter: GitWorktreeAdapter;
	lease?: LeftoverWorktreeLeaseHooksV1;
}): Promise<LeftoverWorktreeSweepItemV1> {
	const { mainCwd, row, canonical, active, adapter, lease } = input;
	const agentId = agentIdFromWorktree(canonical, row.branch);
	const item = (disposition: LeftoverWorktreeSweepDispositionV1, message: string): LeftoverWorktreeSweepItemV1 => ({
		path: canonical,
		...(row.branch ? { branch: row.branch } : {}),
		agentId,
		disposition,
		message,
	});

	if (matchesActiveAgent(agentId, canonical, row.branch, active)) {
		return item("kept-active", "worktree belongs to a running or known-active job");
	}

	if (lease) {
		const status = await lease.inspect(agentId);
		if (status === "live") return item("kept-live", "lease owner pid is alive");
		if (status === "blocked") return item("kept-blocked", "lease cannot be inspected safely");
		if (status === "stale") {
			try {
				await lease.reapStale?.(agentId);
			} catch {
				// Reaping is best-effort; prune still requires a settled Git state.
			}
		}
	}

	if (!row.branch) {
		return item("kept-blocked", "registered worktree has no branch; refusing sweep deletion");
	}

	let inspection: GitWorktreeInspectionV1;
	try {
		inspection = await adapter.inspect(inspectInput(mainCwd, canonical, row.branch, agentId));
	} catch (error) {
		return item("kept-blocked", `Git inspection failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!inspection.worktree.isRepo || !inspection.worktree.pathsKnown || inspection.worktree.errors.length > 0) {
		return item("kept-blocked", inspection.worktree.errors[0] ?? "worker worktree state is unknown");
	}
	if (worktreeIsDirty(inspection)) {
		return item("kept-dirty", "dirty worker worktree is retained");
	}

	const branchGone = inspection.branchExists === false;
	const alreadyIntegrated = inspection.branchIsAncestorOfMain === true;
	if (!branchGone && !alreadyIntegrated) {
		return item("kept-unique", "branch is not an ancestor of the integration HEAD");
	}

	let removed;
	try {
		removed = await adapter.removeWorktree(mainCwd, canonical);
	} catch (error) {
		return item("kept-blocked", `worktree removal rejected: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!removed.ok) {
		const detail = (removed.stderr || removed.stdout || removed.error || `git exited ${removed.exitCode ?? "without a status"}`).trim();
		return item("kept-blocked", `non-force worktree removal failed: ${detail}`);
	}

	if (row.branch.startsWith("pipiui/")) {
		try {
			const branch = await adapter.cleanupMergedBranch({
				mainCwd,
				branch: row.branch,
				expectedWorktreePath: canonical,
			});
			if (branch.disposition !== "deleted" && branch.disposition !== "already-absent") {
				return item("pruned", `worktree removed; branch retained: ${branch.message}`);
			}
		} catch (error) {
			return item("pruned", `worktree removed; branch cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return item("pruned", alreadyIntegrated
		? "integrated leftover worktree removed"
		: "worktree whose branch is already gone was removed");
}

async function sweepOrphanDirectory(directory: string): Promise<LeftoverWorktreeSweepItemV1> {
	try {
		const entries = await readdir(directory);
		if (entries.length > 0) {
			return {
				path: directory,
				disposition: "kept-blocked",
				message: "unregistered worktree directory is not empty",
			};
		}
		await rmdir(directory);
		return {
			path: directory,
			disposition: "orphan-removed",
			message: "empty unregistered directory removed",
		};
	} catch (error) {
		return {
			path: directory,
			disposition: "kept-blocked",
			message: `orphan directory cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
