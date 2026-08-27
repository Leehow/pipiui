import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	CHECKPOINT_MAX_CHARS,
	CHECKPOINT_MAX_FILE_FAMILIES,
	CHECKPOINT_MAX_SEARCH_DIMENSIONS,
	classifyWorkerRecovery,
	hasBroadReconTrajectoryEvidence,
	extractReconFootprint,
	formatFreshEpisodeReminderLines,
	formatRecoveryReport,
	writeRecoveryCheckpoint,
	type RecoveryObservation,
} from "../recovery-classification.ts";
import { findingsPath } from "../findings-artifact.ts";

function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pipiui-recovery-"));
}

function observe(overrides: Partial<RecoveryObservation> = {}): RecoveryObservation {
	return {
		wasAborted: false,
		errorText: "",
		verifyFailure: false,
		contextTokens: 40_000,
		sameModelResumeCount: 0,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Trajectory histories feeding the poisoned-recon evidence gate
// ---------------------------------------------------------------------------

function historyOf(calls: Array<{ name: string; args?: Record<string, unknown> }>): unknown[] {
	return [
		{
			role: "assistant",
			content: calls.map((c) => ({ type: "toolCall", name: c.name, arguments: c.args ?? {} })),
		},
	];
}

/** A broad read/search sweep with zero mutations — recon-shaped by task structure. */
const RECON_HISTORY = historyOf(
	Array.from({ length: 20 }, (_, i) =>
		i % 2 === 0
			? { name: "read", args: { path: `src/f${i}.ts` } }
			: { name: "grep", args: { pattern: `q-${i}` } },
	),
);

/** An ordinary implementation slice: edits/tests present. */
const IMPLEMENTATION_HISTORY = historyOf([
	{ name: "read", args: { path: "src/a.ts" } },
	{ name: "edit", args: { path: "src/a.ts" } },
	{ name: "bash", args: { command: "npm test" } },
]);

// ---------------------------------------------------------------------------
// Classification: ordinary implementation/test failure keeps the same agent
// ---------------------------------------------------------------------------

test("ordinary verify failure routes to the SAME semantic worker slice", () => {
	const decision = classifyWorkerRecovery(
		observe({ verifyFailure: true, errorText: "verify failed: exit code 2" }),
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "verify-failure");
	const report = formatRecoveryReport({ agentId: "quota-pill", decision });
	assert.match(report, /route=continue-slice/);
	assert.match(report, /kind=verify-failure/);
	assert.match(report, /resumeAgain=true/);
	assert.match(report, /同一 agentId/);
});

test("an aborted episode is an interruption, not a failure — continuity applies", () => {
	const decision = classifyWorkerRecovery(observe({ wasAborted: true }));
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "aborted");
	assert.equal(decision.contextK, undefined);
});

test("a failure with no recognizable signature defaults to continuity, judged by the Boss", () => {
	const decision = classifyWorkerRecovery(
		observe({ errorText: "invalid api key", contextTokens: 5_000 }),
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "unclassified");
});

// ---------------------------------------------------------------------------
// Classification: provider/context-poisoned recon wants a fresh episode
// ---------------------------------------------------------------------------

test("a terminal provider-stall signature requests checkpoint plus fresh episode for recon work", () => {
	const decision = classifyWorkerRecovery(
		observe({
			errorText: "provider_stall_timeout: 等待 gpt-5 流式输出超时（连接无新增数据）…",
			sameModelResumeCount: 2,
			role: "explore",
		}),
	);
	assert.equal(decision.route, "checkpoint-fresh-episode");
	assert.equal(decision.kind, "provider-stall");
	const report = formatRecoveryReport({
		agentId: "reviewer-brief",
		runId: "run-1",
		decision,
		checkpointFile: "/proj/.pi/checkpoints/reviewer-brief.md",
	});
	// Repeated resume must never be the silently-defaulted interpretation.
	assert.match(report, /resumeAgain=false/);
	assert.match(report, /checkpoint=\/proj\/\.pi\/checkpoints\/reviewer-brief\.md/);
	assert.doesNotMatch(report, /重新派发同一 agentId|same agentId/);
	assert.match(report, /新的语义 agentId/);
});

test("broad reviewer context overflow still earns checkpoint plus fresh episode", () => {
	const decision = classifyWorkerRecovery(
		observe({ errorText: "fetch failed", contextTokens: 240_000, role: "reviewer", readOnly: true }),
	);
	assert.equal(decision.route, "checkpoint-fresh-episode");
	assert.equal(decision.kind, "context-overflow");
	assert.equal(decision.contextK, 240);
});

test("REGRESSION: an oversized ORDINARY implementation failure keeps continuity — size alone never goes fresh", () => {
	const decision = classifyWorkerRecovery(
		observe({
			errorText: "npm run build && npm test failed",
			contextTokens: 230_000,
			role: "general-purpose",
			readOnly: false,
			footprint: extractReconFootprint(IMPLEMENTATION_HISTORY),
		}),
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "context-overflow");
	assert.equal(decision.contextK, 230);
	const report = formatRecoveryReport({ agentId: "big-impl-slice", decision });
	assert.match(report, /route=continue-slice/);
	assert.match(report, /resumeAgain=true/);
	assert.doesNotMatch(report, /新的语义 agentId/);
});

test("REGRESSION: a writable episode's read-dominated mutation-free footprint supplies the recon evidence", () => {
	assert.equal(extractReconFootprint(RECON_HISTORY).mutationCalls, 0);
	const decision = classifyWorkerRecovery(
		observe({
			errorText: "fetch failed",
			contextTokens: 150_000,
			role: "general-purpose",
			readOnly: false,
			footprint: extractReconFootprint(RECON_HISTORY),
		}),
	);
	assert.equal(decision.route, "checkpoint-fresh-episode");
	assert.equal(decision.kind, "context-overflow");
});

test("the context threshold is injectable and only gates recon-evidenced routing", () => {
	const fresh = classifyWorkerRecovery(
		observe({ errorText: "boom", contextTokens: 120_000, role: "reviewer" }),
		{ contextHintTokens: 100_000 },
	);
	assert.equal(fresh.route, "checkpoint-fresh-episode");
	assert.equal(fresh.kind, "context-overflow");
	const below = classifyWorkerRecovery(
		observe({ errorText: "boom", contextTokens: 90_000, role: "reviewer" }),
		{ contextHintTokens: 100_000 },
	);
	assert.equal(below.route, "continue-slice");
});

test("with poisoned-recon evidence a stall outranks big-context attribution on the fresh route", () => {
	const decision = classifyWorkerRecovery(
		observe({ errorText: "provider stall after retries", contextTokens: 300_000, role: "explore" }),
	);
	assert.equal(decision.kind, "provider-stall");
	assert.equal(decision.route, "checkpoint-fresh-episode");
});

test("REGRESSION: a provider stall WITHOUT recon evidence fails safe to continuity, honestly labelled", () => {
	const decision = classifyWorkerRecovery(
		observe({
			errorText: "provider_stall_timeout: 等待流式输出超时（连接无新增数据）…",
			sameModelResumeCount: 2,
			role: "general-purpose",
			readOnly: false,
			footprint: extractReconFootprint(IMPLEMENTATION_HISTORY),
		}),
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "provider-stall");
	const report = formatRecoveryReport({ agentId: "stalled-impl", decision });
	assert.match(report, /route=continue-slice/);
	assert.match(report, /kind=provider-stall/);
	assert.match(report, /resumeAgain=true/);
});

test("an ordinary verify failure BELOW the context hint is never misrouted fresh by size alone", () => {
	const decision = classifyWorkerRecovery(
		observe({ verifyFailure: true, errorText: "exit code 1", contextTokens: 99_000 }),
		{ contextHintTokens: 100_000 },
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "verify-failure");
});

test("REGRESSION: a LARGE verify failure keeps the same slice — context size cannot override its cause", () => {
	const decision = classifyWorkerRecovery(
		observe({
			verifyFailure: true,
			errorText: "verify failed: exit code 1",
			contextTokens: 180_000,
			role: "general-purpose",
			readOnly: false,
			footprint: extractReconFootprint(IMPLEMENTATION_HISTORY),
		}),
		{ contextHintTokens: 100_000 },
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "verify-failure");
});

test("REGRESSION: a large verify failure with a READ-HEAVY writable footprint still keeps its slice", () => {
	// Read+search-heavy mutation-free recon evidence is NOT enough to fresh-route when the
	// death was an attestable verify failure: verify precedence beats poisoned-recon routing.
	const fp = extractReconFootprint(RECON_HISTORY);
	assert.equal(fp.mutationCalls, 0);
	assert.ok(hasBroadReconTrajectoryEvidence({ role: "general-purpose", readOnly: false, footprint: fp }));
	const decision = classifyWorkerRecovery(
		observe({
			verifyFailure: true,
			errorText: "npm run build && npm test failed",
			contextTokens: 220_000,
			role: "general-purpose",
			readOnly: false,
			footprint: fp,
		}),
		{ contextHintTokens: 100_000 },
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "verify-failure");
	const report = formatRecoveryReport({ agentId: "recon-then-fail", decision });
	assert.match(report, /route=continue-slice/);
	assert.match(report, /resumeAgain=true/);
	assert.doesNotMatch(report, /checkpoint=[^-\s]/);
});

test("REGRESSION: a provider-stall signature alongside an attestable verify failure classifies as the implementation problem", () => {
	// The verify command itself produced the attestable failure; a stall-shaped error text
	// in the same boundary must not reclassify it as a poisoned-recon provider death.
	const decision = classifyWorkerRecovery(
		observe({
			verifyFailure: true,
			errorText: "provider_stall_timeout: 等待 gpt-5 流式输出超时（连接无新增数据）… exit code 2",
			sameModelResumeCount: 2,
			contextTokens: 190_000,
			role: "explore",
		}),
		{ contextHintTokens: 100_000 },
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "verify-failure");
});

test("REGRESSION: a large ORDINARY implementation slice stays continuous even with a high read volume", () => {
	// Ten reads PLUS an edit: the mutation marks it implementation work — any observed edit
	// excludes poisoned-recon evidence no matter how read-dominated the rest of the history.
	const mixed = historyOf([
		...Array.from({ length: 10 }, (_, i) => ({ name: "read", args: { path: `src/m${i}.ts` } })),
		{ name: "edit", args: { path: "src/m0.ts" } },
	]);
	const fp = extractReconFootprint(mixed);
	assert.equal(fp.mutationCalls, 1);
	assert.equal(hasBroadReconTrajectoryEvidence({ role: "general-purpose", readOnly: false, footprint: fp }), false);
	const decision = classifyWorkerRecovery(
		observe({
			errorText: "npm run build && npm test failed",
			contextTokens: 260_000,
			role: "general-purpose",
			readOnly: false,
			footprint: fp,
		}),
		{ contextHintTokens: 100_000 },
	);
	assert.equal(decision.route, "continue-slice");
	assert.equal(decision.kind, "context-overflow");
	assert.equal(decision.contextK, 260);
});

test("REGRESSION: a TRUE reviewer context overflow (no verify) still earns checkpoint plus fresh episode", () => {
	// Poisoned-recon + non-verify context death remains the ONLY fresh shape, and this is
	// the exact observation set whose verify-flipped twin above keeps continuity.
	const base = {
		errorText: "fetch failed while reviewing",
		verifyFailure: false,
		contextTokens: 300_000,
		role: "reviewer",
	} as const;
	const decision = classifyWorkerRecovery(observe(base), { contextHintTokens: 100_000 });
	assert.equal(decision.route, "checkpoint-fresh-episode");
	assert.equal(decision.kind, "context-overflow");
	assert.equal(decision.contextK, 300);
	const report = formatRecoveryReport({ agentId: "poisoned-reviewer", runId: "run-final", decision });
	assert.match(report, /resumeAgain=false/);
	assert.match(report, /新的语义 agentId/);
	const result = writeRecoveryCheckpoint({
		mainCwd: tempRoot(),
		agentId: "poisoned-reviewer",
		decision,
		messages: SYNTHETIC_MESSAGES,
	});
	assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Observed recon footprint: the only honest input to a checkpoint
// ---------------------------------------------------------------------------

const SYNTHETIC_MESSAGES = [
	{ role: "user", content: [{ type: "text", text: "investigate" }] },
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "start broad" },
			{ type: "toolCall", name: "grep", arguments: { pattern: "quota pill render" } },
			{ type: "toolCall", name: "read", arguments: { path: "src/Sidebar.tsx" } },
			{
				type: "toolCall",
				name: "read",
				arguments: { paths: ["packages/ui/src/App.tsx", "docs/x.md"] },
			},
			{ type: "toolCall", name: "code_search", arguments: { query: "session token refresh" } },
			{ type: "text", text: "partial note before death" },
		],
	},
];

