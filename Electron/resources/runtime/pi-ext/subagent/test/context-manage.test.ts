import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	CONTEXT_MANAGE_MAX_CANDIDATES_DEFAULT,
	CONTEXT_MANAGE_NUDGE_CUSTOM_TYPE,
	CONTEXT_MANAGE_NUDGE_TEXT,
	CONTEXT_MANAGE_PARAMS,
	CONTEXT_OPTIMIZER_STATE_KEY,
	PLAN_TOOL_NAMES,
	WORKER_TOOL_NAMES,
	buildBoundedManifest,
	candidateRejection,
	contextManageConfigFromEnv,
	contextManageTool,
	executeContextManage,
	foldContextByIds,
	hasPendingNudgeThinkingRestore,
	inspectContext,
	isContextManageCandidate,
	isPlanToolName,
	queueContextManageNudge,
	restoreNudgeThinking,
	shouldRegisterContextManageTool,
	type ContextFoldManageApi,
	type ContextManageBlock,
	type ContextManageView,
	type FoldByIdsResult,
} from "../context-manage.ts";

function block(partial: Partial<ContextManageBlock> & Pick<ContextManageBlock, "id" | "kind" | "tokens">): ContextManageBlock {
	return {
		foldedTokens: 20,
		protected: false,
		held: false,
		frozen: false,
		folded: false,
		turn: 0,
		order: 0,
		...partial,
	};
}

function view(blocks: ContextManageBlock[], extra: Partial<ContextManageView> = {}): ContextManageView {
	return {
		blocks,
		liveTokens: blocks.reduce((sum, item) => sum + item.tokens, 0),
		contextWindow: 200_000,
		...extra,
	};
}

function memoryManage(initial: ContextManageView): ContextFoldManageApi & { lastFold: FoldByIdsResult | undefined; originals: Map<string, string> } {
	let current = initial;
	const originals = new Map<string, string>();
	for (const item of initial.blocks) originals.set(item.id, item.text ?? "");
	return {
		originals,
		lastFold: undefined,
		viewFor() {
			return current;
		},
		foldByIds(_messages, ids) {
			const foldedIds: string[] = [];
			const skipped: { id: string; reason: string }[] = [];
			const next = current.blocks.map((item) => {
				if (!ids.includes(item.id)) return item;
				if (!isContextManageCandidate(item)) {
					skipped.push({ id: item.id, reason: candidateRejection(item) ?? "rejected" });
					return item;
				}
				foldedIds.push(item.id);
				return { ...item, folded: true, frozen: true, text: `{#${item.id} FOLDED}` };
			});
			current = { ...current, blocks: next };
			const result = { messages: next, foldedIds, skipped };
			this.lastFold = result;
			return result;
		},
	};
}

test("schema accepts inspect and fold with a 20-id ceiling", () => {
	const schema = CONTEXT_MANAGE_PARAMS as {
		properties?: { action?: { anyOf?: unknown[] }; ids?: { maxItems?: number } };
		required?: string[];
	};
	assert.ok(schema.properties?.action);
	assert.equal(schema.properties?.ids?.maxItems, 20);
	assert.equal(CONTEXT_MANAGE_MAX_CANDIDATES_DEFAULT, 20);
	assert.deepEqual(contextManageConfigFromEnv({}), {
		maxCandidates: 20,
		maxFoldIds: 20,
		summaryChars: 160,
	});
});

test("worker depth does not register the tool; boss depth does", () => {
	assert.equal(shouldRegisterContextManageTool(1, "/repo"), false);
	assert.equal(shouldRegisterContextManageTool(0, undefined), false);
	assert.equal(shouldRegisterContextManageTool(0, "/repo"), true);
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /function registerContextManageTool/);
	assert.match(source, /shouldRegisterContextManageTool\(PIPIUI_DEPTH/);
	assert.match(source, /registerContextManageTool\(pi\)/);
});

