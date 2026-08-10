import {
	decodeAgentEventV1,
	decodeJobsSnapshotV1,
	type AgentCloseoutDispositionV1,
	type AgentEventV1,
	type AgentLogItemV1,
	type AgentUsageV1,
	type JobsSnapshotV1,
	type JobProjectionV1,
	type JobStateV1,
	type ProtocolDiagnostic,
} from "../contract.ts";
import {
	loadVersionedStateV1,
	saveVersionedStateV1,
	type PortableStateLoadResultV1,
	type PortableStateSaveResultV1,
	type PortableStateStorageAdapterV1,
	type VersionedStateCodecV1,
	type VersionedStateDecodeResultV1,
} from "./persistence.ts";

export const AGENT_PROJECTION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_AGENT_PROJECTION_LOG_LIMIT = 800;

/** A run key is the identity boundary: agentId alone is never a mutable row key. */
export type AgentRunKeyV1 = string;
export type AgentWorktreeLifecycleV1 = "none" | "active" | "pendingReview";

export type AgentTerminalFlagsV1 = {
	ok: boolean;
	aborted: boolean;
	interrupted: boolean;
	vanished: boolean;
};

export type AgentUsageProjectionV1 = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Sum of per-turn usage costs, distinct from the latest job-level cost. */
	cost: number;
	contextTokens: number;
	contextWindow?: number;
	lastTurn?: number;
	model?: string;
	tools?: string[];
};

export type AgentProjectionLogItemV1 = AgentLogItemV1 & {
	id: number;
	/** Present for a live cumulative log_delta slot. */
	contentIndex?: number;
};

export type AgentWorktreeProjectionV1 = {
	lifecycle: AgentWorktreeLifecycleV1;
	path?: string;
	branch?: string;
	error?: string;
};

export type AgentVerifyProjectionV1 = {
	command?: string;
	exit?: number;
};

export type AgentRunProjectionV1 = {
	key: AgentRunKeyV1;
	agentId: string;
	runId: string;
	parentId?: string;
	/** Resolved only from a known parent run at child start; parentId remains available when absent. */
	parentKey?: AgentRunKeyV1;
	childKeys: AgentRunKeyV1[];
	toolCallId?: string;
	name: string;
	task: string;
	title?: string;
	depth?: number;
	model?: string;
	background?: boolean;
	state: JobStateV1;
	terminal: boolean;
	terminalFlags: AgentTerminalFlagsV1;
	output: string;
	activity: string;
	cost: number;
	turns: number;
	usage: AgentUsageProjectionV1;
	stalled: boolean;
	stalledIdleSec: number;
	logs: AgentProjectionLogItemV1[];
	/** Per-run IDs let log_delta replace a cumulative stream row without touching another run. */
	nextLogId: number;
	streamLogIdsByContentIndex: Record<string, number>;
	worktree: AgentWorktreeProjectionV1;
	verify: AgentVerifyProjectionV1;
	/** Handled state is display-only; it never changes terminal result or worktree ownership. */
	closeoutDisposition?: AgentCloseoutDispositionV1;
	closeoutReason?: string;
	closeoutAt?: number;
	stopReason?: string;
	blockedBy?: string[];
	startedAt?: number;
	lastObservedAt?: number;
	endedAt?: number;
	/** True only when reconnect/restart reconciliation, not the scheduler, set interrupted. */
	reconciled: boolean;
	reconciledAt?: number;
};

export type AgentProjectionStateV1 = {
	schemaVersion: 1;
	runsByKey: Record<AgentRunKeyV1, AgentRunProjectionV1>;
	/** Ordered run history per reusable agent name. Terminal runs are never discarded by reconciliation. */
	runKeysByAgentId: Record<string, AgentRunKeyV1[]>;
	/** The most recently admitted/current run for each agentId, never used to route non-start events. */
	latestRunKeyByAgentId: Record<string, AgentRunKeyV1>;
};

export type AgentProjectionReduceOptionsV1 = {
	/** Host receipt time. Producer `event.at` is intentionally not used for ordering. */
	observedAt?: number;
	maxLogs?: number;
};

export type DecodedAgentProjectionApplyResultV1 = {
	state: AgentProjectionStateV1;
	applied: boolean;
	diagnostics: ProtocolDiagnostic[];
};

export type DecodedSnapshotReconcileResultV1 = {
	state: AgentProjectionStateV1;
	applied: boolean;
	diagnostics: ProtocolDiagnostic[];
};

export type AgentProjectionLoadOptionsV1 = AgentProjectionReduceOptionsV1 & {
	/** Defaults to true: a freshly loaded process has no evidence that old running work is live. */
	reconcileRunning?: boolean;
};

export type AgentProjectionLoadResultV1 = PortableStateLoadResultV1<AgentProjectionStateV1> & {
	reconciled: boolean;
};

/**
 * Display-only serialization options. Callers can inject generatedAt for
 * deterministic persistence/tests; omitted values use the current wall clock.
 */
export type JobsSnapshotSelectorOptionsV1 = {
	generatedAt?: string;
	/** Terminal history is included by default so reconnect UIs do not lose it. */
	includeTerminal?: boolean;
};

