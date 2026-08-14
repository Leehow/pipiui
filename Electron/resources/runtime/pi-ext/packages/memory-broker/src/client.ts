import {
  MEMORY_LIMITS,
  computerCandidateFromDraft,
  containsLikelySecret,
  normalizeExperienceCandidate,
  normalizeQuery,
  type ComputerMemoryDraft,
  type MemoryExperienceCandidate,
  type MemoryOutcome,
  type MemoryQuery,
  type MemoryQueryResult,
} from "#memory-broker-contract";
import {
  MEMORY_BROKER_HTTP_VERSION,
  MEMORY_BROKER_MAX_RESPONSE_BYTES,
  MEMORY_BROKER_PATH,
  MEMORY_BROKER_TIMEOUT_MS,
  type MemoryBrokerMode,
} from "./protocol.ts";
import type { MemoryBrokerWireResponse } from "./server.ts";

export type MemoryBrokerClientEnvironment = {
  mode: "worker" | "operator";
  url: string;
  token: string;
  capability: string;
  agentID: string;
  runID: string;
  projectRoot: string;
};

export type MemoryBrokerClientResult<T> = {
  available: boolean;
  value?: T;
  error?: string;
};

export type MemoryBrokerFetch = typeof fetch;

function textEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function safeIdentity(value: string | undefined): value is string {
  return !!value && Buffer.byteLength(value, "utf8") <= 512 && !/[\u0000\r\n]/u.test(value);
}

export function isLoopbackMemoryBrokerURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1")
      && url.pathname === MEMORY_BROKER_PATH
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

/** Worker/operator setup only. Main has an in-process broker, not a child client. */
export function memoryBrokerClientEnvironment(
  env: Record<string, string | undefined> = process.env,
): MemoryBrokerClientEnvironment | undefined {
  const requestedMode = textEnv(env, "PIPIUI_MEMORY_BROKER_MODE") ?? textEnv(env, "PIPIUI_AGENT_ROLE");
  if (requestedMode !== "worker" && requestedMode !== "operator") return undefined;
  const url = textEnv(env, "PIPIUI_MEMORY_BROKER_URL");
  const token = textEnv(env, "PIPIUI_MEMORY_BROKER_TOKEN");
  const capability = textEnv(env, "PIPIUI_MEMORY_BROKER_CAPABILITY");
  const agentID = textEnv(env, "PIPIUI_AGENT_ID");
  const runID = textEnv(env, "PIPIUI_AGENT_RUN_ID");
  const projectRoot = textEnv(env, "PIPIUI_MEMORY_PROJECT_ROOT");
  if (!url || !isLoopbackMemoryBrokerURL(url)
    || !token || token.length < 43
    || !capability || capability.length < 32 || capability.length > 512
    || !safeIdentity(agentID) || !safeIdentity(runID) || !projectRoot) {
    return undefined;
  }
  return { mode: requestedMode, url, token, capability, agentID, runID, projectRoot };
}

function boundedError(value: unknown): string {
  const text = typeof value === "string" ? value : "memory broker unavailable";
  return text.replace(/[\u0000\r\n]/gu, " ").trim().slice(0, 240) || "memory broker unavailable";
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("memory broker response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new Error("memory broker response is too large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function parseWireResponse(raw: string): MemoryBrokerWireResponse | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const response = value as MemoryBrokerWireResponse;
    if (response.version !== MEMORY_BROKER_HTTP_VERSION || typeof response.ok !== "boolean") return undefined;
    return response;
  } catch {
    return undefined;
  }
}

/**
 * Fail-closed HTTP client: all transport/backend failures become an unavailable
 * result, so optional memory recall never blocks the agent's primary flow.
 */
export class MemoryBrokerClient {
  readonly environment: MemoryBrokerClientEnvironment;
  private readonly fetchImpl: MemoryBrokerFetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(
    environment: MemoryBrokerClientEnvironment,
    options: { fetchImpl?: MemoryBrokerFetch; timeoutMs?: number; maxResponseBytes?: number } = {},
  ) {
    this.environment = environment;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? MEMORY_BROKER_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? MEMORY_BROKER_MAX_RESPONSE_BYTES;
  }

