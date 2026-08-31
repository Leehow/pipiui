import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	agentResumeIdentityProblem,
	dispatchIdentityGateProblem,
	isLegacyGeneratedAgentId,
	selectCallerAgentIds,
	unstartedChainReservationIds,
	unnamedWritableDispatchProblem,
} from "../index.ts";

/**
 * Final-BLOCK identity contract (plan semantic-id-contract-20260825): caller-chosen short
 * semantic ids on every dispatch form; no random fallback; exact {agentId, runId} binding
 * for abort/resolve; queued jobs get their runId at acceptance; a chain that stops early
 * releases the reservations of steps that never started.
 */

test("selectCallerAgentIds validates format, duplicates, and active conflicts", () => {
	assert.deepEqual(selectCallerAgentIds(["quota-pill", " doc-panel "], new Set()), {
		ids: ["quota-pill", "doc-panel"],
	});
	assert.match(selectCallerAgentIds(["Bad_Id!"], new Set()).problem ?? "", /Invalid agentId/);
	assert.match(selectCallerAgentIds(["root"], new Set()).problem ?? "", /reserved/);
	assert.match(selectCallerAgentIds(["quota-pill", "quota-pill"], new Set()).problem ?? "", /Duplicate agentId/);
	assert.match(selectCallerAgentIds(["quota-pill"], new Set(["quota-pill"])).problem ?? "", /already running/);
	assert.deepEqual(selectCallerAgentIds([undefined, "quota-pill"], new Set()), { ids: ["quota-pill"] });
});

test("dispatchIdentityGateProblem: behavior at the real gate for every dispatch form", () => {
	const never = (() => false) as (agentId: string, agentName: string | undefined) => boolean;
	// Missing id, per-form labels.
	assert.match(
		dispatchIdentityGateProblem({ targets: [{ label: "this dispatch" }], isResumable: never as never }) ?? "",
		/Missing agentId for this dispatch/,
	);
	assert.match(
		dispatchIdentityGateProblem({ targets: [{ label: "chain step 2", agentId: "ok-step" }, { label: "chain step 3" }], isResumable: never as never }) ?? "",
		/Missing agentId for chain step 3/,
	);
	assert.match(
		dispatchIdentityGateProblem({ targets: [{ label: "task 1" }], isResumable: never as never }) ?? "",
		/Missing agentId for task 1/,
	);

	// Conflicting resume pair.
	assert.match(
		dispatchIdentityGateProblem({
			targets: [{ agentId: "new-name", label: "this dispatch" }],
			agentId: "new-name",
			resumeFrom: "old-name",
			isResumable: never as never,
		}) ?? "",
		/Conflicting identity.*old-name/s,
	);
	// Same value in both spellings is a resume, not a conflict.
	assert.equal(
		dispatchIdentityGateProblem({
			targets: [{ agentId: "quota-pill", label: "this dispatch" }],
			agentId: "quota-pill",
			resumeFrom: "quota-pill",
			isResumable: never as never,
		}),
		null,
	);
});

test("retired agent-<16hex> ids: rejected for new work, allowed only with stored history", () => {
	const never = (() => false) as (agentId: string, agentName: string | undefined) => boolean;
	assert.equal(isLegacyGeneratedAgentId("agent-b0371343a315731e"), true);
	assert.equal(isLegacyGeneratedAgentId("agent-deadbeef"), false, "8 hex chars is not the generator shape");
	assert.equal(isLegacyGeneratedAgentId("quota-pill"), false);
	assert.equal(isLegacyGeneratedAgentId("agent-XYZ71343a315731g"), false, "non-hex tail is a legal slug");

	const legacy = "agent-b0371343a315731e";
	// No stored worker: refuse the retired generated shape for new dispatch.
	assert.match(
		dispatchIdentityGateProblem({ targets: [{ agentId: legacy, label: "this dispatch" }], isResumable: () => false }) ?? "",
		/retired auto-generated shape/,
	);
	// A stored historical worker with that id makes it a legitimate resume — continuation only.
	assert.equal(
		dispatchIdentityGateProblem({ targets: [{ agentId: legacy, label: "this dispatch" }], isResumable: (id) => id === legacy }),
		null,
	);
	// fresh:true is rejected even when the worker exists: the legacy shape is resume-only
	// and must never create a cold opaque worker.
	assert.match(
		dispatchIdentityGateProblem({
			targets: [{ agentId: legacy, fresh: true, label: "this dispatch" }],
			isResumable: (id) => id === legacy,
		}) ?? "",
		/cannot be started cold/,
	);
	// Per-target fresh in a chain step is honored the same way.
	assert.match(
		dispatchIdentityGateProblem({
			targets: [
				{ agentId: "ok-step", label: "chain step 1" },
				{ agentId: legacy, fresh: true, label: "chain step 2" },
			],
			isResumable: (id) => id === legacy,
		}) ?? "",
		/cannot be started cold/,
	);
	// Fresh semantic ids are unaffected either way.
	assert.equal(
		dispatchIdentityGateProblem({ targets: [{ agentId: "quota-pill", label: "this dispatch" }], isResumable: never as never }),
		null,
	);
});

