import { randomUUID } from "node:crypto";
import {
  grantsForComputerRole,
  type ComputerWorkerGrant,
  type ComputerWorkerRole,
} from "./worker-broker.ts";
import { isComputerWorkerRole } from "./workers.ts";
import type { ComputerTaskEvent } from "./plan.ts";
import { validateTerminalBoundaryShape, type TerminalStepPolicy } from "./terminal-policy.ts";

export type ComputerPostcondition =
  | { kind: "visible_text"; contains: string }
  | { kind: "element_exists"; name: string }
  | { kind: "file_exists"; path: string }
  | { kind: "visual_judgement"; description: string };

export type ComputerObservation = {
  id: string;
  visibleText?: string[];
  elements?: Array<{ name?: string; value?: string; role?: string }>;
  files?: Array<{ path: string; exists: boolean; type?: string; digest?: string }>;
};

export type ComputerPlanStep = {
  id: string;
  role: "gui-operator" | "terminal-worker" | "verifier";
  objective: string;
  dependsOn: string[];
  postconditions: ComputerPostcondition[];
  terminalPolicy?: Omit<TerminalStepPolicy, "commands">;
};

export type ComputerPlan = {
  goal: string;
  mode: "direct" | "planned";
  successConditions: ComputerPostcondition[];
  steps: ComputerPlanStep[];
  revision?: number;
  procedureContext?: { application: { bundleId: string; appName: string }; parameters: Record<string, string>; qualification?: boolean };
};

export type ComputerWorkerDispatch = {
  taskId: string;
  stepId: string;
  role: ComputerWorkerRole;
  objective: string;
  postconditions: ComputerPostcondition[];
  grants: ComputerWorkerGrant[];
  observation?: ComputerObservation;
  terminalPolicy?: Omit<TerminalStepPolicy, "commands">;
};

export type ComputerWorkerResult = {
  outcome: "completed" | "verified" | "failed" | "blocked" | "outcome_unknown";
  summary: string;
  claims?: string[];
  observation?: ComputerObservation;
  artifactReferences?: Array<{ id: string; kind: "screenshot" | "accessibility" | "terminal" | "trajectory" | "file"; summary: string; digest: string; byteLength: number }>;
  trajectory?: string;
};
export type HostExecutionRecord =
  | { role: "gui-operator"; kind: "open_application" | "click" | "type_parameter"; bundleId?: string; appName?: string; locator?: { role: string; nameLiteral: string }; observationId: string; observedAt: string }
  | { role: "terminal-worker"; kind: "write_parameterized_file"; path: string; byteLength: number; contentDigest: string; observationId: string; observedAt: string };
export type ComputerWorkerDispatchResult = { workerResult: ComputerWorkerResult; hostExecutionRecords: HostExecutionRecord[] };

export type ComputerTaskResult = {
  outcome: "succeeded" | "blocked" | "failed" | "cancelled";
  summary: string;
  verification: {
    status: "verified" | "not_verified" | "unknown";
    conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" | "unknown" }>;
  };
  planRevisions: number;
};

type Planner = {
  plan(goal: string): Promise<ComputerPlan>;
  replan(input: {
    plan: ComputerPlan;
    failedStep: ComputerPlanStep;
    result: ComputerWorkerResult;
    observation?: ComputerObservation;
  }): Promise<ComputerPlan>;
};

type Dispatcher = {
  dispatch(request: ComputerWorkerDispatch, signal?: AbortSignal): Promise<ComputerWorkerResult | ComputerWorkerDispatchResult>;
};

type ProcedureLearning = {
  recordVerifiedExecution(input: {
    taskId: string;
    runId: string;
    goal: string;
    plan: ComputerPlan;
    steps: Array<{ stepId: string; role: ComputerWorkerRole; outcome: string; artifactReferences: ComputerWorkerResult["artifactReferences"]; hostExecutionRecords: HostExecutionRecord[] }>;
    verificationObservationIds: string[];
  }): Promise<void>;
};

const WORKER_SUMMARY: Record<ComputerWorkerResult["outcome"], string> = { completed: "Worker completed", verified: "Verifier completed", failed: "Worker failed", blocked: "Worker blocked", outcome_unknown: "Worker outcome unknown" };
const ARTIFACT_SUMMARY: Record<NonNullable<ComputerWorkerResult["artifactReferences"]>[number]["kind"], string> = { screenshot: "Screenshot artifact", accessibility: "Accessibility artifact", terminal: "Terminal artifact", trajectory: "Trajectory artifact", file: "File artifact" };

