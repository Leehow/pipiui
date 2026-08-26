import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyExtensionAgentContributions,
  discoverAgentsFromRoots,
  discoverBundledAgentsFromDirectory,
  isCanonicalPrivilegedBundledRole,
} from "./runtime-agents.bundle.mjs";

export type AgentScope = "user" | "project" | "both";
export type AgentOrigin = "user" | "project" | "bundled";
export type AgentMode = "read-only" | "worker";
export type AgentWorktree = "none" | "isolated";
export type AgentFilesystemCapability = "none" | "read-only" | "workspace-write";
export type AgentDesktopCapability = "none" | "requestable";

export type AgentDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  filePath?: string;
  agentName?: string;
};

export type AgentConfig = {
  name: string;
  description: string;
  origin: AgentOrigin;
  source: "user" | "project";
  mode: AgentMode;
  worktree: AgentWorktree;
  filePath: string;
  capabilities: {
    filesystem: AgentFilesystemCapability;
    shell: boolean;
    web: boolean;
    desktop: AgentDesktopCapability;
    delegation: boolean;
    mcpTools: string[];
  };
  /** Provisional custom addTools waiting on Pi's unique winner. Never prompt text. */
  extensionToolRequests?: Array<{ name: string; extensionId: string }>;
};

export type AgentPatchOperationKind = "appendPrompt" | "replacePrompt" | "addTools" | "removeTools";

export type AppliedExtensionPatch = {
  extensionId: string;
  origin: "builtin" | "app" | "project";
  target: string;
  operations: AgentPatchOperationKind[];
  addTools?: string[];
  removeTools?: string[];
};

export type AgentDiscoveryResult = {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
  diagnostics: AgentDiagnostic[];
  appliedPatches?: AppliedExtensionPatch[];
};

export type ExtensionAgentContribution = {
  id: string;
  origin: "builtin" | "app" | "project";
  root: string;
  agents: string[];
  patches: Array<{
    target: string;
    appendPrompt?: string;
    replacePrompt?: string;
    addTools?: string[];
    removeTools?: string[];
  }>;
  providedTools: string[];
};

export type ExtensionAgentContributionSnapshot = {
  extensions: ExtensionAgentContribution[];
  diagnostics: AgentDiagnostic[];
};

export type RuntimeAgents = {
  applyExtensionAgentContributions: (
    base: AgentDiscoveryResult,
    snapshot: ExtensionAgentContributionSnapshot,
  ) => AgentDiscoveryResult;
  discoverAgentsFromRoots: (
    roots: { userDir: string; projectAgentsDir: string | null; pipiuiAgentsDir?: string },
    scope: AgentScope,
  ) => AgentDiscoveryResult;
  discoverBundledAgentsFromDirectory: (directory: string) => AgentDiscoveryResult;
  isCanonicalPrivilegedBundledRole: (name: string, origin: AgentOrigin) => boolean;
};

/**
 * Source of truth for the host catalog core. The publishable loader never
 * imports this path at runtime — `scripts/bundle-runtime-agents.mjs` compiles
 * it plus the parseFrontmatter/yaml closure into `runtime-agents.bundle.mjs`.
 */
export const RUNTIME_AGENTS_SPECIFIER = "../../../resources/runtime/pi-ext/subagent/agents.ts";

const bundledRuntimeAgents: RuntimeAgents = {
  applyExtensionAgentContributions,
  discoverAgentsFromRoots,
  discoverBundledAgentsFromDirectory,
  isCanonicalPrivilegedBundledRole,
};

/** Resolve the workspace `agents.ts` source of truth. Never extraResources, never `.js`. */
export function resolveRuntimeAgentsSource(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, RUNTIME_AGENTS_SPECIFIER),
    join(here, "..", RUNTIME_AGENTS_SPECIFIER),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && candidate.endsWith("agents.ts")) return candidate;
  }
  return undefined;
}

/**
 * Load parser/discovery/apply from the bundled dependency closure.
 * `runtimeRoot` selects AGENT.md files elsewhere; it is not a loader target.
 */
export function loadRuntimeAgents(_runtimeRoot?: string): Promise<RuntimeAgents> {
  return Promise.resolve(bundledRuntimeAgents);
}
