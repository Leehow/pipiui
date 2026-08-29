/**
 * Effective agent catalog for the host settings surface.
 *
 * Reuses the runtime parser/discovery seam; never copies a builtin registry or
 * a second AGENT.md schema parser, and never returns prompt bodies.
 */
import { statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentCanonicalRole,
  AgentCatalogDiagnostic,
  AgentDefinition,
  AgentPatchOperation,
  AgentPatchProvenance,
  AgentPermissionSummary,
} from "@pipi/host-api";

import { loadRuntimeAgents } from "./load-runtime-agents.js";
import type {
  AgentConfig,
  AgentDiagnostic,
  AgentDiscoveryResult,
  AgentOrigin,
  AgentScope,
  AppliedExtensionPatch,
  ExtensionAgentContribution,
  ExtensionAgentContributionSnapshot,
  RuntimeAgents,
} from "./load-runtime-agents.js";
import { buildVersionedAgentContributionSnapshot, resolveSpawnPaths } from "./spawn-assembly.js";
import type { SpawnRegisteredExtension } from "./spawn-assembly.js";

export const DEFAULT_CATALOG_SCOPE: AgentScope = "both";

function runtimeAgents(runtimeRoot?: string): Promise<RuntimeAgents> {
  // runtimeRoot selects bundled AGENT.md files, not the parser module.
  return loadRuntimeAgents(runtimeRoot);
}

const ABSOLUTE_PATH_PLACEHOLDER = "<path>";

