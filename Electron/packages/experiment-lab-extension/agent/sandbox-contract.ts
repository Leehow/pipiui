/** Trusted coordinator → per-trial sandbox driver. Not a model-visible shell API. */
export type SandboxRunRequest = {
  trialId: string;
  command: { executable: string; args: string[]; shell: boolean };
  workspaceRoot: string;
  cwd: string;
  homeRoot: string;
  tempRoot: string;
  /** Formal checkout, experiment records, private home and other protected roots. */
  protectedReadRoots: string[];
  /** Explicit immutable verifier/toolchain inputs, never general credential roots. */
  trustedReadRoots: string[];
  allowedDomains: string[];
  /** Already authorized workload-only values; never inherit the coordinator env. */
  env: Record<string, string>;
  redactValues?: string[];
  timeoutMs: number;
  terminationGraceMs?: number;
  maxOutputBytes?: number;
};
export type SandboxProgress = {
  phase: "preparing" | "running" | "cleaning";
  elapsedMs: number;
  stdoutBytes: number;
  stderrBytes: number;
};
export type SandboxRunResult = {
  state: "exited" | "failed" | "timed-out" | "cancelled" | "sandbox-unavailable";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  totalWallMs: number;
  workloadWallMs: number | null;
  sandbox: { applied: boolean; version: string; platform: string; warnings: string[] };
  reason?: string;
};
export type SandboxProbe = { available: boolean; version: string; platform: string; errors: string[]; warnings: string[] };
export type SandboxDriver = {
  probe(signal?: AbortSignal): Promise<SandboxProbe>;
  run(request: SandboxRunRequest, options?: { signal?: AbortSignal; onProgress?: (progress: SandboxProgress) => void }): Promise<SandboxRunResult>;
};
