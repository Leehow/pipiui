import { readFile } from "node:fs/promises";
import { extSettingsPath } from "./paths.js";

export const DEFAULT_TOKEN_BUDGET = 4000;

/**
 * Truthful exact-layer providers (shared decision: unsupported Zoekt must not
 * be advertised; there is no semantic API key consumer in this build).
 * - auto: prefer the Tantivy sidecar, honestly fall back to rg.
 * - rg: force the rg / Node sidecar path.
 * - tantivy: request Tantivy; fall back to rg with visible degradation info.
 */
export const EXACT_PROVIDERS = ["auto", "rg", "tantivy"] as const;

export type ExactProvider = (typeof EXACT_PROVIDERS)[number];

export type RetrievalSettings = {
  tokenBudget: number;
  excludeGlobs: string[];
  exactProvider: ExactProvider;
};

const DEFAULTS: RetrievalSettings = {
  tokenBudget: DEFAULT_TOKEN_BUDGET,
  excludeGlobs: [],
  exactProvider: "auto",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unknown / legacy values (e.g. removed "zoekt") safely collapse to "auto". */
export function normalizeExactProvider(value: unknown): ExactProvider {
  return value === "rg" || value === "tantivy" || value === "auto"
    ? value
    : DEFAULTS.exactProvider;
}

/**
 * Accepts both the host document shape `{ settings: { ... }, settingsVersion }`
 * (what updateExtensionSettings writes) and the historical flat key map.
 */
function storedKeyMap(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.settings)) return raw.settings;
  return raw;
}

export async function loadRetrievalSettings(projectRoot: string): Promise<RetrievalSettings> {
  try {
    const raw = storedKeyMap(JSON.parse(await readFile(extSettingsPath(projectRoot), "utf8")));
    const budget = raw["ext.code-retrieval.tokenBudget"];
    const globs = raw["ext.code-retrieval.excludeGlobs"];
    return {
      tokenBudget:
        typeof budget === "number" && Number.isFinite(budget) && budget > 0
          ? Math.floor(budget)
          : DEFAULTS.tokenBudget,
      excludeGlobs: Array.isArray(globs)
        ? globs.filter((item): item is string => typeof item === "string")
        : DEFAULTS.excludeGlobs,
      // Removed semanticApiKey and any other unknown/legacy keys are ignored here;
      // their persisted bytes stay on disk untouched.
      exactProvider: normalizeExactProvider(raw["ext.code-retrieval.exactProvider"]),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Rough token estimate used for the read_spans budget (chars/4). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
