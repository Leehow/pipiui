import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type DeliveryState = "pending" | "attempting" | "failed" | "queued" | "observed" | "acknowledged" | "fulfilled";

export interface DeliveryObligation {
	version: 1;
	id: string;
	routingKeyHash: string;
	agentId: string;
	runId: string;
	/** Model-visible semantic identity. Internal runId remains opaque. */
	alarmId?: string;
	payloadHash: string;
	text: string;
	state: DeliveryState;
	attempts: number;
	createdAt: number;
	updatedAt: number;
	lastAttemptAt: number;
	/** Top-level Boss alarms require an explicit exact-run acknowledgement. */
	acknowledgementRequired: boolean;
	ownerPid?: number;
	ownerToken?: string;
	acknowledgedAt?: number;
	acknowledgementNote?: string;
	alarmRollup?: {
		version: 1;
		count: number;
		firstAt: number;
		lastAt: number;
		latestAgentId: string;
		latestRunId: string;
		digest: string;
	};
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
	maxUnacknowledgedAlarms?: number;
	maxUnacknowledgedAlarmsPerAgent?: number;
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
const DEFAULT_MAX_UNACKNOWLEDGED_ALARMS = 256;
const DEFAULT_MAX_UNACKNOWLEDGED_ALARMS_PER_AGENT = 16;
const ALARM_OVERFLOW_AGENT_ID = "alarm-overflow";
const ALARM_OVERFLOW_RUN_ID = "alarm-overflow";
const ALARM_OVERFLOW_ID = "alarm-overflow.1";

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

/** Manual-ack alarm cadence: first repeat after 1m, second after 2m, then every 5m. */
export function alarmRetryIntervalMs(attempts: number): number {
	if (attempts <= 1) return 60_000;
	if (attempts === 2) return 120_000;
	return 300_000;
}

export function alarmRetryDue(
	record: Pick<DeliveryObligation, "acknowledgementRequired" | "state" | "attempts" | "lastAttemptAt">,
	now: number,
): boolean {
	if (!record.acknowledgementRequired) return false;
	if (record.state !== "pending" && record.state !== "failed" && record.state !== "queued" && record.state !== "observed") {
		return false;
	}
	return record.attempts === 0 || now - record.lastAttemptAt >= alarmRetryIntervalMs(record.attempts);
}

/** Confirmed [subagent-done] must not enter Pi's follow-up queue during a live
 *  Boss turn (2026-08-15 receipt storm). The idle settle flush is the one
 *  exception: the first receipt immediately sets busy, and later siblings in
 *  the same flush must still go out. */
export function holdConfirmedDoneDelivery(
	activity: { quiet: boolean; busy: boolean },
	options?: { flushAfterSettle?: boolean },
): boolean {
	if (activity.quiet) return true;
	if (activity.busy && !options?.flushAfterSettle) return true;
	return false;
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
		(r.alarmId === undefined || (typeof r.alarmId === "string" && r.alarmId.length > 0)) &&
		typeof r.payloadHash === "string" && /^[a-f0-9]{64}$/.test(r.payloadHash) &&
		typeof r.text === "string" &&
			(persistedState === "pending" || persistedState === "attempting" || persistedState === "failed" || persistedState === "queued" || persistedState === "observed" || persistedState === "acknowledged" || persistedState === "fulfilled" || persistedState === "accepted" || persistedState === "delivered") &&
			Number.isSafeInteger(r.attempts) && (r.attempts ?? -1) >= 0 &&
		typeof r.createdAt === "number" && Number.isFinite(r.createdAt) &&
		typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) &&
		typeof r.lastAttemptAt === "number" && Number.isFinite(r.lastAttemptAt) &&
		(r.ownerPid === undefined || (Number.isSafeInteger(r.ownerPid) && r.ownerPid > 0)) &&
			(r.acknowledgementRequired === undefined || typeof r.acknowledgementRequired === "boolean") &&
			(r.ownerToken === undefined || (typeof r.ownerToken === "string" && r.ownerToken.length > 0)) &&
			(r.acknowledgedAt === undefined || (typeof r.acknowledgedAt === "number" && Number.isFinite(r.acknowledgedAt))) &&
			(r.acknowledgementNote === undefined || typeof r.acknowledgementNote === "string") &&
			(r.alarmRollup === undefined || (
				r.alarmRollup.version === 1 &&
				Number.isSafeInteger(r.alarmRollup.count) && r.alarmRollup.count > 0 &&
				typeof r.alarmRollup.firstAt === "number" && Number.isFinite(r.alarmRollup.firstAt) &&
				typeof r.alarmRollup.lastAt === "number" && Number.isFinite(r.alarmRollup.lastAt) &&
				typeof r.alarmRollup.latestAgentId === "string" && r.alarmRollup.latestAgentId.length > 0 &&
				typeof r.alarmRollup.latestRunId === "string" && r.alarmRollup.latestRunId.length > 0 &&
				typeof r.alarmRollup.digest === "string" && /^[a-f0-9]{64}$/.test(r.alarmRollup.digest)
			))
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
	private readonly maxUnacknowledgedAlarms: number;
	private readonly maxUnacknowledgedAlarmsPerAgent: number;
	private readonly alarmCapacityClaimId: string;

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
		this.maxUnacknowledgedAlarms = Math.max(1, options.maxUnacknowledgedAlarms ?? DEFAULT_MAX_UNACKNOWLEDGED_ALARMS);
		this.maxUnacknowledgedAlarmsPerAgent = Math.max(
			1,
			Math.min(
				options.maxUnacknowledgedAlarmsPerAgent ?? DEFAULT_MAX_UNACKNOWLEDGED_ALARMS_PER_AGENT,
				this.maxUnacknowledgedAlarms,
			),
		);
		this.alarmCapacityClaimId = sha256(`${this.routingKeyHash}\0alarm-capacity`);
	}

	static runId(): string {
		return `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
	}

	static routingDirectory(routingKey: string): string {
		return sha256(routingKey).slice(0, 24);
	}

	create(
		agentId: string,
		runId: string,
		text: string,
		identityNamespace?: string,
		acknowledgementRequired = false,
		formatAlarmText?: (alarmId: string) => string,
	): DeliveryObligation {
		// The default keeps existing worker-completion identities byte-for-byte stable.
		// Named host channels (for example Supervisor escalation) must not consume that
		// worker receipt merely because they share an agent/run coordinate.
		const id = sha256(identityNamespace
			? `${this.routingKeyHash}\0${identityNamespace}\0${agentId}\0${runId}`
			: `${this.routingKeyHash}\0${agentId}\0${runId}`);
		const existing = this.read(id);
		if (existing) {
			if (!acknowledgementRequired) return existing;
			if (existing.acknowledgementRequired && existing.state === "acknowledged") return existing;
		}
		if (acknowledgementRequired) {
			if (!this.acquireClaim(this.alarmCapacityClaimId)) {
				throw new Error("Boss alarm capacity is busy; use the stable volatile fallback.");
			}
			try {
				// Re-read inside the serialized capacity section: another process may have
				// created the exact row while this caller waited for the claim.
				const current = this.read(id);
				if (current?.acknowledgementRequired && current.state === "acknowledged") return current;
				const rows = this.readAll();
				const alarmId = current?.alarmId ?? this.nextAlarmId(agentId, rows);
				const alarmText = formatAlarmText ? formatAlarmText(alarmId) : text;
				const payloadHash = sha256(alarmText);
				if (current?.acknowledgementRequired) {
					if (current.alarmId === alarmId && current.text === alarmText && current.payloadHash === payloadHash) return current;
					const refreshed = { ...current, alarmId, text: alarmText, payloadHash, updatedAt: this.now() };
					this.write(refreshed);
					return refreshed;
				}
				const unacknowledged = rows.filter((row) =>
					row.acknowledgementRequired &&
					row.state !== "acknowledged" &&
					row.state !== "fulfilled" &&
					!row.alarmRollup);
				const perAgent = unacknowledged.filter((row) => row.agentId === agentId).length;
				// Reserve one durable row for the overflow rollup so the configured
				// global maximum is a true on-disk hard limit, not max+1.
				const exactGlobalLimit = Math.max(0, this.maxUnacknowledgedAlarms - 1);
				if (
					unacknowledged.length >= exactGlobalLimit ||
					perAgent >= this.maxUnacknowledgedAlarmsPerAgent
				) {
					return this.upsertAlarmOverflow({ agentId, runId, text, payloadHash: sha256(text) });
				}
				const now = this.now();
				if (current) {
					const upgraded: DeliveryObligation = {
						...current,
						alarmId,
						acknowledgementRequired: true,
						state: current.state === "fulfilled" ? "pending" : current.state,
						payloadHash,
						text: alarmText,
						updatedAt: now,
					};
					this.write(upgraded);
					this.prune(upgraded.id);
					return upgraded;
				}
				const record: DeliveryObligation = {
					version: 1,
					id,
					routingKeyHash: this.routingKeyHash,
					agentId,
					runId,
					alarmId,
					payloadHash,
					text: alarmText,
					state: "pending",
					attempts: 0,
					createdAt: now,
					updatedAt: now,
					lastAttemptAt: 0,
					acknowledgementRequired: true,
				};
				this.write(record);
				this.prune(id);
				return record;
			} finally {
				this.releaseClaim(this.alarmCapacityClaimId);
			}
		}
		const now = this.now();
		const payloadHash = sha256(text);
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
			acknowledgementRequired,
		};
		this.write(record);
		this.prune(id);
		return record;
	}

	private nextAlarmId(agentId: string, rows: DeliveryObligation[]): string {
		const prefix = `${agentId}.`;
		let generation = 0;
		for (const row of rows) {
			if (!row.alarmId?.startsWith(prefix)) continue;
			const candidate = Number(row.alarmId.slice(prefix.length));
			if (Number.isSafeInteger(candidate) && candidate > generation) generation = candidate;
		}
		return `${agentId}.${generation + 1}`;
	}

	private upsertAlarmOverflow(input: {
		agentId: string;
		runId: string;
		text: string;
		payloadHash: string;
	}): DeliveryObligation {
		const id = sha256(`${this.routingKeyHash}\0alarm-overflow`);
		const previous = this.read(id);
		const now = this.now();
		const activePrevious = previous?.state !== "acknowledged" ? previous?.alarmRollup : undefined;
		const priorDigest = activePrevious?.digest ?? sha256("alarm-overflow-v1");
		const rollup = {
			version: 1 as const,
			count: (activePrevious?.count ?? 0) + 1,
			firstAt: activePrevious?.firstAt ?? now,
			lastAt: now,
			latestAgentId: input.agentId,
			latestRunId: input.runId,
			digest: sha256(`${priorDigest}\0${input.agentId}\0${input.runId}\0${input.payloadHash}`),
		};
		const latest = (input.text.replace(/\0/gu, "").trim().split("\n")[0] ?? "").slice(0, 600);
		const text = [
			`[boss-alarm-overflow] ${rollup.count} terminal alarm(s) exceeded the exact-row capacity and were compacted into this durable rollup.`,
			`Latest compacted episode belonged to agentId=${input.agentId}. digest=${rollup.digest}.`,
			`Latest bounded alarm text: ${latest || "(empty)"}`,
			`Handle the overflow as one explicit episode, then call subagent_alarm_ack({alarmId:"${ALARM_OVERFLOW_ID}", note:"handled overflow rollup"}). This row remains on the 1m/2m/5m cadence until acknowledged.`,
		].join("\n");
		const row: DeliveryObligation = {
			version: 1,
			id,
			routingKeyHash: this.routingKeyHash,
			agentId: ALARM_OVERFLOW_AGENT_ID,
			runId: ALARM_OVERFLOW_RUN_ID,
			alarmId: ALARM_OVERFLOW_ID,
			payloadHash: sha256(text),
			text,
			state: "pending",
			attempts: activePrevious ? (previous?.attempts ?? 0) : 0,
			createdAt: activePrevious ? (previous?.createdAt ?? now) : now,
			updatedAt: now,
			lastAttemptAt: activePrevious ? (previous?.lastAttemptAt ?? 0) : 0,
			acknowledgementRequired: true,
			alarmRollup: rollup,
		};
		this.write(row);
		this.prune(id);
		return row;
	}

	beginAttempt(id: string): DeliveryObligation | undefined {
		if (!this.acquireClaim(id)) return undefined;
		const record = this.read(id);
		if (
			!record ||
			record.state === "acknowledged" ||
			record.state === "fulfilled" ||
			(!record.acknowledgementRequired && record.attempts >= this.maxAttempts)
		) {
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
		if (record.state === "acknowledged" || record.state === "fulfilled") return record;
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
		if (record.state === "acknowledged") return record;
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

	markAcknowledged(id: string, note?: string): DeliveryObligation | undefined {
		const record = this.read(id);
		if (!record || !record.acknowledgementRequired) return undefined;
		if (record.state === "acknowledged") return record;
		const normalizedNote = typeof note === "string"
			? note.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ").trim().replace(/\s+/gu, " ").slice(0, 500)
			: "";
		const now = this.now();
		const next: DeliveryObligation = {
			...record,
			state: "acknowledged",
			updatedAt: now,
			acknowledgedAt: now,
			...(normalizedNote ? { acknowledgementNote: normalizedNote } : {}),
			ownerPid: undefined,
			ownerToken: undefined,
		};
		this.write(next);
		this.releaseClaim(id);
		return next;
	}

	readAlarmEpisode(agentId: string, runId: string): DeliveryObligation | undefined {
		const matches = this.readAll().filter((record) =>
			record.acknowledgementRequired && record.agentId === agentId && record.runId === runId);
		return matches.find((record) => record.state !== "acknowledged") ?? matches[0];
	}

	readAlarm(alarmId: string): DeliveryObligation | undefined {
		return this.readAll().find((record) => record.acknowledgementRequired && record.alarmId === alarmId);
	}

	markAlarmEpisodeAcknowledged(agentId: string, runId: string, note?: string): DeliveryObligation[] {
		const matches = this.readAll().filter((record) =>
			record.acknowledgementRequired && record.agentId === agentId && record.runId === runId);
		return matches.flatMap((record) => {
			const acknowledged = this.markAcknowledged(record.id, note);
			return acknowledged ? [acknowledged] : [];
		});
	}

	markAlarmAcknowledged(alarmId: string, note?: string): DeliveryObligation[] {
		const record = this.readAlarm(alarmId);
		if (!record) return [];
		const acknowledged = this.markAcknowledged(record.id, note);
		return acknowledged ? [acknowledged] : [];
	}

	/** A persisted Boss assistant ended unsuccessfully; retry through normal bounded gates. */
	markRetryable(id: string): DeliveryObligation | undefined {
		const record = this.read(id);
		if (!record || record.state === "acknowledged" || record.state === "fulfilled") return record;
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
			if (record.state === "fulfilled" || record.state === "acknowledged") continue;
			if (!record.acknowledgementRequired && record.attempts >= this.maxAttempts) continue;
			if (!record.acknowledgementRequired && now - record.createdAt > this.maxAgeMs) continue;
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
				return { ...(parsed as DeliveryObligation), acknowledgementRequired: false, state: "queued" };
			}
			return {
				...parsed,
				acknowledgementRequired: parsed.acknowledgementRequired === true,
			};
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
			if (row.acknowledgementRequired && row.state !== "acknowledged") continue;
			const expired = now - row.createdAt > this.maxAgeMs;
			const fulfilledExpired = (row.state === "fulfilled" || row.state === "acknowledged") && now - row.updatedAt > this.deliveredRetentionMs;
			// Exhausted failures remain as bounded tombstones until age/cap pruning. Removing
			// them immediately would let a duplicate terminal callback recreate the same run
			// and silently reset its retry budget.
			if (expired || fulfilledExpired) this.removeRow(row.id);
		}
		rows = this.readAll().sort((a, b) => b.updatedAt - a.updatedAt);
		const keep = new Set<string>();
		if (protectedId && rows.some((row) => row.id === protectedId)) keep.add(protectedId);
		for (const row of rows) if (this.attemptIsLiveRecent(row)) keep.add(row.id);
		// Explicit-ack alarms are loss-intolerant. Their count may exceed the legacy
		// row cap until the Boss acknowledges exact episodes.
		for (const row of rows) {
			if (row.acknowledgementRequired && row.state !== "acknowledged") keep.add(row.id);
		}
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
