/**
 * Supervisor session runtime (S2).
 *
 * Host-owned AgentSession lifecycle for one supervision epoch. This module
 * never imports Pi `createAgentSession` or Boss history — S4 injects that
 * adapter. Tests inject fakes.
 */

import path from "node:path";

import { isProviderQualifiedModelRef } from "../model-ref.ts";
import {
	createSupervisorDecision,
	type SupervisorDecision,
	type SupervisorInputPacket,
	type SupervisorJobSnapshot,
	type SupervisorTaskSnapshot,
	type SupervisorWaveSnapshot,
} from "./contract.ts";
import type { SupervisorSessionPort } from "./route.ts";

export const SUPERVISOR_THINKING_LEVEL = "off" as const;
export const SUPERVISOR_NO_TOOLS = "all" as const;

const ACTIVE_JOB_STATUSES = new Set<SupervisorJobSnapshot["status"]>([
	"running",
	"stalled",
	"waiting",
]);

export const SUPERVISOR_SYSTEM_PROMPT = [
	"You are the host-owned PipiUI Supervisor for one supervision epoch.",
	"You are not the Boss and not a worker.",
	"Input is only a compact S1 JSON packet: event identity, job/task snapshots, newest event summary, optional prior action.",
	"You never receive Boss or worker transcripts, messages, or findings. Do not request or invent them.",
	"You have no shell, filesystem, web, secrets, or other tools. Decide from the packet only.",
	"Reply with one JSON object and nothing else:",
	'{"action":"status|wait|abort|resolve|start_declared|forward|escalate","reason":"short","recommendedAction":"optional","taskId":"optional","evidenceRefs":["optional"]}',
	"action is required and must be one of those values. start_declared must name an already-declared taskId.",
	"Keep the object bounded. Never include transcript, messages, or findings fields.",
	"Successful worker completions default to forward: give Boss the result now so it can start follow-up work while siblings still run.",
	"Use wait on a successful completion only when Boss cannot act until sibling results arrive (must-compare designs, joint acceptance).",
	"Never wait on a failed, interrupted, or verify-failed completion; forward or escalate it immediately.",
	"escalate only for plan changes, user decisions, repeated stalls, verify/merge failures, or safety issues.",
	"resume and retry are not self-service production actions; escalate with evidence when either would be needed.",
	"For escalation, state the failure cause, safe management actions attempted or why they are unavailable, and the next action the Boss should take.",
	"Otherwise prefer forward, status, bounded abort/resolve, or start_declared.",
	"watch events are periodic bounded samples of one subscribed run; unchanged state never emits one, and terminal results still arrive as completion events.",
	"For watch, ordinary progress stays silent with wait or status; forward only important progress the Boss should see now, and escalate abnormal activity, stall-like quiet, or verify/finalization trouble.",
].join("\n");

export const DEFAULT_SUPERVISOR_PROMPT_TIMEOUT_MS = 60_000;

export type SupervisorSessionErrorCode =
	| "invalid_config"
	| "no_active_workers"
	| "no_model"
	| "unqualified_model"
	| "create_failed"
	| "prompt_failed"
	| "prompt_timeout"
	| "dispose_failed";

export class SupervisorSessionRuntimeError extends Error {
	readonly name = "SupervisorSessionRuntimeError";
	readonly code: SupervisorSessionErrorCode;
	override readonly cause?: unknown;

	constructor(code: SupervisorSessionErrorCode, message: string, cause?: unknown) {
		super(message, cause !== undefined ? { cause } : undefined);
		this.code = code;
		this.cause = cause;
	}
}

export interface SupervisorModelSources {
	/** Explicit Supervisor override (`provider/id`). */
	supervisor?: string;
	/** Configured general-purpose subagent model (`provider/id`). */
	generalPurpose?: string;
	/** Boss provider/model fallback (`provider/id`). */
	boss?: string;
}

export interface SupervisorResolvedModel {
	model: string;
	thinkingLevel: typeof SUPERVISOR_THINKING_LEVEL;
	source: "supervisor" | "generalPurpose" | "boss";
}

/**
 * Narrow create payload for the production Pi adapter.
 * S4 should pass these through to `createAgentSession` plus
 * `SessionManager.create(projectScopedPath)` and must not load Boss history.
 */
