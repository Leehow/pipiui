import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	GENERAL_PURPOSE_SEMANTIC_TURN_CAP,
	advanceSemanticProgress,
	createSemanticProgressState,
} from "../runtime-policy.ts";

test("inspection-only general-purpose turns terminate at the bounded semantic cap", () => {
	let state = createSemanticProgressState();
	for (let turn = 1; turn <= GENERAL_PURPOSE_SEMANTIC_TURN_CAP; turn++) {
		const decision = advanceSemanticProgress(state, {
			type: "assistant-turn",
			toolCalls: [{ id: `read-${turn}`, name: turn % 2 ? "read" : "grep", arguments: {} }],
		});
		state = decision.state;
		assert.equal(decision.terminate, turn === GENERAL_PURPOSE_SEMANTIC_TURN_CAP);
	}
	assert.equal(state.inspectOnlyStreak, 12);
	assert.equal(state.progressEvents, 0);
});

test("only successful mutation or validation resets semantic no-progress", () => {
	let state = createSemanticProgressState({ inspectOnlyStreak: 11 });
	let decision = advanceSemanticProgress(state, {
		type: "assistant-turn",
		toolCalls: [{ id: "edit-1", name: "edit", arguments: { path: "src/a.ts" } }],
	});
	assert.equal(decision.terminate, false, "the boundary mutation must await its result");
	decision = advanceSemanticProgress(decision.state, {
		type: "tool-result",
		toolCallId: "edit-1",
		toolName: "edit",
		isError: false,
	});
	assert.equal(decision.state.inspectOnlyStreak, 0);
	assert.equal(decision.state.progressEvents, 1);

	state = createSemanticProgressState({ inspectOnlyStreak: 11 });
	decision = advanceSemanticProgress(state, {
		type: "assistant-turn",
		toolCalls: [{ id: "test-1", name: "bash", arguments: { command: "NODE_OPTIONS=--conditions=import npx --no-install tsx --test test/a.test.ts" } }],
	});
	assert.equal(decision.terminate, false, "recognized validation must await its result");
	decision = advanceSemanticProgress(decision.state, {
		type: "tool-result",
		toolCallId: "test-1",
		toolName: "bash",
		isError: false,
	});
	assert.equal(decision.state.inspectOnlyStreak, 0);
	assert.equal(decision.state.progressEvents, 1);

	state = createSemanticProgressState({ inspectOnlyStreak: 11 });
	decision = advanceSemanticProgress(state, {
		type: "assistant-turn",
		toolCalls: [{ id: "write-1", name: "write", arguments: { path: "src/a.ts" } }],
	});
	decision = advanceSemanticProgress(decision.state, {
		type: "tool-result",
		toolCallId: "write-1",
		toolName: "write",
		isError: true,
	});
	assert.equal(decision.terminate, true, "a failed write is still a no-progress turn");
	assert.equal(decision.state.progressEvents, 0);
});

test("inspection shell commands never masquerade as validation", () => {
	const decision = advanceSemanticProgress(createSemanticProgressState({ inspectOnlyStreak: 11 }), {
		type: "assistant-turn",
		toolCalls: [{ id: "status-1", name: "bash", arguments: { command: "NODE_OPTIONS=x git status --short" } }],
	});
	assert.equal(decision.terminate, true);
});

test("id-less semantic calls pair only by tool name and missing results settle boundedly", () => {
	let decision = advanceSemanticProgress(createSemanticProgressState({ inspectOnlyStreak: 11 }), {
		type: "assistant-turn",
		toolCalls: [{ id: "", name: "edit", arguments: { path: "src/a.ts" } }],
	});
	assert.equal(decision.terminate, false);
	assert.deepEqual(decision.state.pendingAnonymousTools, ["edit"]);

	const unrelated = advanceSemanticProgress(decision.state, {
		type: "tool-result",
		toolCallId: "",
		toolName: "bash",
		isError: false,
	});
	assert.deepEqual(unrelated.state, decision.state, "an unrelated anonymous result cannot reset progress");

	const matched = advanceSemanticProgress(decision.state, {
		type: "tool-result",
		toolCallId: "",
		toolName: "edit",
		isError: false,
	});
	assert.equal(matched.state.inspectOnlyStreak, 0);
	assert.equal(matched.state.progressEvents, 1);

	decision = advanceSemanticProgress(createSemanticProgressState({ inspectOnlyStreak: 11 }), {
		type: "assistant-turn",
		toolCalls: [{ id: "", name: "edit", arguments: { path: "src/a.ts" } }],
	});
	const settled = advanceSemanticProgress(decision.state, { type: "settle" });
	assert.equal(settled.terminate, true);
	assert.match(settled.state.lastSummary, /missing result|settlement/);
});

test("production event and closeout seams remain wired to semantic progress", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /type: "assistant-turn"[\s\S]{0,300}?toolCalls: semanticToolCalls/);
	assert.match(source, /onResult: observeSemanticToolResult/);
	assert.match(source, /advanceSemanticProgress\(semanticProgress, \{ type: "settle" \}\)/);
	assert.match(source, /currentResult\.stopReason = "semantic_no_progress"/);
	assert.match(source, /if \(!semanticNoProgress\) \{[\s\S]{0,120}?applyWorktreeRecovery/);
});
