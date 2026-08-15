import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	configuredHeartbeatAt,
	createRunScopedTimeout,
	normalizeGeneralPurposeExecutionPolicy,
} from "../runtime-policy.ts";
import { resolveSubagentWorktree } from "../worktree.ts";

const bundledGeneralPurpose = { name: "general-purpose", origin: "bundled" } as const;

test("bundled general-purpose defaults to isolated with legacy timing omitted", () => {
	assert.deepEqual(normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, {}), {
		policy: { worktree: "isolated" },
	});
	const agentDefinition = readFileSync(new URL("../../agents/general-purpose/AGENT.md", import.meta.url), "utf8");
	assert.match(agentDefinition, /isolated worktree by default/);
	assert.match(agentDefinition, /Boss supplied an auditable reason/);
	assert.doesNotMatch(agentDefinition, /in this isolated context/);
});

test("direct cwd requires one normalized auditable Boss reason", () => {
	assert.match(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { worktree: "none" }).problem ?? "",
		/requires noWorktreeReason/,
	);
	assert.match(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { worktree: "none", noWorktreeReason: "line one\nline two" }).problem ?? "",
		/single line/,
	);
	assert.deepEqual(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { worktree: "none", noWorktreeReason: "  shared fixture ownership  " }),
		{ policy: { worktree: "none", noWorktreeReason: "shared fixture ownership" } },
	);
	assert.match(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { noWorktreeReason: "stale" }).problem ?? "",
		/only allowed/,
	);
});

test("execution overrides reject other roles and non-bundled shadows", () => {
	for (const agent of [
		{ name: "explore", origin: "bundled" as const },
		{ name: "general-purpose", origin: "project" as const },
	]) {
		assert.match(
			normalizeGeneralPurposeExecutionPolicy(agent, { heartbeatSecs: 60 }).problem ?? "",
			/only available to the bundled general-purpose/,
		);
	}
});

test("heartbeat and timeout bounds are enforced and normalized per dispatch", () => {
	for (const heartbeatSecs of [29, 30.5, 3601]) {
		assert.match(normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { heartbeatSecs }).problem ?? "", /heartbeatSecs/);
	}
	for (const timeoutSecs of [29, 30.5, 604801]) {
		assert.match(normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { timeoutSecs }).problem ?? "", /timeoutSecs/);
	}
	assert.match(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { heartbeatSecs: 60, timeoutSecs: 60 }).problem ?? "",
		/must be less/,
	);
	assert.deepEqual(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { heartbeatSecs: 45, timeoutSecs: 90 }),
		{ policy: { worktree: "isolated", heartbeatMs: 45_000, timeoutMs: 90_000 } },
	);
	assert.equal(configuredHeartbeatAt(1_000, 0, 45_000), 46_000);
	assert.equal(configuredHeartbeatAt(1_000, 2, 45_000), 136_000);
	assert.equal(configuredHeartbeatAt(1_000, 2, undefined), undefined);
});

test("run-scoped timeout ignores a stale generation and is disposable", () => {
	const scheduled: Array<{ callback: () => void; delay: number }> = [];
	const cancelled: unknown[] = [];
	const fired: string[] = [];
	let currentRun = "run-b";
	const timeout = createRunScopedTimeout({
		runId: "run-a",
		timeoutMs: 90_000,
		now: () => 5_000,
		isCurrentRun: (runId) => runId === currentRun,
		onTimeout: () => fired.push("timeout"),
		schedule(callback, delay) {
			const token = { callback, delay };
			scheduled.push(token);
			return token as unknown as ReturnType<typeof setTimeout>;
		},
		cancel: (handle) => cancelled.push(handle),
	});
	assert.equal(timeout.deadlineAt, 95_000);
	assert.equal(scheduled[0]!.delay, 90_000);
	scheduled[0]!.callback();
	assert.deepEqual(fired, []);

	currentRun = "run-a";
	const live = createRunScopedTimeout({
		runId: "run-a",
		timeoutMs: 30_000,
		isCurrentRun: (runId) => runId === currentRun,
		onTimeout: () => fired.push("timeout"),
		schedule(callback, delay) {
			const token = { callback, delay };
			scheduled.push(token);
			return token as unknown as ReturnType<typeof setTimeout>;
		},
		cancel: (handle) => cancelled.push(handle),
	});
	live.dispose();
	assert.equal(cancelled.length, 1);
});

