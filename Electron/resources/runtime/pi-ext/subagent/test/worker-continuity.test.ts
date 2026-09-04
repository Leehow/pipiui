/**
 * Continuity routing: does a new dispatch get told which finished worker already owns this ground?
 *
 * The defect being guarded is not a crash — it is silence. Every observed session that sent a
 * second task into a file some earlier worker had just rewritten did so with a fresh agentId and
 * an empty head, because nothing at composition time said otherwise. So these tests are mostly
 * about the advisory firing on real evidence and staying quiet on everything else: a false
 * positive here is a line the Boss learns to skip, which costs more than the miss it prevented.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	CONTINUITY_MAX_AGE_MS,
	ContinuityAdvisoryLedger,
	detectContinuityTarget,
	detectFindingsHandoff,
	extractPathAnchors,
	formatContinuityAdvisory,
	formatFindingsHandoffAdvisory,
	summarizeFindingsHead,
	type ContinuityPrior,
} from "../worker-continuity.ts";

const prior = (over: Partial<ContinuityPrior> = {}): ContinuityPrior => ({
	agentId: "quota-pill",
	agentName: "general-purpose",
	state: "done",
	anchors: ["packages/ui/src/QuotaPill.tsx", "packages/ui/src/store.ts"],
	ageMs: 10 * 60_000,
	readOnly: false,
	...over,
});

const candidate = (brief: string, over: Record<string, unknown> = {}) => ({
	agentId: "pill-width",
	agentName: "general-purpose",
	brief,
	readOnly: false,
	known: false,
	...over,
});

describe("extractPathAnchors", () => {
	it("takes paths and normalizes the ways a brief writes them", () => {
		const anchors = extractPathAnchors(
			"see `packages/ui/src/store.ts:120-168` and ./packages/ui/src/QuotaPill.tsx, plus packages/ui/src/store.ts again.",
		);
		assert.deepEqual(anchors, ["packages/ui/src/store.ts", "packages/ui/src/QuotaPill.tsx"]);
	});

	it("leaves prose that merely contains dots alone", () => {
		assert.deepEqual(extractPathAnchors("e.g. version v1.2 of the module, i.e. the new one."), []);
	});

	it("ignores a bare filename with no directory — it cannot identify a file", () => {
		assert.deepEqual(extractPathAnchors("open store.ts and fix it"), []);
	});
});

describe("detectContinuityTarget", () => {
	it("names the finished worker whose report covers the files this brief names", () => {
		const match = detectContinuityTarget(
			candidate("Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts` so the pill wraps."),
			[prior({ findingsFile: "/repo/.pi/findings/quota-pill.md" })],
		);
		assert.equal(match?.priorAgentId, "quota-pill");
		assert.equal(match?.sharedAnchors.length, 2);
		assert.equal(match?.findingsFile, "/repo/.pi/findings/quota-pill.md");
	});

	it("stays quiet on a single shared file — one path in common is a coincidence", () => {
		const match = detectContinuityTarget(
			candidate("Change `packages/ui/src/store.ts` only."),
			[prior()],
		);
		assert.equal(match, undefined);
	});

	it("fires on declared scope overlap even when no brief names a file", () => {
		const match = detectContinuityTarget(
			candidate("Finish the sidebar work.", { scope: ["packages/ui/src/session/"] }),
			[prior({ anchors: [], scope: ["packages/ui/src/session/store.ts"] })],
		);
		assert.equal(match?.priorAgentId, "quota-pill");
		assert.deepEqual(match?.scopeOverlap, ["packages/ui/src/session/store.ts"]);
	});

	it("never proposes continuing a live worker — that is the overlap warning's job", () => {
		const match = detectContinuityTarget(
			candidate("Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts`."),
			[prior({ state: "running" })],
		);
		assert.equal(match, undefined);
	});

	it("never proposes continuing a cold-start role, on either side", () => {
		const brief = "Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts`.";
		assert.equal(detectContinuityTarget(candidate(brief), [prior({ readOnly: true })]), undefined);
		assert.equal(detectContinuityTarget(candidate(brief, { readOnly: true }), [prior()]), undefined);
	});

	it("says nothing to a dispatch that is already a continuation", () => {
		const brief = "Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts`.";
		assert.equal(detectContinuityTarget(candidate(brief, { known: true }), [prior()]), undefined);
		// …including the degenerate case of the prior being this same id.
		assert.equal(
			detectContinuityTarget(candidate(brief, { agentId: "quota-pill" }), [prior()]),
			undefined,
		);
	});

	it("drops evidence old enough to describe a different tree", () => {
		const match = detectContinuityTarget(
			candidate("Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts`."),
			[prior({ ageMs: CONTINUITY_MAX_AGE_MS + 1 })],
		);
		assert.equal(match, undefined);
	});

	it("picks the prior with the most shared files, not the first one seen", () => {
		const match = detectContinuityTarget(
			candidate("Touch `a/one.ts`, `a/two.ts` and `a/three.ts`."),
			[
				prior({ agentId: "weak", anchors: ["a/one.ts", "a/two.ts"] }),
				prior({ agentId: "strong", anchors: ["a/one.ts", "a/two.ts", "a/three.ts"] }),
			],
		);
		assert.equal(match?.priorAgentId, "strong");
	});
});

describe("formatContinuityAdvisory", () => {
	it("names the exact move and the escape, and is empty when there is nothing to say", () => {
		assert.equal(formatContinuityAdvisory([]), "");
		const text = formatContinuityAdvisory([
			{
				candidateAgentId: "pill-width",
				priorAgentId: "quota-pill",
				priorAgentName: "general-purpose",
				sharedAnchors: ["packages/ui/src/store.ts", "packages/ui/src/QuotaPill.tsx"],
				scopeOverlap: [],
				findingsFile: "/repo/.pi/findings/quota-pill.md",
				ageMs: 12 * 60_000,
			},
		]);
		assert.match(text, /\[worker-continuity\]/);
		assert.match(text, /`quota-pill`/);
		assert.match(text, /pipiui\/quota-pill/);
		assert.match(text, /12m ago/);
		// The line lands after acceptance, so it must name the escape from a running dispatch;
		// without it a real session read the advisory as "too late" and let the cold worker run.
		assert.match(text, /subagent_abort/);
		// The fallback when the Boss keeps the new id is the findings handoff, not silence.
		assert.match(text, /\/repo\/\.pi\/findings\/quota-pill\.md/);
	});
});

describe("summarizeFindingsHead", () => {
	it("reads the role and the anchors out of a runtime-written report header", () => {
		const head = [
			"# Quota pill",
			"",
			"- agent: `general-purpose` (agentId `quota-pill`, run `r1`)",
			"- written: 2026-09-03T00:00Z",
			"",
			"## Files Changed",
			"- `packages/ui/src/QuotaPill.tsx` - wraps",
		].join("\n");
		const summary = summarizeFindingsHead(head);
		assert.equal(summary.agentName, "general-purpose");
		assert.deepEqual(summary.anchors, ["packages/ui/src/QuotaPill.tsx"]);
	});

	it("is empty rather than throwing when there is no head to read", () => {
		assert.deepEqual(summarizeFindingsHead(undefined), { anchors: [] });
	});
});


describe("detectFindingsHandoff", () => {
	const explored = (over: Partial<ContinuityPrior> = {}): ContinuityPrior => prior({
		agentId: "pill-recon",
		agentName: "explore",
		readOnly: true,
		findingsFile: "/repo/.pi/findings/pill-recon.md",
		...over,
	});

	it("catches the explore report a cold implementation brief forgot to name", () => {
		const handoff = detectFindingsHandoff(
			candidate("Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts` so the pill wraps."),
			[explored()],
		);
		assert.equal(handoff?.priorAgentId, "pill-recon");
		assert.equal(handoff?.findingsFile, "/repo/.pi/findings/pill-recon.md");
		assert.equal(handoff?.sharedAnchors.length, 2);
	});

	it("says nothing when the brief already names the report, by path or by file name", () => {
		const brief = "Read `%s` first. Then change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts`.";
		assert.equal(
			detectFindingsHandoff(candidate(brief.replace("%s", "/repo/.pi/findings/pill-recon.md")), [explored()]),
			undefined,
		);
		assert.equal(
			detectFindingsHandoff(candidate(brief.replace("%s", "pill-recon.md")), [explored()]),
			undefined,
		);
	});

	it("does not repeat a report the continuity line already named", () => {
		const brief = "Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts`.";
		const writable = prior({ findingsFile: "/repo/.pi/findings/quota-pill.md" });
		assert.equal(detectFindingsHandoff(candidate(brief), [writable])?.priorAgentId, "quota-pill");
		assert.equal(
			detectFindingsHandoff(candidate(brief), [writable], new Set(["quota-pill"])),
			undefined,
		);
	});

	it("needs a report on disk, and a brief that names files at all", () => {
		const brief = "Change `packages/ui/src/QuotaPill.tsx` and `packages/ui/src/store.ts`.";
		assert.equal(detectFindingsHandoff(candidate(brief), [explored({ findingsFile: undefined })]), undefined);
		assert.equal(detectFindingsHandoff(candidate("just fix the pill"), [explored()]), undefined);
	});
});

describe("formatFindingsHandoffAdvisory", () => {
	it("gives the Boss the exact line to paste, and nothing when there is no report", () => {
		assert.equal(formatFindingsHandoffAdvisory([]), "");
		const text = formatFindingsHandoffAdvisory([
			{
				candidateAgentId: "pill-width",
				priorAgentId: "pill-recon",
				priorAgentName: "explore",
				findingsFile: "/repo/.pi/findings/pill-recon.md",
				sharedAnchors: ["packages/ui/src/store.ts", "packages/ui/src/QuotaPill.tsx"],
				ageMs: 4 * 60_000,
			},
		]);
		assert.match(text, /\[findings-available\]/);
		assert.match(text, /read `\/repo\/\.pi\/findings\/pill-recon\.md` first/);
		assert.match(text, /do not re-explore/);
	});
});


describe("ContinuityAdvisoryLedger", () => {
	it("states a pair once and refuses the mirror image", () => {
		const ledger = new ContinuityAdvisoryLedger();
		assert.equal(ledger.claim("quota-pill", "pill-fix"), true);
		assert.equal(ledger.claim("quota-pill", "pill-fix"), false);
		// The observed bounce: take the advice, and the old id now has a report of its own.
		assert.equal(ledger.claim("pill-fix", "quota-pill"), false);
	});

	it("refuses a fresh name pointed at an already-mentioned worker", () => {
		const ledger = new ContinuityAdvisoryLedger();
		assert.equal(ledger.claim("quota-pill", "pill-fix"), true);
		// Keying by pair was not enough: the Boss's answer to the advice was to mint another
		// name, and `pill-minw` / `pill-mw2` each formed a new pair with the same prior.
		assert.equal(ledger.claim("pill-minw", "pill-fix"), false);
		assert.equal(ledger.claim("pill-mw2", "pill-fix"), false);
		// A mentioned id is also silent as the prior of some third worker.
		assert.equal(ledger.claim("something-new", "quota-pill"), false);
	});

	it("keeps genuinely unrelated workers independent, and resets", () => {
		const ledger = new ContinuityAdvisoryLedger();
		assert.equal(ledger.claim("a", "b"), true);
		assert.equal(ledger.claim("c", "d"), true);
		ledger.reset();
		assert.equal(ledger.claim("a", "b"), true);
	});
});
