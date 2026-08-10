import {
	decodePlanEventV1,
	type PlanEventV1,
	type PlanRevisionResponseV1,
	type PlanTaskStateV1,
	type PlanTaskV1,
	type PlanTaskUpdateV1,
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

export const PLAN_STATE_SCHEMA_VERSION = 1 as const;
export const PLAN_MAX_TASKS_V1 = 100;
export const PLAN_MAX_USED_IDS_V1 = 64;

export type PlanLifecycleV1 = "awaitingApproval" | "running" | "cancelled";
export type PlanAggregateStateV1 = "pending" | "running" | "completed" | "failed" | "blocked";

export type PlanSnapshotV1 = {
	schemaVersion: 1;
	revision: number;
	id: string;
	title: string;
	summary?: string;
	tasks: PlanTaskV1[];
	lifecycle: PlanLifecycleV1;
	/** Event `at` or an explicitly injected host observation value; never a scheduler clock. */
	updatedAt?: string;
};

export type PlanStateV1 = {
	schemaVersion: 1;
	plan?: PlanSnapshotV1;
	/** Ordered, unique accepted ids. A delayed old publish may never reuse one. */
	usedPlanIds: string[];
};

export type PlanReduceOptionsV1 = {
	observedAt?: string;
};

export type PlanEventApplyResultV1 = {
	state: PlanStateV1;
	response: PlanRevisionResponseV1;
};

export type DecodedPlanEventApplyResultV1 = PlanEventApplyResultV1 & {
	applied: boolean;
	diagnostics: ProtocolDiagnostic[];
};

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function trim(value: string): string {
	return value.trim();
}

function normalizedOptional(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function cloneTask(task: PlanTaskV1): PlanTaskV1 {
	return { ...task };
}

function clonePlan(plan: PlanSnapshotV1): PlanSnapshotV1 {
	return { ...plan, tasks: plan.tasks.map(cloneTask) };
}

function cloneState(state: PlanStateV1): PlanStateV1 {
	return {
		schemaVersion: PLAN_STATE_SCHEMA_VERSION,
		...(state.plan ? { plan: clonePlan(state.plan) } : {}),
		usedPlanIds: [...state.usedPlanIds],
	};
}

export function createPlanStateV1(): PlanStateV1 {
	return { schemaVersion: PLAN_STATE_SCHEMA_VERSION, usedPlanIds: [] };
}

export function planAggregateStateV1(plan: PlanSnapshotV1): PlanAggregateStateV1 {
	if (plan.tasks.length === 0) return "pending";
	if (plan.tasks.some((task) => task.state === "running")) return "running";
	if (plan.tasks.some((task) => task.state === "blocked")) return "blocked";
	if (plan.tasks.some((task) => task.state === "pending")) return "pending";
	if (plan.tasks.some((task) => task.state === "failed")) return "failed";
	return "completed";
}

export function isPlanTerminalV1(plan: PlanSnapshotV1): boolean {
	return plan.lifecycle === "cancelled" || planAggregateStateV1(plan) === "completed";
}

function normalizeUsedPlanIds(ids: readonly string[], currentPlanId?: string): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const raw of ids) {
		const id = trim(raw);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ordered.push(id);
	}
	while (ordered.length > PLAN_MAX_USED_IDS_V1) {
		const removable = ordered.findIndex((id) => id !== currentPlanId);
		if (removable < 0) break;
		ordered.splice(removable, 1);
	}
	return ordered;
}

function updatedAt(event: PlanEventV1, options: PlanReduceOptionsV1): string | undefined {
	return typeof event.at === "string" && event.at.length > 0
		? event.at
		: typeof options.observedAt === "string" && options.observedAt.length > 0
			? options.observedAt
			: undefined;
}

function applied(state: PlanStateV1, revision: number): PlanEventApplyResultV1 {
	return {
		state,
		response: { schemaVersion: 1, ok: true, applied: true, revision },
	};
}

function rejected(state: PlanStateV1, error: string, currentRevision = state.plan?.revision): PlanEventApplyResultV1 {
	return {
		state,
		response: {
			schemaVersion: 1,
			ok: false,
			applied: false,
			error,
			...(currentRevision !== undefined ? { currentRevision } : {}),
		},
	};
}

