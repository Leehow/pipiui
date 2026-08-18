import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS,
	configuredHeartbeatAt,
	createRunScopedTimeout,
	decideDispatchBackground,
	decideRuntimeBudgetExpiry,
	decideStallWatchdogAction,
	normalizeGeneralPurposeExecutionPolicy,
} from "../runtime-policy.ts";
import { createProviderWaitController, providerWaitDeadlineMs } from "../index.ts";
import { resolveSubagentWorktree } from "../worktree.ts";

const bundledGeneralPurpose = { name: "general-purpose", origin: "bundled" } as const;

test("bundled general-purpose defaults to isolated with a runtime budget", () => {
	assert.equal(DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS, 600_000);
	assert.deepEqual(normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, {}), {
		policy: { worktree: "isolated", timeoutMs: DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS },
	});
	const agentDefinition = readFileSync(new URL("../../agents/general-purpose/AGENT.md", import.meta.url), "utf8");
	assert.match(agentDefinition, /isolated worktree by default/);
	assert.match(agentDefinition, /isolation=none/);
	assert.doesNotMatch(agentDefinition, /in this isolated context/);
});

test("direct cwd no longer requires a Boss reason", () => {
	assert.deepEqual(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { worktree: "none" }),
		{ policy: { worktree: "none", timeoutMs: DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS } },
	);
	assert.match(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { worktree: "none", noWorktreeReason: "line one\nline two" }).problem ?? "",
		/single line/,
	);
	assert.deepEqual(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { worktree: "none", noWorktreeReason: "  shared fixture ownership  " }),
		{ policy: { worktree: "none", noWorktreeReason: "shared fixture ownership", timeoutMs: DEFAULT_GENERAL_PURPOSE_TIMEOUT_MS } },
	);
	assert.match(
		normalizeGeneralPurposeExecutionPolicy(bundledGeneralPurpose, { noWorktreeReason: "stale" }).problem ?? "",
		/only allowed/,
	);
});

