/**
 * Mid-turn compaction guard (PipiUI).
 *
 * BUG BEING FIXED
 * ---------------
 * pi's `_checkCompaction` only runs before `prompt()` and after a full
 * `agent_end`. The in-turn tool loop lives in `@mariozechner/pi-agent-core`
 * `runLoop` and issues the next `streamAssistantResponse` without a threshold
 * check. Threshold math also uses last-assistant `totalTokens` and **drops**
 * trailing `toolResult`s; some providers (Grok) under-report usage. The host
 * 80% `ProactiveCompactionScheduler` only fires after 2s idle and skips busy
 * / queued sessions. Overflow therefore surfaces as a 400 first, and only
 * then `_runAutoCompaction("overflow")`.
 *
 * THIS LAYER
 * ----------
 * Wraps `AgentSession.prototype._runAgentPrompt` (and `_buildRuntime` when
 * present) so every session — main and worker — gets `transformContext`
 * wrapped. The wrapper runs the original `emitContext`, then compact via the
 * official `_runAutoCompaction("threshold", false)` path (persist + events,
 * `willRetry` false so the tool loop continues). Never `ctx.compact()`
 * (that aborts the turn). Never silently drop messages without persist.
 *
 * Official `_runAutoCompaction(..., false)` returns `hasQueuedMessages()`
 * after a successful compact (often `false`). Never treat that boolean as
 * failure. The in-turn loop holds a slice copy of messages; after compact
 * always return `agent.state.messages`, never the pre-compact snapshot.
 */

import { createRequire } from "node:module";

const INSTALLED = Symbol.for("pipiui.midTurnCompaction.installed");
const WRAPPED = Symbol.for("pipiui.midTurnCompaction.wrapped");
const COMPACTING = Symbol.for("pipiui.midTurnCompaction.compacting");
const COMPACTED_THIS_RUN = Symbol.for("pipiui.midTurnCompaction.compactedThisRun");

const LOG_PREFIX = "[pipiui-mid-turn-compaction]";
const DEFAULT_RESERVE_TOKENS = 16_384;
const ESTIMATED_IMAGE_CHARS = 4800;

export type MidTurnUsageLike = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	[key: string]: unknown;
};

export type MidTurnMessage = {
	role?: string;
	stopReason?: string;
	usage?: MidTurnUsageLike;
	content?: unknown;
	[key: string]: unknown;
};

export type MidTurnCompactionSettings = {
	enabled?: boolean;
	reserveTokens?: number;
	keepRecentTokens?: number;
};

export type MidTurnSession = {
	model?: { contextWindow?: number } | null;
	settingsManager?: {
		getCompactionSettings?: () => MidTurnCompactionSettings | undefined;
	};
	agent?: {
		transformContext?: (
			messages: MidTurnMessage[],
			signal?: AbortSignal,
		) => Promise<MidTurnMessage[]>;
		state?: { messages?: MidTurnMessage[] };
	};
	_runAutoCompaction?: (reason: string, willRetry: boolean) => Promise<unknown>;
	[COMPACTING]?: boolean;
	[COMPACTED_THIS_RUN]?: boolean;
	[key: symbol]: unknown;
};

export type MidTurnSessionCtor = {
	prototype: object;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asMessages(value: unknown): MidTurnMessage[] | undefined {
	return Array.isArray(value) ? (value as MidTurnMessage[]) : undefined;
}

function contentChars(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (typeof block.text === "string") chars += block.text.length;
		else if (typeof block.thinking === "string") chars += block.thinking.length;
		else if (block.type === "toolCall") {
			chars += String(block.name ?? "").length;
			try {
				chars += JSON.stringify(block.arguments ?? {}).length;
			} catch {
				// ignore
			}
		} else if (block.type === "image") {
			chars += ESTIMATED_IMAGE_CHARS;
		}
	}
	return chars;
}

/** Local chars/4 heuristic (no pi-coding-agent import). */
function estimateOne(message: unknown): number {
	if (!isRecord(message)) return 0;
	const role = message.role;
	let chars = 0;
	if (role === "assistant" || role === "user" || role === "toolResult" || role === "custom") {
		chars = contentChars(message.content);
	} else if (role === "bashExecution") {
		chars = String(message.command ?? "").length + String(message.output ?? "").length;
	} else if (role === "branchSummary" || role === "compactionSummary") {
		chars = String(message.summary ?? "").length;
	} else {
		chars = contentChars(message.content);
	}
	const tokens = Math.ceil(chars / 4);
	return Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
}

