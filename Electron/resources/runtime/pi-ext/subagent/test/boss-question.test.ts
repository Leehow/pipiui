import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ASK_BOSS_GUIDANCE,
	ASK_BOSS_TOOL_NAME,
	DEFAULT_ASK_BOSS_TIMEOUT_MS,
	MAX_ASK_BOSS_TIMEOUT_MS,
	MIN_ASK_BOSS_TIMEOUT_MS,
	QUESTION_MESSAGE_PREFIX,
	SUBAGENT_REPLY_TOOL_NAME,
	formatBossQuestionsLine,
	formatQuestionForBoss,
	listQuestions,
	markQuestionTimedOut,
	pendingQuestions,
	questionRunDir,
	questionStatuses,
	readAnswer,
	registerAskBossTool,
	registerSubagentReplyTool,
	removeQuestionRun,
	replyToWorkerQuestion,
	resolveAskBossTimeoutMs,
	summarizeQuestionRun,
	writeAnswer,
	writeQuestion,
} from "../boss-question.ts";
import { ASK_BOSS_TOOL_NAME as POLICY_ASK_BOSS_TOOL_NAME, resolveSubagentToolSelection } from "../desktop-tool-policy.mjs";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "pipiui-boss-question-"));
}

type RegisteredTool = {
	name: string;
	description: string;
	execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown; isError?: boolean }>;
};

/** The only ExtensionAPI surface these tools touch. */
function fakePi(): { tools: Map<string, RegisteredTool>; api: unknown } {
	const tools = new Map<string, RegisteredTool>();
	return {
		tools,
		api: {
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
		},
	};
}

test("file contract: ids are monotonic, pending excludes answered and timed-out", () => {
	const dir = questionRunDir(tempRoot(), "quota-pill", "run-1");
	assert.equal(dir.endsWith(join(".pi", "agent-questions", "quota-pill", "run-1")), true);
	const first = writeQuestion(dir, { agentId: "quota-pill", runId: "run-1", question: "Keep the old endpoint?", choices: ["yes", "no"], context: "src/api.ts:40" });
	const second = writeQuestion(dir, { agentId: "quota-pill", runId: "run-1", question: "Second" });
	assert.equal(first.id, 1);
	assert.equal(second.id, 2);
	assert.deepEqual(first.choices, ["yes", "no"]);
	assert.equal(first.context, "src/api.ts:40");
	assert.deepEqual(listQuestions(dir).map((entry) => entry.id), [1, 2]);
	assert.deepEqual(pendingQuestions(dir).map((entry) => entry.id), [1, 2]);

	writeAnswer(dir, 1, "yes, keep it");
	assert.equal(readAnswer(dir, 1)?.answer, "yes, keep it");
	assert.deepEqual(pendingQuestions(dir).map((entry) => entry.id), [2]);
	markQuestionTimedOut(dir, 2);
	assert.deepEqual(pendingQuestions(dir), []);
	assert.deepEqual(questionStatuses(dir).map((entry) => entry.state), ["answered", "timed-out"]);
	// No stray temp files after atomic writes.
	assert.equal(readdirSync(dir).some((entry) => entry.endsWith(".tmp")), false);
	removeQuestionRun(dir);
	assert.equal(existsSync(dir), false);
});

test("terminal tally: answered vs unanswered (timed out or still pending), absent when never asked", () => {
	const dir = questionRunDir(tempRoot(), "w", "run-t");
	assert.equal(summarizeQuestionRun(dir), undefined);
	writeQuestion(dir, { agentId: "w", runId: "run-t", question: "one" });
	writeQuestion(dir, { agentId: "w", runId: "run-t", question: "two" });
	writeQuestion(dir, { agentId: "w", runId: "run-t", question: "three" });
	writeAnswer(dir, 1, "yes");
	markQuestionTimedOut(dir, 2);
	// qid 3 is still pending at the run's end: the worker was cut off waiting, so it counts as unanswered.
	const summary = summarizeQuestionRun(dir);
	assert.deepEqual(summary, { asked: 3, answered: 1, unanswered: 2 });
	assert.equal(
		formatBossQuestionsLine(summary!),
		"Questions to you: asked 3, answered 1 — 2 went unanswered, so the worker proceeded on its own assumption there; check its report for the assumption it states",
	);
	assert.equal(formatBossQuestionsLine({ asked: 1, answered: 1, unanswered: 0 }), "Questions to you: asked 1, answered 1");
});

