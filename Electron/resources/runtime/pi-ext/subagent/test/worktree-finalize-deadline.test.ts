import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GitWorktreeAdapter, GitWorktreeInspectionV1 } from "../../subagent-host/worktree/adapter.ts";
import {
	DEFAULT_FINALIZATION_DEADLINE_MS,
	DEFAULT_GIT_TIMEOUT_MS,
	DEFAULT_ON_MERGED_TIMEOUT_MS,
	DEFAULT_QUEUE_HEAD_TIMEOUT_MS,
	DEFAULT_QUEUE_WAIT_TIMEOUT_MS,
	DEFAULT_VERIFY_TIMEOUT_MS,
	resolveVerifyTimeoutMs,
} from "../../subagent-host/worktree/deadlines.ts";
import {
	PerMainRepoSerialQueueV1,
	SerialQueueTimeoutError,
	consumeLateSettlement,
} from "../../subagent-host/worktree/queue.ts";
import { runSpawnV1 } from "../../subagent-host/worktree/adapter.ts";
import { WorktreeFinalizationServiceV1 } from "../../subagent-host/worktree/service.ts";
import type { WorktreeFinalizationInputV1 } from "../../subagent-host/worktree/schema.ts";
import {
	applyFinalizationTransition,
	type FinalizationFields,
} from "../finalization-phase.ts";

const SHORT_MS = 25;
// Other files' spawnSync Git fixtures can stall this process's event loop; keep the
// test envelope wide enough that the production deadline is not the first timer to fire.
// Injected verifyTimeoutMs stays millisecond-scale so the deadline under test is still proven.
const TEST_ENVELOPE_MS = 10_000;

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
}

function makeRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "pipiui-finalize-deadline-"));
	git(root, ["init", "-b", "main"]);
	git(root, ["config", "user.email", "pipiui-test@example.com"]);
	git(root, ["config", "user.name", "PipiUI Test"]);
	writeFileSync(join(root, "README.md"), "base\n");
	git(root, ["add", "README.md"]);
	git(root, ["commit", "-m", "base"]);
	return root;
}

function addWorker(root: string, agentId: string): { path: string; branch: string } {
	const worktree = join(root, ".pi", "worktrees", agentId);
	const branch = `pipiui/${agentId}`;
	mkdirSync(join(root, ".pi", "worktrees"), { recursive: true });
	git(root, ["worktree", "add", "-b", branch, worktree, "HEAD"]);
	return { path: worktree, branch };
}

function commitFile(worktree: string, name: string, body: string): void {
	writeFileSync(join(worktree, name), body);
	git(worktree, ["add", name]);
	git(worktree, ["commit", "-m", name]);
}

function inputFor(
	root: string,
	agentId: string,
	placement: { path: string; branch: string },
): WorktreeFinalizationInputV1 {
	return {
		schemaVersion: 1,
		agentId,
		runId: `${agentId}-run`,
		mainCwd: root,
		worktree: {
			path: placement.path,
			branch: placement.branch,
			ownership: { mode: "isolated", role: "worker", agentId, runId: `${agentId}-run` },
		},
		terminal: { state: "ok" },
	};
}

function emptySnapshot(branch = "main"): GitWorktreeInspectionV1["main"] {
	return {
		isRepo: true,
		branch,
		head: "abc",
		stagedPaths: [],
		unstagedPaths: [],
		untrackedPaths: [],
		conflictPaths: [],
		dangerousOperations: [],
		pathsKnown: true,
		errors: [],
	};
}

function readyInspection(path: string, branch: string): GitWorktreeInspectionV1 {
	const worktree = { ...emptySnapshot(branch), head: "def" };
	return {
		main: emptySnapshot("main"),
		worktree,
		registeredWorktrees: [{ path, branch }],
		registeredWorktreePath: path,
		branchExists: true,
		branchHead: "def",
		branchIsAncestorOfMain: false,
		workerBranchChangedPaths: ["landed.txt"],
		errors: [],
	};
}

