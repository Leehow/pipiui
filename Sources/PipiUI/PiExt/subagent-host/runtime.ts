/**
 * Framework-agnostic host-side projection facade v1.
 *
 * This composes the portable bridge, projection reducers, persistence, and the
 * optional worktree service without becoming a second subagent scheduler. The
 * Pi extension remains the authority for dispatch, resume, abort, and process
 * lifecycle; this module only accepts observations and emits display state.
 */

import {
	decodeAgentEventV1,
	decodeJobsSnapshotV1,
	decodePlanEventV1,
	type AgentEventV1,
	type JobsSnapshotV1,
	type JsonValue,
	type PlanEventV1,
	type PlanRevisionResponseV1,
	type ProtocolDiagnostic,
} from "./contract.ts";
import {
	createSubagentHostServerV1,
	type HandlerTimeoutsV1,
	type HostActionHandlersV1,
	type HostHandlerResultV1,
	type SubagentHostServerV1,
} from "./server.ts";
import {
	agentRunKeyV1,
	applyAgentEventV1,
	applyPlanEventV1,
	createAgentProjectionStateV1,
	createPlanStateV1,
	loadAgentProjectionStateV1,
	loadPlanStateV1,
	loadVersionedStateV1,
	reconcileJobsSnapshotV1,
	saveAgentProjectionStateV1,
	savePlanStateV1,
	saveVersionedStateV1,
	selectJobsSnapshotV1,
	type AgentProjectionLoadOptionsV1,
	type AgentProjectionLoadResultV1,
	type AgentProjectionReduceOptionsV1,
	type AgentProjectionStateV1,
	type AgentRunProjectionV1,
	type JobsSnapshotSelectorOptionsV1,
	type PlanSnapshotV1,
	type PlanStateV1,
	type PortableStateLoadResultV1,
	type PortableStateSaveResultV1,
	type PortableStateStorageAdapterV1,
	type VersionedStateCodecV1,
} from "./state/index.ts";
import {
	decodeWorktreeFinalizationStateV1,
	WorktreeFinalizationServiceV1,
	type WorktreeFinalizationInputV1,
	type WorktreeFinalizationStateV1,
	type WorktreeOwnershipV1,
	type WorktreeTerminalStateV1,
	type WorktreeVerifyMetadataV1,
} from "./worktree/index.ts";

export const SUBAGENT_HOST_RUNTIME_VERSION = 1 as const;
export const DEFAULT_RUNTIME_CALLBACK_TIMEOUT_MS = 5_000;
export const DEFAULT_RUNTIME_MAX_SUBSCRIBERS = 32;

export type SubagentHostRuntimeClockV1 = {
	now(): Date;
};

export type SubagentHostRuntimePersistenceV1 = {
	/** All storage and paths are caller-owned; no default app-data location is derived. */
	storage: PortableStateStorageAdapterV1;
	agentProjectionPath: string;
	planPath: string;
	/** Required only when automatic worktree finalization is explicitly enabled. */
	worktreeFinalizationsPath?: string;
};

export type SubagentHostRuntimeCommandHandlersV1 = Pick<
	HostActionHandlersV1,
	"onAbort" | "onRecover" | "onPrompt" | "onPlatform"
>;

export type DisabledWorktreeFinalizationRuntimeConfigV1 = {
	enabled?: false;
};

export type EnabledWorktreeFinalizationRuntimeConfigV1 = {
	/** Explicit opt-in. Omitting this config, or setting false, never invokes Git. */
	enabled: true;
	/** Host-owned main checkout. The reducer never derives this from a worker event. */
	mainCwd: string;
	/** Agent/run identities are filled from the terminal projection, never caller input. */
	ownership: Pick<WorktreeOwnershipV1, "mode" | "role">;
	/** Defaults to the audited portable service only after enabled:true was supplied. */
	service?: WorktreeFinalizationServiceV1;
	/**
	 * Optional host-owned verification metadata. A string command remains display
	 * only unless argv is supplied; the worktree service never shells it.
	 */
	verify?: (run: Readonly<AgentRunProjectionV1>) => WorktreeVerifyMetadataV1 | undefined;
};

export type WorktreeFinalizationRuntimeConfigV1 =
	| DisabledWorktreeFinalizationRuntimeConfigV1
	| EnabledWorktreeFinalizationRuntimeConfigV1;

export type WorktreeFinalizationRegistryV1 = {
	schemaVersion: 1;
	recordsByRunKey: Record<string, WorktreeFinalizationStateV1>;
};

export type JobsSnapshotNotificationV1 = {
	schemaVersion: 1;
	source: "load" | "agent_event" | "extension_snapshot";
	snapshot: JobsSnapshotV1;
	/** Host-only correlation; display consumers should render snapshot only. */
	event?: Pick<AgentEventV1, "kind" | "agentId" | "runId">;
};

export type PlanProjectionNotificationV1 = {
	schemaVersion: 1;
	source: "load" | "plan_event";
	plan?: PlanSnapshotV1;
	response?: PlanRevisionResponseV1;
	event?: PlanEventV1;
};

