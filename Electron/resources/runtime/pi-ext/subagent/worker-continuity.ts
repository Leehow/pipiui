/**
 * Routing a new task to the worker that already owns the ground.
 *
 * Re-dispatching an `agentId` continues that worker: same conversation, same worktree, same
 * branch. The orchestration layer asks for exactly that ("keep one named worker for a whole
 * vertical slice"), and the runtime has supported it since the id became mandatory. What has
 * never existed is the moment where the Boss is *shown* that a prior worker fits — so the rule
 * only fires when the Boss happens to remember, several turns and possibly one compaction
 * after the completion that would have made it obvious. What it does instead is mint a fresh
 * semantic name, which is the cheap and natural move at composition time, and the system pays
 * a cold start plus a re-derivation of what the old worker already knows.
 *
 * The fix is not another standing rule. It is to measure the thing at the one moment it is
 * cheap to measure — dispatch acceptance, where both briefs exist — and say it there, in the
 * same advisory shape as `[subagent-overlap]` and `[plan-drift]`: never blocking, always
 * naming the exact next move.
 *
 * ## What counts as "the same ground"
 *
 * Deliberately not a judgement about topics. Two mechanical signals only:
 *
 * 1. **Shared file anchors.** Briefs and reports name paths — that is what the whole
 *    findings-artifact contract is for. The intersection of the paths a new brief names with
 *    the paths a prior worker's report named is evidence that survives rewording, and it is
 *    evidence the runtime already holds on disk.
 * 2. **Declared scope overlap.** The same path-prefix relation `[subagent-overlap]` uses for
 *    concurrent writers, applied to a worker that has already finished.
 *
 * There is no keyword table and no topic classifier here, because there cannot be a correct
 * one: "is this the same work" is a semantic question, and a list of words guessing at it
 * would be wrong in both directions. A shared path is a fact.
 *
 * ## What is deliberately excluded
 *
 * - **Running priors.** A live worker overlapping this dispatch is the collision `[subagent-overlap]`
 *   already reports, and its advice is the opposite one (decompose, do not merge).
 * - **Read-only roles, on either side.** `explore` / `reviewer` / `plan` are cold by design —
 *   fork-policy refuses to warm them for the same reason. Their reports are handed forward as
 *   files, which is a different move and gets a different sentence.
 * - **Ids the runtime already knows.** A dispatch naming an existing id *is* the continuation;
 *   advising it to continue would be noise.
 */

import { cleanScope, pathsOverlap } from "./scope-overlap.ts";

/**
 * A path-shaped token: at least one `/`, and an extension. Both halves matter — requiring the
 * slash keeps ordinary prose words with a dot out (`e.g.`, `v1.2`), and requiring the extension
 * keeps bare directory mentions from matching everything under them by accident.
 *
 * `file.ts:120-168` is the anchor format the explore template asks for, so the line/range
 * suffix is trimmed rather than treated as part of the path.
 */
const PATH_ANCHOR_RE = /[A-Za-z0-9_.@-]*(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]{1,6}/g;

/** Beyond this a brief is quoting a file listing, not naming its scope; the tail adds noise. */
export const MAX_ANCHORS_PER_TEXT = 120;

/** Report head scanned for anchors. Worker templates put `Files Changed` / `TLDR` first. */
export const FINDINGS_ANCHOR_HEAD_CHARS = 12_000;

/** Two independent files in common is a coincidence worth one line; one is not. */
export const CONTINUITY_MIN_SHARED_ANCHORS = 2;

/** Reports older than this describe a tree that has moved on. Matches the findings index. */
export const CONTINUITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/** Paths named in the advisory before the tail collapses to a count. */
const ADVISORY_PATH_CAP = 4;

/**
 * Path anchors named in one text, normalized enough that the same file written two ways
 * intersects: `./a/b.ts`, `a/b.ts:12`, and `` `a/b.ts` `` are one anchor.
 */
export function extractPathAnchors(text: string, cap = MAX_ANCHORS_PER_TEXT): string[] {
	if (!text) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const match of text.matchAll(PATH_ANCHOR_RE)) {
		const raw = match[0].replace(/^\.\//, "").replace(/[.,;:)\]}'"`]+$/, "");
		if (!raw.includes("/")) continue;
		if (seen.has(raw)) continue;
		seen.add(raw);
		out.push(raw);
		if (out.length >= cap) break;
	}
	return out;
}