function fakeAdapter(options: {
	key: string;
	inspect?: GitWorktreeAdapter["inspect"];
	merge?: GitWorktreeAdapter["merge"];
	removeWorktree?: GitWorktreeAdapter["removeWorktree"];
	cleanupMergedBranch?: GitWorktreeAdapter["cleanupMergedBranch"];
}): GitWorktreeAdapter {
	return {
		async repositoryKey() {
			return options.key;
		},
		inspect: options.inspect ?? (async (input) => readyInspection(input.worktree.path, input.worktree.branch)),
		merge: options.merge ?? (async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "" })),
		removeWorktree: options.removeWorktree ?? (async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "" })),
		cleanupMergedBranch: options.cleanupMergedBranch ?? (async ({ branch }) => ({
			disposition: "deleted",
			branch,
			message: "deleted",
		})),
	};
}

function shortService(
	overrides: ConstructorParameters<typeof WorktreeFinalizationServiceV1>[0],
): WorktreeFinalizationServiceV1 {
	return new WorktreeFinalizationServiceV1({
		queue: new PerMainRepoSerialQueueV1({ waitTimeoutMs: SHORT_MS, headTimeoutMs: SHORT_MS * 4 }),
		queueWaitTimeoutMs: SHORT_MS,
		queueHeadTimeoutMs: SHORT_MS * 4,
		finalizationDeadlineMs: SHORT_MS * 2,
		onMergedTimeoutMs: SHORT_MS,
		verifyTimeoutMs: SHORT_MS,
		terminationGraceMs: 10,
		...overrides,
	});
}

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

