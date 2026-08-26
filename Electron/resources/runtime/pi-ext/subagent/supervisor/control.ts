/**
 * Supervisor control engine (S3).
 *
 * The model may choose from the bounded S1 action vocabulary. This layer
 * enforces hard safety/integrity boundaries and exact-once behavior before
 * any lifecycle port call. Wait is a no-op; escalate is a routing outcome.
 */

import {
	isSupervisorActionKind,
	validateSupervisorEvent,
	type SupervisorAction,
	type SupervisorActionKind,
	type SupervisorEvent,
	type SupervisorJobSnapshot,
	type SupervisorTaskStatus,
} from "./contract.ts";
import {
	budgetUsageKey,
	createEmptySupervisorState,
	type SupervisorControlOutcome,
	type SupervisorReceiptClaim,
	type SupervisorState,
	type SupervisorStateStore,
} from "./state-store.ts";

export const DEFAULT_SUPERVISOR_CONTROL_BUDGETS = {
	retry: 2,
	abort: 2,
	resolve: 2,
	start: 2,
} as const;

export type SupervisorBudgetKind = keyof typeof DEFAULT_SUPERVISOR_CONTROL_BUDGETS;

export interface SupervisorControlBudgets {
	retry: number;
	abort: number;
	resolve: number;
	start: number;
}

export interface SupervisorRunIdentity {
	agentId: string;
	runId: string;
}

export interface SupervisorAgentIdentity {
	agentId: string;
}

export interface ImmutableDispatchSpec {
	taskId: string;
	agentId: string;
	role: string;
	title?: string;
}

export interface DeclaredTaskManifestEntry {
	taskId: string;
	title: string;
	status: SupervisorTaskStatus;
	blockedBy?: string[];
	dispatch: ImmutableDispatchSpec;
}

export interface SupervisorTaskManifest {
	tasks: readonly DeclaredTaskManifestEntry[];
}

export interface SupervisorLifecyclePort {
	status(id: SupervisorRunIdentity): Promise<SupervisorJobSnapshot> | SupervisorJobSnapshot;
	resume(id: SupervisorAgentIdentity): Promise<void> | void;
	retry(id: SupervisorRunIdentity): Promise<void> | void;
	abort(id: SupervisorRunIdentity): Promise<void> | void;
	resolve(id: SupervisorRunIdentity): Promise<void> | void;
	startDeclared(spec: ImmutableDispatchSpec): Promise<void> | void;
}

export interface SupervisorControlResult {
	outcome: SupervisorControlOutcome;
	receiptId: string;
	action: SupervisorActionKind;
	reason?: string;
	evidenceRefs?: string[];
}

export interface SupervisorControlDeps {
	lifecycle: SupervisorLifecyclePort;
	store: SupervisorStateStore;
	manifest: SupervisorTaskManifest | (() => SupervisorTaskManifest);
	budgets?: Partial<SupervisorControlBudgets>;
	now?: () => number;
}

export interface SupervisorControl {
	apply(event: SupervisorEvent, action: SupervisorAction): Promise<SupervisorControlResult>;
	recover(): SupervisorControlResult[];
}

const FORBIDDEN_ACTION_KEYS = [
	"goal",
	"acceptance",
	"acceptanceCriteria",
	"scope",
	"brief",
	"prompt",
	"transcript",
	"messages",
	"findings",
	"dispatch",
	"task",
	"blockedBy",
] as const;

const DESTRUCTIVE_ACTIONS = new Set<SupervisorActionKind>([
	"retry",
	"abort",
	"resolve",
	"start_declared",
]);

