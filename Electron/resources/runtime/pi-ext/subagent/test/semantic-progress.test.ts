import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	GENERAL_PURPOSE_SEMANTIC_TURN_CAP,
	advanceSemanticProgress,
	createSemanticProgressState,
} from "../runtime-policy.ts";

test("inspection-only turns terminate at the spin cap only when targets repeat", () => {
	let state = createSemanticProgressState();
	// Alternating two empty-argument calls: each first occurrence is novel recon, every
	// later one is spin. Termination lands at two novel turns plus the spin cap.
	let terminatedAt = 0;
	for (let turn = 1; turn <= GENERAL_PURPOSE_SEMANTIC_TURN_CAP + 3; turn++) {
		const decision = advanceSemanticProgress(state, {
			type: "assistant-turn",
			toolCalls: [{ id: `read-${turn}`, name: turn % 2 ? "read" : "grep", arguments: {} }],
		});
		state = decision.state;
		if (decision.terminate) { terminatedAt = turn; break; }
	}
	assert.equal(terminatedAt, GENERAL_PURPOSE_SEMANTIC_TURN_CAP + 2);
	assert.equal(state.inspectOnlyStreak, 12);
	assert.equal(state.progressEvents, 0);
});

test("recon over changing targets is not a stall and never approaches the cap", () => {
	let state = createSemanticProgressState();
	for (let turn = 1; turn <= 30; turn++) {
		const decision = advanceSemanticProgress(state, {
			type: "assistant-turn",
			toolCalls: [
				{ id: `read-${turn}`, name: "read", arguments: { path: `src/file-${turn}.ts` } },
				{ id: `grep-${turn}`, name: "grep", arguments: { pattern: `symbol${turn}` } },
			],
		});
		state = decision.state;
		assert.equal(decision.terminate, false, `recon turn ${turn} must not terminate`);
	}
	assert.equal(state.inspectOnlyStreak, 0);
	assert.equal(state.progressEvents, 0, "recon earns no progress credit — it just is not a stall");
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

test("node --test — the repo's mandated worker verify command — counts as validation", () => {
	for (const command of [
		"node --test",
		"node --test test/a.test.ts",
		"node --experimental-strip-types --test test/a.test.ts",
		"cd Electron && node --test resources/runtime/pi-ext/subagent/test/semantic-progress.test.ts",
	]) {
		const id = `test-${command.length}`;
		let decision = advanceSemanticProgress(createSemanticProgressState({ inspectOnlyStreak: 11 }), {
			type: "assistant-turn",
			toolCalls: [{ id, name: "bash", arguments: { command } }],
		});
		assert.equal(decision.terminate, false, command);
		decision = advanceSemanticProgress(decision.state, {
			type: "tool-result",
			toolCallId: id,
			toolName: "bash",
			isError: false,
		});
		assert.equal(decision.state.inspectOnlyStreak, 0, command);
		assert.equal(decision.state.progressEvents, 1, command);
	}
});

test("inspection shell commands earn no validation credit, and repeating them spins out", () => {
	const call = (id: string) => ({ id, name: "bash", arguments: { command: "NODE_OPTIONS=x git status --short" } });
	// First occurrence: novel recon — no validation credit, but also no stall increment.
	let decision = advanceSemanticProgress(createSemanticProgressState({ inspectOnlyStreak: 11 }), {
		type: "assistant-turn",
		toolCalls: [call("status-1")],
	});
	assert.equal(decision.terminate, false, "one novel recon command is not a stall");
	assert.equal(decision.state.progressEvents, 0, "git status is not validation evidence");
	assert.equal(decision.state.inspectOnlyStreak, 11);
	// Repeating the identical command is the stall the cap exists for.
	decision = advanceSemanticProgress(decision.state, {
		type: "assistant-turn",
		toolCalls: [call("status-2")],
	});
	assert.equal(decision.terminate, true, "repeating the identical inspection command hits the spin cap");
	assert.equal(decision.state.progressEvents, 0);
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
