/**
 * Versioned Supervisor control state (S3).
 *
 * Compact durable claims and counters only — never transcripts or raw worker
 * output. The file-backed store is project-scoped: the caller supplies a path
 * under `{project}/.pi/agent`. Global `~/.pi` is rejected.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	isSupervisorActionKind,
	isSupervisorEventKind,
	type SupervisorActionKind,
	type SupervisorEventKind,
} from "./contract.ts";

export const SUPERVISOR_STATE_VERSION = 1 as const;

export const SUPERVISOR_CLAIM_STATUSES = ["in_progress", "completed"] as const;
export type SupervisorClaimStatus = (typeof SUPERVISOR_CLAIM_STATUSES)[number];

export const SUPERVISOR_CONTROL_OUTCOMES = [
	"applied",
	"duplicate",
	"noop",
	"rejected",
	"escalation_required",
] as const;
export type SupervisorControlOutcome = (typeof SUPERVISOR_CONTROL_OUTCOMES)[number];

const FORBIDDEN_STATE_KEYS = ["transcript", "messages", "findings"] as const;

export interface SupervisorReceiptClaim {
	eventId: string;
	agentId: string;
	runId: string;
	kind: SupervisorEventKind;
	sequence: number;
	action: SupervisorActionKind;
	status: SupervisorClaimStatus;
	outcome?: SupervisorControlOutcome;
	evidenceRefs?: string[];
	claimedAt: number;
	completedAt?: number;
}

export interface SupervisorState {
	version: typeof SUPERVISOR_STATE_VERSION;
	receipts: Record<string, SupervisorReceiptClaim>;
	usage: Record<string, number>;
}

export interface SupervisorStateStore {
	load(): SupervisorState;
	save(state: SupervisorState): void;
}

export function createEmptySupervisorState(): SupervisorState {
	return { version: SUPERVISOR_STATE_VERSION, receipts: {}, usage: {} };
}

export function budgetUsageKey(kind: "retry" | "abort" | "resolve" | "start", id: string): string {
	return `${kind}:${id}`;
}

export function isForbiddenSupervisorStateKey(key: string): boolean {
	return (FORBIDDEN_STATE_KEYS as readonly string[]).includes(key);
}

export function assertProjectScopedSupervisorStatePath(filePath: string): void {
	if (typeof filePath !== "string" || filePath.trim().length === 0) {
		throw new Error("Supervisor state path must be a non-empty string");
	}
	const trimmed = filePath.trim();
	const posix = trimmed.replace(/\\/g, "/");
	if (posix === "~/.pi" || posix.startsWith("~/.pi/")) {
		throw new Error("Supervisor state must not use global ~/.pi");
	}
	const resolved = path.resolve(trimmed);
	const homePi = path.resolve(os.homedir(), ".pi");
	if (resolved === homePi || resolved.startsWith(homePi + path.sep)) {
		throw new Error("Supervisor state must not use global ~/.pi");
	}
	const normalized = resolved.split(path.sep).join("/");
	if (!normalized.includes("/.pi/agent/") && !normalized.endsWith("/.pi/agent")) {
		throw new Error("Supervisor state path must be under project .pi/agent");
	}
}

/** One compact state file per exact Boss session; the raw session key never enters a filename. */
export function supervisorSessionStatePath(projectRoot: string, sessionId: string): string {
	const root = projectRoot.trim();
	const exactSession = sessionId.trim();
	if (!root) throw new Error("Supervisor projectRoot is required");
	if (!exactSession) throw new Error("Supervisor Boss session id is required");
	const namespace = createHash("sha256").update(exactSession).digest("hex").slice(0, 24);
	return path.join(root, ".pi", "agent", "supervisor", "sessions", namespace, "state.json");
}

function fail(error: string): never {
	throw new Error(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredToken(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		fail(`${label} must be a non-empty string`);
	}
	return value.trim();
}

function requiredInt(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		fail(`${label} must be a non-negative integer`);
	}
	return value;
}

function parseEvidenceRefs(value: unknown, label: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
		fail(`${label} must be an array of non-empty strings`);
	}
	return value.map((entry) => entry.trim());
}