  async query(input: {
    text: string;
    budget?: number;
    scope?: "project" | "session";
    bundleID?: string;
    appName?: string;
  }): Promise<MemoryBrokerClientResult<{ query: MemoryQuery; results: MemoryQueryResult[] }>> {
    if (this.environment.mode !== "operator" && (input.bundleID !== undefined || input.appName !== undefined)) {
      return { available: false, error: "Application-scoped memory query requires an operator client." };
    }
    let query: MemoryQuery;
    try {
      query = normalizeQuery({
        text: input.text,
        budget: input.budget ?? MEMORY_LIMITS.defaultQueryBudget,
        scope: input.scope ?? "project",
        ...(input.bundleID !== undefined ? { bundleID: input.bundleID } : {}),
        ...(input.appName !== undefined ? { appName: input.appName } : {}),
      });
    } catch (error) {
      return { available: false, error: boundedError(error instanceof Error ? error.message : error) };
    }
    const response = await this.post({
      version: MEMORY_BROKER_HTTP_VERSION,
      operation: "memory.query",
      query,
    });
    if (!response.available || !response.value?.ok || response.value.operation !== "memory.query") {
      return { available: false, error: response.error };
    }
    return {
      available: true,
      value: { query, results: Array.isArray(response.value.results) ? response.value.results : [] },
    };
  }

  async submitCandidate(candidate: MemoryExperienceCandidate): Promise<MemoryBrokerClientResult<{
    acceptedDedupeKey?: string;
    duplicate: boolean;
  }>> {
    // A child has no durable-write surface even if a caller attempts to request it.
    const response = await this.post({
      version: MEMORY_BROKER_HTTP_VERSION,
      operation: "experience.submit",
      candidate,
      promote: false,
    });
    if (!response.available || !response.value?.ok || response.value.operation !== "experience.submit") {
      return { available: false, error: response.error };
    }
    return {
      available: true,
      value: {
        acceptedDedupeKey: response.value.acceptedDedupeKey,
        duplicate: response.value.duplicate === true,
      },
    };
  }

  async status(): Promise<MemoryBrokerClientResult<{ ready: boolean; detail?: string }>> {
    const response = await this.post({
      version: MEMORY_BROKER_HTTP_VERSION,
      operation: "memory.status",
    });
    if (!response.available || !response.value?.ok || response.value.operation !== "memory.status" || !response.value.status) {
      return { available: false, error: response.error };
    }
    return { available: true, value: response.value.status };
  }

