import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { Type } from "typebox";

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

export default function (pi: ExtensionAPI) {
  let lastRequest: RequestEvidence | undefined;

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

  pi.on("session_start", () => {
    lastRequest = undefined;
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