function nextRevision(state: PlanStateV1): number {
	return (state.plan?.revision ?? 0) + 1;
}

function validateSchema(state: PlanStateV1, event: { schemaVersion?: unknown }): PlanEventApplyResultV1 | undefined {
	if (event.schemaVersion === PLAN_STATE_SCHEMA_VERSION) return undefined;
	return rejected(state, `unsupported schemaVersion ${String(event.schemaVersion)}; expected ${PLAN_STATE_SCHEMA_VERSION}`);
}

function validTaskState(value: unknown): value is PlanTaskStateV1 {
	return value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "blocked" || value === "skipped";
}

function canTransition(from: PlanTaskStateV1, to: PlanTaskStateV1): boolean {
	if (from === to) return true;
	switch (from) {
		case "pending":
			return true;
		case "running":
			return to === "completed" || to === "failed" || to === "blocked" || to === "skipped" || to === "pending";
		case "blocked":
			return to === "running" || to === "pending" || to === "failed" || to === "skipped" || to === "completed";
		case "completed":
			return to === "pending" || to === "running" || to === "blocked";
		case "failed":
			return to === "pending" || to === "running" || to === "blocked" || to === "skipped";
		case "skipped":
			return to === "pending" || to === "running" || to === "blocked";
	}
}

function clearsStaleText(state: PlanTaskStateV1): boolean {
	return state === "pending" || state === "running" || state === "completed" || state === "skipped";
}

function planIdentityError(planId: unknown, publishedId: string): string | undefined {
	if (typeof planId !== "string" || trim(planId).length === 0) return "planId is required";
	return trim(planId) === publishedId ? undefined : "planId does not match published plan";
}

function applyPublish(state: PlanStateV1, event: Extract<PlanEventV1, { event: "publish" }>, options: PlanReduceOptionsV1): PlanEventApplyResultV1 {
	const schemaError = validateSchema(state, event);
	if (schemaError) return schemaError;
	const rawPlan = event.plan;
	if (!rawPlan || typeof rawPlan !== "object") return rejected(state, "plan must be an object");
	if (typeof rawPlan.id !== "string" || trim(rawPlan.id).length === 0) return rejected(state, "plan.id must be a non-empty string");
	const planId = trim(rawPlan.id);
	// Check reuse before active-plan gating, matching the stale-publish diagnostic in PlanStore.
	if (state.usedPlanIds.includes(planId)) return rejected(state, "plan.id was already used in this session");
	if (state.plan && !isPlanTerminalV1(state.plan)) {
		return rejected(state, "active plan in progress; finish it before publishing a new plan", state.plan.revision);
	}
	if (typeof rawPlan.title !== "string" || trim(rawPlan.title).length === 0) return rejected(state, "plan.title must be a non-empty string");
	if (!Array.isArray(rawPlan.tasks)) return rejected(state, "plan.tasks must be an array");
	if (rawPlan.tasks.length > PLAN_MAX_TASKS_V1) return rejected(state, `plan.tasks exceeds max of ${PLAN_MAX_TASKS_V1}`);

	const seen = new Set<string>();
	const tasks: PlanTaskV1[] = [];
	for (let index = 0; index < rawPlan.tasks.length; index++) {
		const task = rawPlan.tasks[index] as PlanTaskV1;
		if (!task || typeof task !== "object") return rejected(state, `tasks[${index}] must be an object`);
		if (typeof task.id !== "string" || trim(task.id).length === 0) return rejected(state, `tasks[${index}].id must be a non-empty string`);
		if (typeof task.title !== "string" || trim(task.title).length === 0) return rejected(state, `tasks[${index}].title must be a non-empty string`);
		const id = trim(task.id);
		if (seen.has(id)) return rejected(state, `duplicate task id ${id}`);
		if (!validTaskState(task.state)) return rejected(state, `tasks[${index}].state must be a known plan state`);
		if (task.state === "running") return rejected(state, "published tasks must not be running before approval");
		seen.add(id);
		const normalizedTask: PlanTaskV1 = { ...task, id, title: trim(task.title) };
		const detail = normalizedOptional(task.detail);
		const error = normalizedOptional(task.error);
		if (detail === undefined) delete normalizedTask.detail;
		else normalizedTask.detail = detail;
		if (error === undefined) delete normalizedTask.error;
		else normalizedTask.error = error;
		tasks.push(normalizedTask);
	}

	const next = cloneState(state);
	const revision = nextRevision(state);
	next.plan = {
		schemaVersion: PLAN_STATE_SCHEMA_VERSION,
		revision,
		id: planId,
		title: trim(rawPlan.title),
		...(normalizedOptional(rawPlan.summary) !== undefined ? { summary: normalizedOptional(rawPlan.summary) } : {}),
		tasks,
		lifecycle: "awaitingApproval",
		...(updatedAt(event, options) !== undefined ? { updatedAt: updatedAt(event, options) } : {}),
	};
	next.usedPlanIds = normalizeUsedPlanIds([...next.usedPlanIds, planId], planId);
	return applied(next, revision);
}

