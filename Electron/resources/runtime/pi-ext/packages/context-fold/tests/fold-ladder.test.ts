/*
 * fold-ladder.test.ts — the discrete fold ladder, the shipped folding policy:
 * threshold crossing, step spacing, cold branch, cap emergency, byte-stable layers,
 * and fold-event reporting.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adapterConfigFromEnv } from "../src/adapters/pi/config";
import { ContextFoldEngine, type FoldEventReport, type FrozenLayer } from "../src/adapters/pi/store";
import { FoldLadderPolicy, LADDER_DEFAULTS } from "../src/core/policy/fold-ladder";
import { annotateExternalized, parseSubagentDone } from "../src/core/policy/externalized";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import type { AgentMessage } from "../src/core/block";
import type { FoldPolicy, PolicyView, ViewBlock } from "../src/core/contract";
import { user, assistantText, assistantWithCalls, bigResult, toolResult, isBalanced } from "./helpers";

function ladderEngine(cfg: Record<string, unknown> = {}, ladderCfg = LADDER_DEFAULTS) {
	const policy = new FoldLadderPolicy(ladderCfg);
	const e = new ContextFoldEngine(policy, { tailTarget: 100, ...cfg }, new MapSpoolRegistry());
	const committed: FrozenLayer[] = [];
	const events: FoldEventReport[] = [];
	e.onLayerCommit = (layer) => committed.push(layer);
	e.onFoldEvent = (ev) => events.push(ev);
	return { e, policy, committed, events };
}

function session(n: number, linesEach = 400): { messages: AgentMessage[]; callIds: string[] } {
	const messages: AgentMessage[] = [user("build the thing")];
	const callIds: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = `c${i}`;
		callIds.push(id);
		messages.push(assistantWithCalls([{ id, name: "read" }]));
		messages.push(bigResult(id, linesEach));
	}
	messages.push(user("now the newest question"));
	return { messages, callIds };
}

function resultText(messages: AgentMessage[], callId: string): string {
	for (const m of messages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const tr = m as { toolCallId?: string; content?: { type: string; text?: string }[] };
		if (tr.toolCallId === callId) return tr.content?.[0]?.text ?? "";
	}
	throw new Error(`no toolResult for ${callId}`);
}

/** The parts of one assistant message as `{type, text}`, so each kind can be asserted separately. */
function assistantParts(messages: AgentMessage[], responseId: string): { type: string; text: string }[] {
	for (const m of messages) {
		const a = m as { role?: string; responseId?: string; content?: unknown };
		if (a.role !== "assistant" || a.responseId !== responseId) continue;
		return (a.content as { type: string; text?: string; thinking?: string; name?: string }[]).map((p) => ({
			type: p.type,
			text: p.type === "thinking" ? (p.thinking ?? "") : p.type === "text" ? (p.text ?? "") : (p.name ?? ""),
		}));
	}
	throw new Error(`no assistant message ${responseId}`);
}

