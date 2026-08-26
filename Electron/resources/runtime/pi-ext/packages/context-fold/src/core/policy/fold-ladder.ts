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
 * What masks in the PipiUI build: stale tool_result blocks outside the protected tail, plus only
 * the arguments object of an old matched successful `subagent` call at the count boundary — never
 * user intent, assistant conclusions, provider-signed thinking, or any other tool-call field.
 * Each masked block folds to its deterministic per-kind receipt and stays reversible via
 * recall/unfold. Stateless across turns (a pure function of the view), so resume needs no ladder
 * state.
 *
 * Externalized awareness: a [subagent-done] that names an existing `.pi/findings/<agentId>.md`
 * marks the matching tool_result `externalized:true`. On a threshold event those blocks are
 * folded first (and alone, when they already buy one ladder step). No-findings sessions keep
 * the historical "fold every eligible observation" behaviour. The fold itself is unchanged —
 * still a digest pointer + spool, still recall_folded-reversible.
 */
import type { FoldCommand, FoldPolicy, PolicyHost, PolicyView, ViewBlock } from "../contract";
import { isDurableId } from "../block";
import { annotateExternalized, defaultFindingsExists } from "./externalized";

export interface LadderConfig {
	/** First fold when usage ≥ this fraction of the context window. */
	foldAt: number;
	/** A fold event must save at least this fraction of the window (spaces the events). */
	foldStep: number;
	/** First-fold threshold when the session has never observed a live cache read. */
	coldFoldAt: number;
	/** Fire a discrete fold event once this many completed eligible tool uses are live. */
	toolUseTrigger: number;
	/** Preserve the newest completed tool-use/result pairs at a count-triggered event. */
	toolUseKeep: number;
	/** Minimum estimated token savings for a count-triggered event. */
	toolUseMinSavings: number;
	/**
	 * Prefer folding tool_results whose worker findings file exists. Default true: only
	 * changes selection when a [subagent-done] names an existing file. Sessions without
	 * that evidence keep the historical fold-all-eligible behaviour.
	 */
	preferExternalized: boolean;
	/**
	 * Sort bonus for externalized candidates. 0 disables preference (fold every eligible
	 * block, original order). Default 1 = externalized first.
	 */
	externalizedWeight: number;
	/** Test/host seam: does this findings path exist? Defaults to fs.existsSync. */
	findingsExists?: (path: string) => boolean;
}

export const LADDER_DEFAULTS: LadderConfig = {
	foldAt: 0.45,
	foldStep: 0.12,
	coldFoldAt: 0.25,
	toolUseTrigger: 40,
	toolUseKeep: 12,
	toolUseMinSavings: 10_000,
	preferExternalized: true,
	externalizedWeight: 1,
};

/** Ordinary ladder sweeps mask tool observations only; signed assistant reasoning is immutable. */
const MASKABLE_KINDS = new Set<ViewBlock["kind"]>(["tool_result"]);

export class FoldLadderPolicy implements FoldPolicy {
	readonly id: string = "fold-ladder";
	readonly label: string = "Discrete fold ladder";

	private host: PolicyHost | null = null;
	/** No live cache read observed yet (adapter feeds this from measured telemetry each turn). */
	private cold = false;
	/** Shared 45% + quiet gate controls new fold events; frozen layers still render while closed. */
	private enabled = true;

	constructor(private readonly cfg: LadderConfig = LADDER_DEFAULTS) {}

	attach(host: PolicyHost): void {
		this.host = host;
	}

