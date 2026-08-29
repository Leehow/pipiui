/**
 * Plan adherence, measured rather than promised.
 *
 * Two runtime attestations live here:
 * - `[plan-drift]` — an advisory dispatch receipt line (never blocks admission) emitted when
 *   an approved plan with open tasks exists and a dispatch neither declares a `planTask` nor
 *   names one of its task ids. Architecture mirrors `[subagent-overlap]`: computed at the
 *   dispatch acceptance point, prefixed onto the receipt, and recorded in a bounded ring.
 * - scope drift — at completion, the worker branch's changed files are compared against the
 *   declared `scope` prefixes (same prefix semantics as scope-overlap.ts). The result lands
 *   in the done header as an attested line, like the verify exit code.
 *
 * Cross-extension seam: jiti loads every extension entry fresh (`moduleCache: false`), so a
 * module-level registry here would be a DIFFERENT instance per importing extension — the
 * same reason context-fold ships its registry over a globalThis key. The job provider is
 * therefore published by subagent/index.ts onto a globalThis slot, and
 * `getPlanAdherenceSnapshot()` reads through that slot, so extensions/pipiui-plan.ts's
 * plan_check sees the real registry regardless of which module instance it imported.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { cleanScope, normalizeScopePath } from "./scope-overlap.ts";

/** Ring-buffer cap for recent [plan-drift] signals. */
export const PLAN_DRIFT_RING_CAP = 50;

export type PlanDriftReason = "missing" | "unknown-task";

export interface PlanDriftSignal {
	/** ISO timestamp of the dispatch acceptance that produced the signal. */
	at: string;
	agentId: string;
	planTask?: string;
	reason: PlanDriftReason;
}

export interface ActivePlanTasks {
	planId: string;
	/** Task ids of the active approved plan that are still pending/in_progress. */
	taskIds: string[];
}

export type PlanAdherenceJobState = "running" | "ok" | "failed" | "aborted" | "interrupted" | "queued";

export interface PlanAdherenceJob {
	agentId: string;
	runId: string;
	title?: string;
	state: PlanAdherenceJobState;
	planTask?: string;
	scope?: string[];
	/** Files the finished worker branch changed outside its declared scope; omitted when unmeasured. */
	scopeDrift?: string[];
}

export interface PlanAdherenceSnapshot {
	jobs: PlanAdherenceJob[];
	/** Newest last, capped at PLAN_DRIFT_RING_CAP. */
	recentPlanDrift: PlanDriftSignal[];
}

type PlanAdherenceSeam = {
	jobs: () => PlanAdherenceJob[];
	recentPlanDrift: () => PlanDriftSignal[];
};

const PLAN_ADHERENCE_SEAM_KEY = "__pipiui_plan_adherence_seam__";

const globalScope = globalThis as typeof globalThis & { [PLAN_ADHERENCE_SEAM_KEY]?: PlanAdherenceSeam };

/** Called by the subagent extension at init; supplies the live registry views. */
export function publishPlanAdherenceSeam(seam: PlanAdherenceSeam): void {
	globalScope[PLAN_ADHERENCE_SEAM_KEY] = seam;
}

/**
 * Read-only snapshot for plan_check. Empty (never throws) when the subagent extension has
 * not published a seam in this process — a caller that dispatched nothing has nothing to show.
 */
export function getPlanAdherenceSnapshot(): PlanAdherenceSnapshot {
	const seam = globalScope[PLAN_ADHERENCE_SEAM_KEY];
	return {
		jobs: seam?.jobs?.() ?? [],
		recentPlanDrift: seam?.recentPlanDrift?.() ?? [],
	};
}

const recentPlanDrift: PlanDriftSignal[] = [];

/** Record one advisory signal; oldest entries fall off beyond the cap. Returns the stored copy. */
export function recordPlanDriftSignal(signal: PlanDriftSignal): PlanDriftSignal {
	recentPlanDrift.push(signal);
	if (recentPlanDrift.length > PLAN_DRIFT_RING_CAP) {
		recentPlanDrift.splice(0, recentPlanDrift.length - PLAN_DRIFT_RING_CAP);
	}
	return signal;
}

/** Snapshot of the ring, newest last. */
export function recentPlanDriftSignals(): PlanDriftSignal[] {
	return recentPlanDrift.slice();
}

/** Test-only: drop recorded signals. */
export function resetPlanDriftSignalsForTests(): void {
	recentPlanDrift.length = 0;
}

/**
 * Open tasks of the session's approved plan, read straight from `.pi/plans/<sessionId>.json`
 * (the same file extensions/pipiui-plan.ts writes). Any read/parse failure means "no active
 * plan": the advisory must never turn a plan-store hiccup into a dispatch error.
 */
export function readActivePlanTasks(
	mainCwd: string | undefined,
	sessionId: string | undefined,
): ActivePlanTasks | undefined {
	if (!mainCwd) return undefined;
	const safe = (sessionId ?? "").replace(/[^A-Za-z0-9._-]/g, "");
	const file = join(mainCwd, ".pi", "plans", safe ? `${safe}.json` : "current.json");
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
	if (typeof raw !== "object" || raw === null) return undefined;
	const store = raw as { activePlanId?: unknown; plans?: unknown };
	if (typeof store.activePlanId !== "string" || typeof store.plans !== "object" || store.plans === null) {
		return undefined;
	}
	const plan = (store.plans as Record<string, unknown>)[store.activePlanId];
	if (typeof plan !== "object" || plan === null) return undefined;
	const snapshot = plan as { lifecycle?: unknown; tasks?: unknown };
	if (snapshot.lifecycle !== "approved" || !Array.isArray(snapshot.tasks)) return undefined;
	const taskIds: string[] = [];
	for (const task of snapshot.tasks) {
		if (typeof task !== "object" || task === null) continue;
		const entry = task as { id?: unknown; state?: unknown };
		if (typeof entry.id !== "string") continue;
		if (entry.state === "pending" || entry.state === "in_progress") taskIds.push(entry.id);
	}
	if (taskIds.length === 0) return undefined;
	return { planId: store.activePlanId, taskIds };
}

