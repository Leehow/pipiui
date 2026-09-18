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
 * `https://codex.takemoon.com/v1`, which the provider now pins. The
 * `flapcode.com/api/cli/config` lookup that used to resolve it per account is
 * gone: that control plane answers 409 "Codex 账号已过期" for accounts that are
 * live and serving, so it could only steer a working provider off the relay.
 * The relay also requires
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
  compat: { supportsLongCacheRetention: false; supportsStrictMode: true };
};

/**
 * Full (non-sparse) effort map. pi's own `openai-codex` catalog ships a sparse
 * `{xhigh, max, minimal}` whose absent keys mean "pass through unchanged", and
 * the host expands that into a full map from its bundled capability snapshot
 * (`model-capabilities/models-dev-reasoning-options.json`, `openai-codex`).
 * That snapshot knows nothing about extension providers, so a sparse map here
 * reached `thinkingLevelsForModel` unexpanded and low/medium/high silently
 * vanished from the thinking picker — Flapcode models offered only
 * Off/Minimal/Xhigh/Max while the same upstream models accept five levels.
 *
 * Values below are live-probed against the relay (2026-09), one request per
 * (model, effort): `minimal` is rejected upstream ("Unsupported value") and is
 * mapped to `low` exactly as pi maps it; `low`/`medium`/`high`/`xhigh`/`max`
 * are accepted verbatim. `off` stays absent, which both keeps it in the picker
 * and sends the accepted `none`.
 */
const GPT_5_6_THINKING_MAP: Record<string, string | null> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/**
 * The relay 400s on `prompt_cache_retention` (live-probed); pinning
 * supportsLongCacheRetention off keeps pi from ever emitting it. The wire is
 * additionally sanitized in client.ts for `max_output_tokens`, which pi sends
 * unconditionally.
 */
// Allow pi to send its default `strict:false` on function tools. Omitting
// strict lets Responses normalize arbitrary extension schemas into strict
// mode; the relay then fails while generating tool calls (live A/B verified).
const FLAPCODE_COMPAT = {
  supportsLongCacheRetention: false,
  supportsStrictMode: true,
} as const;

export const FLAPCODE_MODELS: readonly FlapcodeModel[] = [
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol (Flapcode)",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow: 1000000,
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
    contextWindow: 1000000,
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
    contextWindow: 1000000,
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
    contextWindow: 1000000,
    maxTokens: 128000,
    // Same probe as GPT_5_6_THINKING_MAP, except `off`: astra rejects the
    // `none` effort ("Unsupported value: 'none'"), so thinking cannot be
    // turned off for it and the level is marked unsupported.
    thinkingLevelMap: { ...GPT_5_6_THINKING_MAP, off: null },
    compat: { ...FLAPCODE_COMPAT },
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5 (Flapcode)",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 128000,
    // Same probe as GPT_5_6_THINKING_MAP, except `max`, which 5.5 rejects
    // ("Unsupported value: 'max'"): null keeps it out of the picker.
    thinkingLevelMap: { ...GPT_5_6_THINKING_MAP, max: null },
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
