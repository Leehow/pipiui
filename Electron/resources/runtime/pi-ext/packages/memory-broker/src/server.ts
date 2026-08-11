import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  MemoryCandidateQuarantine,
  MemoryContractError,
  MemoryWorkerGrantRegistry,
  authorizeCapability,
  authorizeQuery,
  boundQueryResults,
  createActorContext,
  normalizeMemoryBrokerRequest,
  type MemoryActorContext,
  type MemoryBrokerRequest,
  type MemoryDesktopGrant,
  type MemoryExperienceCandidate,
  type MemoryRole,
} from "#memory-broker-contract";
import { MemoryBackendUnavailableError, type MemoryBrokerBackend, UnavailableMemoryBackend } from "./backend.ts";
import { MEMORY_ADMIN_MAX_BODY_BYTES, MEMORY_ADMIN_PATH, type MemoryAdminService } from "./memory-admin.ts";
import {
  MEMORY_BROKER_HTTP_VERSION,
  MEMORY_BROKER_MAX_REQUEST_BYTES,
  MEMORY_BROKER_MAX_RESPONSE_BYTES,
  MEMORY_BROKER_PATH,
} from "./protocol.ts";

export {
  MEMORY_BROKER_HTTP_VERSION,
  MEMORY_BROKER_MAX_REQUEST_BYTES,
  MEMORY_BROKER_MAX_RESPONSE_BYTES,
  MEMORY_BROKER_PATH,
} from "./protocol.ts";
export type { MemoryBrokerMode } from "./protocol.ts";

type ChildActor = {
  capability: string;
  agentID: string;
  runID: string;
};

export type MemoryBrokerWireResponse = {
  version: typeof MEMORY_BROKER_HTTP_VERSION;
  ok: boolean;
  operation?: MemoryBrokerRequest["operation"];
  results?: Array<{ claim: string; score: number }>;
  acceptedDedupeKey?: string;
  duplicate?: boolean;
  status?: { ready: boolean; detail?: string };
  error?: string;
};

export type MemoryBrokerServerOptions = {
  projectRoot: string;
  chatSessionID?: string;
  bridgeRoutingKey?: string;
  backend?: MemoryBrokerBackend;
  host?: string;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Main-only observer used to admit quarantined child candidates into Catalog. */
  onCandidate?: (candidate: MemoryExperienceCandidate, context: MemoryActorContext) => Promise<void> | void;
  /** Constructed only by the main extension; worker/operator never receive this route. */
  adminService?: MemoryAdminService;
};

export type ChildCapabilityInput = {
  agentID: string;
  runID: string;
  role: "worker" | "operator";
  /** Existing dispatch state only; this server cannot mint desktop grants. */
  hostIssuedDesktopGrant?: MemoryDesktopGrant;
};

export type MemoryBrokerConnection = {
  url: string;
  token: string;
  projectRoot: string;
};

/** Opaque one-shot host descriptor; the full admin credentials stay in its URL fragment. */
export type MemoryCenterOpenDescriptor = { version: 1; url: string; expiresAt: string };

export type MemoryBrokerPackageErrorCode =
  | "broker-not-started"
  | "non-loopback"
  | "invalid-wire-request"
  | "body-too-large"
  | "backend-unavailable";

export class MemoryBrokerPackageError extends Error {
  readonly code: MemoryBrokerPackageErrorCode;

  constructor(code: MemoryBrokerPackageErrorCode, message: string) {
    super(message);
    this.name = "MemoryBrokerPackageError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1";
}

function boundedError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? "memory broker rejected request");
  return text.replace(/[\u0000\r\n]/gu, " ").trim().slice(0, 240) || "memory broker rejected request";
}

function errorResponse(error: unknown): MemoryBrokerWireResponse {
  return {
    version: MEMORY_BROKER_HTTP_VERSION,
    ok: false,
    error: boundedError(error),
  };
}

function responseStatus(error: unknown): number {
  if (error instanceof MemoryBrokerPackageError) {
    if (error.code === "body-too-large") return 413;
    if (error.code === "backend-unavailable") return 503;
    return 400;
  }
  if (error instanceof MemoryContractError) {
    if (error.code === "unauthorized-worker") return 403;
    if (error.code === "stale-run") return 409;
    if (error.code === "denied" || error.code === "computer-memory-grant-required") return 403;
    return 400;
  }
  if (error instanceof MemoryBackendUnavailableError) return 503;
  return 500;
}

function hasDangerousKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDangerousKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) =>
    key === "__proto__" || key === "constructor" || key === "prototype" || hasDangerousKey(entry),
  );
}

function parseWireBody(raw: string): { actor: ChildActor; request: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MemoryBrokerPackageError("invalid-wire-request", "Memory broker request is not valid JSON.");
  }
  if (!isRecord(parsed) || hasDangerousKey(parsed) || parsed.version !== MEMORY_BROKER_HTTP_VERSION) {
    throw new MemoryBrokerPackageError("invalid-wire-request", "Unsupported memory broker wire request.");
  }
  if (!isRecord(parsed.actor)
    || Object.keys(parsed.actor).some((key) => !["capability", "agentID", "runID"].includes(key))
    || typeof parsed.actor.capability !== "string"
    || typeof parsed.actor.agentID !== "string"
    || typeof parsed.actor.runID !== "string"
    || parsed.request === undefined) {
    throw new MemoryBrokerPackageError("invalid-wire-request", "Memory broker actor is invalid.");
  }
  return {
    actor: {
      capability: parsed.actor.capability,
      agentID: parsed.actor.agentID,
      runID: parsed.actor.runID,
    },
    request: parsed.request,
  };
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    request.resume();
    return Promise.reject(new MemoryBrokerPackageError("body-too-large", "Memory broker request is too large."));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(bytes);
    });
    request.once("end", () => {
      if (tooLarge) {
        reject(new MemoryBrokerPackageError("body-too-large", "Memory broker request is too large."));
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    request.once("error", () => reject(new MemoryBrokerPackageError("invalid-wire-request", "Memory broker request failed.")));
  });
}

function writeJSON(response: ServerResponse, status: number, value: MemoryBrokerWireResponse, maxBytes: number): void {
  let body = JSON.stringify(value);
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    status = 500;
    body = JSON.stringify({
      version: MEMORY_BROKER_HTTP_VERSION,
      ok: false,
      error: "Memory broker response exceeded its size limit.",
    } satisfies MemoryBrokerWireResponse);
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body, "utf8"),
    "cache-control": "no-store",
  });
  response.end(body);
}