const RUN_MUTATIONS = new Set<SupervisorActionKind>(["retry", "abort", "resolve"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactDispatchSpec(spec: ImmutableDispatchSpec): ImmutableDispatchSpec {
	return {
		taskId: spec.taskId,
		agentId: spec.agentId,
		role: spec.role,
		...(spec.title !== undefined ? { title: spec.title } : {}),
	};
}

function forbiddenActionKey(action: SupervisorAction): string | undefined {
	if (!isRecord(action)) return "action";
	for (const key of FORBIDDEN_ACTION_KEYS) {
		if (key in action) return key;
	}
	return undefined;
}

function forbiddenDispatchKey(spec: unknown): string | undefined {
	if (!isRecord(spec)) return "dispatch";
	for (const key of FORBIDDEN_ACTION_KEYS) {
		if (key in spec) return key;
	}
	return undefined;
}

function resolveBudgets(input?: Partial<SupervisorControlBudgets>): SupervisorControlBudgets {
	return {
		retry: input?.retry ?? DEFAULT_SUPERVISOR_CONTROL_BUDGETS.retry,
		abort: input?.abort ?? DEFAULT_SUPERVISOR_CONTROL_BUDGETS.abort,
		resolve: input?.resolve ?? DEFAULT_SUPERVISOR_CONTROL_BUDGETS.resolve,
		start: input?.start ?? DEFAULT_SUPERVISOR_CONTROL_BUDGETS.start,
	};
}

function tokenOrUndefined(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function exactRunIdentity(
	event: SupervisorEvent,
	action: SupervisorAction,
): { ok: true; value: SupervisorRunIdentity } | { ok: false; error: string } {
	const agentId = tokenOrUndefined(action.agentId) ?? event.identity.agentId;
	const runId = tokenOrUndefined(action.runId) ?? event.identity.runId;
	if (tokenOrUndefined(action.agentId) && action.agentId?.trim() !== event.identity.agentId) {
		return { ok: false, error: "run mutation agentId must match the event receipt exactly" };
	}
	if (tokenOrUndefined(action.runId) && action.runId?.trim() !== event.identity.runId) {
		return { ok: false, error: "run mutation runId must match the event receipt exactly" };
	}
	if (!agentId || !runId) {
		return { ok: false, error: "run mutation requires exact agentId and runId" };
	}
	return { ok: true, value: { agentId, runId } };
}

function lookupTask(
	manifest: SupervisorTaskManifest,
	taskId: string,
): DeclaredTaskManifestEntry | undefined {
	return manifest.tasks.find((task) => task.taskId === taskId);
}

function dependencySatisfied(manifest: SupervisorTaskManifest, dep: string): boolean {
	const byTask = lookupTask(manifest, dep);
	if (byTask) return byTask.status === "completed";
	return manifest.tasks.some((task) => task.dispatch.agentId === dep && task.status === "completed");
}

function startBlockReason(
	manifest: SupervisorTaskManifest,
	taskId: string | undefined,
): { task?: DeclaredTaskManifestEntry; error?: string } {
	const id = tokenOrUndefined(taskId);
	if (!id) return { error: "start_declared requires an already-declared taskId" };
	const task = lookupTask(manifest, id);
	if (!task) return { error: `task ${id} is not declared` };
	if (task.status === "blocked") return { task, error: `task ${id} is blocked` };
	if (task.status !== "declared") return { task, error: `task ${id} cannot start from status ${task.status}` };
	const dirty = forbiddenDispatchKey(task.dispatch);
	if (dirty) return { task, error: `declared dispatch must not include ${dirty}` };
	if (task.dispatch.taskId !== task.taskId) {
		return { task, error: "declared dispatch.taskId must match the manifest taskId" };
	}
	for (const dep of task.blockedBy ?? []) {
		if (!dependencySatisfied(manifest, dep)) {
			return { task, error: `task ${id} is blocked by ${dep}` };
		}
	}
	return { task };
}

function evidenceFor(event: SupervisorEvent, extra?: string[]): string[] | undefined {
	const refs = [...(event.evidenceRefs ?? []), ...(extra ?? [])];
	return refs.length > 0 ? refs : undefined;
}

function resultOf(
	event: SupervisorEvent,
	action: SupervisorActionKind,
	outcome: SupervisorControlOutcome,
	reason?: string,
	extraRefs?: string[],
): SupervisorControlResult {
	const evidenceRefs = evidenceFor(event, extraRefs);
	return {
		outcome,
		receiptId: event.identity.eventId,
		action,
		...(reason !== undefined ? { reason } : {}),
		...(evidenceRefs ? { evidenceRefs } : {}),
	};
}

function persist(store: SupervisorStateStore, state: SupervisorState): void {
	store.save(state);
}

function completeClaim(
	state: SupervisorState,
	claim: SupervisorReceiptClaim,
	outcome: SupervisorControlOutcome,
	now: number,
	evidenceRefs?: string[],
): SupervisorReceiptClaim {
	const completed: SupervisorReceiptClaim = {
		...claim,
		status: "completed",
		outcome,
		completedAt: now,
		...(evidenceRefs ? { evidenceRefs } : claim.evidenceRefs ? { evidenceRefs: claim.evidenceRefs } : {}),
	};
	state.receipts[claim.eventId] = completed;
	return completed;
}

function claimInProgress(
	state: SupervisorState,
	event: SupervisorEvent,
	action: SupervisorActionKind,
	now: number,
	evidenceRefs?: string[],
): SupervisorReceiptClaim {
	const claim: SupervisorReceiptClaim = {
		eventId: event.identity.eventId,
		agentId: event.identity.agentId,
		runId: event.identity.runId,
		kind: event.identity.kind,
		sequence: event.identity.sequence,
		action,
		status: "in_progress",
		claimedAt: now,
		...(evidenceRefs ? { evidenceRefs } : {}),
	};
	state.receipts[claim.eventId] = claim;
	return claim;
}

function incrementUsage(state: SupervisorState, kind: SupervisorBudgetKind, id: string): void {
	const key = budgetUsageKey(kind, id);
	state.usage[key] = (state.usage[key] ?? 0) + 1;
}

function budgetRemaining(
	state: SupervisorState,
	budgets: SupervisorControlBudgets,
	kind: SupervisorBudgetKind,
	id: string,
): boolean {
	return (state.usage[budgetUsageKey(kind, id)] ?? 0) < budgets[kind];
}

export function createSupervisorControl(deps: SupervisorControlDeps): SupervisorControl {
	const budgets = resolveBudgets(deps.budgets);
	const now = deps.now ?? Date.now;
	let tail: Promise<void> = Promise.resolve();

	function enqueue<T>(work: () => Promise<T>): Promise<T> {
		const run = tail.then(work, work);
		tail = run.then(() => undefined, () => undefined);
		return run;
	}

	function manifest(): SupervisorTaskManifest {
		return typeof deps.manifest === "function" ? deps.manifest() : deps.manifest;
	}

	function loadState(): SupervisorState {
		try {
			return deps.store.load();
		} catch {
			return createEmptySupervisorState();
		}
	}

	function recover(): SupervisorControlResult[] {
		const state = loadState();
		const results: SupervisorControlResult[] = [];
		for (const claim of Object.values(state.receipts)) {
			if (claim.status !== "in_progress" || !DESTRUCTIVE_ACTIONS.has(claim.action)) continue;
			results.push({
				outcome: "escalation_required",
				receiptId: claim.eventId,
				action: claim.action,
				reason: "orphaned in-progress claim is uncertain; refusing automatic replay",
				evidenceRefs: claim.evidenceRefs ?? [`supervisor://uncertain/${claim.eventId}`],
			});
		}
		return results;
	}

	async function applyExclusive(event: SupervisorEvent, action: SupervisorAction): Promise<SupervisorControlResult> {
		const validated = validateSupervisorEvent(event);
		if (validated.ok === false) {
			return {
				outcome: "rejected",
				receiptId: typeof event?.identity?.eventId === "string" ? event.identity.eventId : "",
				action: isSupervisorActionKind(action?.kind) ? action.kind : "escalate",
				reason: validated.error,
			};
		}
		const liveEvent = validated.value;
		if (!isRecord(action) || !isSupervisorActionKind(action.kind)) {
			return resultOf(liveEvent, "escalate", "rejected", "action.kind is not a Supervisor action");
		}

		let state: SupervisorState;
		try {
			state = deps.store.load();
		} catch {
			return resultOf(
				liveEvent,
				action.kind,
				"escalation_required",
				"supervisor state unreadable; refusing mutation",
				[`supervisor://uncertain/${liveEvent.identity.eventId}`],
			);
		}

		const existing = state.receipts[liveEvent.identity.eventId];
		if (existing?.status === "completed") {
			return resultOf(liveEvent, existing.action, "duplicate", "receipt already completed");
		}
		if (existing?.status === "in_progress") {
			if (DESTRUCTIVE_ACTIONS.has(existing.action)) {
				return resultOf(
					liveEvent,
					existing.action,
					"escalation_required",
					"orphaned in-progress claim is uncertain; refusing automatic replay",
					existing.evidenceRefs ?? [`supervisor://uncertain/${existing.eventId}`],
				);
			}
			const outcome: SupervisorControlOutcome = existing.action === "escalate" ? "escalation_required" : "noop";
			completeClaim(state, existing, outcome, now(), existing.evidenceRefs);
			persist(deps.store, state);
			return resultOf(liveEvent, existing.action, outcome, "non-destructive in-progress claim closed without replay");
		}

		const forbidden = forbiddenActionKey(action);
		if (forbidden) {
			return resultOf(liveEvent, action.kind, "rejected", `action must not include ${forbidden}`);
		}
		if (action.kind === "resume" || action.kind === "retry") {
			return resultOf(
				liveEvent,
				action.kind,
				"escalation_required",
				`${action.kind} is unsupported by the production lifecycle; Boss must choose an explicit redispatch`,
				[`supervisor://unsupported/${action.kind}/${liveEvent.identity.eventId}`],
			);
		}

		if (action.kind === "wait") {
			const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			completeClaim(state, claim, "noop", now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			return resultOf(liveEvent, action.kind, "noop", action.reason ?? "wait");
		}

		if (action.kind === "escalate") {
			const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			completeClaim(state, claim, "escalation_required", now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			return resultOf(liveEvent, action.kind, "escalation_required", action.reason ?? "escalate");
		}

		if (action.kind === "forward") {
			const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			completeClaim(state, claim, "applied", now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			return resultOf(liveEvent, action.kind, "applied", action.reason ?? "forward");
		}

		if (RUN_MUTATIONS.has(action.kind)) {
			const identity = exactRunIdentity(liveEvent, action);
			if (identity.ok === false) return resultOf(liveEvent, action.kind, "rejected", identity.error);
			const budgetKind = action.kind as Exclude<SupervisorBudgetKind, "start">;
			if (!budgetRemaining(state, budgets, budgetKind, identity.value.agentId)) {
				const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
				completeClaim(state, claim, "escalation_required", now(), evidenceFor(liveEvent));
				persist(deps.store, state);
				return resultOf(liveEvent, action.kind, "escalation_required", `${action.kind} budget exhausted`);
			}
			const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
			incrementUsage(state, budgetKind, identity.value.agentId);
			persist(deps.store, state);
			try {
				if (action.kind === "retry") await deps.lifecycle.retry(identity.value);
				else if (action.kind === "abort") await deps.lifecycle.abort(identity.value);
				else await deps.lifecycle.resolve(identity.value);
			} catch {
				return resultOf(
					liveEvent,
					action.kind,
					"escalation_required",
					"lifecycle mutation uncertain after in-progress claim",
					[`supervisor://uncertain/${liveEvent.identity.eventId}`],
				);
			}
			completeClaim(state, claim, "applied", now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			return resultOf(liveEvent, action.kind, "applied", action.reason);
		}

		if (action.kind === "status") {
			const identity = exactRunIdentity(liveEvent, action);
			if (identity.ok === false) return resultOf(liveEvent, action.kind, "rejected", identity.error);
			const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			try {
				await deps.lifecycle.status(identity.value);
			} catch {
				completeClaim(state, claim, "noop", now(), evidenceFor(liveEvent));
				persist(deps.store, state);
				return resultOf(liveEvent, action.kind, "noop", "status failed; no mutation");
			}
			completeClaim(state, claim, "applied", now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			return resultOf(liveEvent, action.kind, "applied", action.reason);
		}

		if (action.kind === "start_declared") {
			const admission = startBlockReason(manifest(), action.taskId);
			if (!admission.task || admission.error) {
				return resultOf(liveEvent, action.kind, "rejected", admission.error ?? "task is not declared");
			}
			if (tokenOrUndefined(action.agentId) && action.agentId?.trim() !== admission.task.dispatch.agentId) {
				return resultOf(liveEvent, action.kind, "rejected", "start_declared cannot override the declared agentId");
			}
			if (!budgetRemaining(state, budgets, "start", admission.task.taskId)) {
				const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
				completeClaim(state, claim, "escalation_required", now(), evidenceFor(liveEvent));
				persist(deps.store, state);
				return resultOf(liveEvent, action.kind, "escalation_required", "start budget exhausted");
			}
			const spec = compactDispatchSpec(admission.task.dispatch);
			const claim = claimInProgress(state, liveEvent, action.kind, now(), evidenceFor(liveEvent));
			incrementUsage(state, "start", admission.task.taskId);
			persist(deps.store, state);
			try {
				await deps.lifecycle.startDeclared(spec);
			} catch {
				return resultOf(
					liveEvent,
					action.kind,
					"escalation_required",
					"lifecycle mutation uncertain after in-progress claim",
					[`supervisor://uncertain/${liveEvent.identity.eventId}`],
				);
			}
			completeClaim(state, claim, "applied", now(), evidenceFor(liveEvent));
			persist(deps.store, state);
			return resultOf(liveEvent, action.kind, "applied", action.reason);
		}

		return resultOf(liveEvent, action.kind, "rejected", "action is not a permitted Supervisor control action");
	}

	function apply(event: SupervisorEvent, action: SupervisorAction): Promise<SupervisorControlResult> {
		return enqueue(() => applyExclusive(event, action));
	}

	return { apply, recover };
}