export interface PlanDriftCandidate {
	agentId: string;
	agentName?: string;
	subagentType?: string;
	planTask?: string;
}

export interface PlanDriftCheckContext {
	activePlan: ActivePlanTasks | undefined;
	/** True when this agentId is already known (terminal job, queued item, active reservation). */
	isKnownAgentId: (agentId: string) => boolean;
	/** True when the agentId has a stored conversation to continue (same test as the identity gate). */
	isResumable: (agentId: string, agentName?: string) => boolean;
}

/**
 * `[plan-drift]` lines for one dispatch call. Advisory only: nothing here gates admission.
 * Exempt: secretary closeouts, resumes/re-dispatches of an already-known agentId, and every
 * dispatch when no approved plan has open tasks.
 */
export function planDriftAdvisoryFor(candidates: PlanDriftCandidate[], context: PlanDriftCheckContext): string {
	if (!context.activePlan) return "";
	const lines: string[] = [];
	for (const candidate of candidates) {
		const agentId = candidate.agentId.trim();
		if (!agentId) continue;
		if (candidate.subagentType === "secretary" || candidate.agentName === "secretary") continue;
		// Resume/re-dispatch of an already-known agentId is exempt. Do NOT key off
		// params.resume_from: adoptGrokBuildDispatch copies agentId into that alias, so
		// every fresh single dispatch would look like a resume and stay silent.
		if (context.isKnownAgentId(agentId) || context.isResumable(agentId, candidate.agentName)) continue;
		const planTask = candidate.planTask?.trim();
		if (planTask && context.activePlan.taskIds.includes(planTask)) continue;
		const reason: PlanDriftReason = planTask ? "unknown-task" : "missing";
		recordPlanDriftSignal({
			at: new Date().toISOString(),
			agentId,
			...(planTask ? { planTask } : {}),
			reason,
		});
		const detail = reason === "missing"
			? "does not declare planTask"
			: `planTask="${planTask}" is not a task id of approved plan ${context.activePlan.planId}`;
		lines.push(
			`[plan-drift] agentId=${agentId} ${detail}. Dispatch was not blocked; an approved plan with open tasks exists ` +
				"— map this dispatch onto one of them via planTask, or proceed consciously if this is legitimate out-of-plan work " +
				"(failure recovery, secretary closeout, a new user request) and note the judgment in your ledger.",
		);
	}
	return lines.join("\n");
}

/**
 * Worker-branch files outside every declared scope prefix. Prefix semantics match
 * scope-overlap.ts exactly: a trailing `/` covers the whole directory, a bare path covers
 * itself and its `/`-bounded descendants, and `/` covers everything.
 */
export function filesOutsideScope(changedPaths: string[], scope: string[]): string[] {
	const prefixes = cleanScope(scope);
	if (prefixes.length === 0) return [];
	if (prefixes.includes("/")) return [];
	const dirs = prefixes.filter((p) => p.endsWith("/")).map((p) => p.slice(0, -1));
	const files = prefixes.filter((p) => !p.endsWith("/"));
	const inside = (changed: string): boolean => {
		const p = normalizeScopePath(changed) ?? changed;
		return dirs.some((d) => p === d || p.startsWith(`${d}/`))
			|| files.some((f) => p === f || p.startsWith(`${f}/`));
	};
	return changedPaths.filter((p) => !inside(p));
}

const SCOPE_DRIFT_GIT_TIMEOUT_MS = 30_000;

/**
 * Changed files of the worker branch vs the main HEAD, merge-base semantics — the same
 * `git diff --no-renames --name-only -z HEAD...<branch>` the finalizer's inspection runs.
 * Must be called BEFORE finalization (cleanup deletes the branch). `undefined` when the
 * measurement failed: never fabricate a drift answer from missing evidence.
 */
export function workerBranchChangedPaths(
	mainCwd: string | undefined,
	branch: string,
): string[] | undefined {
	if (!mainCwd || !branch) return undefined;
	const result = spawnSync("git", ["diff", "--no-renames", "--name-only", "-z", `HEAD...${branch}`], {
		cwd: mainCwd,
		encoding: "utf8",
		shell: false,
		timeout: SCOPE_DRIFT_GIT_TIMEOUT_MS,
	});
	if (result.status !== 0 || result.error) return undefined;
	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	return stdout.split("\0").filter(Boolean);
}

/**
 * Layer-2 attestation input: files outside the declared scope, or an empty array when the
 * branch stayed fully inside it. `undefined` means "not measured" (no main cwd, no branch,
 * git failure) and must surface as NO attestation line, never as `none`.
 */
export function computeScopeDrift(
	mainCwd: string | undefined,
	branch: string | undefined,
	scope: string[],
): string[] | undefined {
	if (!mainCwd || !branch) return undefined;
	const changed = workerBranchChangedPaths(mainCwd, branch);
	if (!changed) return undefined;
	return filesOutsideScope(changed, scope);
}
