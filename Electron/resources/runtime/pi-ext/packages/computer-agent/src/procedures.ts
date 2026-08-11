import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

export type ProcedurePolicy = {
  isSensitiveApplication(application: { bundleId: string; appName: string }): boolean;
};

export type ProcedureParameter = { name: string; kind: "string" | "file_path" | "short_text"; required: boolean };
export type SemanticLocator = { kind: "accessibility"; role: string; nameParameter?: string; nameLiteral?: string };
export type ProcedureCondition =
  | { kind: "application_available"; bundleId: string }
  | { kind: "file_exists"; pathParameter: string }
  | { kind: "element_exists"; locator: SemanticLocator }
  | { kind: "visible_text"; textParameter: string };
export type ProcedureAction =
  | { kind: "write_parameterized_file"; pathParameter: string; contentParameter: string }
  | { kind: "activate_application" }
  | { kind: "click"; locator: SemanticLocator }
  | { kind: "type_parameter"; locator: SemanticLocator; textParameter: string };
export type ProcedureStep = {
  id: string;
  role: "gui-operator" | "terminal-worker";
  action: ProcedureAction;
  postconditions: ProcedureCondition[];
  consequential: boolean;
};
export type RecoveryRule = { on: "postcondition_failed" | "drift"; action: "fallback_to_agent" | "replan" };
export type ProcedureEvidenceItem = { taskId: string; runId: string; verifiedAt: string };
export type VerifiedReplayEvidence = ProcedureEvidenceItem & {
  procedureId: string;
  version: number;
  replayStartedAt: string;
  humanCorrected: false;
  postconditionEvidence: Array<{ scope: "step" | "procedure"; stepId?: string; conditionIndex: number; observationId: string; observedAt: string }>;
};
export type StoredReplayEvidence = VerifiedReplayEvidence & { receipt: string };
export type Procedure = {
  schemaVersion: 1;
  id: string;
  lineageId: string;
  version: number;
  intent: string;
  application: { bundleId: string; appName: string };
  parameters: ProcedureParameter[];
  preconditions: ProcedureCondition[];
  steps: ProcedureStep[];
  postconditions: ProcedureCondition[];
  recovery: RecoveryRule[];
  state: "candidate" | "verified" | "suspended";
  evidence: { exploration: ProcedureEvidenceItem; independentSuccesses: StoredReplayEvidence[]; consecutiveFailures: number; lastFailureKind?: string };
  repairs?: { repairsProcedureId: string };
};
export type ProcedureCandidateInput = Omit<Procedure, "schemaVersion" | "id" | "lineageId" | "version" | "state" | "evidence" | "repairs"> & { evidence: ProcedureEvidenceItem };
export type ExecutedTrajectoryVerifier = { verify(receipt: unknown): ProcedureCandidateInput | undefined };
export type ReplayReceiptVerifier = {
  verify(receipt: unknown, expected: { procedureId: string; version: number }): Promise<VerifiedReplayEvidence | undefined>;
};

