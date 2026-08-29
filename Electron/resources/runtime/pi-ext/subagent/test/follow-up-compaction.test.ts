import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	AUTO_COMPACTION_IDLE_MS_DEFAULT,
	AUTO_COMPACTION_RESERVE_TOKENS_DEFAULT,
	AUTO_COMPACTION_USAGE_FRACTION_DEFAULT,
	PROACTIVE_COMPACTION_MIN_TOKENS,
	autoCompactionIdleMs,
	contextTokensFromUsage,
	installFollowUpCompactionGuard,
	isExtensionInjectedTurn,
	isHardContextOverflow,
	isNearContextOverflow,
	markExtensionInjectedTurn,
	noteAutoCompactionActivity,
	registerFollowUpCompactionGuard,
	shouldAllowAutoCompaction,
	type FollowUpAssistantLike,
	type FollowUpSession,
} from "../follow-up-compaction.ts";
import { wrapAgentTransformContext } from "../mid-turn-compaction.ts";

const WINDOW = 500_000;
const RESERVE = 16_384;
const SOFT = WINDOW - RESERVE + 1; // trips native shouldCompact, still < window
const HARD = WINDOW;
/** Exactly at the 45% policy line. */
const POLICY_LINE = 225_000;
/** Just below the 45% policy line (44.999…%). */
const BELOW_POLICY_LINE = 224_998;
/** Above 45% but far below the near-overflow line. */
const MID_USAGE = 250_000;

type CompactCall = [string, boolean];

function usage(totalTokens: number): NonNullable<FollowUpAssistantLike["usage"]> {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
	};
}

function assistant(totalTokens: number, extra: Partial<FollowUpAssistantLike> = {}): FollowUpAssistantLike {
	return {
		role: "assistant",
		stopReason: "stop",
		usage: usage(totalTokens),
		...extra,
	};
}

/**
 * Mimics native prompt() + _checkCompaction enough to prove the wrap:
 * pre-prompt calls `_checkCompaction(last, false)`; overflow errors take the
 * overflow path; otherwise `tokens > window - 16k` is threshold.
 * `forceThreshold` simulates a foreign caller firing threshold BELOW the
 * near-overflow line (the case the unified gate must police).
 */
function makeSessionClass() {
	return class FakeSession {
		model = { contextWindow: WINDOW };
		agent = { state: { messages: [] as FollowUpAssistantLike[] } };
		compactCalls: CompactCall[] = [];
		lastAssistant: FollowUpAssistantLike | null = assistant(SOFT);
		forceThreshold = false;

		constructor() {
			if (this.lastAssistant) this.agent.state.messages = [this.lastAssistant];
		}

		setLast(msg: FollowUpAssistantLike | null): void {
			this.lastAssistant = msg;
			this.agent.state.messages = msg ? [msg] : [];
		}

		async prompt(_text: string, _options?: { source?: string }): Promise<void> {
			const last = this.lastAssistant;
			if (last) await this._checkCompaction(last, false);
		}

		async _checkCompaction(
			assistantMessage: FollowUpAssistantLike,
			_skipAbortedCheck = true,
		): Promise<boolean> {
			if (assistantMessage.stopReason === "error") {
				const err = String(assistantMessage.errorMessage ?? "").toLowerCase();
				if (/context|too long|token/.test(err)) {
					return Boolean(await this._runAutoCompaction("overflow", true));
				}
			}
			const tokens = contextTokensFromUsage(assistantMessage.usage);
			if (this.forceThreshold || tokens > WINDOW - RESERVE) {
				return Boolean(await this._runAutoCompaction("threshold", false));
			}
			return false;
		}

		async _runAutoCompaction(reason: string, willRetry: boolean): Promise<boolean> {
			this.compactCalls.push([reason, willRetry]);
			return true;
		}

		async checkAfterAgentEnd(msg: FollowUpAssistantLike): Promise<boolean> {
			return this._checkCompaction(msg);
		}
	};
}

const UnwrappedSession = makeSessionClass();
const WrappedSession = makeSessionClass();
assert.equal(installFollowUpCompactionGuard(WrappedSession), true);