export function projectComputerWorkerResult(value: ComputerWorkerResult): ComputerWorkerResult {
  const observation = value.observation && typeof value.observation.id === "string" ? {
    id: /^[A-Za-z0-9:_-]{1,160}$/.test(value.observation.id) ? value.observation.id : "observation:redacted",
    visibleText: (value.observation.visibleText ?? []).slice(0, 32),
    elements: (value.observation.elements ?? []).slice(0, 128).map((item) => ({
      role: item.role,
      name: item.name,
      value: item.value,
    })),
    files: (value.observation.files ?? []).slice(0, 32),
  } : undefined;
  const artifactReferences = (value.artifactReferences ?? []).filter((item: any) =>
    item && typeof item.id === "string" && /^artifact:[A-Za-z0-9:-]{1,160}$/.test(item.id)
    && ["screenshot", "accessibility", "terminal", "trajectory", "file"].includes(item.kind)
    && typeof item.digest === "string" && /^[a-f0-9]{64}$/i.test(item.digest)
    && Number.isInteger(item.byteLength) && item.byteLength >= 0
  ).slice(0, 12).map((item: any) => ({ id: item.id, kind: item.kind, summary: ARTIFACT_SUMMARY[item.kind as keyof typeof ARTIFACT_SUMMARY], digest: item.digest.toLowerCase(), byteLength: item.byteLength }));
  const outcome = ["completed", "verified", "failed", "blocked", "outcome_unknown"].includes(value.outcome) ? value.outcome : "failed";
  return {
    outcome,
    summary: WORKER_SUMMARY[outcome],
    ...(observation ? { observation } : {}),
    ...(artifactReferences.length ? { artifactReferences } : {}),
  };
}

function isSubjective(condition: ComputerPostcondition): boolean {
  return condition.kind === "visual_judgement";
}

function verifiedConditionResults(conditions: ComputerPostcondition[], prefix: string) {
  return { status: "verified" as const, conditionResults: conditions.map((_condition, index) => ({ conditionId: `${prefix}:${index}`, outcome: "verified" as const })) };
}

export function evaluatePostconditions(
  conditions: ComputerPostcondition[],
  observation: ComputerObservation | undefined,
  conditionPrefix = "condition",
): { status: "verified" | "not_verified" | "unknown"; conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" | "unknown" }> } {
  const unknown = conditions.map((_condition, index) => ({ conditionId: `${conditionPrefix}:${index}`, outcome: "unknown" as const }));
  if (!observation || conditions.length === 0 || conditions.some(isSubjective)) return { status: "unknown", conditionResults: unknown };
  const conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" }> = [];
  for (let index = 0; index < conditions.length; index += 1) {
    const condition = conditions[index];
    const conditionId = `${conditionPrefix}:${index}`;
    if (condition.kind === "visible_text") {
      const present = (observation.visibleText ?? []).some((text) => text.includes(condition.contains));
      conditionResults.push({ conditionId, outcome: present ? "verified" : "not_verified" });
      if (!present) return { status: "not_verified", conditionResults };
    } else if (condition.kind === "element_exists") {
      const present = (observation.elements ?? []).some((element) => element.name === condition.name);
      conditionResults.push({ conditionId, outcome: present ? "verified" : "not_verified" });
      if (!present) return { status: "not_verified", conditionResults };
    } else if (condition.kind === "file_exists") {
      const present = (observation.files ?? []).some((file) => file.path === condition.path && file.exists);
      conditionResults.push({ conditionId, outcome: present ? "verified" : "not_verified" });
      if (!present) return { status: "not_verified", conditionResults };
    }
  }
  return { status: "verified", conditionResults };
}

export class ComputerAgentCoordinator {
  readonly #planner: Planner;
  readonly #dispatcher: Dispatcher;
  readonly #maxReplans: number;
  readonly #onEvent?: (event: ComputerTaskEvent) => void;
  readonly #procedureLearning?: ProcedureLearning;

  constructor(input: {
    planner: Planner;
    dispatcher: Dispatcher;
    maxReplans?: number;
    onEvent?: (event: ComputerTaskEvent) => void;
    procedureLearning?: ProcedureLearning;
  }) {
    this.#planner = input.planner;
    this.#dispatcher = input.dispatcher;
    this.#maxReplans = input.maxReplans ?? 2;
    this.#onEvent = input.onEvent;
    this.#procedureLearning = input.procedureLearning;
  }

