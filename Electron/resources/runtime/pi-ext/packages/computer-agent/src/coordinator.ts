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
  /** Host-filtered, exact requested conditions attested by a fresh multimodal Verifier. */
  attestedPostconditions?: ComputerPostcondition[];
  observation?: ComputerObservation;
  artifactReferences?: Array<{ id: string; kind: "screenshot" | "accessibility" | "terminal" | "trajectory" | "file"; summary: string; digest: string; byteLength: number }>;
  trajectory?: string;
  failureCode?: ComputerWorkerFailureCode;
};
export const COMPUTER_WORKER_FAILURE_CODES = [
  "gui_broker_start_failed", "gui_grant_issue_failed", "gui_private_resource_failed",
  "gui_child_prestart_failed", "gui_child_failed", "gui_child_stalled", "computer_worker_dispatch_failed",
	"computer_worker_runtime_timeout", "computer_worker_request_cancelled",
	"computer_worker_no_progress",
] as const;
export type ComputerWorkerFailureCode = typeof COMPUTER_WORKER_FAILURE_CODES[number];

export async function runComputerWorkerWithStallDeadline<T>(
  run: () => Promise<T>,
  onStalled: () => void,
  timeoutMs = 150_000,
): Promise<T> {
  const operation = Promise.resolve().then(run);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      try { onStalled(); } catch { /* The closed failure still wins if best-effort abort reporting fails. */ }
      reject(Object.assign(new Error("gui_child_stalled"), { failureCode: "gui_child_stalled" as const }));
    }, Math.max(10, timeoutMs));
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
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
  investigation?: {
    stage: "task_verification" | "recovery_exhausted" | "recovery_plan" | "plan_dependencies" | "cancelled";
    code: "task_conditions_not_verified" | "worker_postconditions_not_verified" | "worker_failed" | "worker_blocked" | "worker_outcome_unknown" | "recovery_plan_invalid" | "unresolved_dependencies" | "task_cancelled" | ComputerWorkerFailureCode;
    recoveryAttempts: number;
    failedConditions: Array<{ conditionId: string; kind: ComputerPostcondition["kind"]; outcome: "not_verified" | "unknown" }>;
    workerAttempts: Array<{
      stepId: string;
      role: ComputerWorkerRole;
      outcome: ComputerWorkerResult["outcome"];
      verification: "verified" | "not_verified" | "unknown";
      failureCode?: ComputerWorkerFailureCode;
    }>;
  };
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