test("policy constants match the mandated AND semantics", () => {
	assert.equal(AUTO_COMPACTION_USAGE_FRACTION_DEFAULT, 0.45);
	assert.equal(AUTO_COMPACTION_IDLE_MS_DEFAULT, 4 * 60 * 1000);
	assert.equal(AUTO_COMPACTION_RESERVE_TOKENS_DEFAULT, 16_384);
	assert.equal(PROACTIVE_COMPACTION_MIN_TOKENS, 200_000);
});

test("contextTokensFromUsage matches native totalTokens-or-sum", () => {
	assert.equal(contextTokensFromUsage({ totalTokens: 42, input: 1 }), 42);
	assert.equal(contextTokensFromUsage({ input: 10, output: 3, cacheRead: 2, cacheWrite: 1 }), 16);
	assert.equal(contextTokensFromUsage(null), 0);
	assert.equal(contextTokensFromUsage(undefined), 0);
});

test("hard overflow is tokens >= contextWindow; soft reserve is not", () => {
	assert.equal(isHardContextOverflow(SOFT, WINDOW), false);
	assert.equal(isHardContextOverflow(WINDOW - 1, WINDOW), false);
	assert.equal(isHardContextOverflow(HARD, WINDOW), true);
	assert.equal(isHardContextOverflow(HARD + 10, WINDOW), true);
	assert.equal(isHardContextOverflow(HARD, 0), false);
});

test("near-overflow line is tokens > contextWindow - reserve (pi shouldCompact)", () => {
	assert.equal(isNearContextOverflow(WINDOW - RESERVE, WINDOW), false);
	assert.equal(isNearContextOverflow(SOFT, WINDOW), true);
	assert.equal(isNearContextOverflow(HARD, WINDOW), true);
	assert.equal(isNearContextOverflow(SOFT, 0), false);
	// A larger configured reserve moves the model-safety line earlier.
	assert.equal(isNearContextOverflow(400_000, WINDOW, 120_000), true);
});

test("idle clock: prompt/provider activity restarts the idle window", () => {
	const session = {} as FollowUpSession;
	assert.equal(autoCompactionIdleMs(session), undefined);
	const now = Date.now();
	noteAutoCompactionActivity(session, now - 5 * 60_000);
	assert.equal(autoCompactionIdleMs(session, now), 5 * 60 * 1000);
	noteAutoCompactionActivity(session, now - 1_000);
	assert.equal(autoCompactionIdleMs(session, now), 1_000);
});

test("unified gate: 44.999% + idle satisfied still never compactes", () => {
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: BELOW_POLICY_LINE,
			contextWindow: WINDOW,
			idleMs: 10 * 60_000,
		}),
		false,
	);
});

test("unified gate: 45% + idle below 4 minutes does not compact", () => {
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: POLICY_LINE,
			contextWindow: WINDOW,
			idleMs: AUTO_COMPACTION_IDLE_MS_DEFAULT - 1,
		}),
		false,
	);
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: MID_USAGE,
			contextWindow: WINDOW,
			idleMs: 3 * 60_000 + 59_000,
		}),
		false,
	);
	// Never-noted activity (fresh session) counts as not idle.
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: MID_USAGE,
			contextWindow: WINDOW,
			idleMs: undefined,
		}),
		false,
	);
});

test("unified gate: 45% + 4 minutes idle compactes (exact boundary)", () => {
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: POLICY_LINE,
			contextWindow: WINDOW,
			idleMs: AUTO_COMPACTION_IDLE_MS_DEFAULT,
		}),
		true,
	);
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: MID_USAGE,
			contextWindow: WINDOW,
			idleMs: 6 * 60_000,
		}),
		true,
	);
});

test("unified gate: >=45% but under 200k tokens does not compact", () => {
	// 45% of a 200k window is 90k — the floor is the whole point of the rule.
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: 90_000,
			contextWindow: 200_000,
			idleMs: AUTO_COMPACTION_IDLE_MS_DEFAULT,
		}),
		false,
	);
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: 199_999,
			contextWindow: 400_000,
			idleMs: 10 * 60_000,
		}),
		false,
	);
});

test("unified gate: >=45% and >=200k tokens compactes", () => {
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: 200_000,
			contextWindow: 400_000,
			idleMs: AUTO_COMPACTION_IDLE_MS_DEFAULT,
		}),
		true,
	);
});

