/*
 * fold-by-ids.test.ts — production fold-by-id path used by context_manage.
 * Uses the real ContextFoldEngine (not a mock): lower → commitLayer → applyPlan,
 * then recall_folded restores the original bytes.
 */
import { describe, expect, it } from "vitest";
import { ContextFoldEngine, type FrozenLayer } from "../src/adapters/pi/store";
import { registerLiveContextFoldEngine, getLiveContextFoldManage, CONTEXT_FOLD_MANAGE_KEY } from "../src/adapters/pi/live-engine";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import { foldCode } from "../src/core/digest";
import { assistantWithCalls, bigResult, user } from "./helpers";

function engineWith() {
	const registry = new MapSpoolRegistry();
	const engine = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, registry);
	const layers: FrozenLayer[] = [];
	engine.onLayerCommit = (layer) => {
		layers.push(layer);
		return true;
	};
	return { engine, layers, registry };
}

function sessionWithResults() {
	const messages = [
		user("build the thing"),
		assistantWithCalls([{ id: "c0", name: "read" }]),
		bigResult("c0", 400),
		assistantWithCalls([{ id: "c1", name: "read" }]),
		bigResult("c1", 400),
		user("now the newest question"),
	];
	return { messages, ids: ["r:c0", "r:c1"] as const };
}

function resultText(messages: { role?: string; toolCallId?: string; content?: { type: string; text?: string }[] }[], callId: string): string {
	for (const message of messages) {
		if (message.role !== "toolResult" || message.toolCallId !== callId) continue;
		return message.content?.[0]?.text ?? "";
	}
	throw new Error(`no toolResult for ${callId}`);
}

describe("foldByIds production path", () => {
	it("folds only the requested ids and recall_folded restores the original", () => {
		const { engine, layers } = engineWith();
		const { messages } = sessionWithResults();
		const original = resultText(messages, "c0");
		expect(original).toContain("line 0:");

		const result = engine.foldByIds(messages, ["r:c0"], { contextWindow: 80_000, tokens: null });
		expect(result.foldedIds).toEqual(["r:c0"]);
		expect(result.skipped).toEqual([]);
		expect(layers).toHaveLength(1);
		expect(resultText(result.messages, "c0")).toContain("FOLDED");
		expect(resultText(result.messages, "c1")).not.toContain("FOLDED");
		expect(resultText(result.messages, "c0").length).toBeLessThan(original.length / 4);

		const recalled = engine.resolveRecall([foldCode("r:c0")]);
		expect(recalled.missing).toEqual([]);
		expect(recalled.matches[0]?.text).toContain("line 0:");
		expect(recalled.matches[0]?.text).not.toContain("FOLDED");
		expect(recalled.matches[0]?.text).toContain("line 1:");
	});

	it("refuses user messages and unknown ids", () => {
		const { engine } = engineWith();
		const { messages } = sessionWithResults();
		const view = engine.viewFor(messages, { contextWindow: 80_000, tokens: null });
		const userId = view.blocks.find((block) => block.kind === "user")?.id;
		expect(userId).toBeTruthy();

		const result = engine.foldByIds(messages, [userId!, "r:missing"], { contextWindow: 80_000, tokens: null });
		expect(result.foldedIds).toEqual([]);
		expect(result.skipped.some((row) => row.id === userId && row.reason === "user_message")).toBe(true);
		expect(result.skipped.some((row) => row.id === "r:missing" && row.reason === "unknown_id")).toBe(true);
		expect(result.messages).toBe(messages);
	});

	it("registers the live engine so context_manage can fold by id without a mock", () => {
		const { engine } = engineWith();
		const { messages } = sessionWithResults();
		registerLiveContextFoldEngine(engine);
		const live = getLiveContextFoldManage();
		expect(live).toBeTruthy();
		expect((globalThis as Record<string | symbol, unknown>)[CONTEXT_FOLD_MANAGE_KEY]).toBeTruthy();

		const folded = live!.foldByIds(messages, ["r:c0"], { contextWindow: 80_000, tokens: null });
		expect(folded.foldedIds).toEqual(["r:c0"]);
		const recalled = engine.resolveRecall([foldCode("r:c0")]);
		expect(recalled.matches[0]?.text).toContain("line 0:");
	});
});