  private async post(request: Record<string, unknown>): Promise<MemoryBrokerClientResult<MemoryBrokerWireResponse>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.environment.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pipiui-memory-token": this.environment.token,
        },
        body: JSON.stringify({
          version: MEMORY_BROKER_HTTP_VERSION,
          actor: {
            capability: this.environment.capability,
            agentID: this.environment.agentID,
            runID: this.environment.runID,
          },
          request,
        }),
        signal: controller.signal,
      });
      const wire = parseWireResponse(await readResponseWithLimit(response, this.maxResponseBytes));
      if (!response.ok || !wire?.ok) {
        return { available: false, error: boundedError(wire?.error) };
      }
      return { available: true, value: wire };
    } catch {
      return {
        available: false,
        error: controller.signal.aborted ? "Memory broker request timed out." : "Memory broker request failed.",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createMemoryBrokerClient(
  env: Record<string, string | undefined> = process.env,
  options?: { fetchImpl?: MemoryBrokerFetch; timeoutMs?: number; maxResponseBytes?: number },
): MemoryBrokerClient | undefined {
  const environment = memoryBrokerClientEnvironment(env);
  return environment ? new MemoryBrokerClient(environment, options) : undefined;
}

export type TerminalExperienceCandidateInput = {
  runID: string;
  agentName: string;
  task: string;
  title?: string;
  terminalText: string;
  outcome: MemoryOutcome;
  evidenceClass: "source-backed" | "verification-passed";
};

type TerminalExperienceCandidateMaterial = TerminalExperienceCandidateInput & { agentID?: string };

const TERMINAL_BRIEF_MAX_CHARS = 900;
const TERMINAL_EVIDENCE_MAX_CHARS = 1_100;

function boundedOneLine(value: unknown, maximumChars: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\u0000/gu, "").trim().replace(/\s+/gu, " ");
  if (!normalized) return "";
  return normalized.length <= maximumChars
    ? normalized
    : `${normalized.slice(0, Math.max(0, maximumChars - 1)).trimEnd()}…`;
}

/**
 * Bounded terminal metadata for a worker's existing run. It is always a
 * session-scoped `brief` candidate: a child cannot turn a terminal report into
 * durable project memory.
 */
export function makeTerminalExperienceCandidate(
  input: TerminalExperienceCandidateMaterial,
): MemoryExperienceCandidate | undefined {
  const agentName = boundedOneLine(input.agentName, 80);
  const agentID = boundedOneLine(input.agentID, 120);
  if (!agentName || !["explore", "plan", "general-purpose", "reviewer", "long-test"].includes(agentName)) return undefined;
  if (input.evidenceClass !== "source-backed" && input.evidenceClass !== "verification-passed") return undefined;
  const expectedEvidence = agentName === "general-purpose" || agentName === "long-test"
    ? "verification-passed"
    : "source-backed";
  if (input.evidenceClass !== expectedEvidence) return undefined;
  const claim = boundedOneLine([
    input.title ? `Title: ${input.title}` : "",
    `Task: ${input.task}`,
  ].filter(Boolean).join(" — "), TERMINAL_BRIEF_MAX_CHARS);
  const evidence = boundedOneLine([
    `Agent role: ${agentName}`,
    agentID ? `Agent ID: ${agentID}` : "",
    `Evidence class: ${input.evidenceClass}`,
    input.terminalText,
  ].filter(Boolean).join(" — "), TERMINAL_EVIDENCE_MAX_CHARS);
  if (!claim || !evidence || containsLikelySecret(claim) || containsLikelySecret(evidence)) return undefined;
  try {
    return normalizeExperienceCandidate({
      kind: "experience",
      claimKind: "task",
      claim,
      scope: "session",
      provenance: "brief",
      outcome: input.outcome,
      evidence: [{ summary: evidence }],
      sourceRuns: [input.runID],
    });
  } catch {
    return undefined;
  }
}

const terminalExperienceFlights = new Map<string, Promise<void>>();

/**
 * Fail-soft, once-per-run terminal submission. The HTTP client carries the
 * bound actor/run identity, and the server still performs authoritative dedupe.
 */
export function submitTerminalExperienceCandidate(
  client: MemoryBrokerClient | undefined,
  input: TerminalExperienceCandidateInput,
): Promise<void> {
  if (!client || client.environment.runID !== input.runID) return Promise.resolve();
  const candidate = makeTerminalExperienceCandidate({ ...input, agentID: client.environment.agentID });
  if (!candidate) return Promise.resolve();
  const key = `${client.environment.agentID}\u0000${client.environment.runID}`;
  const existing = terminalExperienceFlights.get(key);
  if (existing) return existing;
  const flight = client.submitCandidate(candidate).then(() => {}).catch(() => {});
  terminalExperienceFlights.set(key, flight);
  return flight;
}

/** Operator-only helper. It returns a sanitized, quarantined metadata candidate. */
export function operatorComputerCandidate(
  environment: MemoryBrokerClientEnvironment | undefined,
  draft: ComputerMemoryDraft | Record<string, unknown>,
): MemoryExperienceCandidate | undefined {
  if (environment?.mode !== "operator") return undefined;
  return computerCandidateFromDraft(draft);
}

export function isWorkerOrOperatorMode(mode: MemoryBrokerMode): mode is "worker" | "operator" {
  return mode === "worker" || mode === "operator";
}
