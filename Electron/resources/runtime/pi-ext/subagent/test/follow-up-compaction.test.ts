import test from "node:test";
import assert from "node:assert/strict";

import {
	contextTokensFromUsage,
	installFollowUpCompactionGuard,
	isHardContextOverflow,
	markExtensionInjectedTurn,
	registerFollowUpCompactionGuard,
	shouldAllowExtensionPrePromptCompaction,
	type FollowUpAssistantLike,
	type FollowUpSession,
} from "../follow-up-compaction.ts";

const WINDOW = 500_000;
const RESERVE = 16_384;
const SOFT = WINDOW - RESERVE + 1; // trips native shouldCompact, still < window
const HARD = WINDOW;

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
 */
function makeSessionClass() {
	return class FakeSession {
		model = { contextWindow: WINDOW };
		agent = { state: { messages: [] as FollowUpAssistantLike[] } };
		compactCalls: CompactCall[] = [];
		lastAssistant: FollowUpAssistantLike | null = assistant(SOFT);

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
			if (tokens > WINDOW - RESERVE) {
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

test("extension pre-prompt policy: overflow always, threshold only at hard window", () => {
	assert.equal(
		shouldAllowExtensionPrePromptCompaction({ reason: "overflow", tokens: SOFT, contextWindow: WINDOW }),
		true,
	);
	assert.equal(
		shouldAllowExtensionPrePromptCompaction({ reason: "threshold", tokens: SOFT, contextWindow: WINDOW }),
		false,
	);
	assert.equal(
		shouldAllowExtensionPrePromptCompaction({ reason: "threshold", tokens: HARD, contextWindow: WINDOW }),
		true,
	);
	assert.equal(
		shouldAllowExtensionPrePromptCompaction({ reason: "manual", tokens: SOFT, contextWindow: WINDOW }),
		true,
	);
});

test("BEFORE: extension follow-up at soft threshold triggers native threshold compact", async () => {
	const session = new UnwrappedSession();
	await session.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
});

test("AFTER: wrapped extension follow-up at soft threshold does not compact", async () => {
	const session = new WrappedSession();
	await session.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(session.compactCalls, []);
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

test("AFTER: mid-turn _runAutoCompaction(threshold) during extension prompt is skipped unless hard", async () => {
	const MidTurnFake = makeSessionClass();
	const rawPrompt = MidTurnFake.prototype.prompt;
	MidTurnFake.prototype.prompt = async function promptWithMidTurn(
		this: InstanceType<typeof MidTurnFake>,
		text: string,
		options?: { source?: string },
	) {
		await rawPrompt.call(this, text, options);
		await this._runAutoCompaction("threshold", false);
	};
	assert.equal(installFollowUpCompactionGuard(MidTurnFake), true);

	const soft = new MidTurnFake();
	await soft.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(soft.compactCalls, []);

	const hard = new MidTurnFake();
	hard.setLast(assistant(HARD));
	await hard.prompt("heartbeat", { source: "extension" });
	assert.deepEqual(hard.compactCalls, [
		["threshold", false],
		["threshold", false],
	]);
});

test("agent_end check (skipAbortedCheck default) still thresholds while marked", async () => {
	const session = new WrappedSession();
	markExtensionInjectedTurn(session as unknown as FollowUpSession, true);
	const after = await session.checkAfterAgentEnd(assistant(SOFT));
	assert.equal(after, true);
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
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
