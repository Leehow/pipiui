import { createHash, randomBytes, randomUUID } from "node:crypto";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { validateDesktopActions } from "./desktop-actions.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { conditionDescription, createTaskCheckpoint, reconcileTaskCheckpoint, type DesktopCondition, type TaskCheckpoint } from "./checkpoint.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { runGuardedActionBlock, type ActionBlockRequest, type ActionBlockResult, type WorkflowMaturity } from "./action-block.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { taskFamilyForGoal, type WorkflowMemoryStore } from "./workflows.ts";

export type ComputerWorkerRole = "gui-operator" | "terminal-worker" | "verifier";
export type ComputerDesktopRole = ComputerWorkerRole | "computer-use-agent";
export type ComputerWorkerGrant = "observe" | "mutate" | "openApplication";
export type ComputerWorkerOperation = ComputerWorkerGrant | "locate" | "actionBlock";
type ComputerWorkerFatalCode = "computer_worker_runtime_timeout" | "computer_worker_request_cancelled" | "computer_worker_no_progress";
const MAX_CONSECUTIVE_OBSERVATIONS = 3;

export type HostGuiExecutionRecord = {
  kind: "open_application" | "click" | "type_parameter";
  bundleId?: string;
  appName?: string;
  locator?: { role: string; nameLiteral: string };
  observationId: string;
  observedAt: string;
};

export type ComputerWorkerBrokerRequest = {
  operation: ComputerWorkerOperation;
  payload: Record<string, unknown>;
};

