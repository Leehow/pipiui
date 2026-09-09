import test from "node:test";
import assert from "node:assert/strict";
import {
	BLOCK_ALL,
	DEFAULT_TOOL_BUDGET_BLOCK,
	createToolBudgetTracker,
	decodeToolBudgetEnv,
	encodeToolBudgetEnv,
	evaluateUsageBudget,
	formatToolBudgetLine,
	formatToolBudgetSoftNudge,
	formatUsageBudgetAbortReason,
	formatUsageBudgetLine,
	formatUsageBudgetSoftNotice,
	parseToolBudget,
	parseUsageBudget,
	summarizeToolBudget,
} from "../tool-budget.ts";

test("parseToolBudget: hard required, soft ≤ hard, block defaults to the browsing tools", () => {
	const minimal = parseToolBudget({ hard: 5 });
	assert.equal(minimal.ok, true);
	assert.deepEqual(minimal.ok && minimal.value, { hard: 5, block: DEFAULT_TOOL_BUDGET_BLOCK });
	const full = parseToolBudget({ soft: 3, hard: 5, block: ["bash", "bash", " edit "] });
	assert.deepEqual(full.ok && full.value, { soft: 3, hard: 5, block: ["bash", "edit"] });
	assert.equal(parseToolBudget({ soft: 6, hard: 5 }).ok, false);
	assert.equal(parseToolBudget({ hard: 0 }).ok, false);
	assert.equal(parseToolBudget({ hard: 2.5 }).ok, false);
	assert.equal(parseToolBudget({ hard: 5, block: [] }).ok, false);
	assert.equal(parseToolBudget({ hard: 5, extra: 1 }).ok, false);
	assert.equal(parseToolBudget("5").ok, false);
	assert.equal(parseToolBudget(null).ok, false);
});

test("env transport round-trips and fails closed on garbage", () => {
	const budget = parseToolBudget({ soft: 2, hard: 4, block: [BLOCK_ALL] });
	assert.equal(budget.ok, true);
	const encoded = encodeToolBudgetEnv(budget.ok ? budget.value : { hard: 1, block: [] });
	assert.deepEqual(decodeToolBudgetEnv(encoded), { soft: 2, hard: 4, block: [BLOCK_ALL] });
	assert.equal(decodeToolBudgetEnv(undefined), undefined);
	assert.equal(decodeToolBudgetEnv("not json"), undefined);
	assert.equal(decodeToolBudgetEnv(JSON.stringify({ soft: 9, hard: 1 })), undefined);
});

test("tracker: soft fires once, hard blocks only listed tools, ask_boss is exempt, final text never blocked", () => {
	const budget = parseToolBudget({ soft: 2, hard: 3 });
	assert.equal(budget.ok, true);
	const tracker = createToolBudgetTracker(budget.ok ? budget.value : { hard: 1, block: [] });
	assert.deepEqual(tracker.note("read"), { count: 1, softReached: false });
	assert.deepEqual(tracker.note("bash"), { count: 2, softReached: true });
	assert.deepEqual(tracker.note("edit"), { count: 3, softReached: false });
	// Over hard: browsing refused, mutation allowed, ask_boss neither counted nor refused.
	const refused = tracker.note("grep");
	assert.equal(refused.count, 4);
	assert.match(refused.block ?? "", /Hard limit reached: 4 tool call\(s\) exceed hard 3/);
	assert.deepEqual(tracker.note("edit"), { count: 5, softReached: false });
	assert.deepEqual(tracker.note("ask_boss"), { count: 5, softReached: false });
	const state = tracker.state();
	assert.equal(state.outcome, "hard-reached");
	assert.equal(state.blockedCalls, 1);
	assert.equal(formatToolBudgetLine(state), "Tool budget: 5 call(s) (soft 2, hard 3) → hard-reached, 1 refused");
});