function usageTokens(usage: unknown): number {
	if (!isRecord(usage)) return 0;
	const total = usage.totalTokens;
	if (typeof total === "number" && Number.isFinite(total) && total > 0) return total;
	const input = typeof usage.input === "number" ? usage.input : 0;
	const output = typeof usage.output === "number" ? usage.output : 0;
	const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
	const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
	const sum = input + output + cacheRead + cacheWrite;
	return Number.isFinite(sum) && sum > 0 ? sum : 0;
}

function isSkippedStopReason(stopReason: unknown): boolean {
	return stopReason === "aborted" || stopReason === "error";
}

function lastValidUsage(
	messages: MidTurnMessage[],
): { index: number; tokens: number } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || msg.role !== "assistant") continue;
		if (isSkippedStopReason(msg.stopReason)) continue;
		const tokens = usageTokens(msg.usage);
		if (tokens > 0) return { index: i, tokens };
	}
	return undefined;
}

/**
 * Next-request size: max(lastValidUsage + trailing estimate, full estimate).
 * Under-reported provider usage cannot hide a huge transcript; trailing tool
 * results after the last usage cannot be dropped either.
 */
export function estimateNextRequestTokens(messages: unknown): number {
	const list = asMessages(messages);
	if (!list || list.length === 0) return 0;

	let fullEstimate = 0;
	for (const message of list) {
		fullEstimate += estimateOne(message);
	}

	const last = lastValidUsage(list);
	if (!last) return fullEstimate;

	let trailing = 0;
	for (let i = last.index + 1; i < list.length; i++) {
		trailing += estimateOne(list[i]);
	}
	return Math.max(last.tokens + trailing, fullEstimate);
}

function resolveReserve(settings?: MidTurnCompactionSettings | null): number {
	const reserve = settings?.reserveTokens;
	if (typeof reserve === "number" && Number.isFinite(reserve) && reserve >= 0) return reserve;
	return DEFAULT_RESERVE_TOKENS;
}

/**
 * Compact before the provider call when over reserve threshold or the hard
 * context window. `enabled === false` always skips.
 */
export function shouldCompactBeforeProvider(
	tokens: number,
	contextWindow: number,
	settings: MidTurnCompactionSettings = {},
): boolean {
	if (settings.enabled === false) return false;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return false;
	}
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return false;
	const reserve = resolveReserve(settings);
	if (tokens > contextWindow - reserve) return true;
	return tokens >= contextWindow;
}

function readCompactionSettings(session: MidTurnSession): MidTurnCompactionSettings {
	try {
		return session.settingsManager?.getCompactionSettings?.() ?? { enabled: true };
	} catch {
		return { enabled: true };
	}
}

function stateMessages(session: MidTurnSession): MidTurnMessage[] | undefined {
	return asMessages(session.agent?.state?.messages);
}

/**
 * If the next provider request would exceed the window / reserve, run the
 * official auto-compaction path (`willRetry=false`) and return persisted
 * `session.agent.state.messages`. Re-entrant calls pass through.
 *
 * Do **not** treat `_runAutoCompaction`'s boolean as success: with
 * `willRetry=false` a successful compact returns `hasQueuedMessages()`.
 */
