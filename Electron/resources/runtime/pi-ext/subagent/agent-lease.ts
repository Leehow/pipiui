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

function agentLeaseFile(mainCwd: string, agentId: string): string {
	return path.join(mainCwd, ".pi", "agent-leases", `${agentId}.lease`);
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
