export const EXTENSION_ID = "openai-fast";
export const DATA_ROOT = ".pi/agent/openai-fast";
// Explicit OpenAI catalog identities, not names containing 'fast'. Relay acceptance is unconfirmed.
export const FLAPCODE_OPENAI_MODELS = Object.freeze([
  "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra",
  "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.5",
]);
export function visible(model) {
  return model?.provider === "openai-codex" ||
    (model?.provider === "flapcode" && FLAPCODE_OPENAI_MODELS.includes(model.id));
}
export function capable(model) {
  return visible(model) && (model.provider === "openai-codex"
    ? !model.api || model.api === "openai-codex-responses"
    : !model.api || model.api === "openai-responses");
}
export function modelKey(model) { return `${model.provider}/${model.id}`; }
export function validSessionIdentity(sessionId) { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId || ""); }
export function preferencePath(sessionId, model) {
  if (!validSessionIdentity(sessionId)) throw Error("Invalid session identity");
  const component = value => encodeURIComponent(value).replaceAll(".", "%2E");
  return `${DATA_ROOT}/${sessionId}_${component(model.provider)}_${component(model.id)}.json`;
}
export function parsePreference(text) {
  if (!text) return {version: 1, enabled: false, revision: null};
  const data = JSON.parse(text);
  if (data?.version !== 1 || typeof data.enabled !== "boolean" || typeof data.revision !== "string")
    throw Error("Invalid Fast preference");
  return {version: 1, enabled: data.enabled, revision: data.revision};
}
export function requestPayload(payload, model, enabled) {
  if (!capable(model) || !payload || typeof payload !== "object" || Array.isArray(payload) || payload.model !== model.id)
    return payload;
  // Last provider hook wins over samplingParams. Off cannot inherit account-default or a static Fast override.
  return {...payload, service_tier: enabled ? "priority" : "default"};
}
export function reportedTier(data) {
  if (!["response.completed", "response.incomplete", "response.done"].includes(data?.type)) return null;
  const value = data?.response?.service_tier;
  return typeof value === "string" ? value : null;
}
export function observationStatus(requested, tier, rejected = false) {
  if (rejected) return "unsupported";
  if (tier === "priority" || tier === "fast") return "effective";
  if (tier === "default") return requested ? "default" : "standard";
  return "unknown";
}
export function tierRejected(message) {
  return typeof message === "string" && /service[_ ]tier/i.test(message) && /unsupported|not supported|invalid/i.test(message);
}
/** Catalog-price estimate only. Reported tier is authoritative; request tier is never a fallback. */
export function estimatedUsage(usage, model, tier) {
  if (!usage || !model?.cost || !["default", "fast", "priority", "flex"].includes(tier)) return usage;
  // GPT-5.5 is exceptional in the pinned Pi adapters. Preserve its 2.5 estimate, not a generic 2.
  // Current official tier pricing was not verified for this legacy identity; costBasis says so.
  const multiplier = tier === "fast" || tier === "priority" ? model.id === "gpt-5.5" ? 2.5 : 2 : tier === "flex" ? 0.5 : 1;
  const cost = {};
  for (const field of ["input", "output", "cacheRead", "cacheWrite"])
    cost[field] = (Number(usage[field]) || 0) * (Number(model.cost[field]) || 0) / 1_000_000 * multiplier;
  cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
  return {...usage, cost};
}

export function estimateBasis(model, tier) {
  if (!tier) return "unconfirmed";
  if (!["default", "fast", "priority", "flex"].includes(tier)) return "reported-tier-price-unverified";
  return model?.id === "gpt-5.5" && ["priority", "fast"].includes(tier)
    ? "reported-tier-pinned-sdk-estimate-price-unverified" : "reported-tier-catalog-estimate";
}