test("execution overrides on other roles are ignored", () => {
	for (const agent of [
		{ name: "explore", origin: "bundled" as const },
		{ name: "general-purpose", origin: "project" as const },
	]) {
		assert.deepEqual(
			normalizeGeneralPurposeExecutionPolicy(agent, { heartbeatSecs: 60, worktree: "isolated" }),
			{},
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

test("run-scoped timeout ignores a stale generation, extends, and is disposable", () => {
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

	// extend() re-arms from a fresh base; the old (already fired) handle is not cancelled.
	assert.equal(timeout.extend(30_000, 60_000), 90_000);
	assert.equal(scheduled[1]!.delay, 30_000);
	assert.equal(cancelled.length, 0);
	// extend() with a live handle cancels it before scheduling the replacement.
	currentRun = "run-a";
	assert.equal(timeout.extend(45_000, 100_000), 145_000);
	assert.equal(cancelled.length, 1);
	assert.equal(cancelled[0], scheduled[1]);
	assert.equal(scheduled[2]!.delay, 45_000);
	scheduled[2]!.callback();
	assert.deepEqual(fired, ["timeout"]);

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
	assert.equal(cancelled.length, 2);
});

test("runtime budget expiry extends producing workers and aborts only after a notified stall", () => {
	const grace = 120_000;
	// Producing worker (progress inside the grace window) always re-arms silently.
	assert.equal(decideRuntimeBudgetExpiry({ idleMs: 0, progressGraceMs: grace, notified: false }), "extend-silent");
	assert.equal(decideRuntimeBudgetExpiry({ idleMs: grace, progressGraceMs: grace, notified: true }), "extend-silent");
	// Stalled worker gets exactly one notify+extend, then the next expiry aborts.
	assert.equal(decideRuntimeBudgetExpiry({ idleMs: grace + 1, progressGraceMs: grace, notified: false }), "notify-extend");
	assert.equal(decideRuntimeBudgetExpiry({ idleMs: grace + 1, progressGraceMs: grace, notified: true }), "abort");
	// A boss turn blocked on this worker cannot receive the notify, so the first
	// stalled expiry must abort instead of spending another silent budget.
	assert.equal(decideRuntimeBudgetExpiry({ idleMs: grace + 1, progressGraceMs: grace, notified: false, syncWait: true }), "abort");
	assert.equal(decideRuntimeBudgetExpiry({ idleMs: 0, progressGraceMs: grace, notified: false, syncWait: true }), "extend-silent");
});

test("fan-out treats a one-step chain as background and keeps multi-step chain synchronous", () => {
	assert.deepEqual(
		decideDispatchBackground({ depth: 0, isChain: true, chainLength: 1, fanoutActive: true }),
		{
			useBackground: true,
			warning:
				"Note: one-step chain ran in the background (fan-out is active). Completion arrives as [subagent-done]; do not wait here.\n\n",
		},
	);
	assert.equal(
		decideDispatchBackground({ depth: 0, isChain: true, chainLength: 2, fanoutActive: true }).useBackground,
		false,
	);
	assert.equal(
		decideDispatchBackground({ depth: 0, isChain: true, chainLength: 1, fanoutActive: false }).useBackground,
		false,
	);
	assert.equal(
		decideDispatchBackground({
			depth: 0,
			isChain: false,
			chainLength: 0,
			fanoutActive: true,
			requestedBackground: false,
		}).useBackground,
		true,
	);
	assert.match(
		decideDispatchBackground({
			depth: 0,
			isChain: false,
			chainLength: 0,
			fanoutActive: true,
			requestedBackground: false,
		}).warning,
		/background:false ignored/,
	);
	assert.doesNotMatch(
		decideDispatchBackground({
			depth: 0,
			isChain: false,
			chainLength: 0,
			fanoutActive: true,
			requestedBackground: false,
		}).warning,
		/Use chain if you genuinely need ordered synchronous steps/,
	);
});

test("stall watchdog aborts a sync wait and an unanswered background stall", () => {
	const base = {
		stallThresholdMs: 120_000,
		maxNotifies: 3,
		notifyIntervalMs: 300_000,
		msSinceLastNotify: 300_000,
	};
	assert.equal(decideStallWatchdogAction({ ...base, idleMs: 119_999, notifyCount: 0, syncWait: false }), "ignore");
	assert.equal(decideStallWatchdogAction({ ...base, idleMs: 120_000, notifyCount: 0, syncWait: false }), "notify");
	assert.equal(decideStallWatchdogAction({ ...base, idleMs: 120_000, notifyCount: 1, msSinceLastNotify: 1_000, syncWait: false }), "ignore");
	assert.equal(decideStallWatchdogAction({ ...base, idleMs: 120_000, notifyCount: 3, syncWait: false }), "abort");
	assert.equal(decideStallWatchdogAction({ ...base, idleMs: 120_000, notifyCount: 0, syncWait: true }), "abort");
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
	assert.match(source, /const ChainItem = Type\.Object\(\{[\s\S]*?isolation: IsolationParam,[\s\S]*?timeoutSecs: TimeoutSecsParam,/);
	assert.match(source, /const SubagentParams = Type\.Object\(\{[\s\S]*?prompt: Type\.String\(\{[\s\S]*?isolation: IsolationParam,/);
	const singleSchema = source.slice(source.indexOf("const SubagentParams"), source.indexOf("const SubagentChainParams"));
	assert.doesNotMatch(singleSchema, /heartbeatSecs|timeoutSecs|agentScope|confirmProjectAgents|desktop:/);
	const parallelSchema = source.slice(source.indexOf("const ParallelSubagentParams"), source.indexOf("const SecretaryCommitParams"));
	assert.doesNotMatch(parallelSchema, /worktree|heartbeatSecs|timeoutSecs/);
});

test("runtime budget expiry is progress-aware, notifies the boss once, and retries terminal reports", () => {
	const source = readFileSync(new URL("../../../../../../Sources/PipiUI/PiExt/subagent/index.ts", import.meta.url), "utf8");
	// The onTimeout body decides before it kills: decide → diagnostic → stopReason → abort,
	// while extend/notify branches never reach controller.abort().
	const armIdx = source.indexOf("runtimeTimeout = createRunScopedTimeout({");
	const onTimeoutIdx = source.indexOf("onTimeout() {", armIdx);
	const blockEnd = source.indexOf("let procExited", armIdx);
	assert.ok(armIdx >= 0 && onTimeoutIdx > armIdx && blockEnd > onTimeoutIdx);
	const onTimeoutBlock = source.slice(onTimeoutIdx, blockEnd);
	const decisionIdx = onTimeoutBlock.indexOf("decideRuntimeBudgetExpiry({");
	const stopIdx = onTimeoutBlock.indexOf('currentResult.stopReason = "runtime_timeout"');
	const abortIdx = onTimeoutBlock.indexOf("handleForRun(pipiuiAgentId, runId)?.controller.abort()");
	assert.ok(decisionIdx >= 0, "onTimeout must consult decideRuntimeBudgetExpiry");
	assert.ok(stopIdx > decisionIdx, "stopReason is set only after the expiry decision");
	assert.ok(abortIdx > stopIdx, "controller.abort() stays after stopReason inside the abort branch");
	assert.match(onTimeoutBlock, /runtimeTimeout!\.extend\(\);/);
	assert.match(onTimeoutBlock, /runtimeBudgetDiagnostic\(now\)/);
	// Extension bookkeeping reaches the host so the panel countdown follows the new budget.
	assert.match(onTimeoutBlock, /deadlineAt: extendedDeadlineAt/);
	// The boss escalation mirrors [subagent-stalled]: bounded, self-describing, non-lethal first.
	assert.match(source, /\[subagent-timeout\] agentId=\$\{pipiuiAgentId\}/);
	assert.match(source, /runtimeBudgetNotify = \(text\) => \{/);
	assert.match(source, /re-armed once for another \$\{budgetSec\}s instead of being killed/);
	// Terminal bridge reports survive a dropped POST instead of stranding a running row.
	assert.match(source, /const TERMINAL_REPORT_RETRY_DELAYS_MS = \[1_000, 3_000\] as const;/);
	assert.match(source, /function postPipiuiReportWithRetry/);
	assert.match(source, /return enqueuePipiuiReport\(payload, postPipiuiReportWithRetry\);/);
});

test("provider wait deadline covers initial wait and mid-stream silence, never tool runs", () => {
	const phases: string[] = [];
	const timeouts: string[] = [];
	const make = () => {
		const timers = new Map<number, { callback: () => void; delay: number }>();
		const cancelled: number[] = [];
		let nextId = 1;
		const controller = createProviderWaitController({
			model: "test-model",
			deadlineMs: 1_000,
			schedule(callback, delay) {
				const id = nextId++;
				timers.set(id, { callback, delay });
				return id as unknown as ReturnType<typeof setTimeout>;
			},
			cancel: (timer) => {
				const id = timer as unknown as number;
				cancelled.push(id);
				timers.delete(id);
			},
			onPhase: (phase) => phases.push(phase),
			onTimeout: () => timeouts.push(controller.phase()),
		});
		const armTimer = () => [...timers.entries()].at(-1);
		const fireLatest = () => {
			const latest = armTimer();
			assert.ok(latest, "a deadline timer must be armed");
			timers.delete(latest[0]);
			latest[1].callback();
		};
		return { controller, timers, cancelled, fireLatest, armTimer };
	};

	// Initial wait: armed at creation, so a connection that dies before the first
	// byte still times out instead of hanging on an ESTABLISHED-but-dead socket.
	let s = make();
	assert.equal(s.armTimer()?.[1].delay, 1_000);
	s.fireLatest();
	assert.deepEqual(timeouts, ["model-active"]);

	// Mid-stream silence: every assistant delta re-arms the deadline and cancels
	// the previous one; a stream that stops producing deltas times out.
	s = make();
	s.controller.noteAssistantActivity();
	assert.equal(s.cancelled.length, 1);
	assert.equal(s.timers.size, 1);
	s.fireLatest();
	assert.deepEqual(timeouts, ["model-active", "model-active"]);
	assert.match(s.controller.activity(), /流式输出超时/);

	// Tool runs stay unguarded: the batch clears the deadline and nothing re-arms
	// until the last tool result returns the worker to awaiting-model.
	s = make();
	s.controller.noteAssistantActivity();
	s.controller.noteToolBatch(["t1", "t2"]);
	assert.equal(s.controller.phase(), "running-tool");
	assert.equal(s.timers.size, 0);
	s.controller.noteToolResult("t1");
	assert.equal(s.timers.size, 0);
	s.controller.noteToolResult("t2");
	assert.equal(s.controller.phase(), "awaiting-model");
	assert.equal(s.timers.size, 1);
	assert.match(s.controller.activity(), /工具结果已返回/);
	s.fireLatest();
	assert.deepEqual(timeouts, ["model-active", "model-active", "awaiting-model"]);
	assert.deepEqual(phases, [
		"model-active",
		"model-active",
		"running-tool",
		"awaiting-model",
	]);

	// Assistant output mid-tool-run (out-of-order delta) wins the phase race,
	// clears the pending batch, and re-arms: a late tool result must not arm a
	// second deadline against the live stream.
	s = make();
	s.controller.noteToolBatch(["t1"]);
	s.controller.noteAssistantActivity();
	s.controller.noteToolResult("t1");
	assert.equal(s.timers.size, 1);
	assert.equal(s.controller.phase(), "model-active");
	s.controller.dispose();
	assert.equal(s.timers.size, 0);
});

test("provider wait deadline honors the environment override and a positive default", () => {
	assert.equal(providerWaitDeadlineMs({}), 180_000);
	assert.equal(providerWaitDeadlineMs({ PIPIUI_PROVIDER_WAIT_TIMEOUT_MS: "45000" }), 45_000);
	assert.equal(providerWaitDeadlineMs({ PIPIUI_PROVIDER_WAIT_TIMEOUT_MS: "0" }), 180_000);
	assert.equal(providerWaitDeadlineMs({ PIPIUI_PROVIDER_WAIT_TIMEOUT_MS: "junk" }), 180_000);
});

test("heartbeat mandates status plus drift classification", () => {
	const runtimeIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(runtimeIndex, /requires one latest-state check in this same Boss turn/);
	assert.match(runtimeIndex, /call one unfiltered subagent_status/);
	assert.match(runtimeIndex, /full latest snapshot covering the same target worker\(s\), reuse it/);
	assert.match(runtimeIndex, /original task against its latest activity, output, and tool phase/);
	assert.match(runtimeIndex, /on-task, possible-drift, or drifted/);
	assert.match(runtimeIndex, /For possible-drift, query that exact worker\/detail/);
	assert.match(runtimeIndex, /For drifted, abort it; wait for the old run to become terminal/);
	assert.match(runtimeIndex, /Never dispatch a replacement while the old worker is still running/);
	assert.doesNotMatch(runtimeIndex, /Call subagent_status only if this snapshot is not enough to decide/);
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

test("Electron dispatch and stall watchdog use the recovery decisions", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /decideDispatchBackground\(/);
	assert.match(source, /decideStallWatchdogAction\(/);
	assert.match(source, /syncWait:\s*!isBackground/);
	assert.match(source, /if \(action === "abort"\)/);
	assert.match(source, /\[subagent-blocked\].*auto-aborted after stall/);
	assert.doesNotMatch(source, /Use chain if you genuinely need ordered synchronous steps/);
});
