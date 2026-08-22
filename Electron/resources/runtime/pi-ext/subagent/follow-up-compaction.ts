/**
 * Extension follow-up / heartbeat pre-prompt compaction guard (PipiUI).
 *
 * BUG BEING FIXED
 * ---------------
 * Pi native `_checkCompaction` runs in two places:
 *   - before every `prompt()` (agent-session.js:865)
 *   - after `agent_end` (agent-session.js:776)
 * The pre-prompt gate uses `shouldCompact` = tokens > contextWindow - 16384.
 * Heartbeats / stall-adjacent events wake the Boss via
 * `pi.sendUserMessage(..., { deliverAs: "followUp" })`, which always starts a
 * new turn with `source: "extension"`. Sitting near the reserve line therefore
 * compactes on every wake — the "heartbeat arrives, context already compacted"
 * symptom. Mid-turn soft-threshold was not this path.
 *
 * THIS LAYER
 * ----------
 * Wraps `AgentSession.prototype` (same mechanism as mid-turn-compaction.ts):
 *   - `prompt` marks the turn when `options.source === "extension"` and gates
 *     `_runAutoCompaction("threshold")` for that whole turn (covers native
 *     pre-prompt *and* mid-turn's official `_runAutoCompaction` call).
 *   - `_checkCompaction(..., skipAbortedCheck=false)` is the pre-prompt call.
 *     Same policy: overflow always; threshold only at `tokens >= contextWindow`.
 *
 * User / RPC turns (`source` missing, `"interactive"`, or `"rpc"`) are unchanged.
 * Manual `/compact` does not go through `_runAutoCompaction`. node_modules is not
 * patched; fetch-pi-runtime cannot overwrite this wrap.
 */

const INSTALLED = Symbol.for("pipiui.followUpCompaction.installed");
const EXTENSION_TURN = Symbol.for("pipiui.followUpCompaction.extensionTurn");

const LOG_PREFIX = "[pipiui-follow-up-compaction]";

export type FollowUpUsageLike = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	[key: string]: unknown;
};

export type FollowUpAssistantLike = {
	role?: string;
	stopReason?: string;
	usage?: FollowUpUsageLike;
	errorMessage?: string;
	[key: string]: unknown;
};

export type FollowUpSession = {
	model?: { contextWindow?: number } | null;
	agent?: { state?: { messages?: FollowUpAssistantLike[] } };
	_runAutoCompaction?: (reason: string, willRetry: boolean) => Promise<unknown>;
	_checkCompaction?: (
		assistantMessage: FollowUpAssistantLike,
		skipAbortedCheck?: boolean,
	) => Promise<unknown>;
	prompt?: (text: string, options?: { source?: string }) => unknown;
	[EXTENSION_TURN]?: boolean;
	[key: symbol]: unknown;
};

export type FollowUpSessionCtor = {
	prototype: object;
};

/**
 * Native `calculateContextTokens`: prefer totalTokens, else sum components.
 */
export function contextTokensFromUsage(usage?: FollowUpUsageLike | null): number {
	if (!usage || typeof usage !== "object") return 0;
	if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) return usage.totalTokens;
	const input = typeof usage.input === "number" ? usage.input : 0;
	const output = typeof usage.output === "number" ? usage.output : 0;
	const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
	const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
	return input + output + cacheRead + cacheWrite;
}

/** Hard overflow: tokens have reached or passed the model window. */
export function isHardContextOverflow(tokens: number, contextWindow: number): boolean {
	if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) return false;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return false;
	}
	return tokens >= contextWindow;
}

/**
 * Policy for an extension-injected pre-prompt check.
 * Overflow recovery always allowed. Threshold only at the hard window.
 */
export function shouldAllowExtensionPrePromptCompaction(args: {
	reason: string;
	tokens: number;
	contextWindow: number;
}): boolean {
	if (args.reason === "overflow") return true;
	if (args.reason !== "threshold") return true;
	return isHardContextOverflow(args.tokens, args.contextWindow);
}

function lastValidContextTokens(
	session: FollowUpSession,
	assistantMessage: FollowUpAssistantLike | undefined,
): number {
	const direct = contextTokensFromUsage(assistantMessage?.usage);
	const stop = assistantMessage?.stopReason;
	if (direct > 0 && stop !== "error" && stop !== "aborted") return direct;
	const messages = session.agent?.state?.messages;
	if (!Array.isArray(messages)) return direct;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || msg.role !== "assistant") continue;
		if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;
		const tokens = contextTokensFromUsage(msg.usage);
		if (tokens > 0) return tokens;
	}
	return direct;
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