/** A worker that has already finished, as the continuity check sees it. */
export interface ContinuityPrior {
	agentId: string;
	/** Role name, for the advisory line. */
	agentName?: string;
	title?: string;
	/** Terminal state string; a running prior is excluded by the caller and here. */
	state?: string;
	/** Path anchors this worker's report (or brief) named. */
	anchors: readonly string[];
	/** Scope it declared at dispatch. */
	scope?: readonly string[];
	/** Its report on disk, when one was written. */
	findingsFile?: string;
	/** Age of the newest evidence for this worker. */
	ageMs?: number;
	/** True for `explore` / `reviewer` / `plan` — cold by design, never a continuity target. */
	readOnly?: boolean;
}

export interface ContinuityCandidate {
	agentId: string;
	agentName?: string;
	brief: string;
	scope?: readonly string[];
	readOnly: boolean;
	/** True when the runtime already knows this id — then the dispatch IS the continuation. */
	known: boolean;
}

export interface ContinuityMatch {
	candidateAgentId: string;
	priorAgentId: string;
	priorAgentName?: string;
	priorTitle?: string;
	sharedAnchors: string[];
	scopeOverlap: string[];
	findingsFile?: string;
	ageMs?: number;
}

function scopeHits(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] {
	const left = cleanScope(a as string[] | undefined);
	const right = cleanScope(b as string[] | undefined);
	if (left.length === 0 || right.length === 0) return [];
	const hits: string[] = [];
	for (const l of left) {
		for (const r of right) {
			if (pathsOverlap(l, r) && !hits.includes(r)) hits.push(r);
		}
	}
	return hits;
}

/**
 * The prior worker this dispatch most likely belongs to, or nothing.
 *
 * Ranked by shared anchors, because that is the signal that actually distinguishes two
 * candidates; a scope hit qualifies a prior but does not outrank measured file evidence.
 */
export function detectContinuityTarget(
	candidate: ContinuityCandidate,
	priors: readonly ContinuityPrior[],
): ContinuityMatch | undefined {
	// A fresh read-only dispatch is supposed to be cold, and a known id is already continuing.
	if (candidate.known || candidate.readOnly) return undefined;
	const briefAnchors = new Set(extractPathAnchors(candidate.brief));
	if (briefAnchors.size === 0 && cleanScope(candidate.scope as string[] | undefined).length === 0) {
		return undefined;
	}

	let best: ContinuityMatch | undefined;
	for (const prior of priors) {
		if (prior.agentId === candidate.agentId) continue;
		if (prior.readOnly) continue;
		// Overlap with a live worker is a decomposition problem, not a continuity one.
		if (prior.state === "running") continue;
		if (prior.ageMs !== undefined && prior.ageMs > CONTINUITY_MAX_AGE_MS) continue;

		const shared = prior.anchors.filter((anchor) => briefAnchors.has(anchor));
		const overlap = scopeHits(candidate.scope, prior.scope);
		if (shared.length < CONTINUITY_MIN_SHARED_ANCHORS && overlap.length === 0) continue;

		if (best && shared.length <= best.sharedAnchors.length) continue;
		best = {
			candidateAgentId: candidate.agentId,
			priorAgentId: prior.agentId,
			priorAgentName: prior.agentName,
			priorTitle: prior.title,
			sharedAnchors: shared,
			scopeOverlap: overlap,
			findingsFile: prior.findingsFile,
			ageMs: prior.ageMs,
		};
	}
	return best;
}