test("runtime timeout aborts the exact run before provider or transient auto-resume", () => {
	const source = readFileSync(new URL("../../../../../../Sources/PipiUI/PiExt/subagent/index.ts", import.meta.url), "utf8");
	assert.match(source, /currentResult\.stopReason = "runtime_timeout";[\s\S]*?handleForRun\(pipiuiAgentId, runId\)\?\.controller\.abort\(\);/);
	const retryDecision = source.indexOf("// Decide whether to auto-resume before verify/end");
	const abortShortCircuit = source.indexOf("if (wasAborted) break;", retryDecision);
	const providerDecision = source.indexOf("decideProviderStallRecovery({", retryDecision);
	const transientDecision = source.indexOf("isRetryableWorkerError(classifyText)", retryDecision);
	assert.ok(retryDecision >= 0 && abortShortCircuit > retryDecision);
	assert.ok(abortShortCircuit < providerDecision, "runtime abort must short-circuit provider recovery");
	assert.ok(abortShortCircuit < transientDecision, "runtime abort must short-circuit transient recovery");
	assert.match(source, /if \(wasAborted && !runtimeTimedOut\) throw new Error\("Subagent was aborted"\);/);
	assert.match(source, /const externallyAborted = wasAborted && !runtimeTimedOut;/);
	assert.match(source, /const endState: JobState = externallyAborted \? "aborted" : endOk \? "ok" : "failed";/);
	assert.match(source, /aborted: externallyAborted,/);
	assert.match(source, /if \(runtimeTimedOut && currentResult\.errorMessage\) \{[\s\S]*?endOutput\.includes\(currentResult\.errorMessage\)[\s\S]*?endResultText\.includes\(currentResult\.errorMessage\)/);
	assert.match(source, /terminalStateForFinalization\(\{ ok: endOk, aborted: wasAborted \}\)/);
	assert.match(source, /const ChainItem = Type\.Object\(\{[\s\S]*?worktree: WorktreeParam,[\s\S]*?timeoutSecs: TimeoutSecsParam,/);
	assert.match(source, /const SubagentParams = Type\.Object\(\{[\s\S]*?worktree: WorktreeParam,[\s\S]*?timeoutSecs: TimeoutSecsParam,/);
	const parallelSchema = source.slice(source.indexOf("const ParallelSubagentParams"), source.indexOf("const SecretaryCommitParams"));
	assert.doesNotMatch(parallelSchema, /worktree|heartbeatSecs|timeoutSecs/);
});

test("shared source is authoritative and heartbeat mandates status plus drift classification", () => {
	const sharedIndex = readFileSync(new URL("../../../../../../Sources/PipiUI/PiExt/subagent/index.ts", import.meta.url), "utf8");
	const runtimeIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const sharedPolicy = readFileSync(new URL("../../../../../../Sources/PipiUI/PiExt/subagent/runtime-policy.ts", import.meta.url), "utf8");
	const runtimePolicy = readFileSync(new URL("../runtime-policy.ts", import.meta.url), "utf8");
	assert.equal(runtimeIndex, sharedIndex, "Electron index must be generated from shared source");
	assert.equal(runtimePolicy, sharedPolicy, "Electron runtime policy must be generated from shared source");
	assert.match(sharedIndex, /requires one latest-state check in this same Boss turn/);
	assert.match(sharedIndex, /call one unfiltered subagent_status/);
	assert.match(sharedIndex, /full latest snapshot covering the same target worker\(s\), reuse it/);
	assert.match(sharedIndex, /original task against its latest activity, output, and tool phase/);
	assert.match(sharedIndex, /on-task, possible-drift, or drifted/);
	assert.match(sharedIndex, /For possible-drift, query that exact worker\/detail/);
	assert.match(sharedIndex, /For drifted, abort it; wait for the old run to become terminal/);
	assert.match(sharedIndex, /Never dispatch a replacement while the old worker is still running/);
	assert.doesNotMatch(sharedIndex, /Call subagent_status only if this snapshot is not enough to decide/);
});

test("direct general-purpose placement does not require a branch-shaped agentId", async () => {
	const { unnamedWritableDispatchProblem } = await import("../index.ts");
	assert.equal(
		unnamedWritableDispatchProblem(
			[{ agent: "general-purpose", worktree: "none" }],
			(target) => target.worktree !== "none",
		),
		null,
	);
	assert.match(
		unnamedWritableDispatchProblem(
			[{ agent: "general-purpose", worktree: "isolated" }],
			(target) => target.worktree !== "none",
		) ?? "",
		/Missing agentId/,
	);
});

test("bundled isolation treats cwd as repo base and ignores PIPIUI_WORKTREE=0", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pipiui-general-purpose-policy-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "-c", "user.name=PipiUI Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base"]);
	const previous = process.env.PIPIUI_WORKTREE;
	process.env.PIPIUI_WORKTREE = "0";
	t.after(() => {
		if (previous === undefined) delete process.env.PIPIUI_WORKTREE;
		else process.env.PIPIUI_WORKTREE = previous;
	});
	const placement = resolveSubagentWorktree({
		agentId: "policy-test",
		defaultCwd: root,
		readOnly: false,
		policy: { worktree: "isolated" },
		allowEnvironmentOptOut: false,
	});
	assert.equal(placement.worktreeError, undefined);
	assert.equal(placement.worktreePath, join(realpathSync(root), ".pi", "worktrees", "policy-test"));
	assert.equal(placement.cwd, placement.worktreePath);
});