function emptyRecord<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integer(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
	const parsed = finiteNumber(value);
	return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function observedAt(options: AgentProjectionReduceOptionsV1): number | undefined {
	return finiteNumber(options.observedAt);
}

function logLimit(options: AgentProjectionReduceOptionsV1): number {
	const requested = integer(options.maxLogs);
	if (requested === undefined) return DEFAULT_AGENT_PROJECTION_LOG_LIMIT;
	return Math.max(0, requested);
}

function emptyUsage(): AgentUsageProjectionV1 {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
}

function emptyTerminalFlags(): AgentTerminalFlagsV1 {
	return { ok: false, aborted: false, interrupted: false, vanished: false };
}

function emptyWorktree(): AgentWorktreeProjectionV1 {
	return { lifecycle: "none" };
}

function cloneRun(run: AgentRunProjectionV1): AgentRunProjectionV1 {
	return {
		...run,
		childKeys: [...run.childKeys],
		terminalFlags: { ...run.terminalFlags },
		usage: { ...run.usage, ...(run.usage.tools ? { tools: [...run.usage.tools] } : {}) },
		logs: run.logs.map((item) => ({ ...item })),
		streamLogIdsByContentIndex: Object.assign(emptyRecord<number>(), run.streamLogIdsByContentIndex),
		worktree: { ...run.worktree },
		verify: { ...run.verify },
		...(run.blockedBy ? { blockedBy: [...run.blockedBy] } : {}),
	};
}

function cloneState(state: AgentProjectionStateV1): AgentProjectionStateV1 {
	const runsByKey = emptyRecord<AgentRunProjectionV1>();
	for (const [key, run] of Object.entries(state.runsByKey)) runsByKey[key] = cloneRun(run);
	const runKeysByAgentId = emptyRecord<AgentRunKeyV1[]>();
	for (const [agentId, keys] of Object.entries(state.runKeysByAgentId)) runKeysByAgentId[agentId] = [...keys];
	return {
		schemaVersion: AGENT_PROJECTION_SCHEMA_VERSION,
		runsByKey,
		runKeysByAgentId,
		latestRunKeyByAgentId: Object.assign(emptyRecord<AgentRunKeyV1>(), state.latestRunKeyByAgentId),
	};
}

export function agentRunKeyV1(agentId: string, runId: string): AgentRunKeyV1 {
	// Contract decoders reject control characters, so this separator cannot collide with either ID.
	return `${agentId}\u0000${runId}`;
}

export function createAgentProjectionStateV1(): AgentProjectionStateV1 {
	return {
		schemaVersion: AGENT_PROJECTION_SCHEMA_VERSION,
		runsByKey: emptyRecord<AgentRunProjectionV1>(),
		runKeysByAgentId: emptyRecord<AgentRunKeyV1[]>(),
		latestRunKeyByAgentId: emptyRecord<AgentRunKeyV1>(),
	};
}

function noteObserved(run: AgentRunProjectionV1, at: number | undefined): void {
	if (at !== undefined && (run.lastObservedAt === undefined || at > run.lastObservedAt)) run.lastObservedAt = at;
}

function clearStalled(run: AgentRunProjectionV1): void {
	run.stalled = false;
	run.stalledIdleSec = 0;
}

function applyWorktreeFields(run: AgentRunProjectionV1, event: AgentEventV1, terminal = false): void {
	if (hasOwn(event, "worktreePath")) run.worktree.path = event.worktreePath;
	if (hasOwn(event, "worktreeBranch")) run.worktree.branch = event.worktreeBranch;
	if (hasOwn(event, "worktreeError")) run.worktree.error = event.worktreeError;
	const hasPath = typeof run.worktree.path === "string" && run.worktree.path.length > 0;
	if (terminal && hasPath) run.worktree.lifecycle = "pendingReview";
	else if (hasPath) run.worktree.lifecycle = "active";
	else if (!terminal) run.worktree.lifecycle = "none";
}

function applyVerifyFields(run: AgentRunProjectionV1, event: AgentEventV1): void {
	if (hasOwn(event, "verifyCommand")) run.verify.command = event.verifyCommand;
	if (hasOwn(event, "verifyExit")) run.verify.exit = event.verifyExit;
}

function removeChild(parent: AgentRunProjectionV1 | undefined, key: AgentRunKeyV1): void {
	if (!parent) return;
	parent.childKeys = parent.childKeys.filter((childKey) => childKey !== key);
}

function attachParent(state: AgentProjectionStateV1, child: AgentRunProjectionV1, parentId: string | undefined): void {
	if (child.parentKey) removeChild(state.runsByKey[child.parentKey], child.key);
	// The persistence codec validates in-memory objects before JSON serialization,
	// so optional fields must be absent rather than own-properties with undefined.
	delete child.parentKey;
	if (parentId) child.parentId = parentId;
	else delete child.parentId;
	if (!parentId) return;
	const parentKey = state.latestRunKeyByAgentId[parentId];
	if (!parentKey || parentKey === child.key) return;
	const parent = state.runsByKey[parentKey];
	if (!parent) return;
	child.parentKey = parentKey;
	if (!parent.childKeys.includes(child.key)) parent.childKeys.push(child.key);
}

function appendRunIndex(state: AgentProjectionStateV1, run: AgentRunProjectionV1): void {
	const keys = state.runKeysByAgentId[run.agentId] ?? [];
	if (!keys.includes(run.key)) keys.push(run.key);
	state.runKeysByAgentId[run.agentId] = keys;
}

function newRun(event: AgentEventV1, key: AgentRunKeyV1, at: number | undefined): AgentRunProjectionV1 {
	const run: AgentRunProjectionV1 = {
		key,
		agentId: event.agentId,
		runId: event.runId,
		childKeys: [],
		name: typeof event.name === "string" ? event.name : "agent",
		task: typeof event.task === "string" ? event.task : "",
		...(typeof event.title === "string" ? { title: event.title } : {}),
		...(typeof event.depth === "number" ? { depth: event.depth } : {}),
		...(typeof event.model === "string" ? { model: event.model } : {}),
		...(typeof event.background === "boolean" ? { background: event.background } : {}),
		...(typeof event.toolCallId === "string" ? { toolCallId: event.toolCallId } : {}),
		state: "running",
		terminal: false,
		terminalFlags: emptyTerminalFlags(),
		output: "",
		activity: "",
		cost: 0,
		turns: 0,
		usage: emptyUsage(),
		stalled: false,
		stalledIdleSec: 0,
		logs: [],
		nextLogId: 0,
		streamLogIdsByContentIndex: emptyRecord<number>(),
		worktree: emptyWorktree(),
		verify: {},
		reconciled: false,
		...(at !== undefined ? { startedAt: at, lastObservedAt: at } : {}),
	};
	applyWorktreeFields(run, event);
	return run;
}

function applyStartFields(state: AgentProjectionStateV1, run: AgentRunProjectionV1, event: AgentEventV1, at: number | undefined): void {
	run.state = "running";
	run.terminal = false;
	run.terminalFlags = emptyTerminalFlags();
	run.reconciled = false;
	delete run.reconciledAt;
	delete run.endedAt;
	run.activity = "";
	clearStalled(run);
	run.streamLogIdsByContentIndex = emptyRecord<number>();
	noteObserved(run, at);
	if (typeof event.name === "string") run.name = event.name;
	if (typeof event.task === "string") run.task = event.task;
	if (hasOwn(event, "title") && typeof event.title === "string") run.title = event.title;
	if (hasOwn(event, "depth") && typeof event.depth === "number") run.depth = event.depth;
	if (hasOwn(event, "model")) {
		if (typeof event.model === "string") run.model = event.model;
		else delete run.model;
	}
	if (hasOwn(event, "background") && typeof event.background === "boolean") run.background = event.background;
	if (hasOwn(event, "toolCallId")) {
		if (typeof event.toolCallId === "string") run.toolCallId = event.toolCallId;
		else delete run.toolCallId;
	}
	if (hasOwn(event, "parentId")) attachParent(state, run, typeof event.parentId === "string" ? event.parentId : undefined);
	applyWorktreeFields(run, event);
}

function trimLogs(run: AgentRunProjectionV1, maximum: number): void {
	const overflow = run.logs.length - maximum;
	if (overflow <= 0) return;
	const removed = new Set(run.logs.slice(0, overflow).map((item) => item.id));
	run.logs.splice(0, overflow);
	for (const [contentIndex, id] of Object.entries(run.streamLogIdsByContentIndex)) {
		if (removed.has(id)) delete run.streamLogIdsByContentIndex[contentIndex];
	}
}

function applyLogDelta(run: AgentRunProjectionV1, event: AgentEventV1, maximum: number): void {
	const contentIndex = event.contentIndex;
	const itemType = event.itemType;
	const text = event.text;
	if (contentIndex === undefined || itemType === undefined || text === undefined) return;
	const slot = String(contentIndex);
	const existingId = run.streamLogIdsByContentIndex[slot];
	if (existingId !== undefined) {
		const index = run.logs.findIndex((item) => item.id === existingId);
		if (index >= 0) {
			const old = run.logs[index];
			run.logs[index] = {
				...old,
				itemType,
				text,
				...(typeof event.name === "string" && event.name.length > 0 ? { name: event.name } : {}),
				contentIndex,
			};
			return;
		}
		delete run.streamLogIdsByContentIndex[slot];
	}
	// Match the native projection: ignore blank text placeholders except tool slots.
	if (text.length === 0 && itemType !== "tool") return;
	const id = ++run.nextLogId;
	run.streamLogIdsByContentIndex[slot] = id;
	run.logs.push({ id, itemType, text, ...(typeof event.name === "string" ? { name: event.name } : {}), contentIndex });
	trimLogs(run, maximum);
}

function appendLogItems(run: AgentRunProjectionV1, items: AgentLogItemV1[], maximum: number): void {
	run.streamLogIdsByContentIndex = emptyRecord<number>();
	for (const item of items) {
		run.logs.push({ id: ++run.nextLogId, ...item });
	}
	trimLogs(run, maximum);
}

function applyUsage(run: AgentRunProjectionV1, event: AgentEventV1): void {
	const usage: AgentUsageV1 = event.usage ?? {};
	for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
		const value = nonNegative(usage[field]);
		if (value !== undefined) run.usage[field] += value;
	}
	const cost = nonNegative(usage.cost);
	if (cost !== undefined) run.usage.cost += cost;
	const contextTokens = integer(usage.contextTokens);
	if (contextTokens !== undefined && contextTokens > 0) run.usage.contextTokens = contextTokens;
	const contextWindow = integer(usage.contextWindow);
	if (contextWindow !== undefined && contextWindow > 0) run.usage.contextWindow = contextWindow;
	const explicitContext = integer(event.contextTokens);
	if (explicitContext !== undefined && explicitContext > 0) run.usage.contextTokens = explicitContext;
	if (typeof event.turn === "number") run.usage.lastTurn = event.turn;
	if (typeof event.model === "string") {
		run.model = event.model;
		run.usage.model = event.model;
	}
	if (Array.isArray(event.tools)) run.usage.tools = [...event.tools];
}