test("question sizes are clamped and the Boss message carries the machine-readable line first", () => {
	const dir = questionRunDir(tempRoot(), "a", "r");
	const long = "x".repeat(20_000);
	const question = writeQuestion(dir, {
		agentId: "a",
		runId: "r",
		question: long,
		choices: Array.from({ length: 12 }, (_, index) => `choice ${index}`),
		context: long,
	});
	assert.equal(question.question.length, 8_001);
	assert.equal(question.choices?.length, 8);
	assert.equal(question.context?.length, 8_001);
	const text = formatQuestionForBoss({ ...question, question: "Which port?", choices: ["8080", "9090"], context: "compose.yml" }, { workerName: "general-purpose", timeoutMs: 600_000 });
	const lines = text.split("\n");
	assert.equal(lines[0], `${QUESTION_MESSAGE_PREFIX} agentId=a runId=r qid=1`);
	assert.ok(lines[1].includes("general-purpose") && lines[1].includes("10m"));
	assert.ok(text.includes("Question: Which port?"));
	assert.ok(text.includes("  1. 8080") && text.includes("  2. 9090"));
	assert.ok(text.includes("Context: compose.yml"));
	assert.ok(text.includes(`${SUBAGENT_REPLY_TOOL_NAME}({ agentId: "a", runId: "r", answer: "..." })`));
});

test("timeout env is clamped to the documented window", () => {
	assert.equal(resolveAskBossTimeoutMs({}), DEFAULT_ASK_BOSS_TIMEOUT_MS);
	assert.equal(resolveAskBossTimeoutMs({ PIPIUI_ASK_BOSS_TIMEOUT_MS: "garbage" }), DEFAULT_ASK_BOSS_TIMEOUT_MS);
	assert.equal(resolveAskBossTimeoutMs({ PIPIUI_ASK_BOSS_TIMEOUT_MS: "1" }), MIN_ASK_BOSS_TIMEOUT_MS);
	assert.equal(resolveAskBossTimeoutMs({ PIPIUI_ASK_BOSS_TIMEOUT_MS: String(10 ** 12) }), MAX_ASK_BOSS_TIMEOUT_MS);
	assert.equal(resolveAskBossTimeoutMs({ PIPIUI_ASK_BOSS_TIMEOUT_MS: "120000" }), 120_000);
});

test("reply: stale run, no pending, ambiguity, exact id, answered, timed-out", () => {
	const root = tempRoot();
	const running = new Map<string, string>([["w", "run-2"]]);
	const answered: Array<[string, string, number]> = [];
	const deps = {
		dirFor: (agentId: string, runId: string) => questionRunDir(root, agentId, runId),
		currentRunId: (agentId: string) => running.get(agentId),
		onAnswered: (agentId: string, runId: string, id: number) => { answered.push([agentId, runId, id]); },
	};
	assert.equal(replyToWorkerQuestion({ agentId: "ghost", runId: "run-2", answer: "x" }, deps).ok, false);
	const stale = replyToWorkerQuestion({ agentId: "w", runId: "run-1", answer: "x" }, deps);
	assert.equal(stale.ok, false);
	assert.ok(stale.message.includes("stale"));
	const none = replyToWorkerQuestion({ agentId: "w", runId: "run-2", answer: "x" }, deps);
	assert.equal(none.ok, false);
	assert.ok(none.message.includes("No pending question"));

	const dir = questionRunDir(root, "w", "run-2");
	writeQuestion(dir, { agentId: "w", runId: "run-2", question: "one" });
	writeQuestion(dir, { agentId: "w", runId: "run-2", question: "two" });
	const ambiguous = replyToWorkerQuestion({ agentId: "w", runId: "run-2", answer: "x" }, deps);
	assert.equal(ambiguous.ok, false);
	assert.ok(ambiguous.message.includes("questionId"));
	const exact = replyToWorkerQuestion({ agentId: "w", runId: "run-2", answer: "answer two", questionId: 2 }, deps);
	assert.equal(exact.ok, true);
	assert.equal(exact.questionId, 2);
	assert.equal(readAnswer(dir, 2)?.answer, "answer two");
	assert.deepEqual(answered, [["w", "run-2", 2]]);
	// With one left pending, no id is needed.
	const single = replyToWorkerQuestion({ agentId: "w", runId: "run-2", answer: "answer one" }, deps);
	assert.equal(single.ok, true);
	assert.equal(single.questionId, 1);
	const again = replyToWorkerQuestion({ agentId: "w", runId: "run-2", answer: "dup", questionId: 1 }, deps);
	assert.equal(again.ok, false);
	assert.ok(again.message.includes("already answered"));
	writeQuestion(dir, { agentId: "w", runId: "run-2", question: "three" });
	markQuestionTimedOut(dir, 3);
	const late = replyToWorkerQuestion({ agentId: "w", runId: "run-2", answer: "late", questionId: 3 }, deps);
	assert.equal(late.ok, false);
	assert.ok(late.message.includes("timed out"));
});

