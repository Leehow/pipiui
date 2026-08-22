import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	THINKING_OMITTED_MARKER,
	pruneHistoricalThinking,
	thinkingPruneConfigFromEnv,
} from "../src/adapters/pi/thinking-prune";

type Part = Record<string, unknown> & { type: string };
type Message = Record<string, unknown> & { role: string; content?: string | Part[] };

const target = (provider: string, api: string, id: string) => ({ provider, api, id });

function user(turn: number): Message {
	return { role: "user", content: `user-${turn}`, timestamp: turn * 10 };
}

function assistant(
	turn: number,
	parts: Part[],
	opts: Partial<Message> & { provider?: string; api?: string; model?: string } = {},
): Message {
	return {
		role: "assistant",
		content: parts,
		provider: opts.provider ?? "generic",
		api: opts.api ?? "custom-chat",
		model: opts.model ?? "m1",
		stopReason: "stop",
		responseId: `r-${turn}`,
		timestamp: turn * 10 + 1,
		...opts,
	};
}

const thinking = (text: string, extra: Record<string, unknown> = {}): Part => ({
	type: "thinking",
	thinking: text,
	...extra,
});
const text = (value: string, extra: Record<string, unknown> = {}): Part => ({ type: "text", text: value, ...extra });
const call = (id: string, extra: Record<string, unknown> = {}): Part => ({
	type: "toolCall",
	id,
	name: "read",
	arguments: { path: `${id}.txt` },
	...extra,
});

function conversation(turns: number, makeAssistant: (turn: number) => Message): Message[] {
	const messages: Message[] = [];
	for (let turn = 1; turn <= turns; turn++) messages.push(user(turn), makeAssistant(turn));
	return messages;
}

afterEach(() => {
	delete process.env.CONTEXTFOLD_THINKING;
	delete process.env.CONTEXTFOLD_THINKING_KEEP_TURNS;
});

describe("thinking prune configuration", () => {
	it("is enabled by default with an exact 20-user-turn keep window", () => {
		expect(thinkingPruneConfigFromEnv()).toEqual({ enabled: true, keepUserTurns: 20 });
	});

	it.each(["0", "off", "false"])("accepts %s as the local kill switch", (value) => {
		process.env.CONTEXTFOLD_THINKING = value;
		expect(thinkingPruneConfigFromEnv().enabled).toBe(false);
	});

	it("accepts a non-negative integer keep-window override and rejects partial numbers", () => {
		process.env.CONTEXTFOLD_THINKING_KEEP_TURNS = "7";
		expect(thinkingPruneConfigFromEnv().keepUserTurns).toBe(7);
		process.env.CONTEXTFOLD_THINKING_KEEP_TURNS = "7turns";
		expect(thinkingPruneConfigFromEnv().keepUserTurns).toBe(20);
	});
});