function formatAge(ageMs: number | undefined): string {
	if (ageMs === undefined) return "earlier";
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function formatPaths(paths: readonly string[]): string {
	const listed = paths.slice(0, ADVISORY_PATH_CAP).map((p) => `\`${p}\``);
	const more = paths.length > listed.length ? `, +${paths.length - listed.length} more` : "";
	return `${listed.join(", ")}${more}`;
}

function evidenceFor(match: ContinuityMatch): string {
	if (match.sharedAnchors.length > 0) {
		return `${match.sharedAnchors.length} file(s) this brief names are in its report — ${formatPaths(match.sharedAnchors)}`;
	}
	return `its declared scope covers what this brief declares — ${formatPaths(match.scopeOverlap)}`;
}

/**
 * The advisory. One line of evidence, one line naming the move, one line naming the escape —
 * the same shape as every other acceptance notice, and never a refusal: "is this the same
 * work" is the Boss's judgement, and this only supplies the fact it was missing.
 */
export function formatContinuityAdvisory(matches: readonly ContinuityMatch[]): string {
	if (matches.length === 0) return "";
	const blocks = matches.map((match) => {
		const role = match.priorAgentName ? `${match.priorAgentName}, ` : "";
		const lines = [
			`[worker-continuity] New worker \`${match.candidateAgentId}\` is being sent into ground \`${match.priorAgentId}\` (${role}ended ${formatAge(match.ageMs)}) already covered: ${evidenceFor(match)}.`,
			`Re-dispatching agentId \`${match.priorAgentId}\` continues that worker with its own conversation, worktree and branch pipiui/${match.priorAgentId} — it remembers writing this code, which is who you want changing it. A new id pays a cold start and re-derives what it already established.`,
			// This line arrives on the acceptance receipt, so the worker is already running by
			// the time it is read — and a measured session read that as "too late, let it
			// finish". It is not too late: the child has done nothing yet, and the switch is
			// two calls. Say so, or the advisory is information the Boss cannot act on.
			`\`${match.candidateAgentId}\` has only just started and has produced nothing, so switching now is cheap: subagent_abort({agentId:"${match.candidateAgentId}", runId}) with the runId below, then dispatch the same brief on agentId \`${match.priorAgentId}\`. Letting it run because it is already running is the one reading this line does not support.`,
		];
		if (match.findingsFile) {
			lines.push(
				`If \`${match.candidateAgentId}\` is genuinely different work, keep it and name \`${match.findingsFile}\` in its brief ("read this first; it is the recon for this task") so it does not re-explore that ground.`,
			);
		} else {
			lines.push(
				`If \`${match.candidateAgentId}\` is genuinely different work, keep it — this is a measurement, not a verdict.`,
			);
		}
		return lines.join("\n");
	});
	return blocks.join("\n\n");
}

/**
 * What a report on disk contributes, read once.
 *
 * Only the head is scanned: every worker template puts its decision aids first (`## TLDR`,
 * `## Files Changed`, `## Evidence index`), and a full 200k report scanned on every dispatch
 * would turn an advisory into a cost. The runtime's own header names the role that wrote it,
 * which is how a report left by a previous process still knows whether its author was a
 * cold-start role. A read that fails is simply no evidence — nothing here may stand between
 * a dispatch and its acceptance.
 */
export interface FindingsSummary {
	anchors: string[];
	/** Role name from the runtime-written header, when it is there. */
	agentName?: string;
}

const FINDINGS_AGENT_RE = /^- agent: `([^`]+)`/m;

export function summarizeFindingsHead(head: string | undefined, headChars = FINDINGS_ANCHOR_HEAD_CHARS): FindingsSummary {
	if (!head) return { anchors: [] };
	const slice = head.slice(0, headChars);
	const agentName = FINDINGS_AGENT_RE.exec(slice)?.[1]?.trim();
	return { anchors: extractPathAnchors(slice), ...(agentName ? { agentName } : {}) };
}

/**
 * The other half of the same miss: a report that exists and is not named.
 *
 * Continuity is about *who* does the next task. This is about what the Boss does with evidence
 * it already paid for. Nothing here is a pipeline: an `explore` does not hand anything to an
 * implementer, and this module never edits a brief, never forwards a report, and never routes
 * a dispatch. The Boss is the process owner — it reads, it decides, it writes the brief — and
 * the only failure this addresses is the Boss deciding without a fact it was holding.
 *
 * The fact is measurable and nothing else surfaces it. A finished report is announced once, in
 * one completion, possibly several turns and one compaction before the dispatch it matters
 * for; by then the Boss is composing a brief and thinking about the task. Read-only roles make
 * this worse, because they are never continuation targets — so an `explore` report covering
 * exactly the files the next brief names is invisible to every other check here.
 *
 * The worker's own system prompt lists the reports on disk as a last-resort safety net, but a
 * title in a list is a guess the worker has to make. What the Boss can supply instead — because
 * it, and only it, knows which report is the recon for which task — is the precise pointer. So
 * this line states the overlap and leaves the choice where it belongs: read the report and
 * decide yourself, name it in the brief, or judge it irrelevant and drop the line.
 */
export interface FindingsHandoff {
	candidateAgentId: string;
	priorAgentId: string;
	priorAgentName?: string;
	findingsFile: string;
	sharedAnchors: string[];
	ageMs?: number;
}

/** A brief that already names the file needs no advice, however it wrote the path. */
function briefNamesFile(brief: string, file: string): boolean {
	if (brief.includes(file)) return true;
	const base = file.split("/").pop();
	return base ? brief.includes(base) : false;
}

export function detectFindingsHandoff(
	candidate: ContinuityCandidate,
	priors: readonly ContinuityPrior[],
	alreadyNamed: ReadonlySet<string> = new Set(),
): FindingsHandoff | undefined {
	if (candidate.known) return undefined;
	const briefAnchors = new Set(extractPathAnchors(candidate.brief));
	if (briefAnchors.size === 0) return undefined;

	let best: FindingsHandoff | undefined;
	for (const prior of priors) {
		if (!prior.findingsFile) continue;
		if (prior.agentId === candidate.agentId) continue;
		// The continuity advisory names this worker's report itself; do not say it twice.
		if (alreadyNamed.has(prior.agentId)) continue;
		if (prior.state === "running") continue;
		if (prior.ageMs !== undefined && prior.ageMs > CONTINUITY_MAX_AGE_MS) continue;
		if (briefNamesFile(candidate.brief, prior.findingsFile)) continue;

		const shared = prior.anchors.filter((anchor) => briefAnchors.has(anchor));
		if (shared.length < CONTINUITY_MIN_SHARED_ANCHORS) continue;
		if (best && shared.length <= best.sharedAnchors.length) continue;
		best = {
			candidateAgentId: candidate.agentId,
			priorAgentId: prior.agentId,
			priorAgentName: prior.agentName,
			findingsFile: prior.findingsFile,
			sharedAnchors: shared,
			ageMs: prior.ageMs,
		};
	}
	return best;
}

export function formatFindingsHandoffAdvisory(handoffs: readonly FindingsHandoff[]): string {
	if (handoffs.length === 0) return "";
	return handoffs
		.map((h) => {
			const role = h.priorAgentName ? `\`${h.priorAgentName}\` ` : "";
			return [
				`[findings-available] \`${h.priorAgentId}\` (${role}${formatAge(h.ageMs)}) already reported on ${h.sharedAnchors.length} of the files \`${h.candidateAgentId}\`'s brief names — ${formatPaths(h.sharedAnchors)} — and that brief does not mention its report. This is a fact for your decision, not a route: nothing has been forwarded and the brief is unchanged.`,
				`\`${h.findingsFile}\` holds the file:line anchors that search already paid for. You own which way it goes: open it yourself if the next judgement is yours, or add one line to the brief — read \`${h.findingsFile}\` first; it is the recon for this task, do not re-explore — if the worker is the one who needs it. Dropping it is also a decision; without either, this worker pays for that search again.`,
			].join("\n");
		})
		.join("\n\n");
}