test("unified gate: overflow and near-overflow still compact below 200k", () => {
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "overflow",
			tokens: 50_000,
			contextWindow: 200_000,
		}),
		true,
	);
	// 90k on a 100k window is past the reserve line but under the 200k floor.
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: 90_000,
			contextWindow: 100_000,
			idleMs: 0,
		}),
		true,
	);
});

test("unified gate: near-overflow compactes even while busy (idle 0)", () => {
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: SOFT,
			contextWindow: WINDOW,
			idleMs: 0,
		}),
		true,
	);
	assert.equal(
		shouldAllowAutoCompaction({
			reason: "threshold",
			tokens: HARD,
			contextWindow: WINDOW,
			idleMs: 0,
		}),
		true,
	);
});

test("unified gate: overflow and manual are never blocked; unknown window is conservative", () => {
	assert.equal(
		shouldAllowAutoCompaction({ reason: "overflow", tokens: SOFT, contextWindow: WINDOW }),
		true,
	);
	assert.equal(
		shouldAllowAutoCompaction({ reason: "manual", tokens: SOFT, contextWindow: WINDOW }),
		true,
	);
	assert.equal(
		shouldAllowAutoCompaction({ reason: "threshold", tokens: MID_USAGE, contextWindow: 0, idleMs: 9 * 60_000 }),
		false,
	);
});

test("BEFORE: extension follow-up at soft threshold triggers native threshold compact", async () => {
	const session = new UnwrappedSession();
	await session.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
});

test("AFTER: soft line is near-overflow — wrapped extension follow-up still compactes", async () => {
	// The soft line (window - 16k + 1) is pi's own model-safety reserve line,
	// shared with the mid-turn guard. The unified policy keeps it live even
	// during busy extension turns; only BELOW that line does 45%+idle apply.
	const session = new WrappedSession();
	await session.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
});

test("AFTER: wrapped user turn at soft threshold still compactes", async () => {
	const session = new WrappedSession();
	await session.prompt("user typed this");
	assert.deepEqual(session.compactCalls, [["threshold", false]]);

	session.compactCalls = [];
	await session.prompt("user via rpc", { source: "rpc" });
	assert.deepEqual(session.compactCalls, [["threshold", false]]);

	session.compactCalls = [];
	await session.prompt("user interactive", { source: "interactive" });
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
});

test("AFTER: wrapped extension follow-up at hard window still compactes", async () => {
	const session = new WrappedSession();
	session.setLast(assistant(HARD));
	await session.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
});

test("AFTER: wrapped extension follow-up still runs overflow recovery", async () => {
	const session = new WrappedSession();
	session.setLast(
		assistant(SOFT, {
			stopReason: "error",
			errorMessage: "prompt is too long: context window exceeded",
		}),
	);
	await session.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(session.compactCalls, [["overflow", true]]);
});

test("AFTER: foreign threshold below the urgent line is vetoed during busy extension turns", async () => {
	// A caller firing "threshold" at 50% usage (below window - 16k) during an
	// extension turn: idle was just reset by the prompt, so the AND policy
	// fails and the gate vetoes. This is the busy-turn protection.
	const MidTurnFake = makeSessionClass();
	const rawPrompt = MidTurnFake.prototype.prompt;
	MidTurnFake.prototype.prompt = async function promptWithForeignSoftThreshold(
		this: InstanceType<typeof MidTurnFake>,
		text: string,
		options?: { source?: string },
	) {
		this.setLast(assistant(MID_USAGE));
		this.forceThreshold = true;
		await rawPrompt.call(this, text, options);
		this.forceThreshold = false;
		await this._runAutoCompaction("threshold", false);
	};
	assert.equal(installFollowUpCompactionGuard(MidTurnFake), true);

	const session = new MidTurnFake();
	await session.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(session.compactCalls, []);
});

test("AFTER: foreign threshold below the urgent line passes when 45% + 4min idle both hold", async () => {
	const session = new WrappedSession();
	session.setLast(assistant(MID_USAGE));
	session.forceThreshold = true;
	// Last activity 5 minutes ago and no prompt since: continuous idle holds.
	noteAutoCompactionActivity(session as unknown as FollowUpSession, Date.now() - 5 * 60_000);
	const folded = await session._checkCompaction(session.lastAssistant!);
	assert.equal(folded, true);
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
});