  async run(request: { goal: string; taskId?: string }, signal?: AbortSignal): Promise<ComputerTaskResult> {
    const goal = request.goal?.trim();
    if (!goal) throw new Error("computer_task requires a non-empty goal");
    const taskId = request.taskId ?? randomUUID();
    const runId = randomUUID();
    this.#emit({ type: "task_started", taskId, summary: "Computer Task started" });
    let plan = await this.#planner.plan(goal);
    this.#validatePlan(plan);
    let revisions = plan.revision ?? 0;
    const completed = new Set<string>();
    const executed: Array<{ stepId: string; role: ComputerWorkerRole; outcome: string; artifactReferences: ComputerWorkerResult["artifactReferences"]; hostExecutionRecords: HostExecutionRecord[] }> = [];
    const verificationObservationIds = new Set<string>();

    while (true) {
      if (signal?.aborted) {
        const cancelled = this.#result("cancelled", "Computer Task cancelled", revisions);
        this.#emit({ type: "task_finished", taskId, outcome: cancelled.outcome });
        return cancelled;
      }
      const step = plan.steps.find((candidate) =>
        !completed.has(candidate.id)
        && candidate.dependsOn.every((dependency) => completed.has(dependency))
      );
      if (!step) {
        const finalObservation = undefined;
        if (plan.steps.every((candidate) => completed.has(candidate.id))) {
          return await this.#succeeded(taskId, runId, goal, plan, executed, verificationObservationIds, {
            outcome: "succeeded",
            summary: "Computer Task completed",
            verification: verifiedConditionResults(plan.successConditions, "task:condition"),
            planRevisions: revisions,
          });
        }
        const blocked = this.#result("blocked", "Computer Task plan has unresolved dependencies", revisions, finalObservation);
        this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
        return blocked;
      }

