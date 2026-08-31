import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { closeSync, constants as fsConstants, fchmodSync, fstatSync, fsyncSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { Type } from "typebox";

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

function collectRuntimeDebugResources(pi: ExtensionAPI, ctx: ExtensionContext): RuntimeDebugResources {
  const allTools = (pi.getAllTools?.() ?? []) as ToolMetadata[];
  return {
    tools: allTools.map(tool => ({
      name: tool.name,
      description: tool.description ?? "",
      ...(tool.sourceInfo?.source ? { source: tool.sourceInfo.source } : {}),
      ...(tool.sourceInfo?.scope ? { scope: tool.sourceInfo.scope } : {}),
    })),
    skills: listSkillCatalogMetadata(),
    subagents: buildSubagentToolProjection(pi, ctx.cwd),
  };
}

function writeRuntimeDebugSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  previous: RuntimeDebugState,
  refreshResources: boolean,
): RuntimeDebugState {
  const sessionFile = ctx.sessionManager.getSessionFile?.();
  if (!sessionFile) return previous;
  try {
    const resources = refreshResources || !previous.resources
      ? collectRuntimeDebugResources(pi, ctx)
      : previous.resources;
    const snapshot = {
      version: 1,
      sessionId: ctx.sessionManager.getSessionId(),
      activeTools: pi.getActiveTools(),
      ...resources,
    };
    const signature = JSON.stringify(snapshot);
    if (signature === previous.signature) return { signature, resources };
    const content = Buffer.from(JSON.stringify({ ...snapshot, capturedAt: Date.now() }), "utf8");
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
    debugState = writeRuntimeDebugSnapshot(pi, ctx, { signature: "" }, true);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    debugState = writeRuntimeDebugSnapshot(pi, ctx, debugState, true);
  });

  pi.on("tool_result", (_event, ctx) => {
    // Tool results may activate a deferred tool. Reuse the cached Skill/agent projection unless the active set changed.
    debugState = writeRuntimeDebugSnapshot(pi, ctx, debugState, false);
  });

  pi.on("model_select", (_event, ctx) => {
    debugState = writeRuntimeDebugSnapshot(pi, ctx, debugState, true);
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
        lastProviderRequest: safeLastRequest,
      });
    },
  });
}