function applyTaskUpdate(state: PlanStateV1, event: Extract<PlanEventV1, { event: "task_update" }>, options: PlanReduceOptionsV1): PlanEventApplyResultV1 {
	const schemaError = validateSchema(state, event);
	if (schemaError) return schemaError;
	const current = state.plan;
	if (!current) return rejected(state, "no published plan", undefined);
	const identityError = planIdentityError(event.planId, current.id);
	if (identityError) return rejected(state, identityError, current.revision);
	if (current.lifecycle !== "running") {
		return rejected(state, current.lifecycle === "awaitingApproval" ? "plan is awaiting approval" : "plan is cancelled", current.revision);
	}
	const update = event.task as PlanTaskUpdateV1;
	if (!update || typeof update !== "object") return rejected(state, "task must be an object", current.revision);
	if (typeof update.id !== "string" || trim(update.id).length === 0) return rejected(state, "task.id must be a non-empty string", current.revision);
	if (!validTaskState(update.state)) return rejected(state, "task.state must be a known plan state", current.revision);
	const taskId = trim(update.id);
	const index = current.tasks.findIndex((task) => task.id === taskId);
	if (index < 0) return rejected(state, `unknown task id ${taskId}`, current.revision);
	const previous = current.tasks[index];
	if (!canTransition(previous.state, update.state)) {
		return rejected(state, `illegal task transition ${previous.state} → ${update.state}`, current.revision);
	}
	if (hasOwn(update, "title") && (typeof update.title !== "string" || trim(update.title).length === 0)) {
		return rejected(state, "task.title must be a non-empty string when present", current.revision);
	}
	if (hasOwn(update, "detail") && typeof update.detail !== "string") return rejected(state, "task.detail must be a string when present", current.revision);
	if (hasOwn(update, "error") && typeof update.error !== "string") return rejected(state, "task.error must be a string when present", current.revision);

	const next = cloneState(state);
	const plan = next.plan!;
	const task = { ...plan.tasks[index], state: update.state };
	if (hasOwn(update, "title")) task.title = trim(update.title!);
	if (hasOwn(update, "detail")) {
		const detail = normalizedOptional(update.detail);
		if (detail === undefined) delete task.detail;
		else task.detail = detail;
	}
	if (hasOwn(update, "error")) {
		const error = normalizedOptional(update.error);
		if (error === undefined) delete task.error;
		else task.error = error;
	}
	if (clearsStaleText(update.state)) {
		if (!hasOwn(update, "detail")) delete task.detail;
		if (!hasOwn(update, "error")) delete task.error;
	}
	const revision = nextRevision(state);
	plan.tasks[index] = task;
	plan.revision = revision;
	plan.schemaVersion = PLAN_STATE_SCHEMA_VERSION;
	const timestamp = updatedAt(event, options);
	if (timestamp !== undefined) plan.updatedAt = timestamp;
	return applied(next, revision);
}

