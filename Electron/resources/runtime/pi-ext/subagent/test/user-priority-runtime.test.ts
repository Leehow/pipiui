import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Import after selecting an isolated host-session marker; never touch the live app's marker.
const key = `queue-priority-test-${process.pid}`;
process.env.PIPIUI_SESSION_KEY = key;
const { __watchRuntimeForTests: runtime } = await import("../index.ts");
const marker = join(tmpdir(), `pipiui-cutin-${key}.json`);
const sample = (id: string, seq: number) => `[subagent-watch] ${id} (${id}) — state=running\nrunId=run-priority seq=${seq}.`;

async function waitForBatch(sent: string[]): Promise<void> {
	const deadline = Date.now() + 3_000;
	while (sent.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(sent.length, 1, "the production retry timer must resume without a new settle/manual flush");
}

function setup(t: test.TestContext) {
	const ids = ["priority-first", "priority-second", "priority-third"];
	runtime.bossTurnBusy = false;
	for (const agentId of ids) {
		runtime.runningAgents.set(agentId, { runId: "run-priority", controller: new AbortController(), diagnostics: {}, name: "general-purpose" } as any);
		runtime.registry.start({ agentId, runId: "run-priority", now: Date.now(), fingerprint: "state=running" });
	}
	t.after(() => {
		rmSync(marker, { force: true });
		runtime.bossTurnBusy = false;
		runtime.heldSignals.length = 0;
		runtime.registry.clear();
		for (const id of ids) runtime.runningAgents.delete(id);
	});
	return ids;
}

test("a live host user queue wins even after 15s; released backlog enters Pi only once", async (t) => {
	const ids = setup(t);
	writeFileSync(marker, JSON.stringify({ at: Date.now() - 60_000, pendingUserInput: true, ownerPid: process.pid }));
	const sent: string[] = [];
	const pi = { sendUserMessage: (text: string) => sent.push(text), sendMessage: (message: { content: string }) => sent.push(message.content) } as any;
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[0], 1)), false);
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[1], 1)), false);
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[1], 2)), false);
	runtime.flushHeldSignals(pi);
	assert.equal(sent.length, 0, "an idle Boss must still yield to queued user input");
	assert.equal(runtime.heldSignals.length, 2);
	// The host delivered/cancelled the pending user items; only it clears this marker.
	rmSync(marker);
	await waitForBatch(sent);
	assert.equal(sent.length, 1);
	assert.ok(sent[0].includes(sample(ids[0], 1)));
	assert.ok(sent[0].includes(sample(ids[1], 2)));
	assert.ok(!sent[0].includes(sample(ids[1], 1)));
	assert.equal(runtime.heldSignals.length, 0);
	// sendMessage is fire-and-forget; no observed before_agent_start yet.
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[2], 1)), false);
	runtime.flushHeldSignals(pi);
	assert.equal(sent.length, 1, "a second automatic envelope cannot queue behind the first");
});

test("a rejected batch retains current signals, and stale siblings are dropped before retry", async (t) => {
	const ids = setup(t);
	runtime.bossTurnBusy = true;
	let reject = true;
	const sent: string[] = [];
	const pi = {
		sendUserMessage: (text: string) => sent.push(text),
		sendMessage: (message: { content: string }) => {
			if (reject) throw new Error("queue unavailable");
			sent.push(message.content);
		},
	} as any;
	t.mock.method(console, "error", () => {});
	await runtime.sendUserMessage(pi, sample(ids[0], 1));
	await runtime.sendUserMessage(pi, sample(ids[1], 1));
	runtime.bossTurnBusy = false;
	runtime.flushHeldSignals(pi);
	assert.equal(runtime.heldSignals.length, 2);
	assert.equal(sent.length, 0);
	runtime.runningAgents.delete(ids[1]);
	reject = false;
	await waitForBatch(sent);
	assert.equal(sent.length, 1);
	assert.equal(sent[0], sample(ids[0], 1));
	assert.equal(runtime.heldSignals.length, 0);
});
