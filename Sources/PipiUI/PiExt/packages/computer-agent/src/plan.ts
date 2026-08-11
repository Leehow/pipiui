import type { ComputerPostcondition } from "./coordinator.ts";
import type { ComputerArtifactReference } from "./artifacts.ts";
import type { ComputerWorkerRole } from "./worker-broker.ts";
import type { TerminalStepPolicy } from "./terminal-policy.ts";

export type ComputerPlanStepState = "pending" | "ready" | "running" | "verifying" | "succeeded" | "failed" | "blocked" | "cancelled";
export type ComputerPlanStepV2 = {
  id: string;
  role: ComputerWorkerRole;
  objective: string;
  dependsOn: string[];
  postconditions: ComputerPostcondition[];
  state: ComputerPlanStepState;
  attempts: number;
  terminalPolicy?: Omit<TerminalStepPolicy, "commands">;
};

export type ComputerBlackboard = {
  taskId: string;
  goal: string;
  facts: Array<{ id: string; summary: string; source: string }>;
  assumptions: Array<{ id: string; summary: string }>;
  artifacts: ComputerArtifactReference[];
  recentFailures: Array<{ stepId: string; code: string; summary: string }>;
  revision: number;
  budgets: { maxModelTurns: number; maxGuiBatches: number; maxTerminalCommands: number; maxReplans: number };
};

export type ComputerTaskEvent =
  | { type: "task_started"; taskId: string; summary: string }
  | { type: "plan_revised"; taskId: string; revision: number; stepSummaries: string[] }
  | { type: "worker_started"; taskId: string; stepId: string; role: ComputerWorkerRole; parentRole: "computer-use-leader"; depth: 1 }
  | { type: "worker_finished"; taskId: string; stepId: string; role: ComputerWorkerRole; outcome: string; parentRole: "computer-use-leader"; depth: 1 }
  | { type: "verification"; taskId: string; status: string; conditionResults: Array<{ conditionId: string; outcome: "verified" | "not_verified" | "unknown" }> }
  | { type: "waiting_for_user"; taskId: string; request: string }
  | { type: "task_finished"; taskId: string; outcome: string };