	setCold(cold: boolean): void {
		this.cold = cold;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	conduct(view: PolicyView): FoldCommand[] {
		const cw = view.contextWindow ?? 0;
		// Provider-anchored usage when Pi has it; the chars÷4 estimator otherwise.
		const used = view.reportedTokens ?? view.liveTokens;
		const fraction = cw > 0 ? used / cw : 0;
		const foldAt = this.cold ? Math.min(this.cfg.coldFoldAt, this.cfg.foldAt) : this.cfg.foldAt;
		if (!this.enabled) {
			this.publishIdle(view, fraction, foldAt, 0, 0);
			return [];
		}

		const blocks = annotateExternalized(view.blocks, this.cfg.findingsExists ?? defaultFindingsExists);
		const annotated: PolicyView = blocks === view.blocks ? view : { ...view, blocks };

		const superseded = this.supersededStatusCandidates(annotated);
		const countTriggered = this.countTriggeredCandidates(annotated);
		if (countTriggered.length > 0) {
			const candidates = uniqueBlocks([...countTriggered, ...superseded]);
			const savings = savedTokens(candidates);
			this.host?.setStatus(
				`fold event (tool-use-count): masking ${candidates.length} block${candidates.length === 1 ? "" : "s"}, ~${k(savings)} tok`,
				{
					fold_event: true,
					trigger: "tool-use-count",
					folds: candidates.length,
					tokens_saved: savings,
					live_tokens: view.liveTokens - savings,
					budget: view.budget,
					cap: view.budget,
					usage_fraction: round3(fraction),
					fold_at: round3(foldAt),
					maskable_tokens: 0,
					step_tokens: 0,
					irreducible_floor: irreducibleFloor(view.blocks),
					over_budget: false,
				},
			);
			return [{ kind: "fold", ids: candidates.map((b) => b.id) }];
		}
		if (superseded.length > 0) {
			const savings = savedTokens(superseded);
			this.host?.setStatus(
				`fold event (superseded): masking ${superseded.length} stale status block${superseded.length === 1 ? "" : "s"}, ~${k(savings)} tok`,
				{
					fold_event: true,
					trigger: "superseded",
					folds: superseded.length,
					tokens_saved: savings,
					live_tokens: view.liveTokens - savings,
					budget: view.budget,
					cap: view.budget,
					usage_fraction: round3(fraction),
					fold_at: round3(foldAt),
					maskable_tokens: 0,
					step_tokens: 0,
					irreducible_floor: irreducibleFloor(view.blocks),
					over_budget: false,
				},
			);
			return [{ kind: "fold", ids: superseded.map((b) => b.id) }];
		}

		const eligible = annotated.blocks.filter(maskable);
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

		const chosen = this.preferExternalized(eligible, { overCap, stepTokens });
		const chosenSavings = savedTokens(chosen);
		const trigger = overCap && !thresholdHit ? "cap" : "threshold";
		const projected = view.liveTokens - chosenSavings;
		this.host?.setStatus(
			`fold event (${trigger}): masking ${chosen.length} block${chosen.length === 1 ? "" : "s"}, ~${k(chosenSavings)} tok`,
			{
				fold_event: true,
				trigger,
				folds: chosen.length,
				tokens_saved: chosenSavings,
				live_tokens: projected,
				budget: view.budget,
				cap: view.budget,
				usage_fraction: round3(fraction),
				fold_at: round3(foldAt),
				// Remaining maskable mass after this command. 0 when every eligible block is in it
				// (the historical fold-all path); leftover when only externalized blocks were taken.
				maskable_tokens: Math.max(0, savings - chosenSavings),
				step_tokens: stepTokens,
				irreducible_floor: irreducibleFloor(annotated.blocks),
				over_budget: projected > view.budget,
			},
		);
		return [{ kind: "fold", ids: chosen.map((b) => b.id) }];
	}

	/**
	 * On a threshold event, fold already-on-disk worker results first — and only those, when they
	 * already buy one ladder step. Cap emergencies and no-findings sessions still fold every
	 * eligible block. Preference never bypasses maskable()/tail/held guards.
	 */
	private preferExternalized(eligible: ViewBlock[], opts: { overCap: boolean; stepTokens: number }): ViewBlock[] {
		const prefer = this.cfg.preferExternalized !== false;
		const weight = this.cfg.externalizedWeight ?? LADDER_DEFAULTS.externalizedWeight;
		if (!prefer || weight <= 0) return eligible;

		const externalized = eligible.filter((block) => block.externalized);
		if (externalized.length === 0) return eligible;

		const extSorted = sortByOrder(externalized);
		if (!opts.overCap && savedTokens(extSorted) >= opts.stepTokens) return extSorted;
		return [...extSorted, ...sortByOrder(eligible.filter((block) => !block.externalized))];
	}

	/** Oldest completed successful result blocks, excluding the newest configured pair count. */
	private countTriggeredCandidates(view: PolicyView): ViewBlock[] {
		const calls = new Map<string, ViewBlock>();
		for (const block of view.blocks) {
			if (block.kind === "tool_call" && block.callId && isDurableId(block.id) && !block.held && !block.frozen) {
				calls.set(block.callId, block);
			}
		}
		const completed = view.blocks
			.filter(
				(block) =>
				block.kind === "tool_result" &&
				!!block.callId &&
				calls.has(block.callId) &&
				isDurableId(block.id) &&
				!block.isError &&
				!block.held &&
				!block.frozen &&
				block.foldedTokens < block.tokens,
			)
			.map((result) => ({ result, call: calls.get(result.callId!)! }));
		if (completed.length < this.cfg.toolUseTrigger) return [];
		const keepFrom = Math.max(0, completed.length - this.cfg.toolUseKeep);
		const candidates: ViewBlock[] = [];
		for (const { call, result } of completed.slice(0, keepFrom)) {
			if (maskable(result)) candidates.push(result);
			if (argumentMaskable(call, result)) candidates.push(call);
		}
		return savedTokens(candidates) >= this.cfg.toolUseMinSavings ? candidates : [];
	}

	/** Older successful status snapshots for the exact same structured agentId + runId. */
	private supersededStatusCandidates(view: PolicyView): ViewBlock[] {
		const calls = new Map<string, ViewBlock>();
		for (const block of view.blocks) {
			if (block.kind === "tool_call" && block.callId && block.toolName === "subagent_status") calls.set(block.callId, block);
		}
		const seen = new Set<string>();
		const candidates: ViewBlock[] = [];
		for (let i = view.blocks.length - 1; i >= 0; i--) {
			const result = view.blocks[i];
			if (result.kind !== "tool_result" || !result.callId || result.isError || result.held || result.frozen) continue;
			const call = calls.get(result.callId);
			if (!call || call.held || call.frozen) continue;
			const agentId = call.toolArgs?.agentId;
			const runId = call.toolArgs?.runId;
			if (typeof agentId !== "string" || !agentId || typeof runId !== "string" || !runId) continue;
			const key = `${agentId}\u0000${runId}`;
			if (!seen.has(key)) {
				seen.add(key);
				continue;
			}
			if (maskable(result)) candidates.push(result);
		}
		return candidates.reverse();
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

function savedTokens(blocks: ViewBlock[]): number {
	let savings = 0;
	for (const block of blocks) savings += block.tokens - block.foldedTokens;
	return savings;
}

function uniqueBlocks(blocks: ViewBlock[]): ViewBlock[] {
	const seen = new Set<string>();
	return blocks.filter((block) => (seen.has(block.id) ? false : (seen.add(block.id), true)));
}

function sortByOrder(blocks: ViewBlock[]): ViewBlock[] {
	return [...blocks].sort((a, b) => a.order - b.order);
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

function argumentMaskable(call: ViewBlock, result: ViewBlock): boolean {
	return (
		call.kind === "tool_call" &&
		call.toolName === "subagent" &&
		isDurableId(call.id) &&
		!call.protected &&
		!call.held &&
		!call.frozen &&
		!result.protected &&
		!result.held &&
		!result.frozen &&
		!result.isError &&
		call.foldedTokens < call.tokens
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
