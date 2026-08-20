import test from "node:test";
import assert from "node:assert/strict";

import {
	buildCompactionLlmPrompt,
	buildDeterministicSummary,
	COMPACTION_CHECKPOINT_HEADINGS,
	evaluateCompactionLlmSummary,
	handleSessionBeforeCompact,
	mergeCheckpointSummary,
} from "../main-compaction.ts";

const structuredSummary = `## Goal
Ship compaction quality.

## Constraints
Do not package the App.

## Progress
### Done
- [x] Read current handler
### In Progress
- [ ] Quality gate
### Blocked
- none

## Key Decisions
- **LLM fast path**: structured checkpoint

## Files and Verification
- Electron/resources/runtime/pi-ext/subagent/main-compaction.ts
- tests: node --test (credible)

## Errors and Open Questions
- none

## Next Steps
1. Land tests

## Critical Context
- agentId worker-1 worktree /tmp/wt status running
`;

function model() {
	return {
		provider: "openai",
		id: "gpt-test",
		reasoning: false as const,
		thinkingLevelMap: { off: "none", low: "low" },
		contextWindow: 128_000,
	};
}

function ctx() {
	return {
		model: model(),
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "sk-test" }),
			find: () => model(),
		},
	};
}

function event(preparation: Record<string, unknown> = {}) {
	return {
		reason: "auto",
		preparation: {
			messagesToSummarize: [
				{ role: "user", content: "Implement compaction quality. Do not treat the plan as done." },
			],
			turnPrefixMessages: [],
			tokensBefore: 12_345,
			firstKeptEntryId: "entry-kept-1",
			fileOps: { edited: ["main-compaction.ts"] },
			...preparation,
		},
	};
}

function assistantText(text: string) {
	return { content: [{ type: "text", text }], usage: { input: 1, output: 2, totalTokens: 3 } };
}