describe("worktree finalize deadlines", { concurrency: 1 }, () => {
test("production closeout deadlines stay conservative and centralized", () => {
	assert.equal(DEFAULT_GIT_TIMEOUT_MS, 30_000);
	assert.equal(DEFAULT_VERIFY_TIMEOUT_MS, 120_000);
	assert.equal(DEFAULT_ON_MERGED_TIMEOUT_MS, 30_000);
	assert.equal(DEFAULT_QUEUE_WAIT_TIMEOUT_MS, 30 * 60_000);
	assert.equal(DEFAULT_QUEUE_HEAD_TIMEOUT_MS, 15 * 60_000);
	assert.equal(DEFAULT_FINALIZATION_DEADLINE_MS, DEFAULT_QUEUE_HEAD_TIMEOUT_MS);
	assert.ok(DEFAULT_FINALIZATION_DEADLINE_MS > DEFAULT_VERIFY_TIMEOUT_MS);
});

test("PIPIUI_VERIFY_TIMEOUT_MS unset or invalid resolves to the conservative default", () => {
	const previous = process.env.PIPIUI_VERIFY_TIMEOUT_MS;
	try {
		delete process.env.PIPIUI_VERIFY_TIMEOUT_MS;
		assert.equal(resolveVerifyTimeoutMs(), DEFAULT_VERIFY_TIMEOUT_MS);
		for (const raw of ["abc", "", "12s", "-5", "999"]) {
			process.env.PIPIUI_VERIFY_TIMEOUT_MS = raw;
			assert.equal(
				resolveVerifyTimeoutMs(),
				DEFAULT_VERIFY_TIMEOUT_MS,
				`invalid value ${JSON.stringify(raw)} must fall back silently`,
			);
		}
	} finally {
		if (previous === undefined) delete process.env.PIPIUI_VERIFY_TIMEOUT_MS;
		else process.env.PIPIUI_VERIFY_TIMEOUT_MS = previous;
	}
});

test("PIPIUI_VERIFY_TIMEOUT_MS valid override is accepted at the 1000ms floor and re-read per call", () => {
	const previous = process.env.PIPIUI_VERIFY_TIMEOUT_MS;
	try {
		process.env.PIPIUI_VERIFY_TIMEOUT_MS = "300000";
		assert.equal(resolveVerifyTimeoutMs(), 300_000);
		process.env.PIPIUI_VERIFY_TIMEOUT_MS = "1000";
		assert.equal(resolveVerifyTimeoutMs(), 1000);
		delete process.env.PIPIUI_VERIFY_TIMEOUT_MS;
		assert.equal(resolveVerifyTimeoutMs(), DEFAULT_VERIFY_TIMEOUT_MS);
	} finally {
		if (previous === undefined) delete process.env.PIPIUI_VERIFY_TIMEOUT_MS;
		else process.env.PIPIUI_VERIFY_TIMEOUT_MS = previous;
	}
});

test("never-resolving queue head times out, advances FIFO, and consumes late rejection", async () => {
	const queue = new PerMainRepoSerialQueueV1({ waitTimeoutMs: SHORT_MS * 8, headTimeoutMs: SHORT_MS });
	const progress: string[] = [];
	let rejectHead: ((error: Error) => void) | undefined;
	const unhandled = collectUnhandled();
	const started: string[] = [];
	try {
		const first = queue.run("repo-a", () => new Promise<string>((_, reject) => {
			started.push("first");
			rejectHead = reject;
		}), {
			onProgress(event) {
				progress.push(event.phase);
			},
		});
		const second = queue.run("repo-a", async () => {
			started.push("second");
			return "second-ok";
		}, {
			onProgress(event) {
				progress.push(`second:${event.phase}`);
			},
		});
		const settled = await Promise.allSettled([first, second]);
		assert.equal(settled[0].status, "rejected");
		if (settled[0].status === "rejected") {
			assert.ok(settled[0].reason instanceof SerialQueueTimeoutError);
			assert.equal(settled[0].reason.kind, "queue-head");
		}
		assert.equal(settled[1].status, "fulfilled");
		if (settled[1].status === "fulfilled") assert.equal(settled[1].value, "second-ok");
		assert.deepEqual(started, ["first", "second"]);
		assert.ok(progress.includes("queue-head-timeout"));
		assert.ok(progress.includes("second:queue-wait"));
		rejectHead?.(new Error("late-head-reject"));
		await delay(15);
		assert.deepEqual(unhandled.seen, []);
	} finally {
		unhandled.stop();
	}
});

test("never-resolving service head lets a second same-repo item finish", async () => {
	const queue = new PerMainRepoSerialQueueV1({ waitTimeoutMs: SHORT_MS * 12, headTimeoutMs: SHORT_MS * 12 });
	const hang = shortService({
		queue,
		queueWaitTimeoutMs: SHORT_MS * 12,
		finalizationDeadlineMs: SHORT_MS,
		queueHeadTimeoutMs: SHORT_MS * 12,
		adapter: fakeAdapter({
			key: "shared-repo",
			inspect: () => new Promise(() => {}),
		}),
	});
	const progress: string[] = [];
	const followWithProgress = shortService({
		queue,
		queueWaitTimeoutMs: SHORT_MS * 12,
		finalizationDeadlineMs: SHORT_MS * 12,
		queueHeadTimeoutMs: SHORT_MS * 12,
		adapter: fakeAdapter({ key: "shared-repo" }),
		onProgress(phase, detail) {
			progress.push(detail?.stage ?? phase);
		},
	});
	const hung = hang.finalize(inputFor("/tmp/a", "head-hang", { path: "/tmp/a", branch: "pipiui/head-hang" }));
	const next = followWithProgress.finalize(inputFor("/tmp/b", "follower", { path: "/tmp/b", branch: "pipiui/follower" }));
	const hungState = await hung;
	const nextState = await next;
	assert.equal(hungState.result.disposition, "needs-user");
	assert.match(hungState.result.messages.join("\n"), /timed out/);
	assert.equal(hungState.result.cleanup, "not-attempted");
	assert.notEqual(nextState.result.disposition, "needs-user");
	assert.equal(nextState.result.merge, "merged");
	assert.equal(nextState.result.disposition, "merged");
	assert.ok(progress.includes("queue-wait"));
});

test("never-resolving onMerged retains worktree/branch and is terminalizable", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const worker = addWorker(root, "onmerged-hang");
	commitFile(worker.path, "landed.txt", "ok\n");
	const phases: string[] = [];
	const service = shortService({
		onMergedTimeoutMs: SHORT_MS,
		finalizationDeadlineMs: 2_000,
		queueHeadTimeoutMs: 2_000,
		onMerged: () => new Promise(() => {}),
		onProgress(phase, detail) {
			phases.push(detail?.stage ?? phase);
		},
	});
	const state = await service.finalize(inputFor(root, "onmerged-hang", worker));
	assert.equal(state.result.merge, "merged");
	assert.equal(state.result.cleanup, "not-attempted");
	assert.equal(state.result.disposition, "needs-user");
	assert.equal(state.phase, "blocked");
	assert.match(state.result.recovery.reason, /onMerged timed out/);
	assert.equal(existsSync(worker.path), true);
	assert.equal(spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${worker.branch}`], { cwd: root }).status, 0);
	assert.ok(phases.includes("on-merged"));
	assert.ok(phases.includes("on-merged-timeout"));
	assert.equal(phases.includes("cleaning"), false);
});

test("onMerged throw retains worktree and returns needs-fixer", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const worker = addWorker(root, "onmerged-throw");
	commitFile(worker.path, "landed.txt", "ok\n");
	const service = shortService({
		finalizationDeadlineMs: 2_000,
		queueHeadTimeoutMs: 2_000,
		onMerged: () => {
			throw new Error("hook exploded");
		},
	});
	const state = await service.finalize(inputFor(root, "onmerged-throw", worker));
	assert.equal(state.result.merge, "merged");
	assert.equal(state.result.cleanup, "not-attempted");
	assert.equal(state.result.disposition, "needs-fixer");
	assert.match(state.result.messages.join("\n"), /hook exploded/);
	assert.equal(existsSync(worker.path), true);
});

test("post-merge verify that ignores AbortSignal times out and late reject is consumed", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const worker = addWorker(root, "verify-late");
	commitFile(worker.path, "landed.txt", "ok\n");
	let rejectLate: ((error: Error) => void) | undefined;
	let resolveLate: ((value: { ok: true }) => void) | undefined;
	let sawAbort = false;
	const shared = { mutations: 0 };
	const unhandled = collectUnhandled();
	try {
		const service = shortService({
			finalizationDeadlineMs: TEST_ENVELOPE_MS,
			queueHeadTimeoutMs: TEST_ENVELOPE_MS,
			verifyTimeoutMs: SHORT_MS,
			terminationGraceMs: 10,
			postMergeVerify: (request) => new Promise((resolve, reject) => {
				resolveLate = resolve;
				rejectLate = reject;
				request.signal?.addEventListener("abort", () => {
					sawAbort = true;
				});
			}),
		});
		const state = await service.finalize({
			...inputFor(root, "verify-late", worker),
			verify: { command: "true" },
		});
		assert.equal(state.result.verify.postMerge, "failed");
		assert.equal(state.result.verify.postMergeTimedOut, true);
		assert.ok(sawAbort);
		assert.notEqual(state.result.disposition, "merged");
		rejectLate?.(new Error("late-verify-reject"));
		resolveLate?.({ ok: true });
		shared.mutations += 1;
		await delay(20);
		assert.deepEqual(unhandled.seen, []);
		assert.equal(state.result.verify.postMergeTimedOut, true);
	} finally {
		unhandled.stop();
	}
});

test("normal success keeps FIFO order and emits reconciling before merge/cleanup/verify", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = addWorker(root, "ok-one");
	const second = addWorker(root, "ok-two");
	commitFile(first.path, "one.txt", "1\n");
	commitFile(second.path, "two.txt", "2\n");
	const order: string[] = [];
	const phases: string[] = [];
	let headStarted: (() => void) | undefined;
	const sawHead = new Promise<void>((resolve) => {
		headStarted = resolve;
	});
	const queue = new PerMainRepoSerialQueueV1({ waitTimeoutMs: 30_000, headTimeoutMs: 30_000 });
	const service = new WorktreeFinalizationServiceV1({
		queue,
		queueWaitTimeoutMs: 30_000,
		queueHeadTimeoutMs: 30_000,
		finalizationDeadlineMs: 30_000,
		onMergedTimeoutMs: 5_000,
		onProgress(phase) {
			phases.push(phase);
			if (phase === "reconciling") headStarted?.();
		},
		onMerged: async (event) => {
			order.push(`merged:${event.agentId}`);
		},
	});
	const firstDone = service.finalize(inputFor(root, "ok-one", first)).then((state) => {
		order.push(`done:${state.result.agentId}`);
		return state;
	});
	await sawHead;
	const secondDone = service.finalize(inputFor(root, "ok-two", second)).then((state) => {
		order.push(`done:${state.result.agentId}`);
		return state;
	});
	const [a, b] = await Promise.all([firstDone, secondDone]);
	assert.equal(a.result.disposition, "merged");
	assert.equal(b.result.disposition, "merged");
	assert.equal(existsSync(first.path), false);
	assert.equal(existsSync(second.path), false);
	assert.ok(order.indexOf("merged:ok-one") < order.indexOf("merged:ok-two"));
	assert.ok(order.indexOf("done:ok-one") < order.indexOf("done:ok-two"));
	const firstReconciling = phases.indexOf("reconciling");
	const firstMerging = phases.indexOf("merging");
	const firstOnMerged = phases.indexOf("on-merged");
	const firstCleaning = phases.indexOf("cleaning");
	assert.ok(firstReconciling >= 0 && firstMerging > firstReconciling);
	assert.ok(firstOnMerged > firstMerging && firstCleaning > firstOnMerged);
	assert.ok(phases.includes("queue-wait"));
});

test("process-backed post-verify timeout aborts the child and returns quickly", async (t) => {
	const root = makeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const worker = addWorker(root, "verify-sleep");
	commitFile(worker.path, "landed.txt", "ok\n");
	let verifyStartedAt = 0;
	const service = shortService({
		onProgress(phase) {
			if (phase === "post-verify" && verifyStartedAt === 0) verifyStartedAt = Date.now();
		},
		finalizationDeadlineMs: TEST_ENVELOPE_MS,
		queueHeadTimeoutMs: TEST_ENVELOPE_MS,
		verifyTimeoutMs: SHORT_MS,
		terminationGraceMs: 10,
		postMergeVerify: async (request) => {
			const spawned = await runSpawnV1(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
				cwd: request.mainCwd,
				timeoutMs: request.timeoutMs ?? SHORT_MS,
				...(request.signal ? { signal: request.signal } : {}),
				terminationGraceMs: 10,
			});
			return {
				ok: spawned.ok,
				exitCode: spawned.exitCode,
				...(spawned.timedOut ? { timedOut: true } : {}),
				...(spawned.aborted ? { aborted: true } : {}),
				...(spawned.error ? { error: spawned.error } : {}),
			};
		},
	});
	const state = await service.finalize({
		...inputFor(root, "verify-sleep", worker),
		verify: { command: "sleep" },
	});
	const elapsed = Date.now() - (verifyStartedAt || Date.now());
	assert.ok(elapsed < 1_500, `process-backed verify should not wait out the child (${elapsed}ms)`);
	assert.equal(state.result.verify.postMerge, "failed");
	assert.equal(state.result.verify.postMergeTimedOut === true || state.result.verify.postMergeAborted === true, true);
});

test("queue-wait then on-merged elapsed fields record without going backward", () => {
	const state: FinalizationFields = {};
	assert.equal(applyFinalizationTransition(state, "verifying", 10), true);
	assert.equal(applyFinalizationTransition(state, "queue-wait", 20), true);
	assert.equal(applyFinalizationTransition(state, "reconciling", 45), true);
	assert.equal(state.queueWaitElapsedMs, 25);
	assert.equal(applyFinalizationTransition(state, "merging", 50), true);
	assert.equal(applyFinalizationTransition(state, "on-merged", 60), true);
	assert.equal(applyFinalizationTransition(state, "cleaning", 90), true);
	assert.equal(state.onMergedElapsedMs, 30);
	assert.equal(applyFinalizationTransition(state, "queue-wait", 100), false);
});

test("consumeLateSettlement swallows a later rejection", async () => {
	const unhandled = collectUnhandled();
	try {
		let rejectLate: ((error: Error) => void) | undefined;
		const pending = new Promise<void>((_, reject) => {
			rejectLate = reject;
		});
		consumeLateSettlement(pending);
		rejectLate?.(new Error("after-return"));
		await delay(15);
		assert.deepEqual(unhandled.seen, []);
	} finally {
		unhandled.stop();
	}
});
});
