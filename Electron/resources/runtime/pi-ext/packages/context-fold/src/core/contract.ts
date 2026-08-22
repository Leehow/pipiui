/*
 * contract.ts — the policy ⇄ mechanism contract.
 *
 * A POLICY decides which blocks should be folded. The MECHANISM (the engine, in
 * adapters/pi/store.ts) owns everything else: reading the message array, writing the digests,
 * and keeping the result valid to send. The whole contract is one pure function:
 *
 *     conduct(view) → FoldCommand[]
 *
 * The engine hands the policy a read-only VIEW of the context; the policy replies with the
 * complete set of blocks it wants folded. The engine resets to baseline and applies that set,
 * re-checking every id against its own rules, so a policy defect can shrink or waste a fold but
 * can never corrupt the outgoing context.
 *
 * Pure, serializable data and types only — no engine or harness dependency, so a policy can be
 * unit-tested against a hand-built view.
 */

/** The block kinds, mirrored here so this contract has zero engine dependency. */
export type PolicyBlockKind = "user" | "text" | "thinking" | "tool_call" | "tool_result";

/** JSON-shaped telemetry payloads a policy may attach to display-only status. */
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };

/** One block as the policy sees it — pure serializable data. */
export interface ViewBlock {
	id: string;
	kind: PolicyBlockKind;
	turn: number;
	order: number;
	/** Token cost at full fidelity. */
	tokens: number;
	/** Token cost if folded — digest size for a foldable kind, full tokens for a non-foldable kind. */
	foldedTokens: number;
	toolName?: string;
	callId?: string;
	isError?: boolean;
	/** The agent unfolded this block; it is protected from re-folding for the rest of the session. */
	held: boolean;
	/** Currently rendered folded in the view. */
	folded: boolean;
	/**
	 * Frozen by a committed prefix-stable layer: this block's substitution bytes are fixed for the
	 * session (they extend the byte-stable head that keeps the provider's prompt cache warm).
	 * It is terminal until an explicit agent unfold deliberately breaks the prefix at one point.
	 */
	frozen?: boolean;
	/** Inside the protected working tail — the newest blocks, never folded. */
	protected: boolean;
	/** Full content. */
	text?: string;
}

/**
 * A read-only view of the context the policy reasons over. `liveTokens` is the baseline the
 * policy folds down FROM (the engine has cleared the previous pass).
 */
export interface PolicyView {
	/** Every block, in conversation order. */
	blocks: ViewBlock[];
	/** Token budget for the live context window. */
	budget: number;
	/** The model's total context window as reported by the host, or null if unknown. */
	contextWindow: number | null;
	/** Live token cost at the moment the view is built — the baseline to fold down from. */
	liveTokens: number;
	/** Pi's current usage estimate, anchored by the provider's last reported token count. */
	reportedTokens?: number;
	/** The real model-window threshold corresponding to `budgetFraction`. */
	reportedBudget?: number;
	/** Index of the first block in the protected working tail. `blocks.length` ⇒ no tail. */
	protectedFromIndex: number;
	/** The protected-tail token target driving `protectedFromIndex`. */
	protectTokens: number;
}

/**
 * Fold these blocks to their deterministic per-kind digests.
 *
 * Folding is CONTENT SUBSTITUTION, never structural removal — a block is never spliced out, only
 * its content changes, and the message count never moves. That rule makes broken states
 * unrepresentable: a tool_call/tool_result pair can never orphan.
 *
 * Each `conduct()` return is the policy's COMPLETE desired state, not a delta. `[]` means "fold
 * nothing this turn".
 */
export interface FoldCommand {
	kind: "fold";
	ids: string[];
}

/** Engine services available to a policy. */
export interface PolicyHost {
	/** Surface display-only status to the human; `null` clears the message. */
	setStatus(text: string | null, metrics?: Record<string, number | string | boolean>, details?: JSONValue): void;
}

/**
 * A context-management strategy. The engine calls `conduct()` once per model call.
 * It MUST be synchronous and must not mutate the view.
 */
export interface FoldPolicy {
	readonly id: string;
	readonly label: string;
	attach?(host: PolicyHost): void;
	conduct(view: PolicyView): FoldCommand[];
}