describe("discrete fold events", () => {
	it("below the first-fold threshold the context goes out untouched (append-only between events)", () => {
		const { e, committed } = ladderEngine();
		const { messages } = session(3); // ~15k live
		const out = e.process(messages, { contextWindow: 80_000, tokens: null }); // ~0.19 of window
		expect(out).toBe(messages);
		expect(committed.length).toBe(0);
	});

	it("crossing the threshold fires ONE fold event: observations mask, intent and actions stay", () => {
		const { e, committed, events } = ladderEngine();
		const { messages, callIds } = session(8); // ~39k live
		const out = e.process(messages, { contextWindow: 80_000, tokens: null }); // ~0.49 ≥ 0.45

		expect(committed.length).toBe(1);
		expect(events.length).toBe(1);
		expect(events[0].trigger).toBe("threshold");
		expect(events[0].maskedIds.length).toBeGreaterThan(0);
		expect(isBalanced(out)).toBe(true);

		// Oldest observation masked to a reversible pointer digest…
		expect(resultText(out, callIds[0])).toContain("FOLDED");
		// …while user intent survives verbatim.
		const users = out.filter((m) => (m as { role?: string }).role === "user");
		expect(users.length).toBe(2);
	});

	it("masks tool observations, but never thinking, an assistant conclusion, or an action", () => {
		const { e, committed } = ladderEngine();
		// The oldest exchange carries all three kinds, so one fold event decides all three at once.
		const thinkingText = "weighing options: " + "consider the parser path ".repeat(1200);
		const messages: AgentMessage[] = [user("build the thing")];
		messages.push(
			assistantWithCalls([{ id: "c0", name: "read" }], {
				responseId: "rA",
				thinking: thinkingText,
				text: "Conclusion: the parser is the bottleneck.", // a durable conclusion
			}),
		);
		messages.push(bigResult("c0", 400));
		for (let i = 1; i < 8; i++) {
			messages.push(assistantWithCalls([{ id: `c${i}`, name: "read" }]));
			messages.push(bigResult(`c${i}`, 400));
		}
		messages.push(user("now the newest question"));

		const out = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(committed.length).toBe(1);

		const parts = assistantParts(out, "rA");
		const thinking = parts.find((p) => p.type === "thinking");
		const text = parts.find((p) => p.type === "text");
		const call = parts.find((p) => p.type === "toolCall");

		// PipiUI treats all assistant reasoning as provider-owned bytes. Only the observation folds.
		expect(thinking?.text).toBe(thinkingText);
		expect(text?.text).toBe("Conclusion: the parser is the bottleneck.");
		expect(call?.text).toBe("read");
		expect(resultText(out, "c0")).toContain("FOLDED");
	});

	it("a fresh fold cannot re-fire next turn: frozen bytes hold and no second layer commits", () => {
		const { e, committed } = ladderEngine();
		const { messages, callIds } = session(8);
		const first = e.process(messages, { contextWindow: 80_000, tokens: null });
		const firstText = resultText(first, callIds[0]);
		const second = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(committed.length).toBe(1);
		expect(resultText(second, callIds[0])).toBe(firstText);
	});

	it("step spacing: over the threshold but with too little maskable mass, no event fires", () => {
		const { e, committed } = ladderEngine();
		// A huge (unmaskable) user brief + one small observation: fraction ≥ 0.45, savings ≪ step.
		const messages: AgentMessage[] = [
			user("brief: " + "requirements ".repeat(12_000)), // ~39k tokens of user intent
			assistantWithCalls([{ id: "c0", name: "read" }]),
			bigResult("c0", 150), // ~2k — under the 0.12 × 80k step
			user("go"),
		];
		const out = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(out).toBe(messages);
		expect(committed.length).toBe(0);
	});

	it("cold branch: with no live cache read there is no prefix to protect — folds from 25 %", () => {
		const { e, policy, committed } = ladderEngine();
		const { messages } = session(6); // ~29k live → 0.29 of 100k
		policy.setCold(true);
		e.process(messages, { contextWindow: 100_000, tokens: null });
		expect(committed.length).toBe(1);

		// Same session, warm: 0.29 < 0.45 → no event.
		const warm = ladderEngine();
		warm.policy.setCold(false);
		warm.e.process(session(6).messages, { contextWindow: 100_000, tokens: null });
		expect(warm.committed.length).toBe(0);
	});

	it("crossing the budget cap is an emergency event regardless of the ladder position", () => {
		const { e, committed, events } = ladderEngine({ absoluteTokenCap: 10_000 });
		const { messages } = session(3); // ~15k live > 10k cap; 0.075 of a 200k window
		e.process(messages, { contextWindow: 200_000, tokens: null });
		expect(committed.length).toBe(1);
		expect(events[0].trigger).toBe("cap");
	});

	it("never masks a tool result before its first provider delivery", () => {
		const { e, committed } = ladderEngine({ absoluteTokenCap: 1_000, tailTarget: 0 });
		const messages: AgentMessage[] = [user("read it"), assistantWithCalls([{ id: "fresh", name: "read" }]), bigResult("fresh", 500)];

		const first = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(first, "fresh")).not.toContain("FOLDED");
		expect(committed).toHaveLength(0);

		messages.push(assistantText("finished reading", "after-fresh"), user("continue"));
		const second = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(second, "fresh")).toContain("FOLDED");
		expect(committed).toHaveLength(1);
	});

	it("protects every parallel result on their shared first delivery", () => {
		const { e, committed } = ladderEngine({ absoluteTokenCap: 1_000, tailTarget: 0 });
		const messages: AgentMessage[] = [
			user("read both"),
			assistantWithCalls([{ id: "p1", name: "read" }, { id: "p2", name: "read" }]),
			bigResult("p1", 300),
			bigResult("p2", 300),
		];

		const first = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(first, "p1")).not.toContain("FOLDED");
		expect(resultText(first, "p2")).not.toContain("FOLDED");
		expect(committed).toHaveLength(0);

		messages.push(assistantText("finished reading", "after-parallel"), user("continue"));
		const second = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(second, "p1")).toContain("FOLDED");
		expect(resultText(second, "p2")).toContain("FOLDED");
	});

	it("engine lowering rejects a fresh result even when a defective policy requests it", () => {
		const hostile: FoldPolicy = {
			id: "hostile",
			label: "hostile",
			conduct: (view) => [{ kind: "fold", ids: view.blocks.filter((block) => block.kind === "tool_result").map((block) => block.id) }],
		};
		const engine = new ContextFoldEngine(hostile, { tailTarget: 0 }, new MapSpoolRegistry());
		const messages: AgentMessage[] = [user("read it"), assistantWithCalls([{ id: "fresh", name: "read" }]), bigResult("fresh", 300)];

		const out = engine.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(out, "fresh")).not.toContain("FOLDED");
	});

	it("keeps a fold raw when its durability callback rejects the commit", () => {
		const { e, committed } = ladderEngine({ absoluteTokenCap: 10_000 });
		const { messages, callIds } = session(3);
		e.onFoldEvent = () => false;

		const rejected = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(rejected, callIds[0])).not.toContain("FOLDED");
		expect(committed).toHaveLength(0);

		e.onFoldEvent = () => true;
		const accepted = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(accepted, callIds[0])).toContain("FOLDED");
		expect(committed[0].seq).toBe(1);
	});

	it("provider-reported usage drives the fraction when present", () => {
		const { e, committed } = ladderEngine();
		const { messages } = session(8); // estimator says ~0.49 of 80k
		// Provider says the context is actually tiny — trust it, no fold.
		const out = e.process(messages, { contextWindow: 80_000, tokens: 8_000 });
		expect(out).toBe(messages);
		expect(committed.length).toBe(0);
	});
});