test("inspect manifest is bounded, uses reportedTokens, and never returns full block text", async () => {
	const huge = `worker summary line\nSECRET_PAYLOAD ${"x".repeat(4000)}`;
	const manifest = buildBoundedManifest(view([
		block({ id: "u:1", kind: "user", tokens: 12, text: "please keep this", turn: 3 }),
		block({ id: "r:plan", kind: "tool_result", tokens: 80, toolName: "plan_publish", text: "# Plan\nDo the thing", turn: 1 }),
		block({ id: "r:ext", kind: "tool_result", tokens: 8_000, externalized: true, text: huge, turn: 0, order: 1 }),
		block({ id: "r:read", kind: "tool_result", tokens: 1_200, toolName: "read", text: "line 0: file contents", turn: 1, order: 2 }),
	], { liveTokens: 9_000, reportedTokens: 90_000, contextWindow: 200_000 }), { limit: 20, summaryChars: 40 });

	assert.equal(manifest.usedTokens, 90_000);
	assert.equal(manifest.contextWindow, 200_000);
	assert.ok(manifest.byCategory.tool_result);
	assert.ok(manifest.byCategory.user);
	assert.ok(manifest.byAge.length > 0);
	assert.equal(manifest.candidates.length, 2);
	assert.deepEqual(manifest.candidates.map((row) => row.id), ["r:ext", "r:read"]);
	assert.equal(manifest.candidates[0]?.externalized, true);
	assert.ok((manifest.candidates[0]?.summary.length ?? 0) <= 40);
	assert.doesNotMatch(JSON.stringify(manifest), /SECRET_PAYLOAD/);
	assert.doesNotMatch(JSON.stringify(manifest), /x{200}/);
});

test("candidates never include user messages, plans, or un-externalized worker evidence", () => {
	const blocks = [
		block({ id: "u:1", kind: "user", tokens: 10, text: "user intent" }),
		block({ id: "r:plan", kind: "tool_result", tokens: 40, toolName: "plan_publish", text: "steps" }),
		block({ id: "r:ev", kind: "tool_result", tokens: 400, agentId: "worker-a", text: "worker dump" }),
		block({ id: "r:done", kind: "tool_result", tokens: 400, text: "[subagent-done] agentId=worker-b" }),
		block({ id: "r:ok", kind: "tool_result", tokens: 400, toolName: "read", text: "ok" }),
		block({ id: "r:ext", kind: "tool_result", tokens: 400, agentId: "worker-c", externalized: true, text: "findings exist" }),
	];
	assert.equal(candidateRejection(blocks[0]!), "user_message");
	assert.equal(candidateRejection(blocks[1]!), "plan");
	assert.equal(candidateRejection(blocks[2]!), "unexternalized_evidence");
	assert.equal(candidateRejection(blocks[3]!), "unexternalized_evidence");
	assert.equal(isContextManageCandidate(blocks[4]!), true);
	assert.equal(isContextManageCandidate(blocks[5]!), true);
	const manifest = buildBoundedManifest(view(blocks));
	assert.deepEqual(manifest.candidates.map((row) => row.id).sort(), ["r:ext", "r:ok"]);
});

test("guard rejects real plan_* outputs, not fictional plan names", () => {
	assert.deepEqual([...PLAN_TOOL_NAMES].sort(), [
		"plan_approve",
		"plan_cancel",
		"plan_publish",
		"plan_task_update",
	]);
	assert.equal(isPlanToolName("plan_publish"), true);
	assert.equal(isPlanToolName("plan_task_update"), true);
	assert.equal(isPlanToolName("plan_approve"), true);
	assert.equal(isPlanToolName("plan_cancel"), true);
	assert.equal(isPlanToolName("plan_future_hook"), true);
	assert.equal(isPlanToolName("plan"), false);
	assert.equal(isPlanToolName("write_plan"), false);
	assert.equal(candidateRejection(block({
		id: "r:pub", kind: "tool_result", tokens: 80, toolName: "plan_publish", text: "plan body",
	})), "plan");
	assert.equal(candidateRejection(block({
		id: "r:upd", kind: "tool_result", tokens: 80, toolName: "plan_task_update", text: "task running",
	})), "plan");
});

