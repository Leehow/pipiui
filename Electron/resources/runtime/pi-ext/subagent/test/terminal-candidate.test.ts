import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	DEFAULT_TERMINAL_CANDIDATE_TIMEOUT_MS,
	TERMINAL_CANDIDATE_ERROR,
	TERMINAL_CANDIDATE_TIMEOUT,
	TERMINAL_CANDIDATE_WAIT,
	awaitTerminalCandidate,
	consumeTerminalCandidateLate,
	terminalCandidatePhaseError,
} from "../terminal-candidate.ts";

const SHORT_MS = 25;

function collectUnhandled(): { seen: unknown[]; stop(): void } {
	const seen: unknown[] = [];
	const onUnhandled = (reason: unknown): void => {
		seen.push(reason);
	};
	process.on("unhandledRejection", onUnhandled);
	return {
		seen,
		stop() {
			process.off("unhandledRejection", onUnhandled);
		},
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("production candidate deadline stays a short conservative default", () => {
	assert.equal(DEFAULT_TERMINAL_CANDIDATE_TIMEOUT_MS, 15_000);
	assert.equal(TERMINAL_CANDIDATE_WAIT, "terminal-candidate-wait");
	assert.equal(TERMINAL_CANDIDATE_TIMEOUT, "terminal-candidate-timeout");
});

test("wait/ok probes must not set lastPhaseError; timeout/error keep explicit codes", () => {
	assert.equal(terminalCandidatePhaseError("wait"), undefined);
	assert.equal(terminalCandidatePhaseError("ok"), undefined);
	assert.equal(terminalCandidatePhaseError("timeout"), TERMINAL_CANDIDATE_TIMEOUT);
	assert.equal(terminalCandidatePhaseError("error"), TERMINAL_CANDIDATE_ERROR);
});

test("submitBrokerTerminalCandidate wait still logs but never writes lastPhaseError", () => {
	const source = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
	const start = source.indexOf("async function submitBrokerTerminalCandidate");
	assert.ok(start >= 0, "helper must remain in index.ts");
	const next = source.indexOf("\nfunction ", start + 1);
	const hunk = source.slice(start, next === -1 ? undefined : next);
	assert.match(hunk, /logStallProbe\("terminal-candidate"/);
	assert.match(hunk, /probe\("wait"\)/);
	assert.match(hunk, /terminalCandidatePhaseError\(state\)/);
	assert.doesNotMatch(hunk, /TERMINAL_CANDIDATE_WAIT/);
	assert.doesNotMatch(hunk, /error:\s*state === "wait"/);
});

test("never-resolving candidate times out and closeout can continue", async () => {
	const started = Date.now();
	const outcome = await awaitTerminalCandidate(new Promise<string>(() => {}), SHORT_MS);
	assert.equal(outcome.status, "timeout");
	assert.ok(Date.now() - started < 1_000, "deadline must not wait for the candidate");
	const closeout: string[] = [];
	closeout.push("finalize-worktree");
	closeout.push("host-end");
	assert.deepEqual(closeout, ["finalize-worktree", "host-end"]);
});

test("late reject after timeout is not unhandled and cannot finish twice", async () => {
	const unhandled = collectUnhandled();
	try {
		let rejectLate: ((error: Error) => void) | undefined;
		const late: Array<{ status: string }> = [];
		const work = new Promise<void>((_, reject) => {
			rejectLate = reject;
		});
		const outcome = await awaitTerminalCandidate(work, SHORT_MS, {
			onLate: (event) => late.push({ status: event.status }),
		});
		assert.equal(outcome.status, "timeout");
		rejectLate?.(new Error("after-return"));
		await delay(15);
		assert.deepEqual(unhandled.seen, []);
		assert.deepEqual(late, [{ status: "rejected" }]);
	} finally {
		unhandled.stop();
	}
});

test("successful candidate settles without timeout", async () => {
	const outcome = await awaitTerminalCandidate(Promise.resolve("summary-ok"), 1_000);
	assert.deepEqual(outcome, { status: "settled", value: "summary-ok" });
});

test("ordinary reject is a skipped candidate, not a throw", async () => {
	const error = new Error("broker-unavailable");
	const outcome = await awaitTerminalCandidate(Promise.reject(error), 1_000);
	assert.equal(outcome.status, "rejected");
	if (outcome.status !== "rejected") throw new Error("expected rejected");
	assert.equal(outcome.reason, error);
});

test("timeout aborts a signal-aware client and still swallows late reject", async () => {
	const unhandled = collectUnhandled();
	try {
		const controller = new AbortController();
		let rejectLate: ((error: Error) => void) | undefined;
		const work = new Promise<void>((_, reject) => {
			rejectLate = reject;
			controller.signal.addEventListener("abort", () => {
				reject(new Error("aborted"));
			});
		});
		const outcome = await awaitTerminalCandidate(work, SHORT_MS, { abortOnTimeout: controller });
		assert.equal(outcome.status, "timeout");
		assert.equal(controller.signal.aborted, true);
		rejectLate?.(new Error("duplicate-late"));
		await delay(15);
		assert.deepEqual(unhandled.seen, []);
	} finally {
		unhandled.stop();
	}
});

test("consumeTerminalCandidateLate swallows a later rejection", async () => {
	const unhandled = collectUnhandled();
	try {
		let rejectLate: ((error: Error) => void) | undefined;
		const pending = new Promise<void>((_, reject) => {
			rejectLate = reject;
		});
		consumeTerminalCandidateLate(pending);
		rejectLate?.(new Error("after-return"));
		await delay(15);
		assert.deepEqual(unhandled.seen, []);
	} finally {
		unhandled.stop();
	}
});