describe("pure historical-thinking transform", () => {
	it("prunes exactly the first of 21 user turns at the default boundary", () => {
		const messages = conversation(21, (turn) => assistant(turn, [thinking(`thought-${turn}`), text(`answer-${turn}`)]));
		const result = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), {
			enabled: true,
			keepUserTurns: 20,
		});

		expect(JSON.stringify(result.messages[1])).not.toContain("thought-1");
		expect(JSON.stringify(result.messages[3])).toContain("thought-2");
		expect(JSON.stringify(result.messages.at(-1))).toContain("thought-21");
		expect(result.messages[3]).toBe(messages[3]);
		expect(result.messages.at(-1)).toBe(messages.at(-1));
	});

	it("uses the override boundary while always protecting the current user turn", () => {
		const messages = conversation(4, (turn) => assistant(turn, [thinking(`thought-${turn}`), text(`answer-${turn}`)]));
		const keepTwo = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), {
			enabled: true,
			keepUserTurns: 2,
		});
		expect(JSON.stringify(keepTwo.messages[1])).not.toContain("thought-1");
		expect(JSON.stringify(keepTwo.messages[3])).not.toContain("thought-2");
		expect(JSON.stringify(keepTwo.messages[5])).toContain("thought-3");

		const keepZero = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), {
			enabled: true,
			keepUserTurns: 0,
		});
		expect(JSON.stringify(keepZero.messages[5])).not.toContain("thought-3");
		expect(JSON.stringify(keepZero.messages[7])).toContain("thought-4");
	});

	it("is deterministic and never mutates the caller or persisted JSONL fixture", () => {
		const dir = mkdtempSync(join(tmpdir(), "thinking-prune-"));
		try {
			const messages = conversation(3, (turn) => assistant(turn, [thinking(`thought-${turn}`), text(`answer-${turn}`)]));
			const fixture = join(dir, "session.jsonl");
			writeFileSync(fixture, messages.map((message, i) => JSON.stringify({ type: "message", id: i, message })).join("\n") + "\n");
			const sourceJson = JSON.stringify(messages);
			const persisted = readFileSync(fixture);
			const config = { enabled: true, keepUserTurns: 1 };
			const first = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), config);
			const second = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), config);

			expect(first).toEqual(second);
			expect(JSON.stringify(messages)).toBe(sourceJson);
			expect(readFileSync(fixture)).toEqual(persisted);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("drops cross-model readable, signed, and redacted thinking while preserving every non-thinking part", () => {
		const old = assistant(
			1,
			[
				thinking("readable", { thinkingSignature: "sig-readable" }),
				thinking("", { thinkingSignature: "opaque", redacted: true }),
				text("answer", { textSignature: "text-sig" }),
				call("call|fc_old", { thoughtSignature: "tool-sig", namespace: "ns" }),
			],
			{ provider: "openai", api: "openai-responses", model: "old-model", stopReason: "toolUse" },
		);
		const messages = [user(1), old, { role: "toolResult", toolCallId: "call|fc_old", toolName: "read", content: [text("result")], isError: false }, user(2)];
		const beforeNonThinking = (old.content as Part[]).filter((part) => part.type !== "thinking");
		const result = pruneHistoricalThinking(messages, target("anthropic", "anthropic-messages", "new-model"), {
			enabled: true,
			keepUserTurns: 1,
		});
		const out = result.messages[1].content as Part[];

		expect(out.filter((part) => part.type === "thinking")).toEqual([]);
		expect(out).toEqual(beforeNonThinking);
		expect(result.compactionFingerprint).toBeNull();
	});

	it("prunes old same-model Anthropic thinking but keeps the current tool island byte-identical", () => {
		const old = assistant(1, [thinking("old", { thinkingSignature: "anthropic-sig" }), text("answer")], {
			provider: "anthropic",
			api: "anthropic-messages",
			model: "claude",
		});
		const current = assistant(22, [thinking("current", { thinkingSignature: "current-sig" }), thinking("", { thinkingSignature: "redacted", redacted: true }), call("c22")], {
			provider: "anthropic",
			api: "anthropic-messages",
			model: "claude",
			stopReason: "toolUse",
		});
		const messages: Message[] = [user(1), old];
		for (let turn = 2; turn <= 21; turn++) messages.push(user(turn), assistant(turn, [text(`answer-${turn}`)]));
		messages.push(user(22), current, { role: "toolResult", toolCallId: "c22", toolName: "read", content: [text("ok")], isError: false });
		const currentBytes = JSON.stringify(current);
		const result = pruneHistoricalThinking(messages, target("anthropic", "anthropic-messages", "claude"), {
			enabled: true,
			keepUserTurns: 20,
		});

		expect(JSON.stringify(result.messages[1])).not.toContain("anthropic-sig");
		expect(JSON.stringify(result.messages.at(-2))).toBe(currentBytes);
	});

	it("omits a completed historical Anthropic tool island unless it carries foreign part metadata", () => {
		const safe = assistant(1, [
			thinking("signed", { thinkingSignature: "anthropic-sig" }),
			thinking("", { thinkingSignature: "opaque-redacted", redacted: true }),
			call("anth-call"),
		], {
			provider: "anthropic",
			api: "anthropic-messages",
			model: "claude",
			stopReason: "toolUse",
		});
		const foreign = assistant(1, [thinking("signed", { thinkingSignature: "anthropic-sig" }), call("foreign-call", { thoughtSignature: "non-anthropic-part-signature" })], {
			provider: "anthropic",
			api: "anthropic-messages",
			model: "claude",
			stopReason: "toolUse",
		});
		const targetModel = target("anthropic", "anthropic-messages", "claude");
		const safeResult = pruneHistoricalThinking([user(1), safe, user(2)], targetModel, { enabled: true, keepUserTurns: 0 });
		const foreignResult = pruneHistoricalThinking([user(1), foreign, user(2)], targetModel, { enabled: true, keepUserTurns: 0 });

		expect(safeResult.messages[1].content).toEqual([call("anth-call")]);
		expect(safeResult.compactionFingerprint).toBeNull();
		expect(foreignResult.messages[1]).toBe(foreign);
		expect(foreignResult.compactionFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it("prunes official DeepSeek no-tool reasoning and flags tool-coupled reasoning for whole-region compaction", () => {
		const withoutTool = assistant(1, [thinking("old cot", { thinkingSignature: "reasoning_content" }), text("answer")], {
			provider: "deepseek",
			api: "openai-completions",
			model: "deepseek-reasoner",
		});
		const withTool = assistant(2, [thinking("required cot", { thinkingSignature: "reasoning_content" }), call("deep-call")], {
			provider: "deepseek",
			api: "openai-completions",
			model: "deepseek-reasoner",
			stopReason: "toolUse",
		});
		const messages = [user(1), withoutTool, user(2), withTool, { role: "toolResult", toolCallId: "deep-call", toolName: "read", content: [text("ok")], isError: false }, user(3)];
		const result = pruneHistoricalThinking(messages, target("deepseek", "openai-completions", "deepseek-reasoner"), {
			enabled: true,
			keepUserTurns: 0,
		});

		expect(JSON.stringify(result.messages[1])).not.toContain("old cot");
		expect(result.messages[3]).toBe(withTool);
		expect(result.compactionFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it("preserves OpenAI Responses rs_/fc_ and Gemini thoughtSignature islands and flags both", () => {
		const openAI = assistant(1, [thinking("summary", { thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_1", summary: [] }) }), call("call_1|fc_1")], {
			provider: "openai",
			api: "openai-responses",
			model: "gpt-5",
			stopReason: "toolUse",
		});
		const gemini = assistant(1, [thinking("thought", { thinkingSignature: "QUJDRA==" }), call("gem-call", { thoughtSignature: "RUZHSA==" })], {
			provider: "google",
			api: "google-generative-ai",
			model: "gemini-3-pro",
			stopReason: "toolUse",
		});
		for (const [message, model] of [
			[openAI, target("openai", "openai-responses", "gpt-5")],
			[gemini, target("google", "google-generative-ai", "gemini-3-pro")],
		] as const) {
			const messages = [user(1), message, user(2)];
			const result = pruneHistoricalThinking(messages, model, { enabled: true, keepUserTurns: 0 });
			expect(result.messages[1]).toBe(message);
			expect(result.compactionFingerprint).toMatch(/^[a-f0-9]{64}$/);
		}
	});

	it.each([
		["openai-codex", "openai-codex-responses", "codex"],
		["xai", "openai-completions", "grok"],
		["generic", "custom-chat", "signed-generic"],
	] as const)("fails closed for same-model %s/%s signed reasoning", (provider, api, model) => {
		const old = assistant(1, [thinking("signed", { thinkingSignature: "opaque-sig" }), text("answer")], {
			provider,
			api,
			model,
		});
		const result = pruneHistoricalThinking([user(1), old, user(2)], target(provider, api, model), {
			enabled: true,
			keepUserTurns: 0,
		});
		expect(result.messages[1]).toBe(old);
		expect(result.compactionFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it("prunes generic unsigned no-tool thinking and emits a deterministic marker for thinking-only assistants", () => {
		const onlyThinking = assistant(1, [thinking("ephemeral")]);
		const messages = [user(1), onlyThinking, user(2)];
		const result = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), {
			enabled: true,
			keepUserTurns: 0,
		});

		expect(result.messages[1].content).toEqual([text(THINKING_OMITTED_MARKER)]);
		expect(JSON.stringify(onlyThinking)).toContain("ephemeral");
	});

	it.each(["pending", "length", "error", "aborted", "deferred"])("leaves %s assistants byte-identical", (stopReason) => {
		const old = assistant(1, [thinking("must stay"), call("maybe")], {
			stopReason,
			...(stopReason === "deferred" ? { deferred: { id: "job", provider: "generic", modelId: "m1", api: "custom-chat" } } : {}),
		});
		const messages = [user(1), old, user(2)];
		const result = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), {
			enabled: true,
			keepUserTurns: 0,
		});
		expect(result.messages[1]).toBe(old);
		expect(result.compactionFingerprint).toBeNull();
	});

	it("does not disturb parallel or missing tool-result structure while flagging the whole island", () => {
		const old = assistant(1, [thinking("old"), call("a"), call("b")], { stopReason: "toolUse" });
		const messages = [user(1), old, { role: "toolResult", toolCallId: "a", toolName: "read", content: [text("A")], isError: false }, user(2)];
		const result = pruneHistoricalThinking(messages, target("generic", "custom-chat", "m1"), {
			enabled: true,
			keepUserTurns: 0,
		});
		expect(result.messages).toBe(messages);
		expect(result.messages[1]).toBe(old);
		expect(result.compactionFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});
});