export interface SupervisorPiCreateOptions {
	cwd: string;
	projectScopedPath: string;
	model: string;
	thinkingLevel: typeof SUPERVISOR_THINKING_LEVEL;
	tools: readonly [];
	customTools: readonly [];
	noTools: typeof SUPERVISOR_NO_TOOLS;
	systemPrompt: string;
	epochGeneration: number;
}

export interface SupervisorPiSessionHandle {
	prompt(text: string): Promise<string>;
	dispose(): void | Promise<void>;
	abort?(): void | Promise<void>;
	readonly sessionId?: string;
	readonly sessionFile?: string;
}

export interface SupervisorPiSessionFactory {
	create(options: SupervisorPiCreateOptions): Promise<SupervisorPiSessionHandle>;
}

export interface SupervisorSessionRuntimeOptions {
	projectRoot: string;
	factory: SupervisorPiSessionFactory;
	/** Resolved only when a new epoch creates its AgentSession. */
	models?: SupervisorModelSources | (() => SupervisorModelSources);
	/** Defaults to `{projectRoot}/.pi/agent/supervisor`. */
	projectScopedPath?: string;
	/** Per-prompt bound; a timed-out epoch is aborted and discarded. */
	promptTimeoutMs?: number;
}

export interface SupervisorSessionRuntime extends SupervisorSessionPort {
	readonly activeWorkerCount: number;
	readonly isSessionOpen: boolean;
	readonly epochGeneration: number;
	readonly sessionCreateCount: number;
	readonly providerRequestCount: number;
	readonly disposeCount: number;
	setActiveWorkerCount(count: number): Promise<void>;
	dispose(): Promise<void>;
}

export function supervisorProjectScopedPath(projectRoot: string): string {
	return path.join(projectRoot, ".pi", "agent", "supervisor");
}

export function countActiveSupervisorJobs(jobs: readonly SupervisorJobSnapshot[]): number {
	let count = 0;
	for (const job of jobs) {
		if (ACTIVE_JOB_STATUSES.has(job.status)) count += 1;
	}
	return count;
}

export function isAbnormalTerminalSupervisorPacket(packet: SupervisorInputPacket): boolean {
	if (countActiveSupervisorJobs(packet.activeJobs) > 0) return false;
	const event = packet.event;
	if (event.wave?.running && event.wave.running > 0) return false;
	return (event.wave?.failed ?? 0) > 0
		|| event.job.status === "failed"
		|| event.job.status === "interrupted"
		|| event.job.verify === "failed";
}

export function resolveSupervisorModelRef(sources: SupervisorModelSources = {}): SupervisorResolvedModel {
	const candidates = [
		{ source: "supervisor" as const, value: sources.supervisor },
		{ source: "generalPurpose" as const, value: sources.generalPurpose },
		{ source: "boss" as const, value: sources.boss },
	];
	for (const candidate of candidates) {
		const ref = typeof candidate.value === "string" ? candidate.value.trim() : "";
		if (!ref) continue;
		if (!isProviderQualifiedModelRef(ref)) {
			throw new SupervisorSessionRuntimeError(
				"unqualified_model",
				`Supervisor model ${candidate.source} "${ref}" is not provider-qualified`,
			);
		}
		return { model: ref, thinkingLevel: SUPERVISOR_THINKING_LEVEL, source: candidate.source };
	}
	throw new SupervisorSessionRuntimeError(
		"no_model",
		"Supervisor has no provider-qualified model (override, general-purpose, or Boss fallback)",
	);
}

