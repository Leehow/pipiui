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

test("inspection shell commands earn no validation credit, and only sustained repetition spins out", () => {
	const call = (id: string, command: string) => ({ id, name: "bash", arguments: { command } });
	// A novel recon command clears the counter: the cap counts consecutive spinning, and a
	// command aimed somewhere new is not spinning however high the counter had climbed.
	let decision = advanceSemanticProgress(createSemanticProgressState({ inspectOnlyStreak: 11 }), {
		type: "assistant-turn",
		toolCalls: [call("status-1", "NODE_OPTIONS=x git status --short")],
	});
	assert.equal(decision.terminate, false, "one novel recon command is not a stall");
	assert.equal(decision.state.progressEvents, 0, "git status is not validation evidence");
	assert.equal(decision.state.inspectOnlyStreak, 0, "novel recon resets the consecutive counter");
	// Repeating the identical command is the stall the cap exists for.
	for (let repeat = 1; repeat <= GENERAL_PURPOSE_SEMANTIC_TURN_CAP; repeat++) {
		decision = advanceSemanticProgress(decision.state, {
			type: "assistant-turn",
			toolCalls: [call(`status-${repeat + 1}`, "NODE_OPTIONS=x git status --short")],
		});
		assert.equal(
			decision.terminate,
			repeat === GENERAL_PURPOSE_SEMANTIC_TURN_CAP,
			`repeat ${repeat} terminates only at the cap`,
		);
	}
	assert.equal(decision.state.progressEvents, 0);
});

test("the stall counter is consecutive, not a lifetime tally", () => {
	// The shape that used to kill long workers: repeats scattered through real work. Eleven
	// repeat turns spread across a long run must leave the worker alive, because each one is
	// followed by recon that reaches somewhere new.
	let state = createSemanticProgressState();
	for (let round = 1; round <= 11; round++) {
		state = advanceSemanticProgress(state, {
			type: "assistant-turn",
			toolCalls: [{ id: `novel-${round}`, name: "read", arguments: { path: `src/file-${round}.ts` } }],
		}).state;
		const repeat = advanceSemanticProgress(state, {
			type: "assistant-turn",
			toolCalls: [{ id: `repeat-${round}`, name: "read", arguments: { path: `src/file-${round}.ts` } }],
		});
		assert.equal(repeat.terminate, false, `round ${round} must not terminate`);
		assert.equal(repeat.state.inspectOnlyStreak, 1, `round ${round} spin does not accumulate`);
		state = repeat.state;
	}
});

test("a signature is the whole argument set, so a changed argument is a changed target", () => {
	// Each of these pairs shares the field the old signature keyed on and differs elsewhere:
	// same grep root with a different pattern, same file at a different offset, same document
	// read section by section. All three used to collapse into one target and read as spinning.
	const pairs: Array<[Record<string, unknown>, Record<string, unknown>, string]> = [
		[{ pattern: "alpha", path: "Electron" }, { pattern: "beta", path: "Electron" }, "grep"],
		[{ path: "src/big.ts", offset: 1, limit: 500 }, { path: "src/big.ts", offset: 501, limit: 500 }, "read"],
		[{ paperId: "doc-1", section: "intro" }, { paperId: "doc-1", section: "methods" }, "paper_read"],
	];
	for (const [first, second, name] of pairs) {
		let decision = advanceSemanticProgress(createSemanticProgressState(), {
			type: "assistant-turn",
			toolCalls: [{ id: "a", name, arguments: first }],
		});
		decision = advanceSemanticProgress(decision.state, {
			type: "assistant-turn",
			toolCalls: [{ id: "b", name, arguments: second }],
		});
		assert.equal(decision.state.inspectOnlyStreak, 0, `${name}: a changed argument is new recon`);
		// The identical call, though, is still the spin the guard exists to catch.
		const identical = advanceSemanticProgress(decision.state, {
			type: "assistant-turn",
			toolCalls: [{ id: "c", name, arguments: second }],
		});
		assert.equal(identical.state.inspectOnlyStreak, 1, `${name}: an identical repeat still spins`);
	}
});

test("a changed worktree clears the stall however the worker wrote", () => {
	// The worker whose only writes go through an extension tool or a shell redirect: no
	// recognised mutation tool ever fires, so tool names alone can only ever say "no progress".
	const spin = createSemanticProgressState({ inspectOnlyStreak: 11 });
	const baseline = advanceSemanticProgress(spin, { type: "write-evidence", fingerprint: "files:2:abc" });
	assert.equal(baseline.state.inspectOnlyStreak, 11, "the first sample is only a baseline");
	assert.equal(baseline.state.writeFingerprint, "files:2:abc");

	const unchanged = advanceSemanticProgress(baseline.state, { type: "write-evidence", fingerprint: "files:2:abc" });
	assert.equal(unchanged.state.inspectOnlyStreak, 11, "an unchanged tree leaves the verdict standing");
	assert.equal(unchanged.state.progressEvents, 0);

	const changed = advanceSemanticProgress(baseline.state, { type: "write-evidence", fingerprint: "files:3:xyz" });
	assert.equal(changed.state.inspectOnlyStreak, 0, "a changed tree is progress, whatever tool made it");
	assert.equal(changed.state.progressEvents, 1);
	assert.equal(changed.state.writeFingerprint, "files:3:xyz");
	assert.deepEqual(changed.state.recentInspectSignatures, [], "after a write, re-reading is legitimate");
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
	assert.match(source, /applySemanticProgress\(\{ type: "settle" \}\)/);
	// The stall verdict must consult the tree, not just the tool names it happens to know.
	assert.match(source, /inspectOnlyStreak > streakBefore[\s\S]{0,400}?workerWriteFingerprint\(/);
	assert.match(source, /type: "write-evidence"/);
	assert.match(source, /currentResult\.stopReason = "semantic_no_progress"/);
	assert.match(source, /if \(!semanticNoProgress\) \{[\s\S]{0,120}?applyWorktreeRecovery/);
});