function tokenMatches(expected: string, actual: string | string[] | undefined): boolean {
  if (typeof actual !== "string") return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Session-scoped loopback transport and policy adapter. It only owns bounded
 * transport, identity fencing, and backend dispatch; retrieval/learning remain
 * in the injected backend.
 */
export class MemoryBrokerServer {
  private readonly backend: MemoryBrokerBackend;
  private readonly host: string;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly token = randomBytes(32).toString("base64url");
  private readonly projectRoot: string;
  private readonly registry: MemoryWorkerGrantRegistry;
  private readonly quarantine = new MemoryCandidateQuarantine();
  private readonly mainContext: MemoryActorContext;
  private readonly onCandidate: ((candidate: MemoryExperienceCandidate, context: MemoryActorContext) => Promise<void> | void) | undefined;
  private readonly adminService: MemoryAdminService | undefined;
  private server: Server | undefined;
  private connection: MemoryBrokerConnection | undefined;

  constructor(options: MemoryBrokerServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    if (!isLoopbackHost(this.host)) {
      throw new MemoryBrokerPackageError("non-loopback", "Memory broker may listen only on a loopback address.");
    }
    this.backend = options.backend ?? new UnavailableMemoryBackend();
    this.maxRequestBytes = options.maxRequestBytes ?? MEMORY_BROKER_MAX_REQUEST_BYTES;
    this.maxResponseBytes = options.maxResponseBytes ?? MEMORY_BROKER_MAX_RESPONSE_BYTES;
    this.mainContext = createActorContext({
      projectRoot: options.projectRoot,
      chatSessionID: options.chatSessionID ?? "memory-main-session",
      bridgeRoutingKey: options.bridgeRoutingKey ?? "memory-main-route",
      agentID: "main",
      runID: "main-session",
      role: "main",
    });
    this.projectRoot = this.mainContext.projectRoot;
    this.onCandidate = options.onCandidate;
    this.adminService = options.adminService;
    this.registry = new MemoryWorkerGrantRegistry({
      projectRoot: this.projectRoot,
      chatSessionID: this.mainContext.chatSessionID,
      bridgeRoutingKey: this.mainContext.bridgeRoutingKey,
    });
  }

  async start(): Promise<MemoryBrokerConnection> {
    if (this.connection) return this.connection;
    const server = createServer((request, response) => {
      void this.handleHTTP(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: this.host, port: 0, exclusive: true }, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string" || !isLoopbackHost(address.address)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new MemoryBrokerPackageError("non-loopback", "Memory broker did not bind a loopback address.");
    }
    this.server = server;
    const originHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
    this.connection = {
      url: `http://${originHost}:${address.port}${MEMORY_BROKER_PATH}`,
      token: this.token,
      projectRoot: this.projectRoot,
    };
    return this.connection;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.connection = undefined;
    try {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      await this.backend.close?.();
    }
  }

  getConnection(): MemoryBrokerConnection | undefined {
    return this.connection ? { ...this.connection } : undefined;
  }

  /** Main-host seam. It deliberately has no child environment equivalent. */
  issueAdminSession(): MemoryCenterOpenDescriptor | undefined {
    const connection = this.connection;
    if (!connection || !this.adminService) return undefined;
    const session = this.adminService.issueAdminSession(new URL(connection.url).origin);
    return { version: 1, url: `${session.origin}${session.path}${session.bootstrapFragment}`, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  revokeAdminSession(): void { this.adminService?.revokeAdminSession(); }

  noteRetrievalTelemetry(telemetry: { triggered: boolean; skipped: boolean; abstained: boolean; resultCount: number; latencyMs: number }): void { this.adminService?.noteRetrieval(telemetry); }

  /** Main hosts issue one capability for each authenticated child dispatch. */
  issueChildCapability(input: ChildCapabilityInput): Record<string, string> {
    const connection = this.connection;
    if (!connection) {
      throw new MemoryBrokerPackageError("broker-not-started", "Memory broker has not started.");
    }
    const capability = randomBytes(32).toString("base64url");
    this.registry.registerHostDispatch({
      capability,
      agentID: input.agentID,
      runID: input.runID,
      role: input.role,
      ...(input.hostIssuedDesktopGrant ? { hostIssuedDesktopGrant: input.hostIssuedDesktopGrant } : {}),
    });
    const context = this.registry.validate(capability, input.agentID, input.runID);
    return {
      PIPIUI_MEMORY_BROKER_MODE: context.role,
      PIPIUI_MEMORY_BROKER_URL: connection.url,
      PIPIUI_MEMORY_BROKER_TOKEN: connection.token,
      PIPIUI_MEMORY_BROKER_CAPABILITY: capability,
      PIPIUI_MEMORY_PROJECT_ROOT: context.projectRoot,
      // The child may run in a worktree; preserve the canonical main root for
      // its own session/continuity paths and never derive memory scope from cwd.
      PIPIUI_MAIN_CWD: context.projectRoot,
      PIPIUI_AGENT_ID: context.agentID,
      PIPIUI_AGENT_RUN_ID: context.runID,
      PIPIUI_AGENT_ROLE: context.role,
    };
  }

  /** Host-local main path; no child role or authority is accepted from HTTP. */
  async handleMainRequest(rawRequest: unknown): Promise<MemoryBrokerWireResponse> {
    try {
      const request = normalizeMemoryBrokerRequest(rawRequest);
      return await this.dispatch(this.mainContext, request);
    } catch (error) {
      return errorResponse(error);
    }
  }

  candidateForDedupeKey(key: string): MemoryExperienceCandidate | undefined {
    return this.quarantine.candidateForDedupeKey(key);
  }

  /** Main-only durable migration readback; child HTTP clients cannot invoke it. */
  async verifyMainImportedCandidate(candidate: MemoryExperienceCandidate): Promise<boolean> {
    return this.backend.verifyImported?.(candidate, this.mainContext) ?? false;
  }

  private async handleHTTP(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://loopback");
    if (this.adminService && (url.pathname.startsWith(MEMORY_ADMIN_PATH) || url.pathname.startsWith("/memory-center/"))) {
      await this.handleAdminHTTP(request, response, url);
      return;
    }
    if (request.method !== "POST" || url.pathname !== MEMORY_BROKER_PATH) {
      writeJSON(response, 404, errorResponse(new MemoryBrokerPackageError("invalid-wire-request", "Memory broker endpoint was not found.")), this.maxResponseBytes);
      return;
    }
    if (!tokenMatches(this.token, request.headers["x-pipiui-memory-token"])) {
      request.resume();
      writeJSON(response, 401, errorResponse(new MemoryContractError("unauthorized-worker", "Memory broker capability is unauthorized.")), this.maxResponseBytes);
      return;
    }
    try {
      const body = parseWireBody(await readBody(request, this.maxRequestBytes));
      const context = this.registry.validate(body.actor.capability, body.actor.agentID, body.actor.runID);
      const normalized = normalizeMemoryBrokerRequest(body.request);
      writeJSON(response, 200, await this.dispatch(context, normalized), this.maxResponseBytes);
    } catch (error) {
      writeJSON(response, responseStatus(error), errorResponse(error), this.maxResponseBytes);
    }
  }

  private async handleAdminHTTP(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const connection = this.connection;
    const origin = connection ? new URL(connection.url).origin : "";
    const host = request.headers.host ?? "";
    const requestOrigin = request.headers.origin;
    if (!connection || host !== new URL(origin).host || (requestOrigin !== undefined && requestOrigin !== origin)) {
      request.resume(); response.writeHead(403, { "cache-control": "no-store" }); response.end(); return;
    }
    const method = request.method ?? "GET";
    if (!["GET", "POST"].includes(method) || (method === "POST" && !String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"))) {
      request.resume(); response.writeHead(415, { "cache-control": "no-store" }); response.end(); return;
    }
    let body: unknown = undefined;
    try { if (method === "POST") body = JSON.parse(await readBody(request, Math.min(this.maxRequestBytes, MEMORY_ADMIN_MAX_BODY_BYTES))); } catch { response.writeHead(400, { "cache-control": "no-store" }); response.end(); return; }
    const result = await this.adminService!.handle(method, url.pathname, url.searchParams, request.headers, body, origin);
    const payload = Buffer.isBuffer(result.body) ? result.body : Buffer.from(JSON.stringify(result.body));
    response.writeHead(result.status, { "content-length": payload.length, "cache-control": "no-store", ...(Buffer.isBuffer(result.body) ? {} : { "content-type": "application/json; charset=utf-8" }), ...(result.headers ?? {}) }); response.end(payload);
  }

  private async dispatch(context: MemoryActorContext, request: MemoryBrokerRequest): Promise<MemoryBrokerWireResponse> {
    switch (request.operation) {
      case "memory.query": {
        const query = request.query;
        if (!query) throw new MemoryContractError("invalid-request", "Missing memory query.");
        authorizeQuery(context, query);
        const results = boundQueryResults(await this.backend.query(query, context));
        return {
          version: MEMORY_BROKER_HTTP_VERSION,
          ok: true,
          operation: request.operation,
          results,
        };
      }
      case "experience.submit": {
        const candidate = request.candidate;
        if (!candidate) throw new MemoryContractError("invalid-request", "Missing experience candidate.");
        const admission = this.quarantine.accept(context, candidate, request.promote === true);
        if (!admission.duplicate) {
          try {
            // Catalog admission is main-owned but captures the original quarantined
            // candidate before any backend persistence. It cannot affect broker ACLs.
            await this.onCandidate?.(admission.candidate, context);
            await this.backend.ingest(admission.candidate, context, admission.durable);
          } catch (error) {
            this.quarantine.discard(admission.key);
            throw error;
          }
        }
        return {
          version: MEMORY_BROKER_HTTP_VERSION,
          ok: true,
          operation: request.operation,
          acceptedDedupeKey: admission.key,
          duplicate: admission.duplicate,
        };
      }
      case "memory.status": {
        authorizeCapability("query", context);
        return {
          version: MEMORY_BROKER_HTTP_VERSION,
          ok: true,
          operation: request.operation,
          status: await this.backend.status(context),
        };
      }
    }
  }
}
