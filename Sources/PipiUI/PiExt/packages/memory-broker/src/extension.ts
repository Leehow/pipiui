import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MEMORY_LIMITS, normalizeAppName, normalizeBundleID, normalizeQuery } from "#memory-broker-contract";
import {
  MemoryBrokerClient,
  createMemoryBrokerClient,
  memoryBrokerClientEnvironment,
} from "./client.ts";
import { UnavailableMemoryBackend, type MemoryBrokerBackend } from "./backend.ts";
import { operatorComputerObservationFromToolResult, type OperatorComputerApplicationScope } from "./operator-computer.ts";
import { importControlledMemoryIfRequested } from "./controlled-memory-migration.ts";
import { MEMORY_BROKER_HTTP_VERSION, type MemoryBrokerMode } from "./protocol.ts";
import { publishMemoryBrokerStatus } from "./status-file.ts";
import {
  currentMemoryBrokerPackageIdentity,
  issuedMemoryBrokerPackageIdentity,
  type MemoryBrokerPackageIdentity,
} from "./runtime-identity.ts";
import type {
  ChildCapabilityInput,
  MemoryBrokerServer,
  MemoryBrokerServerOptions,
  MemoryBrokerWireResponse,
} from "./server.ts";

const MAX_QUERY_TOOL_TEXT = 6_000;
const MAX_OPERATOR_QUERY_TOOL_TEXT = 1_800;

export type MemoryBrokerExtensionOptions = {
  /** Test/host override. Default main mode composes pi-hermes-memory@0.9.4. */
  backendFactory?: () => MemoryBrokerBackend | undefined | Promise<MemoryBrokerBackend | undefined>;
  /** Test seam for a start/bind failure without changing the real listener. */
  serverFactory?: (options: MemoryBrokerServerOptions) => MemoryBrokerServer;
  onStarted?: (server: MemoryBrokerServer) => void;
  onStopped?: () => void;
};

// One Pi main process owns one session-scoped broker. This is intentionally
// module-local: child modes never initialize a server and cannot mint grants.
let activeMainBroker: MemoryBrokerServer | undefined;
let activeMainPackageIdentity: MemoryBrokerPackageIdentity | undefined;
const MAIN_CHILD_ISSUER = Symbol.for("pipiui.memory-broker.issue-child-capability");
type MainChildIssuer = ((input: ChildCapabilityInput) => Record<string, string> | undefined) & {
  validateIssuedPackageIdentity: (
    environment: Record<string, string | undefined>,
  ) => MemoryBrokerPackageIdentity | undefined;
};
const globalIssuerHost = globalThis as typeof globalThis & { [key: symbol]: unknown };

function envText(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

/** Explicit mode wins; roles provide a compatibility fallback for bare Pi. */
export function memoryBrokerMode(env: Record<string, string | undefined> = process.env): MemoryBrokerMode {
  const explicit = envText(env, "PIPIUI_MEMORY_BROKER_MODE");
  if (explicit === "main" || explicit === "worker" || explicit === "operator") return explicit;
  return envText(env, "PIPIUI_AGENT_ROLE") === "operator"
    ? "operator"
    : envText(env, "PIPIUI_AGENT_ROLE") === "worker"
      ? "worker"
      : "main";
}

/**
 * Main-only dispatch seam used by the subagent launcher. It returns a complete
 * child environment from the live broker registry; no Swift/AppStore bridge
 * action participates in this capability issuance path.
 */
export function issueMainMemoryBrokerChildEnvironment(
  input: ChildCapabilityInput,
): Record<string, string> | undefined {
  const broker = activeMainBroker;
  const identity = activeMainPackageIdentity;
  if (!broker || !identity) return undefined;
  try {
    return {
      ...broker.issueChildCapability(input),
      PIPIUI_MEMORY_BROKER_PACKAGE_ROOT: identity.root,
      PIPIUI_MEMORY_BROKER_EXTENSION: identity.entrypoint,
      PIPIUI_MEMORY_BROKER_PACKAGE_VERSION: identity.version,
    };
  } catch {
    return undefined;
  }
}

const mainChildIssuer = issueMainMemoryBrokerChildEnvironment as MainChildIssuer;
mainChildIssuer.validateIssuedPackageIdentity = (environment) => {
  const identity = activeMainPackageIdentity;
  return identity ? issuedMemoryBrokerPackageIdentity(environment, identity) : undefined;
};

function installMainChildIssuer(): void {
  globalIssuerHost[MAIN_CHILD_ISSUER] = mainChildIssuer;
}

function clearMainChildIssuer(): void {
  if (globalIssuerHost[MAIN_CHILD_ISSUER] === mainChildIssuer) {
    delete globalIssuerHost[MAIN_CHILD_ISSUER];
  }
}

function textResult(text: string, details: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details,
    ...(isError ? { isError: true } : {}),
  };
}

