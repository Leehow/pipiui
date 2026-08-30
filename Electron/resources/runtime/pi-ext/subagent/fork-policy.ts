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
