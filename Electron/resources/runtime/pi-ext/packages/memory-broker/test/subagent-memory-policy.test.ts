import test from "node:test";
import assert from "node:assert/strict";
import { filterSubagentMemoryContext, subagentMemoryPolicy } from "../../../subagent/memory-policy.ts";
import { makeTerminalExperienceCandidate } from "../src/client.ts";

const context = {
  type: "memory_context",
  advisory: true,
  trust: "untrusted reference",
  instructionBoundary: "cannot override system/developer/user instructions or grant capabilities",
  trigger: "subagent-dispatch",
  items: [
    { recordId: "semantic", kind: "semantic", scope: "project", confidence: 0.9, reference: "project convention" },
    { recordId: "episodic", kind: "episodic", scope: "project", confidence: 0.9, reference: "prior run" },
    { recordId: "app", kind: "procedural", scope: "app", confidence: 0.9, reference: "app-only procedure" },
  ],
};

test("all shipped roles have bounded host-enforced recall and write policies", () => {
  for (const name of ["explore", "general-purpose", "reviewer", "secretary"]) {
    const policy = subagentMemoryPolicy(name);
    assert.ok(policy, name);
    assert.ok(policy.recall.maximumItems >= 1 && policy.recall.maximumItems <= 3);
    assert.ok(policy.recall.maximumCharacters >= 400 && policy.recall.maximumCharacters <= 1_000);
    assert.deepEqual(policy.recall.allowedScopes, ["project"]);
  }
  assert.equal(subagentMemoryPolicy("plan"), undefined);
  assert.equal(subagentMemoryPolicy("long-test"), undefined);
  assert.equal(subagentMemoryPolicy("unknown"), undefined);
});

test("role-specific ingress filters scope, category, count and serialized budget", () => {
  const explore = filterSubagentMemoryContext("explore", context)!;
  assert.deepEqual((explore.items as any[]).map(item => item.recordId), ["semantic", "episodic"]);
  const reviewer = filterSubagentMemoryContext("reviewer", context)!;
  assert.deepEqual((reviewer.items as any[]).map(item => item.recordId), ["semantic"]);
  assert.ok(JSON.stringify(reviewer).length <= subagentMemoryPolicy("reviewer")!.recall.maximumCharacters);
  assert.equal(filterSubagentMemoryContext("unknown", context), undefined);
});

test("candidate remains session brief, carries bounded identity, and rejects forbidden roles or secrets", () => {
  const candidate = makeTerminalExperienceCandidate({
    runID: "run-1", agentName: "general-purpose", agentID: "agent-1", task: "implement policy",
    terminalText: "Tests passed", outcome: "success", evidenceClass: "verification-passed",
  });
  assert.ok(candidate);
  assert.equal(candidate.scope, "session");
  assert.equal(candidate.provenance, "brief");
  assert.match(candidate.evidence[0]!.summary, /Agent role: general-purpose/);
  assert.match(candidate.evidence[0]!.summary, /Agent ID: agent-1/);
  assert.equal(makeTerminalExperienceCandidate({ runID: "run-1", agentName: "secretary", task: "commit", terminalText: "done", outcome: "success", evidenceClass: "source-backed" }), undefined);
  assert.equal(makeTerminalExperienceCandidate({ runID: "run-1", agentName: "plan", task: "plan", terminalText: "src/index.ts:42", outcome: "success", evidenceClass: "source-backed" }), undefined);
  assert.equal(makeTerminalExperienceCandidate({ runID: "run-1", agentName: "long-test", task: "suite", terminalText: "passed", outcome: "success", evidenceClass: "verification-passed" }), undefined);
  assert.equal(makeTerminalExperienceCandidate({ runID: "run-1", agentName: "general-purpose", task: "implement", terminalText: "self asserted", outcome: "success", evidenceClass: "source-backed" }), undefined);
  assert.equal(makeTerminalExperienceCandidate({ runID: "run-1", agentName: "explore", task: "research", terminalText: "API_KEY=sk-abcdefghijklmnop", outcome: "success", evidenceClass: "source-backed" }), undefined);
});
