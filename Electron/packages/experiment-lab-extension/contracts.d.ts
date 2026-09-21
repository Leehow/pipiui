export type ExperimentKind = "command" | "pi" | "browser";
export type ExperimentBudget = {
  repetitions: number;
  concurrency: number;
  maxTrials: number;
  trialTimeoutMs: number;
  totalTimeoutMs: number;
};
export type MetricDefinition = { id: string; unit: string; direction: "lower" | "higher" | "neutral" };
export type VariantDraft = { id: string; hypothesis: string };
export type CommandSpec = { executable: string; args: string[]; shell: boolean };
export type FileAssertion = { path: string; expectedText?: string; sha256?: string };
export type CommandCaseInput = { id: string; title?: string; command: { executable: string; args?: string[]; shell?: boolean }; prepare?: { executable: string; args?: string[]; shell?: boolean }; expectedExitCode?: number; checks?: FileAssertion[]; metricsFile?: string; allowedDomains?: string[] };
export type CommandCase = {
  id: string;
  title: string;
  command: CommandSpec;
  prepare?: CommandSpec;
  expectedExitCode: number;
  checks: FileAssertion[];
  metricsFile?: string;
  allowedDomains: string[];
};
export type InventoryKind = "files" | "dirtyPaths" | "removedPaths" | "omittedUntracked" | "excluded" | "scopes" | "includeUntracked";
export type InventoryPage = { kind: InventoryKind; page: number; pages: number; count: number; items: unknown[] };
export type SnapshotFile = { path: string; sha256: string; bytes: number; executable: boolean; origin: "tracked" | "untracked" };
export type Baseline = {
  head: string;
  indexFingerprint: string;
  fingerprint: string;
  files: SnapshotFile[];
  dirtyPaths: string[];
  removedPaths: string[];
  omittedUntracked: string[];
  excluded: Array<{ path: string; reason: string }>;
  frozenAt: string;
};
export type ExperimentRecord = {
  version: 1;
  id: string;
  projectRoot: string;
  revision: number;
  sequence: number;
  question: string;
  kind: ExperimentKind;
  state: "draft" | "frozen";
  scopes: string[];
  includeUntracked: string[];
  metrics: MetricDefinition[];
  variants: VariantDraft[];
  cases?: CommandCase[];
  budget: ExperimentBudget;
  baseline?: Baseline;
  createdAt: string;
  updatedAt: string;
};
export type CreateExperiment = {
  experimentId: string;
  question: string;
  kind?: ExperimentKind;
  scopes?: string[];
  includeUntracked?: string[];
  metrics?: MetricDefinition[];
  variants?: VariantDraft[];
  cases?: CommandCaseInput[];
  budget?: Partial<ExperimentBudget>;
};
export type DraftPatch = Pick<CreateExperiment, "question" | "scopes" | "includeUntracked" | "metrics" | "variants" | "cases" | "budget">;
/** The small atomic checkpoint references authoritative immutable event data. */
export type ExperimentSummary = ExperimentRecord & {
  isSummary: true;
  recordDigest: string;
  inventory: Record<InventoryKind, { count: number; pages: number }>;
  previewTruncated: boolean;
  caseCatalog?: Array<{ id: string; title: string; titleTruncated: boolean; fingerprint: string; command: string; networkDomains: number }>;
};
export type ExperimentAction = "create" | "list" | "read" | "update" | "freeze" | "revise" | "inventory" | "case";
export type ExperimentRequest = Partial<CreateExperiment> & { version?: 1; action: ExperimentAction; revision?: number; requestId?: string; inventoryKind?: InventoryKind; page?: number; limit?: number; offset?: number; caseId?: string };
export type ExperimentResponse = {
  version: 1;
  requestId?: string;
  action: ExperimentAction;
  experiment?: ExperimentRecord;
  experiments?: ExperimentSummary[];
  inventory?: InventoryPage;
  definition?: CommandCase;
};

export type TrialState = "queued" | "preparing" | "running" | "verifying" | "succeeded" | "failed" | "timed-out" | "cancelled" | "invalid" | "interrupted";
export type TrialMetric = { id: string; value: number | null; unit: string; source: "runtime" | "workload-output" | "unavailable" };
export type TrialCheck = { path: string; passed: boolean; reason?: string };
export type TrialRecord = {
  version: 1;
  id: string;
  experimentId: string;
  revision: number;
  variantId: "baseline";
  caseId: string;
  sequence: number;
  requestDigest: string;
  definitionFingerprint: string;
  baselineFingerprint: string;
  state: TrialState;
  phase: "queued" | "preparing" | "workload" | "verifying" | "terminal";
  quality: "pass" | "fail" | "unknown";
  owner: { pid: number; generation: string; sessionId?: string };
  runtime: { coordinatorNode: string; platform: string; arch: string };
  createdAt: string;
  budgetDeadlineAt?: string;
  startedAt?: string;
  endedAt?: string;
  cancelRequested?: boolean;
  reason?: string;
  exitCode?: number | null;
  exitSignal?: string | null;
  preparationMs?: number;
  workloadMs?: number | null;
  totalMs?: number;
  progress?: { elapsedMs: number; stdoutBytes: number; stderrBytes: number; updatedAt: string };
  checks: TrialCheck[];
  metrics: TrialMetric[];
  sandbox?: { applied: boolean; version: string; platform: string; warnings: string[] };
  artifacts: Array<{ kind: "stdout" | "stderr"; phase: "prepare" | "workload"; path: string; bytes: number; truncated: boolean }>;
  metricEvidence?: { path: string; bytes: number; sha256: string; validation: "valid" | "invalid" };
  workspaceCleaned?: boolean;
};
export type TrialRequest = { version?: 1; action: "run" | "status" | "cancel" | "cleanup"; experimentId: string; caseId?: string; trialId?: string; revision?: number; requestId?: string };
export type TrialResponse = { version: 1; action: TrialRequest["action"]; requestId?: string; trial?: TrialRecord; trials?: TrialRecord[]; reused?: boolean };

/** Internal execution identity; baseline creation itself never starts a driver. */
export type ExperimentExecutionIdentity = { experimentId: string; revision: number; trialId: string };
export type ExperimentExecutionPort = {
  start(input: ExperimentExecutionIdentity & { manifestFingerprint: string }, signal?: AbortSignal): Promise<{ runId: string }>;
  inspect(identity: ExperimentExecutionIdentity & { runId: string }): Promise<{ state: string }>;
  cancel(identity: ExperimentExecutionIdentity & { runId: string }): Promise<void>;
};