test("footprint extraction captures read targets and swept patterns from toolCall blocks", () => {
	const fp = extractReconFootprint(SYNTHETIC_MESSAGES);
	assert.ok(fp.toolCallsObserved >= 4);
	const targets = fp.fileFamilies.map((f) => f.value);
	assert.ok(targets.includes("src/Sidebar.tsx"));
	assert.ok(targets.includes("packages/ui/src/App.tsx"));
	assert.ok(fp.searchDimensions.some((s) => s.value === "quota pill render"));
	assert.ok(fp.searchDimensions.some((s) => s.value === "session token refresh"));
});

test("repeated reads are counted as strongest anchors first", () => {
	const messages = Array.from({ length: 6 }, (_, i) => ({
		role: "assistant",
		content: [
			{ type: "toolCall", name: "read", arguments: { path: i % 3 === 0 ? "a.ts" : "b.ts" } },
		],
	}));
	const fp = extractReconFootprint(messages);
	assert.equal(fp.fileFamilies[0]?.value, "b.ts");
	assert.equal(fp.fileFamilies[0]?.hits, 4);
});

test("malformed or absent history yields an EMPTY footprint, never invented state", () => {
	assert.deepEqual(extractReconFootprint([]).fileFamilies, []);
	assert.deepEqual(extractReconFootprint([{ content: "string content only" }] as never[]).searchDimensions, []);
	assert.deepEqual(extractReconFootprint([undefined, null, 42] as never[]).fileFamilies, []);
});

