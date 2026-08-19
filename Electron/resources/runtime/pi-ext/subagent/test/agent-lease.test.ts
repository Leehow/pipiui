import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	acquireAgentLease,
	agentLeaseFile,
	agentLeaseMutationLockDir,
	claimAgentCleanupLease,
	inspectAgentLease,
	reapStaleAgentLease,
	releaseAgentCleanupLease,
	releaseAgentLease,
	setAgentLeaseMutationHooksForTests,
	type AgentLeaseRecord,
	type AgentLeaseResult,
} from "../agent-lease.ts";

const leaseModuleHref = new URL("../agent-lease.ts", import.meta.url).href;

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), "pipiui-agent-lease-"));
}

function writeDeadLease(root: string, agentId: string, token = "stale-token"): string {
	const filePath = agentLeaseFile(root, agentId);
	mkdirSync(dirname(filePath), { recursive: true });
	const record: AgentLeaseRecord = {
		agentId,
		pid: 999_999_999,
		token,
		createdAt: Date.now() - 60_000,
	};
	writeFileSync(filePath, JSON.stringify(record), "utf8");
	return filePath;
}

function childAcquire(root: string, agentId: string): AgentLeaseResult {
	const result = spawnSync(process.execPath, [
		"--experimental-strip-types",
		"--input-type=module",
		"-e",
		`import { acquireAgentLease } from ${JSON.stringify(leaseModuleHref)};
		 process.stdout.write(JSON.stringify(acquireAgentLease(${JSON.stringify(root)}, ${JSON.stringify(agentId)})));`,
	], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout) as AgentLeaseResult;
}

test("release vs acquire: conforming child cannot enter the critical section", (t) => {
	const root = makeRoot();
	t.after(() => {
		setAgentLeaseMutationHooksForTests();
		rmSync(root, { recursive: true, force: true });
	});
	const first = acquireAgentLease(root, "rel-acq");
	assert.ok(first.lease);
	let raced: AgentLeaseResult | undefined;
	setAgentLeaseMutationHooksForTests({
		insideCriticalSection() {
			raced = childAcquire(root, "rel-acq");
		},
	});
	releaseAgentLease(first.lease);
	assert.ok(raced?.problem);
	assert.match(raced.problem, /mutation lock busy/);
	assert.equal(existsSync(agentLeaseFile(root, "rel-acq")), false);
	const after = acquireAgentLease(root, "rel-acq");
	assert.ok(after.lease);
});

test("stale takeover vs acquire: child cannot steal during reap critical section", (t) => {
	const root = makeRoot();
	t.after(() => {
		setAgentLeaseMutationHooksForTests();
		rmSync(root, { recursive: true, force: true });
	});
	writeDeadLease(root, "stale-acq");
	let raced: AgentLeaseResult | undefined;
	setAgentLeaseMutationHooksForTests({
		insideCriticalSection() {
			raced = childAcquire(root, "stale-acq");
		},
	});
	assert.equal(reapStaleAgentLease(root, "stale-acq"), true);
	assert.ok(raced?.problem);
	assert.match(raced.problem, /mutation lock busy/);
	assert.equal(inspectAgentLease(root, "stale-acq").status, "absent");
	const next = acquireAgentLease(root, "stale-acq");
	assert.ok(next.lease);
});

test("cleanup claim vs acquire: child cannot replace a live cleanup lease", (t) => {
	const root = makeRoot();
	t.after(() => {
		setAgentLeaseMutationHooksForTests();
		rmSync(root, { recursive: true, force: true });
	});
	let raced: AgentLeaseResult | undefined;
	setAgentLeaseMutationHooksForTests({
		insideCriticalSection() {
			raced = childAcquire(root, "clean-acq");
		},
	});
	const claimed = claimAgentCleanupLease(root, "clean-acq");
	assert.ok(claimed.lease);
	assert.equal(claimed.created, true);
	assert.ok(raced?.problem);
	assert.match(raced.problem, /mutation lock busy/);
	const kept = JSON.parse(readFileSync(agentLeaseFile(root, "clean-acq"), "utf8")) as AgentLeaseRecord;
	assert.equal(kept.token, claimed.lease.token);
	releaseAgentCleanupLease(claimed);
	assert.equal(existsSync(agentLeaseFile(root, "clean-acq")), false);
});

