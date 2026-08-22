import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextFoldEngine, type FoldEventReport, type FrozenLayer } from "../src/adapters/pi/store";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import { SeedIndexStore, emitFoldIndex } from "../src/adapters/pi/index-store";
import { SpoolStore } from "../src/adapters/pi/spool";
import type { AgentMessage } from "../src/core/block";
import { assistantText, assistantWithCalls, toolResult, user } from "./helpers";

const LARGE_WINDOW = 1_000_000;

function completedSession(count: number, resultChars = 5_000): AgentMessage[] {
	const messages: AgentMessage[] = [user("start")];
	for (let i = 0; i < count; i++) {
		messages.push(assistantWithCalls([{ id: `c${i}`, name: "read", args: { path: `/tmp/${i}` } }]));
		messages.push(toolResult(`c${i}`, `${i}:` + "x".repeat(resultChars), "read"));
	}
	messages.push(assistantText("all tools completed", "after-tools"), user("continue"));
	return messages;
}

function engine(cfg: Record<string, unknown> = {}) {
	const events: FoldEventReport[] = [];
	const layers: FrozenLayer[] = [];
	const value = new ContextFoldEngine(
		new FoldLadderPolicy(),
		{ absoluteTokenCap: 0, tailTarget: 0, defaultContextWindow: LARGE_WINDOW, ...cfg },
	);
	value.onFoldEvent = (event) => events.push(event);
	value.onLayerCommit = (layer) => layers.push(layer);
	return { value, events, layers };
}

function resultText(messages: AgentMessage[], callId: string): string {
	const result = messages.find((message) => message.role === "toolResult" && message.toolCallId === callId);
	return ((result?.content as Array<{ type: string; text: string }> | undefined)?.[0]?.text) ?? "";
}

function toolCallArgs(messages: AgentMessage[], callId: string): Record<string, unknown> | undefined {
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const call = (message.content as Array<Record<string, unknown>>).find(
			(part) => part.type === "toolCall" && part.id === callId,
		);
		if (call) return call.arguments as Record<string, unknown> | undefined;
	}
	return undefined;
}

describe("completed tool-use count trigger", () => {
	it("stays idle at 39 uses, then folds one layer at 40 while keeping the newest 12 pairs raw", () => {
		const below = engine();
		const thirtyNine = completedSession(39);
		expect(below.value.process(thirtyNine, { contextWindow: LARGE_WINDOW, tokens: null })).toBe(thirtyNine);
		expect(below.layers).toHaveLength(0);

		const boundary = engine();
		const forty = completedSession(40);
		const output = boundary.value.process(forty, { contextWindow: LARGE_WINDOW, tokens: null });

		expect(boundary.layers).toHaveLength(1);
		expect(boundary.events).toHaveLength(1);
		expect(boundary.events[0].trigger).toBe("tool-use-count");
		expect(resultText(output, "c0")).toContain("FOLDED");
		for (let i = 28; i < 40; i++) expect(resultText(output, `c${i}`)).not.toContain("FOLDED");
	});

	it("does not fire when the eligible savings are below 10k tokens", () => {
		const { value, layers } = engine();
		const messages = completedSession(40, 200);
		expect(value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null })).toBe(messages);
		expect(layers).toHaveLength(0);
	});

	it("keeps blocks inside the configured protected working tail raw", () => {
		const { value, layers } = engine({ tailTarget: 20_000 });
		const messages = completedSession(40);
		const output = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });

		expect(layers).toHaveLength(1);
		expect(resultText(output, "c0")).toContain("FOLDED");
		// c27 is older than the 12-pair keep set, but the 20k working tail still protects it.
		expect(resultText(output, "c27")).not.toContain("FOLDED");
	});
});

function statusSession(entries: Array<{ id: string; agentId: string; runId: string; error?: boolean }>): AgentMessage[] {
	const messages: AgentMessage[] = [user("watch workers")];
	for (const entry of entries) {
		messages.push(
			assistantWithCalls([
				{ id: entry.id, name: "subagent_status", args: { agentId: entry.agentId, runId: entry.runId } },
			]),
		);
		messages.push(toolResult(entry.id, `${entry.id}:` + "status snapshot ".repeat(400), "subagent_status", entry.error));
	}
	return [...messages, assistantText("status checked", "after-status"), user("continue")];
}

