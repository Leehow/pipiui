import type { ExperimentBudget, FileAssertion, MetricDefinition, SnapshotFile } from "../contracts.js";
import type { PiProfile, PiRunResult } from "./pi-session.js";

export type FrozenVariant = {
  version: 1;
  experimentId: string;
  revision: number;
  id: string;
  hypothesis: string;
  fingerprint: string;
  baselineFingerprint: string;
  files: SnapshotFile[];
  frozenAt: string;
  /** Internal immutable source, never accepted as an arbitrary tool input. */
  snapshotPath: string;
  workspace?: { agentId: string; path: string; branch: string; mergePolicy: "never" };
};
export type PiCase = {
  id: string;
  title: string;
  prompt: string;
  checks: FileAssertion[];
  expectedAnswer?: string;
  metricsFile?: string;
};
export type BatchVariantInput = {
  id: string;
  profile: PiProfile;
  /** Names of already-mounted environment values; values never enter the request record. */
  environmentKeys?: string[];
};
export type BatchInput = {
  experimentId: string;
  revision?: number;
  batchId: string;
  variants: BatchVariantInput[];
  cases: PiCase[];
  budget?: Partial<ExperimentBudget>;
  mode?: "comparison" | "throughput";
};
export type BatchState = "queued" | "running" | "completed" | "cancelled" | "interrupted";
export type BatchTrialState = "queued" | "preparing" | "running" | "waiting-input" | "verifying" | "succeeded" | "failed" | "timed-out" | "cancelled" | "invalid" | "interrupted";
export type BatchTrial = {
  id: string;
  variantId: string;
  caseId: string;
  repetition: number;
  state: BatchTrialState;
  quality: "pass" | "fail" | "unknown";
  sequence: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  reason?: string;
  pid?: number;
  run?: PiRunResult;
  checks: Array<{ name: string; passed: boolean; reason?: string }>;
  metrics: Array<{ id: string; value: number | null; unit: string; source: "runtime" | "workload-output" | "unavailable" }>;
  logBytes: number;
  logTruncated: boolean;
  lastOutputAt?: string;
  recentTool?: string;
  inputRequest?: { id: string; method: string; title?: string; options?: string[] };
  manualInput?: boolean;
};
export type BatchRecord = {
  version: 1;
  id: string;
  experimentId: string;
  revision: number;
  definitionFingerprint: string;
  state: BatchState;
  sequence: number;
  createdAt: string;
  endedAt?: string;
  deadlineAt: string;
  owner: { generation: string; sessionId?: string };
  mode: "comparison" | "throughput";
  budget: ExperimentBudget;
  variants: Array<BatchVariantInput & { fingerprint: string; profileFingerprint: string }>;
  cases: PiCase[];
  metricDefinitions: MetricDefinition[];
  trials: BatchTrial[];
  cancelRequested?: boolean;
  cleanupCompleted?: boolean;
};
export type BatchProgress = { queued: number; active: number; finished: number; total: number; states: Partial<Record<BatchTrialState, number>> };
export type BatchSummary = Omit<BatchRecord, "owner" | "cases" | "trials"> & { progress: BatchProgress; trials: Array<Omit<BatchTrial, "run"> & { run?: Pick<PiRunResult, "state" | "totalMs" | "usage" | "stopReason" | "toolCalls"> }> };
export type BatchLogPage = { trialId: string; cursor: number; nextCursor: number; text: string; truncated: boolean; totalBytes: number };
export type BatchLogView = {
  mode: "read-only-log"; experimentId: string; batchId: string; trialId: string;
  logPath: string; logAvailable: boolean; logTruncated: boolean;
  pid?: number; ownerState: "this-session" | "other-session" | "not-active";
  inputRequestId?: string; canRespond: boolean; note: string;
};