function stateFromEnd(event: AgentEventV1): JobStateV1 {
	if (event.interrupted === true || event.vanished === true) return "interrupted";
	if (event.aborted === true) return "aborted";
	return event.ok === true ? "ok" : "failed";
}

function flagsForEnd(event: AgentEventV1): AgentTerminalFlagsV1 {
	return {
		ok: event.ok === true,
		aborted: event.aborted === true,
		interrupted: event.interrupted === true || event.vanished === true,
		vanished: event.vanished === true,
	};
}

/**
 * Pure AgentEventV1 reducer. Non-start events use the exact agentId+runId key;
 * they never look up a row by agentId, which prevents a late old run from changing
 * a newly reused agent name.
 */
export function applyAgentEventV1(
	state: AgentProjectionStateV1,
	event: AgentEventV1,
	options: AgentProjectionReduceOptionsV1 = {},
): AgentProjectionStateV1 {
	const key = agentRunKeyV1(event.agentId, event.runId);
	const current = state.runsByKey[key];
	const at = observedAt(options);
	if (event.kind !== "start" && !current) return state;
	if (event.kind === "start" && current?.terminal) return state;
	// A duplicate old start cannot reclaim the agentId pointer after a newer run began.
	if (event.kind === "start" && current && state.latestRunKeyByAgentId[event.agentId] !== key) return state;

	const next = cloneState(state);
	let run = next.runsByKey[key];
	switch (event.kind) {
		case "start": {
			if (!run) {
				run = newRun(event, key, at);
				next.runsByKey[key] = run;
				appendRunIndex(next, run);
				if (hasOwn(event, "parentId")) attachParent(next, run, typeof event.parentId === "string" ? event.parentId : undefined);
			} else {
				applyStartFields(next, run, event, at);
			}
			next.latestRunKeyByAgentId[event.agentId] = key;
			return next;
		}
		case "update": {
			noteObserved(run, at);
			clearStalled(run);
			if (typeof event.output === "string" && event.output.length > 0) run.output = event.output;
			if (hasOwn(event, "activity") && typeof event.activity === "string") run.activity = event.activity;
			if (typeof event.cost === "number") run.cost = event.cost;
			if (typeof event.turns === "number") run.turns = event.turns;
			if (hasOwn(event, "title") && typeof event.title === "string") run.title = event.title;
			return next;
		}
		case "log_delta": {
			noteObserved(run, at);
			clearStalled(run);
			applyLogDelta(run, event, logLimit(options));
			return next;
		}
		case "log": {
			noteObserved(run, at);
			clearStalled(run);
			appendLogItems(run, event.items ?? [], logLimit(options));
			return next;
		}
		case "usage": {
			noteObserved(run, at);
			clearStalled(run);
			applyUsage(run, event);
			return next;
		}
		case "stalled": {
			noteObserved(run, at);
			if (run.state === "running") {
				run.stalled = event.stalled ?? true;
				if (typeof event.idle === "number") run.stalledIdleSec = event.idle;
				if (typeof event.activity === "string" && event.activity.length > 0) run.activity = event.activity;
			}
			return next;
		}
		case "closeout": {
			// Closeout is a one-way, exact-run display acknowledgment. It neither
			// creates a missing run nor changes terminal state, output, verify, or
			// pendingReview worktree evidence. Duplicate/early/ok closeouts are no-ops.
			if (
				!run.terminal
				|| !["failed", "aborted", "interrupted"].includes(run.state)
				|| event.disposition !== "cleaned"
				|| run.closeoutDisposition === "cleaned"
			) return state;
			noteObserved(run, at);
			run.closeoutDisposition = "cleaned";
			if (typeof event.reason === "string") run.closeoutReason = event.reason;
			if (typeof event.closeoutAt === "number") run.closeoutAt = event.closeoutAt;
			else if (at !== undefined) run.closeoutAt = at;
			return next;
		}
		case "end": {
			noteObserved(run, at);
			clearStalled(run);
			run.streamLogIdsByContentIndex = emptyRecord<number>();
			run.state = stateFromEnd(event);
			run.terminal = true;
			run.terminalFlags = flagsForEnd(event);
			run.reconciled = false;
			delete run.reconciledAt;
			if (at !== undefined) run.endedAt = at;
			if (typeof event.output === "string" && event.output.length > 0) run.output = event.output;
			run.activity = "";
			if (typeof event.cost === "number") run.cost = event.cost;
			if (typeof event.turns === "number") run.turns = event.turns;
			const contextTokens = integer(event.contextTokens);
			if (contextTokens !== undefined && contextTokens > 0) run.usage.contextTokens = contextTokens;
			if (hasOwn(event, "stopReason")) {
				if (typeof event.stopReason === "string") run.stopReason = event.stopReason;
				else delete run.stopReason;
			}
			applyWorktreeFields(run, event, true);
			applyVerifyFields(run, event);
			return next;
		}
		default:
			return state;
	}
}

