import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type DeliveryState = "pending" | "attempting" | "failed" | "queued" | "observed" | "fulfilled";

export interface DeliveryObligation {
	version: 1;
	id: string;
	routingKeyHash: string;
	agentId: string;
	runId: string;
	payloadHash: string;
	text: string;
	state: DeliveryState;
	attempts: number;
	createdAt: number;
	updatedAt: number;
	lastAttemptAt: number;
	ownerPid?: number;
	ownerToken?: string;
}

export interface RecoverableDelivery {
	record: DeliveryObligation;
	ambiguous: boolean;
}

interface StoreOptions {
	now?: () => number;
	pid?: number;
	ownerToken?: string;
	processAlive?: (pid: number) => boolean;
	maxRows?: number;
	maxAgeMs?: number;
	deliveredRetentionMs?: number;
	maxAttempts?: number;
	routingKey?: string;
	claimLeaseMs?: number;
	auxiliaryMaxAgeMs?: number;
	maxAuxiliaryFiles?: number;
}

interface DeliveryClaim {
	pid: number;
	ownerToken: string;
	createdAt: number;
}

// The extension permits 1000-way fan-out; keep one full wave plus recovery headroom.
const DEFAULT_MAX_ROWS = 2048;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_DELIVERED_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const INVALID_CLAIM_GRACE_MS = 5_000;
const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_AUXILIARY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function deliveryRetryDue(
	record: Pick<DeliveryObligation, "state" | "attempts" | "lastAttemptAt">,
	now: number,
	minimumIntervalMs: number,
	maxAttempts: number,
): boolean {
	// `queued` already exists in this live Pi process's in-memory followUp queue.
	// Only session_start recovery may replay it; timers and lifecycle chatter retry
	// pending/failed rows and must never duplicate a long-running queued turn.
	if ((record.state !== "pending" && record.state !== "failed") || record.attempts >= maxAttempts) return false;
	return record.attempts === 0 || now - record.lastAttemptAt >= minimumIntervalMs;
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function isRecord(value: unknown): value is DeliveryObligation {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const r = value as Partial<DeliveryObligation>;
	const persistedState = (value as { state?: unknown }).state;
	return (
		r.version === 1 &&
		typeof r.id === "string" && /^[a-f0-9]{64}$/.test(r.id) &&
		typeof r.routingKeyHash === "string" && /^[a-f0-9]{64}$/.test(r.routingKeyHash) &&
		typeof r.agentId === "string" && r.agentId.length > 0 &&
		typeof r.runId === "string" && r.runId.length > 0 &&
		typeof r.payloadHash === "string" && /^[a-f0-9]{64}$/.test(r.payloadHash) &&
		typeof r.text === "string" &&
		(persistedState === "pending" || persistedState === "attempting" || persistedState === "failed" || persistedState === "queued" || persistedState === "observed" || persistedState === "fulfilled" || persistedState === "accepted" || persistedState === "delivered") &&
		Number.isSafeInteger(r.attempts) && (r.attempts ?? -1) >= 0 &&
		typeof r.createdAt === "number" && Number.isFinite(r.createdAt) &&
		typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) &&
		typeof r.lastAttemptAt === "number" && Number.isFinite(r.lastAttemptAt) &&
		(r.ownerPid === undefined || (Number.isSafeInteger(r.ownerPid) && r.ownerPid > 0)) &&
		(r.ownerToken === undefined || (typeof r.ownerToken === "string" && r.ownerToken.length > 0))
	);
}

/**
 * Crash-tolerant, dependency-free delivery obligations. One atomic JSON file per completion
 * avoids a shared read/modify/write ledger and lets multiple Pi processes own different rows.
 */
export class DeliveryObligationStore {
	readonly directory: string;
	private readonly now: () => number;
	private readonly pid: number;
	private readonly ownerToken: string;
	private readonly alive: (pid: number) => boolean;
	private readonly maxRows: number;
	private readonly maxAgeMs: number;
	private readonly deliveredRetentionMs: number;
	private readonly maxAttempts: number;
	private readonly routingKeyHash: string;
	private readonly claimLeaseMs: number;
	private readonly auxiliaryMaxAgeMs: number;
	private readonly maxAuxiliaryFiles: number;

