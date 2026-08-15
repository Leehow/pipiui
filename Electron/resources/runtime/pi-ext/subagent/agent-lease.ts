/**
 * Cross-process bare agentId lease files under .pi/agent-leases.
 * Pure move from index.ts — behavior preserved.
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
export type AgentLeasePresence = "absent" | "live" | "stale" | "blocked";
export type AgentLeaseInspection = {
	status: AgentLeasePresence;
	filePath: string;
	record?: AgentLeaseRecord;
	reason?: string;
};
const AGENT_LEASE_INVALID_GRACE_MS = 30_000;

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

function leaseProcessIsAlive(record: AgentLeaseRecord): boolean {
	try {
		process.kill(record.pid, 0);
	} catch (err) {
		return (err as NodeJS.ErrnoException)?.code === "EPERM";
	}
	if (!record.processIdentity) return true;
	const currentIdentity = leaseProcessIdentity(record.pid);
	// If ps is unavailable, fail safe: an apparently live pid keeps its lease.
	return currentIdentity === undefined || currentIdentity === record.processIdentity;
}

export function agentLeaseFile(mainCwd: string, agentId: string): string {
	return path.join(mainCwd, ".pi", "agent-leases", `${agentId}.lease`);
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

/** Read one lease file without sending a signal. Live pid (or unreadable-young) stays blocked. */
export function inspectAgentLease(mainCwd: string, agentId: string): AgentLeaseInspection {
	const filePath = agentLeaseFile(mainCwd, agentId);
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

/** Atomically claim and drop a dead-owner or aged-invalid lease. Live leases are left untouched. */
export function reapStaleAgentLease(mainCwd: string, agentId: string): boolean {
	const inspection = inspectAgentLease(mainCwd, agentId);
	if (inspection.status !== "stale") return false;
	const tomb = `${inspection.filePath}.stale-${process.pid}-${randomBytes(6).toString("hex")}`;
	try {
		fs.renameSync(inspection.filePath, tomb);
	} catch (err) {
		return (err as NodeJS.ErrnoException)?.code === "ENOENT";
	}
	try {
		fs.rmSync(tomb, { force: true });
	} catch {
		// The tomb is unaddressable as a live lease.
	}
	return true;
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

/** Atomic cross-process bare-ID lease with dead-owner/aged-invalid recovery. */
export function acquireAgentLease(mainCwd: string, agentId: string): AgentLeaseResult {
	const filePath = agentLeaseFile(mainCwd, agentId);
	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
	} catch (err) {
		return { problem: `Cannot create global agentId lease directory: ${err instanceof Error ? err.message : String(err)}` };
	}

	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			return { lease: createAgentLeaseFile(filePath, agentId) };
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
				return { problem: `Cannot acquire global lease for agentId ${JSON.stringify(agentId)}: ${err instanceof Error ? err.message : String(err)}` };
			}
		}

		let record: AgentLeaseRecord | undefined;
		let ageMs = 0;
		try {
			const stat = fs.statSync(filePath);
			ageMs = Math.max(0, Date.now() - stat.mtimeMs);
			record = JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentLeaseRecord;
		} catch {
			// A fresh invalid/partial file can be between exclusive open and close. Never steal it.
		}
		if (record && leaseProcessIsAlive(record)) {
			return { problem: `agentId ${JSON.stringify(agentId)} is already running in Pi process ${record.pid}.` };
		}
		if (!record && ageMs < AGENT_LEASE_INVALID_GRACE_MS) {
			return { problem: `agentId ${JSON.stringify(agentId)} lease is still initializing; retry later.` };
		}

		// Only dead-owner or aged-invalid files reach here. Rename is the atomic stale claim:
		// exactly one contender wins, and every other contender retries exclusive create.
		const tomb = `${filePath}.stale-${process.pid}-${randomBytes(6).toString("hex")}`;
		try {
			fs.renameSync(filePath, tomb);
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code === "ENOENT") continue;
			return { problem: `Cannot reclaim stale lease for agentId ${JSON.stringify(agentId)}: ${err instanceof Error ? err.message : String(err)}` };
		}
		try {
			fs.rmSync(tomb, { force: true });
		} catch {
			// The tomb is unaddressable as a live lease; later housekeeping may remove it.
		}
	}
	return { problem: `Could not acquire global lease for agentId ${JSON.stringify(agentId)} after concurrent retries.` };
}

/** Token check prevents an old owner from unlinking a newer owner's lease. */
export function releaseAgentLease(lease: AgentLease): void {
	try {
		const record = JSON.parse(fs.readFileSync(lease.filePath, "utf8")) as AgentLeaseRecord;
		if (record.token !== lease.token) return;
		fs.unlinkSync(lease.filePath);
	} catch {
		// Already reclaimed/removed or unreadable: never unlink without proving ownership.
	}
}