/** Alias for reducer-oriented callers. */
export const reduceAgentEventV1 = applyAgentEventV1;

/** Decode at the public boundary, then reduce only contract-validated AgentEventV1 values. */
export function decodeAndApplyAgentEventV1(
	state: AgentProjectionStateV1,
	raw: unknown,
	options: AgentProjectionReduceOptionsV1 = {},
): DecodedAgentProjectionApplyResultV1 {
	const decoded = decodeAgentEventV1(raw);
	if (!decoded.ok) return { state, applied: false, diagnostics: decoded.diagnostics };
	return { state: applyAgentEventV1(state, decoded.value, options), applied: true, diagnostics: decoded.diagnostics };
}

function snapshotStateFlags(state: JobStateV1): AgentTerminalFlagsV1 {
	return {
		ok: state === "ok",
		aborted: state === "aborted",
		interrupted: state === "interrupted",
		vanished: false,
	};
}

function applySnapshotJob(run: AgentRunProjectionV1, job: JobProjectionV1): void {
	run.name = job.name;
	run.task = job.task;
	if (hasOwn(job, "title")) {
		if (typeof job.title === "string") run.title = job.title;
		else delete run.title;
	}
	run.state = job.state;
	run.terminal = job.state !== "running";
	run.terminalFlags = snapshotStateFlags(job.state);
	run.reconciled = false;
	delete run.reconciledAt;
	if (job.closeoutDisposition === "cleaned") {
		run.closeoutDisposition = "cleaned";
		if (typeof job.closeoutReason === "string") run.closeoutReason = job.closeoutReason;
		if (typeof job.closeoutAt === "number") run.closeoutAt = job.closeoutAt;
	} else if (job.state === "running") {
		delete run.closeoutDisposition;
		delete run.closeoutReason;
		delete run.closeoutAt;
	}
	if (typeof job.activity === "string") run.activity = job.activity;
	else if (job.state !== "running") run.activity = "";
	if (typeof job.cost === "number") run.cost = job.cost;
	if (typeof job.turns === "number") run.turns = job.turns;
	if (typeof job.resultText === "string") run.output = job.resultText;
	if (typeof job.startedAt === "number") run.startedAt = job.startedAt;
	if (typeof job.endedAt === "number") run.endedAt = job.endedAt;
	else if (job.state === "running") delete run.endedAt;
	run.stalled = job.stalled ?? false;
	if (!run.stalled) run.stalledIdleSec = 0;
	if (Array.isArray(job.blockedBy)) run.blockedBy = [...job.blockedBy];
	else delete run.blockedBy;
}

