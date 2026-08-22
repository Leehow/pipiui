/*
 * fold-ladder.ts — the discrete fold ladder: the folding policy.
 *
 * Deterministic observation masking at DISCRETE fold events rather than continuous per-turn
 * folding (the published evidence says deterministic masking matches LLM summarization at lower
 * cost, and continuous folding measurably drove recall churn here). Between fold
 * events the context is append-only: any mutation of history moves bytes and invalidates the
 * provider's prompt-cache suffix, so masking is batched at chosen boundaries where that
 * invalidation is paid once, and each event's substitutions are committed by the engine as a
 * prefix-stable frozen layer whose bytes never change again.
 *
 * A fold event fires when BOTH hold:
 *   • usage ≥ the first-fold threshold (~45 % of the window; the cold branch lowers it — with no
 *     live cache read there is no prefix to protect, so fold earlier and more freely), and
 *   • the maskable mass is worth a fold (≥ step × window) — this is what spaces events: each
 *     fold must buy at least one ladder step, so a fresh fold can't re-fire on the next turn.
 * Crossing the budget cap (PipiUI defaults to min(150k, fraction × window)) is an emergency event with no minimum.
 *
 * What masks in the PipiUI build: stale tool_result blocks outside the protected tail — never
 * user intent, assistant conclusions, provider-signed thinking, or tool_call records.
 * Each masked block folds to its deterministic per-kind digest — a `{#code FOLDED}` pointer that
 * keeps risk/error lines verbatim and stays reversible via recall/unfold. Stateless across turns
 * (a pure function of the view), so resume needs no ladder state.
 */
import type { FoldCommand, FoldPolicy, PolicyHost, PolicyView, ViewBlock } from "../contract";
import { isDurableId } from "../block";

export interface LadderConfig {
	/** First fold when usage ≥ this fraction of the context window. */
	foldAt: number;
	/** A fold event must save at least this fraction of the window (spaces the events). */
	foldStep: number;
	/** First-fold threshold when the session has never observed a live cache read. */
	coldFoldAt: number;
}

export const LADDER_DEFAULTS: LadderConfig = { foldAt: 0.45, foldStep: 0.12, coldFoldAt: 0.25 };

/** PipiUI masks tool observations only; signed assistant reasoning is immutable. */
const MASKABLE_KINDS = new Set<ViewBlock["kind"]>(["tool_result"]);

export class FoldLadderPolicy implements FoldPolicy {
	readonly id: string = "fold-ladder";
	readonly label: string = "Discrete fold ladder";

	private host: PolicyHost | null = null;
	/** No live cache read observed yet (adapter feeds this from measured telemetry each turn). */
	private cold = false;

	constructor(private readonly cfg: LadderConfig = LADDER_DEFAULTS) {}

	attach(host: PolicyHost): void {
		this.host = host;
	}

	setCold(cold: boolean): void {
		this.cold = cold;
	}

	conduct(view: PolicyView): FoldCommand[] {
		const cw = view.contextWindow ?? 0;
		// Provider-anchored usage when Pi has it; the chars÷4 estimator otherwise.
		const used = view.reportedTokens ?? view.liveTokens;
		const fraction = cw > 0 ? used / cw : 0;
		const foldAt = this.cold ? Math.min(this.cfg.coldFoldAt, this.cfg.foldAt) : this.cfg.foldAt;

		const eligible = view.blocks.filter(maskable);
		let savings = 0;
		for (const b of eligible) savings += b.tokens - b.foldedTokens;

		const stepTokens = cw > 0 ? Math.floor(this.cfg.foldStep * cw) : Math.floor(this.cfg.foldStep * view.budget);
		const overCap =
			view.liveTokens > view.budget ||
			(view.reportedTokens !== undefined && view.reportedBudget !== undefined && view.reportedTokens > view.reportedBudget);
		const thresholdHit = cw > 0 && fraction >= foldAt && savings >= stepTokens;

		if (!overCap && !thresholdHit) {
			this.publishIdle(view, fraction, foldAt, savings, stepTokens);
			return [];
		}
		if (eligible.length === 0 || savings <= 0) {
			// Over cap with nothing left to mask: announce honestly (the tail/roots are the floor).
			this.publishIrreducible(view, overCap, fraction, foldAt, stepTokens);
			return [];
		}

		const trigger = overCap && !thresholdHit ? "cap" : "threshold";
		const projected = view.liveTokens - savings;
		this.host?.setStatus(
			`fold event (${trigger}): masking ${eligible.length} block${eligible.length === 1 ? "" : "s"}, ~${k(savings)} tok`,
			{
				fold_event: true,
				trigger,
				folds: eligible.length,
				tokens_saved: savings,
				live_tokens: projected,
				budget: view.budget,
				cap: view.budget,
				usage_fraction: round3(fraction),
				fold_at: round3(foldAt),
				// Post-fold position: every eligible block is in this command, so nothing maskable
				// remains until new observations land. Published so the trigger gauge stays renderable
				// on the turn a fold fires without special-casing this branch.
				maskable_tokens: 0,
				step_tokens: stepTokens,
				irreducible_floor: irreducibleFloor(view.blocks),
				over_budget: projected > view.budget,
			},
		);
		return [{ kind: "fold", ids: eligible.map((b) => b.id) }];
	}

	private publishIdle(view: PolicyView, fraction: number, foldAt: number, savings: number, stepTokens: number): void {
		// Between events the ladder is quiet; publish the position so the status command can show
		// "next fold at N %" without the engine re-deriving policy internals.
		this.host?.setStatus(null, {
			fold_event: false,
			usage_fraction: round3(fraction),
			fold_at: round3(foldAt),
			maskable_tokens: savings,
			step_tokens: stepTokens,
			live_tokens: view.liveTokens,
			budget: view.budget,
			cap: view.budget,
			over_budget: false,
			irreducible_floor: irreducibleFloor(view.blocks),
		});
	}

	private publishIrreducible(view: PolicyView, overCap: boolean, fraction: number, foldAt: number, stepTokens: number): void {
		this.host?.setStatus(
			overCap ? "OVER BUDGET: nothing left to mask (tail/roots are the floor)" : null,
			{
				fold_event: false,
				usage_fraction: round3(fraction),
				fold_at: round3(foldAt),
				maskable_tokens: 0,
				step_tokens: stepTokens,
				live_tokens: view.liveTokens,
				budget: view.budget,
				cap: view.budget,
				over_budget: overCap,
				irreducible_floor: irreducibleFloor(view.blocks),
			},
		);
	}
}

function maskable(b: ViewBlock): boolean {
	return (
		MASKABLE_KINDS.has(b.kind) &&
		isDurableId(b.id) &&
		!b.protected &&
		!b.held &&
		!b.frozen &&
		b.foldedTokens < b.tokens
	);
}

/** Full-token sum of everything the ladder never masks (user + protected tail + held). */
function irreducibleFloor(blocks: ViewBlock[]): number {
	let n = 0;
	for (const b of blocks) if (b.kind === "user" || b.protected || b.held) n += b.tokens;
	return n;
}

function k(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function round3(x: number): number {
	return Math.round(x * 1000) / 1000;
}
