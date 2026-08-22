/*
 * config.ts — CONTEXTFOLD_* env parsing. Kept import-light (no Pi types) so tests can exercise
 * the parsing without loading the extension entry point.
 */
import type { FoldConfig } from "./store";
import { LADDER_DEFAULTS, type LadderConfig } from "../../core/policy/fold-ladder";

/** How the extension answers Pi's hard compaction (`session_before_compact`). */
export type CompactMode = "det" | "native";

export interface AdapterConfig {
	ladder: LadderConfig;
	/** Reconstruction cost estimate for the reset yellow flag, in input-token equivalents. */
	reconTokens: number;
	compact: CompactMode;
}

export const ADAPTER_DEFAULTS: AdapterConfig = {
	ladder: LADDER_DEFAULTS,
	reconTokens: 18_000,
	compact: "native",
};

export function configFromEnv(): Partial<FoldConfig> {
	const cfg: Partial<FoldConfig> = {};
	const frac = Number(process.env.CONTEXTFOLD_BUDGET_FRACTION);
	if (Number.isFinite(frac) && frac > 0 && frac <= 1) cfg.budgetFraction = frac;
	const rawCap = process.env.CONTEXTFOLD_BUDGET_CAP;
	if (rawCap !== undefined) {
		const cap = rawCap === "off" ? 0 : Number(rawCap);
		if (Number.isFinite(cap) && cap >= 0) cfg.absoluteTokenCap = cap;
	}
	const tail = Number(process.env.CONTEXTFOLD_TAIL);
	if (Number.isFinite(tail) && tail >= 0) cfg.tailTarget = tail;
	if (process.env.CONTEXTFOLD_DEBUG === "1" || process.env.CONTEXTFOLD_DEBUG === "true") cfg.debug = true;
	return cfg;
}

function fracEnv(name: string, fallback: number): number {
	const n = Number(process.env[name]);
	return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

function positiveIntEnv(name: string, fallback: number, allowZero = false): number {
	const raw = process.env[name];
	if (raw === undefined || !/^(?:0|[1-9]\d*)$/.test(raw)) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) return fallback;
	return value;
}

function boolEnv(name: string, fallback: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (raw === undefined || raw === "") return fallback;
	if (raw === "0" || raw === "off" || raw === "false" || raw === "no") return false;
	if (raw === "1" || raw === "on" || raw === "true" || raw === "yes" || raw === "high") return true;
	return fallback;
}

export function adapterConfigFromEnv(): AdapterConfig {
	const ladder: LadderConfig = {
		foldAt: fracEnv("CONTEXTFOLD_FOLD_AT", LADDER_DEFAULTS.foldAt),
		foldStep: fracEnv("CONTEXTFOLD_FOLD_STEP", LADDER_DEFAULTS.foldStep),
		coldFoldAt: fracEnv("CONTEXTFOLD_COLD_FOLD_AT", LADDER_DEFAULTS.coldFoldAt),
		toolUseTrigger: positiveIntEnv("CONTEXTFOLD_TOOL_USE_TRIGGER", LADDER_DEFAULTS.toolUseTrigger),
		toolUseKeep: positiveIntEnv("CONTEXTFOLD_TOOL_USE_KEEP", LADDER_DEFAULTS.toolUseKeep, true),
		toolUseMinSavings: positiveIntEnv("CONTEXTFOLD_TOOL_USE_MIN_SAVINGS", LADDER_DEFAULTS.toolUseMinSavings),
		preferExternalized: boolEnv("CONTEXTFOLD_PREFER_EXTERNALIZED", LADDER_DEFAULTS.preferExternalized),
		externalizedWeight: positiveIntEnv("CONTEXTFOLD_EXTERNALIZED_WEIGHT", LADDER_DEFAULTS.externalizedWeight, true),
	};
	const recon = Number(process.env.CONTEXTFOLD_RECON_TOKENS);
	const reconTokens = Number.isFinite(recon) && recon > 0 ? Math.floor(recon) : ADAPTER_DEFAULTS.reconTokens;
	const compact: CompactMode = process.env.CONTEXTFOLD_COMPACT?.trim().toLowerCase() === "det" ? "det" : ADAPTER_DEFAULTS.compact;
	return { ladder, reconTokens, compact };
}