function compactClaim(input: unknown): SupervisorReceiptClaim {
	if (!isRecord(input)) fail("receipt claim must be an object");
	for (const key of FORBIDDEN_STATE_KEYS) {
		if (key in input) fail(`state must not include ${key}`);
	}
	if (!isSupervisorEventKind(input.kind)) fail("receipt.kind is not a Supervisor event");
	if (!isSupervisorActionKind(input.action)) fail("receipt.action is not a Supervisor action");
	if (!(SUPERVISOR_CLAIM_STATUSES as readonly string[]).includes(input.status as string)) {
		fail("receipt.status must be in_progress or completed");
	}
	if (input.outcome !== undefined && !(SUPERVISOR_CONTROL_OUTCOMES as readonly string[]).includes(input.outcome as string)) {
		fail("receipt.outcome is not a Supervisor control outcome");
	}
	const evidenceRefs = parseEvidenceRefs(input.evidenceRefs, "receipt.evidenceRefs");
	const completedAt = input.completedAt === undefined ? undefined : requiredInt(input.completedAt, "receipt.completedAt");
	return {
		eventId: requiredToken(input.eventId, "receipt.eventId"),
		agentId: requiredToken(input.agentId, "receipt.agentId"),
		runId: requiredToken(input.runId, "receipt.runId"),
		kind: input.kind,
		sequence: requiredInt(input.sequence, "receipt.sequence"),
		action: input.action,
		status: input.status as SupervisorClaimStatus,
		...(input.outcome !== undefined ? { outcome: input.outcome as SupervisorControlOutcome } : {}),
		...(evidenceRefs ? { evidenceRefs } : {}),
		claimedAt: requiredInt(input.claimedAt, "receipt.claimedAt"),
		...(completedAt !== undefined ? { completedAt } : {}),
	};
}

export function parseSupervisorState(value: unknown): SupervisorState {
	if (!isRecord(value)) fail("supervisor state must be an object");
	for (const key of FORBIDDEN_STATE_KEYS) {
		if (key in value) fail(`state must not include ${key}`);
	}
	if (value.version !== SUPERVISOR_STATE_VERSION) {
		fail(`unsupported supervisor state version (${String(value.version)})`);
	}
	if (!isRecord(value.receipts)) fail("state.receipts must be an object");
	if (!isRecord(value.usage)) fail("state.usage must be an object");
	const receipts: Record<string, SupervisorReceiptClaim> = {};
	for (const [eventId, raw] of Object.entries(value.receipts)) {
		const claim = compactClaim(raw);
		if (claim.eventId !== eventId) fail("receipt key must match eventId");
		receipts[eventId] = claim;
	}
	const usage: Record<string, number> = {};
	for (const [key, count] of Object.entries(value.usage)) {
		if (typeof key !== "string" || key.trim().length === 0) fail("usage key must be a non-empty string");
		usage[key] = requiredInt(count, `usage.${key}`);
	}
	return { version: SUPERVISOR_STATE_VERSION, receipts, usage };
}

export function serializeSupervisorState(state: SupervisorState): string {
	return JSON.stringify(parseSupervisorState(state));
}

export function createFileSupervisorStateStore(filePath: string): SupervisorStateStore {
	assertProjectScopedSupervisorStatePath(filePath);
	const resolved = path.resolve(filePath);

	return {
		load() {
			try {
				const raw = fs.readFileSync(resolved, "utf8");
				return parseSupervisorState(JSON.parse(raw) as unknown);
			} catch (error) {
				if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
					return createEmptySupervisorState();
				}
				throw error;
			}
		},
		save(state: SupervisorState) {
			const payload = serializeSupervisorState(state);
			fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
			const temp = `${resolved}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
			try {
				fs.writeFileSync(temp, payload, { encoding: "utf8", mode: 0o600 });
				fs.renameSync(temp, resolved);
			} catch (error) {
				try { fs.unlinkSync(temp); } catch { /* best effort */ }
				throw error;
			}
		},
	};
}