function applyApprove(state: PlanStateV1, event: Extract<PlanEventV1, { event: "approve" }>, options: PlanReduceOptionsV1): PlanEventApplyResultV1 {
	const schemaError = validateSchema(state, event);
	if (schemaError) return schemaError;
	const current = state.plan;
	if (!current) return rejected(state, "no published plan", undefined);
	const identityError = planIdentityError(event.planId, current.id);
	if (identityError) return rejected(state, identityError, current.revision);
	if (current.lifecycle !== "awaitingApproval") {
		return rejected(state, current.lifecycle === "cancelled" ? "plan is cancelled" : "plan is already running", current.revision);
	}
	const next = cloneState(state);
	const revision = nextRevision(state);
	next.plan!.lifecycle = "running";
	next.plan!.revision = revision;
	const timestamp = updatedAt(event, options);
	if (timestamp !== undefined) next.plan!.updatedAt = timestamp;
	return applied(next, revision);
}

function applyCancel(state: PlanStateV1, event: Extract<PlanEventV1, { event: "cancel" }>, options: PlanReduceOptionsV1): PlanEventApplyResultV1 {
	const schemaError = validateSchema(state, event);
	if (schemaError) return schemaError;
	const current = state.plan;
	if (!current) return rejected(state, "no published plan", undefined);
	const identityError = planIdentityError(event.planId, current.id);
	if (identityError) return rejected(state, identityError, current.revision);
	if (current.lifecycle === "cancelled") return rejected(state, "plan is cancelled", current.revision);
	const next = cloneState(state);
	const revision = nextRevision(state);
	next.plan!.lifecycle = "cancelled";
	next.plan!.revision = revision;
	const timestamp = updatedAt(event, options);
	if (timestamp !== undefined) next.plan!.updatedAt = timestamp;
	return applied(next, revision);
}

/**
 * Pure PlanStore-equivalent reducer for the portable host. Revisions are assigned
 * here; callers never send one in PlanEventV1.
 */
export function applyPlanEventV1(
	state: PlanStateV1,
	event: PlanEventV1,
	options: PlanReduceOptionsV1 = {},
): PlanEventApplyResultV1 {
	switch (event.event) {
		case "publish":
			return applyPublish(state, event, options);
		case "task_update":
			return applyTaskUpdate(state, event, options);
		case "approve":
			return applyApprove(state, event, options);
		case "cancel":
			return applyCancel(state, event, options);
		default:
			return rejected(state, "unknown plan event");
	}
}

export const reducePlanEventV1 = applyPlanEventV1;