function restoreAfter(result: unknown, restore: () => void): unknown {
	if (result != null && typeof (result as { then?: unknown }).then === "function") {
		return Promise.resolve(result).finally(restore);
	}
	restore();
	return result;
}

function gateThresholdAutoCompaction(session: FollowUpSession): () => void {
	const origRun = session._runAutoCompaction;
	if (typeof origRun !== "function") return () => {};
	session._runAutoCompaction = async (reason: string, willRetry: boolean) => {
		const contextWindow = session.model?.contextWindow ?? 0;
		const tokens = lastValidContextTokens(session, undefined);
		if (!shouldAllowExtensionPrePromptCompaction({ reason, tokens, contextWindow })) {
			return false;
		}
		return origRun.call(session, reason, willRetry);
	};
	return () => {
		session._runAutoCompaction = origRun;
	};
}

/**
 * Patch `AgentSession.prototype` once. Returns whether this call applied the patch.
 */
export function installFollowUpCompactionGuard(sessionClass?: FollowUpSessionCtor): boolean {
	const proto = sessionClass?.prototype;
	if (!proto || (typeof proto !== "object" && typeof proto !== "function")) return false;
	const record = proto as Record<PropertyKey, unknown>;
	if (record[INSTALLED]) return false;

	const wrappedPrompt = wrapPrototypeMethod(record, "prompt", (original) => {
		return function wrappedPrompt(this: FollowUpSession, ...args: unknown[]) {
			const options = args[1] as { source?: string } | undefined;
			const prev = this[EXTENSION_TURN];
			const restoreFns: Array<() => void> = [
				() => {
					this[EXTENSION_TURN] = prev;
				},
			];
			if (options?.source === "extension") {
				this[EXTENSION_TURN] = true;
				restoreFns.push(gateThresholdAutoCompaction(this));
			}
			const restore = () => {
				for (let i = restoreFns.length - 1; i >= 0; i--) restoreFns[i]?.();
			};
			try {
				return restoreAfter(original.apply(this, args), restore);
			} catch (error) {
				restore();
				throw error;
			}
		};
	});

	const wrappedCheck = wrapPrototypeMethod(record, "_checkCompaction", (original) => {
		return function wrappedCheckCompaction(this: FollowUpSession, ...args: unknown[]) {
			const assistantMessage = args[0] as FollowUpAssistantLike | undefined;
			const skipAbortedCheck = args[1] !== false;
			const suppressSoft = this[EXTENSION_TURN] === true && skipAbortedCheck === false;
			if (!suppressSoft) return original.apply(this, args);

			const origRun = this._runAutoCompaction;
			if (typeof origRun !== "function") return original.apply(this, args);

			const contextWindow = this.model?.contextWindow ?? 0;
			const tokens = lastValidContextTokens(this, assistantMessage);
			this._runAutoCompaction = async (reason: string, willRetry: boolean) => {
				if (
					!shouldAllowExtensionPrePromptCompaction({
						reason,
						tokens,
						contextWindow,
					})
				) {
					return false;
				}
				return origRun.call(this, reason, willRetry);
			};
			const restore = () => {
				this._runAutoCompaction = origRun;
			};
			try {
				return restoreAfter(original.apply(this, args), restore);
			} catch (error) {
				restore();
				throw error;
			}
		};
	});

	if (!wrappedPrompt || !wrappedCheck) {
		console.error(
			`${LOG_PREFIX} prompt/_checkCompaction missing on prototype; guard not installed`,
		);
		return false;
	}

	record[INSTALLED] = true;
	return true;
}

/**
 * Extension entry: patch `AgentSession.prototype` once.
 *
 * Must receive the live class from an ESM import (same constraint as
 * mid-turn-compaction.ts). Never edits node_modules / fetch-pi-runtime.
 */
export function registerFollowUpCompactionGuard(sessionClass?: FollowUpSessionCtor): void {
	try {
		if (!sessionClass) {
			console.error(`${LOG_PREFIX} AgentSession not found; follow-up guard not installed`);
			return;
		}
		installFollowUpCompactionGuard(sessionClass);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} install failed: ${message}`);
	}
}

/** Test helper: is this session currently marked as an extension-injected turn? */
export function isExtensionInjectedTurn(session: FollowUpSession): boolean {
	return session[EXTENSION_TURN] === true;
}

/** Test helper: force the extension-turn mark without going through `prompt`. */
export function markExtensionInjectedTurn(session: FollowUpSession, marked: boolean): void {
	session[EXTENSION_TURN] = marked;
}
