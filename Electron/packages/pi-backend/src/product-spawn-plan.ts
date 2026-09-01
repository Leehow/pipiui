import { createHash } from "node:crypto";

import type { SpawnFeatures, SpawnPaths, SpawnRegisteredExtension } from "./spawn-assembly.js";

export type ProductSpawnPlanInput = {
  profileId: string;
  features: SpawnFeatures;
  paths: SpawnPaths;
  registeredExtensions: readonly SpawnRegisteredExtension[];
  activeExtensionIds?: readonly string[];
};

export type ProductSpawnPlan = {
  features: SpawnFeatures;
  paths: SpawnPaths;
  registeredExtensions: SpawnRegisteredExtension[];
};

const KERNEL_PATHS: ReadonlyArray<keyof SpawnPaths> = ["secretVault", "updateCenter", "runtimeInfo"];
const FEATURE_OWNERS: Partial<Record<keyof SpawnFeatures, readonly string[]>> = {
  plan: ["plan-extension"],
  goal: ["goal-extension"],
  subagent: ["agent-orchestration", "coding-orchestration"],
  memoryBroker: ["memory-extension"],
  contextFold: ["pipiui-headroom"],
  git: ["git-capability"],
  reload: ["coding-runtime"],
  webSearch: ["web-access-extension"],
  browserSearch: ["webview-browser-extension"],
  browserMemory: ["webview-browser-extension"],
  browser: ["webview-browser-extension"],
  terminal: ["terminal-extension"],
  computerUse: ["cua-extension"],
  skillLoader: ["skill-loader-extension"],
  philosophy: ["pi-foundation"],
  arxivFetch: ["web-access-extension"],
  mcp: ["mcp-extension"],
  generateImage: ["grok-build-oauth", "image-generation-extension"],
  codexServerTools: ["openai-codex-provider"],
  claudeServerTools: ["anthropic-provider"],
  openaiServerTools: ["openai-provider"],
  geminiServerTools: ["gemini-provider"],
  xaiServerTools: ["grok-build-oauth"],
  deepseekServerTools: ["deepseek"],
  glmSearchMcp: ["glm-provider"],
  glmVisionMcp: ["glm-provider"],
};

const PATH_OWNERS: Partial<Record<keyof SpawnPaths, readonly string[]>> = {
  codingTools: ["coding-runtime"],
  reload: ["coding-runtime"],
  philosophy: ["pi-foundation"],
  skillLoader: ["skill-loader-extension"],
  builtInSkills: ["skill-loader-extension"],
  planRuntime: ["plan-extension"],
  goalRuntime: ["goal-extension"],
  subagentDir: ["agent-orchestration", "coding-orchestration"],
  agentsDir: ["agent-orchestration", "coding-orchestration"],
  memoryBroker: ["memory-extension"],
  contextFold: ["pipiui-headroom"],
  hermesMemory: ["memory-extension"],
  webSearch: ["web-access-extension"],
  webview: ["webview-browser-extension"],
  browserSearch: ["webview-browser-extension"],
  browserMemory: ["webview-browser-extension"],
  terminal: ["terminal-extension"],
  officeDocShotGate: ["document-workbench", "office-extension"],
  firecrawlAnydoc: ["document-workbench"],
  openDocuments: ["document-workbench"],
  anydoc: ["document-workbench"],
  media: ["grok-build-oauth", "image-generation-extension"],
  arxivFetchPackage: ["web-access-extension"],
  mcp: ["mcp-extension"],
  codexServerTools: ["openai-codex-provider"],
  claudeServerTools: ["anthropic-provider"],
  openaiServerTools: ["openai-provider"],
  geminiServerTools: ["gemini-provider"],
  xaiServerTools: ["grok-build-oauth"],
  deepseekServerTools: ["deepseek"],
  glmSearchMcp: ["glm-provider"],
};

/**
 * Transitional adapter from a resolved Product Profile to the existing Pi
 * assembler. `base` is strict but keeps the generic Skill Loader; non-Coding profiles retain
 * feature set until their manifest-owned mounts replace each legacy flag.
 */
export function resolveProductSpawnPlan(input: ProductSpawnPlanInput): ProductSpawnPlan {
  if (input.profileId === "coding") {
    return {
      features: { ...input.features },
      paths: { ...input.paths },
      registeredExtensions: input.registeredExtensions.map(item => ({ ...item })),
    };
  }
  const active = new Set(input.activeExtensionIds ?? []);
  const paths: SpawnPaths = {};
  for (const key of KERNEL_PATHS) {
    const value = input.paths[key];
    if (value) paths[key] = value;
  }
  for (const [key, owners] of Object.entries(PATH_OWNERS) as Array<[keyof SpawnPaths, readonly string[]]>) {
    if (!owners.some(id => active.has(id))) continue;
    const value = input.paths[key];
    if (value) paths[key] = value;
  }
  const features: SpawnFeatures = {};
  for (const [key, owners] of Object.entries(FEATURE_OWNERS) as Array<[keyof SpawnFeatures, readonly string[]]>) {
    if (owners.some(id => active.has(id)) && input.features[key]) features[key] = true;
  }
  return {
    features,
    paths,
    registeredExtensions: input.registeredExtensions.map(item => ({ ...item, enabled: item.enabled && active.has(item.id) })),
  };
}

export function productSpawnFingerprint(profileId: string, plan: ProductSpawnPlan): string {
  const snapshot = {
    profileId,
    features: Object.keys(plan.features).filter(key => plan.features[key as keyof SpawnFeatures]).sort(),
    extensions: plan.registeredExtensions
      .filter(item => item.enabled)
      .map(item => ({ id: item.id, version: item.version ?? "unknown" }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}