test("tracker: block [\"*\"] refuses every tool past hard; soft-only budgets never block", () => {
	const all = createToolBudgetTracker({ hard: 1, block: [BLOCK_ALL] });
	all.note("read");
	assert.ok(all.note("edit").block);
	assert.ok(all.note("bash").block);
	const softOnlyLike = createToolBudgetTracker({ soft: 1, hard: 100, block: DEFAULT_TOOL_BUDGET_BLOCK });
	assert.equal(softOnlyLike.note("read").softReached, true);
	assert.equal(softOnlyLike.note("read").softReached, false);
	assert.equal(softOnlyLike.note("read").block, undefined);
	assert.equal(formatToolBudgetSoftNudge(1, { soft: 1, hard: 100, block: DEFAULT_TOOL_BUDGET_BLOCK }).includes("read/grep/find/ls is refused"), true);
});

test("summarizeToolBudget mirrors the tracker from a parent-side count", () => {
	const budget = { soft: 2, hard: 3, block: DEFAULT_TOOL_BUDGET_BLOCK };
	assert.equal(summarizeToolBudget(budget, 1).outcome, "within-budget");
	assert.equal(summarizeToolBudget(budget, 2).outcome, "soft-reached");
	assert.equal(summarizeToolBudget(budget, 3).outcome, "soft-reached");
	assert.equal(summarizeToolBudget(budget, 4).outcome, "hard-reached");
	assert.equal(formatToolBudgetLine(summarizeToolBudget({ hard: 3, block: DEFAULT_TOOL_BUDGET_BLOCK }, 1)), "Tool budget: 1 call(s) (hard 3) → within-budget");
});

test("parseUsageBudget: at least one metric, positive numbers, soft ≤ hard, no unknown keys", () => {
	assert.equal(parseUsageBudget({}).ok, false);
	assert.equal(parseUsageBudget({ tokens: { hard: 0 } }).ok, false);
	assert.equal(parseUsageBudget({ tokens: { soft: 10, hard: 5 } }).ok, false);
	assert.equal(parseUsageBudget({ tokens: { hard: 5, extra: 1 } }).ok, false);
	assert.equal(parseUsageBudget({ minutes: { hard: 5 } }).ok, false);
	const ok = parseUsageBudget({ tokens: { soft: 1000, hard: 2000 }, costUsd: { hard: 0.5 } });
	assert.deepEqual(ok.ok && ok.value, { tokens: { soft: 1000, hard: 2000 }, costUsd: { hard: 0.5 } });
});

test("evaluateUsageBudget: reported usage only; hard on either metric exhausts, soft is advisory", () => {
	const budget = { tokens: { soft: 1000, hard: 2000 }, costUsd: { soft: 0.1, hard: 0.5 } };
	const within = evaluateUsageBudget(budget, { input: 300, output: 200, cost: 0.05 });
	assert.equal(within.exhausted, false);
	assert.equal(within.softExceeded, false);
	assert.equal(within.tokens?.used, 500);
	const soft = evaluateUsageBudget(budget, { input: 900, output: 200, cost: 0.05 });
	assert.equal(soft.exhausted, false);
	assert.equal(soft.softExceeded, true);
	assert.equal(soft.tokens?.outcome, "soft-exceeded");
	const hardCost = evaluateUsageBudget(budget, { input: 100, output: 100, cost: 0.5 });
	assert.equal(hardCost.exhausted, true);
	assert.equal(hardCost.reason, "costUsd");
	const line = formatUsageBudgetLine(hardCost);
	assert.equal(line, "Usage budget: tokens 200 of 1.0k/2.0k (within-budget); cost $0.50 of $0.10/$0.50 (hard-exceeded) → aborted on costUsd");
	assert.match(formatUsageBudgetAbortReason(hardCost), /^usage_budget: reported costUsd \$0\.50 reached hard limit \$0\.50/);
	const notice = formatUsageBudgetSoftNotice("w", "r", soft);
	assert.ok(notice.startsWith("[subagent-budget] agentId=w runId=r\n"));
	assert.ok(notice.includes("advisory"));
	const tokensOnly = evaluateUsageBudget({ tokens: { hard: 100 } }, { input: 60, output: 50, cost: 0 });
	assert.equal(tokensOnly.reason, "tokens");
	assert.equal(formatUsageBudgetLine(tokensOnly), "Usage budget: tokens 110 of 100 (hard-exceeded) → aborted on tokens");
});