function newSnapshotRun(job: JobProjectionV1): AgentRunProjectionV1 {
	const key = agentRunKeyV1(job.agentId, job.runId);
	const run = newRun({ schemaVersion: 1, kind: "start", agentId: job.agentId, runId: job.runId, name: job.name, task: job.task, title: job.title }, key, job.startedAt);
	applySnapshotJob(run, job);
	return run;
}

function preferSnapshotRun(current: JobProjectionV1 | undefined, candidate: JobProjectionV1): JobProjectionV1 {
	if (!current) return candidate;
	if (current.state !== "running" && candidate.state === "running") return candidate;
	if (current.state === "running" && candidate.state !== "running") return current;
	const currentTime = current.startedAt ?? current.endedAt ?? -1;
	const candidateTime = candidate.startedAt ?? candidate.endedAt ?? -1;
	return candidateTime >= currentTime ? candidate : current;
}

/**
 * Reconciles only a UI projection from the extension-owned JobsSnapshotV1. This
 * function has no callbacks or side effects: it cannot dispatch, resume, abort,
 * kill, or otherwise become a scheduler.
 */
export function reconcileJobsSnapshotV1(
	state: AgentProjectionStateV1,
	snapshot: JobsSnapshotV1,
	options: AgentProjectionReduceOptionsV1 = {},
): AgentProjectionStateV1 {
	const next = cloneState(state);
	const liveKeys = new Set<AgentRunKeyV1>();
	const preferredByAgent = new Map<string, JobProjectionV1>();
	for (const job of snapshot.jobs) {
		const key = agentRunKeyV1(job.agentId, job.runId);
		if (job.state === "running") liveKeys.add(key);
		let run = next.runsByKey[key];
		if (!run) {
			run = newSnapshotRun(job);
			next.runsByKey[key] = run;
			appendRunIndex(next, run);
		} else {
			applySnapshotJob(run, job);
		}
		preferredByAgent.set(job.agentId, preferSnapshotRun(preferredByAgent.get(job.agentId), job));
	}

	const reconciledAt = observedAt(options);
	for (const [key, run] of Object.entries(next.runsByKey)) {
		if (run.state !== "running" || liveKeys.has(key)) continue;
		run.state = "interrupted";
		run.terminal = true;
		run.terminalFlags = { ok: false, aborted: false, interrupted: true, vanished: false };
		run.activity = "";
		clearStalled(run);
		run.streamLogIdsByContentIndex = emptyRecord<number>();
		run.reconciled = true;
		if (reconciledAt !== undefined) {
			run.reconciledAt = reconciledAt;
			run.endedAt = run.endedAt ?? reconciledAt;
		}
		if (run.worktree.path && run.worktree.lifecycle !== "none") run.worktree.lifecycle = "pendingReview";
	}
	for (const [agentId, job] of preferredByAgent) {
		next.latestRunKeyByAgentId[agentId] = agentRunKeyV1(job.agentId, job.runId);
	}
	return next;
}

export const applyJobsSnapshotV1 = reconcileJobsSnapshotV1;

