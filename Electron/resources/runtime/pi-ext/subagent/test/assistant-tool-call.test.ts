import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { summarizeActiveToolArgs } from "../active-tools.ts";
import {
	applyToolResultEvent,
	readAssistantToolCall,
	toolResultMessageFromEvent,
} from "../assistant-tool-call.ts";

function toolRows(content: unknown): Array<string> {
	if (!Array.isArray(content)) return [];
	const rows: string[] = [];
	for (const part of content) {
		const call = readAssistantToolCall(part);
		if (!call) continue;
		rows.push(`${call.name}:${summarizeActiveToolArgs(call.name, call.arguments) ?? ""}`);
	}
	return rows;
}

test("skill_search and skill_load become visible tool rows from toolCall parts", () => {
	assert.deepEqual(toolRows([
		{ type: "thinking", thinking: "plan" },
		{ type: "toolCall", id: "s1", name: "skill_search", arguments: { query: "office document" } },
		{ type: "toolCall", id: "s2", name: "skill_load", arguments: { name: "tdd" } },
		{ type: "toolCall", id: "b1", name: "bash", arguments: { command: "npm test" } },
		{ type: "text", text: "done" },
	]), [
		"skill_search:office document",
		"skill_load:tdd",
		"bash:npm test",
	]);
});

test("skill loader calls stay visible when the provider uses tool_use / tool_call / nested shapes", () => {
	assert.deepEqual(toolRows([
		{ type: "tool_use", id: "u1", name: "skill_search", input: { query: "spec" } },
		{ type: "tool_call", id: "c1", name: "skill_load", arguments: { name: "to-spec" } },
		{ type: "functionCall", functionCall: { name: "bash", args: { command: "ls" } } },
	]), ["skill_search:spec", "skill_load:to-spec", "bash:ls"]);

	// JSON-mode toolcall_end carries the completed call under `toolCall`.
	const ended = readAssistantToolCall({
		type: "toolcall_end",
		contentIndex: 2,
		toolCall: { type: "toolCall", id: "t9", name: "skill_load", arguments: { name: "tdd" } },
	});
	assert.equal(ended?.name, "skill_load");
	assert.equal(ended?.id, "t9");
});

test("non-tool parts are not mistaken for skill or ordinary tool calls", () => {
	assert.equal(readAssistantToolCall({ type: "text", text: "skill_load" }), undefined);
	assert.equal(readAssistantToolCall({ type: "thinking", thinking: "use a skill" }), undefined);
	assert.equal(readAssistantToolCall({ type: "image", data: "…" }), undefined);
	assert.deepEqual(toolRows([{ type: "text", text: "hi" }]), []);
});

test("tool_execution_end maps skill results the same way as legacy tool_result_end", () => {
	const fromLegacy = toolResultMessageFromEvent({
		type: "tool_result_end",
		message: { toolCallId: "s1", toolName: "skill_load", isError: false, content: [{ type: "text", text: "# Skill: tdd" }] },
	});
	const fromOfficial = toolResultMessageFromEvent({
		type: "tool_execution_end",
		toolCallId: "s1",
		toolName: "skill_load",
		isError: false,
		result: { content: [{ type: "text", text: "# Skill: tdd" }] },
	});
	assert.equal(fromLegacy?.toolName, "skill_load");
	assert.equal(fromOfficial?.toolName, "skill_load");
	assert.deepEqual(fromOfficial?.content, fromLegacy?.content);
	assert.equal(toolResultMessageFromEvent({ type: "message_end" }), undefined);
});

/**
 * Replay a JSON-mode event stream the way index.ts does: message_end appends
 * the authoritative message to history; every other event goes through the
 * real applyToolResultEvent projection with recording deps.
 */
function replay(events: Array<Record<string, any>>) {
	const messages: any[] = [];
	const logs: Array<Record<string, any>> = [];
	const endedTools: Array<Record<string, any>> = [];
	const notedToolResults: string[] = [];
	let agentToolEnds = 0;
	let projections = 0;
	for (const event of events) {
		if (event.type === "message_end") {
			messages.push(event.message);
			continue;
		}
		applyToolResultEvent(event, { messages }, {
			noteAgentToolEnd: () => { agentToolEnds += 1; },
			noteToolResult: (toolCallId) => { notedToolResults.push(toolCallId); },
			finishActiveTool: (ref) => { endedTools.push(ref); },
			reportLog: (items) => { logs.push(...items); },
			onProjected: () => { projections += 1; },
		});
	}
	return { messages, logs, endedTools, notedToolResults, agentToolEnds, projections };
}