describe("reversibility", () => {
	it("recall and unfold still resolve a ladder-masked block", () => {
		const { e, committed } = ladderEngine();
		const { messages } = session(8);
		e.process(messages, { contextWindow: 80_000, tokens: null });
		const frozenId = committed[0].entries[0].id;
		const code = frozenId.replace(/^r:/, "");

		const { matches, missing } = e.resolveRecall([codeOf(frozenId)]);
		expect(missing).toEqual([]);
		expect(matches[0].text).toContain("line 0:");

		e.markUnfold([codeOf(frozenId)]);
		const after = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(resultText(after, code)).toContain("line 0:");
	});
});

describe("externalized fold priority", () => {
	function doneWithFindings(agentId: string, findingsPath: string): string {
		return [
			`[subagent-done] agentId=${agentId} runId=run-1 name=explore ok=true verified=none cost=0.0000 turns=1`,
			"Title: recon",
			"Result:",
			"TLDR: the worker finished.",
			`Findings: ${findingsPath} — this worker's full report, on disk. Do NOT read it yourself; put this exact path in the next worker's brief.`,
		].join("\n");
	}

	function mixedSession(findingsPath: string): AgentMessage[] {
		const messages: AgentMessage[] = [user("orchestrate")];
		messages.push(
			assistantWithCalls([{ id: "ext", name: "subagent_status", args: { agentId: "worker-a", runId: "run-1" } }]),
		);
		messages.push(bigResult("ext", 900, "subagent_status"));
		for (let i = 0; i < 8; i++) {
			messages.push(assistantWithCalls([{ id: `c${i}`, name: "read" }]));
			messages.push(bigResult(`c${i}`, 400));
		}
		messages.push(user(doneWithFindings("worker-a", findingsPath)));
		messages.push(user("now the newest question"));
		return messages;
	}

	function withFindingsFile(agentId: string): { dir: string; path: string } {
		const dir = mkdtempSync(join(tmpdir(), "cf-findings-"));
		const path = join(dir, ".pi", "findings", `${agentId}.md`);
		mkdirSync(join(dir, ".pi", "findings"), { recursive: true });
		writeFileSync(path, `# ${agentId}\nfull worker report\n`);
		return { dir, path };
	}

	function vb(partial: Partial<ViewBlock> & Pick<ViewBlock, "id" | "kind" | "tokens">): ViewBlock {
		return {
			turn: 1,
			order: 0,
			foldedTokens: 20,
			held: false,
			folded: false,
			protected: false,
			...partial,
		};
	}

	it("parses agentId and Findings path from a [subagent-done] body", () => {
		const path = "/repo/.pi/findings/worker-a.md";
		const parsed = parseSubagentDone(doneWithFindings("worker-a", path));
		expect(parsed.agentId).toBe("worker-a");
		expect(parsed.findingsPath).toBe(path);
		expect(parseSubagentDone("ordinary tool output")).toEqual({});
	});

	it("marks the matching tool_result externalized when the named findings file exists", () => {
		const path = "/repo/.pi/findings/worker-a.md";
		const blocks = annotateExternalized(
			[
				vb({ id: "u:done", kind: "user", tokens: 40, text: doneWithFindings("worker-a", path), order: 0 }),
				vb({
					id: "a:1:p0",
					kind: "tool_call",
					tokens: 10,
					callId: "ext",
					toolName: "subagent_status",
					toolArgs: { agentId: "worker-a" },
					order: 1,
				}),
				vb({ id: "r:ext", kind: "tool_result", tokens: 8_000, callId: "ext", order: 2 }),
				vb({ id: "r:norm", kind: "tool_result", tokens: 8_000, callId: "norm", order: 3 }),
			],
			(candidate) => candidate === path,
		);
		expect(blocks.find((b) => b.id === "r:ext")?.externalized).toBe(true);
		expect(blocks.find((b) => b.id === "r:ext")?.agentId).toBe("worker-a");
		expect(blocks.find((b) => b.id === "r:norm")?.externalized).toBeFalsy();
		expect(blocks.find((b) => b.id === "u:done")?.kind).toBe("user");
	});

	it("leaves blocks unmarked when the findings file is missing", () => {
		const path = "/missing/.pi/findings/worker-a.md";
		const blocks = annotateExternalized(
			[
				vb({ id: "u:done", kind: "user", tokens: 40, text: doneWithFindings("worker-a", path) }),
				vb({
					id: "r:ext",
					kind: "tool_result",
					tokens: 8_000,
					callId: "ext",
					agentId: "worker-a",
				}),
			],
			() => false,
		);
		expect(blocks.find((b) => b.id === "r:ext")?.externalized).toBeFalsy();
	});

	it("folds only the externalized worker result when it already buys a ladder step", () => {
		const policy = new FoldLadderPolicy({
			...LADDER_DEFAULTS,
			findingsExists: (path) => path.endsWith("worker-a.md"),
		});
		const view: PolicyView = {
			blocks: [
				vb({
					id: "u:done",
					kind: "user",
					tokens: 40,
					text: doneWithFindings("worker-a", "/repo/.pi/findings/worker-a.md"),
					order: 0,
				}),
				vb({
					id: "a:1:p0",
					kind: "tool_call",
					tokens: 10,
					callId: "ext",
					toolName: "subagent_status",
					toolArgs: { agentId: "worker-a" },
					order: 1,
				}),
				vb({ id: "r:ext", kind: "tool_result", tokens: 20_000, foldedTokens: 30, callId: "ext", order: 2 }),
				vb({ id: "r:norm", kind: "tool_result", tokens: 20_000, foldedTokens: 30, callId: "norm", order: 3 }),
			],
			budget: 80_000,
			contextWindow: 80_000,
			liveTokens: 40_050,
			protectedFromIndex: 4,
			protectTokens: 100,
		};
		const cmds = policy.conduct(view);
		expect(cmds).toEqual([{ kind: "fold", ids: ["r:ext"] }]);
	});

	it("keeps fold-all-eligible behaviour when no findings file exists", () => {
		const policy = new FoldLadderPolicy({
			...LADDER_DEFAULTS,
			findingsExists: () => false,
		});
		const view: PolicyView = {
			blocks: [
				vb({ id: "u:1", kind: "user", tokens: 10, text: "go", order: 0 }),
				vb({ id: "r:a", kind: "tool_result", tokens: 20_000, foldedTokens: 30, callId: "a", order: 1 }),
				vb({ id: "r:b", kind: "tool_result", tokens: 20_000, foldedTokens: 30, callId: "b", order: 2 }),
			],
			budget: 80_000,
			contextWindow: 80_000,
			liveTokens: 40_010,
			protectedFromIndex: 3,
			protectTokens: 100,
		};
		const cmds = policy.conduct(view);
		expect(cmds).toEqual([{ kind: "fold", ids: ["r:a", "r:b"] }]);
	});

	it("never folds the [subagent-done] user message itself", () => {
		const { dir, path } = withFindingsFile("worker-a");
		try {
			const { e } = ladderEngine();
			const messages = mixedSession(path);
			const out = e.process(messages, { contextWindow: 80_000, tokens: null });
			const done = out.filter((m) => (m as { role?: string }).role === "user").find((m) => String((m as { content?: string }).content).includes("[subagent-done]"));
			expect(String((done as { content?: string })?.content ?? "")).toContain("Findings:");
			expect(String((done as { content?: string })?.content ?? "")).not.toContain("FOLDED");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("folds the externalized worker block to a pointer and recall_folded restores the original", () => {
		const { dir, path } = withFindingsFile("worker-a");
		try {
			const { e, committed, events } = ladderEngine();
			const messages = mixedSession(path);
			const view = e.viewFor(messages, { contextWindow: 80_000, tokens: null });
			const extView = view.blocks.find((b) => b.callId === "ext");
			expect(extView?.externalized).toBe(true);
			expect(extView?.agentId).toBe("worker-a");

			const out = e.process(messages, { contextWindow: 80_000, tokens: null });
			expect(events[0]?.trigger).toBe("threshold");
			expect(resultText(out, "ext")).toContain("FOLDED");
			expect(resultText(out, "c0")).not.toContain("FOLDED");
			expect(committed[0].entries.some((entry) => entry.id === "r:ext")).toBe(true);
			expect(committed[0].entries.some((entry) => entry.id === "r:c0")).toBe(false);

			const { matches, missing } = e.resolveRecall([codeOf("r:ext")]);
			expect(missing).toEqual([]);
			expect(matches[0].text).toContain("line 0:");
			expect(matches[0].text).not.toContain("FOLDED");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not change a session whose [subagent-done] names a missing findings file", () => {
		const { e, committed } = ladderEngine();
		const messages = mixedSession("/no/such/.pi/findings/worker-a.md");
		const out = e.process(messages, { contextWindow: 80_000, tokens: null });
		expect(committed.length).toBe(1);
		expect(resultText(out, "ext")).toContain("FOLDED");
		expect(resultText(out, "c0")).toContain("FOLDED");
	});

	it("parses CONTEXTFOLD_PREFER_EXTERNALIZED and CONTEXTFOLD_EXTERNALIZED_WEIGHT", () => {
		const names = ["CONTEXTFOLD_PREFER_EXTERNALIZED", "CONTEXTFOLD_EXTERNALIZED_WEIGHT"] as const;
		const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
		try {
			delete process.env.CONTEXTFOLD_PREFER_EXTERNALIZED;
			delete process.env.CONTEXTFOLD_EXTERNALIZED_WEIGHT;
			expect(adapterConfigFromEnv().ladder.preferExternalized).toBe(true);
			expect(adapterConfigFromEnv().ladder.externalizedWeight).toBe(1);

			process.env.CONTEXTFOLD_PREFER_EXTERNALIZED = "0";
			process.env.CONTEXTFOLD_EXTERNALIZED_WEIGHT = "0";
			expect(adapterConfigFromEnv().ladder.preferExternalized).toBe(false);
			expect(adapterConfigFromEnv().ladder.externalizedWeight).toBe(0);

			process.env.CONTEXTFOLD_PREFER_EXTERNALIZED = "high";
			process.env.CONTEXTFOLD_EXTERNALIZED_WEIGHT = "2";
			expect(adapterConfigFromEnv().ladder.preferExternalized).toBe(true);
			expect(adapterConfigFromEnv().ladder.externalizedWeight).toBe(2);
		} finally {
			for (const name of names) {
				if (previous[name] === undefined) delete process.env[name];
				else process.env[name] = previous[name];
			}
		}
	});
});

// local: avoid importing digest just for the code helper
import { foldCode } from "../src/core/digest";
function codeOf(id: string): string {
	return foldCode(id);
}