describe("subagent_status supersession", () => {
	it("folds only older successful snapshots with the same exact agentId and runId", () => {
		const { value, layers, events } = engine();
		const messages = statusSession([
			{ id: "old", agentId: "agent-a", runId: "run-1" },
			{ id: "new", agentId: "agent-a", runId: "run-1" },
		]);
		const output = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });

		expect(layers).toHaveLength(1);
		expect(events[0].trigger).toBe("superseded");
		expect(resultText(output, "old")).toContain("FOLDED");
		expect(resultText(output, "new")).not.toContain("FOLDED");

		const replay = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });
		expect(JSON.stringify(replay)).toBe(JSON.stringify(output));
		expect(layers).toHaveLength(1);
	});

	it("does not supersede an error or a snapshot from a different runId", () => {
		const { value, layers } = engine();
		const messages = statusSession([
			{ id: "error", agentId: "agent-a", runId: "run-1", error: true },
			{ id: "success", agentId: "agent-a", runId: "run-1" },
			{ id: "other-run", agentId: "agent-a", runId: "run-2" },
		]);
		const output = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });

		expect(output).toBe(messages);
		expect(layers).toHaveLength(0);
	});

	it("keeps an older matching snapshot raw while it remains in the protected tail", () => {
		const { value, layers } = engine({ tailTarget: 20_000 });
		const messages = statusSession([
			{ id: "old-protected", agentId: "agent-a", runId: "run-1" },
			{ id: "new-protected", agentId: "agent-a", runId: "run-1" },
		]);

		expect(value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null })).toBe(messages);
		expect(layers).toHaveLength(0);
	});

	it("folds an old snapshot outside the tail while preserving the newer matching snapshot inside it", () => {
		const { value, layers } = engine({ tailTarget: 2_000 });
		const messages = statusSession([
			{ id: "old-outside", agentId: "agent-a", runId: "run-1" },
			{ id: "new-inside", agentId: "agent-a", runId: "run-1" },
		]);
		const output = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });

		expect(layers).toHaveLength(1);
		expect(resultText(output, "old-outside")).toContain("FOLDED");
		expect(resultText(output, "new-inside")).not.toContain("FOLDED");
	});
});

