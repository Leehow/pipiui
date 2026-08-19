/**
 * Cross-process bare agentId lease files under .pi/agent-leases.
 * All lease-path mutations serialize on a per-agent mkdir lock.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentLeaseRecord {
	agentId: string;
	pid: number;
	processIdentity?: string;
	token: string;
	createdAt: number;
}

export interface AgentLease {
	filePath: string;
	token: string;
}

export type AgentLeaseResult = { lease: AgentLease; problem?: never } | { lease?: never; problem: string };
export type AgentCleanupLeaseResult =
	| { lease: AgentLease; created: boolean; runId: string; problem?: never }
	| { lease?: never; created?: never; runId?: never; problem: string };
export type AgentLeasePresence = "absent" | "live" | "stale" | "blocked";
export type AgentLeaseInspection = {
	status: AgentLeasePresence;
	filePath: string;
	record?: AgentLeaseRecord;
	reason?: string;
};

const AGENT_LEASE_INVALID_GRACE_MS = 30_000;
const MUTATION_LOCK_ATTEMPTS = 8;
const MUTATION_LOCK_WAIT_MS = 12;

type MutationLockOwner = {
	pid: number;
	processIdentity?: string;
	createdAt: number;
	token: string;
};

type HeldMutationLock = {
	dir: string;
	token: string;
	key: string;
};

export type AgentLeaseMutationHooks = {
	/** Runs while the per-agent mutation lock is held. Must not re-enter this process's lock. */
	insideCriticalSection?: (agentId: string) => void;
};

let leaseMutationHooks: AgentLeaseMutationHooks | undefined;
const heldMutationLocks = new Set<string>();
/** In-process exclusive cleanup claims. Not shared with ordinary worker acquire. */
const activeCleanupClaims = new Set<string>();

function cleanupClaimKey(mainCwd: string, agentId: string, runId: string): string {
	return `${path.resolve(mainCwd)}\0${agentId}\0${runId}`;
}

function cleanupClaimBusyProblem(agentId: string, runId: string): string {
	return `cleanup claim busy for agentId ${JSON.stringify(agentId)} runId ${JSON.stringify(runId)}`;
}

/** Test-only. Not a substitute for the mkdir lock. */
export function setAgentLeaseMutationHooksForTests(hooks?: AgentLeaseMutationHooks): void {
	leaseMutationHooks = hooks;
}

export function agentLeaseFile(mainCwd: string, agentId: string): string {
	return path.join(mainCwd, ".pi", "agent-leases", `${agentId}.lease`);
}

export function agentLeaseMutationLockDir(mainCwd: string, agentId: string): string {
	return path.join(mainCwd, ".pi", "agent-leases", `${agentId}.mut.lock`);
}

function mutationLockKey(mainCwd: string, agentId: string): string {
	return `${path.resolve(mainCwd)}\0${agentId}`;
}

function leaseLocationFromFile(filePath: string): { mainCwd: string; agentId: string } {
	const agentId = path.basename(filePath, ".lease");
	const mainCwd = path.resolve(filePath, "..", "..", "..");
	return { mainCwd, agentId };
}

function leaseProcessIdentity(pid: number): string | undefined {
	try {
		const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
			encoding: "utf8",
			shell: false,
		});
		const value = result.status === 0 ? result.stdout.trim() : "";
		return value || undefined;
	} catch {
		return undefined;
	}
}

let ownLeaseProcessIdentityResolved = false;
let ownLeaseProcessIdentity: string | undefined;
function currentLeaseProcessIdentity(): string | undefined {
	if (!ownLeaseProcessIdentityResolved) {
		ownLeaseProcessIdentity = leaseProcessIdentity(process.pid);
		ownLeaseProcessIdentityResolved = true;
	}
	return ownLeaseProcessIdentity;
}

function isOwnLiveLease(record: AgentLeaseRecord): boolean {
	if (record.pid !== process.pid) return false;
	if (!leaseProcessIsAlive(record)) return false;
	if (record.processIdentity) {
		const current = currentLeaseProcessIdentity();
		if (current !== undefined && current !== record.processIdentity) return false;
	}
	return true;
}