test("pi 0.84 sequence keeps one authoritative toolResult per call and still projects UI rows", () => {
	const assistant = {
		role: "assistant",
		content: [
			{ type: "toolCall", id: "s1", name: "skill_search", arguments: { query: "spec" } },
			{ type: "toolCall", id: "s2", name: "skill_load", arguments: { name: "tdd" } },
			{ type: "toolCall", id: "b1", name: "bash", arguments: { command: "ls" } },
		],
	};
	const toolResults = [
		{ role: "toolResult", toolCallId: "s1", toolName: "skill_search", content: [{ type: "text", text: "match: to-spec" }] },
		{ role: "toolResult", toolCallId: "s2", toolName: "skill_load", content: [{ type: "text", text: "# Skill: tdd" }] },
		{ role: "toolResult", toolCallId: "b1", toolName: "bash", isError: true, content: [{ type: "text", text: "boom" }] },
	];
	const { messages, logs, endedTools, notedToolResults, agentToolEnds, projections } = replay([
		// streamed completions carry the name+args, live rows already emitted by index.ts
		{ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: assistant.content[0] } },
		{ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, toolCall: assistant.content[1] } },
		{ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall: assistant.content[2] } },
		// authoritative assistant message lands in history exactly once
		{ type: "message_end", message: assistant },
		// per-tool execution ends: UI/progress projection only
		{ type: "tool_execution_end", toolCallId: "s1", toolName: "skill_search", isError: false, result: { content: [{ type: "text", text: "match: to-spec" }] } },
		{ type: "tool_execution_end", toolCallId: "s2", toolName: "skill_load", isError: false, result: { content: [{ type: "text", text: "# Skill: tdd" }] } },
		{ type: "tool_execution_end", toolCallId: "b1", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "boom" }] } },
		// authoritative toolResult message_end appends the real history entries
		{ type: "message_end", message: toolResults[0] },
		{ type: "message_end", message: toolResults[1] },
		{ type: "message_end", message: toolResults[2] },
	]);
	// 1 assistant + 3 toolResults: the tool_execution_end projection added none.
	assert.equal(messages.length, 4);
	assert.deepEqual(messages.map((message) => message.role), ["assistant", "toolResult", "toolResult", "toolResult"]);
	assert.deepEqual(messages.slice(1).map((message) => message.toolCallId), ["s1", "s2", "b1"]);
	// UI rows projected once per execution end, with error flags preserved.
	assert.deepEqual(
		logs.map((log) => `${log.itemType}:${log.name}:${log.isError}:${log.text}`),
		[
			"toolResult:skill_search:false:match: to-spec",
			"toolResult:skill_load:false:# Skill: tdd",
			"toolResult:bash:true:boom",
		],
	);
	assert.deepEqual(endedTools, [
		{ toolCallId: "s1", name: "skill_search" },
		{ toolCallId: "s2", name: "skill_load" },
		{ toolCallId: "b1", name: "bash" },
	]);
	assert.deepEqual(notedToolResults, ["s1", "s2", "b1"]);
	// Every projected toolResult row keeps the stable call id the UI pairs on.
	assert.deepEqual(logs.map((log) => log.toolCallId), ["s1", "s2", "b1"]);
	assert.equal(agentToolEnds, 3);
	assert.equal(projections, 3);
});

test("long execution results are tail-truncated to 1500 chars in the UI row only", () => {
	const long = "x".repeat(2000);
	const { messages, logs } = replay([
		{ type: "tool_execution_end", toolCallId: "s1", toolName: "skill_load", isError: false, result: { content: [{ type: "text", text: long }] } },
		{ type: "message_end", message: { role: "toolResult", toolCallId: "s1", toolName: "skill_load", content: [{ type: "text", text: long }] } },
	]);
	assert.equal(logs[0]?.text.length, 1500);
	assert.equal(logs[0]?.text, long.slice(-1500));
	// history keeps the untouched authoritative message
	assert.equal(messages[0]?.content[0]?.text.length, 2000);
});

test("legacy tool_result_end remains the authoritative history append", () => {
	const { messages, logs } = replay([
		{ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "b1", name: "bash", arguments: { command: "ls" } }] } },
		{ type: "tool_result_end", message: { toolCallId: "b1", toolName: "bash", isError: false, content: [{ type: "text", text: "a.ts" }] } },
	]);
	assert.equal(messages.length, 2);
	assert.equal(messages[1]?.toolName, "bash");
	assert.deepEqual(logs.map((log) => `${log.name}:${log.text}`), ["bash:a.ts"]);
	assert.equal(logs[0]?.toolCallId, "b1");
});

test("index.ts delegates the result projection and never appends execution_end results to history", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const at = source.indexOf("applyToolResultEvent(event, currentResult");
	assert.ok(at >= 0, "index.ts must delegate to applyToolResultEvent");
	const block = source.slice(at, at + 700);
	assert.doesNotMatch(block, /messages\.push/, "projection block must not append to history");
	assert.match(block, /finishActiveTool/);
	assert.match(block, /pipiuiReport/);
});

test("toolResult rows keep the toolCallId when the provider omits toolName", () => {
	const { logs, endedTools } = replay([
		{ type: "tool_execution_end", toolCallId: "x9", isError: false, result: { content: [{ type: "text", text: "ok" }] } },
	]);
	assert.equal(logs[0]?.itemType, "toolResult");
	assert.equal(logs[0]?.toolCallId, "x9");
	assert.equal(logs[0]?.name, "");
	assert.deepEqual(endedTools, [{ toolCallId: "x9" }]);
});
