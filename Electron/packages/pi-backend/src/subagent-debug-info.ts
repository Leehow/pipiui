import { constants as fsConstants } from "node:fs";
import { open, rm } from "node:fs/promises";

import type { AgentDebugSkill, AgentDebugSubagent, AgentDebugTool, SubagentDebugInfo } from "@pipi/host-api";

export const RUNTIME_DEBUG_SIDECAR_SUFFIX = ".pipiui-runtime-debug.json";
export const MAX_RUNTIME_DEBUG_BYTES = 1024 * 1024;
const MAX_NAME_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 20_000;

export function runtimeDebugSidecarPath(sessionPath: string): string {
  return `${sessionPath}${RUNTIME_DEBUG_SIDECAR_SUFFIX}`;
}

function unavailable(reason: NonNullable<SubagentDebugInfo["reason"]>): SubagentDebugInfo {
  return { available: false, reason, bossTools: [], toolCatalog: [], skills: [], subagents: [] };
}

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanTool(value: unknown): AgentDebugTool | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const name = cleanString(entry.name, MAX_NAME_CHARS);
  if (!name) return undefined;
  const tool: AgentDebugTool = {
    name,
    description: cleanString(entry.description, MAX_DESCRIPTION_CHARS) ?? "",
  };
  const source = cleanString(entry.source, MAX_NAME_CHARS);
  if (source) tool.source = source;
  if (entry.scope === "user" || entry.scope === "project" || entry.scope === "temporary") {
    tool.scope = entry.scope;
  }
  return tool;
}

function cleanSkill(value: unknown): AgentDebugSkill | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const name = cleanString(entry.name, MAX_NAME_CHARS);
  if (!name) return undefined;
  return {
    name,
    description: cleanString(entry.description, MAX_DESCRIPTION_CHARS) ?? "",
    ...(typeof entry.userInvoked === "boolean" ? { userInvoked: entry.userInvoked } : {}),
  };
}

function cleanNameList(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).flatMap(item => {
    const name = cleanString(item, MAX_NAME_CHARS);
    return name ? [name] : [];
  }))];
}

function cleanSubagent(value: unknown): AgentDebugSubagent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const name = cleanString(entry.name, MAX_NAME_CHARS);
  if (!name || (entry.toolPolicy !== "allowlist" && entry.toolPolicy !== "unrestricted")) return undefined;
  return {
    name,
    toolPolicy: entry.toolPolicy,
    tools: cleanNameList(entry.tools),
    ...(entry.toolPolicy === "unrestricted" ? { excludedTools: cleanNameList(entry.excludedTools) } : {}),
  };
}

function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

export async function readSubagentDebugInfo(sessionPath: string, expectedSessionId: string): Promise<SubagentDebugInfo> {
  const path = runtimeDebugSidecarPath(sessionPath);
  try {
    const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
    const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | noFollow);
    let raw: string;
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size <= 0 || metadata.size > MAX_RUNTIME_DEBUG_BYTES) {
        return unavailable("snapshot-invalid");
      }
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.unavailable === "snapshot-too-large") return unavailable("snapshot-too-large");
    if (parsed.version !== 1 || parsed.sessionId !== expectedSessionId) return unavailable("snapshot-invalid");

    const toolCatalog = uniqueByName((Array.isArray(parsed.tools) ? parsed.tools : []).flatMap(value => {
      const tool = cleanTool(value);
      return tool ? [tool] : [];
    }));
    const toolByName = new Map(toolCatalog.map(tool => [tool.name, tool]));
    const activeNames = uniqueByName((Array.isArray(parsed.activeTools) ? parsed.activeTools : []).flatMap(value => {
      const name = cleanString(value, MAX_NAME_CHARS);
      return name ? [{ name }] : [];
    })).map(item => item.name);
    const bossTools = activeNames.map(name => toolByName.get(name) ?? { name, description: "" });
    const skills = uniqueByName((Array.isArray(parsed.skills) ? parsed.skills : []).flatMap(value => {
      const skill = cleanSkill(value);
      return skill ? [skill] : [];
    }));
    const subagents = uniqueByName((Array.isArray(parsed.subagents) ? parsed.subagents : []).flatMap(value => {
      const subagent = cleanSubagent(value);
      return subagent ? [subagent] : [];
    }));
    const capturedAt = typeof parsed.capturedAt === "number" && Number.isFinite(parsed.capturedAt)
      ? parsed.capturedAt
      : undefined;

    return {
      available: true,
      source: "live",
      sessionId: expectedSessionId,
      ...(capturedAt !== undefined ? { capturedAt } : {}),
      bossTools,
      toolCatalog,
      skills,
      subagents,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return unavailable("snapshot-not-ready");
    return unavailable("snapshot-invalid");
  }
}

export async function removeSubagentDebugInfo(sessionPath: string): Promise<void> {
  await rm(runtimeDebugSidecarPath(sessionPath), { force: true }).catch(() => undefined);
}