describe("historical subagent arguments", () => {
	it("spools the exact original arguments before replacing only the old successful call arguments", () => {
		const dir = mkdtempSync(join(tmpdir(), "contextfold-tool-args-"));
		try {
			const registry = new MapSpoolRegistry();
			const spool = new SpoolStore(dir);
			const index = new SeedIndexStore(dir);
			const value = new ContextFoldEngine(
				new FoldLadderPolicy(),
				{ absoluteTokenCap: 0, tailTarget: 0, defaultContextWindow: LARGE_WINDOW },
				registry,
			);
			value.onFoldEvent = (event) => emitFoldIndex(event, { spool, registry, index, sessionId: "args-test" });
			value.onLayerCommit = () => true;

			const originalArgs = {
				task: "inspect the full project carefully " + "details ".repeat(400),
				worker_profile: "explorer",
			};
			const messages: AgentMessage[] = [user("delegate and inspect")];
			for (let i = 0; i < 40; i++) {
				const name = i === 0 ? "subagent" : "read";
				const args = i === 0 ? originalArgs : { path: `/tmp/${i}` };
				messages.push(assistantWithCalls([{ id: `a${i}`, name, args }]));
				messages.push(toolResult(`a${i}`, `${i}:` + "x".repeat(5_000), name));
			}
			messages.push(assistantText("all completed", "after-args"), user("continue"));

			const output = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });
			const receipt = toolCallArgs(output, "a0") as {
				_contextFold?: string;
				code?: string;
				hash?: string;
				originalChars?: number;
				preview?: string;
			};
			const original = JSON.stringify(originalArgs);

			expect(receipt).not.toEqual(originalArgs);
			expect(receipt._contextFold).toBe("historical subagent arguments folded");
			expect(receipt.code).toMatch(/^[0-9a-z]{6}$/);
			expect(receipt.hash).toBe(createHash("sha256").update(original, "utf8").digest("hex"));
			expect(receipt.originalChars).toBe(original.length);
			expect(receipt.preview).toContain("inspect the full project");

			const recall = value.resolveRecall([receipt.code!]);
			expect(recall.errors).toEqual([]);
			expect(recall.missing).toEqual([]);
			expect(recall.matches[0].text).toBe(original);

			const unfolded = value.markUnfold([receipt.code!]);
			expect(unfolded.missing).toEqual([]);
			expect(toolCallArgs(value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null }), "a0")).toEqual(originalArgs);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("leaves unmatched, errored, recent, disallowed, opaque, and signed sibling content unchanged", () => {
		const originalSigned = { type: "thinking", thinking: "signed reasoning bytes", signature: "sig-unchanged-123" };
		const unmatchedArgs = { task: "unmatched " + "u".repeat(4_000) };
		const errorArgs = { task: "errored " + "e".repeat(4_000) };
		const oldAllowedArgs = { task: "old allowed " + "a".repeat(4_000) };
		const bashArgs = { cmd: "echo " + "b".repeat(4_000) };
		const recentArgs = { task: "recent " + "r".repeat(4_000) };
		const messages: AgentMessage[] = [
			user("exercise safety boundaries"),
			{
				role: "assistant",
				responseId: "signed-response",
				model: "anthropic/test",
				timestamp: 42,
				content: [
					originalSigned,
					{ type: "text", text: "assistant conclusion stays" },
					{ type: "toolCall", id: "unmatched", name: "subagent", arguments: unmatchedArgs },
					{ type: "toolCall", id: "errored", name: "subagent", arguments: errorArgs },
					{ type: "toolCall", id: "old-allowed", name: "subagent", arguments: oldAllowedArgs },
					{ type: "toolCall", id: "bash", name: "bash", arguments: bashArgs },
					{ type: "toolCall", id: "opaque", name: "read", arguments: { path: "image.png" } },
				] as any,
			},
			toolResult("errored", "fatal: worker failed " + "z".repeat(5_000), "subagent", true),
			toolResult("old-allowed", "successful worker " + "x".repeat(5_000), "subagent"),
			toolResult("bash", "shell output " + "x".repeat(5_000), "bash"),
			{
				role: "toolResult",
				toolCallId: "opaque",
				toolName: "read",
				isError: false,
				timestamp: 43,
				content: [{ type: "text", text: "image caption" }, { type: "image", data: "raw-image" }] as any,
			},
		];
		for (let i = 0; i < 38; i++) {
			const recent = i === 37;
			messages.push(
				assistantWithCalls([
					{ id: `safe-${i}`, name: recent ? "subagent" : "read", args: recent ? recentArgs : { path: `/tmp/${i}` } },
				]),
			);
			messages.push(toolResult(`safe-${i}`, `${i}:` + "x".repeat(5_000), recent ? "subagent" : "read"));
		}
		messages.push(assistantText("finished", "after-safety"), user("continue"));

		const { value } = engine();
		const output = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });
		const signedAssistant = output.find((message) => message.responseId === "signed-response")!;
		const signedParts = signedAssistant.content as any[];

		expect(signedParts[0]).toBe(originalSigned);
		expect(signedParts[1]).toEqual({ type: "text", text: "assistant conclusion stays" });
		expect(toolCallArgs(output, "unmatched")).toEqual(unmatchedArgs);
		expect(toolCallArgs(output, "errored")).toEqual(errorArgs);
		expect(toolCallArgs(output, "bash")).toEqual(bashArgs);
		expect(toolCallArgs(output, "safe-37")).toEqual(recentArgs);
		expect(toolCallArgs(output, "old-allowed")).not.toEqual(oldAllowedArgs);
		expect(resultText(output, "errored")).toContain("fatal: worker failed");
		const opaque = output.find((message) => message.toolCallId === "opaque")!;
		expect(opaque.content).toEqual([{ type: "text", text: "image caption" }, { type: "image", data: "raw-image" }]);
	});

	it("replays a committed result-and-arguments layer byte-identically after resume", () => {
		const messages = completedSession(40);
		messages[1] = assistantWithCalls([
			{ id: "c0", name: "subagent", args: { task: "resume probe " + "x".repeat(4_000) } },
		], { responseId: "resume-subagent" });
		(messages[2] as AgentMessage).toolName = "subagent";

		const first = engine();
		const firstOutput = first.value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });
		expect(toolCallArgs(firstOutput, "c0")?._contextFold).toBe("historical subagent arguments folded");
		expect(first.layers).toHaveLength(1);

		const resumed = engine();
		resumed.value.restoreLayers(first.layers);
		const resumedOutput = resumed.value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });

		expect(JSON.stringify(resumedOutput)).toBe(JSON.stringify(firstOutput));
		expect(resumed.layers).toHaveLength(0);
	});

	it.each(["spool", "index"] as const)("sends raw context when %s persistence fails", (failure) => {
		const dir = mkdtempSync(join(tmpdir(), `contextfold-${failure}-failure-`));
		try {
			const registry = new MapSpoolRegistry();
			const spool = new SpoolStore(dir);
			const index = new SeedIndexStore(dir);
			if (failure === "spool") spool.write = () => { throw new Error("spool unavailable"); };
			else index.append = () => { throw new Error("index unavailable"); };
			const value = new ContextFoldEngine(
				new FoldLadderPolicy(),
				{ absoluteTokenCap: 0, tailTarget: 0, defaultContextWindow: LARGE_WINDOW },
				registry,
			);
			const layers: FrozenLayer[] = [];
			value.onFoldEvent = (event) => {
				try {
					emitFoldIndex(event, { spool, registry, index, sessionId: "failure-test" });
					return true;
				} catch {
					return false;
				}
			};
			value.onLayerCommit = (layer) => layers.push(layer);
			const messages = completedSession(40);
			messages[1] = assistantWithCalls([{ id: "c0", name: "subagent", args: { task: "must remain raw" } }]);
			(messages[2] as AgentMessage).toolName = "subagent";

			const output = value.process(messages, { contextWindow: LARGE_WINDOW, tokens: null });
			expect(output).toBe(messages);
			expect(toolCallArgs(output, "c0")).toEqual({ task: "must remain raw" });
			expect(resultText(output, "c0")).not.toContain("FOLDED");
			expect(layers).toHaveLength(0);
			expect(registry.size).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
