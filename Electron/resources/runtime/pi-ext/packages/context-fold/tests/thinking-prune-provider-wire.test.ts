import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertMessages as convertGoogleMessages } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/google-shared.js";
import { convertMessages as convertOpenAICompletionsMessages } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";
import { convertResponsesMessages } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js";
import { transformMessages } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js";
import { pruneHistoricalThinking } from "../src/adapters/pi/thinking-prune";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });

function model(provider: string, api: string, id: string, extra: Record<string, unknown> = {}) {
	return {
		provider,
		api,
		id,
		name: id,
		baseUrl: `https://api.${provider}.test`,
		reasoning: true,
		input: ["text"],
		contextWindow: 200_000,
		maxTokens: 8_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		...extra,
	};
}

describe("nested Pi 0.84.2 provider-wire fixtures", () => {
	it("is pinned to the nested runtime copy rather than the hoisted pi-ai", () => {
		const packagePath = resolve(__dirname, "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json");
		const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
		expect(manifest.version).toBe("0.84.2");
		expect(realpathSync(packagePath)).toContain("/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json");
	});

	it("removes cross-model reasoning before Pi can downgrade it to paid plain text", () => {
		const source = {
			role: "assistant",
			provider: "openai",
			api: "openai-responses",
			model: "gpt-old",
			stopReason: "toolUse",
			usage,
			timestamp: 2,
			content: [
				{ type: "thinking", thinking: "READABLE SECRET", thinkingSignature: JSON.stringify({ type: "reasoning", id: "rs_old", summary: [] }) },
				{ type: "thinking", thinking: "", thinkingSignature: "opaque", redacted: true },
				{ type: "text", text: "answer" },
				{ type: "toolCall", id: "call-old|fc_old", name: "read", arguments: {}, thoughtSignature: "foreign-tool-sig" },
			],
		};
		const target = model("openai", "openai-responses", "gpt-new");
		const result = pruneHistoricalThinking(
			[user("one", 1), source, { role: "toolResult", toolCallId: "call-old|fc_old", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 }, user("two", 4)] as any,
			target,
			{ enabled: true, keepUserTurns: 0 },
		);
		const transformed = transformMessages(result.messages as any, target as any);
		const wire = convertResponsesMessages(target as any, { systemPrompt: "", messages: result.messages, tools: [] } as any, new Set(["openai"]));

		expect(JSON.stringify(transformed)).not.toContain("READABLE SECRET");
		expect(JSON.stringify(wire)).not.toContain("READABLE SECRET");
		expect(wire).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function_call", call_id: "call-old", name: "read" })]));
		expect(JSON.stringify(wire)).toContain("answer");
	});

	it("keeps same-model Responses rs_/fc_ items byte-valid and requests whole-region compaction", () => {
		const reasoningItem = { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "summary" }] };
		const assistant = {
			role: "assistant",
			provider: "openai",
			api: "openai-responses",
			model: "gpt-5",
			stopReason: "toolUse",
			usage,
			timestamp: 2,
			content: [
				{ type: "thinking", thinking: "summary", thinkingSignature: JSON.stringify(reasoningItem) },
				{ type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a" } },
			],
		};
		const target = model("openai", "openai-responses", "gpt-5");
		const result = pruneHistoricalThinking([user("one", 1), assistant, user("two", 3)] as any, target, { enabled: true, keepUserTurns: 0 });
		const wire = convertResponsesMessages(target as any, { systemPrompt: "", messages: result.messages, tools: [] } as any, new Set(["openai"]));

		expect(result.messages[1]).toBe(assistant);
		expect(result.compactionFingerprint).not.toBeNull();
		expect(wire).toEqual(expect.arrayContaining([
			reasoningItem,
			expect.objectContaining({ type: "function_call", id: "fc_1", call_id: "call_1" }),
		]));
	});

	it("keeps Gemini signature-bearing parts in their original positions", () => {
		const assistant = {
			role: "assistant",
			provider: "google",
			api: "google-generative-ai",
			model: "gemini-3-pro",
			stopReason: "toolUse",
			usage,
			timestamp: 2,
			content: [
				{ type: "thinking", thinking: "thought", thinkingSignature: "QUJDRA==" },
				{ type: "toolCall", id: "gem-call", name: "read", arguments: {}, thoughtSignature: "RUZHSA==" },
			],
		};
		const target = model("google", "google-generative-ai", "gemini-3-pro");
		const result = pruneHistoricalThinking([user("one", 1), assistant, user("two", 3)] as any, target, { enabled: true, keepUserTurns: 0 });
		const wire = convertGoogleMessages(target as any, { systemPrompt: "", messages: result.messages, tools: [] } as any);
		const modelTurn = wire.find((entry: any) => entry.role === "model") as any;

		expect(result.messages[1]).toBe(assistant);
		expect(result.compactionFingerprint).not.toBeNull();
		expect(modelTurn.parts[0]).toEqual({ thought: true, text: "thought", thoughtSignature: "QUJDRA==" });
		expect(modelTurn.parts[1]).toEqual(expect.objectContaining({ thoughtSignature: "RUZHSA==", functionCall: expect.objectContaining({ id: "gem-call" }) }));
	});

	it("omits old official DeepSeek no-tool reasoning while retaining its required empty wire field", () => {
		const assistant = {
			role: "assistant",
			provider: "deepseek",
			api: "openai-completions",
			model: "deepseek-reasoner",
			stopReason: "stop",
			usage,
			timestamp: 2,
			content: [
				{ type: "thinking", thinking: "OLD COT", thinkingSignature: "reasoning_content" },
				{ type: "text", text: "answer" },
			],
		};
		const target = model("deepseek", "openai-completions", "deepseek-reasoner");
		const result = pruneHistoricalThinking([user("one", 1), assistant, user("two", 3)] as any, target, { enabled: true, keepUserTurns: 0 });
		const compat = {
			supportsDeveloperRole: false,
			requiresAssistantAfterToolResult: false,
			requiresThinkingAsText: false,
			requiresReasoningContentOnAssistantMessages: true,
			requiresToolResultName: false,
			supportsStrictMode: true,
			supportsOpenAIGrammarTools: false,
		};
		const wire = convertOpenAICompletionsMessages(target as any, { systemPrompt: "", messages: result.messages, tools: [] } as any, compat as any);
		const assistantWire = wire.find((entry: any) => entry.role === "assistant") as any;

		expect(JSON.stringify(wire)).not.toContain("OLD COT");
		expect(assistantWire.content).toBe("answer");
		expect(assistantWire.reasoning_content).toBe("");
	});
});