function closedPostcondition(value: unknown): ComputerPostcondition | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.kind === "visible_text" && Object.keys(item).every((key) => ["kind", "contains"].includes(key)) && typeof item.contains === "string" && item.contains.length > 0 && item.contains.length <= 4_096) return { kind: "visible_text", contains: item.contains };
  if (item.kind === "element_exists" && Object.keys(item).every((key) => ["kind", "name"].includes(key)) && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 4_096) return { kind: "element_exists", name: item.name };
  if (item.kind === "file_exists" && Object.keys(item).every((key) => ["kind", "path"].includes(key)) && typeof item.path === "string" && item.path.startsWith("/") && item.path.length <= 4_096) return { kind: "file_exists", path: item.path };
  if (item.kind === "visual_judgement" && Object.keys(item).every((key) => ["kind", "description"].includes(key)) && typeof item.description === "string" && item.description.length > 0 && item.description.length <= 4_096) return { kind: "visual_judgement", description: item.description };
  return undefined;
}

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
  const failureCode = COMPUTER_WORKER_FAILURE_CODES.includes(value.failureCode as ComputerWorkerFailureCode) ? value.failureCode as ComputerWorkerFailureCode : undefined;
  const attestedPostconditions = (value.attestedPostconditions ?? []).flatMap((item) => {
    const condition = closedPostcondition(item);
    return condition ? [condition] : [];
  }).slice(0, 32);
  return {
    outcome,
    summary: WORKER_SUMMARY[outcome],
    ...(failureCode ? { failureCode } : {}),
    ...(attestedPostconditions.length ? { attestedPostconditions } : {}),
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
    const verifiedTaskConditions = new Set<string>();
    const workerAttempts: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"] = [];

    const taskVerification = () => {
      const conditionResults = plan.successConditions.map((condition, index) => ({
        conditionId: `task:condition:${index}`,
        outcome: verifiedTaskConditions.has(JSON.stringify(condition)) ? "verified" as const : "not_verified" as const,
      }));
      return {
        status: conditionResults.every((condition) => condition.outcome === "verified") ? "verified" as const : "not_verified" as const,
        conditionResults,
      };
    };
    const recordTaskEvidence = (step: ComputerPlanStep, observation: ComputerObservation | undefined, verifiedByFreshVerifier: boolean, attestedPostconditions: ComputerPostcondition[] = []) => {
      const boundStepConditions = new Set(step.postconditions.map((condition) => JSON.stringify(condition)));
      const attested = new Set(attestedPostconditions.map((condition) => JSON.stringify(condition)));
      for (const condition of plan.successConditions) {
        const key = JSON.stringify(condition);
        if (!boundStepConditions.has(key)) continue;
        if (isSubjective(condition)) {
          if (verifiedByFreshVerifier) verifiedTaskConditions.add(key);
        } else if (verifiedByFreshVerifier && attested.has(key)) {
          verifiedTaskConditions.add(key);
        } else if (evaluatePostconditions([condition], observation, "task:evidence").status === "verified") {
          verifiedTaskConditions.add(key);
        }
      }
    };
    const investigation = (
      stage: NonNullable<ComputerTaskResult["investigation"]>["stage"],
      code: NonNullable<ComputerTaskResult["investigation"]>["code"],
      verification = taskVerification(),
    ): NonNullable<ComputerTaskResult["investigation"]> => ({
      stage,
      code,
      recoveryAttempts: revisions,
      failedConditions: verification.conditionResults.flatMap((condition, index) => condition.outcome === "verified" ? [] : [{
        conditionId: condition.conditionId,
        kind: plan.successConditions[index]?.kind ?? "visual_judgement",
        outcome: condition.outcome,
      }]),
      workerAttempts: workerAttempts.slice(-16).map((attempt) => ({ ...attempt })),
    });
    const finishBlocked = (
      stage: NonNullable<ComputerTaskResult["investigation"]>["stage"],
      code: NonNullable<ComputerTaskResult["investigation"]>["code"],
      verification = taskVerification(),
      summary = "Computer Task blocked",
    ) => {
      const blocked = this.#result("blocked", summary, revisions, verification, investigation(stage, code, verification));
      this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
      return blocked;
    };

    while (true) {
      if (signal?.aborted) {
        const verification = taskVerification();
        const cancelled = this.#result("cancelled", "Computer Task cancelled", revisions, verification, investigation("cancelled", "task_cancelled", verification));
        this.#emit({ type: "task_finished", taskId, outcome: cancelled.outcome });
        return cancelled;
      }
      const step = plan.steps.find((candidate) =>
        !completed.has(candidate.id)
        && candidate.dependsOn.every((dependency) => completed.has(dependency))
      );
      if (!step) {
        if (plan.steps.every((candidate) => completed.has(candidate.id))) {
          const verification = taskVerification();
          if (verification.status !== "verified") {
            return finishBlocked("task_verification", "task_conditions_not_verified", verification, "Task-level success conditions are not freshly verified");
          }
          return await this.#succeeded(taskId, runId, goal, plan, executed, verificationObservationIds, {
            outcome: "succeeded",
            summary: "Computer Task completed",
            verification,
            planRevisions: revisions,
          });
        }
        return finishBlocked("plan_dependencies", "unresolved_dependencies", taskVerification(), "Computer Task plan has unresolved dependencies");
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
      const attempt: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"][number] = {
        stepId: step.id,
        role: step.role,
        outcome: result.outcome,
        verification: "unknown",
        ...(result.failureCode ? { failureCode: result.failureCode } : {}),
      };
      workerAttempts.push(attempt);
      this.#emit({ type: "worker_finished", taskId, stepId: step.id, role: step.role, outcome: result.outcome, parentRole: "computer-use-leader", depth: 1 });
      if (result.outcome === "completed" || result.outcome === "verified") {
        const resultObservationIsFresh = Boolean(result.observation?.id && !verificationObservationIds.has(result.observation.id));
        let taskObservation = result.observation;
        let taskAttestations = result.attestedPostconditions ?? [];
        let verifiedByFreshVerifier = step.role === "verifier" && result.outcome === "verified" && resultObservationIsFresh;
        let verification = step.role === "verifier" && result.outcome === "verified" && resultObservationIsFresh
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
          const verifierAttempt: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"][number] = {
            stepId: `${step.id}-verify`,
            role: "verifier",
            outcome: verified.workerResult.outcome,
            verification: "unknown",
            ...(verified.workerResult.failureCode ? { failureCode: verified.workerResult.failureCode } : {}),
          };
          workerAttempts.push(verifierAttempt);
          verification = verified.workerResult.outcome === "verified" && verified.workerResult.observation?.id && verified.workerResult.observation.id !== result.observation?.id
            ? verifiedConditionResults(step.postconditions, `${step.id}:condition`)
            : evaluatePostconditions(step.postconditions, verified.workerResult.observation, `${step.id}:condition`);
          verifierAttempt.verification = verification.status;
          taskObservation = verified.workerResult.observation;
          taskAttestations = verified.workerResult.attestedPostconditions ?? [];
          verifiedByFreshVerifier = Boolean(
            verified.workerResult.outcome === "verified" &&
            verified.workerResult.observation?.id &&
            verified.workerResult.observation.id !== result.observation?.id &&
            !verificationObservationIds.has(verified.workerResult.observation.id)
          );
          if (verification.status === "verified" && verified.workerResult.observation?.id) verificationObservationIds.add(verified.workerResult.observation.id);
        }
        attempt.verification = verification.status;
        if (verification.status === "verified") {
          recordTaskEvidence(step, taskObservation, verifiedByFreshVerifier, taskAttestations);
          completed.add(step.id);
          if (plan.steps.every((candidate) => completed.has(candidate.id))) {
            const verification = taskVerification();
            if (verification.status !== "verified") {
              return finishBlocked("task_verification", "task_conditions_not_verified", verification, "Task-level success conditions are not freshly verified");
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
        const verifierAttempt: NonNullable<ComputerTaskResult["investigation"]>["workerAttempts"][number] = {
          stepId: `${step.id}-observe-after-unknown`,
          role: "verifier",
          outcome: observed.workerResult.outcome,
          verification: "unknown",
          ...(observed.workerResult.failureCode ? { failureCode: observed.workerResult.failureCode } : {}),
        };
        workerAttempts.push(verifierAttempt);
        recoveryObservation = observed.workerResult.observation;
        const recovered = evaluatePostconditions(step.postconditions, recoveryObservation, `${step.id}:condition`);
        verifierAttempt.verification = recovered.status;
        attempt.verification = recovered.status;
        if (recovered.status === "verified") {
          if (recoveryObservation?.id) verificationObservationIds.add(recoveryObservation.id);
          recordTaskEvidence(step, recoveryObservation, false);
          completed.add(step.id);
          if (plan.steps.every((candidate) => completed.has(candidate.id))) {
            const verification = taskVerification();
            if (verification.status !== "verified") {
              return finishBlocked("task_verification", "task_conditions_not_verified", verification, "Task-level success conditions are not freshly verified");
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

      if (attempt.verification === "unknown" && result.observation) {
        attempt.verification = evaluatePostconditions(step.postconditions, result.observation, `${step.id}:condition`).status;
      }

      if (revisions >= this.#maxReplans) {
        const code = result.failureCode
          ?? (result.outcome === "outcome_unknown" ? "worker_outcome_unknown"
            : attempt.verification === "not_verified" ? "worker_postconditions_not_verified"
              : result.outcome === "blocked" ? "worker_blocked" : "worker_failed");
        return finishBlocked("recovery_exhausted", code, taskVerification(), "Computer Task replan budget exhausted");
      }
      try {
        plan = await this.#planner.replan({
          plan,
          failedStep: step,
          result,
          observation: recoveryObservation,
        });
        this.#validatePlan(plan);
      } catch {
        const verification = taskVerification();
        const blocked: ComputerTaskResult = {
          outcome: "blocked",
          summary: "Computer Task recovery plan was invalid after worker failure",
          verification,
          planRevisions: revisions,
          investigation: investigation("recovery_plan", "recovery_plan_invalid", verification),
        };
        this.#emit({ type: "task_finished", taskId, outcome: blocked.outcome });
        return blocked;
      }
      revisions += 1;
      this.#emit({ type: "plan_revised", taskId, revision: revisions, stepSummaries: plan.steps.map(({ id, role }) => `${role}:${id}`.slice(0, 240)) });
    }
  }

  #validatePlan(plan: ComputerPlan): void {
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error("Computer Plan requires at least one step");
    if (!Array.isArray(plan.successConditions) || plan.successConditions.length === 0) throw new Error("Computer Plan requires at least one task success condition");
    const stepPostconditions = plan.steps.flatMap((step) => step.postconditions.map((condition) => JSON.stringify(condition)));
    if (plan.successConditions.some((condition) => !stepPostconditions.includes(JSON.stringify(condition)))) {
      throw new Error("Every Computer Plan success condition must exactly match a step Postcondition");
    }
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
      const failureCode = error && typeof error === "object" && COMPUTER_WORKER_FAILURE_CODES.includes((error as any).failureCode)
        ? (error as any).failureCode as ComputerWorkerFailureCode
        : "computer_worker_dispatch_failed";
      return { workerResult: projectComputerWorkerResult({ outcome: "failed", summary: error instanceof Error ? error.message : "Computer Worker failed", failureCode }), hostExecutionRecords: [] };
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
    verification: ComputerTaskResult["verification"] = { status: "not_verified", conditionResults: [] },
    investigation?: ComputerTaskResult["investigation"],
  ): ComputerTaskResult {
    return {
      outcome,
      summary: outcome === "cancelled" ? "Computer Task cancelled" : outcome === "blocked" ? "Computer Task blocked" : "Computer Task failed",
      verification,
      planRevisions,
      ...(investigation ? { investigation } : {}),
    };
  }
}