export function serializeSupervisorInputPacket(packet: SupervisorInputPacket): string {
	return JSON.stringify({
		event: {
			identity: {
				eventId: packet.event.identity.eventId,
				agentId: packet.event.identity.agentId,
				runId: packet.event.identity.runId,
				kind: packet.event.identity.kind,
				sequence: packet.event.identity.sequence,
				...(packet.event.identity.waveId !== undefined ? { waveId: packet.event.identity.waveId } : {}),
			},
			occurredAt: packet.event.occurredAt,
			job: compactJob(packet.event.job),
			summary: packet.event.summary,
			...(packet.event.task ? { task: compactTask(packet.event.task) } : {}),
			...(packet.event.wave ? { wave: compactWave(packet.event.wave) } : {}),
			...(packet.event.evidenceRefs ? { evidenceRefs: [...packet.event.evidenceRefs] } : {}),
		},
		activeJobs: packet.activeJobs.map(compactJob),
		tasks: packet.tasks.map(compactTask),
		...(packet.priorAction
			? {
					priorAction: {
						kind: packet.priorAction.kind,
						...(packet.priorAction.agentId !== undefined ? { agentId: packet.priorAction.agentId } : {}),
						...(packet.priorAction.runId !== undefined ? { runId: packet.priorAction.runId } : {}),
						...(packet.priorAction.taskId !== undefined ? { taskId: packet.priorAction.taskId } : {}),
						...(packet.priorAction.reason !== undefined ? { reason: packet.priorAction.reason } : {}),
					},
				}
			: {}),
	});
}

export function createSupervisorSessionRuntime(
	options: SupervisorSessionRuntimeOptions,
): SupervisorSessionRuntime {
	const projectRoot = options.projectRoot?.trim() ?? "";
	if (!projectRoot) {
		throw new SupervisorSessionRuntimeError("invalid_config", "Supervisor projectRoot is required");
	}
	if (!options.factory || typeof options.factory.create !== "function") {
		throw new SupervisorSessionRuntimeError("invalid_config", "Supervisor session factory is required");
	}

	const factory = options.factory;
	const modelSource = options.models ?? {};
	const projectScopedPath = (options.projectScopedPath?.trim() || supervisorProjectScopedPath(projectRoot));
	const promptTimeoutMs = Number.isFinite(options.promptTimeoutMs) && (options.promptTimeoutMs ?? 0) > 0
		? Math.floor(options.promptTimeoutMs!)
		: DEFAULT_SUPERVISOR_PROMPT_TIMEOUT_MS;

	let activeWorkerCount = 0;
	let handle: SupervisorPiSessionHandle | null = null;
	let epochGeneration = 0;
	let sessionCreateCount = 0;
	let providerRequestCount = 0;
	let disposeCount = 0;
	let tail: Promise<void> = Promise.resolve();

	function enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = tail.then(work, work);
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async function disposeOpenSession(): Promise<void> {
		const open = handle;
		handle = null;
		if (!open) return;
		try {
			await open.dispose();
		} catch (error) {
			throw wrapRuntimeError("dispose_failed", "Supervisor session dispose failed", error);
		}
		disposeCount += 1;
	}

	async function ensureSession(): Promise<SupervisorPiSessionHandle> {
		if (handle) return handle;
		const resolved = resolveSupervisorModelRef(
			typeof modelSource === "function" ? modelSource() : modelSource,
		);
		const nextEpoch = epochGeneration + 1;
		const createOptions: SupervisorPiCreateOptions = {
			cwd: projectRoot,
			projectScopedPath,
			model: resolved.model,
			thinkingLevel: SUPERVISOR_THINKING_LEVEL,
			tools: [],
			customTools: [],
			noTools: SUPERVISOR_NO_TOOLS,
			systemPrompt: SUPERVISOR_SYSTEM_PROMPT,
			epochGeneration: nextEpoch,
		};
		let created: SupervisorPiSessionHandle;
		try {
			created = await factory.create(createOptions);
		} catch (error) {
			throw wrapRuntimeError("create_failed", "Supervisor session creation failed", error);
		}
		handle = created;
		epochGeneration = nextEpoch;
		sessionCreateCount += 1;
		return created;
	}

	async function promptExclusive(packet: SupervisorInputPacket): Promise<SupervisorDecision> {
		const packetActive = countActiveSupervisorJobs(packet.activeJobs);
		const oneShotAbnormalTerminal = activeWorkerCount <= 0
			&& packetActive <= 0
			&& isAbnormalTerminalSupervisorPacket(packet);
		if (!handle && activeWorkerCount <= 0 && packetActive <= 0 && !oneShotAbnormalTerminal) {
			throw new SupervisorSessionRuntimeError(
				"no_active_workers",
				"Supervisor session is not created while no workers are active",
			);
		}

		const session = await ensureSession();
		const userPrompt = serializeSupervisorInputPacket(packet);
		providerRequestCount += 1;
		let text: string;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			text = await Promise.race([
				session.prompt(userPrompt),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new SupervisorSessionRuntimeError(
						"prompt_timeout",
						`Supervisor session prompt timed out after ${promptTimeoutMs}ms`,
					)), promptTimeoutMs);
				}),
			]);
		} catch (error) {
			if (error instanceof SupervisorSessionRuntimeError && error.code === "prompt_timeout") {
				if (handle === session) handle = null;
				try {
					void Promise.resolve(session.abort?.()).catch(() => undefined);
				} catch {
					// Best effort: a timed-out provider must not keep the runtime queue blocked.
				}
				try {
					void Promise.resolve(session.dispose()).then(
						() => { disposeCount += 1; },
						() => undefined,
					);
				} catch {
					// Best effort: detach the poisoned epoch even if disposal itself throws.
				}
				throw error;
			}
			if (oneShotAbnormalTerminal && handle === session) {
				await disposeOpenSession();
			}
			throw wrapRuntimeError("prompt_failed", "Supervisor session prompt failed", error);
		} finally {
			if (timeout) clearTimeout(timeout);
		}

		try {
			return parseSupervisorDecisionText(text);
		} finally {
			if (oneShotAbnormalTerminal && handle === session) {
				await disposeOpenSession();
			}
		}
	}

	return {
		get activeWorkerCount() {
			return activeWorkerCount;
		},
		get isSessionOpen() {
			return handle !== null;
		},
		get epochGeneration() {
			return epochGeneration;
		},
		get sessionCreateCount() {
			return sessionCreateCount;
		},
		get providerRequestCount() {
			return providerRequestCount;
		},
		get disposeCount() {
			return disposeCount;
		},
		setActiveWorkerCount(count: number) {
			const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
			activeWorkerCount = next;
			if (next > 0) return Promise.resolve();
			return enqueue(async () => {
				if (activeWorkerCount === 0) await disposeOpenSession();
			});
		},
		prompt(packet) {
			return enqueue(() => promptExclusive(packet));
		},
		dispose() {
			return enqueue(() => disposeOpenSession());
		},
	};
}