test("inspect execute does not call an LLM and returns JSON without full text", async () => {
	const huge = `bash summary line\nKEEP_SECRET ${"y".repeat(3000)}`;
	const manage = memoryManage(view([
		block({ id: "r:ok", kind: "tool_result", tokens: 500, toolName: "bash", text: huge }),
	]));
	const result = await executeContextManage({ action: "inspect" }, {
		getMessages: () => [{ role: "user" }],
		manage,
	});
	assert.equal(result.details && (result.details as { llm?: boolean }).llm, false);
	assert.doesNotMatch(result.content[0]?.text ?? "", /KEEP_SECRET/);
	assert.doesNotMatch(result.content[0]?.text ?? "", /y{200}/);
	assert.match(result.content[0]?.text ?? "", /"candidates"/);
});

test("illegal action is rejected", async () => {
	const result = await executeContextManage({ action: "summarize" }, { getMessages: () => [] });
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /inspect or fold/);
});

test("fold executes only safe ids and refuses unknown / user / plan ids", () => {
	const manage = memoryManage(view([
		block({ id: "u:1", kind: "user", tokens: 10, text: "do not fold me" }),
		block({ id: "r:plan", kind: "tool_result", tokens: 40, toolName: "plan_publish", text: "plan body" }),
		block({ id: "r:ok", kind: "tool_result", tokens: 400, toolName: "read", text: "original file body" }),
	]));
	const result = foldContextByIds({
		getMessages: () => [{ role: "toolResult" }],
		manage,
	}, ["u:1", "r:plan", "r:ok", "r:missing"]);
	assert.deepEqual(result.foldedIds, ["r:ok"]);
	assert.ok(result.skipped.some((row) => row.id === "u:1" && row.reason === "user_message"));
	assert.ok(result.skipped.some((row) => row.id === "r:plan" && row.reason === "plan"));
	assert.ok(result.skipped.some((row) => row.id === "r:missing" && row.reason === "not_in_session"));
	assert.match(String(manage.viewFor([]).blocks.find((item) => item.id === "r:ok")?.text), /FOLDED/);
	assert.equal(manage.originals.get("r:ok"), "original file body");
});

test("fold refuses every id while a primary context optimizer owns the session", () => {
	const globals = globalThis as Record<string | symbol, unknown>;
	const previous = globals[CONTEXT_OPTIMIZER_STATE_KEY];
	globals[CONTEXT_OPTIMIZER_STATE_KEY] = {
		version: 1,
		sessionId: "session-1",
		primaryOwner: "pipiui-headroom",
	};
	try {
		const manage = memoryManage(view([
			block({ id: "r:ok", kind: "tool_result", tokens: 400, toolName: "read", text: "original file body" }),
		]));
		const result = foldContextByIds({ getMessages: () => [{ role: "toolResult" }], manage }, ["r:ok"]);
		assert.deepEqual(result.foldedIds, []);
		assert.equal(result.skipped[0]?.reason, "primary_optimizer_active");
		assert.match(result.problem ?? "", /standby/);
		assert.equal(manage.viewFor([]).blocks[0]?.text, "original file body");
	} finally {
		if (previous === undefined) delete globals[CONTEXT_OPTIMIZER_STATE_KEY];
		else globals[CONTEXT_OPTIMIZER_STATE_KEY] = previous;
	}
});

test("fold via the live manage API is recallable from the stored original", async () => {
	const original = "line 0: the exact tool output";
	const manage = memoryManage(view([
		block({ id: "r:ok", kind: "tool_result", tokens: 400, toolName: "read", text: original }),
	]));
	const result = await executeContextManage({ action: "fold", ids: ["r:ok"] }, {
		getMessages: () => [{ role: "toolResult" }],
		manage,
	});
	assert.match(result.content[0]?.text ?? "", /folded 1/);
	assert.notEqual(manage.viewFor([]).blocks[0]?.text, original);
	assert.equal(manage.originals.get("r:ok"), original);
});