export type WorktreeFinalizationNotificationV1 = {
	schemaVersion: 1;
	state: WorktreeFinalizationStateV1;
	persisted: boolean;
};

export type SubagentHostRuntimeErrorV1 = {
	schemaVersion: 1;
	stage: "load" | "agent_event" | "plan_event" | "snapshot" | "worktree_finalization" | "callback";
	code: string;
	message: string;
	agentId?: string;
	runId?: string;
};

/**
 * Subscriber payloads are serialized copies. UI code should consume onJobsSnapshot
 * rather than reducer rows, logs, or internal state maps.
 */
export type SubagentHostRuntimeCallbacksV1 = {
	onJobsSnapshot?: (notification: JobsSnapshotNotificationV1) => Promise<void> | void;
	onPlan?: (notification: PlanProjectionNotificationV1) => Promise<void> | void;
	onWorktreeFinalization?: (notification: WorktreeFinalizationNotificationV1) => Promise<void> | void;
	onError?: (error: SubagentHostRuntimeErrorV1) => Promise<void> | void;
};

export type SubagentHostRuntimeOptionsV1 = {
	sessionCapability: string;
	persistence: SubagentHostRuntimePersistenceV1;
	/** Scheduler/process commands remain explicit host callbacks; this facade adds none. */
	commands?: SubagentHostRuntimeCommandHandlersV1;
	callbacks?: SubagentHostRuntimeCallbacksV1;
	callbackTimeoutMs?: number;
	maxSubscribers?: number;
	clock?: SubagentHostRuntimeClockV1;
	/** Passed to the reference bridge. All bridge callbacks remain FIFO and bounded. */
	maxBodyBytes?: number;
	maxQueue?: number;
	handlerTimeoutMs?: number;
	handlerTimeouts?: HandlerTimeoutsV1;
	agentProjection?: Pick<AgentProjectionLoadOptionsV1, "maxLogs" | "reconcileRunning">;
	worktreeFinalization?: WorktreeFinalizationRuntimeConfigV1;
};

export type SubagentHostRuntimeStartOptionsV1 = {
	port?: number;
	host?: "127.0.0.1" | "::1";
	/** Defaults to true. Loading is pure projection reconciliation, never recovery/dispatch. */
	load?: boolean;
};

export type SubagentHostRuntimeStartResultV1 = {
	schemaVersion: 1;
	port: number;
	host: "127.0.0.1" | "::1";
};

export type SubagentHostRuntimeLoadResultV1 = {
	schemaVersion: 1;
	agents: AgentProjectionLoadResultV1;
	plan: PortableStateLoadResultV1<PlanStateV1>;
	worktreeFinalizations?: PortableStateLoadResultV1<WorktreeFinalizationRegistryV1>;
	snapshot: JobsSnapshotV1;
};

export type ApplyAgentEventRuntimeResultV1 = {
	schemaVersion: 1;
	ok: boolean;
	accepted: boolean;
	applied: boolean;
	diagnostics: ProtocolDiagnostic[];
	snapshot: JobsSnapshotV1;
	agentId?: string;
	runId?: string;
	finalization?: WorktreeFinalizationStateV1;
};

export type ApplyPlanEventRuntimeResultV1 = {
	schemaVersion: 1;
	response: PlanRevisionResponseV1;
	diagnostics: ProtocolDiagnostic[];
};

export type ApplyExtensionSnapshotRuntimeResultV1 = {
	schemaVersion: 1;
	ok: boolean;
	applied: boolean;
	diagnostics: ProtocolDiagnostic[];
	snapshot: JobsSnapshotV1;
};

export type SubagentHostRuntimeV1 = {
	start(options?: SubagentHostRuntimeStartOptionsV1): Promise<SubagentHostRuntimeStartResultV1>;
	stop(): Promise<void>;
	load(): Promise<SubagentHostRuntimeLoadResultV1>;
	/** Display-only projection. It never starts, resumes, aborts, or kills a worker. */
	snapshot(options?: JobsSnapshotSelectorOptionsV1): JobsSnapshotV1;
	planSnapshot(): PlanSnapshotV1 | undefined;
	applyAgentEvent(raw: unknown): Promise<ApplyAgentEventRuntimeResultV1>;
	applyPlanEvent(raw: unknown): Promise<ApplyPlanEventRuntimeResultV1>;
	/** Apply an extension-authoritative reconnect view to the display projection only. */
	applyExtensionSnapshot(raw: unknown): Promise<ApplyExtensionSnapshotRuntimeResultV1>;
	subscribe(callbacks: SubagentHostRuntimeCallbacksV1): () => void;
};

type CallbackIssue = {
	code: "callback_failed" | "callback_timeout";
	message: string;
};

type FinalizationAttempt = {
	state?: WorktreeFinalizationStateV1;
	diagnostics: ProtocolDiagnostic[];
};

const systemClock: SubagentHostRuntimeClockV1 = { now: () => new Date() };