function compactJob(job: SupervisorJobSnapshot): SupervisorJobSnapshot {
	return {
		agentId: job.agentId,
		runId: job.runId,
		status: job.status,
		...(job.title !== undefined ? { title: job.title } : {}),
		...(job.elapsedMs !== undefined ? { elapsedMs: job.elapsedMs } : {}),
		...(job.lastActivityAt !== undefined ? { lastActivityAt: job.lastActivityAt } : {}),
		...(job.verify !== undefined ? { verify: job.verify } : {}),
	};
}

function compactTask(task: SupervisorTaskSnapshot): SupervisorTaskSnapshot {
	return {
		taskId: task.taskId,
		title: task.title,
		status: task.status,
		...(task.blockedBy ? { blockedBy: [...task.blockedBy] } : {}),
	};
}

function compactWave(wave: SupervisorWaveSnapshot): SupervisorWaveSnapshot {
	return {
		waveId: wave.waveId,
		running: wave.running,
		completed: wave.completed,
		failed: wave.failed,
		agentIds: [...wave.agentIds],
	};
}

function parseSupervisorDecisionText(text: string): SupervisorDecision {
	let parsed: unknown;
	try {
		parsed = extractJsonObject(text);
	} catch (error) {
		throw wrapRuntimeError("prompt_failed", "Supervisor reply was not bounded JSON", error);
	}
	const decision = createSupervisorDecision(parsed);
	if (decision.ok === false) {
		throw new SupervisorSessionRuntimeError("prompt_failed", decision.error);
	}
	return decision.value;
}

function extractJsonObject(text: string): unknown {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start < 0 || end <= start) {
			throw new SupervisorSessionRuntimeError("prompt_failed", "Supervisor reply was not bounded JSON");
		}
		return JSON.parse(trimmed.slice(start, end + 1));
	}
}

function wrapRuntimeError(
	code: SupervisorSessionErrorCode,
	message: string,
	error: unknown,
): SupervisorSessionRuntimeError {
	if (error instanceof SupervisorSessionRuntimeError) return error;
	const detail = error instanceof Error ? error.message : String(error);
	return new SupervisorSessionRuntimeError(code, `${message}: ${detail}`, error);
}
