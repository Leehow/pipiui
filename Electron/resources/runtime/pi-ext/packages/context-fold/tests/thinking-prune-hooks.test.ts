import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import contextFold from "../src/adapters/pi/index";
import type { AgentMessage } from "../src/core/block";
import { bigResult, user } from "./helpers";

type Hook = (event: any, ctx: any) => unknown;

function stubPi() {
	const hooks = new Map<string, Hook>();
	return {
		hooks,
		api: {
			on: (name: string, hook: Hook) => hooks.set(name, hook),
			registerTool: () => {},
			registerCommand: () => {},
			appendEntry: () => {},
			setLabel: () => {},
		} as never,
	};
}

const thinkingAssistant = (
	turn: number,
	thinking: Record<string, unknown>,
	extra: Record<string, unknown> = {},
): AgentMessage => ({
	role: "assistant",
	content: [{ type: "thinking", thinking: `thought-${turn}`, ...thinking }, { type: "text", text: `answer-${turn}` }] as any,
	provider: "generic",
	api: "custom-chat",
	model: "m1",
	stopReason: "stop",
	responseId: `r-${turn}`,
	timestamp: turn * 10,
	...extra,
} as any);

let dir: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
	"CONTEXTFOLD",
	"CONTEXTFOLD_THINKING",
	"CONTEXTFOLD_THINKING_KEEP_TURNS",
	"CONTEXTFOLD_COMPACT",
	"CONTEXTFOLD_SPOOL_RETAIN_DAYS",
	"CONTEXTFOLD_TAIL",
	"CONTEXTFOLD_FOLD_AT",
];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cf-thinking-hooks-"));
	for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
	process.env.CONTEXTFOLD_SPOOL_RETAIN_DAYS = "0";
	process.env.CONTEXTFOLD_COMPACT = "native";
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
});

function harness(model = { provider: "generic", api: "custom-chat", id: "m1" }) {
	const stub = stubPi();
	contextFold(stub.api);
	let idle = true;
	let pending = false;
	let sessionId = "s1";
	let compactCalls = 0;
	const ctx = {
		model,
		sessionManager: {
			getSessionDir: () => dir,
			getSessionId: () => sessionId,
			getEntries: () => [],
		},
		getContextUsage: () => ({ contextWindow: 200_000, tokens: 1_000 }),
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		compact: (options?: { onComplete?: (result: unknown) => void }) => {
			compactCalls++;
			options?.onComplete?.({ summary: "done" });
		},
		ui: { setStatus: () => {} },
	};
	return {
		...stub,
		ctx,
		setIdle: (value: boolean) => { idle = value; },
		setPending: (value: boolean) => { pending = value; },
		setSessionId: (value: string) => { sessionId = value; },
		compactCalls: () => compactCalls,
	};
}

describe("thinking pruning in the context-fold hook", () => {
	it("prunes before the existing engine and leaves the caller array untouched", async () => {
		process.env.CONTEXTFOLD_THINKING_KEEP_TURNS = "1";
		const h = harness();
		const messages: AgentMessage[] = [
			user("one"),
			thinkingAssistant(1, {}),
			user("two"),
			thinkingAssistant(2, {}),
			user("three"),
			thinkingAssistant(3, {}),
		];
		const source = JSON.stringify(messages);

		const out = await h.hooks.get("context")!({ messages }, h.ctx) as { messages: AgentMessage[] };

		expect(JSON.stringify(out.messages[1])).not.toContain("thought-1");
		expect(JSON.stringify(out.messages[3])).not.toContain("thought-2");
		expect(JSON.stringify(out.messages[5])).toContain("thought-3");
		expect(JSON.stringify(messages)).toBe(source);
	});

	it("still folds stale tool results, preserves first delivery, and prunes thinking in one pass", async () => {
		process.env.CONTEXTFOLD_THINKING_KEEP_TURNS = "1";
		process.env.CONTEXTFOLD_TAIL = "1000";
		process.env.CONTEXTFOLD_FOLD_AT = "0.01";
		const h = harness();
		h.ctx.getContextUsage = () => ({ contextWindow: 80_000, tokens: 70_000 });
		const messages: AgentMessage[] = [user("start"), thinkingAssistant(1, {})];
		for (let i = 0; i < 7; i++) {
			messages.push({
				role: "assistant",
				content: [{ type: "toolCall", id: `c${i}`, name: "read", arguments: {} }],
				provider: "generic",
				api: "custom-chat",
				model: "m1",
				stopReason: "toolUse",
				responseId: `call-${i}`,
				timestamp: 100 + i,
			} as any);
			messages.push(bigResult(`c${i}`, 300));
		}
		messages.push(user("latest"));
		const source = JSON.stringify(messages);

		const out = await h.hooks.get("context")!({ messages }, h.ctx) as { messages: AgentMessage[] };

		expect(JSON.stringify(out.messages)).not.toContain("thought-1");
		expect(JSON.stringify(out.messages)).toContain("FOLDED");
		expect(JSON.stringify(out.messages.at(-2))).not.toContain("FOLDED");
		expect(JSON.stringify(messages)).toBe(source);
	});
});