function leaseProcessIsAlive(record: { pid: number; processIdentity?: string }): boolean {
	try {
		process.kill(record.pid, 0);
	} catch (err) {
		return (err as NodeJS.ErrnoException)?.code === "EPERM";
	}
	if (!record.processIdentity) return true;
	const currentIdentity = leaseProcessIdentity(record.pid);
	return currentIdentity === undefined || currentIdentity === record.processIdentity;
}

function parseAgentLeaseRecord(raw: unknown): AgentLeaseRecord | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const candidate = raw as Record<string, unknown>;
	if (typeof candidate.agentId !== "string" || !candidate.agentId.trim()) return undefined;
	if (!Number.isSafeInteger(candidate.pid) || (candidate.pid as number) <= 0) return undefined;
	if (typeof candidate.token !== "string" || !candidate.token) return undefined;
	if (typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt)) return undefined;
	return {
		agentId: candidate.agentId,
		pid: candidate.pid as number,
		...(typeof candidate.processIdentity === "string" ? { processIdentity: candidate.processIdentity } : {}),
		token: candidate.token,
		createdAt: candidate.createdAt,
	};
}

function sleepMs(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function busyProblem(agentId: string): string {
	return `lease mutation lock busy for agentId ${JSON.stringify(agentId)}`;
}

/** True only when pid is gone, or pid was reused (start identity mismatch). Unproven → false. */
function mutationLockOwnerProvenDead(owner: MutationLockOwner): boolean {
	try {
		process.kill(owner.pid, 0);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "EPERM") return false;
		return true;
	}
	if (!owner.processIdentity) return false;
	const current = leaseProcessIdentity(owner.pid);
	if (current === undefined) return false;
	return current !== owner.processIdentity;
}

/**
 * Remove a lock directory only after the owner is proven dead.
 * While the directory exists, conforming callers cannot mkdir a replacement,
 * so this rmdir cannot hit a new live lock.
 */
function removeProvenDeadMutationLock(dir: string, expectedToken: string): boolean {
	const again = readLockOwner(dir);
	if (!again || again.token !== expectedToken) return false;
	if (!mutationLockOwnerProvenDead(again)) return false;
	try {
		fs.unlinkSync(path.join(dir, "owner.json"));
	} catch {
		return false;
	}
	try {
		fs.rmdirSync(dir);
		return true;
	} catch {
		return false;
	}
}

