/**
 * Flapcode relay payload sanitizer.
 *
 * Live probing (2026-09, real key): the relay rejects unknown Responses
 * parameters with 400 "Unsupported parameter: …". pi's openai-responses
 * streamer always sends two the relay does not know:
 * - `max_output_tokens` (streamSimple defaults maxTokens from the model, no
 *   compat gate exists to suppress it);
 * - `prompt_cache_retention` (whenever cache retention resolves to "long";
 *   also pinned off per-model via compat.supportsLongCacheRetention).
 * `prompt_cache_options` is stripped defensively — same family, same risk.
 *
 * Everything else pi sends was probed as accepted: store:false, stream:true,
 * structured input, instructions, reasoning {effort, summary}, include
 * [reasoning.encrypted_content], prompt_cache_key.
 */

const UNSUPPORTED_PARAMS = ["max_output_tokens", "prompt_cache_retention", "prompt_cache_options"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the payload without relay-unsupported params; undefined when untouched. */
export function stripUnsupportedFlapcodeParams(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  if (!UNSUPPORTED_PARAMS.some((key) => key in payload)) return undefined;
  const out = { ...payload };
  for (const key of UNSUPPORTED_PARAMS) delete out[key];
  return out;
}
