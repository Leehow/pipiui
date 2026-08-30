/**
 * Fork policy regression tests.
 *
 * The failure this guards against is the one the whole feature exists to remove: a dispatch
 * that silently degrades. A fork that quietly runs cold is a brief the Boss never wrote; a
 * fork that quietly crosses models costs full price for a copied context; a forked reviewer
 * returns the Boss's own reading as an independent verdict. Every one of those is a refusal
 * with a named reason here, never a silent fallback.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { COLD_START_ONLY_AGENTS, forkSpawnArgs, resolveFork } from "../fork-policy.ts";

const base = {
	agentName: "general-purpose",
	readOnly: false,
	depth: 0,
	bossModel: "xai/grok-4.6",
	sessionFile: "/p/.pi/agent/sessions/x/2026_abc.jsonl",
};

describe("resolveFork", () => {
	it("is inert unless the caller actually asked", () => {
		assert.deepEqual(resolveFork({ ...base }), { fork: false });
		assert.deepEqual(resolveFork({ ...base, fork: false }), { fork: false });
		// An unrequested fork must not produce a reason: a reason is a hard dispatch failure.
		assert.equal(resolveFork({ ...base }).reason, undefined);
	});

	it("forks a writable worker onto the Boss's own model", () => {
		const decision = resolveFork({ ...base, fork: true });
		assert.equal(decision.fork, true);
		assert.equal(decision.fork && decision.sourcePath, base.sessionFile);
		assert.equal(decision.fork && decision.model, "xai/grok-4.6");
		assert.deepEqual(forkSpawnArgs(decision), ["--fork", base.sessionFile]);
	});

	it("emits no argv when nothing was forked", () => {
		assert.deepEqual(forkSpawnArgs(resolveFork({ ...base })), []);
		assert.deepEqual(forkSpawnArgs(resolveFork({ ...base, fork: true, depth: 1 })), []);
	});

	it("lets continuity win over a fork on a resumed worker", () => {
		// Round two of a slice belongs to the worker that wrote the code, and pi would reject
		// `--fork` beside an existing `--session-id` anyway. Silent no-op, not a failure.
		const decision = resolveFork({ ...base, fork: true, resuming: true });
		assert.equal(decision.fork, false);
		assert.equal(decision.reason, undefined);
	});

	it("refuses every cold-start role by name", () => {
		for (const agentName of COLD_START_ONLY_AGENTS) {
			const decision = resolveFork({ ...base, fork: true, agentName });
			assert.equal(decision.fork, false, agentName);
			assert.match(String(decision.reason), /\[fork_cold_role\]/, agentName);
			assert.match(String(decision.reason), new RegExp(agentName), agentName);
		}
	});

	it("refuses any read-only role even if the roster grows one", () => {
		const decision = resolveFork({ ...base, fork: true, agentName: "auditor", readOnly: true });
		assert.equal(decision.fork, false);
		assert.match(String(decision.reason), /\[fork_cold_role\]/);
	});

	it("refuses a fork that would cross models rather than silently repricing it", () => {
		const decision = resolveFork({ ...base, fork: true, modelPin: "openai/gpt-5" });
		assert.equal(decision.fork, false);
		assert.match(String(decision.reason), /\[fork_model_conflict\]/);
		assert.match(String(decision.reason), /xai\/grok-4\.6/);
		assert.match(String(decision.reason), /openai\/gpt-5/);
	});

	it("allows a redundant pin that names the Boss's own model", () => {
		const decision = resolveFork({ ...base, fork: true, modelPin: "  xai/grok-4.6  " });
		assert.equal(decision.fork, true);
	});

	it("refuses a nested worker", () => {
		const decision = resolveFork({ ...base, fork: true, depth: 1 });
		assert.equal(decision.fork, false);
		assert.match(String(decision.reason), /\[fork_depth\]/);
	});

	it("refuses when there is no session to copy", () => {
		for (const sessionFile of [undefined, "", "   "]) {
			const decision = resolveFork({ ...base, fork: true, sessionFile });
			assert.equal(decision.fork, false);
			assert.match(String(decision.reason), /\[fork_no_session\]/);
		}
	});

	it("still forks when the Boss model is unknown, leaving pi's own resolution alone", () => {
		// An unresolvable Boss model is not a reason to refuse: the child inherits pi's normal
		// resolution. What must never happen is a pin conflict going unnoticed, and with no
		// Boss model to compare against there is no conflict to detect.
		const decision = resolveFork({ ...base, fork: true, bossModel: undefined, modelPin: "openai/gpt-5" });
		assert.equal(decision.fork, true);
		assert.equal(decision.fork && decision.model, undefined);
	});
});