function readLockOwner(dir: string): MutationLockOwner | undefined {
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8")) as Partial<MutationLockOwner>;
		if (!Number.isSafeInteger(raw.pid) || (raw.pid ?? 0) <= 0) return undefined;
		if (typeof raw.token !== "string" || !raw.token) return undefined;
		if (typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) return undefined;
		return {
			pid: raw.pid as number,
			token: raw.token,
			createdAt: raw.createdAt,
			...(typeof raw.processIdentity === "string" ? { processIdentity: raw.processIdentity } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * Exclusive per-agent mutex: mkdir of `${agentId}.mut.lock`.
 * Not reentrant. Does not reclaim a lock whose owner cannot be proven dead.
 */
function acquireMutationLock(mainCwd: string, agentId: string): HeldMutationLock | { problem: string } {
	const dir = agentLeaseMutationLockDir(mainCwd, agentId);
	const key = mutationLockKey(mainCwd, agentId);
	if (heldMutationLocks.has(key)) return { problem: busyProblem(agentId) };
	try {
		fs.mkdirSync(path.dirname(dir), { recursive: true });
	} catch (err) {
		return { problem: `Cannot create lease lock directory: ${err instanceof Error ? err.message : String(err)}` };
	}
	for (let attempt = 0; attempt < MUTATION_LOCK_ATTEMPTS; attempt++) {
		try {
			fs.mkdirSync(dir);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
				return { problem: `Cannot acquire lease mutation lock: ${err instanceof Error ? err.message : String(err)}` };
			}
			const owner = readLockOwner(dir);
			if (owner && mutationLockOwnerProvenDead(owner) && removeProvenDeadMutationLock(dir, owner.token)) {
				continue;
			}
			// Live, unreadable, or unproven lock: do not steal.
			sleepMs(MUTATION_LOCK_WAIT_MS);
			continue;
		}
		const token = randomBytes(8).toString("hex");
		const owner: MutationLockOwner = {
			pid: process.pid,
			processIdentity: currentLeaseProcessIdentity(),
			createdAt: Date.now(),
			token,
		};
		try {
			fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
		} catch (err) {
			try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* we created this dir */ }
			return { problem: `Cannot write lease mutation lock owner: ${err instanceof Error ? err.message : String(err)}` };
		}
		heldMutationLocks.add(key);
		return { dir, token, key };
	}
	return { problem: busyProblem(agentId) };
}

function releaseMutationLock(lock: HeldMutationLock): void {
	heldMutationLocks.delete(lock.key);
	try {
		const owner = readLockOwner(lock.dir);
		if (!owner || owner.token !== lock.token) return;
		try { fs.unlinkSync(path.join(lock.dir, "owner.json")); } catch { /* still rmdir if empty */ }
		fs.rmdirSync(lock.dir);
	} catch {
		// Another holder would have a different token; leave the directory.
	}
}

function withLeaseMutationLock<T>(
	mainCwd: string,
	agentId: string,
	body: () => T,
	onBusy: (problem: string) => T,
): T {
	const lock = acquireMutationLock(mainCwd, agentId);
	if (!("dir" in lock)) return onBusy(lock.problem);
	try {
		leaseMutationHooks?.insideCriticalSection?.(agentId);
		return body();
	} finally {
		releaseMutationLock(lock);
	}
}

function inspectLeasePath(filePath: string, agentId: string): AgentLeaseInspection {
	let ageMs = 0;
	try {
		ageMs = Math.max(0, Date.now() - fs.statSync(filePath).mtimeMs);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { status: "absent", filePath };
		return { status: "blocked", filePath, reason: err instanceof Error ? err.message : String(err) };
	}
	let record: AgentLeaseRecord | undefined;
	try {
		record = parseAgentLeaseRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
	} catch {
		record = undefined;
	}
	if (!record) {
		if (ageMs < AGENT_LEASE_INVALID_GRACE_MS) {
			return { status: "blocked", filePath, reason: "lease is still initializing" };
		}
		return { status: "stale", filePath, reason: "aged-invalid lease" };
	}
	if (record.agentId !== agentId) {
		return { status: "blocked", filePath, record, reason: "lease agentId does not match" };
	}
	if (leaseProcessIsAlive(record)) return { status: "live", filePath, record };
	return { status: "stale", filePath, record, reason: "lease owner pid is not alive" };
}

/** Read one lease file without sending a signal. Live pid (or unreadable-young) stays blocked. */
export function inspectAgentLease(mainCwd: string, agentId: string): AgentLeaseInspection {
	return inspectLeasePath(agentLeaseFile(mainCwd, agentId), agentId);
}

function unlinkIfPresent(filePath: string): void {
	try {
		fs.unlinkSync(filePath);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
	}
}

function createAgentLeaseFile(filePath: string, agentId: string): AgentLease {
	const token = randomBytes(16).toString("hex");
	const record: AgentLeaseRecord = {
		agentId,
		pid: process.pid,
		processIdentity: currentLeaseProcessIdentity(),
		token,
		createdAt: Date.now(),
	};
	const fd = fs.openSync(filePath, "wx", 0o600);
	try {
		fs.writeFileSync(fd, JSON.stringify(record), "utf8");
	} finally {
		fs.closeSync(fd);
	}
	return { filePath, token };
}

function acquireAgentLeaseUnlocked(mainCwd: string, agentId: string): AgentLeaseResult {
	const filePath = agentLeaseFile(mainCwd, agentId);
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
	} catch (err) {
		return { problem: `Cannot create global agentId lease directory: ${err instanceof Error ? err.message : String(err)}` };
	}
	try {
		return { lease: createAgentLeaseFile(filePath, agentId) };
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
			return { problem: `Cannot acquire global lease for agentId ${JSON.stringify(agentId)}: ${err instanceof Error ? err.message : String(err)}` };
		}
	}
	const inspection = inspectLeasePath(filePath, agentId);
	if (inspection.status === "live") {
		return { problem: `agentId ${JSON.stringify(agentId)} is already running in Pi process ${inspection.record?.pid ?? "unknown"}.` };
	}
	if (inspection.status === "blocked") {
		return { problem: inspection.reason ?? `agentId ${JSON.stringify(agentId)} lease is still initializing; retry later.` };
	}
	unlinkIfPresent(filePath);
	try {
		return { lease: createAgentLeaseFile(filePath, agentId) };
	} catch (err) {
		return { problem: `Cannot acquire global lease for agentId ${JSON.stringify(agentId)}: ${err instanceof Error ? err.message : String(err)}` };
	}
}