test("ask_boss tool blocks until an answer file appears, then returns it verbatim", async () => {
	const dir = questionRunDir(tempRoot(), "w", "run-9");
	const { tools, api } = fakePi();
	registerAskBossTool(api as never, { dir, agentId: "w", runId: "run-9", timeoutMs: 5_000, pollMs: 10 });
	const tool = tools.get(ASK_BOSS_TOOL_NAME)!;
	assert.ok(tool.description.includes("Blocks until the Boss answers"));
	const pending = tool.execute("call-1", { question: "Rename the flag?", choices: ["yes", "no"] });
	// The question is on disk before any answer exists; that is what the Boss side reads.
	await new Promise((resolve) => setTimeout(resolve, 30));
	const [question] = pendingQuestions(dir);
	assert.equal(question.question, "Rename the flag?");
	assert.equal(question.toolCallId, "call-1");
	writeAnswer(dir, question.id, "yes, rename it");
	const result = await pending;
	assert.equal(result.isError, undefined);
	assert.equal(result.content[0].text, "Answer from the Boss:\nyes, rename it");
	assert.deepEqual(result.details, { questionId: 1 });
});

test("ask_boss tool times out into an error the worker can act on, and marks the question", async () => {
	const dir = questionRunDir(tempRoot(), "w", "run-10");
	const { tools, api } = fakePi();
	registerAskBossTool(api as never, { dir, agentId: "w", runId: "run-10", timeoutMs: 120, pollMs: 10 });
	const result = await tools.get(ASK_BOSS_TOOL_NAME)!.execute("call-2", { question: "Anyone?" });
	assert.equal(result.isError, true);
	assert.ok(result.content[0].text.includes("Proceed with your best judgment"));
	assert.deepEqual(result.details, { questionId: 1, timedOut: true });
	assert.deepEqual(pendingQuestions(dir), []);
	assert.equal(questionStatuses(dir)[0].state, "timed-out");
});

test("ask_boss tool stops waiting when the run is aborted", async () => {
	const dir = questionRunDir(tempRoot(), "w", "run-11");
	const { tools, api } = fakePi();
	registerAskBossTool(api as never, { dir, agentId: "w", runId: "run-11", timeoutMs: 60_000, pollMs: 10 });
	const controller = new AbortController();
	const pending = tools.get(ASK_BOSS_TOOL_NAME)!.execute("call-3", { question: "Still there?" }, controller.signal);
	setTimeout(() => controller.abort(), 20);
	const result = await pending;
	assert.equal(result.isError, true);
	assert.ok(result.content[0].text.includes("aborted"));
});

test("subagent_reply tool wraps the pure decision and reports isError on refusal", async () => {
	const root = tempRoot();
	const { tools, api } = fakePi();
	registerSubagentReplyTool(api as never, {
		dirFor: (agentId, runId) => questionRunDir(root, agentId, runId),
		currentRunId: (agentId) => (agentId === "w" ? "run-3" : undefined),
	});
	const tool = tools.get(SUBAGENT_REPLY_TOOL_NAME)!;
	const refused = await tool.execute("c", { agentId: "w", runId: "run-3", answer: "x" });
	assert.equal(refused.isError, true);
	const dir = questionRunDir(root, "w", "run-3");
	writeQuestion(dir, { agentId: "w", runId: "run-3", question: "q" });
	const ok = await tool.execute("c", { agentId: "w", runId: "run-3", answer: "the answer" });
	assert.equal(ok.isError, undefined);
	assert.deepEqual(ok.details, { questionId: 1 });
	assert.equal(readAnswer(dir, 1)?.answer, "the answer");
});

test("tool policy: ask_boss is host-issued, never from frontmatter, and only when the dispatch says so", () => {
	assert.equal(POLICY_ASK_BOSS_TOOL_NAME, ASK_BOSS_TOOL_NAME);
	const withoutChannel = resolveSubagentToolSelection({
		declaredTools: ["read", ASK_BOSS_TOOL_NAME],
		disabledTools: [],
		allowRecursiveDelegation: false,
	});
	assert.equal(withoutChannel.flag, "--tools");
	assert.equal(withoutChannel.names.includes(ASK_BOSS_TOOL_NAME), false, "frontmatter alone must not grant it");
	const withChannel = resolveSubagentToolSelection({
		declaredTools: ["read"],
		disabledTools: [],
		allowRecursiveDelegation: false,
		hasAskBoss: true,
	});
	assert.deepEqual(withChannel.names, ["read", ASK_BOSS_TOOL_NAME]);
	const disabled = resolveSubagentToolSelection({
		declaredTools: ["read"],
		disabledTools: [ASK_BOSS_TOOL_NAME],
		allowRecursiveDelegation: false,
		hasAskBoss: true,
	});
	assert.deepEqual(disabled.names, ["read"]);
	assert.ok(ASK_BOSS_GUIDANCE.includes(ASK_BOSS_TOOL_NAME));
});