function snapshotGeneratedAt(options: JobsSnapshotSelectorOptionsV1): string {
	return typeof options.generatedAt === "string" && options.generatedAt.trim().length > 0
		? options.generatedAt
		: new Date().toISOString();
}

function jobProjectionFromRun(run: AgentRunProjectionV1): JobProjectionV1 {
	return {
		agentId: run.agentId,
		runId: run.runId,
		name: run.name || "agent",
		task: run.task,
		state: run.state,
		...(typeof run.title === "string" ? { title: run.title } : {}),
		...(run.blockedBy && run.blockedBy.length > 0 ? { blockedBy: [...run.blockedBy] } : {}),
		...(typeof run.startedAt === "number" && Number.isFinite(run.startedAt) ? { startedAt: run.startedAt } : {}),
		...(typeof run.endedAt === "number" && Number.isFinite(run.endedAt) ? { endedAt: run.endedAt } : {}),
		...(run.activity ? { activity: run.activity } : {}),
		cost: run.cost,
		turns: run.turns,
		...(run.output ? { resultText: run.output } : {}),
		...(run.closeoutDisposition === "cleaned" ? { closeoutDisposition: run.closeoutDisposition } : {}),
		...(typeof run.closeoutReason === "string" ? { closeoutReason: run.closeoutReason } : {}),
		...(typeof run.closeoutAt === "number" && Number.isFinite(run.closeoutAt) ? { closeoutAt: run.closeoutAt } : {}),
		stalled: run.stalled,
	};
}

/**
 * Stable UI/reconnect selector. It copies only JobsSnapshotV1 display fields,
 * sorts by immutable identity, and never exposes mutable reducer rows/logs.
 */
export function selectJobsSnapshotV1(
	state: AgentProjectionStateV1,
	options: JobsSnapshotSelectorOptionsV1 = {},
): JobsSnapshotV1 {
	const jobs = Object.values(state.runsByKey)
		.filter((run) => options.includeTerminal !== false || !run.terminal)
		.map(jobProjectionFromRun)
		.sort((left, right) => {
			if (left.agentId < right.agentId) return -1;
			if (left.agentId > right.agentId) return 1;
			if (left.runId < right.runId) return -1;
			if (left.runId > right.runId) return 1;
			return 0;
		});
	return {
		schemaVersion: 1,
		generatedAt: snapshotGeneratedAt(options),
		jobs,
	};
}

/** Explicit descriptive alias for adapters that start from projection state. */
export const jobsSnapshotFromAgentProjectionV1 = selectJobsSnapshotV1;

export function decodeAndReconcileJobsSnapshotV1(
	state: AgentProjectionStateV1,
	raw: unknown,
	options: AgentProjectionReduceOptionsV1 = {},
): DecodedSnapshotReconcileResultV1 {
	const decoded = decodeJobsSnapshotV1(raw);
	if (!decoded.ok) return { state, applied: false, diagnostics: decoded.diagnostics };
	return { state: reconcileJobsSnapshotV1(state, decoded.value, options), applied: true, diagnostics: decoded.diagnostics };
}

/** Pure restart fallback when no authoritative live snapshot is available yet. */
export function reconcileInterruptedAgentRunsV1(
	state: AgentProjectionStateV1,
	options: AgentProjectionReduceOptionsV1 = {},
): AgentProjectionStateV1 {
	if (!Object.values(state.runsByKey).some((run) => run.state === "running")) return state;
	return reconcileJobsSnapshotV1(state, { schemaVersion: 1, generatedAt: "", jobs: [] }, options);
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : undefined;
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined | null {
	if (!hasOwn(source, key)) return undefined;
	return typeof source[key] === "string" ? source[key] : null;
}

function optionalFinite(source: Record<string, unknown>, key: string): number | undefined | null {
	if (!hasOwn(source, key)) return undefined;
	return finiteNumber(source[key]) ?? null;
}

function decodeUsageProjection(raw: unknown): VersionedStateDecodeResultV1<AgentUsageProjectionV1> {
	if (!record(raw)) return { ok: false, error: "usage must be an object" };
	const usage = emptyUsage();
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost", "contextTokens"] as const) {
		const value = nonNegative(raw[key]);
		if (value === undefined) return { ok: false, error: `usage.${key} must be a non-negative finite number` };
		usage[key] = value;
	}
	for (const key of ["contextWindow", "lastTurn"] as const) {
		if (!hasOwn(raw, key)) continue;
		const value = integer(raw[key]);
		if (value === undefined || value < 0) return { ok: false, error: `usage.${key} must be a non-negative integer` };
		usage[key] = value;
	}
	if (hasOwn(raw, "model")) {
		if (typeof raw.model !== "string") return { ok: false, error: "usage.model must be a string" };
		usage.model = raw.model;
	}
	if (hasOwn(raw, "tools")) {
		const tools = stringArray(raw.tools);
		if (!tools) return { ok: false, error: "usage.tools must be a string array" };
		usage.tools = tools;
	}
	return { ok: true, value: usage };
}