/** Decode at the portable boundary before passing events into the pure plan reducer. */
export function decodeAndApplyPlanEventV1(
	state: PlanStateV1,
	raw: unknown,
	options: PlanReduceOptionsV1 = {},
): DecodedPlanEventApplyResultV1 {
	const decoded = decodePlanEventV1(raw);
	if (!decoded.ok) {
		return {
			state,
			response: rejected(state, "invalid PlanEventV1").response,
			applied: false,
			diagnostics: decoded.diagnostics,
		};
	}
	const result = applyPlanEventV1(state, decoded.value, options);
	return { ...result, applied: result.response.applied, diagnostics: decoded.diagnostics };
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeTask(raw: unknown, path: string): VersionedStateDecodeResultV1<PlanTaskV1> {
	if (!record(raw) || typeof raw.id !== "string" || trim(raw.id).length === 0 || typeof raw.title !== "string" || trim(raw.title).length === 0 || !validTaskState(raw.state)) {
		return { ok: false, error: `${path} is invalid` };
	}
	if (hasOwn(raw, "detail") && typeof raw.detail !== "string") return { ok: false, error: `${path}.detail must be string` };
	if (hasOwn(raw, "error") && typeof raw.error !== "string") return { ok: false, error: `${path}.error must be string` };
	const task: PlanTaskV1 = { ...raw, id: trim(raw.id), title: trim(raw.title), state: raw.state } as PlanTaskV1;
	const detail = normalizedOptional(raw.detail as string | undefined);
	const error = normalizedOptional(raw.error as string | undefined);
	if (detail === undefined) delete task.detail;
	else task.detail = detail;
	if (error === undefined) delete task.error;
	else task.error = error;
	return { ok: true, value: task };
}

function decodePlanSnapshot(raw: unknown): VersionedStateDecodeResultV1<PlanSnapshotV1> {
	if (!record(raw) || raw.schemaVersion !== PLAN_STATE_SCHEMA_VERSION || typeof raw.revision !== "number" || !Number.isInteger(raw.revision) || raw.revision < 0 || typeof raw.id !== "string" || trim(raw.id).length === 0 || typeof raw.title !== "string" || trim(raw.title).length === 0 || !Array.isArray(raw.tasks) || !["awaitingApproval", "running", "cancelled"].includes(raw.lifecycle as string)) {
		return { ok: false, error: "invalid PlanSnapshotV1" };
	}
	if (raw.tasks.length > PLAN_MAX_TASKS_V1) return { ok: false, error: `plan.tasks exceeds max of ${PLAN_MAX_TASKS_V1}` };
	const tasks: PlanTaskV1[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < raw.tasks.length; index++) {
		const decoded = decodeTask(raw.tasks[index], `tasks[${index}]`);
		if (!decoded.ok) return decoded;
		if (seen.has(decoded.value.id)) return { ok: false, error: `duplicate task id ${decoded.value.id}` };
		seen.add(decoded.value.id);
		tasks.push(decoded.value);
	}
	if (hasOwn(raw, "summary") && typeof raw.summary !== "string") return { ok: false, error: "summary must be string" };
	if (hasOwn(raw, "updatedAt") && typeof raw.updatedAt !== "string") return { ok: false, error: "updatedAt must be string" };
	return {
		ok: true,
		value: {
			schemaVersion: PLAN_STATE_SCHEMA_VERSION,
			revision: raw.revision,
			id: trim(raw.id),
			title: trim(raw.title),
			...(normalizedOptional(raw.summary as string | undefined) !== undefined ? { summary: normalizedOptional(raw.summary as string | undefined) } : {}),
			tasks,
			lifecycle: raw.lifecycle as PlanLifecycleV1,
			...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
		},
	};
}

export function decodePlanStateV1(raw: unknown): VersionedStateDecodeResultV1<PlanStateV1> {
	if (!record(raw) || raw.schemaVersion !== PLAN_STATE_SCHEMA_VERSION || !Array.isArray(raw.usedPlanIds) || !raw.usedPlanIds.every((id) => typeof id === "string")) {
		return { ok: false, error: "invalid PlanStateV1 envelope" };
	}
	let plan: PlanSnapshotV1 | undefined;
	if (hasOwn(raw, "plan") && raw.plan !== undefined && raw.plan !== null) {
		const decoded = decodePlanSnapshot(raw.plan);
		if (!decoded.ok) return decoded;
		plan = decoded.value;
	}
	let usedPlanIds = normalizeUsedPlanIds(raw.usedPlanIds, plan?.id);
	if (plan && !usedPlanIds.includes(plan.id)) usedPlanIds = normalizeUsedPlanIds([...usedPlanIds, plan.id], plan.id);
	return { ok: true, value: { schemaVersion: PLAN_STATE_SCHEMA_VERSION, ...(plan ? { plan } : {}), usedPlanIds } };
}

export const planStateCodecV1: VersionedStateCodecV1<PlanStateV1> = {
	schemaVersion: PLAN_STATE_SCHEMA_VERSION,
	createEmpty: createPlanStateV1,
	decode: decodePlanStateV1,
	encode: (state) => state,
};

export function loadPlanStateV1(
	storage: PortableStateStorageAdapterV1,
	path: string,
): Promise<PortableStateLoadResultV1<PlanStateV1>> {
	return loadVersionedStateV1(storage, path, planStateCodecV1);
}

export function savePlanStateV1(
	storage: PortableStateStorageAdapterV1,
	path: string,
	state: PlanStateV1,
): Promise<PortableStateSaveResultV1> {
	return saveVersionedStateV1(storage, path, planStateCodecV1, state);
}

/** Optional persistence seam; Electron supplies both the adapter and the path. */
export function createPlanStatePersistenceV1(
	storage: PortableStateStorageAdapterV1,
	path: string,
): { load(): Promise<PortableStateLoadResultV1<PlanStateV1>>; save(state: PlanStateV1): Promise<PortableStateSaveResultV1> } {
	return {
		load: () => loadPlanStateV1(storage, path),
		save: (state) => savePlanStateV1(storage, path, state),
	};
}