export async function compactMessagesIfNeeded(
	session: MidTurnSession | null | undefined,
	messages: MidTurnMessage[],
): Promise<MidTurnMessage[]> {
	const incoming = asMessages(messages) ?? [];
	if (!session || session[COMPACTING]) return incoming;

	const settings = readCompactionSettings(session);
	if (settings.enabled === false) return incoming;

	const contextWindow = session.model?.contextWindow ?? 0;
	const tokens = estimateNextRequestTokens(incoming);
	if (!shouldCompactBeforeProvider(tokens, contextWindow, settings)) return incoming;

	if (session[COMPACTED_THIS_RUN]) {
		return stateMessages(session) ?? incoming;
	}

	const run = session._runAutoCompaction;
	if (typeof run !== "function") {
		console.error(`${LOG_PREFIX} _runAutoCompaction missing; skipping mid-turn compact`);
		return incoming;
	}

	const before = session.agent?.state?.messages;
	session[COMPACTING] = true;
	try {
		await run.call(session, "threshold", false);
		const after = session.agent?.state?.messages;
		if (Array.isArray(after) && after !== before) {
			session[COMPACTED_THIS_RUN] = true;
			return after;
		}
		const current = stateMessages(session);
		return current ?? incoming;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} _runAutoCompaction failed: ${message}`);
		const current = stateMessages(session);
		if (current && current !== incoming && current !== before) return current;
		return incoming;
	} finally {
		session[COMPACTING] = false;
	}
}

/**
 * Wrap `session.agent.transformContext`: original emitContext first, then
 * `compactMessagesIfNeeded`. Idempotent (second wrap is a no-op).
 */
export function wrapAgentTransformContext<T extends MidTurnSession>(session: T): T {
	const agent = session?.agent;
	if (!agent || !isRecord(agent)) return session;
	if ((agent as { [WRAPPED]?: boolean })[WRAPPED]) return session;

	const original = agent.transformContext;
	agent.transformContext = async (messages, signal) => {
		let next = asMessages(messages) ?? [];
		if (typeof original === "function") {
			try {
				const result = await original.call(agent, next, signal);
				next = asMessages(result) ?? next;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`${LOG_PREFIX} original transformContext failed: ${message}`);
			}
		}
		return compactMessagesIfNeeded(session, next);
	};
	(agent as { [WRAPPED]?: boolean })[WRAPPED] = true;
	return session;
}

function wrapPrototypeMethod(
	proto: Record<PropertyKey, unknown>,
	name: string,
	createWrapper: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
): boolean {
	const original = proto[name];
	if (typeof original !== "function") return false;
	proto[name] = createWrapper(original as (...args: unknown[]) => unknown);
	return true;
}

/**
 * Patch `AgentSession.prototype` once so every constructed session wraps
 * `transformContext` on `_runAgentPrompt` (and `_buildRuntime` when present).
 * Returns whether this call applied the patch.
 */
export function installMidTurnCompactionGuard(sessionClass?: MidTurnSessionCtor): boolean {
	const proto = sessionClass?.prototype;
	if (!proto || (typeof proto !== "object" && typeof proto !== "function")) return false;
	const record = proto as Record<PropertyKey, unknown>;
	if (record[INSTALLED]) return false;

	const wrappedRun = wrapPrototypeMethod(record, "_runAgentPrompt", (original) => {
		return function wrappedRunAgentPrompt(this: MidTurnSession, ...args: unknown[]) {
			this[COMPACTED_THIS_RUN] = false;
			wrapAgentTransformContext(this);
			return original.apply(this, args);
		};
	});

	const wrappedBuild = wrapPrototypeMethod(record, "_buildRuntime", (original) => {
		return function wrappedBuildRuntime(this: MidTurnSession, ...args: unknown[]) {
			const result = original.apply(this, args);
			wrapAgentTransformContext(this);
			return result;
		};
	});

	if (!wrappedRun && !wrappedBuild) {
		console.error(
			`${LOG_PREFIX} neither _runAgentPrompt nor _buildRuntime on prototype; guard not installed`,
		);
		return false;
	}

	record[INSTALLED] = true;
	return true;
}

function loadAgentSessionCtor(): MidTurnSessionCtor | undefined {
	try {
		const require = createRequire(import.meta.url);
		const mod = require("@earendil-works/pi-coding-agent") as {
			AgentSession?: MidTurnSessionCtor;
		};
		if (mod?.AgentSession) return mod.AgentSession;
	} catch {
		// Tests and hermetic runs must not need this package at import time.
	}
	return undefined;
}

/** Extension entry: install the prototype guard once. Applies at every depth. */
export function registerMidTurnCompactionGuard(): void {
	try {
		const ctor = loadAgentSessionCtor();
		if (!ctor) {
			console.error(`${LOG_PREFIX} AgentSession not found; mid-turn guard not installed`);
			return;
		}
		installMidTurnCompactionGuard(ctor);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} install failed: ${message}`);
	}
}
