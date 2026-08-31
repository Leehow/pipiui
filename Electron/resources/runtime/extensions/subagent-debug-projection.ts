import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverAgents,
  dispatchToolPatch,
  extensionToolOwnership,
  mountedExtensionIdsFromEnv,
} from "../pi-ext/subagent/agents.ts";
import {
  childReceivesDelegationTools,
  resolveSubagentMaxDepth,
  runtimeRolePolicyForAgent,
} from "../pi-ext/subagent/runtime-policy.ts";
import {
  isDelegationTool,
  resolvePipiUIExtensionRouting,
  resolveSubagentToolSelection,
  resolveWorkerSkillLoaderPath,
  sanitizeDisabledToolNames,
} from "../pi-ext/subagent/desktop-tool-policy.mjs";

export interface SubagentToolProjection {
  name: string;
  toolPolicy: "allowlist" | "unrestricted";
  tools: string[];
  excludedTools?: string[];
}

type ToolMetadata = {
  name: string;
  sourceInfo?: {
    source?: string;
    path?: string;
    resolvedPath?: string;
  };
};

const MEMORY_EXTENSION_ID = "memory-extension";
const MEMORY_BROKER_TOOLS = new Set(["memory_query", "memory_status"]);
const BROWSER_TOOL_NAMES = ["browser"];

function loadDisabledTools(): string[] {
  const file = process.env.PIPIUI_TOOL_SKILL_SETTINGS_FILE
    || path.join(os.homedir(), "Library/Application Support/PipiUI/tool-skill-settings.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { disabledTools?: unknown };
    const raw = Array.isArray(parsed.disabledTools)
      ? parsed.disabledTools.filter((value): value is string => typeof value === "string")
      : [];
    const expanded = raw.flatMap(name => name === "browser_*" ? BROWSER_TOOL_NAMES : [name]);
    return sanitizeDisabledToolNames(expanded);
  } catch {
    return [];
  }
}

function pathAliases(value: string): string[] {
  const aliases = new Set<string>([path.resolve(value)]);
  try { aliases.add(fs.realpathSync(value)); } catch { /* unresolved paths keep the lexical alias */ }
  return [...aliases];
}

function pathInside(root: string, candidate: string): boolean {
  const roots = pathAliases(root);
  const candidates = pathAliases(candidate);
  for (const rootAlias of roots) {
    let isFile = false;
    try { isFile = fs.statSync(rootAlias).isFile(); } catch { /* lexical equality still works */ }
    for (const candidateAlias of candidates) {
      if (isFile && candidateAlias === rootAlias) return true;
      if (isFile) continue;
      const rel = path.relative(rootAlias, candidateAlias);
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return true;
    }
  }
  return false;
}

function workerMountRoots(): string[] {
  const single = [
    process.env.PIPIUI_SUBAGENT_EXT,
    process.env.PIPIUI_CODING_TOOLS_EXT,
    process.env.PIPIUI_SKILLLOADER_EXT,
    process.env.PIPIUI_PHILOSOPHY_EXT,
    process.env.PIPIUI_OFFICE_DOC_SHOT_GATE_EXT,
    process.env.PIPIUI_SEARCH_SCOPE_EXT,
    process.env.PIPIUI_WEB_ACCESS_EXT,
    process.env.PIPIUI_ARXIV_EXT,
  ];
  const registered = (process.env.PIPIUI_EXT_REGISTERED_PATHS ?? "").split(path.delimiter);
  return [...new Set([...single, ...registered].filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()))];
}

function workerRegistryToolNames(pi: ExtensionAPI, memoryBrokerAvailable: boolean): string[] {
  const roots = workerMountRoots();
  const mountedIds = new Set(mountedExtensionIdsFromEnv());
  const names: string[] = [];
  for (const tool of (pi.getAllTools?.() ?? []) as ToolMetadata[]) {
    if (!tool?.name) continue;
    if (tool.sourceInfo?.source === "builtin") {
      names.push(tool.name);
      continue;
    }
    if (MEMORY_BROKER_TOOLS.has(tool.name)) {
      if (memoryBrokerAvailable) names.push(tool.name);
      continue;
    }
    if (tool.sourceInfo?.source === MEMORY_EXTENSION_ID) continue;
    if (tool.sourceInfo?.source && mountedIds.has(tool.sourceInfo.source)) {
      names.push(tool.name);
      continue;
    }
    const sourcePath = tool.sourceInfo?.resolvedPath || tool.sourceInfo?.path;
    if (sourcePath && roots.some(root => pathInside(root, sourcePath))) names.push(tool.name);
  }
  return [...new Set(names)];
}

export function buildSubagentToolProjection(pi: ExtensionAPI, cwd: string): SubagentToolProjection[] {
  try {
    const discovery = discoverAgents(cwd, "both");
    const mountedIds = mountedExtensionIdsFromEnv();
    const ownership = extensionToolOwnership();
    const disabledTools = loadDisabledTools();
    const routing = resolvePipiUIExtensionRouting({
      webAccessExtension: process.env.PIPIUI_WEB_ACCESS_EXT,
      arxivExtension: process.env.PIPIUI_ARXIV_EXT,
    });
    const skillLoaderPath = resolveWorkerSkillLoaderPath({
      env: process.env,
      bundledPath: fileURLToPath(new URL("./pipiui-skillloader.ts", import.meta.url)),
      existsSync: fs.existsSync,
    });
    const memoryBrokerAvailable = process.env.PIPIUI_MEMORY_BROKER_MODE === "main";
    const registryTools = workerRegistryToolNames(pi, memoryBrokerAvailable);
    const maxDepth = resolveSubagentMaxDepth(process.env.PIPIUI_AGENT_MAX_DEPTH);

    return discovery.agents.map(agent => {
      const runtimePolicy = runtimeRolePolicyForAgent(agent);
      const allowRecursiveDelegation = childReceivesDelegationTools({
        allowRecursiveDelegation: runtimePolicy.allowRecursiveDelegation,
        childDepth: 1,
        maxDepth,
      });
      const patch = dispatchToolPatch(agent, mountedIds, ownership);
      const selection = resolveSubagentToolSelection({
        declaredTools: patch.declaredTools?.filter(name => allowRecursiveDelegation || !isDelegationTool(name)),
        disabledTools: [...disabledTools, ...patch.extraDisabledTools],
        hasMemoryBrokerCapability: memoryBrokerAvailable && runtimePolicy.role === "worker",
        hasSessionRecall: Boolean(process.env.PIPIUI_SUBAGENT_EXT),
        hasSkillLoader: Boolean(skillLoaderPath),
        allowRecursiveDelegation,
        availableExtensionTools: routing.extensionOnlyTools,
        // The selected model can still hide generic web_search at dispatch time; the UI states this dynamic narrowing.
        hideGenericWebSearch: false,
      });
      if (selection.flag === "--exclude-tools") {
        const excluded = new Set(selection.names);
        return {
          name: agent.name,
          toolPolicy: "unrestricted" as const,
          tools: registryTools.filter(name => !excluded.has(name)).sort((a, b) => a.localeCompare(b)),
          excludedTools: [...excluded].sort((a, b) => a.localeCompare(b)),
        };
      }
      return {
        name: agent.name,
        toolPolicy: "allowlist" as const,
        tools: [...selection.names].sort((a, b) => a.localeCompare(b)),
      };
    });
  } catch {
    return [];
  }
}