function queryParameters(includeApplicationScope: boolean) {
  return Type.Object({
    query: Type.String({ minLength: 1, maxLength: MEMORY_LIMITS.maximumQueryTextUTF8Bytes }),
    scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("session")])),
    budget: Type.Optional(Type.Integer({ minimum: 1, maximum: MEMORY_LIMITS.maximumQueryBudget })),
    ...(includeApplicationScope ? {
      bundleID: Type.Optional(Type.String({ minLength: 1, maxLength: MEMORY_LIMITS.maximumApplicationBundleIDUTF8Bytes })),
      appName: Type.Optional(Type.String({ minLength: 1, maxLength: MEMORY_LIMITS.maximumApplicationNameUTF8Bytes })),
    } : {}),
  });
}

function renderQueryResult(
  query: { scope: string; budget: number; bundleID?: string; appName?: string },
  results: Array<{ claim: string; score: number }>,
  maximumText: number,
) {
  let text = `Memory query (${query.scope}; budget ${query.budget}${query.bundleID || query.appName ? "; app-scoped" : ""}):`;
  if (results.length === 0) return `${text} no matching scoped memory.`;
  for (const result of results) {
    const line = `\n- ${result.claim}${result.score ? ` (score ${result.score.toFixed(3)})` : ""}`;
    if (text.length + line.length > maximumText) break;
    text += line;
  }
  return text.slice(0, maximumText);
}

function unavailableToolResult(error: string | undefined) {
  return textResult(`Memory query unavailable: ${error || "broker unavailable"}.`, { ok: false }, true);
}

function operatorQueryScope(
  params: { query: string; budget?: number; scope?: "project" | "session"; bundleID?: string; appName?: string },
  observed: OperatorComputerApplicationScope | undefined,
): { params?: typeof params; error?: string } {
  const requestedAppScope = params.bundleID !== undefined || params.appName !== undefined;
  if (!requestedAppScope) return { params };
  if (!observed || params.bundleID === undefined) {
    return { error: "Application-scoped memory query requires the current observed computer application bundleID." };
  }
  try {
    const bundleID = normalizeBundleID(params.bundleID);
    const appName = params.appName === undefined ? undefined : normalizeAppName(params.appName);
    if (!bundleID || bundleID !== observed.bundleID) {
      return { error: "Application-scoped memory query is limited to the current observed computer application." };
    }
    if (appName !== undefined && appName.toLocaleLowerCase("en-US") !== observed.appName.toLocaleLowerCase("en-US")) {
      return { error: "Application-scoped memory query is limited to the current observed computer application." };
    }
    return { params: { ...params, bundleID: observed.bundleID, appName: observed.appName } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid application memory scope." };
  }
}

function mainEnvironment(
  connection: { url: string; token: string; projectRoot: string },
  identity: MemoryBrokerPackageIdentity,
): Record<string, string> {
  return {
    PIPIUI_MEMORY_BROKER_MODE: "main",
    PIPIUI_MEMORY_BROKER_URL: connection.url,
    PIPIUI_MEMORY_BROKER_TOKEN: connection.token,
    PIPIUI_MEMORY_PROJECT_ROOT: connection.projectRoot,
    PIPIUI_MEMORY_BROKER_PACKAGE_ROOT: identity.root,
    PIPIUI_MEMORY_BROKER_EXTENSION: identity.entrypoint,
    PIPIUI_MEMORY_BROKER_PACKAGE_VERSION: identity.version,
  };
}

function applyMainEnvironment(values: Record<string, string>): void {
  Object.assign(process.env, values);
}

function clearMainEnvironment(values: Record<string, string> | undefined): void {
  if (!values) return;
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === value) delete process.env[key];
  }
}

function queryFromMainResponse(response: MemoryBrokerWireResponse) {
  if (!response.ok || response.operation !== "memory.query") return undefined;
  return Array.isArray(response.results) ? response.results : [];
}

