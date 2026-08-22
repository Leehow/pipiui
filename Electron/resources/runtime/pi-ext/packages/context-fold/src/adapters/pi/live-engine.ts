/*
 * live-engine.ts — register the in-process ContextFoldEngine on well-known Symbols.
 *
 * P2's idle-fold timer prefers Symbol.for("pipiui.contextFold.runDeterministic") so a
 * dispatch-idle fold shares this session's frozen layers instead of constructing a
 * fresh engine. P3's context_manage tool uses Symbol.for("pipiui.contextFold.manage")
 * for inspect + fold-by-id on that same instance.
 *
 * No import cycle: both consumers look the symbols up on globalThis.
 */
import type { ContextFoldEngine, FoldByIdsResult } from "./store";
import type { AgentMessage } from "../../core/block";
import type { PolicyView } from "../../core/contract";

export const CONTEXT_FOLD_DETERMINISTIC_KEY = Symbol.for("pipiui.contextFold.runDeterministic");
export const CONTEXT_FOLD_MANAGE_KEY = Symbol.for("pipiui.contextFold.manage");

export interface LiveFoldContext {
	tokens?: number | null;
	contextWindow?: number | null;
}

export interface ContextFoldManageApi {
	viewFor(messages: readonly unknown[], context?: LiveFoldContext | null): PolicyView;
	foldByIds(messages: readonly unknown[], ids: readonly string[], context?: LiveFoldContext | null): FoldByIdsResult;
}

export function registerLiveContextFoldEngine(engine: ContextFoldEngine): void {
	const g = globalThis as Record<string | symbol, unknown>;
	g[CONTEXT_FOLD_DETERMINISTIC_KEY] = (input: {
		messages: readonly unknown[];
		tokens?: number | null;
		contextWindow?: number | null;
	}) => {
		const messages = engine.process(input.messages as AgentMessage[], {
			contextWindow: input.contextWindow ?? null,
			tokens: input.tokens ?? null,
		});
		return { folded: messages !== input.messages, messages };
	};
	g[CONTEXT_FOLD_MANAGE_KEY] = {
		viewFor(messages, context) {
			return engine.viewFor(messages as AgentMessage[], {
				contextWindow: context?.contextWindow ?? null,
				tokens: context?.tokens ?? null,
			});
		},
		foldByIds(messages, ids, context) {
			return engine.foldByIds(messages as AgentMessage[], ids, {
				contextWindow: context?.contextWindow ?? null,
				tokens: context?.tokens ?? null,
			});
		},
	} satisfies ContextFoldManageApi;
}

export function getLiveContextFoldManage(): ContextFoldManageApi | undefined {
	const registered = (globalThis as Record<string | symbol, unknown>)[CONTEXT_FOLD_MANAGE_KEY];
	if (!registered || typeof registered !== "object") return undefined;
	const api = registered as Partial<ContextFoldManageApi>;
	if (typeof api.viewFor !== "function" || typeof api.foldByIds !== "function") return undefined;
	return api as ContextFoldManageApi;
}
