/**
 * Plan-adherence units: plan-file reader, [plan-drift] advisory rules and ring buffer,
 * scope-prefix drift math (against a real temp git repo), and the globalThis seam that
 * pipiui-plan.ts's plan_check consumes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	PLAN_DRIFT_RING_CAP,
	computeScopeDrift,
	filesOutsideScope,
	getPlanAdherenceSnapshot,
	planDriftAdvisoryFor,
	publishPlanAdherenceSeam,
	readActivePlanTasks,
	recentPlanDriftSignals,
	recordPlanDriftSignal,
	resetPlanDriftSignalsForTests,
	type ActivePlanTasks,
	type PlanDriftCheckContext,
} from "../plan-drift.ts";

const PLAN_FIXTURE = {
	activePlanId: "plan-alpha",
	plans: {
		"plan-alpha": {
			id: "plan-alpha",
			title: "Alpha",
			lifecycle: "approved",
			tasks: [
				{ id: "task-open", title: "Open", state: "pending" },
				{ id: "task-active", title: "Active", state: "in_progress" },
				{ id: "task-done", title: "Done", state: "completed" },
			],
		},
	},
};

function withPlanRepo(fn: (mainCwd: string, planFile: string) => void, plan: unknown = PLAN_FIXTURE): void {
	const mainCwd = mkdtempSync(join(tmpdir(), "plan-drift-"));
	const plansDir = join(mainCwd, ".pi", "plans");
	mkdirSync(plansDir, { recursive: true });
	const planFile = join(plansDir, "session-1.json");
	writeFileSync(planFile, JSON.stringify(plan), "utf8");
	try {
		fn(mainCwd, planFile);
	} finally {
		rmSync(mainCwd, { recursive: true, force: true });
	}
}

test("readActivePlanTasks: open tasks of an executable plan; everything else is no plan", () => {
	withPlanRepo((mainCwd) => {
		assert.deepEqual(readActivePlanTasks(mainCwd, "session-1"), {
			planId: "plan-alpha",
			taskIds: ["task-open", "task-active"],
		});
		// Session-scoped: a different session's file is not this session's plan.
		assert.equal(readActivePlanTasks(mainCwd, "other-session"), undefined);
		// No session id falls back to the legacy single-file name.
		assert.equal(readActivePlanTasks(mainCwd, undefined), undefined);
	});

	withPlanRepo(
		(mainCwd) => {
			assert.deepEqual(readActivePlanTasks(mainCwd, "session-1"), {
				planId: "plan-alpha",
				taskIds: ["task-open", "task-active"],
			});
		},
		{ ...PLAN_FIXTURE, plans: { "plan-alpha": { ...PLAN_FIXTURE.plans["plan-alpha"], lifecycle: "active" } } },
	);
	withPlanRepo(
		(mainCwd) => {
			// Draft plan: not approved, dispatches may drift silently.
			assert.equal(readActivePlanTasks(mainCwd, "session-1"), undefined);
		},
		{ ...PLAN_FIXTURE, plans: { "plan-alpha": { ...PLAN_FIXTURE.plans["plan-alpha"], lifecycle: "draft" } } },
	);
	withPlanRepo(
		(mainCwd) => {
			// Cancelled plan: same.
			assert.equal(readActivePlanTasks(mainCwd, "session-1"), undefined);
		},
		{ ...PLAN_FIXTURE, plans: { "plan-alpha": { ...PLAN_FIXTURE.plans["plan-alpha"], lifecycle: "cancelled" } } },
	);
	withPlanRepo(
		(mainCwd) => {
			// Approved but nothing open: nothing to adhere to.
			assert.equal(readActivePlanTasks(mainCwd, "session-1"), undefined);
		},
		{
			activePlanId: "plan-alpha",
			plans: {
				"plan-alpha": {
					...PLAN_FIXTURE.plans["plan-alpha"],
					tasks: [{ id: "task-done", title: "Done", state: "completed" }],
				},
			},
		},
	);
	// Missing / corrupt store reads as no plan, never throws.
	const missing = mkdtempSync(join(tmpdir(), "plan-drift-"));
	try {
		assert.equal(readActivePlanTasks(missing, "session-1"), undefined);
		assert.equal(readActivePlanTasks(undefined, "session-1"), undefined);
	} finally {
		rmSync(missing, { recursive: true, force: true });
	}
});

test("filesOutsideScope: scope-overlap prefix semantics, including the whole-repo scope", () => {
	// Directory prefix (trailing slash).
	assert.deepEqual(filesOutsideScope(["src/a.ts", "lib/b.ts"], ["src/"]), ["lib/b.ts"]);
	// Bare path covers itself and /-bounded descendants — src/foo must NOT cover src/foobar.
	assert.deepEqual(
		filesOutsideScope(["src/foo/bar.ts", "src/foo", "src/foobar.ts"], ["src/foo"]),
		["src/foobar.ts"],
	);
	// Multiple prefixes union; output keeps branch order.
	assert.deepEqual(
		filesOutsideScope(["src/a.ts", "docs/b.md", "c.txt"], ["src/", "docs/"]),
		["c.txt"],
	);
	// A scope of "/" covers everything.
	assert.deepEqual(filesOutsideScope(["any/file.ts"], ["/"]), []);
	// No declared scope: nothing to compare, empty result.
	assert.deepEqual(filesOutsideScope(["any/file.ts"], []), []);
	// Backslashes normalize like scope-overlap.
	assert.deepEqual(filesOutsideScope(["lib/x.ts"], ["src\\", "lib/"]), []);
});

test("planDriftAdvisoryFor: triggers, exemptions, and ring recording", () => {
	resetPlanDriftSignalsForTests();
	const activePlan: ActivePlanTasks = { planId: "plan-alpha", taskIds: ["task-open", "task-active"] };
	const strict: PlanDriftCheckContext = {
		activePlan,
		isKnownAgentId: () => false,
		isResumable: () => false,
	};

	// No active plan: silence, nothing recorded.
	assert.equal(planDriftAdvisoryFor([{ agentId: "a" }], { ...strict, activePlan: undefined }), "");
	assert.equal(recentPlanDriftSignals().length, 0);

	// Missing planTask on a fresh id: one advisory line, "missing" recorded.
	const missing = planDriftAdvisoryFor([{ agentId: "a", subagentType: "explore" }], strict);
	assert.match(missing, /^\[plan-drift\] agentId=a does not declare planTask/);
	assert.equal(recentPlanDriftSignals().length, 1);
	assert.equal(recentPlanDriftSignals()[0]?.reason, "missing");

	// Unknown task id: named in the line, "unknown-task" recorded.
	const unknown = planDriftAdvisoryFor([{ agentId: "b", planTask: "no-such" }], strict);
	assert.match(unknown, /\[plan-drift\] agentId=b planTask="no-such" is not a task id of executable plan plan-alpha/);
	const ring = recentPlanDriftSignals();
	assert.equal(ring.length, 2);
	assert.equal(ring[1]?.reason, "unknown-task");
	assert.equal(ring[1]?.planTask, "no-such");

	// Valid task id: silent.
	assert.equal(planDriftAdvisoryFor([{ agentId: "c", planTask: "task-active" }], strict), "");

	// Secretary closeouts are exempt (by subagent_type and by resolved agent name).
	assert.equal(planDriftAdvisoryFor([{ agentId: "d", subagentType: "secretary" }], strict), "");
	assert.equal(planDriftAdvisoryFor([{ agentId: "e", agentName: "secretary" }], strict), "");

	// Already-known / resumable ids are exempt (resume/re-dispatch of existing work).
	assert.equal(
		planDriftAdvisoryFor([{ agentId: "g" }], { ...strict, isKnownAgentId: (id) => id === "g" }),
		"",
	);
	assert.equal(
		planDriftAdvisoryFor([{ agentId: "h" }], { ...strict, isResumable: (id) => id === "h" }),
		"",
	);

	// One line per drifting item in a wave.
	const wave = planDriftAdvisoryFor([{ agentId: "i" }, { agentId: "j", planTask: "task-open" }], strict);
	assert.match(wave, /agentId=i /);
	assert.doesNotMatch(wave, /agentId=j /);
	resetPlanDriftSignalsForTests();
});

test("plan-drift ring buffer caps at 50, dropping the oldest", () => {
	resetPlanDriftSignalsForTests();
	for (let i = 0; i < PLAN_DRIFT_RING_CAP + 5; i++) {
		recordPlanDriftSignal({ at: new Date(0).toISOString(), agentId: `agent-${i}`, reason: "missing" });
	}
	const ring = recentPlanDriftSignals();
	assert.equal(ring.length, PLAN_DRIFT_RING_CAP);
	assert.equal(ring[0]?.agentId, "agent-5");
	assert.equal(ring[ring.length - 1]?.agentId, `agent-${PLAN_DRIFT_RING_CAP + 4}`);
	resetPlanDriftSignalsForTests();
});

test("computeScopeDrift: real git worker branch measured against declared scope", () => {
	const repo = mkdtempSync(join(tmpdir(), "plan-drift-git-"));
	const git = (args: string[], cwd = repo) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
	try {
		git(["init", "-q"]);
		mkdirSync(join(repo, "src"), { recursive: true });
		writeFileSync(join(repo, "src", "in-scope.ts"), "a\n");
		git(["add", "."]);
		git(["commit", "-qm", "base"]);
		git(["checkout", "-qb", "worker"]);
		mkdirSync(join(repo, "docs"), { recursive: true });
		writeFileSync(join(repo, "src", "in-scope.ts"), "b\n");
		writeFileSync(join(repo, "docs", "notes.md"), "note\n");
		writeFileSync(join(repo, "README.md"), "r\n");
		git(["add", "."]);
		git(["commit", "-qm", "worker work"]);
		// Back on the main checkout HEAD: the finalizer's inspection diffs main-HEAD...worker.
		git(["checkout", "-q", "-"]);

		// Merge-base diff of the worker branch: src/ stays inside, docs/ + README drift.
		assert.deepEqual(computeScopeDrift(repo, "worker", ["src/"]), ["README.md", "docs/notes.md"]);
		// Everything inside → attested none (empty array, NOT undefined).
		assert.deepEqual(computeScopeDrift(repo, "worker", ["src/", "docs/", "README.md"]), []);
		// Unmeasurable: unknown branch or missing cwd → undefined, never a fake "none".
		assert.equal(computeScopeDrift(repo, "no-such-branch", ["src/"]), undefined);
		assert.equal(computeScopeDrift(undefined, "worker", ["src/"]), undefined);
		assert.equal(computeScopeDrift(repo, undefined, ["src/"]), undefined);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test("getPlanAdherenceSnapshot reads through the globalThis seam, or reports empty", () => {
	// No seam published in this process yet (index.ts was never loaded here).
	const empty = getPlanAdherenceSnapshot();
	assert.deepEqual(empty, { jobs: [], recentPlanDrift: [] });

	try {
		let jobs: unknown[] = [{ agentId: "j", runId: "r", state: "running", planTask: "task-open" }];
		let drift: unknown[] = [{ at: "t", agentId: "j", reason: "missing" }];
		publishPlanAdherenceSeam({
			jobs: () => jobs,
			recentPlanDrift: () => drift,
		});
		const snap = getPlanAdherenceSnapshot();
		assert.deepEqual(snap.jobs, jobs);
		assert.deepEqual(snap.recentPlanDrift, drift);
		jobs = [];
		drift = [];
		assert.deepEqual(getPlanAdherenceSnapshot().jobs, []);
		assert.deepEqual(getPlanAdherenceSnapshot().recentPlanDrift, []);
	} finally {
		const g = globalThis as typeof globalThis & { __pipiui_plan_adherence_seam__?: unknown };
		delete g.__pipiui_plan_adherence_seam__;
	}
});