      this.#emit({ type: "worker_started", taskId, stepId: step.id, role: step.role, parentRole: "computer-use-leader", depth: 1 });
      const dispatched = await this.#dispatch({
        taskId,
        stepId: step.id,
        role: step.role,
        objective: step.objective,
        postconditions: step.postconditions,
        ...(step.terminalPolicy ? { terminalPolicy: step.terminalPolicy } : {}),
        grants: grantsForComputerRole(step.role),
      }, signal);
      const result = dispatched.workerResult;
      executed.push({ stepId: step.id, role: step.role, outcome: result.outcome, artifactReferences: result.artifactReferences, hostExecutionRecords: dispatched.hostExecutionRecords });
      this.#emit({ type: "worker_finished", taskId, stepId: step.id, role: step.role, outcome: result.outcome, parentRole: "computer-use-leader", depth: 1 });
      if (result.outcome === "completed" || result.outcome === "verified") {
        let verification = step.role === "verifier" && result.outcome === "verified" && result.observation?.id
          ? verifiedConditionResults(step.postconditions, `${step.id}:condition`)
          : evaluatePostconditions(step.postconditions, result.observation, `${step.id}:condition`);
        if (verification.status === "verified" && result.observation?.id) verificationObservationIds.add(result.observation.id);
        if (verification.status === "unknown") {
          const verified = await this.#dispatch({
            taskId,
            stepId: `${step.id}-verify`,
            role: "verifier",
            objective: `Obtain a fresh observation and verify: ${step.postconditions.map((condition) => JSON.stringify(condition)).join("; ")}`,
            postconditions: step.postconditions,
            grants: grantsForComputerRole("verifier"),
            observation: result.observation,
          }, signal);
          verification = verified.workerResult.outcome === "verified" && verified.workerResult.observation?.id && verified.workerResult.observation.id !== result.observation?.id
            ? verifiedConditionResults(step.postconditions, `${step.id}:condition`)
            : evaluatePostconditions(step.postconditions, verified.workerResult.observation, `${step.id}:condition`);
          if (verification.status === "verified" && verified.workerResult.observation?.id) verificationObservationIds.add(verified.workerResult.observation.id);
        }
        if (verification.status === "verified") {
          completed.add(step.id);
          if (plan.steps.every((candidate) => completed.has(candidate.id))) {
            const taskVerification = evaluatePostconditions(plan.successConditions, result.observation, "task:condition");
            if (taskVerification.status !== "verified" && JSON.stringify(plan.successConditions) !== JSON.stringify(step.postconditions)) {
              return this.#result("blocked", "Task-level success conditions are not freshly verified", revisions);
            }
            return await this.#succeeded(taskId, runId, goal, plan, executed, verificationObservationIds, {
              outcome: "succeeded",
              summary: "Computer Task completed",
              verification,
              planRevisions: revisions,
            });
          }
          continue;
        }
      }

      let recoveryObservation = result.observation;
      if (result.outcome === "outcome_unknown") {
        const observed = await this.#dispatch({
          taskId,
          stepId: `${step.id}-observe-after-unknown`,
          role: "verifier",
          objective: "Obtain a fresh observation before any mutation retry",
          postconditions: step.postconditions,
          grants: grantsForComputerRole("verifier"),
        }, signal);
        recoveryObservation = observed.workerResult.observation;
        const recovered = evaluatePostconditions(step.postconditions, recoveryObservation, `${step.id}:condition`);
        if (recovered.status === "verified") {
          completed.add(step.id);
          if (plan.steps.every((candidate) => completed.has(candidate.id))) {
            return await this.#succeeded(taskId, runId, goal, plan, executed, verificationObservationIds, {
              outcome: "succeeded",
              summary: "Computer Task completed",
              verification: recovered,
              planRevisions: revisions,
            });
          }
          continue;
        }
      }

      if (revisions >= this.#maxReplans) {
        const blocked = this.#result("blocked", "Computer Task replan budget exhausted", revisions, recoveryObservation);
        this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
        return blocked;
      }
      plan = await this.#planner.replan({
        plan,
        failedStep: step,
        result,
        observation: recoveryObservation,
      });
      this.#validatePlan(plan);
      revisions += 1;
      this.#emit({ type: "plan_revised", taskId, revision: revisions, stepSummaries: plan.steps.map(({ id, role }) => `${role}:${id}`.slice(0, 240)) });
    }
  }

  #validatePlan(plan: ComputerPlan): void {
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error("Computer Plan requires at least one step");
    const ids = new Set(plan.steps.map(({ id }) => id));
    if (ids.size !== plan.steps.length) throw new Error("Computer Plan step IDs must be unique");
    for (const step of plan.steps) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(step.id)) throw new Error("Computer Plan step IDs must be trusted identifier tokens");
      if (!isComputerWorkerRole(step.role)) throw new Error(`Leader may dispatch only a fixed Computer Worker role: ${String(step.role)}`);
      if (step.role === "terminal-worker") {
        if (!step.terminalPolicy) throw new Error(`Terminal Worker step ${step.id} requires a bounded terminal policy`);
        validateTerminalBoundaryShape(step.terminalPolicy);
        if (!step.postconditions.some((condition) => condition.kind === "file_exists")) {
          throw new Error(`Terminal Worker step ${step.id} requires an observable file Postcondition`);
        }
      } else if (step.terminalPolicy) {
        throw new Error(`Only Terminal Worker step ${step.id} may carry a terminal policy`);
      }
      if (step.dependsOn.some((dependency) => !ids.has(dependency) || dependency === step.id)) {
        throw new Error(`Computer Plan step ${step.id} has an invalid dependency`);
      }
    }
  }

  async #dispatch(request: ComputerWorkerDispatch, signal?: AbortSignal): Promise<ComputerWorkerDispatchResult> {
    try {
      const dispatched = await this.#dispatcher.dispatch(request, signal);
      if ("workerResult" in dispatched && Array.isArray(dispatched.hostExecutionRecords)) return { workerResult: projectComputerWorkerResult(dispatched.workerResult), hostExecutionRecords: structuredClone(dispatched.hostExecutionRecords) };
      return { workerResult: projectComputerWorkerResult(dispatched), hostExecutionRecords: [] };
    } catch (error) {
      return { workerResult: projectComputerWorkerResult({ outcome: "failed", summary: error instanceof Error ? error.message : "Computer Worker failed" }), hostExecutionRecords: [] };
    }
  }

  async #succeeded(taskId: string, runId: string, goal: string, plan: ComputerPlan, steps: Array<{ stepId: string; role: ComputerWorkerRole; outcome: string; artifactReferences: ComputerWorkerResult["artifactReferences"]; hostExecutionRecords: HostExecutionRecord[] }>, observationIds: Set<string>, result: ComputerTaskResult): Promise<ComputerTaskResult> {
    const trustedPlan: ComputerPlan = {
      goal: String(plan.goal), mode: plan.mode,
      successConditions: structuredClone(plan.successConditions),
      steps: plan.steps.map((step) => ({ id: step.id, role: step.role, objective: step.objective, dependsOn: [...step.dependsOn], postconditions: structuredClone(step.postconditions), ...(step.terminalPolicy ? { terminalPolicy: structuredClone(step.terminalPolicy) } : {}) })),
      ...(Number.isInteger(plan.revision) ? { revision: plan.revision } : {}),
      ...(plan.procedureContext ? { procedureContext: structuredClone(plan.procedureContext) } : {}),
    };
    await this.#procedureLearning?.recordVerifiedExecution({ taskId, runId, goal, plan: trustedPlan, steps: structuredClone(steps), verificationObservationIds: [...observationIds] }).catch(() => {});
    result.summary = "Computer Task completed";
    this.#emit({ type: "verification", taskId, status: result.verification.status, conditionResults: result.verification.conditionResults });
    this.#emit({ type: "task_finished", taskId, outcome: result.outcome });
    return result;
  }

  #emit(event: ComputerTaskEvent): void {
    try { this.#onEvent?.(event); } catch { /* UI observation cannot alter task semantics. */ }
  }

  #result(
    outcome: "blocked" | "failed" | "cancelled",
    summary: string,
    planRevisions: number,
    _observation?: ComputerObservation,
  ): ComputerTaskResult {
    return {
      outcome,
      summary: outcome === "cancelled" ? "Computer Task cancelled" : outcome === "blocked" ? "Computer Task blocked" : "Computer Task failed",
      verification: { status: "not_verified", conditionResults: [] },
      planRevisions,
    };
  }
}