test("AFTER: provider request activity re-arms the idle clock (mid-turn wrapper)", async () => {
	const session = new WrappedSession() as unknown as FollowUpSession & {
		agent: { transformContext?: (m: unknown[]) => Promise<unknown[]> };
	};
	noteAutoCompactionActivity(session, Date.now() - 5 * 60_000);
	assert.ok((autoCompactionIdleMs(session) ?? 0) >= 5 * 60_000 - 50);
	wrapAgentTransformContext(session);
	const transform = session.agent.transformContext as
		| ((messages: unknown[]) => Promise<unknown[]>)
		| undefined;
	assert.equal(typeof transform, "function");
	await transform!([] as unknown[]);
	const idle = autoCompactionIdleMs(session) ?? Infinity;
	assert.ok(idle < 1_000, `expected re-armed idle, got ${idle}`);
});

test("agent_end check (skipAbortedCheck default) at soft line still thresholds while marked", async () => {
	const session = new WrappedSession();
	markExtensionInjectedTurn(session as unknown as FollowUpSession, true);
	const after = await session.checkAfterAgentEnd(assistant(SOFT));
	assert.equal(after, true);
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
});

test("prompt clears the extension-turn mark after the turn settles", async () => {
	const session = new WrappedSession();
	await session.prompt("heartbeat", { source: "extension" });
	assert.equal(isExtensionInjectedTurn(session as unknown as FollowUpSession), false);
});

test("installFollowUpCompactionGuard patches prototype only once", () => {
	class OtherSession {
		async prompt() {
			return "p";
		}
		async _checkCompaction() {
			return false;
		}
	}
	const beforePrompt = OtherSession.prototype.prompt;
	const beforeCheck = OtherSession.prototype._checkCompaction;
	assert.equal(installFollowUpCompactionGuard(OtherSession), true);
	assert.notEqual(OtherSession.prototype.prompt, beforePrompt);
	assert.notEqual(OtherSession.prototype._checkCompaction, beforeCheck);
	const afterPrompt = OtherSession.prototype.prompt;
	const afterCheck = OtherSession.prototype._checkCompaction;
	assert.equal(installFollowUpCompactionGuard(OtherSession), false);
	assert.equal(OtherSession.prototype.prompt, afterPrompt);
	assert.equal(OtherSession.prototype._checkCompaction, afterCheck);
});

test("registerFollowUpCompactionGuard installs the provided session class", (t) => {
	const errors: string[] = [];
	t.mock.method(console, "error", (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	});
	class ProvidedSession {
		async prompt() {
			return "p";
		}
		async _checkCompaction() {
			return false;
		}
	}
	registerFollowUpCompactionGuard(ProvidedSession);
	assert.deepEqual(errors, []);
	assert.equal(installFollowUpCompactionGuard(ProvidedSession), false);
});

test("registerFollowUpCompactionGuard without a class logs and does not throw", (t) => {
	const errors: string[] = [];
	t.mock.method(console, "error", (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	});
	registerFollowUpCompactionGuard(undefined);
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? "", /AgentSession not found/);
});

test("production entry: index.ts installs both compaction guards on the live AgentSession class", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	// Both guards must be registered against the ESM-imported live class —
	// prototype patching anything else would gate nothing in production.
	assert.match(
		source,
		/import \{[\s\S]*?\bAgentSession\b,[\s\S]*?\} from "@earendil-works\/pi-coding-agent"/,
	);
	assert.match(source, /registerMidTurnCompactionGuard\(AgentSession\)/);
	assert.match(source, /registerFollowUpCompactionGuard\(AgentSession\)/);
	// The unified policy module must not be re-implemented ad hoc elsewhere.
	assert.match(source, /from "\.\/follow-up-compaction\.ts"/);
	assert.match(source, /from "\.\/mid-turn-compaction\.ts"/);
});

test("production entry: idle-fold policy keeps 45% + 4 minutes with no absolute token floor", () => {
	const timer = readFileSync(new URL("../idle-fold-timer.ts", import.meta.url), "utf8");
	assert.match(timer, /IDLE_FOLD_LOW_WATERMARK_DEFAULT = 0\.45/);
	assert.match(timer, /IDLE_FOLD_TTL_MS_DEFAULT = 4 \* 60 \* 1000/);
	assert.doesNotMatch(timer, /200_000|MIN_TOKENS/);
});
