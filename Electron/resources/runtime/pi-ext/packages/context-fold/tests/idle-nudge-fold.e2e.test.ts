/*
 * idle-nudge-fold.e2e.test.ts — timer → nudge → inspect → fold → disk spool → recall.
 *
 * Joint path across idle-fold-timer, context_manage, and the live ContextFoldEngine.
 * Fold writes a real SpoolStore envelope; recall reads that file, not a memory mock.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextFoldEngine } from "../src/adapters/pi/store";
import { registerLiveContextFoldEngine, getLiveContextFoldManage, CONTEXT_FOLD_MANAGE_KEY } from "../src/adapters/pi/live-engine";
import { emitFoldIndex, SeedIndexStore } from "../src/adapters/pi/index-store";
import { SpoolStore } from "../src/adapters/pi/spool";
import { FoldLadderPolicy } from "../src/core/policy/fold-ladder";
import { MapSpoolRegistry } from "../src/core/spool-registry";
import { foldCode } from "../src/core/digest";
import { assistantWithCalls, bigResult, toolResult, user } from "./helpers";
import {
	executeContextManage,
	queueContextManageNudge,
	restoreNudgeThinking,
} from "../../../subagent/context-manage.ts";
import {
	createIdleFoldRegistry,
	IDLE_FOLD_TTL_MS_DEFAULT,
	type IdleFoldFireInfo,
} from "../../../subagent/idle-fold-timer.ts";

type FakeHandle = { id: number; at: number; callback: () => void; cancelled: boolean };

function createFakeClock() {
	let now = 0;
	let nextId = 1;
	const scheduled: FakeHandle[] = [];
	return {
		schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
			const handle: FakeHandle = { id: nextId++, at: now + delayMs, callback, cancelled: false };
			scheduled.push(handle);
			return handle as unknown as ReturnType<typeof setTimeout>;
		},
		cancel(handle: ReturnType<typeof setTimeout>) {
			(handle as unknown as FakeHandle).cancelled = true;
		},
		advance(ms: number) {
			now += ms;
			for (const handle of scheduled) {
				if (handle.cancelled || handle.at > now) continue;
				handle.cancelled = true;
				handle.callback();
			}
		},
	};
}

function resultText(messages: { role?: string; toolCallId?: string; content?: { type: string; text?: string }[] }[], callId: string): string {
	for (const message of messages) {
		if (message.role !== "toolResult" || message.toolCallId !== callId) continue;
		return message.content?.[0]?.text ?? "";
	}
	throw new Error(`no toolResult for ${callId}`);
}

describe("idle nudge → context_manage → spool/recall", () => {
	const dirs: string[] = [];
	const previousManage = (globalThis as Record<string | symbol, unknown>)[CONTEXT_FOLD_MANAGE_KEY];

	afterEach(() => {
		if (previousManage === undefined) delete (globalThis as Record<string | symbol, unknown>)[CONTEXT_FOLD_MANAGE_KEY];
		else (globalThis as Record<string | symbol, unknown>)[CONTEXT_FOLD_MANAGE_KEY] = previousManage;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("fires one nudge, folds safe ids through the live engine, writes spool, and skips fallback", async () => {
		const dir = mkdtempSync(join(tmpdir(), "idle-nudge-fold-"));
		dirs.push(dir);
		const spool = new SpoolStore(dir);
		const index = new SeedIndexStore(dir);
		const registry = new MapSpoolRegistry();
		const engine = new ContextFoldEngine(new FoldLadderPolicy(), { tailTarget: 100 }, registry);
		engine.onFoldEvent = (event) => {
			const { droppedIds } = emitFoldIndex(event, { spool, registry, index, sessionId: "e2e-idle" });
			return droppedIds.length ? droppedIds : true;
		};
		engine.onLayerCommit = () => true;
		registerLiveContextFoldEngine(engine);
		const live = getLiveContextFoldManage();
		expect(live).toBeTruthy();

		const clock = createFakeClock();
		const folds: IdleFoldFireInfo[] = [];
		const nudges: IdleFoldFireInfo[] = [];
		const thinking: string[] = [];
		let currentThinking = "high";
		const idle = createIdleFoldRegistry({
			ttlMs: IDLE_FOLD_TTL_MS_DEFAULT,
			nudge: true,
			fallback: true,
			fallbackMs: 60_000,
			schedule: clock.schedule,
			cancel: clock.cancel,
			isContextAboveWatermark: () => true,
			onNudge: (info) => {
				nudges.push(info);
				return queueContextManageNudge({
					sendMessage: () => undefined,
					getThinkingLevel: () => currentThinking,
					setThinkingLevel: (level) => {
						thinking.push(level);
						currentThinking = level;
					},
				});
			},
			onFold: (info) => folds.push(info),
		});

		idle.arm("session-e2e", "worker-a");
			clock.advance(239_999);
		expect(nudges).toHaveLength(0);
		clock.advance(1);
		expect(nudges).toHaveLength(1);
		expect(folds).toHaveLength(0);
		expect(thinking).toEqual(["low"]);
		expect(currentThinking).toBe("low");

		const messages = [
			user("build the thing"),
			assistantWithCalls([{ id: "plan1", name: "plan_publish" }]),
			toolResult("plan1", "# Plan\n1. do the work\n2. ship it", "plan_publish"),
			assistantWithCalls([{ id: "desk1", name: "computer_task" }]),
			bigResult("desk1", 400, "computer_task"),
			assistantWithCalls([{ id: "c0", name: "read" }]),
			bigResult("c0", 400),
			assistantWithCalls([{ id: "c1", name: "read" }]),
			bigResult("c1", 400),
			user("now the newest question"),
		];
		const original = resultText(messages, "c0");
		expect(original).toContain("line 0:");

		const deps = {
			getMessages: () => messages,
			getUsage: () => ({ tokens: 90_000, contextWindow: 200_000 }),
			manage: live!,
			onSuccessfulFold: () => idle.noteFolded("session-e2e"),
		};
		const inspected = await executeContextManage({ action: "inspect" }, deps);
		const manifest = JSON.parse(inspected.content[0]?.text ?? "{}") as {
			candidates: Array<{ id: string; category: string }>;
		};
		const ids = manifest.candidates.map((row) => row.id);
		expect(ids.length).toBeGreaterThan(0);
		expect(ids.every((id) => id === "r:c0" || id === "r:c1")).toBe(true);
		expect(ids).not.toContain("r:plan1");
		expect(ids).not.toContain("r:desk1");

		const folded = await executeContextManage({ action: "fold", ids }, deps);
		expect(folded.content[0]?.text ?? "").toMatch(/folded /);
		expect((folded.details as { foldedIds?: string[] }).foldedIds?.length ?? 0).toBeGreaterThan(0);

		clock.advance(60_000);
		expect(folds).toHaveLength(0);
		expect(idle.pendingTimerCount()).toBe(0);

		const foldedId = (folded.details as { foldedIds: string[] }).foldedIds[0]!;
		const code = foldCode(foldedId);
		const spoolPath = spool.pathFor(code);
		expect(existsSync(spoolPath)).toBe(true);
		expect(readFileSync(spoolPath, "utf8")).toContain("line 0:");

		const recalled = engine.resolveRecall([code]);
		expect(recalled.missing).toEqual([]);
		expect(recalled.errors).toEqual([]);
		expect(recalled.matches[0]?.label).toMatch(/spool/);
		expect(recalled.matches[0]?.text).toContain("line 0:");
		expect(recalled.matches[0]?.text).toContain("line 1:");
		expect(recalled.matches[0]?.text).not.toContain("FOLDED");

		restoreNudgeThinking({
			setThinkingLevel: (level) => {
				thinking.push(level);
				currentThinking = level;
			},
		});
		expect(thinking).toEqual(["low", "high"]);
		expect(currentThinking).toBe("high");
	});
});
