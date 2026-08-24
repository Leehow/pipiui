import {
  type ComputerWorkerGrant,
  type ComputerWorkerRole,
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
} from "./worker-broker.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { isComputerWorkerRole } from "./workers.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { type TerminalStepPolicy } from "./terminal-policy.ts";
// @ts-ignore -- the bundled runtime executes TypeScript directly; keep its explicit runtime extension.
import { type ComputerTaskRecoveryPolicy } from "./plan-proposal.ts";
export type { ComputerTaskRecoveryPolicy } from "./plan-proposal.ts";

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

export type ComputerTaskRequest = {
  goal: string;
  taskId?: string;
  recoveryPolicy?: ComputerTaskRecoveryPolicy;
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
  planRevision: number;
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
  /** Closed recovery signal: the worker proved an external target-state mismatch and the task forbids repairing it. */
  recoveryDisposition?: "manual_intervention";
  blockedReason?: "target_state_mismatch";
  nextAction?: "restore_target_state_manually";
};
export type ComputerAgentEpisode = {
  agentId: string;
  runId: string;
  parentId: string | null;
  name: "operator" | "computer-verifier" | "computer-terminal" | "computer-use-leader";
  role: ComputerWorkerRole | "computer-use-leader";
  terminalState: "ok" | "failed" | "aborted" | "interrupted" | "stalled";
  result: {
    outcome: ComputerWorkerResult["outcome"] | "cancelled";
    summary: string;
    failureCode?: ComputerWorkerFailureCode;
  };
};
export const COMPUTER_WORKER_FAILURE_CODES = [
  "gui_broker_start_failed", "gui_grant_issue_failed", "gui_private_resource_failed",
  "gui_child_prestart_failed", "gui_child_failed", "gui_child_stalled", "computer_worker_dispatch_failed",
	"computer_worker_runtime_timeout", "computer_worker_request_cancelled",
	"computer_worker_no_progress",
	"terminal_path_policy_rejected", "terminal_command_policy_rejected",
	"terminal_request_invalid", "terminal_operation_failed",
	"computer_leader_stalled",
] as const;
export type ComputerWorkerFailureCode = typeof COMPUTER_WORKER_FAILURE_CODES[number];

export type HostExecutionRecord =
  | { role: "gui-operator"; kind: "open_application" | "click" | "type_parameter"; bundleId?: string; appName?: string; locator?: { role: string; nameLiteral: string }; observationId: string; observedAt: string }
  | { role: "terminal-worker"; kind: "write_parameterized_file"; path: string; byteLength: number; contentDigest: string; observationId: string; observedAt: string };
export type ComputerWorkerDispatchResult = { workerResult: ComputerWorkerResult; hostExecutionRecords: HostExecutionRecord[]; episode?: ComputerAgentEpisode };

export type ComputerTaskResult = {
  outcome: "succeeded" | "blocked" | "failed" | "cancelled";
  summary: string;
  verification: {
    status: "verified" | "not_verified" | "unknown";
    conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" | "unknown" }>;
  };
  planRevisions: number;
  episodes?: ComputerAgentEpisode[];
  investigation?: {
    stage: "task_verification" | "recovery_exhausted" | "recovery_plan" | "plan_dependencies" | "manual_intervention" | "fail_fast" | "cancelled" | "leader_runtime";
    code: "task_conditions_not_verified" | "worker_postconditions_not_verified" | "worker_failed" | "worker_blocked" | "worker_outcome_unknown" | "recovery_plan_invalid" | "unresolved_dependencies" | "target_state_mismatch" | "task_cancelled" | ComputerWorkerFailureCode;
    recoveryAttempts: number;
    failedConditions: Array<{ conditionId: string; kind: ComputerPostcondition["kind"]; outcome: "not_verified" | "unknown" }>;
    workerAttempts: Array<{
      stepId: string;
      role: ComputerWorkerRole;
      outcome: ComputerWorkerResult["outcome"];
      verification: "verified" | "not_verified" | "unknown";
      failureCode?: ComputerWorkerFailureCode;
      agentId?: string;
      runId?: string;
      parentId?: string | null;
      name?: ComputerAgentEpisode["name"];
      terminalState?: ComputerAgentEpisode["terminalState"];
      result?: ComputerAgentEpisode["result"];
    }>;
    blockedReason?: "target_state_mismatch";
    nextAction?: "restore_target_state_manually";
  };
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
  const manualBlock = outcome === "blocked"
    && value.recoveryDisposition === "manual_intervention"
    && value.blockedReason === "target_state_mismatch"
    && value.nextAction === "restore_target_state_manually";
  return {
    outcome,
    summary: WORKER_SUMMARY[outcome],
    ...(failureCode ? { failureCode } : {}),
    ...(attestedPostconditions.length ? { attestedPostconditions } : {}),
    ...(observation ? { observation } : {}),
    ...(artifactReferences.length ? { artifactReferences } : {}),
    ...(manualBlock ? {
      recoveryDisposition: "manual_intervention" as const,
      blockedReason: "target_state_mismatch" as const,
      nextAction: "restore_target_state_manually" as const,
    } : {}),
  };
}

