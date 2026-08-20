import test from "node:test";
import assert from "node:assert/strict";

import {
	compactMessagesIfNeeded,
	estimateNextRequestTokens,
	installMidTurnCompactionGuard,
	registerMidTurnCompactionGuard,
	shouldCompactBeforeProvider,
	wrapAgentTransformContext,
	type MidTurnMessage,
	type MidTurnSession,
} from "../mid-turn-compaction.ts";

const WINDOW_500K = 500_000;
const RESERVE_16K = 16_384;
const SETTINGS = {
	enabled: true,
	reserveTokens: RESERVE_16K,
	keepRecentTokens: 20_000,
};

function usage(totalTokens: number): MidTurnMessage["usage"] {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
	};
}

function assistant(totalTokens: number, extra: Partial<MidTurnMessage> = {}): MidTurnMessage {
	return {
		role: "assistant",
		stopReason: "stop",
		content: [{ type: "text", text: "ok" }],
		usage: usage(totalTokens),
		...extra,
	};
}

function user(text: string): MidTurnMessage {
	return { role: "user", content: text };
}

function toolResult(text: string): MidTurnMessage {
	return { role: "toolResult", toolCallId: "t1", content: text };
}

function duckSession(overrides: Partial<MidTurnSession> = {}): MidTurnSession & {
	compactCalls: Array<[string, boolean]>;
} {
	const compactCalls: Array<[string, boolean]> = [];
	const session: MidTurnSession & { compactCalls: Array<[string, boolean]> } = {
		compactCalls,
		model: { contextWindow: WINDOW_500K },
		settingsManager: {
			getCompactionSettings: () => ({ ...SETTINGS }),
		},
		agent: {
			transformContext: async (messages) => messages,
			state: { messages: [] },
		},
		async _runAutoCompaction(reason: string, willRetry: boolean) {
			compactCalls.push([reason, willRetry]);
			const compacted: MidTurnMessage[] = [user("compacted")];
			if (this.agent?.state) this.agent.state.messages = compacted;
			return true;
		},
		...overrides,
	};
	if (!session.agent) {
		session.agent = { transformContext: async (messages) => messages, state: { messages: [] } };
	}
	if (!session.agent.state) session.agent.state = { messages: [] };
	return session;
}

test("usage 64k + huge trailing toolResult is counted and trips 500k/16k reserve", () => {
	const trailing = "x".repeat(2_000_000); // ~500k tokens at chars/4
	const messages = [assistant(64_000), toolResult(trailing)];
	const tokens = estimateNextRequestTokens(messages);
	assert.ok(tokens > 64_000, "trailing toolResult must add to last usage");
	assert.ok(tokens >= 64_000 + 400_000, `expected usage+trailing, got ${tokens}`);
	assert.equal(shouldCompactBeforeProvider(tokens, WINDOW_500K, SETTINGS), true);
});

test("under-reported 64k usage loses to a full-history estimate", () => {
	const huge = "y".repeat(2_000_000);
	const messages = [user(huge), assistant(64_000)];
	const tokens = estimateNextRequestTokens(messages);
	assert.ok(tokens > 200_000, `full estimate must beat 64k usage, got ${tokens}`);
	assert.equal(shouldCompactBeforeProvider(tokens, WINDOW_500K, SETTINGS), true);
});

test("below-threshold messages do not compact", async () => {
	const session = duckSession();
	const messages = [user("hi"), assistant(1_000)];
	session.agent!.state!.messages = messages;
	const out = await compactMessagesIfNeeded(session, messages);
	assert.equal(session.compactCalls.length, 0);
	assert.equal(out, messages);
});

test("over-threshold calls _runAutoCompaction(threshold, false) once and returns compacted state", async () => {
	const session = duckSession();
	const messages = [user("z".repeat(2_000_000)), assistant(64_000)];
	session.agent!.state!.messages = messages;
	const out = await compactMessagesIfNeeded(session, messages);
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
	assert.deepEqual(out, [user("compacted")]);
	assert.equal(out, session.agent!.state!.messages);
});

test("same-run second transform with original snapshot does not compact again", async () => {
	const session = duckSession();
	const incoming = [user("z".repeat(2_000_000)), assistant(64_000)];
	session.agent!.state!.messages = incoming;
	const first = await compactMessagesIfNeeded(session, incoming);
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
	assert.equal(first, session.agent!.state!.messages);

	const second = await compactMessagesIfNeeded(session, incoming);
	assert.equal(session.compactCalls.length, 1, "must not compact again this run");
	assert.equal(second, session.agent!.state!.messages);
	assert.notEqual(second, incoming);
	assert.deepEqual(second, [user("compacted")]);
});