function decodeLog(raw: unknown): VersionedStateDecodeResultV1<AgentProjectionLogItemV1> {
	if (!record(raw)) return { ok: false, error: "log item must be an object" };
	const id = integer(raw.id);
	if (id === undefined || id < 1) return { ok: false, error: "log item id must be a positive integer" };
	if (!["text", "thinking", "tool", "toolResult"].includes(raw.itemType as string) || typeof raw.text !== "string") {
		return { ok: false, error: "invalid log item" };
	}
	const item: AgentProjectionLogItemV1 = { id, itemType: raw.itemType as AgentLogItemV1["itemType"], text: raw.text };
	if (hasOwn(raw, "name")) {
		if (typeof raw.name !== "string") return { ok: false, error: "log item name must be a string" };
		item.name = raw.name;
	}
	if (hasOwn(raw, "isError")) {
		if (typeof raw.isError !== "boolean") return { ok: false, error: "log item isError must be boolean" };
		item.isError = raw.isError;
	}
	if (hasOwn(raw, "contentIndex")) {
		const contentIndex = integer(raw.contentIndex);
		if (contentIndex === undefined || contentIndex < 0) return { ok: false, error: "log item contentIndex must be non-negative integer" };
		item.contentIndex = contentIndex;
	}
	return { ok: true, value: item };
}

function decodeRun(key: string, raw: unknown): VersionedStateDecodeResultV1<AgentRunProjectionV1> {
	if (!record(raw)) return { ok: false, error: `run ${JSON.stringify(key)} must be an object` };
	if (raw.key !== key || typeof raw.agentId !== "string" || typeof raw.runId !== "string" || agentRunKeyV1(raw.agentId, raw.runId) !== key) {
		return { ok: false, error: `run ${JSON.stringify(key)} has invalid identity` };
	}
	if (typeof raw.name !== "string" || typeof raw.task !== "string" || !["running", "ok", "failed", "aborted", "interrupted"].includes(raw.state as string)) {
		return { ok: false, error: `run ${JSON.stringify(key)} has invalid required fields` };
	}
	if (typeof raw.terminal !== "boolean" || !record(raw.terminalFlags)) return { ok: false, error: "invalid terminal state" };
	const flags = raw.terminalFlags;
	if (!["ok", "aborted", "interrupted", "vanished"].every((flag) => typeof flags[flag] === "boolean")) return { ok: false, error: "invalid terminal flags" };
	if (typeof raw.output !== "string" || typeof raw.activity !== "string" || nonNegative(raw.cost) === undefined || integer(raw.turns) === undefined || raw.turns < 0) {
		return { ok: false, error: "invalid run telemetry" };
	}
	const usage = decodeUsageProjection(raw.usage);
	if (!usage.ok) return usage;
	if (typeof raw.stalled !== "boolean" || integer(raw.stalledIdleSec) === undefined || raw.stalledIdleSec < 0 || !Array.isArray(raw.logs)) {
		return { ok: false, error: "invalid run log state" };
	}
	const logs: AgentProjectionLogItemV1[] = [];
	for (const entry of raw.logs) {
		const decoded = decodeLog(entry);
		if (!decoded.ok) return decoded;
		logs.push(decoded.value);
	}
	const nextLogId = integer(raw.nextLogId);
	if (nextLogId === undefined || nextLogId < 0 || !record(raw.streamLogIdsByContentIndex)) return { ok: false, error: "invalid streaming log state" };
	const slots = emptyRecord<number>();
	const logIDs = new Set(logs.map((item) => item.id));
	for (const [slot, id] of Object.entries(raw.streamLogIdsByContentIndex)) {
		const parsed = integer(id);
		if (parsed === undefined || !logIDs.has(parsed)) return { ok: false, error: "stream log slot references missing item" };
		slots[slot] = parsed;
	}
	if (!record(raw.worktree) || !["none", "active", "pendingReview"].includes(raw.worktree.lifecycle as string)) return { ok: false, error: "invalid worktree" };
	const worktree: AgentWorktreeProjectionV1 = { lifecycle: raw.worktree.lifecycle as AgentWorktreeLifecycleV1 };
	for (const keyName of ["path", "branch", "error"] as const) {
		const value = optionalString(raw.worktree, keyName);
		if (value === null) return { ok: false, error: `worktree.${keyName} must be a string` };
		if (value !== undefined) worktree[keyName] = value;
	}
	if (!record(raw.verify)) return { ok: false, error: "invalid verify" };
	const verify: AgentVerifyProjectionV1 = {};
	const command = optionalString(raw.verify, "command");
	if (command === null) return { ok: false, error: "verify.command must be a string" };
	if (command !== undefined) verify.command = command;
	const exit = optionalFinite(raw.verify, "exit");
	if (exit === null || (exit !== undefined && !Number.isInteger(exit))) return { ok: false, error: "verify.exit must be an integer" };
	if (exit !== undefined) verify.exit = exit;
	const closeoutDisposition = optionalString(raw, "closeoutDisposition");
	if (closeoutDisposition !== undefined && closeoutDisposition !== "cleaned") return { ok: false, error: "closeoutDisposition must be cleaned" };
	const closeoutReason = optionalString(raw, "closeoutReason");
	if (closeoutReason === null) return { ok: false, error: "closeoutReason must be a string" };
	const closeoutAt = optionalFinite(raw, "closeoutAt");
	if (closeoutAt === null || (closeoutAt !== undefined && closeoutAt < 0)) return { ok: false, error: "closeoutAt must be a non-negative finite number" };
	const children = stringArray(raw.childKeys);
	if (!children) return { ok: false, error: "childKeys must be a string array" };
	const run: AgentRunProjectionV1 = {
		key,
		agentId: raw.agentId,
		runId: raw.runId,
		childKeys: children,
		name: raw.name,
		task: raw.task,
		state: raw.state as JobStateV1,
		terminal: raw.terminal,
		terminalFlags: { ok: flags.ok as boolean, aborted: flags.aborted as boolean, interrupted: flags.interrupted as boolean, vanished: flags.vanished as boolean },
		output: raw.output,
		activity: raw.activity,
		cost: raw.cost as number,
		turns: raw.turns as number,
		usage: usage.value,
		stalled: raw.stalled,
		stalledIdleSec: raw.stalledIdleSec as number,
		logs,
		nextLogId: Math.max(nextLogId, ...logs.map((item) => item.id), 0),
		streamLogIdsByContentIndex: slots,
		worktree,
		verify,
		reconciled: raw.reconciled === true,
		...(closeoutDisposition === "cleaned" ? { closeoutDisposition } : {}),
		...(typeof closeoutReason === "string" ? { closeoutReason } : {}),
		...(closeoutAt !== undefined ? { closeoutAt } : {}),
	};
	for (const keyName of ["parentId", "parentKey", "toolCallId", "title", "model", "stopReason"] as const) {
		const value = optionalString(raw, keyName);
		if (value === null) return { ok: false, error: `${keyName} must be a string` };
		if (value !== undefined) run[keyName] = value;
	}
	if (hasOwn(raw, "depth")) {
		const value = integer(raw.depth);
		if (value === undefined || value < 0) return { ok: false, error: "depth must be non-negative integer" };
		run.depth = value;
	}
	if (hasOwn(raw, "background")) {
		if (typeof raw.background !== "boolean") return { ok: false, error: "background must be boolean" };
		run.background = raw.background;
	}
	for (const keyName of ["startedAt", "lastObservedAt", "endedAt", "reconciledAt"] as const) {
		const value = optionalFinite(raw, keyName);
		if (value === null) return { ok: false, error: `${keyName} must be finite number` };
		if (value !== undefined) run[keyName] = value;
	}
	if (hasOwn(raw, "blockedBy")) {
		const blockedBy = stringArray(raw.blockedBy);
		if (!blockedBy) return { ok: false, error: "blockedBy must be string array" };
		run.blockedBy = blockedBy;
	}
	return { ok: true, value: run };
}