export type ComputerRuntimeAdapter = {
  request(request: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
};

type RuntimeCancellationEvent = {
  taskId: string;
  stepId: string;
  runId: string;
  reason: "computer_worker_runtime_timeout";
};

type GrantRecord = {
  taskId: string;
  stepId: string;
  runId: string;
  role: ComputerDesktopRole;
  goal?: string;
  grants: ReadonlySet<ComputerWorkerGrant>;
  lastObservation?: Record<string, unknown>;
  bindings: Map<string, { role: string; nameLiteral: string }>;
  executions: HostGuiExecutionRecord[];
  controllers: Set<AbortController>;
	busy: boolean;
	fatalCode?: ComputerWorkerFatalCode;
	consecutiveObservations: number;
  /** Legacy worker-only pacing; the normal Computer Use Agent uses guarded blocks instead. */
  requiresFreshObservation: boolean;
  checkpoint?: TaskCheckpoint;
  maturity: WorkflowMaturity;
  actionBlocks: ActionBlockRequest[];
  receiptRefs: string[];
  workflowRecall: Array<Record<string, unknown>>;
  noProgress?: {
    signature: string;
    fingerprint: string;
    requiresObserve: boolean;
    exhausted: boolean;
  };
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const hasStableElementIndex = Number.isInteger(record.element_index);
		return `{${Object.entries(record)
		.filter(([key]) => !["screenshotId", "observationId", "snapshot_id"].includes(key) && !(key === "element_token" && hasStableElementIndex))
    .sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
	}
  return JSON.stringify(value);
}

export function observationFingerprint(value: Record<string, unknown> | undefined): string {
  if (!value) return "";
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function mutationSignature(actions: unknown): string {
  return createHash("sha256").update(stable(actions)).digest("hex");
}

export function grantsForComputerRole(role: ComputerDesktopRole): ComputerWorkerGrant[] {
  if (role === "gui-operator" || role === "computer-use-agent") return ["observe", "mutate", "openApplication"];
  if (role === "verifier") return ["observe"];
  return [];
}

export type IssuedComputerWorkerGrant = {
  token: string;
  grants: ComputerWorkerGrant[];
  environment: Record<string, string>;
};

export class ComputerWorkerBroker {
  readonly #runtime: ComputerRuntimeAdapter;
  readonly #tokenFactory: () => string;
  readonly #grants = new Map<string, GrantRecord>();
		readonly #requestTimeoutMs: number;
	readonly #onFatal?: (event: { taskId: string; stepId: string; runId: string; code: ComputerWorkerFatalCode }) => void;
  readonly #cancelRuntime?: (event: RuntimeCancellationEvent) => Promise<void> | void;
  readonly #workflowMemory?: WorkflowMemoryStore;

  constructor(input: {
    request: ComputerRuntimeAdapter["request"];
    tokenFactory?: () => string;
			requestTimeoutMs?: number;
		onFatal?: (event: { taskId: string; stepId: string; runId: string; code: ComputerWorkerFatalCode }) => void;
    cancelRuntime?: (event: RuntimeCancellationEvent) => Promise<void> | void;
    workflowMemory?: WorkflowMemoryStore;
  }) {
    this.#runtime = { request: input.request };
    this.#tokenFactory = input.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
			this.#requestTimeoutMs = Math.min(120_000, Math.max(10, input.requestTimeoutMs ?? 35_000));
		this.#onFatal = input.onFatal;
    this.#cancelRuntime = input.cancelRuntime;
    this.#workflowMemory = input.workflowMemory;
  }

  issue(input: {
    taskId: string;
    stepId: string;
    runId: string;
    role: ComputerDesktopRole;
    goal?: string;
  }): IssuedComputerWorkerGrant {
    if (input.role === "terminal-worker") {
      throw new Error("Terminal Worker does not receive a desktop broker capability or desktop environment");
    }
    const values = [input.taskId, input.stepId, input.runId];
    if (values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
      throw new Error("computer worker grant requires non-empty taskId, stepId, and runId");
    }
    let token = this.#tokenFactory();
    if (typeof token !== "string" || token.length < 32) {
      throw new Error("computer worker broker token must contain at least 32 characters");
    }
    if (this.#grants.has(token)) {
      token = `${token}.${randomBytes(16).toString("base64url")}`;
    }
    const grants = grantsForComputerRole(input.role);
    if (input.role === "computer-use-agent" && !input.goal?.trim()) throw new Error("Computer Use Agent grant requires the task goal");
    this.#grants.set(token, {
      ...input,
      grants: new Set(grants),
      bindings: new Map(),
      executions: [],
      controllers: new Set(),
				busy: false,
		consecutiveObservations: 0,
      requiresFreshObservation: false,
      ...(input.role === "computer-use-agent" ? { checkpoint: createTaskCheckpoint({ taskId: input.taskId, goal: input.goal! }) } : {}),
      maturity: "cold",
      actionBlocks: [],
      receiptRefs: [],
      workflowRecall: [],
    });
    return {
      token,
      grants,
      environment: {
        PIPIUI_COMPUTER_WORKER_BROKER_TOKEN: token,
        PIPIUI_COMPUTER_WORKER_TASK_ID: input.taskId,
        PIPIUI_COMPUTER_WORKER_STEP_ID: input.stepId,
        PIPIUI_COMPUTER_WORKER_ROLE: input.role,
      },
    };
  }

  async execute(
    token: string,
    request: ComputerWorkerBrokerRequest,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
	    const grant = this.#grants.get(token);
	    if (!grant) throw new Error("computer worker capability is unknown or revoked");
		if (grant.fatalCode) throw new Error(grant.fatalCode);
    const requiredGrant = request.operation === "locate" ? "observe" : request.operation === "actionBlock" ? "mutate" : request.operation;
    if (!grant.grants.has(requiredGrant)) {
      throw new Error(`computer worker role ${grant.role} does not grant ${request.operation}`);
    }
    if (request.operation === "actionBlock" && grant.role !== "computer-use-agent") throw new Error("actionBlock is reserved for the Computer Use Agent");
    const reservedEnvelopeFields = new Set([
      "action", "taskId", "stepId", "runId", "sessionKey", "computerCapability",
      "protocolVersion", "requestID", "displayID", "displayWidth", "displayHeight",
    ]);
    if (request.operation !== "mutate" && request.operation !== "actionBlock") reservedEnvelopeFields.add("actions");
    const allowedPayloadFields = request.operation === "observe"
      ? new Set(["fresh", "constraints", "successConditions"])
      : request.operation === "locate"
        ? new Set(["role", "name", "value"])
      : request.operation === "actionBlock"
        ? new Set(["intent", "actions", "expectedEffects"])
      : request.operation === "mutate"
        ? new Set(["actions", "semanticBindings"])
        : new Set(["bundle_identifier", "application_name"]);
    for (const key of Object.keys(request.payload)) {
      if (reservedEnvelopeFields.has(key)) throw new Error(`forbidden broker envelope field: ${key}`);
      if (!allowedPayloadFields.has(key)) throw new Error(`forbidden broker payload field for ${request.operation}: ${key}`);
    }
    if (request.operation === "observe" && request.payload.fresh !== undefined && typeof request.payload.fresh !== "boolean") throw new Error("observe fresh must be boolean");
    if (request.operation === "observe" && request.payload.constraints !== undefined && (!Array.isArray(request.payload.constraints) || !request.payload.constraints.every((item) => typeof item === "string"))) throw new Error("observe constraints must be strings");
    if (request.operation === "observe" && request.payload.successConditions !== undefined && !Array.isArray(request.payload.successConditions)) throw new Error("observe successConditions must be an array");
    if (request.operation === "observe" && grant.checkpoint) {
      if (Array.isArray(request.payload.constraints)) grant.checkpoint.constraints = [...new Set(request.payload.constraints as string[])];
      if (Array.isArray(request.payload.successConditions)) grant.checkpoint.successConditions = structuredClone(request.payload.successConditions as DesktopCondition[]);
    }
    if (request.operation === "locate") {
      const elements = Array.isArray((grant.lastObservation as any)?.accessibility?.elements) ? (grant.lastObservation as any).accessibility.elements : [];
      const matches = elements.filter((element: any) =>
        (request.payload.role === undefined || String(element.role ?? "").toLowerCase() === String(request.payload.role).toLowerCase())
        && (request.payload.name === undefined || String(element.name ?? "").toLowerCase().includes(String(request.payload.name).toLowerCase()))
        && (request.payload.value === undefined || String(element.value ?? "").toLowerCase().includes(String(request.payload.value).toLowerCase())));
      if (matches.length !== 1 || typeof matches[0]?.role !== "string" || typeof matches[0]?.name !== "string") return { status: matches.length ? "ambiguous" : "not_found", matches: matches.slice(0, 12) };
      const bindingId = `binding:${randomUUID()}`;
      grant.bindings.set(bindingId, { role: matches[0].role, nameLiteral: matches[0].name });
      return { status: "resolved", bindingId, match: matches[0] };
    }
    if (request.operation === "actionBlock") {
      const block = structuredClone(request.payload) as ActionBlockRequest;
      if (!grant.lastObservation) await this.execute(token, { operation: "observe", payload: { fresh: true } }, signal);
      const result = await runGuardedActionBlock(block, {
        taskId: grant.taskId,
        runId: grant.runId,
        maturity: grant.maturity,
        checkpoint: grant.checkpoint!,
        observation: grant.lastObservation!,
        signal,
        execute: (actions, actionSignal) => this.execute(token, {
          operation: "mutate",
          payload: { actions, semanticBindings: [] },
        }, actionSignal),
      });
      grant.actionBlocks.push(block);
      grant.receiptRefs.push(result.receiptRef);
      grant.lastObservation = structuredClone(result.observation);
      if (result.outcome === "outcome_unknown") {
        const activeId = grant.checkpoint?.activeWorkflow?.id;
        if (activeId && this.#workflowMemory) {
          const suspended = await this.#workflowMemory.recordFailure(activeId, { kind: "outcome_unknown" }).catch(() => undefined);
          if (suspended && grant.checkpoint) grant.checkpoint.activeWorkflow = { id: suspended.id, version: suspended.version, state: suspended.state };
        }
      }
      return result as unknown as Record<string, unknown>;
    }
    if (request.operation === "mutate") {
      validateDesktopActions(request.payload.actions);
      if (grant.role !== "computer-use-agent") {
        const actions = request.payload.actions as Array<Record<string, unknown>>;
        const mutationIndexes = actions.flatMap((action, index) => ["wait", "screenshot"].includes(String(action.type)) ? [] : [index]);
        if (mutationIndexes.length > 1 || (mutationIndexes.length === 1 && actions.slice(mutationIndexes[0] + 1).some((action) => action.type !== "wait"))) {
          throw new Error("one_state_mutation_per_observation: legacy workers must split the batch and observe between mutations");
        }
        if (grant.requiresFreshObservation) {
          throw new Error("fresh_observation_required_after_mutation: call desktop_observe with fresh=true before another legacy-worker mutation");
        }
      }
    }
    const signature = request.operation === "mutate" && grant.role !== "computer-use-agent" ? mutationSignature(request.payload.actions) : undefined;
    if (request.operation === "mutate" && grant.role !== "computer-use-agent" && grant.noProgress?.requiresObserve) {
      throw new Error("no_progress_requires_fresh_observation: observe and replan before another UI mutation");
    }
    if (request.operation === "mutate" && grant.role !== "computer-use-agent" && signature && grant.noProgress?.exhausted) {
      if (grant.noProgress.signature === signature) {
        throw new Error("no_progress_budget_exhausted: equivalent UI mutation is blocked until the UI or strategy changes");
      }
      grant.noProgress = undefined;
    }
	    if (request.operation === "openApplication" && ![request.payload.bundle_identifier, request.payload.application_name].some((value) => typeof value === "string" && value.trim().length > 0)) throw new Error("openApplication requires an exact application identity");
		if (request.operation === "observe" && grant.role !== "computer-use-agent") {
			grant.consecutiveObservations += 1;
			if (grant.consecutiveObservations > MAX_CONSECUTIVE_OBSERVATIONS) {
				this.#markFatal(grant, "computer_worker_no_progress");
				throw new Error("computer_worker_no_progress");
			}
		}
    const action = request.operation === "openApplication"
      ? "computer_open_application"
      : "computer_batch";
    const payload = request.operation === "observe"
      ? { fresh: request.payload.fresh, actions: [{ type: "screenshot" }] }
      : request.operation === "mutate" ? { actions: request.payload.actions } : request.payload;
    const controller = new AbortController();
		if (grant.busy) throw new Error("computer_worker_request_in_progress");
		grant.busy = true;
    grant.controllers.add(controller);
    if (grant.role !== "computer-use-agent" && (request.operation === "mutate" || request.operation === "openApplication")) grant.requiresFreshObservation = true;
    let timedOut = false;
    let callerAborted = false;
    const abort = () => { callerAborted = true; controller.abort(); };
    signal?.addEventListener("abort", abort, { once: true });
    const beforeFingerprint = observationFingerprint(grant.lastObservation);
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const deadline = new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => {
					timedOut = true;
					controller.abort();
					reject(new Error("computer_worker_runtime_timeout"));
				}, this.#requestTimeoutMs);
				controller.signal.addEventListener("abort", () => {
					if (!timedOut) reject(new Error("computer_worker_request_cancelled"));
				}, { once: true });
			});
			let result: Record<string, unknown>;
			const runtimeRequest = Promise.resolve().then(() => this.#runtime.request({
	      ...payload,
	      action,
	      taskId: grant.taskId,
	      stepId: grant.stepId,
	      runId: grant.runId,
	    }, controller.signal));
			try { result = await Promise.race([runtimeRequest, deadline]); }
			catch (error) {
				const driverTimedOut = error && typeof error === "object" && (error as { code?: unknown }).code === "cua_driver_rpc_timeout";
				if (timedOut || driverTimedOut) {
					if (grant.role !== "computer-use-agent") {
						this.#markFatal(grant, "computer_worker_runtime_timeout");
						throw new Error("computer_worker_runtime_timeout");
					}
					await Promise.resolve(this.#cancelRuntime?.({
						taskId: grant.taskId,
						stepId: grant.stepId,
						runId: grant.runId,
						reason: "computer_worker_runtime_timeout",
					})).catch(() => {});
					throw Object.assign(new Error("computer_worker_runtime_timeout"), {
						code: "computer_worker_runtime_timeout",
						recoverable: true,
					});
				}
				if (callerAborted || controller.signal.aborted) {
					this.#markFatal(grant, "computer_worker_request_cancelled");
					throw new Error("computer_worker_request_cancelled");
				}
				throw error;
			} finally { if (timeout) clearTimeout(timeout); grant.busy = false; grant.controllers.delete(controller); signal?.removeEventListener("abort", abort); }
    const observationId = String((result as any).observationId ?? (result as any).screenshotId ?? "");
    const observedAt = new Date().toISOString();
    if (request.operation === "observe" && grant.noProgress) {
      if (observationFingerprint(result) !== grant.noProgress.fingerprint) {
        grant.noProgress = undefined;
      } else {
        grant.noProgress.requiresObserve = false;
        grant.noProgress.exhausted = true;
      }
    }
	    if (["observe", "mutate", "openApplication"].includes(request.operation)) grant.lastObservation = result;
		if (grant.role !== "computer-use-agent" && request.operation === "observe" && request.payload.fresh !== false) grant.requiresFreshObservation = false;
		if (request.operation === "mutate" || request.operation === "openApplication") grant.consecutiveObservations = 0;
    if (grant.checkpoint && ["observe", "mutate", "openApplication"].includes(request.operation)) {
      reconcileTaskCheckpoint(grant.checkpoint, result);
      (result as any).checkpoint = structuredClone(grant.checkpoint);
    }
    if (request.operation === "mutate" && signature) {
      const unchanged = beforeFingerprint.length > 0 && beforeFingerprint === observationFingerprint(result);
      if (unchanged) {
        grant.noProgress = {
          signature,
          fingerprint: beforeFingerprint,
          requiresObserve: true,
          exhausted: false,
        };
        return {
          ...result,
          noProgress: {
            status: "reobserve_required",
            unchangedAttempts: 1,
            mutationBlockedUntilObserve: true,
          },
        };
      }
      grant.noProgress = undefined;
    }
    if (request.operation === "openApplication" && observationId) {
      const application = {
        bundleId: typeof request.payload.bundle_identifier === "string" ? request.payload.bundle_identifier : String((result as any).target?.bundleId ?? ""),
        appName: typeof request.payload.application_name === "string" ? request.payload.application_name : String((result as any).target?.appName ?? ""),
      };
      grant.executions.push({ kind: "open_application", bundleId: application.bundleId || undefined, appName: application.appName || undefined, observationId, observedAt });
      if (grant.checkpoint && application.bundleId && application.appName) grant.checkpoint.activeApplication = application;
      if (grant.role === "computer-use-agent" && this.#workflowMemory && application.bundleId && application.appName) {
        const recall = await this.#workflowMemory.recall({ application, taskFamily: taskFamilyForGoal(grant.goal!), intent: grant.goal! });
        grant.workflowRecall = recall.entries as unknown as Array<Record<string, unknown>>;
        const workflow = recall.entries.find((entry) => entry.kind === "workflow")?.workflow;
        grant.maturity = workflow?.state === "practiced" ? "practiced" : workflow?.state === "candidate" ? "candidate" : "cold";
        if (workflow && grant.checkpoint) grant.checkpoint.activeWorkflow = { id: workflow.id, version: workflow.version, state: workflow.state };
        (result as any).workflowRecall = recall;
        (result as any).actionBlockMaturity = grant.maturity;
      }
    }
    if (request.operation === "mutate" && observationId && Array.isArray(request.payload.semanticBindings)) {
      for (const item of request.payload.semanticBindings as any[]) {
        const locator = grant.bindings.get(String(item?.bindingId ?? ""));
        if (!locator || !["click", "type_parameter"].includes(String(item?.kind))) throw new Error("mutate semantic binding is unknown or invalid");
        grant.executions.push({ kind: item.kind, locator, observationId, observedAt });
      }
    }
    return result;
  }

  consumeExecutions(taskId: string, stepId: string): HostGuiExecutionRecord[] {
    const records: HostGuiExecutionRecord[] = [];
    for (const grant of this.#grants.values()) if (grant.taskId === taskId && grant.stepId === stepId) { records.push(...grant.executions); grant.executions.length = 0; }
    return structuredClone(records);
  }
	#markFatal(grant: GrantRecord, code: ComputerWorkerFatalCode): void {
		if (grant.fatalCode) return;
		grant.fatalCode = code;
		this.#onFatal?.({ taskId: grant.taskId, stepId: grant.stepId, runId: grant.runId, code });
	}
  observation(taskId: string, stepId: string): Record<string, unknown> | undefined {
    for (const grant of this.#grants.values()) if (grant.taskId === taskId && grant.stepId === stepId && grant.lastObservation) return structuredClone(grant.lastObservation);
    return undefined;
  }

  checkpoint(taskId: string, stepId: string): TaskCheckpoint | undefined {
    for (const grant of this.#grants.values()) if (grant.taskId === taskId && grant.stepId === stepId && grant.checkpoint) return structuredClone(grant.checkpoint);
    return undefined;
  }

  actionBlocks(taskId: string, stepId: string): ActionBlockRequest[] {
    for (const grant of this.#grants.values()) if (grant.taskId === taskId && grant.stepId === stepId) return structuredClone(grant.actionBlocks);
    return [];
  }

  async recordTaskSuccess(taskId: string, stepId: string): Promise<void> {
    if (!this.#workflowMemory) return;
    const grant = [...this.#grants.values()].find((candidate) => candidate.taskId === taskId && candidate.stepId === stepId);
    const checkpoint = grant?.checkpoint;
    const application = checkpoint?.activeApplication;
    const receiptRef = grant?.receiptRefs.at(-1);
    if (!grant || grant.role !== "computer-use-agent" || !checkpoint || !application || !receiptRef || grant.actionBlocks.length === 0) return;
    if (checkpoint.successConditions.length === 0 || checkpoint.pendingUnknownEffects.length > 0) return;
    const verified = new Set(checkpoint.verifiedFacts.map(({ description }) => description));
    if (!checkpoint.successConditions.every((condition) => verified.has(conditionDescription(condition)))) return;
    const workflow = await this.#workflowMemory.recordAutonomousSuccess({
      taskId: grant.taskId,
      runId: grant.runId,
      application,
      taskFamily: taskFamilyForGoal(grant.goal!),
      intent: grant.goal!,
      receiptRef,
      blocks: grant.actionBlocks,
      postconditions: checkpoint.successConditions,
      humanCorrected: false,
    });
    if (workflow) {
      checkpoint.activeWorkflow = { id: workflow.id, version: workflow.version, state: workflow.state };
      grant.maturity = workflow.state === "practiced" ? "practiced" : "candidate";
    }
  }

  revokeStep(taskId: string, stepId: string): void {
    for (const [token, grant] of this.#grants) {
      if (grant.taskId === taskId && grant.stepId === stepId) { for (const controller of grant.controllers) controller.abort(); this.#grants.delete(token); }
    }
  }

  revokeTask(taskId: string): void {
    for (const [token, grant] of this.#grants) {
      if (grant.taskId === taskId) { for (const controller of grant.controllers) controller.abort(); this.#grants.delete(token); }
    }
  }
}