	constructor(directory: string, options: StoreOptions = {}) {
		this.directory = directory;
		this.now = options.now ?? Date.now;
		this.pid = options.pid ?? process.pid;
		this.ownerToken = options.ownerToken ?? `${this.pid}-${randomBytes(8).toString("hex")}`;
		this.alive = options.processAlive ?? processIsAlive;
		this.maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS);
		this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
		this.deliveredRetentionMs = options.deliveredRetentionMs ?? DEFAULT_DELIVERED_RETENTION_MS;
		this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
		this.routingKeyHash = sha256(options.routingKey ?? "default");
		this.claimLeaseMs = Math.max(1, options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS);
		this.auxiliaryMaxAgeMs = Math.max(1, options.auxiliaryMaxAgeMs ?? DEFAULT_AUXILIARY_MAX_AGE_MS);
		this.maxAuxiliaryFiles = Math.max(1, options.maxAuxiliaryFiles ?? this.maxRows * 2);
	}

	static runId(): string {
		return `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
	}

	static routingDirectory(routingKey: string): string {
		return sha256(routingKey).slice(0, 24);
	}

	create(agentId: string, runId: string, text: string): DeliveryObligation {
		const payloadHash = sha256(text);
		// One Pi session + agent generation is one logical completion. The payload hash
		// protects the stored text, but must not turn retry formatting into a second event.
		const id = sha256(`${this.routingKeyHash}\0${agentId}\0${runId}`);
		const existing = this.read(id);
		if (existing) return existing;
		const now = this.now();
		const record: DeliveryObligation = {
			version: 1,
			id,
			routingKeyHash: this.routingKeyHash,
			agentId,
			runId,
			payloadHash,
			text,
			state: "pending",
			attempts: 0,
			createdAt: now,
			updatedAt: now,
			lastAttemptAt: 0,
		};
		this.write(record);
		this.prune(id);
		return record;
	}

	beginAttempt(id: string): DeliveryObligation | undefined {
		if (!this.acquireClaim(id)) return undefined;
		const record = this.read(id);
		if (!record || record.state === "fulfilled" || record.attempts >= this.maxAttempts) {
			this.releaseClaim(id);
			return undefined;
		}
		const next: DeliveryObligation = {
			...record,
			state: "attempting",
			attempts: record.attempts + 1,
			lastAttemptAt: this.now(),
			updatedAt: this.now(),
			ownerPid: this.pid,
			ownerToken: this.ownerToken,
		};
		try {
			this.write(next);
		} catch (err) {
			this.releaseClaim(id);
			throw err;
		}
		return next;
	}

	finishAttempt(id: string, queued: boolean): DeliveryObligation | undefined {
		const record = this.read(id);
		if (!record) return undefined;
		// A stale promise from another process/extension instance must not settle our row.
		if (record.ownerPid !== this.pid || record.ownerToken !== this.ownerToken) return record;
		const next: DeliveryObligation = {
			...record,
			state: queued ? "queued" : "failed",
			updatedAt: this.now(),
			ownerPid: undefined,
			ownerToken: undefined,
		};
		this.write(next);
		this.releaseClaim(id);
		return next;
	}

	/** Mark only a message independently observed in Pi's persisted session history. */
	markObserved(id: string): DeliveryObligation | undefined {
		const record = this.read(id);
		if (!record) return undefined;
		if (record.state === "fulfilled") return record;
		const next: DeliveryObligation = {
			...record,
			state: "observed",
			updatedAt: this.now(),
			ownerPid: undefined,
			ownerToken: undefined,
		};
		this.write(next);
		this.releaseClaim(id);
		return next;
	}

	markFulfilled(id: string): DeliveryObligation | undefined {
		const record = this.read(id);
		if (!record) return undefined;
		const next: DeliveryObligation = {
			...record,
			state: "fulfilled",
			updatedAt: this.now(),
			ownerPid: undefined,
			ownerToken: undefined,
		};
		this.write(next);
		this.releaseClaim(id);
		return next;
	}

	/** A persisted Boss assistant ended unsuccessfully; retry through normal bounded gates. */
	markRetryable(id: string): DeliveryObligation | undefined {
		const record = this.read(id);
		if (!record || record.state === "fulfilled") return record;
		const next: DeliveryObligation = {
			...record,
			state: "failed",
			updatedAt: this.now(),
			ownerPid: undefined,
			ownerToken: undefined,
		};
		this.write(next);
		this.releaseClaim(id);
		return next;
	}

	recoverable(): RecoverableDelivery[] {
		this.prune();
		const now = this.now();
		const result: RecoverableDelivery[] = [];
		for (const record of this.readAll()) {
			if (record.state === "fulfilled" || record.attempts >= this.maxAttempts) continue;
			if (now - record.createdAt > this.maxAgeMs) continue;
			if (this.attemptIsLiveRecent(record)) continue;
			result.push({
				record,
				// Recovery happens in a newly initialized delivery owner. Even a persisted
				// `pending` row may follow a begin-attempt write failure that still sent best-effort.
				ambiguous: true,
			});
		}
		return result.sort((a, b) => a.record.createdAt - b.record.createdAt);
	}

	read(id: string): DeliveryObligation | undefined {
		try {
			const parsed = JSON.parse(fs.readFileSync(this.file(id), "utf8")) as unknown;
			if (
				!isRecord(parsed) ||
				parsed.id !== id ||
				parsed.routingKeyHash !== this.routingKeyHash ||
				parsed.payloadHash !== sha256(parsed.text)
			) return undefined;
			// Older rows used `accepted`/`delivered` for a fire-and-forget call return.
			// That was not a persistence acknowledgement, so recover them as queued.
			if ((parsed as { state?: unknown }).state === "accepted" || (parsed as { state?: unknown }).state === "delivered") {
				return { ...(parsed as DeliveryObligation), state: "queued" };
			}
			return parsed;
		} catch {
			return undefined;
		}
	}

	private readAll(): DeliveryObligation[] {
		let names: string[];
		try {
			names = fs.readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
		} catch {
			return [];
		}
		const rows: DeliveryObligation[] = [];
		for (const name of names) {
			const id = name.slice(0, -5);
			const record = this.read(id);
			if (record) {
				rows.push(record);
				continue;
			}
			// Invalid rows never block healthy delivery; quarantine without reading/logging payload.
			try {
				fs.renameSync(path.join(this.directory, name), path.join(this.directory, `${name}.corrupt-${this.now()}`));
			} catch {
				// Another process may already have quarantined it.
			}
		}
		return rows;
	}

	private prune(protectedId?: string): void {
		const now = this.now();
		let rows = this.readAll();
		for (const row of rows) {
			if (this.attemptIsLiveRecent(row)) continue;
			const expired = now - row.createdAt > this.maxAgeMs;
			const fulfilledExpired = row.state === "fulfilled" && now - row.updatedAt > this.deliveredRetentionMs;
			// Exhausted failures remain as bounded tombstones until age/cap pruning. Removing
			// them immediately would let a duplicate terminal callback recreate the same run
			// and silently reset its retry budget.
			if (expired || fulfilledExpired) this.removeRow(row.id);
		}
		rows = this.readAll().sort((a, b) => b.updatedAt - a.updatedAt);
		const keep = new Set<string>();
		if (protectedId && rows.some((row) => row.id === protectedId)) keep.add(protectedId);
		for (const row of rows) if (this.attemptIsLiveRecent(row)) keep.add(row.id);
		for (const row of rows) {
			if (keep.size >= this.maxRows) break;
			keep.add(row.id);
		}
		for (const row of rows) if (!keep.has(row.id)) this.removeRow(row.id);
		this.cleanupAuxiliaryFiles(new Set(this.readAll().map((row) => row.id)));
	}

	private file(id: string): string {
		return path.join(this.directory, `${id}.json`);
	}

	private claimFile(id: string): string {
		return path.join(this.directory, `${id}.claim`);
	}

	private claimIsRecent(claim: DeliveryClaim): boolean {
		const age = this.now() - claim.createdAt;
		return age >= -INVALID_CLAIM_GRACE_MS && age <= this.claimLeaseMs;
	}

	private claimIsLiveRecent(claim: DeliveryClaim): boolean {
		return this.claimIsRecent(claim) && this.alive(claim.pid);
	}

	private attemptIsLiveRecent(record: DeliveryObligation): boolean {
		if (record.state !== "attempting" || !record.ownerPid || !record.lastAttemptAt) return false;
		const age = this.now() - record.lastAttemptAt;
		return age >= -INVALID_CLAIM_GRACE_MS && age <= this.claimLeaseMs && this.alive(record.ownerPid);
	}

	private readClaim(filePath: string): DeliveryClaim | undefined {
		try {
			const claim = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DeliveryClaim>;
			if (
				!Number.isSafeInteger(claim.pid) || (claim.pid ?? 0) <= 0 ||
				typeof claim.ownerToken !== "string" || claim.ownerToken.length === 0 ||
				typeof claim.createdAt !== "number" || !Number.isFinite(claim.createdAt)
			) return undefined;
			return claim as DeliveryClaim;
		} catch {
			return undefined;
		}
	}

	private acquireClaim(id: string): boolean {
		fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const claimPath = this.claimFile(id);
		for (let attempt = 0; attempt < 4; attempt++) {
			const claim: DeliveryClaim = { pid: this.pid, ownerToken: this.ownerToken, createdAt: this.now() };
			try {
				const fd = fs.openSync(claimPath, "wx", 0o600);
				try {
					fs.writeFileSync(fd, JSON.stringify(claim), "utf8");
					fs.fsyncSync(fd);
				} finally {
					fs.closeSync(fd);
				}
				return true;
			} catch (err) {
				if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
			}

			let existing: DeliveryClaim | undefined;
			let claimAgeMs = 0;
			existing = this.readClaim(claimPath);
			if (!existing) {
				try { claimAgeMs = Math.max(0, this.now() - fs.statSync(claimPath).mtimeMs); } catch { continue; }
			}
			if (!existing && claimAgeMs < INVALID_CLAIM_GRACE_MS) {
				// A creator may still be writing. Do not steal a fresh unreadable claim.
				return false;
			}
			if (existing && existing.pid !== this.pid && this.claimIsLiveRecent(existing)) return false;
			if (existing?.pid === this.pid && existing.ownerToken === this.ownerToken) return true;

			const tomb = `${claimPath}.stale-${this.pid}-${randomBytes(6).toString("hex")}`;
			try {
				fs.renameSync(claimPath, tomb);
				try { fs.unlinkSync(tomb); } catch { /* stale claim is no longer addressable */ }
			} catch (err) {
				if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") return false;
			}
		}
		return false;
	}

	private releaseClaim(id: string): void {
		const claimPath = this.claimFile(id);
		try {
			const claim = JSON.parse(fs.readFileSync(claimPath, "utf8")) as DeliveryClaim;
			if (claim.pid !== this.pid || claim.ownerToken !== this.ownerToken) return;
			fs.unlinkSync(claimPath);
		} catch {
			// Missing/unreadable claims cannot be safely removed.
		}
	}

	private write(record: DeliveryObligation): void {
		fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const target = this.file(record.id);
		const temp = `${target}.tmp-${this.pid}-${randomBytes(6).toString("hex")}`;
		const fd = fs.openSync(temp, "wx", 0o600);
		try {
			fs.writeFileSync(fd, JSON.stringify(record), "utf8");
			fs.fsyncSync(fd);
		} catch (err) {
			try { fs.unlinkSync(temp); } catch { /* best effort */ }
			throw err;
		} finally {
			fs.closeSync(fd);
		}
		try {
			fs.renameSync(temp, target);
		} catch (err) {
			try { fs.unlinkSync(temp); } catch { /* best effort */ }
			throw err;
		}
		// Persist the directory entry where supported; rename remains atomic if this fails.
		try {
			const dirFd = fs.openSync(this.directory, "r");
			try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
		} catch { /* best effort on filesystems that cannot fsync directories */ }
	}

	private cleanupAuxiliaryFiles(rowIds: Set<string>): void {
		let names: string[];
		try { names = fs.readdirSync(this.directory); } catch { return; }
		const now = this.now();
		const retained: Array<{ name: string; mtimeMs: number; protected: boolean }> = [];
		for (const name of names) {
			const claimMatch = /^([a-f0-9]{64})\.claim$/.exec(name);
			const auxiliary = claimMatch || /\.(?:corrupt-|stale-|tmp-)/.test(name);
			if (!auxiliary) continue;
			const filePath = path.join(this.directory, name);
			let mtimeMs = now;
			try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { continue; }
			const claim = claimMatch ? this.readClaim(filePath) : undefined;
			const liveRecentClaim = Boolean(claim && this.claimIsLiveRecent(claim));
			const associatedRow = claimMatch ? rowIds.has(claimMatch[1]) : false;
			const expired = claimMatch
				? claim ? !this.claimIsRecent(claim) : now - mtimeMs > INVALID_CLAIM_GRACE_MS
				: now - mtimeMs > this.auxiliaryMaxAgeMs;
			if (!liveRecentClaim && (expired || (claimMatch && !associatedRow))) {
				try { fs.unlinkSync(filePath); } catch { /* another process may own cleanup */ }
				continue;
			}
			retained.push({ name, mtimeMs, protected: liveRecentClaim });
		}
		const protectedCount = retained.filter((item) => item.protected).length;
		let budget = Math.max(0, this.maxAuxiliaryFiles - protectedCount);
		for (const item of retained.filter((entry) => !entry.protected).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
			if (budget-- > 0) continue;
			try { fs.unlinkSync(path.join(this.directory, item.name)); } catch { /* best effort */ }
		}
	}

	private removeRow(id: string): void {
		try { fs.unlinkSync(this.file(id)); } catch { /* already removed or read-only */ }
		const claimPath = this.claimFile(id);
		const claim = this.readClaim(claimPath);
		if (claim && this.claimIsLiveRecent(claim)) return;
		try { fs.unlinkSync(claimPath); } catch { /* no stale claim */ }
	}
}