describe("strict-island native compaction fallback", () => {
	function strictMessages(): AgentMessage[] {
		return [
			user("first"),
			thinkingAssistant(1, { thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_1", summary: [] }) }, {
				provider: "openai",
				api: "openai-responses",
				model: "gpt-5",
				stopReason: "toolUse",
				content: [
					{ type: "thinking", thinking: "summary", thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_1", summary: [] }) },
					{ type: "toolCall", id: "call_1|fc_1", name: "read", arguments: {} },
				],
			}),
			{ role: "toolResult", toolCallId: "call_1|fc_1", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 12 },
			user("next"),
		];
	}

	it("fires at most once for one over-age state and only while fully idle", async () => {
		process.env.CONTEXTFOLD_THINKING_KEEP_TURNS = "0";
		const h = harness({ provider: "openai", api: "openai-responses", id: "gpt-5" });
		await h.hooks.get("context")!({ messages: strictMessages() }, h.ctx);
		h.setIdle(false);
		await h.hooks.get("agent_settled")!({}, h.ctx);
		expect(h.compactCalls()).toBe(0);
		h.setIdle(true);
		h.setPending(true);
		await h.hooks.get("agent_settled")!({}, h.ctx);
		expect(h.compactCalls()).toBe(0);
		h.setPending(false);
		await h.hooks.get("agent_settled")!({}, h.ctx);
		await h.hooks.get("agent_settled")!({}, h.ctx);
		expect(h.compactCalls()).toBe(1);
	});

	it("does not loop after session_compact, but a real session switch gets fresh state", async () => {
		process.env.CONTEXTFOLD_THINKING_KEEP_TURNS = "0";
		const h = harness({ provider: "openai", api: "openai-responses", id: "gpt-5" });
		await h.hooks.get("session_start")!({}, h.ctx);
		await h.hooks.get("context")!({ messages: strictMessages() }, h.ctx);
		await h.hooks.get("agent_settled")!({}, h.ctx);
		expect(h.compactCalls()).toBe(1);

		await h.hooks.get("session_compact")!({}, h.ctx);
		await h.hooks.get("context")!({ messages: strictMessages() }, h.ctx);
		await h.hooks.get("agent_settled")!({}, h.ctx);
		expect(h.compactCalls()).toBe(1);

		h.setSessionId("s2");
		await h.hooks.get("session_start")!({}, h.ctx);
		await h.hooks.get("context")!({ messages: strictMessages() }, h.ctx);
		await h.hooks.get("agent_settled")!({}, h.ctx);
		expect(h.compactCalls()).toBe(2);
	});

	it("the local thinking kill switch suppresses both pruning and fallback compaction", async () => {
		process.env.CONTEXTFOLD_THINKING = "0";
		process.env.CONTEXTFOLD_THINKING_KEEP_TURNS = "0";
		const h = harness({ provider: "openai", api: "openai-responses", id: "gpt-5" });
		const messages = strictMessages();
		const out = await h.hooks.get("context")!({ messages }, h.ctx) as { messages: AgentMessage[] };
		await h.hooks.get("agent_settled")!({}, h.ctx);
		expect(out.messages).toBe(messages);
		expect(h.compactCalls()).toBe(0);
	});
});