/** Host-side safety net: strip absolute filesystem paths from visible diagnostic text. */
export function redactAbsolutePaths(message: string): string {
  let text = message;
  text = text.replace(/'((?:\/|\\)[^']+)'/g, `'${ABSOLUTE_PATH_PLACEHOLDER}'`);
  text = text.replace(/"((?:\/|\\)[^"]+)"/g, `"${ABSOLUTE_PATH_PLACEHOLDER}"`);
  text = text.replace(/`((?:\/|\\)[^`]+)`/g, "`" + ABSOLUTE_PATH_PLACEHOLDER + "`");
  text = text.replace(/(^|[\s:[=(,;])(\/(?:[^/`'"<>\]]+\/)+[^/`'"<>\]\s,;]+)/g, `$1${ABSOLUTE_PATH_PLACEHOLDER}`);
  text = text.replace(/(^|[\s:[=(,;`'])([A-Za-z]:\\(?:[^\\`'\"<>\]]+\\)+[^\\`'\"<>\]\s,;]+)/g, `$1${ABSOLUTE_PATH_PLACEHOLDER}`);
  text = text.replace(/(^|[\s:[=(,;`'])(\\\\[^\\`'\"<>\]]+(?:\\[^\\`'\"<>\]]+)+)/g, `$1${ABSOLUTE_PATH_PLACEHOLDER}`);
  return text;
}

export type AgentCatalogInput = {
  runtimeRoot?: string;
  /** Isolated or app Pi home `agents/` directory (user scope). */
  userDir: string;
  projectRoot?: string;
  scope?: AgentScope;
  packages?: readonly SpawnRegisteredExtension[];
};

export type AgentCatalogResult = {
  agents: AgentDefinition[];
  diagnostics: AgentCatalogDiagnostic[];
};

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Same walk dispatch uses, scoped to one opened project tree. */
export function nearestProjectAgentsDir(cwd: string | undefined): string | null {
  if (!cwd) return null;
  let currentDir = resolve(cwd);
  while (true) {
    const candidate = join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function sourceAgentsDir(): string | undefined {
  const here = fileURLToPath(new URL(".", import.meta.url));
  for (const candidate of [
    resolve(here, "../../../resources/runtime/pi-ext/agents"),
    resolve(here, "../../../../resources/runtime/pi-ext/agents"),
  ]) {
    if (isDirectory(candidate)) return candidate;
  }
  return undefined;
}

export function resolveBundledAgentsDir(runtimeRoot?: string): string | undefined {
  if (runtimeRoot) {
    const fromRuntime = resolveSpawnPaths(runtimeRoot).agentsDir;
    if (fromRuntime && isDirectory(fromRuntime)) return fromRuntime;
  }
  const fallback = sourceAgentsDir();
  return fallback && isDirectory(fallback) ? fallback : undefined;
}

function pathInside(root: string, filePath: string): boolean {
  const rel = relative(resolve(root), resolve(filePath));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

export function contributionSnapshotFromPackages(
  packages: readonly SpawnRegisteredExtension[] | undefined,
): ExtensionAgentContributionSnapshot {
  const built = buildVersionedAgentContributionSnapshot(packages);
  const extensions: ExtensionAgentContribution[] = built.extensions.flatMap((item) => {
    if (typeof item.id !== "string" || typeof item.origin !== "string" || typeof item.root !== "string") return [];
    if (item.origin !== "builtin" && item.origin !== "app" && item.origin !== "project") return [];
    return [{
      id: item.id,
      origin: item.origin,
      root: item.root,
      agents: Array.isArray(item.agents) ? item.agents.filter((path): path is string => typeof path === "string") : [],
      patches: Array.isArray(item.patches)
        ? item.patches.flatMap((patch) => {
          if (!patch || typeof patch !== "object" || typeof (patch as { target?: unknown }).target !== "string") return [];
          const next = patch as {
            target: string;
            appendPrompt?: string;
            replacePrompt?: string;
            addTools?: string[];
            removeTools?: string[];
          };
          return [{
            target: next.target,
            ...(next.appendPrompt ? { appendPrompt: next.appendPrompt } : {}),
            ...(next.replacePrompt ? { replacePrompt: next.replacePrompt } : {}),
            ...(next.addTools?.length ? { addTools: [...next.addTools] } : {}),
            ...(next.removeTools?.length ? { removeTools: [...next.removeTools] } : {}),
          }];
        })
        : [],
      providedTools: [],
    }];
  });
  return {
    extensions,
    diagnostics: built.diagnostics.map((entry) => ({
      severity: entry.severity,
      code: entry.code,
      message: entry.message,
    })),
  };
}

function knownExtensionIds(packages: readonly SpawnRegisteredExtension[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const pkg of packages ?? []) {
    ids.add(pkg.id);
    if (pkg.agentContribution?.id) ids.add(pkg.agentContribution.id);
  }
  return ids;
}

function looksLikeFilesystemPath(value: string): boolean {
  return isAbsolute(value) || value.includes("/") || value.includes("\\");
}

function inferExtensionId(
  entry: AgentDiagnostic,
  packages: readonly SpawnRegisteredExtension[] | undefined,
): string | undefined {
  const ids = knownExtensionIds(packages);
  if (entry.filePath && ids.has(entry.filePath)) return entry.filePath;
  const match = /(?:Extension|from) `([^`]+)`/.exec(entry.message);
  if (match?.[1] && (!ids.size || ids.has(match[1]))) return match[1];
  return undefined;
}

function redactCatalogDiagnostic(entry: AgentCatalogDiagnostic): AgentCatalogDiagnostic {
  const mapped: AgentCatalogDiagnostic = {
    severity: entry.severity,
    code: entry.code,
    message: redactAbsolutePaths(entry.message),
  };
  if (entry.agentName && !looksLikeFilesystemPath(entry.agentName)) mapped.agentName = entry.agentName;
  if (entry.extensionId && !looksLikeFilesystemPath(entry.extensionId)) mapped.extensionId = entry.extensionId;
  if (entry.filePath && !looksLikeFilesystemPath(entry.filePath)) mapped.filePath = entry.filePath;
  return mapped;
}

function catalogDiagnostic(
  entry: AgentDiagnostic,
  packages?: readonly SpawnRegisteredExtension[],
): AgentCatalogDiagnostic {
  const mapped: AgentCatalogDiagnostic = {
    severity: entry.severity,
    code: entry.code,
    message: entry.message,
  };
  if (entry.agentName && !looksLikeFilesystemPath(entry.agentName)) mapped.agentName = entry.agentName;
  const extensionId = inferExtensionId(entry, packages);
  if (extensionId) mapped.extensionId = extensionId;
  if (entry.filePath && !looksLikeFilesystemPath(entry.filePath)) mapped.filePath = entry.filePath;
  return redactCatalogDiagnostic(mapped);
}

function collectLoaderDiagnostics(
  packages: readonly SpawnRegisteredExtension[] | undefined,
): AgentCatalogDiagnostic[] {
  const out: AgentCatalogDiagnostic[] = [];
  for (const pkg of packages ?? []) {
    if (!pkg.enabled) continue;
    for (const entry of pkg.contributionDiagnostics ?? []) {
      const mapped: AgentCatalogDiagnostic = {
        severity: entry.severity,
        code: entry.code,
        message: entry.message,
        extensionId: entry.extensionId ?? pkg.id,
      };
      if (entry.agentName && !looksLikeFilesystemPath(entry.agentName)) mapped.agentName = entry.agentName;
      out.push(redactCatalogDiagnostic(mapped));
    }
  }
  return out;
}

function contributionOriginFor(
  extensionId: string,
  packages: readonly SpawnRegisteredExtension[] | undefined,
): AgentPatchProvenance["origin"] | undefined {
  for (const pkg of packages ?? []) {
    const id = pkg.agentContribution?.id || pkg.id;
    if (id !== extensionId) continue;
    const origin = pkg.agentContribution?.origin;
    if (origin === "builtin" || origin === "app" || origin === "project") return origin;
  }
  return undefined;
}

function patchProvenanceFor(
  agentName: string,
  applied: readonly AppliedExtensionPatch[],
): AgentPatchProvenance[] {
  const out: AgentPatchProvenance[] = [];
  for (const patch of applied) {
    if (patch.target !== agentName || !patch.operations.length) continue;
    const operations = patch.operations.filter((operation): operation is AgentPatchOperation => (
      operation === "appendPrompt"
      || operation === "replacePrompt"
      || operation === "addTools"
      || operation === "removeTools"
    ));
    if (!operations.length) continue;
    const item: AgentPatchProvenance = {
      extensionId: patch.extensionId,
      origin: patch.origin,
      operations,
    };
    if (patch.addTools?.length) item.addTools = [...patch.addTools];
    if (patch.removeTools?.length) item.removeTools = [...patch.removeTools];
    out.push(item);
  }
  return out;
}

function requestedToolProvenance(
  agent: AgentConfig,
  packages: readonly SpawnRegisteredExtension[] | undefined,
  applied: readonly AppliedExtensionPatch[],
): AgentPatchProvenance[] {
  const requests = agent.extensionToolRequests ?? [];
  if (!requests.length) return [];
  const accepted = new Set<string>();
  for (const patch of applied) {
    if (patch.target !== agent.name) continue;
    for (const name of patch.addTools ?? []) accepted.add(name);
  }
  const grouped = new Map<string, string[]>();
  for (const request of requests) {
    if (!request?.name || !request.extensionId || accepted.has(request.name)) continue;
    const list = grouped.get(request.extensionId) ?? [];
    list.push(request.name);
    grouped.set(request.extensionId, list);
  }
  const out: AgentPatchProvenance[] = [];
  for (const [extensionId, addTools] of grouped) {
    if (!addTools.length) continue;
    const item: AgentPatchProvenance = {
      extensionId,
      operations: ["addTools"],
      addTools,
      status: "requested",
    };
    const origin = contributionOriginFor(extensionId, packages);
    if (origin) item.origin = origin;
    out.push(item);
  }
  return out;
}

function permissionSummary(agent: AgentConfig): AgentPermissionSummary {
  return {
    filesystem: agent.capabilities.filesystem,
    shell: agent.capabilities.shell,
    web: agent.capabilities.web,
    desktop: agent.capabilities.desktop,
    delegation: agent.capabilities.delegation,
    mcpTools: [...agent.capabilities.mcpTools],
  };
}

function permissionSummaryText(agent: AgentConfig): string {
  const caps = agent.capabilities;
  const parts = [
    `mode:${agent.mode}`,
    `filesystem:${caps.filesystem}`,
    caps.shell ? "shell" : undefined,
    caps.web ? "web" : undefined,
    caps.desktop !== "none" ? `desktop:${caps.desktop}` : undefined,
    caps.delegation ? "delegation" : undefined,
    agent.worktree !== "none" ? `worktree:${agent.worktree}` : undefined,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(", ");
}

function canonicalRoleFor(
  name: string,
  origin: AgentOrigin,
  isCanonical: RuntimeAgents["isCanonicalPrivilegedBundledRole"],
): AgentCanonicalRole | undefined {
  if (!isCanonical(name, origin)) return undefined;
  if (name === "secretary") return "secretary";
  if (name === "operator") return "operator";
  return undefined;
}

function extensionIdFor(
  agent: AgentConfig,
  packages: readonly SpawnRegisteredExtension[] | undefined,
): string | undefined {
  for (const pkg of packages ?? []) {
    const root = pkg.agentContribution?.root;
    if (!root || !pkg.enabled) continue;
    if (pathInside(root, agent.filePath)) return pkg.agentContribution?.id || pkg.id;
  }
  return undefined;
}

function toCatalogEntry(
  agent: AgentConfig,
  diagnostics: AgentCatalogDiagnostic[],
  packages: readonly SpawnRegisteredExtension[] | undefined,
  catalogDiagnostics: AgentCatalogDiagnostic[],
  isCanonical: RuntimeAgents["isCanonicalPrivilegedBundledRole"],
  appliedPatches: readonly AppliedExtensionPatch[] = [],
): AgentDefinition {
  const own = diagnostics.filter((entry) => entry.agentName === agent.name);
  const errors = own.filter((entry) => entry.severity === "error");
  const canonicalRole = canonicalRoleFor(agent.name, agent.origin, isCanonical);
  const extensionId = extensionIdFor(agent, packages);
  const source: AgentDefinition["source"] = agent.origin === "bundled" ? "bundled" : agent.source;
  const availability = errors.length ? "degraded" : "available";
  const patches = [
    ...patchProvenanceFor(agent.name, appliedPatches),
    ...requestedToolProvenance(agent, packages, appliedPatches),
  ];
  const entry: AgentDefinition = {
    name: agent.name,
    description: agent.description,
    origin: agent.origin,
    source,
    mode: agent.mode,
    worktree: agent.worktree,
    capabilities: permissionSummary(agent),
    permissionSummary: permissionSummaryText(agent),
    available: true,
    availability,
    diagnostics: own,
    catalogDiagnostics,
    canonical: Boolean(canonicalRole),
  };
  if (canonicalRole) entry.canonicalRole = canonicalRole;
  if (extensionId) entry.extensionId = extensionId;
  if (patches.length) entry.patches = patches;
  return entry;
}

function discoverBase(
  runtime: RuntimeAgents,
  input: AgentCatalogInput,
  bundledDir: string | undefined,
): AgentDiscoveryResult {
  return runtime.discoverAgentsFromRoots(
    {
      userDir: input.userDir,
      projectAgentsDir: nearestProjectAgentsDir(input.projectRoot),
      pipiuiAgentsDir: bundledDir,
    },
    input.scope ?? DEFAULT_CATALOG_SCOPE,
  );
}

function fallbackBundled(
  runtime: RuntimeAgents | undefined,
  bundledDir: string | undefined,
  error: unknown,
): AgentDiscoveryResult {
  const message = error instanceof Error ? error.message : String(error);
  const failed: AgentDiagnostic = {
    severity: "error",
    code: "catalog-discovery-failed",
    message: `Agent catalog discovery failed: ${message}.`,
  };
  if (bundledDir && runtime) {
    try {
      const bundled = runtime.discoverBundledAgentsFromDirectory(bundledDir);
      return { ...bundled, diagnostics: [failed, ...bundled.diagnostics] };
    } catch (bundledError) {
      return {
        agents: [],
        projectAgentsDir: null,
        diagnostics: [
          failed,
          {
            severity: "error",
            code: "catalog-bundled-unavailable",
            message: `Bundled agent catalog is unavailable: ${bundledError instanceof Error ? bundledError.message : String(bundledError)}.`,
          },
        ],
      };
    }
  }
  return {
    agents: [],
    projectAgentsDir: null,
    diagnostics: [
      failed,
      {
        severity: "error",
        code: "catalog-bundled-unavailable",
        message: "Bundled agent catalog directory is missing.",
      },
    ],
  };
}

export function attachCatalogDiagnostics(
  agents: AgentDefinition[],
  diagnostics: AgentCatalogDiagnostic[],
): AgentDefinition[] {
  const redacted = diagnostics.map(redactCatalogDiagnostic);
  const names = new Set(agents.map((agent) => agent.name));
  const catalogWide = redacted.filter((entry) => !entry.agentName || !names.has(entry.agentName));
  return agents.map((agent) => ({
    ...agent,
    diagnostics: (agent.diagnostics ?? []).map(redactCatalogDiagnostic),
    catalogDiagnostics: catalogWide,
  }));
}

/**
 * Build the effective catalog for one project/scope/enablement snapshot.
 * Prompt bodies never appear on the returned objects.
 */
export async function buildAgentCatalog(input: AgentCatalogInput): Promise<AgentCatalogResult> {
  const bundledDir = resolveBundledAgentsDir(input.runtimeRoot);
  let runtime: RuntimeAgents | undefined;
  let discovered: AgentDiscoveryResult;
  const snapshot = contributionSnapshotFromPackages(input.packages);
  let appliedPatches: readonly AppliedExtensionPatch[] = [];
  try {
    runtime = await runtimeAgents(input.runtimeRoot);
    const base = discoverBase(runtime, input, bundledDir);
    discovered = runtime.applyExtensionAgentContributions(base, snapshot);
    appliedPatches = discovered.appliedPatches ?? [];
    if (discovered.agents.length === 0 && bundledDir) {
      appliedPatches = [];
      const bundled = runtime.discoverBundledAgentsFromDirectory(bundledDir);
      discovered = {
        agents: bundled.agents,
        projectAgentsDir: discovered.projectAgentsDir,
        diagnostics: [
          ...discovered.diagnostics,
          ...bundled.diagnostics,
        ],
      };
    }
  } catch (error) {
    appliedPatches = [];
    discovered = fallbackBundled(runtime, bundledDir, error);
  }

  const diagnostics = [
    ...discovered.diagnostics.map((entry) => catalogDiagnostic(entry, input.packages)),
    ...collectLoaderDiagnostics(input.packages),
  ];
  const isCanonical = runtime?.isCanonicalPrivilegedBundledRole ?? ((_name, origin) => origin === "bundled");
  const agents = attachCatalogDiagnostics(
    discovered.agents.map((agent) => toCatalogEntry(agent, diagnostics, input.packages, [], isCanonical, appliedPatches)),
    diagnostics,
  );
  return { agents, diagnostics };
}