test("footprint extraction tracks per-call read/search/mutation family counters", () => {
	const fp = extractReconFootprint(SYNTHETIC_MESSAGES);
	assert.equal(fp.toolCallsObserved, 4);
	assert.equal(fp.readCalls, 2); // single-path read + multi-path read
	assert.equal(fp.searchCalls, 2); // grep + code_search
	assert.equal(fp.mutationCalls, 0);
	const impl = extractReconFootprint(IMPLEMENTATION_HISTORY);
	assert.equal(impl.toolCallsObserved, 3);
	assert.equal(impl.readCalls, 1);
	assert.equal(impl.searchCalls, 0);
	assert.equal(impl.mutationCalls, 1); // edit; bash is deliberately neutral
});

test("recon-trajectory gate: role/readOnly qualify directly; footprints need volume, share and zero mutations", () => {
	// A dispatched recon/review role IS broad-recon trajectory evidence on its own.
	assert.equal(hasBroadReconTrajectoryEvidence({ role: "Reviewer" }), true);
	assert.equal(hasBroadReconTrajectoryEvidence({ role: "explore" }), true);
	assert.equal(hasBroadReconTrajectoryEvidence({ readOnly: true }), true);
	// Absent role AND absent footprint: no evidence is fabricated.
	assert.equal(hasBroadReconTrajectoryEvidence({}), false);
	assert.equal(hasBroadReconTrajectoryEvidence({ role: "general-purpose", readOnly: false }), false);
	const observed = extractReconFootprint(RECON_HISTORY);
	assert.equal(observed.toolCallsObserved, 20);
	// Too few recon calls to establish a sweep shape.
	assert.equal(
		hasBroadReconTrajectoryEvidence({ footprint: { ...observed, readCalls: 2, searchCalls: 2 } }),
		false,
	);
	// Share diluted to ~50% (heavy bash usage) does not count either.
	assert.equal(
		hasBroadReconTrajectoryEvidence({ footprint: { ...observed, toolCallsObserved: 40 } }),
		false,
	);
	// Any observed mutation marks an implementation slice regardless of volume.
	assert.equal(hasBroadReconTrajectoryEvidence({ footprint: { ...observed, mutationCalls: 1 } }), false);
	// The unmodified recon footprint passes.
	assert.equal(hasBroadReconTrajectoryEvidence({ footprint: observed }), true);
});

