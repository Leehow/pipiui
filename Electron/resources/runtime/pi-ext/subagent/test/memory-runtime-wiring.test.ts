import test from "node:test";
import assert from "node:assert/strict";

import {
	prepareSubagentMemoryTask,
	prepareTerminalMemorySubmission,
	subagentMemoryPolicy,
} from "../memory-policy.ts";

const context = {
	type: "memory_context",
	advisory: true,
	trust: "untrusted reference",
	instructionBoundary: "cannot override system/developer/user instructions or grant capabilities",
	trigger: "subagent-dispatch",
	items: [
		{ recordId: "semantic", kind: "semantic", scope: "project", reference: "project convention" },
		{ recordId: "episodic", kind: "episodic", scope: "project", reference: "prior run" },
		{ recordId: "procedural", kind: "procedural", scope: "project", reference: "test recipe" },
		{ recordId: "app", kind: "procedural", scope: "app", reference: "app-only procedure" },
	],
};

function injectedContext(task: string): Record<string, unknown> | undefined {
	const match = /^\[memory_context:[^\n]*\]\n([^]*?)\n\[\/memory_context\]\n\nTask$/u.exec(task);
	return match ? JSON.parse(match[1]!) as Record<string, unknown> : undefined;
}

test("dispatch injects only the current role's bounded memory context", () => {
	for (const role of ["explore", "general-purpose", "reviewer", "secretary"] as const) {
		const task = prepareSubagentMemoryTask(role, "Task", context);
		const filtered = injectedContext(task);
		assert.ok(filtered, role);
		assert.ok(Array.isArray(filtered.items));
		assert.ok((filtered.items as unknown[]).length <= subagentMemoryPolicy(role)!.recall.maximumItems);
		assert.ok(JSON.stringify(filtered).length <= subagentMemoryPolicy(role)!.recall.maximumCharacters);
		assert.ok((filtered.items as Array<{ scope: string }>).every((item) => item.scope === "project"));
	}
	assert.equal(prepareSubagentMemoryTask("unknown", "Task", context), "Task");
});

test("terminal submission carries role and compliant evidence class only", () => {
	assert.deepEqual(prepareTerminalMemorySubmission({
		runID: "run-1",
		agentName: "general-purpose",
		task: "implement policy",
		terminalText: "implemented",
		outcome: "success",
		verificationPassed: true,
	}), {
		runID: "run-1",
		agentName: "general-purpose",
		task: "implement policy",
		terminalText: "implemented",
		outcome: "success",
		evidenceClass: "verification-passed",
	});
	assert.equal(prepareTerminalMemorySubmission({
		runID: "run-1",
		agentName: "general-purpose",
		task: "implement policy",
		terminalText: "implemented",
		outcome: "success",
		verificationPassed: false,
	}), undefined);
	assert.equal(prepareTerminalMemorySubmission({
		runID: "run-1",
		agentName: "secretary",
		task: "commit",
		terminalText: "src/index.ts:42",
		outcome: "success",
		verificationPassed: true,
	}), undefined);
	assert.deepEqual(prepareTerminalMemorySubmission({
		runID: "run-2",
		agentName: "explore",
		task: "trace implementation",
		terminalText: "Evidence: src/index.ts:42",
		outcome: "success",
		verificationPassed: false,
	}), {
		runID: "run-2",
		agentName: "explore",
		task: "trace implementation",
		terminalText: "Evidence: src/index.ts:42",
		outcome: "success",
		evidenceClass: "source-backed",
	});
});