const ownKeys = (value: Record<string, unknown>, allowed: string[], context: string, errors: string[]) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${context}.${key} is not allowed by the closed Procedure schema`);
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validDate = (value: unknown): value is string => nonEmpty(value) && Number.isFinite(Date.parse(value));
const unsafeString = (value: string) => /(?:data:image|base64|https?:\/\/|api[_-]?key|password|credential|capability|session[_-]?key|clipboard|-----BEGIN)/i.test(value);

function validateLocator(value: unknown, parameters: Set<string>, context: string, errors: string[]): void {
  if (!object(value)) { errors.push(`${context} must be a semantic locator`); return; }
  ownKeys(value, ["kind", "role", "nameParameter", "nameLiteral"], context, errors);
  if (value.kind !== "accessibility" || !nonEmpty(value.role)) errors.push(`${context} requires accessibility kind and role`);
  if (value.nameParameter !== undefined && (!nonEmpty(value.nameParameter) || !parameters.has(value.nameParameter))) errors.push(`${context}.nameParameter is invalid`);
  if (value.nameLiteral !== undefined && (!nonEmpty(value.nameLiteral) || unsafeString(value.nameLiteral))) errors.push(`${context}.nameLiteral is unsafe`);
  if (value.nameParameter === undefined && value.nameLiteral === undefined) errors.push(`${context} requires a semantic name`);
}

function validateCondition(value: unknown, parameters: Set<string>, context: string, errors: string[]): void {
  if (!object(value) || !nonEmpty(value.kind)) { errors.push(`${context} must be a condition`); return; }
  if (value.kind === "application_available") {
    ownKeys(value, ["kind", "bundleId"], context, errors);
    if (!nonEmpty(value.bundleId)) errors.push(`${context}.bundleId is required`);
  } else if (value.kind === "file_exists") {
    ownKeys(value, ["kind", "pathParameter"], context, errors);
    if (!nonEmpty(value.pathParameter) || !parameters.has(value.pathParameter)) errors.push(`${context}.pathParameter is invalid`);
  } else if (value.kind === "element_exists") {
    ownKeys(value, ["kind", "locator"], context, errors);
    validateLocator(value.locator, parameters, `${context}.locator`, errors);
  } else if (value.kind === "visible_text") {
    ownKeys(value, ["kind", "textParameter"], context, errors);
    if (!nonEmpty(value.textParameter) || !parameters.has(value.textParameter)) errors.push(`${context}.textParameter is invalid`);
  } else errors.push(`${context}.kind is not allowed`);
}

function validateAction(value: unknown, parameters: Set<string>, context: string, errors: string[]): void {
  if (!object(value) || !nonEmpty(value.kind)) { errors.push(`${context} must be an action`); return; }
  if (value.kind === "write_parameterized_file") {
    ownKeys(value, ["kind", "pathParameter", "contentParameter"], context, errors);
    for (const key of ["pathParameter", "contentParameter"] as const) if (!nonEmpty(value[key]) || !parameters.has(value[key])) errors.push(`${context}.${key} is invalid`);
  } else if (value.kind === "activate_application") ownKeys(value, ["kind"], context, errors);
  else if (value.kind === "click") {
    ownKeys(value, ["kind", "locator"], context, errors);
    validateLocator(value.locator, parameters, `${context}.locator`, errors);
  } else if (value.kind === "type_parameter") {
    ownKeys(value, ["kind", "locator", "textParameter"], context, errors);
    validateLocator(value.locator, parameters, `${context}.locator`, errors);
    if (!nonEmpty(value.textParameter) || !parameters.has(value.textParameter)) errors.push(`${context}.textParameter is invalid`);
  } else errors.push(`${context}.kind is not allowed`);
}

export function lintProcedure(value: unknown, policy?: ProcedurePolicy): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["Procedure must be an object"] };
  ownKeys(value, ["schemaVersion", "id", "lineageId", "version", "intent", "application", "parameters", "preconditions", "steps", "postconditions", "recovery", "state", "evidence", "repairs"], "$", errors);
  if (value.schemaVersion !== 1 || !nonEmpty(value.id) || !nonEmpty(value.lineageId) || !Number.isInteger(value.version) || Number(value.version) < 1) errors.push("Procedure identity/version is invalid");
  if (!nonEmpty(value.intent) || unsafeString(String(value.intent ?? ""))) errors.push("Procedure intent is missing or unsafe");
  if (!object(value.application)) errors.push("Procedure application is required");
  else {
    ownKeys(value.application, ["bundleId", "appName"], "$.application", errors);
    if (!nonEmpty(value.application.bundleId) || !nonEmpty(value.application.appName)) errors.push("exact application identity is required");
    else if (!policy) errors.push("canonical sensitive application policy is required");
    else if (policy.isSensitiveApplication(value.application as { bundleId: string; appName: string })) errors.push("sensitive application cannot use Procedures");
  }
  const parameters = new Set<string>();
  if (!Array.isArray(value.parameters)) errors.push("parameters must be an array");
  else value.parameters.forEach((parameter, index) => {
    if (!object(parameter)) { errors.push(`parameters[${index}] is invalid`); return; }
    ownKeys(parameter, ["name", "kind", "required"], `parameters[${index}]`, errors);
    if (!nonEmpty(parameter.name) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(parameter.name) || parameters.has(parameter.name)) errors.push(`parameters[${index}].name is invalid`);
    else parameters.add(parameter.name);
    if (!["string", "file_path", "short_text"].includes(String(parameter.kind)) || typeof parameter.required !== "boolean") errors.push(`parameters[${index}] is invalid`);
  });
  const validateConditions = (conditions: unknown, context: string, requireNonempty: boolean) => {
    if (!Array.isArray(conditions) || (requireNonempty && conditions.length === 0)) { errors.push(`${context} must be a nonempty array`); return; }
    conditions.forEach((condition, index) => validateCondition(condition, parameters, `${context}[${index}]`, errors));
  };
  validateConditions(value.preconditions, "preconditions", true);
  validateConditions(value.postconditions, "postconditions", true);
  if (!Array.isArray(value.steps) || value.steps.length === 0) errors.push("steps must be a nonempty array");
  else value.steps.forEach((step, index) => {
    const context = `steps[${index}]`;
    if (!object(step)) { errors.push(`${context} is invalid`); return; }
    ownKeys(step, ["id", "role", "action", "postconditions", "consequential"], context, errors);
    if (!nonEmpty(step.id) || !["gui-operator", "terminal-worker"].includes(String(step.role)) || typeof step.consequential !== "boolean") errors.push(`${context} identity is invalid`);
    validateAction(step.action, parameters, `${context}.action`, errors);
    validateConditions(step.postconditions, `${context}.postconditions`, step.consequential === true);
  });
  if (!Array.isArray(value.recovery)) errors.push("recovery must be an array");
  else value.recovery.forEach((rule, index) => {
    if (!object(rule)) { errors.push(`recovery[${index}] is invalid`); return; }
    ownKeys(rule, ["on", "action"], `recovery[${index}]`, errors);
    if (!["postcondition_failed", "drift"].includes(String(rule.on)) || !["fallback_to_agent", "replan"].includes(String(rule.action))) errors.push(`recovery[${index}] is invalid`);
  });
  if (!["candidate", "verified", "suspended"].includes(String(value.state))) errors.push("Procedure state is invalid");
  if (!object(value.evidence)) errors.push("Procedure evidence is invalid");
  else {
    ownKeys(value.evidence, ["exploration", "independentSuccesses", "consecutiveFailures", "lastFailureKind"], "evidence", errors);
    const exploration = value.evidence.exploration;
    if (!object(exploration) || !nonEmpty(exploration.taskId) || !nonEmpty(exploration.runId) || !validDate(exploration.verifiedAt)) errors.push("exploration evidence is invalid");
    else ownKeys(exploration, ["taskId", "runId", "verifiedAt"], "evidence.exploration", errors);
    if (!Array.isArray(value.evidence.independentSuccesses)) errors.push("replay evidence is invalid");
    else value.evidence.independentSuccesses.forEach((evidence, index) => {
      const context = `evidence.independentSuccesses[${index}]`;
      if (!object(evidence)) { errors.push(`${context} is invalid`); return; }
      ownKeys(evidence, ["procedureId", "version", "taskId", "runId", "replayStartedAt", "verifiedAt", "humanCorrected", "postconditionEvidence", "receipt"], context, errors);
      if (!nonEmpty(evidence.procedureId) || !Number.isInteger(evidence.version) || !nonEmpty(evidence.taskId) || !nonEmpty(evidence.runId) || !validDate(evidence.replayStartedAt) || !validDate(evidence.verifiedAt) || evidence.humanCorrected !== false || !nonEmpty(evidence.receipt)) errors.push(`${context} identity is invalid`);
      if (!Array.isArray(evidence.postconditionEvidence)) errors.push(`${context}.postconditionEvidence is invalid`);
      else evidence.postconditionEvidence.forEach((item, evidenceIndex) => {
        if (!object(item)) { errors.push(`${context}.postconditionEvidence[${evidenceIndex}] is invalid`); return; }
        ownKeys(item, ["scope", "stepId", "conditionIndex", "observationId", "observedAt"], `${context}.postconditionEvidence[${evidenceIndex}]`, errors);
        if (!["step", "procedure"].includes(String(item.scope)) || !Number.isInteger(item.conditionIndex) || !nonEmpty(item.observationId) || !validDate(item.observedAt) || (item.scope === "step" && !nonEmpty(item.stepId)) || (item.scope === "procedure" && item.stepId !== undefined)) errors.push(`${context}.postconditionEvidence[${evidenceIndex}] is invalid`);
      });
    });
    if (!Number.isInteger(value.evidence.consecutiveFailures) || Number(value.evidence.consecutiveFailures) < 0) errors.push("replay failure evidence is invalid");
    if (value.evidence.lastFailureKind !== undefined && !nonEmpty(value.evidence.lastFailureKind)) errors.push("lastFailureKind is invalid");
    const successCount = Array.isArray(value.evidence.independentSuccesses) ? value.evidence.independentSuccesses.length : 0;
    if (value.state === "candidate" && successCount >= 2) errors.push("candidate cannot contain promotion-complete evidence");
    if (value.state === "verified" && successCount < 2) errors.push("verified Procedure requires two replay receipts");
  }
  if (value.repairs !== undefined) {
    if (!object(value.repairs)) errors.push("repairs is invalid");
    else { ownKeys(value.repairs, ["repairsProcedureId"], "repairs", errors); if (!nonEmpty(value.repairs.repairsProcedureId)) errors.push("repairsProcedureId is invalid"); }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function admitted(value: unknown, policy: ProcedurePolicy): Procedure {
  const lint = lintProcedure(value, policy);
  if ("errors" in lint) throw new Error(`Procedure admission failed: ${lint.errors.join("; ")}`);
  return structuredClone(value) as Procedure;
}

export function compileProcedureCandidate(receipt: unknown, policy?: ProcedurePolicy, trajectoryVerifier?: ExecutedTrajectoryVerifier): Procedure {
  if (!policy) throw new Error("canonical sensitive application policy is required");
  if (!trajectoryVerifier) throw new Error("Procedure compiler requires a host executed-trajectory receipt verifier");
  const input = trajectoryVerifier.verify(receipt);
  if (!input) throw new Error("host executed-trajectory receipt is invalid");
  const id = `procedure:${randomUUID()}`;
  return admitted({ schemaVersion: 1, id, lineageId: id, version: 1, intent: input.intent, application: input.application,
    parameters: input.parameters, preconditions: input.preconditions, steps: input.steps, postconditions: input.postconditions,
    recovery: input.recovery, state: "candidate", evidence: { exploration: input.evidence, independentSuccesses: [], consecutiveFailures: 0 } }, policy);
}

type ProcedureDocument = { schemaVersion: 1; procedures: Procedure[] };
export class JsonProcedureStore {
  readonly #path: string;
  readonly #policy: ProcedurePolicy;
  readonly #receiptVerifier: ReplayReceiptVerifier;
  readonly #suspendAfterFailures: number;
  #queue: Promise<void> = Promise.resolve();
  constructor(path: string, options: { policy?: ProcedurePolicy; receiptVerifier?: ReplayReceiptVerifier; suspendAfterFailures?: number } = {}) {
    if (!options.policy) throw new Error("Procedure Store requires canonical sensitive application policy injection");
    if (!options.receiptVerifier) throw new Error("Procedure Store requires a host replay receipt verifier");
    this.#path = path; this.#policy = options.policy; this.#receiptVerifier = options.receiptVerifier; this.#suspendAfterFailures = options.suspendAfterFailures ?? 3;
  }
  async #read(): Promise<ProcedureDocument> {
    try {
      const decoded = JSON.parse(await readFile(this.#path, "utf8"));
      if (decoded?.schemaVersion !== 1 || !Array.isArray(decoded.procedures)) throw new Error("unsupported Procedure Store schema");
      const procedures = decoded.procedures.map((item: unknown) => admitted(item, this.#policy));
      for (const procedure of procedures) {
        for (const stored of procedure.evidence.independentSuccesses) {
          const verified = await this.#receiptVerifier.verify(stored.receipt, { procedureId: procedure.id, version: procedure.version });
          const { receipt: _receipt, ...storedEvidence } = stored;
          if (!verified || !isDeepStrictEqual(verified, storedEvidence)) throw new Error(`stored replay receipt failed host verification for ${procedure.id}`);
          this.#validateReplayEvidence(procedure, verified);
        }
      }
      return { schemaVersion: 1, procedures };
    } catch (error: any) { if (error?.code === "ENOENT") return { schemaVersion: 1, procedures: [] }; throw error; }
  }
  async #write(document: ProcedureDocument): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, this.#path);
  }
  async #mutate<T>(operation: (document: ProcedureDocument) => T | Promise<T>): Promise<T> {
    let output!: T; const queued = this.#queue.then(async () => { const document = await this.#read(); output = await operation(document); await this.#write(document); });
    this.#queue = queued.catch(() => {}); await queued; return output;
  }
  async saveCandidate(candidate: Procedure): Promise<Procedure> {
    const safe = admitted(candidate, this.#policy);
    if (safe.state !== "candidate" || safe.evidence.independentSuccesses.length !== 0 || safe.evidence.consecutiveFailures !== 0) throw new Error("new Procedure candidate state/evidence is invalid");
    return await this.#mutate((document) => { if (document.procedures.some(({ id }) => id === safe.id)) throw new Error(`Procedure ${safe.id} already exists`); document.procedures.push(safe); return structuredClone(safe); });
  }
  async get(id: string): Promise<Procedure> { await this.#queue; const item = (await this.#read()).procedures.find((value) => value.id === id); if (!item) throw new Error(`Procedure ${id} not found`); return structuredClone(item); }
  async findApplicable(input: { intent: string; bundleId: string; includeCandidates?: boolean }) {
    await this.#queue; return (await this.#read()).procedures.filter((item) => (item.state === "verified" || (input.includeCandidates && item.state === "candidate")) && item.intent.toLowerCase() === input.intent.trim().toLowerCase() && item.application.bundleId === input.bundleId)
      .map(({ id, version, intent, application, parameters, state }) => ({ id, version, intent, application, parameters, state }));
  }
  async recordIndependentSuccess(id: string, receipt: unknown): Promise<Procedure> {
    return await this.#mutate(async (document) => {
      const procedure = document.procedures.find((item) => item.id === id); if (!procedure) throw new Error(`Procedure ${id} not found`);
      if (procedure.state !== "candidate") throw new Error(`only a candidate Procedure accepts replay receipts; current state is ${procedure.state}`);
      if (!nonEmpty(receipt)) throw new Error("host replay receipt must be an opaque string");
      const evidence = await this.#receiptVerifier.verify(receipt, { procedureId: procedure.id, version: procedure.version });
      if (!evidence) throw new Error("host replay receipt is invalid");
      this.#validateReplayEvidence(procedure, evidence);
      if (procedure.evidence.independentSuccesses.some((item) => item.taskId === evidence.taskId || item.runId === evidence.runId)) throw new Error("replay receipt is not independent");
      procedure.evidence.independentSuccesses.push({ ...structuredClone(evidence), receipt }); procedure.evidence.consecutiveFailures = 0;
      if (procedure.evidence.independentSuccesses.length >= 2) procedure.state = "verified";
      return structuredClone(procedure);
    });
  }
  #validateReplayEvidence(procedure: Procedure, evidence: VerifiedReplayEvidence): void {
    if (!object(evidence)) throw new Error("replay receipt evidence is invalid");
    const keys = Object.keys(evidence).sort();
    const expectedEvidenceKeys = ["humanCorrected", "postconditionEvidence", "procedureId", "replayStartedAt", "runId", "taskId", "verifiedAt", "version"].sort();
    if (!isDeepStrictEqual(keys, expectedEvidenceKeys) || !nonEmpty(evidence.procedureId) || !Number.isInteger(evidence.version) || !nonEmpty(evidence.taskId) || !nonEmpty(evidence.runId)) throw new Error("replay receipt identity/schema is invalid");
    if (evidence.procedureId !== procedure.id || evidence.version !== procedure.version || evidence.humanCorrected !== false) throw new Error("replay receipt is not bound to this Procedure/version");
    if (!validDate(evidence.replayStartedAt) || !validDate(evidence.verifiedAt) || Date.parse(evidence.verifiedAt) < Date.parse(evidence.replayStartedAt)) throw new Error("replay receipt timestamps are invalid");
    if (evidence.taskId === procedure.evidence.exploration.taskId || evidence.runId === procedure.evidence.exploration.runId) throw new Error("replay receipt is not independent from exploration");
    const expectedKeys = new Set<string>();
    for (const step of procedure.steps.filter((item) => item.consequential)) step.postconditions.forEach((_condition, index) => expectedKeys.add(`step:${step.id}:${index}`));
    procedure.postconditions.forEach((_condition, index) => expectedKeys.add(`procedure::${index}`));
    if (!Array.isArray(evidence.postconditionEvidence) || evidence.postconditionEvidence.length !== expectedKeys.size) throw new Error("replay receipt lacks complete fresh Postcondition evidence");
    const observedKeys = new Set<string>();
    for (const item of evidence.postconditionEvidence) {
      const key = `${item.scope}:${item.stepId ?? ""}:${item.conditionIndex}`;
      if (!expectedKeys.has(key) || observedKeys.has(key) || !nonEmpty(item.observationId) || !validDate(item.observedAt) || Date.parse(item.observedAt) < Date.parse(evidence.replayStartedAt) || Date.parse(evidence.verifiedAt) < Date.parse(item.observedAt)) throw new Error("replay receipt Postcondition evidence is incomplete, stale, or misbound");
      observedKeys.add(key);
    }
  }
  async recordFailure(id: string, failure: { kind: string }): Promise<Procedure> {
    return await this.#mutate((document) => { const item = document.procedures.find((value) => value.id === id); if (!item) throw new Error(`Procedure ${id} not found`); if (item.state === "suspended") return structuredClone(item); item.evidence.consecutiveFailures += 1; item.evidence.lastFailureKind = failure.kind; if (item.evidence.consecutiveFailures >= this.#suspendAfterFailures) item.state = "suspended"; return structuredClone(item); });
  }
  async createRepairCandidate(id: string, repair: { steps: ProcedureStep[]; evidence: ProcedureEvidenceItem }): Promise<Procedure> {
    return await this.#mutate((document) => { const verified = document.procedures.find((item) => item.id === id); if (!verified || verified.state !== "verified") throw new Error("only a verified Procedure can produce a repair candidate");
      const version = Math.max(...document.procedures.filter((item) => item.lineageId === verified.lineageId).map((item) => item.version)) + 1;
      const candidate = admitted({ ...structuredClone(verified), id: `procedure:${randomUUID()}`, version, steps: repair.steps, state: "candidate", evidence: { exploration: repair.evidence, independentSuccesses: [], consecutiveFailures: 0 }, repairs: { repairsProcedureId: verified.id } }, this.#policy);
      document.procedures.push(candidate); return structuredClone(candidate); });
  }
}

export type ObservationReference = { id: string; capturedAt: string };
export type ConditionEvaluation = { met: boolean; observationId: string; observedAt: string };
export type ProcedureReplayResult = { outcome: "succeeded" | "fallback_to_agent" | "drift"; completedSteps: number; reason?: string; receipt?: unknown };
type Evaluator = (condition: ProcedureCondition, phase: "precondition" | "step_postcondition" | "procedure_postcondition", parameters: Record<string, unknown>, observation?: ObservationReference) => Promise<ConditionEvaluation>;
type Executor = (step: ProcedureStep, parameters: Record<string, unknown>, signal?: AbortSignal) => Promise<{ ok: boolean; observation?: ObservationReference }>;
type ReceiptIssuer = (evidence: VerifiedReplayEvidence) => Promise<unknown>;
export class ProcedureReplayEngine {
  readonly #policy: ProcedurePolicy; readonly #evaluate: Evaluator; readonly #executeStep: Executor; readonly #issueReceipt: ReceiptIssuer;
  constructor(input: { policy?: ProcedurePolicy; evaluate: Evaluator; executeStep: Executor; issueReceipt?: ReceiptIssuer }) {
    if (!input.policy) throw new Error("Procedure Replay requires canonical sensitive application policy injection");
    if (!input.issueReceipt) throw new Error("Procedure Replay requires a host receipt issuer");
    this.#policy = input.policy; this.#evaluate = input.evaluate; this.#executeStep = input.executeStep; this.#issueReceipt = input.issueReceipt;
  }
  async replay(raw: Procedure, parameters: Record<string, unknown>, signal?: AbortSignal, identity: { taskId?: string; runId?: string } = {}): Promise<ProcedureReplayResult> {
    const procedure = admitted(raw, this.#policy);
    if (procedure.preconditions.length === 0) throw new Error("Procedure replay requires nonempty Preconditions");
    if (procedure.state === "suspended") return { outcome: "fallback_to_agent", completedSteps: 0, reason: "procedure_suspended" };
    if (!nonEmpty(identity.taskId) || !nonEmpty(identity.runId)) throw new Error("Procedure replay requires nonempty task and run identity");
    for (const parameter of procedure.parameters) if (parameter.required && !(parameter.name in parameters)) return { outcome: "fallback_to_agent", completedSteps: 0, reason: `missing_parameter:${parameter.name}` };
    const replayStartedAt = new Date().toISOString();
    for (const condition of procedure.preconditions) { const result = await this.#evaluate(condition, "precondition", parameters); if (!result.met || !nonEmpty(result.observationId) || !validDate(result.observedAt)) return { outcome: "fallback_to_agent", completedSteps: 0, reason: "precondition_failed" }; }
    let completedSteps = 0; let lastObservation: ObservationReference | undefined; const postconditionEvidence: VerifiedReplayEvidence["postconditionEvidence"] = [];
    for (const step of procedure.steps) {
      if (signal?.aborted) return { outcome: "fallback_to_agent", completedSteps, reason: "cancelled" };
      const executed = await this.#executeStep(step, parameters, signal); if (!executed.ok || !executed.observation) return { outcome: "drift", completedSteps, reason: `step_failed:${step.id}` };
      lastObservation = executed.observation; completedSteps += 1;
      if (step.consequential) for (let index = 0; index < step.postconditions.length; index += 1) { const evaluated = await this.#evaluate(step.postconditions[index], "step_postcondition", parameters, lastObservation);
        if (!evaluated.met || evaluated.observationId !== lastObservation.id || !validDate(evaluated.observedAt) || Date.parse(evaluated.observedAt) < Date.parse(lastObservation.capturedAt)) return { outcome: "drift", completedSteps, reason: `step_postcondition_failed:${step.id}` };
        postconditionEvidence.push({ scope: "step", stepId: step.id, conditionIndex: index, observationId: evaluated.observationId, observedAt: evaluated.observedAt }); }
    }
    if (!lastObservation) throw new Error("Procedure replay requires at least one executed step observation");
    for (let index = 0; index < procedure.postconditions.length; index += 1) { const evaluated = await this.#evaluate(procedure.postconditions[index], "procedure_postcondition", parameters, lastObservation);
      if (!evaluated.met || evaluated.observationId !== lastObservation.id || !validDate(evaluated.observedAt) || Date.parse(evaluated.observedAt) < Date.parse(lastObservation.capturedAt)) return { outcome: "drift", completedSteps, reason: "procedure_postcondition_failed" };
      postconditionEvidence.push({ scope: "procedure", conditionIndex: index, observationId: evaluated.observationId, observedAt: evaluated.observedAt }); }
    const verifiedAt = new Date().toISOString();
    const receipt = await this.#issueReceipt({ procedureId: procedure.id, version: procedure.version, taskId: identity.taskId, runId: identity.runId, replayStartedAt, verifiedAt, humanCorrected: false, postconditionEvidence });
    if (!nonEmpty(receipt)) throw new Error("host receipt issuer returned an invalid receipt");
    return { outcome: "succeeded", completedSteps, receipt };
  }
}

export type ComputerRecipeRetriever = { queryComputerRecipes(query: { intent: string; bundleId: string; limit: number }): Promise<Array<Record<string, unknown>>> };
export class ReadOnlyComputerRecipeAdapter {
  readonly #retriever: ComputerRecipeRetriever; constructor(retriever: ComputerRecipeRetriever) { this.#retriever = retriever; }
  async retrieve(input: { intent: string; bundleId: string }) { const results = await this.#retriever.queryComputerRecipes({ ...input, limit: 5 }); return results.slice(0, 5).map(({ id, intent, application, successRate, stepSummary, parameters }) => ({ id, intent, application, successRate, stepSummary, parameters })); }
}