function projectComputerAgentEpisode(value: unknown, workerResult: ComputerWorkerResult): ComputerAgentEpisode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const episode = value as Partial<ComputerAgentEpisode>;
  if (typeof episode.agentId !== "string" || !/^[A-Za-z0-9_-]{2,160}$/.test(episode.agentId)) return undefined;
  if (typeof episode.runId !== "string" || !/^[A-Za-z0-9_-]{2,160}$/.test(episode.runId)) return undefined;
  if (episode.parentId !== null && (typeof episode.parentId !== "string" || !/^[A-Za-z0-9_-]{2,160}$/.test(episode.parentId))) return undefined;
  if (!["operator", "computer-verifier", "computer-terminal"].includes(String(episode.name))) return undefined;
  if (!isComputerWorkerRole(episode.role)) return undefined;
  if (!["ok", "failed", "aborted", "interrupted", "stalled"].includes(String(episode.terminalState))) return undefined;
  return {
    agentId: episode.agentId,
    runId: episode.runId,
    parentId: episode.parentId,
    name: episode.name as ComputerAgentEpisode["name"],
    role: episode.role,
    terminalState: episode.terminalState as ComputerAgentEpisode["terminalState"],
    result: {
      outcome: workerResult.outcome,
      summary: WORKER_SUMMARY[workerResult.outcome],
      ...(workerResult.failureCode ? { failureCode: workerResult.failureCode } : {}),
    },
  };
}

export function computerTaskDetails(
  result: ComputerTaskResult,
  root: ComputerAgentEpisode,
  leaderEpisodes: ComputerAgentEpisode[],
  leaderSummary?: string,
): ComputerTaskResult & { leaderSummary?: string; hierarchy: { root: Pick<ComputerAgentEpisode, "agentId" | "runId" | "parentId" | "name" | "role">; episodes: ComputerAgentEpisode[] } } {
  const episodes = [root, ...leaderEpisodes, ...(result.episodes ?? [])].map((episode) => structuredClone(episode));
  return {
    ...result,
    episodes,
    ...(leaderSummary ? { leaderSummary } : {}),
    hierarchy: {
      root: { agentId: root.agentId, runId: root.runId, parentId: root.parentId, name: root.name, role: root.role },
      episodes: structuredClone(episodes),
    },
  };
}

export function computerTaskContent(
  details: Pick<ComputerTaskResult, "summary" | "verification" | "planRevisions"> & {
    episodes?: ReadonlyArray<Omit<ComputerAgentEpisode, "name" | "role" | "terminalState" | "result"> & {
      name: string;
      role: string;
      terminalState: string;
      result: { outcome: string; summary: string; failureCode?: ComputerWorkerFailureCode };
    }>;
    investigation?: ComputerTaskResult["investigation"] | Record<string, unknown>;
  },
  summary = details.summary,
  plan?: ComputerPlan,
): string {
  const episodeLedger = (details.episodes ?? []).map((episode) => ({
    ...episode,
    result: {
      outcome: episode.result.outcome,
      summary: episode.name === "computer-use-leader"
        ? episode.result.outcome === "completed" ? "Computer Task completed" : episode.result.outcome === "cancelled" ? "Computer Task cancelled" : "Computer Task blocked"
        : WORKER_SUMMARY[episode.result.outcome as ComputerWorkerResult["outcome"]] ?? "Worker failed",
      ...(episode.result.failureCode ? { failureCode: episode.result.failureCode } : {}),
    },
  }));
  // `episodeLedger` stays the first key for stable prose-side consumers; the
  // trailing fields give the main agent (and the UI card renderer) the plan /
  // verification / investigation view that the tool `details` side-channel
  // carried but never survived the host RPC hop.
  return `${summary}\n\nEpisode ledger:\n${JSON.stringify({
    episodeLedger,
    ...(plan ? { plan } : {}),
    verification: details.verification,
    planRevisions: details.planRevisions,
    ...(details.investigation ? { investigation: details.investigation } : {}),
  })}`;
}

export function computerTaskRootTerminalState(
  result: { outcome: string; failureCode?: string },
): ComputerAgentEpisode["terminalState"] {
  if (result.failureCode === "computer_leader_stalled") return "stalled";
  if (result.outcome === "succeeded") return "ok";
  if (result.outcome === "cancelled") return "aborted";
  return "failed";
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
