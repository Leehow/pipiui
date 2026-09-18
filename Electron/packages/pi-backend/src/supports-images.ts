/**
 * Image capability is opt-out. Frontier models are multimodal by default;
 * catalogs that omit `image` from `input` are treated as stale, not as a
 * whitelist. The only remaining text-only line we mark is GLM before 5.3
 * (excluding explicit vision SKUs such as glm-4v).
 */

/** GLM vision SKUs stay multimodal even on the pre-5.3 line. */
const GLM_VISION_SKU =
  /(?:^|[^a-z])glm[-_]?\d+(?:\.\d+)*v\b|glm[-_]?vl|\bvision\b|[-_]vl(?:[-_]|$)/;

function isGlmTextOnlyBefore53(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (GLM_VISION_SKU.test(id) || id.includes("vl")) return false;
  const match = id.match(/(?:^|[^a-z])glm[-_]?(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] !== undefined ? Number(match[2]) : 0;
  return major < 5 || (major === 5 && minor < 3);
}

/**
 * Whether this catalog row should accept image attachments.
 * `input` is accepted for call-site compatibility but is not a whitelist:
 * a missing `"image"` entry no longer marks the model text-only.
 */
export function supportsImagesFor(
  modelId: string,
  _provider?: string,
  _input?: unknown,
): boolean {
  return !isGlmTextOnlyBefore53(modelId);
}