test("nudge uses triggerTurn followUp, once-per-epoch is owned by the idle timer", () => {
	const calls: unknown[][] = [];
	assert.equal(queueContextManageNudge({ sendMessage: (...args: unknown[]) => calls.push(args) }), true);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0]?.[1], { triggerTurn: true, deliverAs: "followUp" });
	assert.equal((calls[0]?.[0] as { customType?: string }).customType, CONTEXT_MANAGE_NUDGE_CUSTOM_TYPE);
	assert.equal(((calls[0]?.[0] as { details?: { thinkingApplied?: boolean } }).details)?.thinkingApplied, false);
	assert.match(CONTEXT_MANAGE_NUDGE_TEXT, /context_manage/);
	assert.doesNotMatch(CONTEXT_MANAGE_NUDGE_TEXT, /thinking=low/);
	const source = readFileSync(new URL("../idle-fold-timer.ts", import.meta.url), "utf8");
	assert.match(source, /nudgeSent/);
	assert.match(source, /One idle epoch: at most one nudge/);
});

test("nudge actually lowers session thinking and restore puts it back", () => {
	const levels: string[] = [];
	let current = "high";
	const calls: unknown[][] = [];
	const pi = {
		sendMessage: (...args: unknown[]) => calls.push(args),
		getThinkingLevel: () => current,
		setThinkingLevel: (level: string) => {
			levels.push(level);
			current = level;
		},
	};
	assert.equal(queueContextManageNudge(pi, { watermark: 0.3 }), true);
	assert.deepEqual(levels, ["low"]);
	assert.equal(current, "low");
	assert.equal(hasPendingNudgeThinkingRestore(), true);
	const details = (calls[0]?.[0] as { details?: Record<string, unknown> }).details;
	assert.equal(details?.thinkingApplied, true);
	assert.equal(details?.thinking, "low");
	assert.equal(details?.watermark, 0.3);
	restoreNudgeThinking(pi);
	assert.deepEqual(levels, ["low", "high"]);
	assert.equal(current, "high");
	assert.equal(hasPendingNudgeThinkingRestore(), false);
});

test("nudge does not raise thinking that is already at or below low", () => {
	const levels: string[] = [];
	assert.equal(queueContextManageNudge({
		sendMessage: () => undefined,
		getThinkingLevel: () => "off",
		setThinkingLevel: (level: string) => levels.push(level),
	}), true);
	assert.deepEqual(levels, []);
	assert.equal(hasPendingNudgeThinkingRestore(), false);
});

test("failed nudge restores thinking immediately", () => {
	const levels: string[] = [];
	let current = "medium";
	assert.equal(queueContextManageNudge({
		sendMessage: () => {
			throw new Error("busy");
		},
		getThinkingLevel: () => current,
		setThinkingLevel: (level: string) => {
			levels.push(level);
			current = level;
		},
	}), false);
	assert.deepEqual(levels, ["low", "medium"]);
	assert.equal(hasPendingNudgeThinkingRestore(), false);
});

test("successful fold notifies the idle registry seam", () => {
	const folded: string[][] = [];
	const manage = memoryManage(view([
		block({ id: "r:ok", kind: "tool_result", tokens: 400, toolName: "read", text: "body" }),
	]));
	const result = foldContextByIds({
		getMessages: () => [{ role: "toolResult" }],
		manage,
		onSuccessfulFold: (ids) => folded.push([...ids]),
	}, ["r:ok"]);
	assert.deepEqual(result.foldedIds, ["r:ok"]);
	assert.deepEqual(folded, [["r:ok"]]);
});

test("context_manage tool execute is wired to inspect/fold", async () => {
	const tool = contextManageTool({
		getMessages: () => [{ role: "user" }],
		manage: memoryManage(view([
			block({ id: "r:ok", kind: "tool_result", tokens: 100, toolName: "read", text: "hello" }),
		])),
	});
	assert.equal(tool.name, "context_manage");
	const inspected = await tool.execute("t1", { action: "inspect" });
	assert.match(inspected.content[0]?.text ?? "", /r:ok/);
});
