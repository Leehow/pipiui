import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compileProcedureCandidate, JsonProcedureStore, ProcedureReplayEngine, type ConditionEvaluation, type ExecutedTrajectoryVerifier, type Procedure, type ProcedureCandidateInput, type ProcedureCondition, type ProcedurePolicy, type ProcedureStep, type ReplayReceiptVerifier, type VerifiedReplayEvidence } from "./procedures.ts";
import type { ComputerPlan, HostExecutionRecord } from "./coordinator.ts";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
const validToken = (value: unknown): value is string => typeof value === "string" && /^v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value);

export class PersistentProcedureReceiptAuthority implements ExecutedTrajectoryVerifier, ReplayReceiptVerifier {
  readonly #secret: Buffer;
  private constructor(secret: Buffer) { this.#secret = secret; }
  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true });
    let secret: Buffer;
    try { secret = await readFile(path); }
    catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      secret = randomBytes(32); const handle = await open(path, "wx", 0o600);
      await handle.writeFile(secret).finally(() => handle.close());
    }
    if (secret.length !== 32) throw new Error("Procedure receipt authority key is invalid");
    return new PersistentProcedureReceiptAuthority(secret);
  }
  #issue(kind: "trajectory" | "replay", payload: unknown) { const body = encode({ kind, payload }); const mac = createHmac("sha256", this.#secret).update(body).digest("hex"); return `v1.${body}.${mac}`; }
  #verify(receipt: unknown, kind: "trajectory" | "replay") {
    if (!validToken(receipt)) return undefined;
    const [, body, mac] = receipt.split("."); const expected = createHmac("sha256", this.#secret).update(body).digest("hex");
    if (mac !== expected) return undefined;
    const decoded = decode(body); return decoded?.kind === kind ? decoded.payload : undefined;
  }
  issueTrajectory(input: ProcedureCandidateInput) { return this.#issue("trajectory", input); }
  issueReplay(input: VerifiedReplayEvidence) { return this.#issue("replay", input); }
  verify(receipt: unknown, expected?: { procedureId: string; version: number }): any {
    if (expected) { const value = this.#verify(receipt, "replay") as VerifiedReplayEvidence | undefined; return value?.procedureId === expected.procedureId && value.version === expected.version ? value : undefined; }
    return this.#verify(receipt, "trajectory") as ProcedureCandidateInput | undefined;
  }
}

export type ProcedureReplayAdapters = {
  evaluate(condition: ProcedureCondition, phase: "precondition" | "step_postcondition" | "procedure_postcondition", parameters: Record<string, unknown>, observation?: { id: string; capturedAt: string }): Promise<ConditionEvaluation>;
  execute(step: ProcedureStep, parameters: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; observation?: { id: string; capturedAt: string } }>;
};

export class ProcedureHostRuntime {
  readonly #policy: ProcedurePolicy; readonly #authority: PersistentProcedureReceiptAuthority; readonly #store: JsonProcedureStore; readonly #adapters: ProcedureReplayAdapters;
  private constructor(input: { policy: ProcedurePolicy; authority: PersistentProcedureReceiptAuthority; store: JsonProcedureStore; adapters: ProcedureReplayAdapters }) { this.#policy = input.policy; this.#authority = input.authority; this.#store = input.store; this.#adapters = input.adapters; }
  static async open(input: { storePath: string; policy: ProcedurePolicy; adapters: ProcedureReplayAdapters; suspendAfterFailures?: number }) {
    const authority = await PersistentProcedureReceiptAuthority.open(`${input.storePath}.receipt-key`);
    const store = new JsonProcedureStore(input.storePath, { policy: input.policy, receiptVerifier: authority, suspendAfterFailures: input.suspendAfterFailures });
    return new ProcedureHostRuntime({ policy: input.policy, authority, store, adapters: input.adapters });
  }
  async recordVerifiedExploration(input: ProcedureCandidateInput) {
    const receipt = this.#authority.issueTrajectory(structuredClone(input));
    return await this.#store.saveCandidate(compileProcedureCandidate(receipt, this.#policy, this.#authority));
  }
  async recordCoordinatorExecution(input: { taskId: string; runId: string; goal: string; plan: ComputerPlan; steps: Array<{ stepId: string; hostExecutionRecords: HostExecutionRecord[] }>; verificationObservationIds: string[]; repairsProcedureId?: string }) {
    const context = input.plan.procedureContext;
    if (!context || input.verificationObservationIds.length === 0) throw new Error("trusted Procedure exploration requires exact application/parameter bindings and fresh verification evidence");
    const records = input.steps.flatMap(({ stepId, hostExecutionRecords }) => hostExecutionRecords.map((record) => ({ stepId, record })));
    const opened = records.find(({ record }) => record.role === "gui-operator" && record.kind === "open_application")?.record as Extract<HostExecutionRecord, { role: "gui-operator" }> | undefined;
    if (!opened || opened.bundleId !== context.application.bundleId || (opened.appName && opened.appName !== context.application.appName)) throw new Error("proposed Procedure application does not match authoritative opened target");
    const parameterKinds = new Map<string, "file_path" | "short_text">();
    const pathParameter = (path: string) => { const matches = Object.entries(context.parameters).filter(([, value]) => value === path); if (matches.length !== 1) throw new Error("file binding is missing or ambiguous"); parameterKinds.set(matches[0][0], "file_path"); return matches[0][0]; };
    const contentParameter = (digest: string) => { const matches = Object.entries(context.parameters).filter(([, value]) => createHash("sha256").update(value).digest("hex") === digest); if (matches.length !== 1) throw new Error("content binding is missing or ambiguous"); parameterKinds.set(matches[0][0], "short_text"); return matches[0][0]; };
    const condition = (value: any): ProcedureCondition => {
      if (value.kind === "file_exists") return { kind: "file_exists", pathParameter: pathParameter(String(value.path)) };
      if (value.kind === "visible_text") { const matches = Object.entries(context.parameters).filter(([, item]) => item === value.contains); if (matches.length !== 1) throw new Error("visible-text binding is missing or ambiguous"); parameterKinds.set(matches[0][0], "short_text"); return { kind: "visible_text", textParameter: matches[0][0] }; }
      if (value.kind === "element_exists") return { kind: "element_exists", locator: { kind: "accessibility", role: "AXUIElement", nameLiteral: String(value.name) } };
      throw new Error("subjective Postconditions cannot enter a Procedure");
    };
    const procedureSteps: ProcedureStep[] = [];
    for (const planStep of input.plan.steps) {
      const effects = records.filter(({ stepId }) => stepId === planStep.id).map(({ record }) => record);
      effects.forEach((record, index) => {
        const last = index === effects.length - 1;
        const action = record.role === "terminal-worker"
          ? { kind: "write_parameterized_file" as const, pathParameter: pathParameter(record.path), contentParameter: contentParameter(record.contentDigest) }
          : record.kind === "open_application" ? { kind: "activate_application" as const }
          : record.kind === "click" && record.locator ? { kind: "click" as const, locator: { kind: "accessibility" as const, ...record.locator } }
          : undefined;
        if (!action) throw new Error("executed effect cannot be represented by the closed Procedure schema");
        const consequential = last && planStep.postconditions.length > 0;
        procedureSteps.push({ id: `${planStep.id}-${index + 1}`, role: record.role, action, postconditions: consequential ? planStep.postconditions.map(condition) : [], consequential });
      });
    }
    if (!procedureSteps.length) throw new Error("trusted Procedure exploration has no authoritative effects");
    const evidence = { taskId: input.taskId, runId: input.runId, verifiedAt: new Date().toISOString() };
    if (input.repairsProcedureId) return await this.#store.createRepairCandidate(input.repairsProcedureId, { steps: procedureSteps, evidence });
    return await this.recordVerifiedExploration({ intent: input.goal.trim(), application: structuredClone(context.application), parameters: [...parameterKinds].map(([name, kind]) => ({ name, kind, required: true })), preconditions: [{ kind: "application_available", bundleId: context.application.bundleId }], steps: procedureSteps, postconditions: input.plan.successConditions.map(condition), recovery: [{ on: "postcondition_failed", action: "fallback_to_agent" }, { on: "drift", action: "replan" }], evidence });
  }
  async run(input: { intent: string; bundleId: string; parameters: Record<string, unknown>; taskId: string; runId: string; qualifyCandidate?: boolean }, signal?: AbortSignal) {
    const matches = await this.#store.findApplicable({ intent: input.intent, bundleId: input.bundleId, includeCandidates: input.qualifyCandidate === true });
    const selected = matches.find(({ state }) => state === "verified") ?? (input.qualifyCandidate ? matches.find(({ state }) => state === "candidate") : undefined);
    if (!selected) return { outcome: "fallback_to_agent" as const, reason: "no_applicable_procedure" };
    const procedure = await this.#store.get(selected.id);
    const engine = new ProcedureReplayEngine({ policy: this.#policy, evaluate: this.#adapters.evaluate, executeStep: this.#adapters.execute, issueReceipt: async (evidence) => this.#authority.issueReplay(evidence) });
    const replay = await engine.replay(procedure, input.parameters, signal, { taskId: input.taskId, runId: input.runId });
    if (replay.outcome === "succeeded") {
      const updated = procedure.state === "candidate" ? await this.#store.recordIndependentSuccess(procedure.id, replay.receipt) : procedure;
      return { ...replay, procedureId: updated.id, state: updated.state };
    }
    if (replay.outcome === "drift") await this.#store.recordFailure(procedure.id, { kind: replay.reason ?? "drift" });
    return { ...replay, procedureId: procedure.id };
  }
  async recordVerifiedRepair(id: string, input: { steps: ProcedureStep[]; evidence: { taskId: string; runId: string; verifiedAt: string } }) { return await this.#store.createRepairCandidate(id, structuredClone(input)); }
  async get(id: string): Promise<Procedure> { return await this.#store.get(id); }
}