function rebuildIndices(state: AgentProjectionStateV1): AgentProjectionStateV1 {
	const indexed = createAgentProjectionStateV1();
	for (const [key, run] of Object.entries(state.runsByKey)) {
		indexed.runsByKey[key] = run;
		appendRunIndex(indexed, run);
		indexed.latestRunKeyByAgentId[run.agentId] = key;
	}
	for (const keys of Object.values(indexed.runKeysByAgentId)) {
		let running: AgentRunKeyV1 | undefined;
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			if (indexed.runsByKey[key]?.state === "running") {
				running = key;
				break;
			}
		}
		if (running) indexed.latestRunKeyByAgentId[indexed.runsByKey[running].agentId] = running;
	}
	return indexed;
}

/** Strict current-schema decoder used for persistence, independent of UI frameworks. */
export function decodeAgentProjectionStateV1(raw: unknown): VersionedStateDecodeResultV1<AgentProjectionStateV1> {
	if (!record(raw) || raw.schemaVersion !== AGENT_PROJECTION_SCHEMA_VERSION || !record(raw.runsByKey)) {
		return { ok: false, error: "invalid AgentProjectionStateV1 envelope" };
	}
	const state = createAgentProjectionStateV1();
	for (const [key, value] of Object.entries(raw.runsByKey)) {
		const decoded = decodeRun(key, value);
		if (!decoded.ok) return decoded;
		state.runsByKey[key] = decoded.value;
	}
	return { ok: true, value: rebuildIndices(state) };
}

export const agentProjectionStateCodecV1: VersionedStateCodecV1<AgentProjectionStateV1> = {
	schemaVersion: AGENT_PROJECTION_SCHEMA_VERSION,
	createEmpty: createAgentProjectionStateV1,
	decode: decodeAgentProjectionStateV1,
	encode: (state) => state,
};

export async function loadAgentProjectionStateV1(
	storage: PortableStateStorageAdapterV1,
	path: string,
	options: AgentProjectionLoadOptionsV1 = {},
): Promise<AgentProjectionLoadResultV1> {
	const loaded = await loadVersionedStateV1(storage, path, agentProjectionStateCodecV1);
	if (loaded.status !== "loaded" || options.reconcileRunning === false) return { ...loaded, reconciled: false };
	const state = reconcileInterruptedAgentRunsV1(loaded.state, options);
	return { ...loaded, state, reconciled: state !== loaded.state };
}

export function saveAgentProjectionStateV1(
	storage: PortableStateStorageAdapterV1,
	path: string,
	state: AgentProjectionStateV1,
): Promise<PortableStateSaveResultV1> {
	return saveVersionedStateV1(storage, path, agentProjectionStateCodecV1, state);
}

/** Convenience seam for Electron main-process composition; no default path is ever chosen here. */
export function createAgentProjectionPersistenceV1(
	storage: PortableStateStorageAdapterV1,
	path: string,
	options: AgentProjectionLoadOptionsV1 = {},
): { load(): Promise<AgentProjectionLoadResultV1>; save(state: AgentProjectionStateV1): Promise<PortableStateSaveResultV1> } {
	return {
		load: () => loadAgentProjectionStateV1(storage, path, options),
		save: (state) => saveAgentProjectionStateV1(storage, path, state),
	};
}
