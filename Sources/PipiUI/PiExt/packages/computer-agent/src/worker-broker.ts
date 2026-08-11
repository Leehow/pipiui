import { randomBytes, randomUUID } from "node:crypto";

export type ComputerWorkerRole = "gui-operator" | "terminal-worker" | "verifier";
export type ComputerWorkerGrant = "observe" | "mutate" | "openApplication";
export type ComputerWorkerOperation = ComputerWorkerGrant | "locate";

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

type GrantRecord = {
  taskId: string;
  stepId: string;
  runId: string;
  role: ComputerWorkerRole;
  grants: ReadonlySet<ComputerWorkerGrant>;
  lastObservation?: Record<string, unknown>;
  bindings: Map<string, { role: string; nameLiteral: string }>;
  executions: HostGuiExecutionRecord[];
  controllers: Set<AbortController>;
};

export function grantsForComputerRole(role: ComputerWorkerRole): ComputerWorkerGrant[] {
  if (role === "gui-operator") return ["observe", "mutate", "openApplication"];
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

  constructor(input: {
    request: ComputerRuntimeAdapter["request"];
    tokenFactory?: () => string;
  }) {
    this.#runtime = { request: input.request };
    this.#tokenFactory = input.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  issue(input: {
    taskId: string;
    stepId: string;
    runId: string;
    role: ComputerWorkerRole;
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
    this.#grants.set(token, {
      ...input,
      grants: new Set(grants),
      bindings: new Map(),
      executions: [],
      controllers: new Set(),
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
    if (request.operation === "locate" ? !grant.grants.has("observe") : !grant.grants.has(request.operation)) {
      throw new Error(`computer worker role ${grant.role} does not grant ${request.operation}`);
    }
    const reservedEnvelopeFields = new Set([
      "action", "taskId", "stepId", "runId", "sessionKey", "computerCapability",
      "protocolVersion", "requestID", "displayID", "displayWidth", "displayHeight",
    ]);
    if (request.operation !== "mutate") reservedEnvelopeFields.add("actions");
    const allowedPayloadFields = request.operation === "observe"
      ? new Set(["fresh"])
      : request.operation === "locate"
        ? new Set(["role", "name", "value"])
      : request.operation === "mutate"
        ? new Set(["actions", "semanticBindings"])
        : new Set(["bundle_identifier", "application_name"]);
    for (const key of Object.keys(request.payload)) {
      if (reservedEnvelopeFields.has(key)) throw new Error(`forbidden broker envelope field: ${key}`);
      if (!allowedPayloadFields.has(key)) throw new Error(`forbidden broker payload field for ${request.operation}: ${key}`);
    }
    if (request.operation === "observe" && request.payload.fresh !== undefined && typeof request.payload.fresh !== "boolean") throw new Error("observe fresh must be boolean");
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
    if (request.operation === "mutate" && (!Array.isArray(request.payload.actions) || request.payload.actions.length < 1 || request.payload.actions.length > 64)) throw new Error("mutate requires 1...64 actions");
    if (request.operation === "openApplication" && ![request.payload.bundle_identifier, request.payload.application_name].some((value) => typeof value === "string" && value.trim().length > 0)) throw new Error("openApplication requires an exact application identity");
    const action = request.operation === "openApplication"
      ? "computer_open_application"
      : "computer_batch";
    const payload = request.operation === "observe"
      ? { ...request.payload, actions: [{ type: "screenshot" }] }
      : request.operation === "mutate" ? { actions: request.payload.actions } : request.payload;
    const controller = new AbortController();
    grant.controllers.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const result = await this.#runtime.request({
      ...payload,
      action,
      taskId: grant.taskId,
      stepId: grant.stepId,
      runId: grant.runId,
    }, controller.signal).finally(() => { grant.controllers.delete(controller); signal?.removeEventListener("abort", abort); });
    const observationId = String((result as any).observationId ?? (result as any).screenshotId ?? "");
    const observedAt = new Date().toISOString();
    if (["observe", "mutate", "openApplication"].includes(request.operation)) grant.lastObservation = result;
    if (request.operation === "openApplication" && observationId) grant.executions.push({ kind: "open_application", bundleId: typeof request.payload.bundle_identifier === "string" ? request.payload.bundle_identifier : undefined, appName: typeof request.payload.application_name === "string" ? request.payload.application_name : undefined, observationId, observedAt });
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
  observation(taskId: string, stepId: string): Record<string, unknown> | undefined {
    for (const grant of this.#grants.values()) if (grant.taskId === taskId && grant.stepId === stepId && grant.lastObservation) return structuredClone(grant.lastObservation);
    return undefined;
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
