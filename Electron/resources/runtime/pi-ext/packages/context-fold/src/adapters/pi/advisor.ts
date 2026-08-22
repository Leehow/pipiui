/*
 * advisor.ts — cold-session detection + the price-agnostic reset yellow flag.
 *
 * All math is in INPUT-TOKEN EQUIVALENTS, never dollars: fee ratios are near-constant across
 * vendors and tiers (cache_read ≈ 0.1× input; cache_write ≈ 1.25×), so the same arithmetic holds
 * at any price level and tracks rate-limit consumption under subscription quota:
 *
 *   warm carry per turn ≈ 0.1 × carried      cold carry per turn ≈ carried
 *   reconstruction ≈ handoff + index + a few re-reads ≈ reconTokens (default 18k; set
 *   CONTEXTFOLD_RECON_TOKENS to a measured cost where one is known)
 *   payback(reset) ≈ recon / (0.1 × (carried − recon)) warm turns
 *
 * ADVISORY ONLY: flags surface in the status command and as one stderr line; nothing here blocks
 * or gates a turn. Pure and fully unit-testable — no Pi imports, no clock, no env.
 */

export interface AdvisorInput {
	/** Assistant turns with recorded usage so far. */
	turns: number;
	/** Any non-zero cache read observed this session (measured, not assumed). */
	everWarm: boolean;
	/** Last turn's provider usage. */
	lastCacheRead: number;
	lastInput: number;
	/** True when the latest response followed a context-fold prefix rewrite. */
	lastTurnAfterFold: boolean;
	/** Current carried context in tokens (provider-anchored when available), or null unknown. */
	carriedTokens: number | null;
	contextWindow: number | null;
	/** Full-token weight of what folding can never touch (user + tail + held), or null unknown. */
	irreducibleFloor: number | null;
	/** Reconstruction cost estimate for a fresh session (input-token equivalents). */
	reconTokens: number;
	/** Recall-churn accounting from the engine. */
	recallCalls: number;
	maxRecallsPerCode: number;
	/** Hard compaction events observed this session. */
	compactions: number;
	/** Fold events whose rewrite provably never reached the provider (see CacheTelemetry). */
	wireDeferredFolds: number;
}

export interface Advisory {
	/** The session looks cold RIGHT NOW (expected-warm turn read zero cached tokens). */
	coldNow: boolean;
	/** ~Warm turns for a reset to pay for itself, or null when carried context is too small to matter. */
	paybackTurns: number | null;
	/** Yellow-flag lines, strongest first. Empty = no advisory. */
	flags: string[];
}

/** Context small enough that reset economics are noise. */
const CARRY_FLOOR = 30_000;
/** A cold re-prefill this large is worth telling the user about. */
const COLD_NOTIFY_INPUT = 20_000;
const RECALL_CALLS_CHURN = 10;
const RECALL_PER_CODE_CHURN = 3;

export function advise(i: AdvisorInput): Advisory {
	const carried = i.carriedTokens ?? 0;
	// Cold = a turn that SHOULD have hit the cache read nothing. Turn 1 is always a prefill;
	// a session that has never been warm (org/provider without caching) is cold by definition.
	const coldNow =
		!i.lastTurnAfterFold &&
		i.turns >= 2 &&
		i.lastCacheRead === 0 &&
		(i.lastInput >= COLD_NOTIFY_INPUT || carried >= CARRY_FLOOR || !i.everWarm);

	const paybackTurns =
		carried > i.reconTokens + CARRY_FLOOR / 2
			? round1(i.reconTokens / (0.1 * (carried - i.reconTokens)))
			: null;

	const flags: string[] = [];
	if (i.wireDeferredFolds > 0) {
		flags.push(
			`${i.wireDeferredFolds} fold${i.wireDeferredFolds === 1 ? "" : "s"} committed but not observed on the wire — another extension or the transport is bypassing them (with pi-codex-conversion, folds land only at the next user turn)`,
		);
	}
	if (i.compactions >= 2) {
		flags.push(`second forced compaction this session — strongly recommend a fresh session (reconstruction ≈ ${k(i.reconTokens)} tok via the seed index)`);
	}
	if (i.contextWindow && i.irreducibleFloor !== null && i.irreducibleFloor > 0.5 * i.contextWindow) {
		flags.push(
			`irreducible context (${k(i.irreducibleFloor)} tok) exceeds half the window — folding can't help further; start fresh at the next task boundary`,
		);
	}
	if (coldNow && carried >= CARRY_FLOOR) {
		flags.push(
			`session is cold with ~${k(carried)} tok carried — next turn re-bills it all anyway, so a reset is economically free right now`,
		);
	}
	if (i.recallCalls >= RECALL_CALLS_CHURN || i.maxRecallsPerCode >= RECALL_PER_CODE_CHURN) {
		flags.push(
			`recall churn (${i.recallCalls} calls${i.maxRecallsPerCode >= RECALL_PER_CODE_CHURN ? `, one code ×${i.maxRecallsPerCode}` : ""}) — unfold the hot blocks, or hand off to a fresh session`,
		);
	}
	if (flags.length === 0 && paybackTurns !== null && paybackTurns <= 2 && carried > 0.6 * (i.contextWindow ?? Infinity)) {
		flags.push(`carrying ~${k(carried)} tok — a reset would pay for itself in ~${paybackTurns} warm turns`);
	}
	return { coldNow, paybackTurns, flags };
}

function k(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

function round1(x: number): number {
	return Math.round(x * 10) / 10;
}
