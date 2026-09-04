/**
 * Fork policy: who may be started from a copy of the Boss's own conversation.
 *
 * An ordinary dispatch starts cold, so everything the worker knows about the goal has to be
 * reconstructed in the brief. That reconstruction is where intent is lost — the Boss writes a
 * summary of what it understands, and the worker acts on a summary of that summary. A fork
 * removes the boundary instead of trying to write across it: pi copies the session's entries
 * into a new session file (`--fork`), so the child opens having already read what the Boss
 * read, and the brief becomes a directive rather than a briefing.
 *
 * Three rules make the difference between that being cheap and being waste:
 *
 * 1. **Same model as the Boss.** A fork's value is the shared prefix, and a shared prefix is
 *    only cheap while it is a cache hit. Sending a copy of the Boss's context to a different
 *    model pays full price for every token of it. So a fork always runs the Boss's model, and
 *    an explicit conflicting `model` pin is rejected rather than silently overridden — a
 *    dispatch that quietly costs ten times what the caller expected is worse than an error.
 *
 * 2. **Never for a role whose value is the cold start.** `reviewer` exists to answer "is this
 *    the right change" without having been persuaded by the reasoning that produced it; a
 *    reviewer holding the Boss's context inherits the Boss's misreading and returns it as
 *    independent confirmation. `explore` exists to sweep ground at the cheap tier; forking it
 *    would both move it onto the Boss's model and hand it the context it was dispatched to go
 *    out and find. For those roles a cold start is the deliverable, not a limitation.
 *
 * 3. **Boss only.** The philosophy that decides when to fork is main-scoped, and a nested
 *    worker forking its own conversation into a grandchild multiplies context rather than
 *    handing it over. Depth > 0 is refused.
 *
 * The worktree, branch, merge, verify and reporting paths are untouched: a forked worker is an
 * ordinary worker that happens to start with a conversation.
 */

/** Roles whose deliverable depends on not having seen the Boss's reasoning. */
export const COLD_START_ONLY_AGENTS: readonly string[] = Object.freeze([
	"reviewer",
	"explore",
	"plan",
	"secretary",
]);

export interface ForkRequest {
	/** Whether the caller asked for a fork on this dispatch. */
	fork?: boolean;
	/** Dispatched agent name, as resolved from the roster. */
	agentName: string;
	/** True when the agent definition declares a read-only role. */
	readOnly: boolean;
	/** Dispatch depth; only the Boss (0) may fork. */
	depth: number;
	/** Raw per-dispatch model pin the caller supplied, if any. */
	modelPin?: string;
	/** The Boss's own model as `provider/id`, when it could be resolved. */
	bossModel?: string;
	/** Absolute path of the Boss's live session file, when the host could resolve one. */
	sessionFile?: string;
	/** True when this agentId already has a stored conversation this dispatch would reopen. */
	resuming?: boolean;
}

export type ForkDecision =
	| { fork: false; reason?: undefined }
	| { fork: false; reason: string }
	| { fork: true; sourcePath: string; model: string | undefined };

/**
 * Resolve one dispatch's fork request. A refusal carries the message the tool returns to the
 * model, phrased so the obvious next dispatch is the correct one; `{ fork: false }` with no
 * reason simply means nothing was asked for.
 */
export function resolveFork(input: ForkRequest): ForkDecision {
	if (input.fork !== true) return { fork: false };

	// Continuity outranks forking. A worker being re-dispatched by name already holds the
	// context it built writing the code, which is strictly better for round two than a copy of
	// the Boss's. pi would also refuse the argv pair outright (`--fork` mints a new session and
	// rejects a colliding `--session-id`), so treating this as a silent no-op keeps an ordinary
	// resume from failing on a flag that no longer applies to it.
	if (input.resuming) return { fork: false };

	if (input.depth > 0) {
		return {
			fork: false,
			reason:
				`[fork_depth] fork is available to the Boss only (depth ${input.depth} requested it). ` +
				"A nested worker hands work on with a complete brief, not with a copy of its own conversation.",
		};
	}

	if (input.readOnly || COLD_START_ONLY_AGENTS.includes(input.agentName)) {
		return {
			fork: false,
			reason:
				`[fork_cold_role] "${input.agentName}" is a cold-start role and cannot be forked. ` +
				"Its value is that it has not seen your reasoning — a forked reviewer confirms your own " +
				"misreading, and a forked explore is handed the context it was sent to go find. " +
				"Dispatch it normally with a brief that names what to examine.",
		};
	}

	if (input.modelPin && input.bossModel && input.modelPin.trim() !== input.bossModel.trim()) {
		return {
			fork: false,
			reason:
				`[fork_model_conflict] a fork runs your own model (${input.bossModel}) so the copied ` +
				`context stays a cache hit; this dispatch pins "${input.modelPin}". Drop the model pin to ` +
				"fork, or drop fork to use that model with an ordinary cold dispatch and a full brief.",
		};
	}

	const source = input.sessionFile?.trim();
	if (!source) {
		return {
			fork: false,
			reason:
				"[fork_no_session] this session has no resolvable session file to fork from " +
				"(an ephemeral or in-memory session). Dispatch normally with a complete brief.",
		};
	}

	return { fork: true, sourcePath: source, model: input.bossModel };
}

/**
 * The `--fork <source>` argv for a resolved fork. Composes with the `--session-id` /
 * `--session-dir` pair the dispatcher already passes: pi treats the id as the *new* session's
 * id and refuses a collision, so a forked re-dispatch of an existing agentId is rejected by pi
 * rather than silently branching a second copy.
 */
export function forkSpawnArgs(decision: ForkDecision): string[] {
	return decision.fork ? ["--fork", decision.sourcePath] : [];
}