test("prompt requires checkpoint headings, verbatim facts, and UPDATE rules", () => {
	const fresh = buildCompactionLlmPrompt("[User]: hi", "", "auto");
	for (const heading of COMPACTION_CHECKPOINT_HEADINGS) {
		assert.match(fresh, new RegExp(`## ${heading}`));
	}
	assert.match(fresh, /### Done/);
	assert.match(fresh, /### In Progress/);
	assert.match(fresh, /### Blocked/);
	assert.match(fresh, /User corrections/);
	assert.match(fresh, /Exact file paths/);
	assert.match(fresh, /Error strings/);
	assert.match(fresh, /Test evidence/);
	assert.match(fresh, /agentId/);
	assert.match(fresh, /Do not treat a plan as completed/);
	assert.doesNotMatch(fresh, /This is an UPDATE/);

	const update = buildCompactionLlmPrompt("[User]: hi", "## Goal\nold", "auto");
	assert.match(update, /This is an UPDATE/);
	assert.match(update, /Keep facts that are still true/);
	assert.match(update, /Drop resolved blockers/);
	assert.match(update, /Do not stack or repeat/);
	assert.match(update, /<previous-summary>/);
});

test("evaluateCompactionLlmSummary accepts a full structured checkpoint", () => {
	const gate = evaluateCompactionLlmSummary(structuredSummary);
	assert.equal(gate.accept, true);
	assert.equal(gate.merge, false);
	assert.deepEqual(gate.missing, []);
});

test("empty or short output is rejected", () => {
	assert.equal(evaluateCompactionLlmSummary("").accept, false);
	assert.equal(evaluateCompactionLlmSummary("   ").merge, false);
	assert.equal(evaluateCompactionLlmSummary("too short").accept, false);
	assert.equal(evaluateCompactionLlmSummary("x".repeat(40)).accept, false);
});

test("prose missing Goal / Progress / Next Steps is not accepted", () => {
	const prose =
		"The user wanted compaction quality. We talked a lot and should keep going with more work on files and verification without headings.";
	const gate = evaluateCompactionLlmSummary(prose);
	assert.equal(gate.accept, false);
	assert.equal(gate.merge, false);
});

test("mergeCheckpointSummary fills missing headings from deterministic", () => {
	const partial = `## Goal
Keep going.

## Constraints
none

## Progress
### In Progress
- work

## Next Steps
1. test
`;
	const det = buildDeterministicSummary({
		serialized: "[User]: goal text\n[Assistant]: ok",
		tokensBefore: 1,
		messageCount: 2,
		reason: "auto",
	});
	const merged = mergeCheckpointSummary(partial, det);
	for (const heading of COMPACTION_CHECKPOINT_HEADINGS) {
		assert.match(merged, new RegExp(`## ${heading}`));
	}
});

test("structured LLM summary is accepted as llm-fast", async () => {
	const calls: unknown[] = [];
	const complete = async (...args: unknown[]) => {
		calls.push(args);
		return assistantText(structuredSummary);
	};
	const result = await handleSessionBeforeCompact(event(), ctx(), { complete: complete as never });
	assert.equal(result?.compaction.mode ?? (result?.compaction.details as { mode?: string })?.mode, "llm-fast");
	const details = result?.compaction.details as { source: string; mode: string; reason: string };
	assert.equal(details.source, "pipiui");
	assert.equal(details.mode, "llm-fast");
	assert.equal(details.reason, "auto");
	assert.equal(result?.compaction.firstKeptEntryId, "entry-kept-1");
	assert.equal(result?.compaction.tokensBefore, 12_345);
	assert.equal(result?.compaction.summary, structuredSummary.trim());
	assert.equal(calls.length, 1);
});

test("completeSimple receives cacheRetention none and an independent sessionId", async () => {
	let options: Record<string, unknown> | undefined;
	const complete = async (_model: unknown, _ctx: unknown, opts: Record<string, unknown>) => {
		options = opts;
		return assistantText(structuredSummary);
	};
	await handleSessionBeforeCompact(event(), ctx(), { complete: complete as never });
	assert.equal(options?.cacheRetention, "none");
	assert.equal(typeof options?.sessionId, "string");
	assert.match(String(options?.sessionId), /^[0-9a-f-]{36}$/i);
	assert.equal(options?.reasoning, "off");
	assert.ok(options?.signal instanceof AbortSignal);
});

test("prose without key sections falls back to deterministic", async () => {
	const complete = async () =>
		assistantText(
			"Just a long paragraph about the session with no markdown headings at all, repeating filler so it is not considered short output by the quality gate.",
		);
	const result = await handleSessionBeforeCompact(event(), ctx(), { complete: complete as never });
	const details = result?.compaction.details as { mode: string; messageCount?: number };
	assert.equal(details.mode, "deterministic");
	assert.match(String(result?.compaction.summary), /## Goal/);
	assert.match(String(result?.compaction.summary), /<!-- pipiui-compaction deterministic/);
	assert.equal(result?.compaction.firstKeptEntryId, "entry-kept-1");
});

test("empty LLM text falls back to deterministic", async () => {
	const complete = async () => assistantText("");
	const result = await handleSessionBeforeCompact(event(), ctx(), { complete: complete as never });
	assert.equal((result?.compaction.details as { mode: string }).mode, "deterministic");
});

test("LLM throw fail-opens to deterministic", async () => {
	const complete = async () => {
		throw new Error("provider timeout");
	};
	const result = await handleSessionBeforeCompact(event(), ctx(), { complete: complete as never });
	assert.equal((result?.compaction.details as { mode: string }).mode, "deterministic");
	assert.equal(result?.compaction.firstKeptEntryId, "entry-kept-1");
});

test("previousSummary is included in the LLM prompt as UPDATE", async () => {
	let prompt = "";
	const complete = async (_m: unknown, context: { messages: Array<{ content: Array<{ text: string }> }> }) => {
		prompt = context.messages[0].content[0].text;
		return assistantText(structuredSummary);
	};
	await handleSessionBeforeCompact(
		event({ previousSummary: "## Goal\nPrior work" }),
		ctx(),
		{ complete: complete as never },
	);
	assert.match(prompt, /This is an UPDATE/);
	assert.match(prompt, /Prior work/);
});