/**
 * Install a session-scoped main server or a zero-backend child client. The
 * extension factory itself opens no sockets, matching Pi's lifecycle guidance.
 */
export async function installMemoryBrokerExtension(
  pi: ExtensionAPI,
  options: MemoryBrokerExtensionOptions = {},
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const mode = memoryBrokerMode(env);
  let server: MemoryBrokerServer | undefined;
  let publishedEnvironment: Record<string, string> | undefined;
  let operatorApplicationScope: OperatorComputerApplicationScope | undefined;
  const childClient = mode === "main" ? undefined : createMemoryBrokerClient(env);
  const operatorComputerMemoryEnabled = mode === "operator"
    && childClient?.environment.mode === "operator"
    && envText(env, "PIPIUI_COMPUTER_MEMORY_ENABLED") === "1";
  // Keep Hermes behind a main-only dynamic boundary so children never load its
  // native dependency or review hooks merely by loading this package.
  const configuredBackendFactory = options.backendFactory;

  if (mode === "main") {
    pi.on("session_start", async (_event, ctx) => {
      if (server) return;
      let candidate: MemoryBrokerServer | undefined;
      try {
        let backend: MemoryBrokerBackend | undefined;
        try {
          const backendFactory = configuredBackendFactory ?? (
            await (async () => {
              const { installHermesMainIntegration } = await import("./hermes-adapter.ts");
              return (await installHermesMainIntegration(pi, env)).backendFactory;
            })()
          );
          backend = await backendFactory?.();
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Hermes backend initialization failed.";
          backend = new UnavailableMemoryBackend(`Hermes memory degraded: ${detail.slice(0, 240)}`);
        }

        const identity = currentMemoryBrokerPackageIdentity();
        if (!identity) throw new Error("Memory Broker package identity is invalid.");
        const serverOptions: MemoryBrokerServerOptions = {
          projectRoot: envText(env, "PIPIUI_MEMORY_PROJECT_ROOT") ?? envText(env, "PIPIUI_MAIN_CWD") ?? ctx.cwd,
          chatSessionID: envText(env, "PIPIUI_MEMORY_CHAT_SESSION_ID"),
          bridgeRoutingKey: envText(env, "PIPIUI_MEMORY_BRIDGE_ROUTING_KEY"),
          ...(backend ? { backend } : {}),
        };
        const { MemoryBrokerServer: MainMemoryBrokerServer } = await import("./server.ts");
        candidate = options.serverFactory?.(serverOptions) ?? new MainMemoryBrokerServer(serverOptions);
        const connection = await candidate.start();
        server = candidate;
        activeMainBroker = candidate;
        activeMainPackageIdentity = identity;
        installMainChildIssuer();
        publishedEnvironment = mainEnvironment(connection, identity);
        applyMainEnvironment(publishedEnvironment);
        options.onStarted?.(candidate);
        await importControlledMemoryIfRequested(candidate, env);
        const status = await candidate.handleMainRequest({
          version: MEMORY_BROKER_HTTP_VERSION,
          operation: "memory.status",
        });
        await publishMemoryBrokerStatus(env, status).catch(() => {});
      } catch (error) {
        const failed = candidate ?? server;
        server = undefined;
        if (activeMainBroker === failed) {
          activeMainBroker = undefined;
          activeMainPackageIdentity = undefined;
          clearMainChildIssuer();
        }
        clearMainEnvironment(publishedEnvironment);
        publishedEnvironment = undefined;
        await failed?.close().catch(() => {});
        // status-file uses write+fsync+rename, so this degraded publication is
        // atomic and session_start never lets a bind/start error escape to Pi.
        await publishMemoryBrokerStatus(env, undefined, error).catch(() => {});
      }
    });
    pi.on("session_shutdown", async () => {
      const current = server;
      server = undefined;
      if (activeMainBroker === current) {
        activeMainBroker = undefined;
        activeMainPackageIdentity = undefined;
        clearMainChildIssuer();
      }
      clearMainEnvironment(publishedEnvironment);
      publishedEnvironment = undefined;
      await current?.close().catch(() => {});
      try {
        options.onStopped?.();
      } catch {
        // Optional observer callbacks must not block Pi shutdown.
      }
    });
  }

  if (mode === "operator") {
    // Pi runs this after the real tool execution. Never return a patch: Computer
    // output remains exactly as produced, while this optional side path retains
    // only contract-sanitized metadata for the loopback broker.
    pi.on("tool_result", (event) => {
      if (!operatorComputerMemoryEnabled || event.toolName !== "computer") return;
      const observation = operatorComputerObservationFromToolResult(event);
      if (!observation) {
        operatorApplicationScope = undefined;
        return;
      }
      operatorApplicationScope = observation.application;
      void childClient!.submitCandidate(observation.candidate).catch(() => {});
    });
  }

  const includeApplicationScope = mode === "operator";
  const maximumText = mode === "operator" ? MAX_OPERATOR_QUERY_TOOL_TEXT : MAX_QUERY_TOOL_TEXT;
  if (mode === "main" || childClient) {
    pi.registerTool({
      name: "memory_query",
      label: "Memory Query",
      description: mode === "operator"
        ? "Read bounded memory through the loopback broker. Operator queries may narrow by application bundle/name; this tool never durably writes memory."
        : "Read bounded memory through the loopback broker. This tool never durably writes memory.",
      parameters: queryParameters(includeApplicationScope),
      async execute(_toolCallId, params) {
        if (mode === "main") {
          if (!server) return unavailableToolResult("main broker has not started");
          let query;
          try {
            query = normalizeQuery({
              text: params.query,
              budget: params.budget ?? MEMORY_LIMITS.defaultQueryBudget,
              scope: params.scope ?? "project",
            });
          } catch (error) {
            return unavailableToolResult(error instanceof Error ? error.message : undefined);
          }
          const response = await server.handleMainRequest({
            version: MEMORY_BROKER_HTTP_VERSION,
            operation: "memory.query",
            query,
          });
          const results = queryFromMainResponse(response);
          if (!results) return unavailableToolResult(response.error);
          return textResult(renderQueryResult(query, results, maximumText), {
            ok: true,
            scope: query.scope,
            budget: query.budget,
            returned: results.length,
          });
        }
        return executeChildQuery(childClient!, params, maximumText, operatorApplicationScope);
      },
    });
  }

  if (mode === "main") {
    pi.registerTool({
      name: "memory_status",
      label: "Memory Status",
      description: "Report whether the optional memory backend is ready. This tool does not initialize or modify a backend.",
      parameters: Type.Object({}),
      async execute() {
        if (!server) return textResult("Memory broker is not started.", { ok: false }, true);
        const response = await server.handleMainRequest({
          version: MEMORY_BROKER_HTTP_VERSION,
          operation: "memory.status",
        });
        await publishMemoryBrokerStatus(env, response).catch(() => {});
        if (!response.ok || !response.status) return textResult(`Memory status unavailable: ${response.error || "broker unavailable"}.`, { ok: false }, true);
        return textResult(
          response.status.ready ? "Memory backend is ready." : `Memory backend unavailable${response.status.detail ? `: ${response.status.detail}` : "."}`, 
          { ok: true, ...response.status },
        );
      },
    });
  }
}