/**
 * The other half of the fork decision: noticing that this dispatch wanted one.
 *
 * `resolveFork` answers a fork that was asked for. Nothing answers the far more common case —
 * the fork that should have been asked for and was not. The layer's own test for that is
 * "if you are writing the third paragraph of background, fork instead", which is a real test
 * the Boss cannot apply to itself: at the moment it is writing paragraph three it is thinking
 * about the content, not about the boundary it is paying to write across.
 *
 * Brief length alone is the wrong measure, and getting this wrong would be actively harmful:
 * a long implementation brief dense with `file.ts:120-168` anchors is exactly the good cold
 * brief the layer asks for, and nudging it toward a fork would trade a precise cheap worker
 * for an expensive vague one. What distinguishes reconstruction from a directive is not size
 * but what the size is made of — background prose carries almost no anchors, because the code
 * has not been located yet or the point is what the user wants rather than where the code is.
 *
 * So: long, and thin on anchors. That is the shape of a brief restating a conversation, and
 * a fork hands that conversation over for the price of a cache hit instead.
 */

/**
 * Two thresholds, because anchors and length are not independent evidence.
 *
 * The first cut used one length (2000 chars) with an anchor ceiling, and three real sessions
 * showed why that misses: the same Boss, given the same background-heavy request, wrote briefs
 * of 2280, 1802 and 864 characters. All three named zero or one file. Only the first cleared
 * 2000, so the check fired on a third of the cases it was built for — and the 864-char one was
 * the *clearest* reconstruction of the three, a page of the user's trade-offs with no code in
 * it at all.
 *
 * What that says is that length was standing in for the wrong thing. A brief naming NO file has
 * not located the code, so whatever its size it is carrying intent rather than instructions,
 * and a fork carries intent better than any restatement — the length floor there only needs to
 * exclude a genuine one-liner. A brief naming one or two files has started to locate the work,
 * so it takes real bulk before the prose outweighs the anchors.
 *
 * Calibrated on three samples from one model on one shape of task. Both numbers are a judgement
 * about where prose stops being a directive, not a measurement of anything fundamental.
 */

/** Floor for a brief that names no file at all: enough to exclude a one-line directive. */
export const FORK_NUDGE_MIN_BRIEF_CHARS = 700;

/** Floor for a brief that has begun naming files: bulk must outweigh the anchors. */
export const FORK_NUDGE_ANCHORED_MIN_BRIEF_CHARS = 2_000;

/** Above this many distinct file anchors, the brief is located code, never a fork candidate. */
export const FORK_NUDGE_MAX_ANCHORS = 2;

export interface ForkOpportunityInput {
	/** Whether the caller already asked for a fork on this dispatch. */
	fork?: boolean;
	agentId: string;
	agentName: string;
	readOnly: boolean;
	depth: number;
	/** True when this dispatch reopens a stored conversation — it already has continuity. */
	resuming?: boolean;
	/** The brief as written. */
	brief: string;
	/** Distinct path anchors the brief names, measured by the continuity check. */
	anchorCount: number;
	/** Absent when this session has no forkable session file; then there is nothing to advise. */
	sessionFile?: string;
}

export interface ForkOpportunity {
	agentId: string;
	briefChars: number;
	anchorCount: number;
}

/** The dispatches where a fork was available, unasked for, and probably right. */
export function detectForkOpportunity(input: ForkOpportunityInput): ForkOpportunity | undefined {
	if (input.fork === true) return undefined;
	if (input.resuming) return undefined;
	if (input.depth > 0) return undefined;
	if (input.readOnly || COLD_START_ONLY_AGENTS.includes(input.agentName)) return undefined;
	if (!input.sessionFile?.trim()) return undefined;
	if (input.anchorCount > FORK_NUDGE_MAX_ANCHORS) return undefined;
	const briefChars = input.brief.trim().length;
	const floor = input.anchorCount === 0
		? FORK_NUDGE_MIN_BRIEF_CHARS
		: FORK_NUDGE_ANCHORED_MIN_BRIEF_CHARS;
	if (briefChars < floor) return undefined;
	return { agentId: input.agentId, briefChars, anchorCount: input.anchorCount };
}

export function formatForkOpportunityAdvisory(opportunities: readonly ForkOpportunity[]): string {
	if (opportunities.length === 0) return "";
	const blocks = opportunities.map((o) => [
		`[fork-available] \`${o.agentId}\` is a cold dispatch carrying ${o.briefChars} chars of brief naming ${o.anchorCount} file path(s). Length without anchors is restated background — the reconstruction a fork removes.`,
		"`fork: true` starts this worker from a copy of THIS conversation: it has already read what you read and heard what the user asked, so the brief becomes a directive (what to do) instead of a briefing (what the situation is). It runs on your model against the cached prefix and lands in its own worktree like any other worker.",
		// Same failure the continuity line had: this arrives on the acceptance receipt, so the
		// worker is already running when it is read. A measured session answered it with "取舍
		// 已完整写进 brief" and waited — treating "I already wrote the brief" as the reason not
		// to act, when the length of that brief is the entire finding. Name the escape.
		`\`${o.agentId}\` has only just started and has produced nothing, so switching now is cheap: subagent_abort({agentId:"${o.agentId}", runId}) with the runId below, then re-dispatch the same agentId with fork: true and a short directive instead of the ${o.briefChars}-char restatement. "The brief is already written" is not a reason to keep it — its size is what this line is about.`,
		"Send it cold only if the brief is genuinely complete without your session's context — a precise, anchored brief is still the cheaper worker.",
	].join("\n"));
	return blocks.join("\n\n");
}