test("resume keeps the same semantic identity and rejects a conflicting agent type", () => {
	assert.equal(
		agentResumeIdentityProblem({ agentId: "quota-pill", requestedName: "general-purpose", historicalName: "general-purpose" }),
		null,
	);
	assert.match(
		agentResumeIdentityProblem({ agentId: "quota-pill", requestedName: "reviewer", historicalName: "general-purpose" }) ?? "",
		/not "reviewer"; changing agent type requires a new agentId/,
	);
});

test("a chain that stops early releases exactly the unstarted steps' reservations", () => {
	const steps = [
		{ agentId: "step-one" },
		{ agentId: "step-two" },
		{ agentId: "step-three" },
		{ agentId: "step-four" },
	];
	// Step 1 was handed over (and releases its own id in runSingleAgent's finally); the
	// chain stopped at step 2 before hand-over: release 2..4.
	assert.deepEqual(unstartedChainReservationIds(steps, 1), ["step-two", "step-three", "step-four"]);
	// All steps handed over: nothing to release (their own finallys own them now).
	assert.deepEqual(unstartedChainReservationIds(steps, 4), []);
	// Never entered the loop (e.g. background one-step path took over): release all.
	assert.deepEqual(unstartedChainReservationIds(steps, 0), ["step-one", "step-two", "step-three", "step-four"]);

	// End-to-end reservation semantics with the real selector: after the early-stop
	// release, the unstarted ids are dispatchable again, the started one still conflicts.
	const reservations = new Set(steps.map((step) => step.agentId!));
	const activeIds = new Set(reservations);
	for (const idleId of unstartedChainReservationIds(steps, 1)) reservations.delete(idleId);
	const activeAfter = new Set(reservations);
	assert.equal(selectCallerAgentIds(["step-two"], activeIds).problem !== undefined, true);
	// After release, step-two no longer appears as active...
	const recheck = selectCallerAgentIds(["step-two"], activeAfter);
	assert.equal(recheck.problem, undefined, "released id must be re-dispatchable: " + (recheck.problem ?? ""));
	// ...while step-one, handed over and not released here, still conflicts.
	assert.match(selectCallerAgentIds(["step-one"], activeAfter).problem ?? "", /already running/);
});

test("unnamed writable dispatch still names the problem explicitly", () => {
	assert.match(
		unnamedWritableDispatchProblem(
			[{ agent: "general-purpose", worktree: "isolated" }],
			(target) => target.worktree !== "none",
		) ?? "",
		/Missing agentId/,
	);
});

