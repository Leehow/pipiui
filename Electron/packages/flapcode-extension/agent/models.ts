/**
 * Flapcode model catalog (single source).
 *
 * Flapcode is a Codex relay (Responses wire API, Bearer key). Model
 * parameters mirror pi's built-in `openai-codex` catalog; the transport
 * here is plain `openai-responses` because the relay speaks the standard
 * Responses API with an API key, not the ChatGPT backend session protocol.
 */

/**
 * Established by live probing with a real key (2026-09): the documented
 * `codex.flapcode.com` gateway rejects every TLS handshake
 * (unrecognized_name); the working relay for the probed account is
 * `https://codex.takemoon.com/v1`, discoverable per account via
 * `flapcode.com/api/cli/config` (see discovery.ts). The relay also requires
 * a `session-id` request header and `store:false` + `stream:true` +
 * structured list `input` in the Responses payload — pi's openai-responses
 * streamer already satisfies the payload side; the header is added by
 * provider.ts. `/v1/models` is not served (404): the catalog below is the
 * probed-verified model set (all five returned response.completed).
 */

export const FLAPCODE_PROVIDER_ID = "flapcode";
export const FLAPCODE_PROVIDER_NAME = "Flapcode";
export const AUTH_PROVIDER_ID = FLAPCODE_PROVIDER_ID;

export const FLAPCODE_BASE_URL = "https://codex.takemoon.com/v1";
export const FLAPCODE_DEFAULT_MODEL_ID = "gpt-5.6-sol";

export type FlapcodeModel = {
  id: string;
  name: string;
  api: "openai-responses";
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap: Record<string, string | null>;
  compat: { supportsLongCacheRetention: false };
};

const GPT_5_6_THINKING_MAP: Record<string, string | null> = {
  xhigh: "xhigh",
  max: "max",
  minimal: "low",
};

/**
 * The relay 400s on `prompt_cache_retention` (live-probed); pinning
 * supportsLongCacheRetention off keeps pi from ever emitting it. The wire is
 * additionally sanitized in client.ts for `max_output_tokens`, which pi sends
 * unconditionally.
 */
const FLAPCODE_COMPAT = { supportsLongCacheRetention: false } as const;

export const FLAPCODE_MODELS: readonly FlapcodeModel[] = [
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Flapcode)",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 272000,
    maxTokens: 128000,
    thinkingLevelMap: { ...GPT_5_6_THINKING_MAP },
    compat: { ...FLAPCODE_COMPAT },
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna (Flapcode)",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
    contextWindow: 272000,
    maxTokens: 128000,
    thinkingLevelMap: { ...GPT_5_6_THINKING_MAP },
    compat: { ...FLAPCODE_COMPAT },
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra (Flapcode)",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
    contextWindow: 272000,
    maxTokens: 128000,
    thinkingLevelMap: { ...GPT_5_6_THINKING_MAP },
    compat: { ...FLAPCODE_COMPAT },
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra (Flapcode)",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    contextWindow: 272000,
    maxTokens: 128000,
    thinkingLevelMap: {
      off: null,
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    compat: { ...FLAPCODE_COMPAT },
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5 (Flapcode)",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 128000,
    thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
    compat: { ...FLAPCODE_COMPAT },
  },
];

/**
 * Manifest-shaped catalog. The manifest (`pipiui-extension.json`) is what the
 * host overlays when the Pi runtime catalog is empty, so it must deep-equal
 * this list — a drifted price or context window there is a wrong number shown
 * to the user, not a cosmetic mismatch.
 */
export function flapcodeManifestModels(): FlapcodeModel[] {
  return FLAPCODE_MODELS.map((model) => ({
    ...model,
    cost: { ...model.cost },
    thinkingLevelMap: { ...model.thinkingLevelMap },
    compat: { ...model.compat },
    input: [...model.input],
  }));
}