function emptyRecord<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function positiveInteger(value: number | undefined, fallback: number, name: string, maximum = 5 * 60_000): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
		throw new Error(`${name} must be a positive safe integer no greater than ${maximum}`);
	}
	return selected;
}

function requiredPath(value: string, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty caller-injected path`);
	return value;
}

function nowFrom(clock: SubagentHostRuntimeClockV1): Date {
	try {
		const value = clock.now();
		if (value instanceof Date && Number.isFinite(value.getTime())) return value;
	} catch {
		// A broken injected clock must not prevent an observation from being persisted.
	}
	return new Date();
}

function diagnosticsForCallbackIssues(issues: readonly CallbackIssue[]): ProtocolDiagnostic[] {
	return issues.map((issue) => ({
		code: issue.code,
		path: "$",
		message: issue.message,
		severity: "warning" as const,
	}));
}

function persistenceDiagnostic(scope: string, result: Exclude<PortableStateSaveResultV1, { ok: true }>): ProtocolDiagnostic {
	return {
		code: "persistence_failed",
		path: "$",
		message: `${scope} persistence failed (${result.reason})${result.error ? `: ${result.error}` : ""}`,
		severity: "error",
	};
}

function planPersistenceFailure(state: PlanStateV1, save: Exclude<PortableStateSaveResultV1, { ok: true }>): PlanRevisionResponseV1 {
	return {
		schemaVersion: 1,
		ok: false,
		applied: false,
		...(state.plan ? { currentRevision: state.plan.revision } : {}),
		error: `plan persistence failed (${save.reason})${save.error ? `: ${save.error}` : ""}`,
	};
}

function createWorktreeFinalizationRegistryV1(): WorktreeFinalizationRegistryV1 {
	return { schemaVersion: 1, recordsByRunKey: emptyRecord<WorktreeFinalizationStateV1>() };
}

function decodeWorktreeFinalizationRegistryV1(raw: unknown): { ok: true; value: WorktreeFinalizationRegistryV1 } | { ok: false; error: string } {
	if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.recordsByRunKey)) {
		return { ok: false, error: "invalid WorktreeFinalizationRegistryV1 envelope" };
	}
	const recordsByRunKey = emptyRecord<WorktreeFinalizationStateV1>();
	for (const [key, value] of Object.entries(raw.recordsByRunKey)) {
		const decoded = decodeWorktreeFinalizationStateV1(value);
		if (!decoded.ok) return { ok: false, error: `invalid worktree finalization record ${JSON.stringify(key)}` };
		if (agentRunKeyV1(decoded.value.input.agentId, decoded.value.input.runId) !== key) {
			return { ok: false, error: `worktree finalization key ${JSON.stringify(key)} does not match its input identity` };
		}
		recordsByRunKey[key] = decoded.value;
	}
	return { ok: true, value: { schemaVersion: 1, recordsByRunKey } };
}

const worktreeFinalizationRegistryCodecV1: VersionedStateCodecV1<WorktreeFinalizationRegistryV1> = {
	schemaVersion: 1,
	createEmpty: createWorktreeFinalizationRegistryV1,
	decode: decodeWorktreeFinalizationRegistryV1,
	encode: (state) => state,
};

function finalTerminalState(run: AgentRunProjectionV1): WorktreeTerminalStateV1 | undefined {
	switch (run.state) {
		case "ok": return "ok";
		case "failed": return "failed";
		case "aborted": return "aborted";
		case "interrupted": return "interrupted";
		case "running": return undefined;
	}
}

function mergeVerification(
	run: AgentRunProjectionV1,
	override: WorktreeVerifyMetadataV1 | undefined,
): WorktreeVerifyMetadataV1 | undefined {
	const base: WorktreeVerifyMetadataV1 = {
		...(run.verify.command ? { command: run.verify.command } : {}),
		...(run.verify.exit !== undefined ? { exitCode: run.verify.exit } : {}),
	};
	const merged: WorktreeVerifyMetadataV1 = { ...base, ...(override ?? {}) };
	return Object.keys(merged).length > 0 ? merged : undefined;
}

function enabledFinalization(
	config: WorktreeFinalizationRuntimeConfigV1 | undefined,
): config is EnabledWorktreeFinalizationRuntimeConfigV1 {
	return config?.enabled === true;
}

/**
 * Create the reusable Node/Electron-main facade. It intentionally creates no
 * process and selects no storage path; callers own both decisions.
 */
export function createSubagentHostRuntimeV1(options: SubagentHostRuntimeOptionsV1): SubagentHostRuntimeV1 {
	return new SubagentHostRuntime(options);
}

class SubagentHostRuntime implements SubagentHostRuntimeV1 {
	private readonly persistence: SubagentHostRuntimePersistenceV1;
	private readonly clock: SubagentHostRuntimeClockV1;
	private readonly callbackTimeoutMs: number;
	private readonly maxSubscribers: number;
	private readonly agentOptions: Pick<AgentProjectionLoadOptionsV1, "maxLogs" | "reconcileRunning">;
	private readonly finalizationConfig?: EnabledWorktreeFinalizationRuntimeConfigV1;
	private readonly finalizationService?: WorktreeFinalizationServiceV1;
	private readonly subscribers = new Set<SubagentHostRuntimeCallbacksV1>();
	private readonly bridge: SubagentHostServerV1;
	private queue: Promise<void> = Promise.resolve();
	/** Separate lifecycle serialization prevents concurrent listen/close races. */
	private lifecycle: Promise<void> = Promise.resolve();
	private agentState = createAgentProjectionStateV1();
	private planState = createPlanStateV1();
	private finalizationRegistry = createWorktreeFinalizationRegistryV1();
	private agentWritable = true;
	private planWritable = true;
	private finalizationWritable = true;
	private loaded = false;
	private listening?: SubagentHostRuntimeStartResultV1;

	constructor(options: SubagentHostRuntimeOptionsV1) {
		if (typeof options.sessionCapability !== "string" || options.sessionCapability.length < 16) {
			throw new Error("sessionCapability must be an opaque string of at least 16 characters");
		}
		this.persistence = {
			storage: options.persistence.storage,
			agentProjectionPath: requiredPath(options.persistence.agentProjectionPath, "agentProjectionPath"),
			planPath: requiredPath(options.persistence.planPath, "planPath"),
			...(options.persistence.worktreeFinalizationsPath
				? { worktreeFinalizationsPath: requiredPath(options.persistence.worktreeFinalizationsPath, "worktreeFinalizationsPath") }
				: {}),
		};
		this.clock = options.clock ?? systemClock;
		this.callbackTimeoutMs = positiveInteger(
			options.callbackTimeoutMs,
			DEFAULT_RUNTIME_CALLBACK_TIMEOUT_MS,
			"callbackTimeoutMs",
		);
		this.maxSubscribers = positiveInteger(options.maxSubscribers, DEFAULT_RUNTIME_MAX_SUBSCRIBERS, "maxSubscribers", 256);
		this.agentOptions = options.agentProjection ?? {};
		if (enabledFinalization(options.worktreeFinalization)) {
			if (!this.persistence.worktreeFinalizationsPath) {
				throw new Error("worktreeFinalizationsPath is required when worktreeFinalization.enabled is true");
			}
			if (typeof options.worktreeFinalization.mainCwd !== "string" || !options.worktreeFinalization.mainCwd.trim()) {
				throw new Error("worktreeFinalization.mainCwd must be an explicit non-empty host path");
			}
			this.finalizationConfig = options.worktreeFinalization;
			this.finalizationService = options.worktreeFinalization.service ?? new WorktreeFinalizationServiceV1();
		}
		if (options.callbacks) this.subscribers.add(options.callbacks);

		const handlerTimeouts: HandlerTimeoutsV1 = { ...(options.handlerTimeouts ?? {}) };
		// An explicit automatic finalization may include bounded Git/verify work. Keep
		// the bridge admission open long enough for that opt-in work, while the service
		// itself still bounds every spawned child and Git operation.
		if (this.finalizationConfig && handlerTimeouts.agent_event === undefined && options.handlerTimeoutMs === undefined) {
			handlerTimeouts.agent_event = 5 * 60_000;
		}
		this.bridge = createSubagentHostServerV1({
			sessionCapability: options.sessionCapability,
			maxBodyBytes: options.maxBodyBytes,
			maxQueue: options.maxQueue,
			handlerTimeoutMs: options.handlerTimeoutMs,
			handlerTimeouts,
			handlers: {
				onAgentEvent: (event) => this.agentBridgeHandler(event),
				onPlanEvent: (event) => this.planBridgeHandler(event),
				onSnapshot: () => this.snapshot(),
				...(options.commands?.onAbort ? { onAbort: options.commands.onAbort } : {}),
				...(options.commands?.onRecover ? { onRecover: options.commands.onRecover } : {}),
				...(options.commands?.onPrompt ? { onPrompt: options.commands.onPrompt } : {}),
				...(options.commands?.onPlatform ? { onPlatform: options.commands.onPlatform } : {}),
			},
		});
	}

	start(options: SubagentHostRuntimeStartOptionsV1 = {}): Promise<SubagentHostRuntimeStartResultV1> {
		return this.enqueueLifecycle(async () => {
			if (options.load !== false && !this.loaded) await this.load();
			if (this.listening) return { ...this.listening };
			const host = options.host ?? "127.0.0.1";
			const listening = await this.bridge.listen(options.port ?? 0, host);
			this.listening = { schemaVersion: 1, port: listening.port, host };
			return { ...this.listening };
		});
	}

	stop(): Promise<void> {
		return this.enqueueLifecycle(async () => {
			if (!this.listening) return;
			await this.bridge.close();
			this.listening = undefined;
		});
	}

	load(): Promise<SubagentHostRuntimeLoadResultV1> {
		return this.enqueue(() => this.loadLocked());
	}

	snapshot(options: JobsSnapshotSelectorOptionsV1 = {}): JobsSnapshotV1 {
		const generatedAt = options.generatedAt ?? nowFrom(this.clock).toISOString();
		return cloneJson(selectJobsSnapshotV1(this.agentState, { ...options, generatedAt }));
	}

	planSnapshot(): PlanSnapshotV1 | undefined {
		return this.planState.plan ? cloneJson(this.planState.plan) : undefined;
	}

	applyAgentEvent(raw: unknown): Promise<ApplyAgentEventRuntimeResultV1> {
		return this.enqueue(() => this.applyAgentEventLocked(raw));
	}

	applyPlanEvent(raw: unknown): Promise<ApplyPlanEventRuntimeResultV1> {
		return this.enqueue(() => this.applyPlanEventLocked(raw));
	}

	applyExtensionSnapshot(raw: unknown): Promise<ApplyExtensionSnapshotRuntimeResultV1> {
		return this.enqueue(() => this.applyExtensionSnapshotLocked(raw));
	}

	subscribe(callbacks: SubagentHostRuntimeCallbacksV1): () => void {
		if (!callbacks || typeof callbacks !== "object") throw new Error("callbacks must be an object");
		if (this.subscribers.size >= this.maxSubscribers) throw new Error(`subscriber limit of ${this.maxSubscribers} reached`);
		this.subscribers.add(callbacks);
		return () => this.subscribers.delete(callbacks);
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.queue.then(operation, operation);
		this.queue = next.then(() => undefined, () => undefined);
		return next;
	}

	private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.lifecycle.then(operation, operation);
		this.lifecycle = next.then(() => undefined, () => undefined);
		return next;
	}

	private now(): Date {
		return nowFrom(this.clock);
	}

	private snapshotAt(generatedAt = this.now().toISOString()): JobsSnapshotV1 {
		return this.snapshot({ generatedAt });
	}

	private async ensureLoadedLocked(): Promise<void> {
		if (!this.loaded) await this.loadLocked();
	}

	private async loadLocked(): Promise<SubagentHostRuntimeLoadResultV1> {
		const now = this.now();
		const agentLoadOptions: AgentProjectionLoadOptionsV1 = {
			...(this.agentOptions.maxLogs !== undefined ? { maxLogs: this.agentOptions.maxLogs } : {}),
			...(this.agentOptions.reconcileRunning !== undefined ? { reconcileRunning: this.agentOptions.reconcileRunning } : {}),
			observedAt: now.getTime(),
		};
		const agents = await loadAgentProjectionStateV1(
			this.persistence.storage,
			this.persistence.agentProjectionPath,
			agentLoadOptions,
		);
		const plan = await loadPlanStateV1(this.persistence.storage, this.persistence.planPath);
		this.agentState = agents.state;
		this.planState = plan.state;
		this.agentWritable = agents.writable;
		this.planWritable = plan.writable;

		let worktreeFinalizations: PortableStateLoadResultV1<WorktreeFinalizationRegistryV1> | undefined;
		if (this.finalizationConfig && this.persistence.worktreeFinalizationsPath) {
			worktreeFinalizations = await loadVersionedStateV1(
				this.persistence.storage,
				this.persistence.worktreeFinalizationsPath,
				worktreeFinalizationRegistryCodecV1,
			);
			this.finalizationRegistry = worktreeFinalizations.state;
			this.finalizationWritable = worktreeFinalizations.writable;
		}
		this.loaded = true;

		const snapshot = this.snapshotAt(now.toISOString());
		const callbackIssues = [
			...(await this.notifyJobs({ schemaVersion: 1, source: "load", snapshot })),
			...(await this.notifyPlan({ schemaVersion: 1, source: "load", ...(this.planState.plan ? { plan: cloneJson(this.planState.plan) } : {}) })),
		];
		await this.reportCallbackIssues("load", callbackIssues);
		return { schemaVersion: 1, agents, plan, ...(worktreeFinalizations ? { worktreeFinalizations } : {}), snapshot };
	}

	private async applyAgentEventLocked(raw: unknown): Promise<ApplyAgentEventRuntimeResultV1> {
		await this.ensureLoadedLocked();
		const decoded = decodeAgentEventV1(raw);
		if (!decoded.ok) {
			return {
				schemaVersion: 1,
				ok: false,
				accepted: false,
				applied: false,
				diagnostics: decoded.diagnostics,
				snapshot: this.snapshotAt(),
			};
		}
		const event = decoded.value;
		const reduceOptions: AgentProjectionReduceOptionsV1 = {
			observedAt: this.now().getTime(),
			...(this.agentOptions.maxLogs !== undefined ? { maxLogs: this.agentOptions.maxLogs } : {}),
		};
		const next = applyAgentEventV1(this.agentState, event, reduceOptions);
		if (!this.agentWritable) {
			const diagnostic: ProtocolDiagnostic = {
				code: "persistence_not_writable",
				path: "$",
				message: "agent projection persistence is protected after a failed or newer-state load",
				severity: "error",
			};
			await this.emitError({ schemaVersion: 1, stage: "agent_event", code: diagnostic.code, message: diagnostic.message, agentId: event.agentId, runId: event.runId });
			return {
				schemaVersion: 1,
				ok: false,
				accepted: false,
				applied: false,
				diagnostics: [...decoded.diagnostics, diagnostic],
				snapshot: this.snapshotAt(),
				agentId: event.agentId,
				runId: event.runId,
			};
		}
		const saved = await saveAgentProjectionStateV1(this.persistence.storage, this.persistence.agentProjectionPath, next);
		if (!saved.ok) {
			this.agentWritable = false;
			const diagnostic = persistenceDiagnostic("agent projection", saved);
			await this.emitError({ schemaVersion: 1, stage: "agent_event", code: diagnostic.code, message: diagnostic.message, agentId: event.agentId, runId: event.runId });
			return {
				schemaVersion: 1,
				ok: false,
				accepted: false,
				applied: false,
				diagnostics: [...decoded.diagnostics, diagnostic],
				snapshot: this.snapshotAt(),
				agentId: event.agentId,
				runId: event.runId,
			};
		}
		this.agentState = next;
		const snapshot = this.snapshotAt();
		const callbackIssues = await this.notifyJobs({
			schemaVersion: 1,
			source: "agent_event",
			snapshot,
			event: { kind: event.kind, agentId: event.agentId, runId: event.runId },
		});
		await this.reportCallbackIssues("agent_event", callbackIssues, event);

		const finalization = event.kind === "end" ? await this.finalizeTerminalWorktreeLocked(event) : undefined;
		const diagnostics = [
			...decoded.diagnostics,
			...diagnosticsForCallbackIssues(callbackIssues),
			...(finalization?.diagnostics ?? []),
		];
		return {
			schemaVersion: 1,
			ok: !diagnostics.some((entry) => entry.severity === "error"),
			accepted: true,
			applied: true,
			diagnostics,
			snapshot,
			agentId: event.agentId,
			runId: event.runId,
			...(finalization?.state ? { finalization: cloneJson(finalization.state) } : {}),
		};
	}

	private async applyPlanEventLocked(raw: unknown): Promise<ApplyPlanEventRuntimeResultV1> {
		await this.ensureLoadedLocked();
		const decoded = decodePlanEventV1(raw);
		if (!decoded.ok) {
			return {
				schemaVersion: 1,
				response: { schemaVersion: 1, ok: false, applied: false, ...(this.planState.plan ? { currentRevision: this.planState.plan.revision } : {}), error: "invalid PlanEventV1" },
				diagnostics: decoded.diagnostics,
			};
		}
		const event = decoded.value;
		const reduced = applyPlanEventV1(this.planState, event, { observedAt: this.now().toISOString() });
		if (!reduced.response.applied) {
			const callbackIssues = await this.notifyPlan({
				schemaVersion: 1,
				source: "plan_event",
				event: cloneJson(event),
				response: cloneJson(reduced.response),
				...(this.planState.plan ? { plan: cloneJson(this.planState.plan) } : {}),
			});
			await this.reportCallbackIssues("plan_event", callbackIssues);
			return {
				schemaVersion: 1,
				response: reduced.response,
				diagnostics: [...decoded.diagnostics, ...diagnosticsForCallbackIssues(callbackIssues)],
			};
		}
		if (!this.planWritable) {
			const response: PlanRevisionResponseV1 = {
				schemaVersion: 1,
				ok: false,
				applied: false,
				...(this.planState.plan ? { currentRevision: this.planState.plan.revision } : {}),
				error: "plan persistence is protected after a failed or newer-state load",
			};
			await this.emitError({ schemaVersion: 1, stage: "plan_event", code: "persistence_not_writable", message: response.error! });
			return { schemaVersion: 1, response, diagnostics: decoded.diagnostics };
		}
		const saved = await savePlanStateV1(this.persistence.storage, this.persistence.planPath, reduced.state);
		if (!saved.ok) {
			this.planWritable = false;
			const response = planPersistenceFailure(this.planState, saved);
			await this.emitError({ schemaVersion: 1, stage: "plan_event", code: "persistence_failed", message: response.error! });
			return { schemaVersion: 1, response, diagnostics: [...decoded.diagnostics, persistenceDiagnostic("plan", saved)] };
		}
		this.planState = reduced.state;
		const callbackIssues = await this.notifyPlan({
			schemaVersion: 1,
			source: "plan_event",
			event: cloneJson(event),
			response: cloneJson(reduced.response),
			...(this.planState.plan ? { plan: cloneJson(this.planState.plan) } : {}),
		});
		await this.reportCallbackIssues("plan_event", callbackIssues);
		return {
			schemaVersion: 1,
			response: reduced.response,
			diagnostics: [...decoded.diagnostics, ...diagnosticsForCallbackIssues(callbackIssues)],
		};
	}

	private async applyExtensionSnapshotLocked(raw: unknown): Promise<ApplyExtensionSnapshotRuntimeResultV1> {
		await this.ensureLoadedLocked();
		const decoded = decodeJobsSnapshotV1(raw);
		if (!decoded.ok) {
			return { schemaVersion: 1, ok: false, applied: false, diagnostics: decoded.diagnostics, snapshot: this.snapshotAt() };
		}
		if (!this.agentWritable) {
			const diagnostic: ProtocolDiagnostic = {
				code: "persistence_not_writable",
				path: "$",
				message: "agent projection persistence is protected after a failed or newer-state load",
				severity: "error",
			};
			await this.emitError({ schemaVersion: 1, stage: "snapshot", code: diagnostic.code, message: diagnostic.message });
			return { schemaVersion: 1, ok: false, applied: false, diagnostics: [...decoded.diagnostics, diagnostic], snapshot: this.snapshotAt() };
		}
		const next = reconcileJobsSnapshotV1(this.agentState, decoded.value, { observedAt: this.now().getTime() });
		const saved = await saveAgentProjectionStateV1(this.persistence.storage, this.persistence.agentProjectionPath, next);
		if (!saved.ok) {
			this.agentWritable = false;
			const diagnostic = persistenceDiagnostic("agent projection", saved);
			await this.emitError({ schemaVersion: 1, stage: "snapshot", code: diagnostic.code, message: diagnostic.message });
			return { schemaVersion: 1, ok: false, applied: false, diagnostics: [...decoded.diagnostics, diagnostic], snapshot: this.snapshotAt() };
		}
		this.agentState = next;
		const snapshot = this.snapshotAt();
		const callbackIssues = await this.notifyJobs({ schemaVersion: 1, source: "extension_snapshot", snapshot });
		await this.reportCallbackIssues("snapshot", callbackIssues);
		return {
			schemaVersion: 1,
			ok: true,
			applied: true,
			diagnostics: [...decoded.diagnostics, ...diagnosticsForCallbackIssues(callbackIssues)],
			snapshot,
		};
	}

	private async finalizeTerminalWorktreeLocked(event: AgentEventV1): Promise<FinalizationAttempt | undefined> {
		if (!this.finalizationConfig || !this.finalizationService) return undefined;
		const key = agentRunKeyV1(event.agentId, event.runId);
		const existing = this.finalizationRegistry.recordsByRunKey[key];
		if (existing) return { state: cloneJson(existing), diagnostics: [] };
		const run = this.agentState.runsByKey[key];
		const terminal = run ? finalTerminalState(run) : undefined;
		if (!run || !run.terminal || !terminal || !run.worktree.path || !run.worktree.branch) return undefined;
		if (!this.finalizationWritable) {
			const diagnostic: ProtocolDiagnostic = {
				code: "worktree_finalization_persistence_not_writable",
				path: "$",
				message: "automatic worktree finalization was skipped because its durable registry is protected",
				severity: "warning",
			};
			await this.emitError({ schemaVersion: 1, stage: "worktree_finalization", code: diagnostic.code, message: diagnostic.message, agentId: run.agentId, runId: run.runId });
			return { diagnostics: [diagnostic] };
		}

		let override: WorktreeVerifyMetadataV1 | undefined;
		try {
			override = this.finalizationConfig.verify?.(cloneJson(run));
		} catch (error) {
			const diagnostic: ProtocolDiagnostic = {
				code: "worktree_finalization_config_failed",
				path: "$",
				message: `worktree verification configuration failed: ${error instanceof Error ? error.message : "unknown error"}`,
				severity: "warning",
			};
			await this.emitError({ schemaVersion: 1, stage: "worktree_finalization", code: diagnostic.code, message: diagnostic.message, agentId: run.agentId, runId: run.runId });
			return { diagnostics: [diagnostic] };
		}
		const input: WorktreeFinalizationInputV1 = {
			schemaVersion: 1,
			agentId: run.agentId,
			runId: run.runId,
			mainCwd: this.finalizationConfig.mainCwd,
			worktree: {
				path: run.worktree.path,
				branch: run.worktree.branch,
				ownership: {
					mode: this.finalizationConfig.ownership.mode,
					role: this.finalizationConfig.ownership.role,
					agentId: run.agentId,
					runId: run.runId,
				},
			},
			terminal: { state: terminal },
			...(mergeVerification(run, override) ? { verify: mergeVerification(run, override) } : {}),
		};

		let state: WorktreeFinalizationStateV1;
		try {
			state = await this.finalizationService.finalize(input);
		} catch (error) {
			const diagnostic: ProtocolDiagnostic = {
				code: "worktree_finalization_failed",
				path: "$",
				message: `worktree finalization failed: ${error instanceof Error ? error.message : "unknown error"}`,
				severity: "warning",
			};
			await this.emitError({ schemaVersion: 1, stage: "worktree_finalization", code: diagnostic.code, message: diagnostic.message, agentId: run.agentId, runId: run.runId });
			return { diagnostics: [diagnostic] };
		}

		const nextRegistry: WorktreeFinalizationRegistryV1 = {
			schemaVersion: 1,
			recordsByRunKey: Object.assign(emptyRecord<WorktreeFinalizationStateV1>(), this.finalizationRegistry.recordsByRunKey, { [key]: state }),
		};
		const saved = await saveVersionedStateV1(
			this.persistence.storage,
			this.persistence.worktreeFinalizationsPath!,
			worktreeFinalizationRegistryCodecV1,
			nextRegistry,
		);
		// A completed Git operation must not be repeated in this process if a later
		// storage race/error prevents its record from reaching disk.
		this.finalizationRegistry = nextRegistry;
		const persisted = saved.ok;
		const diagnostics: ProtocolDiagnostic[] = [];
		if (!saved.ok) {
			this.finalizationWritable = false;
			const diagnostic = persistenceDiagnostic("worktree finalization", saved);
			diagnostics.push(diagnostic);
			await this.emitError({ schemaVersion: 1, stage: "worktree_finalization", code: diagnostic.code, message: diagnostic.message, agentId: run.agentId, runId: run.runId });
		}
		const callbackIssues = await this.notifyFinalization({ schemaVersion: 1, state: cloneJson(state), persisted });
		await this.reportCallbackIssues("worktree_finalization", callbackIssues, event);
		diagnostics.push(...diagnosticsForCallbackIssues(callbackIssues));
		return { state, diagnostics };
	}

	private async agentBridgeHandler(event: AgentEventV1): Promise<HostHandlerResultV1> {
		const result = await this.applyAgentEvent(event);
		return {
			accepted: result.accepted,
			...(result.accepted ? { message: "agent projection persisted" } : { message: "agent projection was not accepted" }),
			diagnostics: result.diagnostics,
			result: {
				schemaVersion: 1,
				agentId: result.agentId ?? event.agentId,
				runId: result.runId ?? event.runId,
				applied: result.applied,
				...(result.finalization ? { worktreeDisposition: result.finalization.result.disposition } : {}),
			} as unknown as JsonValue,
		};
	}

	private async planBridgeHandler(event: PlanEventV1): Promise<PlanRevisionResponseV1> {
		return (await this.applyPlanEvent(event)).response;
	}

	private async notifyJobs(notification: JobsSnapshotNotificationV1): Promise<CallbackIssue[]> {
		return this.invokeSubscribers("onJobsSnapshot", cloneJson(notification));
	}

	private async notifyPlan(notification: PlanProjectionNotificationV1): Promise<CallbackIssue[]> {
		return this.invokeSubscribers("onPlan", cloneJson(notification));
	}

	private async notifyFinalization(notification: WorktreeFinalizationNotificationV1): Promise<CallbackIssue[]> {
		return this.invokeSubscribers("onWorktreeFinalization", cloneJson(notification));
	}

	private async invokeSubscribers<K extends keyof SubagentHostRuntimeCallbacksV1>(
		name: K,
		payload: Parameters<NonNullable<SubagentHostRuntimeCallbacksV1[K]>>[0],
	): Promise<CallbackIssue[]> {
		const calls: Array<Promise<CallbackIssue | undefined>> = [];
		for (const subscriber of [...this.subscribers]) {
			const callback = subscriber[name];
			if (typeof callback !== "function") continue;
			calls.push(this.invokeBounded(name, () => (callback as (value: typeof payload) => Promise<void> | void)(cloneJson(payload))));
		}
		const settled = await Promise.all(calls);
		return settled.filter((issue): issue is CallbackIssue => issue !== undefined);
	}

	private async invokeBounded(name: string, callback: () => Promise<void> | void): Promise<CallbackIssue | undefined> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const work = Promise.resolve().then(callback);
		// A callback may reject after the timeout won the race. Keep that rejection
		// observed while allowing the ordered host reducer to continue.
		void work.catch(() => {});
		const deadline = new Promise<CallbackIssue>((resolve) => {
			timer = setTimeout(() => resolve({
				code: "callback_timeout",
				message: `${name} callback exceeded ${this.callbackTimeoutMs}ms`,
			}), this.callbackTimeoutMs);
		});
		try {
			return await Promise.race([
				work.then(
					() => undefined,
					(error): CallbackIssue => ({
						code: "callback_failed",
						message: `${name} callback failed: ${error instanceof Error ? error.message : "unknown error"}`,
					}),
				),
				deadline,
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private async reportCallbackIssues(
		stage: SubagentHostRuntimeErrorV1["stage"],
		issues: readonly CallbackIssue[],
		event?: Pick<AgentEventV1, "agentId" | "runId">,
	): Promise<void> {
		await Promise.all(issues.map((issue) => this.emitError({
			schemaVersion: 1,
			stage: "callback",
			code: issue.code,
			message: `${stage}: ${issue.message}`,
			...(event ? { agentId: event.agentId, runId: event.runId } : {}),
		})));
	}

	private async emitError(error: SubagentHostRuntimeErrorV1): Promise<void> {
		const calls: Array<Promise<CallbackIssue | undefined>> = [];
		for (const subscriber of [...this.subscribers]) {
			if (!subscriber.onError) continue;
			calls.push(this.invokeBounded("onError", () => subscriber.onError!(cloneJson(error))));
		}
		// Error observers are deliberately terminal: their own failures are not fed
		// back into onError recursively.
		await Promise.all(calls);
	}
}