test("wiring: abort is exact-run everywhere and the runtime never generates a worker identity", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.doesNotMatch(source, /generatePipiuiAgentId/);
	assert.doesNotMatch(source, /agent-\$\{randomBytes/);
	assert.match(source, /runSingleAgent requires an explicit short semantic agentId/);
	// Abort requires runId on every route: public schema, tool wrapper, slash command.
	// The slice spans the three MUTATING schemas (abort/progress/resolve); it ends at
	// SubagentWatchParams because watch's read-only `list` action legitimately omits the
	// pair — its start/update/stop still bind the exact runId at the runtime gate below.
	const abortSchema = source.slice(source.indexOf("const SubagentAbortParams"), source.indexOf("const SubagentWatchParams"));
	assert.match(abortSchema, /agentId: Type\.String\(/);
	assert.match(abortSchema, /\trunId: Type\.String\(/);
	assert.doesNotMatch(abortSchema, /runId: Type\.Optional/);
	// subagent_watch: strict schema, and its mutating actions bind the exact pair too —
	// only `list` may omit identity, and a half filter is rejected rather than guessed.
	const watchSchema = source.slice(source.indexOf("const SubagentWatchParams"), source.indexOf("type SubagentExecuteParams"));
	assert.match(watchSchema, /additionalProperties: false/);
	assert.match(source, /requires both agentId and the exact runId/);
	assert.match(source, /takes either both agentId and runId \(exact filter\) or neither/);
	assert.match(source, /'action="abort" requires both agentId and the exact runId/);
	assert.match(source, /Usage: \/subagent_abort <agentId> <runId>/);
	// No route may suggest omitting runId.
	assert.doesNotMatch(source, /Omit runId to abort/);
	// Queued cancellation is exact and releases the id reservation.
	assert.match(source, /dispatchQueue\.cancel\(agentId, runId\)/);
	assert.match(source, /Dropped queued agentId=\$\{agentId\} runId=\$\{runId\}/);
	// Stale exact-run aborts are refused rather than crossing runs.
	assert.match(source, /stale runId=\$\{runId\}\$\{job\.runId \? `; currentRunId=\$\{job\.runId\}` : ""\}/);
	// runIds exist at acceptance for background dispatches and appear in the receipt.
	assert.match(source, /Started background agent\(s\).*runId for subagent_abort\(\{agentId, runId\}\)/s);
	assert.match(source, /runId: runIds\[index\]!,/);
	// Chain cleanup is wired as a guaranteed finally.
	assert.match(source, /\} finally \{\n[\s\S]*?for \(const idleId of unstartedChainReservationIds\(params\.chain, chainDispatchedCount\)\)/);
	// ChainItem declares fresh and the sync loop passes it.
	assert.match(source, /const ChainItem = Type\.Object\(\{[\s\S]*?fresh: Type\.Optional\(Type\.Boolean\(\{ description: FRESH_DESCRIPTION \}\)\),/);
	assert.match(source, /fresh: step\.fresh,/);
	// Identity is caller-chosen everywhere. tasks[] items and chain steps keep agentId
	// REQUIRED in their item schemas; the single schema declares it Optional ONLY so the
	// parallel tasks[] wave (no root identity) clears real provider validation — single-mode
	// enforcement stays at the execute() identity gate, which names "Missing agentId for this
	// dispatch" instead of ever generating an id.
	const taskItem = source.slice(source.indexOf("const TaskItem"), source.indexOf("const ChainItem"));
	assert.match(taskItem, /\tagentId: Type\.String\(\{ description: AGENT_ID_DESCRIPTION \}\),/);
	const chainItem = source.slice(source.indexOf("const ChainItem"), source.indexOf("const AgentScopeSchema"));
	assert.match(chainItem, /\tagentId: Type\.String\(\{ description: AGENT_ID_DESCRIPTION \}\),/);
	const singleSchema = source.slice(source.indexOf("const SubagentParams"), source.indexOf("const SubagentChainParams"));
	assert.match(singleSchema, /\tagentId: Type\.Optional\(Type\.String\(\{[\s\S]*?tasks\[\] call omits this root field/, "root agentId must be schema-optional for the parallel tasks[] mode");
	// Unknown subagent_type is never silently remapped into an identity.
	assert.doesNotMatch(source, /remapUnknownSubagentType/);
});

test("no model-facing bare abort/resolve shorthand remains anywhere in the runtime strings", () => {
	// Every slash shorthand must carry its arguments: /subagent_abort <agentId> <runId>
	// (and /subagent_resolve <agentId> <runId>). A bare "(or /subagent_abort)" invites the
	// model to call the command argument-less, which the contract now rejects.
	const files = [
		"../index.ts",
		"../done-message.ts",
		"../stall-notification.ts",
		"../dispatch-queue.ts",
		"../job-status-list.ts",
	] as const;
	for (const file of files) {
		const source = readFileSync(new URL(file, import.meta.url), "utf8");
		assert.doesNotMatch(source, /\/subagent_abort\)/, `${file}: bare /subagent_abort shorthand`);
		assert.doesNotMatch(source, /\/subagent_resolve\)/, `${file}: bare /subagent_resolve shorthand`);
		assert.doesNotMatch(source, /subagent_abort\(\{agentId\}\)/, `${file}: abort tool form without runId`);
	}
	// The two guidance carriers interpolate both ids into their slash forms.
	const stall = readFileSync(new URL("../stall-notification.ts", import.meta.url), "utf8");
	assert.match(stall, /\/subagent_abort \$\{input\.agentId\} \$\{input\.runId\}\)/);
	assert.match(stall, /\/subagent_resolve \$\{input\.agentId\} \$\{input\.runId\}\)/);
	const done = readFileSync(new URL("../done-message.ts", import.meta.url), "utf8");
	assert.match(done, /\/subagent_abort <agentId> <runId>\)/);
	assert.match(done, /\/subagent_resolve <agentId> <runId>\)/);
});

test("resolve binds one exact episode and rejects stale runIds", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /'action="resolve" requires both agentId and runId\.'/);
	assert.match(source, /if \(job\.runId !== runId\) \{/);
	assert.match(source, /stale runId=\$\{runId\}; currentRunId=\$\{job\.runId\}/);
});