/**
 * Say it once per worker, because the second time it is a loop.
 *
 * Measured in a real session: the Boss dispatched `quota-pill`, took the advice, aborted it and
 * re-dispatched `pill-fix` — at which point `quota-pill` had left a report of its own, so the
 * same measurement fired in the opposite direction and sent it back. Seventy tool calls later
 * the Boss wrote, accurately, "两个 id 在互相踢皮球" (the two ids are kicking the ball back and
 * forth). Every individual advisory was true; the sequence was worthless.
 *
 * Keying that by *pair* was the obvious fix and was not enough: the Boss's response to the
 * advice was to abort and mint yet another name, so `pill-minw` and `pill-mw2` each formed a
 * fresh pair with the same prior and each earned the same line again. Three statements instead
 * of ten, still a loop.
 *
 * So the unit is the worker, not the pair. Once an id has appeared on either side of one of
 * these lines, this session says nothing further about it — the fact that ground is shared
 * between these workers has been stated, and every later phrasing of it is the same fact
 * wearing a new name. Whatever the Boss did with it is a decision; re-raising a decision is
 * not a correction, it is a loop.
 *
 * This is the status-poll guard's rule applied to a different signal: a repeat is not news.
 * Under-reporting is the deliberate side to err on — the first statement is where all the value
 * is, and the tenth is what made a measured session unusable.
 *
 * Session-scoped and in-process on purpose. A later session raising it once is right: that Boss
 * has not seen it, and nothing here is worth persisting to disk.
 */
export class ContinuityAdvisoryLedger {
	private mentioned = new Set<string>();

	/** Exposed for tests; the decision itself owns the state. */
	get size(): number {
		return this.mentioned.size;
	}

	reset(): void {
		this.mentioned.clear();
	}

	/** True only while neither worker has appeared in a continuity line this session. */
	claim(candidateAgentId: string, priorAgentId: string): boolean {
		if (this.mentioned.has(candidateAgentId) || this.mentioned.has(priorAgentId)) return false;
		this.mentioned.add(candidateAgentId);
		this.mentioned.add(priorAgentId);
		return true;
	}
}
