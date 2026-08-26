import type {
  AgentDiscoveryResult,
  AgentOrigin,
  AgentScope,
  ExtensionAgentContributionSnapshot,
} from "./load-runtime-agents.js";

export function applyExtensionAgentContributions(
  base: AgentDiscoveryResult,
  snapshot: ExtensionAgentContributionSnapshot,
): AgentDiscoveryResult;

export function discoverAgentsFromRoots(
  roots: { userDir: string; projectAgentsDir: string | null; pipiuiAgentsDir?: string },
  scope: AgentScope,
): AgentDiscoveryResult;

export function discoverBundledAgentsFromDirectory(directory: string): AgentDiscoveryResult;

export function isCanonicalPrivilegedBundledRole(name: string, origin: AgentOrigin): boolean;