function releaseAgentLeaseUnlocked(lease: AgentLease): void {
	const { agentId } = leaseLocationFromFile(lease.filePath);
	const inspection = inspectLeasePath(lease.filePath, agentId);
	if (inspection.status === "absent") return;
	if (!inspection.record || inspection.record.token !== lease.token) return;
	unlinkIfPresent(lease.filePath);
}

function reapStaleAgentLeaseUnlocked(mainCwd: string, agentId: string): boolean {
	const inspection = inspectLeasePath(agentLeaseFile(mainCwd, agentId), agentId);
	if (inspection.status === "absent") return true;
	if (inspection.status !== "stale") return false;
	unlinkIfPresent(inspection.filePath);
	return true;
}

function claimAgentCleanupLeaseUnlocked(mainCwd: string, agentId: string): AgentCleanupLeaseResult {
	const inspection = inspectLeasePath(agentLeaseFile(mainCwd, agentId), agentId);
	if (inspection.status === "live") {
		if (inspection.record && isOwnLiveLease(inspection.record)) {
			return { lease: { filePath: inspection.filePath, token: inspection.record.token }, created: false };
		}
		return {
			problem: `agentId ${JSON.stringify(agentId)} is already running in Pi process ${inspection.record?.pid ?? "unknown"}.`,
		};
	}
	if (inspection.status === "blocked") {
		return { problem: inspection.reason ?? "lease cannot be inspected safely" };
	}
	const acquired = acquireAgentLeaseUnlocked(mainCwd, agentId);
	if (!acquired.lease) return acquired;
	return { lease: acquired.lease, created: true };
}

/** Drop a dead-owner or aged-invalid lease under the per-agent mutation lock. */
export function reapStaleAgentLease(mainCwd: string, agentId: string): boolean {
	return withLeaseMutationLock(mainCwd, agentId, () => reapStaleAgentLeaseUnlocked(mainCwd, agentId), () => false);
}

/** Create or take over a stale lease. Serialized with release/reap/cleanup. */
export function acquireAgentLease(mainCwd: string, agentId: string): AgentLeaseResult {
	return withLeaseMutationLock(
		mainCwd,
		agentId,
		() => acquireAgentLeaseUnlocked(mainCwd, agentId),
		(problem) => ({ problem }),
	);
}

/**
 * Exclusive cleanup ownership for one agent/run in this process.
 * Own live worker lease may be reused by the first claim only (not released).
 * A second in-process claim for the same agent/run fails busy and does not share the token.
 */
export function claimAgentCleanupLease(
	mainCwd: string,
	agentId: string,
	runId = "default",
): AgentCleanupLeaseResult {
	const key = cleanupClaimKey(mainCwd, agentId, runId);
	if (activeCleanupClaims.has(key)) return { problem: cleanupClaimBusyProblem(agentId, runId) };
	activeCleanupClaims.add(key);
	let transferred = false;
	try {
		const claimed = withLeaseMutationLock(
			mainCwd,
			agentId,
			() => claimAgentCleanupLeaseUnlocked(mainCwd, agentId),
			(problem) => ({ problem }),
		);
		if (!claimed.lease) return claimed;
		transferred = true;
		return { lease: claimed.lease, created: claimed.created, runId };
	} finally {
		if (!transferred) activeCleanupClaims.delete(key);
	}
}

/** Drop only a cleanup-created exclusive lease. Always clears the in-process claim slot. */
export function releaseAgentCleanupLease(claim: { lease: AgentLease; created: boolean; runId?: string }): void {
	const { mainCwd, agentId } = leaseLocationFromFile(claim.lease.filePath);
	const key = cleanupClaimKey(mainCwd, agentId, claim.runId ?? "default");
	try {
		if (claim.created) releaseAgentLease(claim.lease);
	} finally {
		activeCleanupClaims.delete(key);
	}
}

/** Token-checked unlink under the same per-agent mutation lock as acquire. */
export function releaseAgentLease(lease: AgentLease): void {
	const { mainCwd, agentId } = leaseLocationFromFile(lease.filePath);
	withLeaseMutationLock(mainCwd, agentId, () => releaseAgentLeaseUnlocked(lease), () => undefined);
}