async function executeChildQuery(
  client: MemoryBrokerClient,
  params: { query: string; budget?: number; scope?: "project" | "session"; bundleID?: string; appName?: string },
  maximumText: number,
  observedOperatorApplication?: OperatorComputerApplicationScope,
) {
  const scoped = client.environment.mode === "operator"
    ? operatorQueryScope(params, observedOperatorApplication)
    : { params };
  if (!scoped.params) return unavailableToolResult(scoped.error);
  const response = await client.query({
    text: scoped.params.query,
    ...(scoped.params.budget !== undefined ? { budget: scoped.params.budget } : {}),
    ...(scoped.params.scope !== undefined ? { scope: scoped.params.scope } : {}),
    ...(scoped.params.bundleID !== undefined ? { bundleID: scoped.params.bundleID } : {}),
    ...(scoped.params.appName !== undefined ? { appName: scoped.params.appName } : {}),
  });
  if (!response.available || !response.value) return unavailableToolResult(response.error);
  return textResult(renderQueryResult(response.value.query, response.value.results, maximumText), {
    ok: true,
    scope: response.value.query.scope,
    budget: response.value.query.budget,
    returned: response.value.results.length,
    appScoped: !!response.value.query.bundleID || !!response.value.query.appName,
  });
}

/** Useful to fixtures without exposing a server from worker/operator mode. */
export function extensionClientFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): MemoryBrokerClient | undefined {
  return memoryBrokerClientEnvironment(env) ? createMemoryBrokerClient(env) : undefined;
}
