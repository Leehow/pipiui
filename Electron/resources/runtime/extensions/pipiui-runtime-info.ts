import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { closeSync, constants as fsConstants, fchmodSync, fstatSync, fsyncSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { Type } from "typebox";

import { type PromptProvenance, promptProvenance } from "./pipiui-prompt-provenance.ts";

import { listSkillCatalogMetadata } from "./pipiui-skillloader.ts";
import { buildSubagentToolProjection } from "./subagent-debug-projection.ts";

type ReasoningEvidence =
  | { status: "not_observed" }
  | { reasoning_effort: string }
  | { reasoning: { effort: string } };

type RequestEvidence = {
  sessionId: string;
  status: "observed";
  provider: string | null;
  model: string | null;
  thinkingLevel: string | null;
  observedAt: string;
  serializedReasoning: ReasoningEvidence;
};

type ToolMetadata = {
  name: string;
  description?: string;
  sourceInfo?: { source?: string; scope?: "user" | "project" | "temporary" };
};

export const RUNTIME_DEBUG_SIDECAR_SUFFIX = ".pipiui-runtime-debug.json";
export const MAX_RUNTIME_DEBUG_BYTES = 1024 * 1024;
const MAX_DEBUG_NAME_CHARS = 200;
const MAX_DEBUG_DESCRIPTION_CHARS = 20_000;
const MAX_DEBUG_COLLECTION_ENTRIES = 4_096;
const MAX_DEBUG_NAMES_PER_SUBAGENT = 4_096;

export function runtimeDebugSidecarPath(sessionFile: string): string {
  return `${sessionFile}${RUNTIME_DEBUG_SIDECAR_SUFFIX}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract only provider reasoning controls that are safe and useful to reveal. */
function reasoningEvidence(payload: unknown): ReasoningEvidence {
  if (!isRecord(payload)) return { status: "not_observed" };
  if (typeof payload.reasoning_effort === "string") {
    return { reasoning_effort: payload.reasoning_effort };
  }
  if (isRecord(payload.reasoning) && typeof payload.reasoning.effort === "string") {
    return { reasoning: { effort: payload.reasoning.effort } };
  }
  return { status: "not_observed" };
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: {},
  };
}

function currentThinking(pi: ExtensionAPI, ctx: ExtensionContext): string | null {
  return ctx.thinkingLevel ?? pi.getThinkingLevel?.() ?? null;
}

type RuntimeDebugResources = {
  tools: Array<{ name: string; description: string; source?: string; scope?: "user" | "project" | "temporary" }>;
  skills: ReturnType<typeof listSkillCatalogMetadata>;
  subagents: ReturnType<typeof buildSubagentToolProjection>;
};

type RuntimeDebugState = { signature: string; resources?: RuntimeDebugResources };

function boundedString(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function boundedNames(value: unknown): { names: string[]; oversized: boolean } {
  const raw = Array.isArray(value) ? value : [];
  if (raw.length > MAX_DEBUG_NAMES_PER_SUBAGENT) return { names: [], oversized: true };
  const names = raw.flatMap(item => {
    const name = boundedString(item, MAX_DEBUG_NAME_CHARS);
    return name ? [name] : [];
  });
  return { names: [...new Set(names)], oversized: false };
}

function collectRuntimeDebugResources(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): { resources: RuntimeDebugResources; oversized: boolean } {
  const allTools = (pi.getAllTools?.() ?? []) as ToolMetadata[];
  const allSkills = listSkillCatalogMetadata();
  const allSubagents = buildSubagentToolProjection(pi, ctx.cwd);
  let oversized = allTools.length > MAX_DEBUG_COLLECTION_ENTRIES
    || allSkills.length > MAX_DEBUG_COLLECTION_ENTRIES
    || allSubagents.length > MAX_DEBUG_COLLECTION_ENTRIES;
  const tools = allTools.slice(0, MAX_DEBUG_COLLECTION_ENTRIES).flatMap(tool => {
    const name = boundedString(tool.name, MAX_DEBUG_NAME_CHARS);
    if (!name) return [];
    const source = boundedString(tool.sourceInfo?.source, MAX_DEBUG_NAME_CHARS);
    return [{
      name,
      description: boundedString(tool.description, MAX_DEBUG_DESCRIPTION_CHARS),
      ...(source ? { source } : {}),
      ...(tool.sourceInfo?.scope ? { scope: tool.sourceInfo.scope } : {}),
    }];
  });
  const skills = allSkills.slice(0, MAX_DEBUG_COLLECTION_ENTRIES).flatMap(skill => {
    const name = boundedString(skill.name, MAX_DEBUG_NAME_CHARS);
    return name ? [{
      name,
      description: boundedString(skill.description, MAX_DEBUG_DESCRIPTION_CHARS),
      userInvoked: skill.userInvoked,
    }] : [];
  });
  const subagents = allSubagents.slice(0, MAX_DEBUG_COLLECTION_ENTRIES).flatMap(subagent => {
    const name = boundedString(subagent.name, MAX_DEBUG_NAME_CHARS);
    const tools = boundedNames(subagent.tools);
    const excludedTools = boundedNames(subagent.excludedTools);
    oversized ||= tools.oversized || excludedTools.oversized;
    if (!name || tools.oversized || excludedTools.oversized) return [];
    return [{
      name,
      toolPolicy: subagent.toolPolicy,
      tools: tools.names,
      ...(subagent.toolPolicy === "unrestricted" ? { excludedTools: excludedTools.names } : {}),
    }];
  });
  return {
    resources: { tools, skills, subagents },
    oversized,
  };
}

function snapshotFitsBudget(snapshot: {
  version: 1;
  sessionId: string;
  activeTools: string[];
} & RuntimeDebugResources): boolean {
  // Measure one bounded item at a time. This avoids constructing a multi-megabyte
  // JSON string merely to discover that the reader will reject it.
  let bytes = Buffer.byteLength(JSON.stringify({
    version: snapshot.version,
    sessionId: snapshot.sessionId,
    activeTools: [],
    tools: [],
    skills: [],
    subagents: [],
    capturedAt: Number.MAX_SAFE_INTEGER,
  }), "utf8");
  for (const item of [snapshot.activeTools, snapshot.tools, snapshot.skills, snapshot.subagents].flat()) {
    bytes += Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
    if (bytes > MAX_RUNTIME_DEBUG_BYTES) return false;
  }
  return true;
}

function writeRuntimeDebugSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  previous: RuntimeDebugState,
  refreshResources: boolean,
  systemPrompt?: PromptProvenance,
): RuntimeDebugState {
  const sessionFile = ctx.sessionManager.getSessionFile?.();
  if (!sessionFile) return previous;
  try {
    const collected = refreshResources || !previous.resources
      ? collectRuntimeDebugResources(pi, ctx)
      : { resources: previous.resources, oversized: false };
    const rawActiveTools = pi.getActiveTools();
    const activeTools = rawActiveTools.slice(0, MAX_DEBUG_COLLECTION_ENTRIES).flatMap(value => {
      const name = boundedString(value, MAX_DEBUG_NAME_CHARS);
      return name ? [name] : [];
    });
    const candidate = {
      version: 1 as const,
      sessionId: ctx.sessionManager.getSessionId(),
      activeTools,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...collected.resources,
    };
    const oversized = collected.oversized
      || rawActiveTools.length > MAX_DEBUG_COLLECTION_ENTRIES
      || !snapshotFitsBudget(candidate);
    const snapshot = oversized
      ? { version: 1 as const, sessionId: candidate.sessionId, unavailable: "snapshot-too-large" as const }
      : candidate;
    const signature = JSON.stringify(snapshot);
    const resources = oversized ? undefined : collected.resources;
    if (signature === previous.signature) return { signature, resources };
    const content = Buffer.from(JSON.stringify({ ...snapshot, capturedAt: Date.now() }), "utf8");
    if (content.byteLength > MAX_RUNTIME_DEBUG_BYTES) return previous;
    const noFollow = (fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;
    const fd = openSync(runtimeDebugSidecarPath(sessionFile), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_NONBLOCK | noFollow, 0o600);
    try {
      const metadata = fstatSync(fd);
      if (!metadata.isFile() || metadata.nlink !== 1) throw new Error("unsafe runtime Debug sidecar");
      fchmodSync(fd, 0o600);
      ftruncateSync(fd, 0);
      let offset = 0;
      while (offset < content.length) offset += writeSync(fd, content, offset, content.length - offset);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return { signature, resources };
  } catch {
    // Debug metadata is best-effort observability and must never affect a session.
    return previous;
  }
}

export default function (pi: ExtensionAPI) {
  let lastRequest: RequestEvidence | undefined;
  let lastSystemPrompt: PromptProvenance | undefined;
  let debugState: RuntimeDebugState = { signature: "" };

  // Pi invokes before_provider_request handlers in mount order. PipiUI mounts this extension
  // last, so this observer sees the payload after every PipiUI payload rewriter.
  pi.on("before_provider_request", (event, ctx) => {
    lastRequest = {
      sessionId: ctx.sessionManager.getSessionId(),
      status: "observed",
      provider: ctx.model?.provider ?? null,
      model: ctx.model?.id ?? null,
      thinkingLevel: currentThinking(pi, ctx),
      observedAt: new Date().toISOString(),
      serializedReasoning: reasoningEvidence(event.payload),
    };
  });

  pi.on("session_start", (_event, ctx) => {
    lastRequest = undefined;
    lastSystemPrompt = undefined;
    debugState = writeRuntimeDebugSnapshot(pi, ctx, { signature: "" }, true);
  });

  // Pi chains before_agent_start through every extension in mount order, handing each the
  // running result; PipiUI mounts this one last, so `event.systemPrompt` here is the finished
  // prompt after the base, philosophy, the skill catalog and every provider tip. This is the
  // only place in the process that sees it whole.
  pi.on("before_agent_start", (event, ctx) => {
    lastSystemPrompt = promptProvenance(event.systemPrompt);
    debugState = writeRuntimeDebugSnapshot(pi, ctx, debugState, true, lastSystemPrompt);
  });

  pi.on("tool_result", (_event, ctx) => {
    // Tool results may activate a deferred tool. Reuse the cached Skill/agent projection unless the active set changed.
    // The retained provenance rides along: omitting it would drop the field, change the
    // signature, and rewrite the sidecar on every tool result just to restore it next turn.
    debugState = writeRuntimeDebugSnapshot(pi, ctx, debugState, false, lastSystemPrompt);
  });

  pi.on("model_select", (_event, ctx) => {
    debugState = writeRuntimeDebugSnapshot(pi, ctx, debugState, true, lastSystemPrompt);
  });

  pi.registerTool({
    name: "pipiui_runtime_info",
    label: "PipiUI Runtime Info",
    description:
      "Read the current Pi runtime state. Call this tool first when the user asks which model, " +
      "provider, thinking level/effort, session, working directory, tools, or context usage is active.",
    promptSnippet: "Exact current Pi model, thinking, session, cwd, tools, and request effort",
    promptGuidelines: [
      "Call pipiui_runtime_info first for questions about the current model/provider/thinking or reasoning effort/session/cwd/tools/context usage.",
      "For whether a provider request actually used an effort, report only lastProviderRequest; do not infer it from chat history, the system prompt, or old PI_* output.",
      "For what is in your own system prompt — whether the PipiUI base, philosophy, project context or the skill catalog is present, and how large each is — report systemPrompt.segments rather than describing the prompt from memory.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const model = ctx.model;
      const sessionId = ctx.sessionManager.getSessionId();
      const safeLastRequest = lastRequest?.sessionId === sessionId
        ? (({ sessionId: _sessionId, ...evidence }) => evidence)(lastRequest)
        : { status: "not_observed" as const };
      return result({
        provider: model?.provider ?? null,
        model: model ? { id: model.id, name: model.name ?? model.id } : null,
        thinking: {
          current: currentThinking(pi, ctx),
          supported: model ? getSupportedThinkingLevels(model) : [],
        },
        session: {
          id: sessionId,
          name: ctx.sessionManager.getSessionName() ?? pi.getSessionName?.() ?? null,
        },
        cwd: ctx.cwd,
        activeTools: pi.getActiveTools(),
        contextUsage: ctx.getContextUsage() ?? null,
        systemPrompt: lastSystemPrompt ?? { status: "not_observed" as const },
        lastProviderRequest: safeLastRequest,
      });
    },
  });
}
