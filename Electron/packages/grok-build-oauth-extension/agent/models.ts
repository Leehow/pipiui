/**
 * Canonical Grok Build conversation models.
 *
 * Declared once and consumed by:
 * - the Pi provider factory (`createAuthProvider`) so session runtime can stream;
 * - the manifest `auth.provider.models` contribution so the host catalog can
 *   overlay the same ids when the Pi runtime catalog is empty.
 *
 * Image generation stays on `image_gen` / `image_edit` tools — these ids are
 * conversation models only. They are never written to models.json.
 */

export const AUTH_PROVIDER_ID = "grok-build";
export const GROK_BUILD_PROVIDER_ID = AUTH_PROVIDER_ID;

export const GROK_BUILD_CHAT_API = "openai-responses" as const;
export const GROK_BUILD_BASE_URL = "https://api.x.ai/v1";

export type GrokBuildNativeSearch = {
  tools: Array<"web_search" | "x_search">;
  domains?: { allow?: string[]; deny?: string[] };
};

export type GrokBuildHostedTools = {
  tools: Array<"web_search" | "x_search" | "code_interpreter">;
  domains?: { allow?: string[]; deny?: string[] };
};

export type GrokBuildModelCapabilities = {
  hostedTools: GrokBuildHostedTools;
  structuredOutputs: true;
  inputFiles: true;
  nativeSearch: GrokBuildNativeSearch;
};

export type GrokBuildConversationModel = {
  id: string;
  name: string;
  api: typeof GROK_BUILD_CHAT_API;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;
  compat?: { supportsReasoningEffort?: boolean };
  capabilities?: GrokBuildModelCapabilities;
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/** Hosted Agent Tools on the Responses API. Domain policy is optional overlay. */
export const GROK_BUILD_NATIVE_SEARCH: GrokBuildNativeSearch = {
  tools: ["web_search", "x_search"],
};

export const GROK_BUILD_HOSTED_TOOLS: GrokBuildHostedTools = {
  tools: ["web_search", "x_search", "code_interpreter"],
};

export const GROK_BUILD_CAPABILITIES: GrokBuildModelCapabilities = {
  hostedTools: { tools: [...GROK_BUILD_HOSTED_TOOLS.tools] },
  structuredOutputs: true,
  inputFiles: true,
  nativeSearch: { tools: [...GROK_BUILD_NATIVE_SEARCH.tools] },
};

/**
 * Concrete, tested Grok Build chat models. Official xAI Responses ids
 * reachable with the grok-build OAuth access token. Keep this list small and
 * explicit — do not scrape a live catalog. Reasoning flags stay as declared.
 */
export const GROK_BUILD_CONVERSATION_MODELS: readonly GrokBuildConversationModel[] = [
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    api: GROK_BUILD_CHAT_API,
    reasoning: true,
    input: ["text", "image"],
    cost: { ...ZERO_COST },
    contextWindow: 256000,
    maxTokens: 16384,
    thinkingLevelMap: {
      off: null,
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
    },
    compat: { supportsReasoningEffort: true },
    capabilities: { ...GROK_BUILD_CAPABILITIES },
  },
  {
    id: "grok-4-fast",
    name: "Grok 4 Fast",
    api: GROK_BUILD_CHAT_API,
    reasoning: false,
    input: ["text"],
    cost: { ...ZERO_COST },
    contextWindow: 256000,
    maxTokens: 16384,
    capabilities: { ...GROK_BUILD_CAPABILITIES },
  },
  {
    id: "grok-code-fast-1",
    name: "Grok Code Fast",
    api: GROK_BUILD_CHAT_API,
    reasoning: false,
    input: ["text"],
    cost: { ...ZERO_COST },
    contextWindow: 256000,
    maxTokens: 16384,
    capabilities: { ...GROK_BUILD_CAPABILITIES },
  },
];

export const GROK_BUILD_CONVERSATION_MODEL_IDS: readonly string[] = GROK_BUILD_CONVERSATION_MODELS.map(
  (model) => model.id,
);

/** Slim Pi-shaped contribution used by `pipiui-extension.json` `auth.provider.models`. */
export function grokBuildManifestModels(): Array<{
  id: string;
  name: string;
  api: typeof GROK_BUILD_CHAT_API;
  input: string[];
  reasoning: boolean;
  capabilities: GrokBuildModelCapabilities;
}> {
  return GROK_BUILD_CONVERSATION_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    api: model.api,
    input: [...model.input],
    reasoning: model.reasoning,
    capabilities: {
      hostedTools: {
        tools: [...(model.capabilities?.hostedTools.tools ?? GROK_BUILD_HOSTED_TOOLS.tools)],
      },
      structuredOutputs: true,
      inputFiles: true,
      nativeSearch: {
        tools: [...(model.capabilities?.nativeSearch.tools ?? GROK_BUILD_NATIVE_SEARCH.tools)],
      },
    },
  }));
}