test("successful compact that returns false still yields replaced state, not incoming", async () => {
	const session = duckSession();
	const incoming = [user("z".repeat(2_000_000)), assistant(64_000)];
	session.agent!.state!.messages = incoming;
	session._runAutoCompaction = async function (this: MidTurnSession, reason, willRetry) {
		session.compactCalls.push([reason, willRetry]);
		if (this.agent?.state) this.agent.state.messages = [user("compacted")];
		return false;
	};
	const out = await compactMessagesIfNeeded(session, incoming);
	assert.deepEqual(session.compactCalls, [["threshold", false]]);
	assert.notEqual(out, incoming);
	assert.equal(out, session.agent!.state!.messages);
	assert.deepEqual(out, [user("compacted")]);
});

test("re-entry while compacting does not call _runAutoCompaction again", async () => {
	const session = duckSession();
	const messages = [user("z".repeat(2_000_000)), assistant(64_000)];
	let inner = 0;
	session._runAutoCompaction = async function (this: MidTurnSession, reason, willRetry) {
		session.compactCalls.push([reason, willRetry]);
		inner += 1;
		const again = await compactMessagesIfNeeded(this, messages);
		assert.equal(again, messages);
		if (this.agent?.state) this.agent.state.messages = [user("compacted")];
		return true;
	};
	const out = await compactMessagesIfNeeded(session, messages);
	assert.equal(session.compactCalls.length, 1);
	assert.equal(inner, 1);
	assert.deepEqual(out, [user("compacted")]);
});

test("missing _runAutoCompaction does not throw", async (t) => {
	t.mock.method(console, "error", () => {});
	const session = duckSession();
	delete session._runAutoCompaction;
	const messages = [user("z".repeat(2_000_000)), assistant(64_000)];
	const out = await compactMessagesIfNeeded(session, messages);
	assert.equal(out, messages);
});

test("wrapAgentTransformContext is idempotent", async () => {
	const originalCalls: number[] = [];
	const session = duckSession();
	const original = async (messages: MidTurnMessage[]) => {
		originalCalls.push(messages.length);
		return messages;
	};
	session.agent!.transformContext = original;
	wrapAgentTransformContext(session);
	const wrapped = session.agent!.transformContext;
	wrapAgentTransformContext(session);
	assert.equal(session.agent!.transformContext, wrapped);
	assert.notEqual(wrapped, original);

	const small = [user("hi"), assistant(10)];
	await session.agent!.transformContext!(small);
	assert.deepEqual(originalCalls, [2]);
	assert.equal(session.compactCalls.length, 0);
});

test("installMidTurnCompactionGuard patches prototype only once", async () => {
	class FakeSession {
		agent: MidTurnSession["agent"] = {
			transformContext: async (messages) => messages,
			state: { messages: [] },
		};
		model = { contextWindow: WINDOW_500K };
		settingsManager = { getCompactionSettings: () => ({ ...SETTINGS }) };
		async _runAgentPrompt() {
			return "ran";
		}
		_buildRuntime() {
			return "built";
		}
	}

	const beforeRun = FakeSession.prototype._runAgentPrompt;
	const beforeBuild = FakeSession.prototype._buildRuntime;
	assert.equal(installMidTurnCompactionGuard(FakeSession), true);
	const afterRun = FakeSession.prototype._runAgentPrompt;
	const afterBuild = FakeSession.prototype._buildRuntime;
	assert.notEqual(afterRun, beforeRun);
	assert.notEqual(afterBuild, beforeBuild);
	assert.equal(installMidTurnCompactionGuard(FakeSession), false);
	assert.equal(FakeSession.prototype._runAgentPrompt, afterRun);
	assert.equal(FakeSession.prototype._buildRuntime, afterBuild);

	const session = new FakeSession();
	await session._runAgentPrompt();
	const first = session.agent!.transformContext;
	session._buildRuntime();
	assert.equal(session.agent!.transformContext, first);
});

test("aborted/error/all-zero usage is skipped when reading last usage", () => {
	const trailing = "x".repeat(800_000);
	const messages = [
		assistant(64_000),
		toolResult(trailing),
		assistant(0, { stopReason: "error", usage: usage(0) }),
		assistant(12, { stopReason: "aborted", usage: usage(12) }),
		assistant(0, { usage: usage(0) }),
	];
	const tokens = estimateNextRequestTokens(messages);
	assert.ok(tokens > 64_000, "must walk past invalid usage to 64k + trailing");
});

test("compaction.enabled === false skips even when over the window", async () => {
	const session = duckSession({
		settingsManager: { getCompactionSettings: () => ({ ...SETTINGS, enabled: false }) },
	});
	const messages = [user("z".repeat(2_000_000)), assistant(64_000)];
	const out = await compactMessagesIfNeeded(session, messages);
	assert.equal(session.compactCalls.length, 0);
	assert.equal(out, messages);
});

test("registerMidTurnCompactionGuard installs the provided session class without requiring the package", (t) => {
	const errors: string[] = [];
	t.mock.method(console, "error", (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	});
	class ProvidedSession {
		async _runAgentPrompt() {
			return "ran";
		}
	}
	registerMidTurnCompactionGuard(ProvidedSession);
	assert.deepEqual(errors, []);
	assert.equal(installMidTurnCompactionGuard(ProvidedSession), false);
});