test("lock busy fails closed and does not delete a live owner", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const live = acquireAgentLease(root, "busy-live");
	assert.ok(live.lease);
	const lockDir = agentLeaseMutationLockDir(root, "busy-live");
	mkdirSync(lockDir, { recursive: true });
	writeFileSync(join(lockDir, "owner.json"), JSON.stringify({
		pid: 1,
		token: "foreign-lock",
		createdAt: Date.now(),
	}), "utf8");
	const raced = acquireAgentLease(root, "busy-live");
	assert.ok(raced.problem);
	assert.match(raced.problem, /mutation lock busy/);
	assert.equal(inspectAgentLease(root, "busy-live").status, "live");
	const kept = JSON.parse(readFileSync(agentLeaseFile(root, "busy-live"), "utf8")) as AgentLeaseRecord;
	assert.equal(kept.token, live.lease.token);
});

test("exception inside the critical section still releases the mutation lock", (t) => {
	const root = makeRoot();
	t.after(() => {
		setAgentLeaseMutationHooksForTests();
		rmSync(root, { recursive: true, force: true });
	});
	setAgentLeaseMutationHooksForTests({
		insideCriticalSection() {
			throw new Error("boom-inside-lock");
		},
	});
	assert.throws(() => acquireAgentLease(root, "finally-rel"), /boom-inside-lock/);
	setAgentLeaseMutationHooksForTests();
	const next = acquireAgentLease(root, "finally-rel");
	assert.ok(next.lease, next.problem);
});

test("same-process reentry is non-reentrant and fails busy", (t) => {
	const root = makeRoot();
	t.after(() => {
		setAgentLeaseMutationHooksForTests();
		rmSync(root, { recursive: true, force: true });
	});
	let nested: AgentLeaseResult | undefined;
	setAgentLeaseMutationHooksForTests({
		insideCriticalSection() {
			nested = acquireAgentLease(root, "reenter");
		},
	});
	const first = acquireAgentLease(root, "reenter");
	assert.ok(first.lease);
	assert.ok(nested?.problem);
	assert.match(nested.problem, /mutation lock busy/);
});

test("crash leftover mutation lock with dead owner can be recovered", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const script = `
		import { mkdirSync, writeFileSync } from "node:fs";
		import { join } from "node:path";
		import { spawnSync } from "node:child_process";
		const dir = ${JSON.stringify(agentLeaseMutationLockDir(root, "crash-lock"))};
		mkdirSync(dir, { recursive: true });
		const identity = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).stdout.trim();
		writeFileSync(join(dir, "owner.json"), JSON.stringify({
			pid: process.pid,
			processIdentity: identity || "child-start",
			token: "crashed-owner",
			createdAt: Date.now(),
		}));
	`;
	const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
	assert.equal(child.status, 0, child.stderr);
	const recovered = acquireAgentLease(root, "crash-lock");
	assert.ok(recovered.lease, recovered.problem);
});

test("live mutation lock owner is not reclaimed", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dir = agentLeaseMutationLockDir(root, "live-lock");
	mkdirSync(dir, { recursive: true });
	const identity = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], {
		encoding: "utf8",
	}).stdout.trim();
	writeFileSync(join(dir, "owner.json"), JSON.stringify({
		pid: process.pid,
		processIdentity: identity || undefined,
		token: "still-live",
		createdAt: Date.now(),
	}), "utf8");
	const raced = acquireAgentLease(root, "live-lock");
	assert.ok(raced.problem);
	assert.match(raced.problem, /mutation lock busy/);
	assert.equal(existsSync(dir), true);
});

test("second in-process cleanup claim for the same agent/run is exclusive", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = claimAgentCleanupLease(root, "excl", "run-a");
	assert.ok(first.lease);
	const second = claimAgentCleanupLease(root, "excl", "run-a");
	assert.ok(second.problem);
	assert.match(second.problem, /cleanup claim busy/);
	assert.equal(second.lease, undefined);
	const raced = acquireAgentLease(root, "excl");
	assert.ok(raced.problem);
	assert.match(raced.problem, /already running/);
	releaseAgentCleanupLease(first);
	const again = claimAgentCleanupLease(root, "excl", "run-a");
	assert.ok(again.lease, again.problem);
	releaseAgentCleanupLease(again);
	const acquired = acquireAgentLease(root, "excl");
	assert.ok(acquired.lease, acquired.problem);
});

test("failed cleanup claim does not leak the in-process registry", (t) => {
	const root = makeRoot();
	t.after(() => {
		setAgentLeaseMutationHooksForTests();
		rmSync(root, { recursive: true, force: true });
	});
	setAgentLeaseMutationHooksForTests({
		insideCriticalSection() {
			throw new Error("boom-during-cleanup-claim");
		},
	});
	assert.throws(() => claimAgentCleanupLease(root, "leak", "run-x"), /boom-during-cleanup-claim/);
	setAgentLeaseMutationHooksForTests();
	const retry = claimAgentCleanupLease(root, "leak", "run-x");
	assert.ok(retry.lease, retry.problem);
	releaseAgentCleanupLease(retry);
});
