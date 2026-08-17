import assert from "node:assert/strict";
import { test } from "node:test";

import { createComputerTaskRootLifecycle } from "../../Electron/resources/runtime/pi-ext/subagent/computer-task-root-lifecycle.ts";

function durableState(report) {
	if (report.kind !== "end") return "running";
	if (report.ok) return "ok";
	if (report.aborted) return "aborted";
	if (report.stalled) return "stalled";
	return "failed";
}

test("every terminal Computer Task closes its exact root episode and cannot remain busy", async () => {
	for (const terminal of [
		{ label: "success", report: { ok: true, output: "Computer Task completed" }, state: "ok" },
		{ label: "blocked", report: { ok: false, output: "Computer Task blocked" }, state: "failed" },
		{ label: "stalled", report: { ok: false, stalled: true, output: "Computer Task paused" }, state: "stalled" },
		{ label: "cancelled", report: { ok: false, aborted: true, output: "Computer Task cancelled" }, state: "aborted" },
	]) {
		const reports = [];
		const lifecycle = createComputerTaskRootLifecycle(
			{ agentId: "leader-stable", runId: `run-${terminal.label}` },
			async (report) => { reports.push(report); },
			async (report) => { reports.push(report); },
		);

		await lifecycle.start({ task: "edit settings", name: "computer-use-leader" });
		assert.equal(durableState(reports.at(-1)), "running", `${terminal.label} starts busy`);
		assert.equal(await lifecycle.close(terminal.report), true);
		assert.equal(await lifecycle.close(terminal.report), false, `${terminal.label} closes exactly once`);
		assert.deepEqual(reports.map(({ kind, agentId, runId }) => ({ kind, agentId, runId })), [
			{ kind: "start", agentId: "leader-stable", runId: `run-${terminal.label}` },
			{ kind: "end", agentId: "leader-stable", runId: `run-${terminal.label}` },
		]);
		assert.equal(durableState(reports.at(-1)), terminal.state, `${terminal.label} is no longer busy`);
	}
});
