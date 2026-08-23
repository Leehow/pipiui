import { readFile } from "node:fs/promises";
import { extSettingsPath } from "./paths.js";

export const DEFAULT_TOKEN_BUDGET = 4000;

export type RetrievalSettings = {
  tokenBudget: number;
  excludeGlobs: string[];
  exactProvider: "auto" | "rg" | "zoekt" | "tantivy";
};

const DEFAULTS: RetrievalSettings = {
  tokenBudget: DEFAULT_TOKEN_BUDGET,
  excludeGlobs: [],
  exactProvider: "auto",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadRetrievalSettings(projectRoot: string): Promise<RetrievalSettings> {
  try {
    const raw = JSON.parse(await readFile(extSettingsPath(projectRoot), "utf8")) as unknown;
    if (!isRecord(raw)) return { ...DEFAULTS };
    const budget = raw["ext.code-retrieval.tokenBudget"];
    const globs = raw["ext.code-retrieval.excludeGlobs"];
    const provider = raw["ext.code-retrieval.exactProvider"];
    return {
      tokenBudget:
        typeof budget === "number" && Number.isFinite(budget) && budget > 0
          ? Math.floor(budget)
          : DEFAULTS.tokenBudget,
      excludeGlobs: Array.isArray(globs)
        ? globs.filter((item): item is string => typeof item === "string")
        : DEFAULTS.excludeGlobs,
      exactProvider:
        provider === "rg" || provider === "zoekt" || provider === "tantivy" || provider === "auto"
          ? provider
          : DEFAULTS.exactProvider,
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