// ---------------------------------------------------------------------------
// Checkpoint artifact: bounded, evidence-derived, deterministic name
// ---------------------------------------------------------------------------

function seedFindings(root: string, agentId: string): string {
	return writeFindingsFile(root, agentId, "# prior recon\n## TLDR\nSidebar.tsx:120 renders it.");
}

function writeFindingsFile(root: string, agentId: string, text: string): string {
	const file = findingsPath(root, agentId)!;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text, "utf-8");
	return file;
}

test("a context-poisoned boundary writes .pi/checkpoints/<agentId>.md from observed evidence", () => {
	const root = tempRoot();
	const findings = seedFindings(root, "poisoned-recon");
	const result = writeRecoveryCheckpoint({
		mainCwd: root,
		agentId: "poisoned-recon",
		runId: "mtbrun-1",
		task: "Review retrieval routing across runtime layers.",
		decision: { route: "checkpoint-fresh-episode", kind: "context-overflow", contextK: 212 },
		messages: SYNTHETIC_MESSAGES,
		worktreePath: "/repo/.pi/worktrees/poisoned-recon",
		worktreeBranch: "pipiui/poisoned-recon",
		now: new Date("2026-08-27T10:38:10Z"),
	});

	assert.equal(result.ok, true);
	const file = result.file as string;
	assert.equal(file, path.join(root, ".pi", "checkpoints", "poisoned-recon.md"));
	const written = fs.readFileSync(file, "utf-8");
	assert.match(written, /# Recovery checkpoint — poisoned-recon/);
	assert.match(written, /route=checkpoint-fresh-episode kind=context-overflow \(~212k tokens at death\)/);
	assert.match(written, /worktree preserved \(do NOT auto-discard\)/);
	assert.match(written, /pipiui\/poisoned-recon/);
	assert.match(written, /strongest prior findings/);
	assert.ok(written.includes(findings));
	assert.match(written, /## Known file families/);
	assert.match(written, /src\/Sidebar\.tsx/);
	assert.match(written, /## Covered search dimensions/);
	assert.match(written, /quota pill render/);
	// With a findings reference, unresolved questions are pointed there honestly;
	// without one, they are declared absent ("Not recorded") — never invented.
	assert.match(written, /conversation being abandoned|Not recorded/);
	// The pointer lives at a stable size well under its cap.
	assert.ok(written.length <= CHECKPOINT_MAX_CHARS);
	// Deterministic slug naming: the FILE name carries no random or generated component.
	const base = path.basename(result.file as string);
	assert.equal(base, "poisoned-recon.md");
	assert.match(base, /^[A-Za-z0-9._-]+\.md$/);
});

test("a boundary with NO observable evidence writes nothing rather than fabricating a checkpoint", () => {
	const root = tempRoot();
	const before = fs.existsSync(path.join(root, ".pi"));
	const result = writeRecoveryCheckpoint({
		mainCwd: root,
		agentId: "died-immediately",
		decision: { route: "checkpoint-fresh-episode", kind: "provider-stall" },
		messages: [],
	});
	assert.equal(result.ok, false);
	assert.equal(result.skipped, true);
	assert.equal(result.problem, "insufficient-evidence");
	if (!before) {
		assert.equal(fs.existsSync(path.join(root, ".pi")), false);
	}
});

test("REGRESSION: a role-evidenced fresh boundary without observable artifacts also skips end-to-end", () => {
	const root = tempRoot();
	const decision = classifyWorkerRecovery(
		observe({ errorText: "boom", contextTokens: 210_000, role: "reviewer" }),
	);
	assert.equal(decision.route, "checkpoint-fresh-episode");
	const result = writeRecoveryCheckpoint({
		mainCwd: root,
		agentId: "reviewer-no-history",
		decision,
		messages: [],
	});
	assert.equal(result.ok, false);
	assert.equal(result.skipped, true);
	assert.equal(result.problem, "insufficient-evidence");
	assert.equal(fs.existsSync(root), true);
	assert.equal(fs.existsSync(path.join(root, ".pi", "checkpoints")), false);
});

test("a fresh-episode classification is REQUIRED — checkpoint refuses other routes", () => {
	const root = tempRoot();
	const refused = writeRecoveryCheckpoint({
		mainCwd: root,
		agentId: "ordinary-fix",
		decision: { route: "continue-slice", kind: "verify-failure" },
		messages: SYNTHETIC_MESSAGES,
	});
	assert.equal(refused.ok, false);
	assert.equal(refused.problem, "not a fresh-episode boundary");
});

test("an unsafe agentId cannot escape the checkpoints directory", () => {
	const root = tempRoot();
	const result = writeRecoveryCheckpoint({
		mainCwd: root,
		agentId: "../../escape",
		decision: { route: "checkpoint-fresh-episode", kind: "context-overflow" },
		messages: SYNTHETIC_MESSAGES,
	});
	assert.equal(result.ok, true);
	const resolved = path.dirname(result.file as string);
	assert.equal(resolved, path.join(root, ".pi", "checkpoints"));
	assert.deepEqual(fs.readdirSync(resolved), ["escape.md"]);
});

test("the checkpoint stays bounded against a runaway sweep", () => {
	const root = tempRoot();
	const flood = Array.from({ length: 40 }, (_, batch) => ({
		role: "assistant",
		content: Array.from({ length: 150 }, (_, i) => ({
			type: "toolCall",
			name: i % 2 ? "read" : "grep",
			arguments: i % 2
				? { path: `deep/nested/module/${batch}/${i}.ts` }
				: { pattern: `synonym-${batch}-${i}` },
		})),
	}));
	const result = writeRecoveryCheckpoint({
		mainCwd: root,
		agentId: "flood-sweep",
		decision: { route: "checkpoint-fresh-episode", kind: "context-overflow", contextK: 260 },
		messages: flood,
	});
	assert.equal(result.ok, true);
	const written = fs.readFileSync(result.file as string, "utf-8");
	assert.ok(written.length <= CHECKPOINT_MAX_CHARS);
	const familyCount = (written.match(/^- deep\//gm) ?? []).length;
	assert.ok(familyCount <= CHECKPOINT_MAX_FILE_FAMILIES, `families=${familyCount}`);
	const dimCount = (written.match(/^- `synonym-/gm) ?? []).length;
	assert.ok(dimCount <= CHECKPOINT_MAX_SEARCH_DIMENSIONS, `dims=${dimCount}`);
});

// ---------------------------------------------------------------------------
// Reminder copy: repeated resume is not the default
// ---------------------------------------------------------------------------

test("fresh-route reminder lines point at the checkpoint and a NEW semantic agentId", () => {
	const lines = formatFreshEpisodeReminderLines("/p/.pi/checkpoints/slow-review.md");
	const joined = lines.join("\n");
	assert.match(joined, /checkpoint for what this episode had already established/);
	assert.match(joined, /\.pi\/checkpoints\/slow-review\.md/);
	assert.match(joined, /NEW semantic agentId/);
	assert.match(joined, /Do not blindly re-dispatch this same agentId/);
});

test("without evidence the reminder still defaults to fresh, admitting no checkpoint exists", () => {
	const lines = formatFreshEpisodeReminderLines(undefined);
	const joined = lines.join("\n");
	assert.match(joined, /NEW semantic agentId/);
	assert.match(joined, /could not synthesize a trustworthy checkpoint/);
	assert.doesNotMatch(joined, /checkpoint at/i);
});

test("continue-route jobs keep the unchanged continuity reminder contract", () => {
	// The branching lives in index.ts; here we pin the contract shape the branch must keep:
	// a plain continue-slice report never mentions checkpoints.
	const report = formatRecoveryReport({ agentId: "auth-refactor", decision: { route: "continue-slice", kind: "aborted" } });
	assert.doesNotMatch(report, /checkpoint=[^-\s]/);
});
