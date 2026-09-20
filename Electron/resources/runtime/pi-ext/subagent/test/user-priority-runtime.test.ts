import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never touch the live app's marker.
const key = `queue-priority-test-${process.pid}`;
process.env.PIPIUI_SESSION_KEY = key;
const { __watchRuntimeForTests: runtime } = await import("../index.ts");
const marker = join(tmpdir(), `pipiui-cutin-${key}.json`);
const sample = (id: string, seq: number) => `[subagent-watch] ${id} (${id}) — state=running\nrunId=run-priority seq=${seq}.`;

function setup(t: test.TestContext) {
	const ids = ["priority-first", "priority-second", "priority-third"];
	runtime.bossTurnBusy = false;
	runtime.notificationContext = { isIdle: () => true, hasPendingMessages: () => false };
	for (const agentId of ids) {
		runtime.runningAgents.set(agentId, { runId: "run-priority", controller: new AbortController(), diagnostics: {}, name: "general-purpose" } as any);
		runtime.registry.start({ agentId, runId: "run-priority", now: Date.now(), fingerprint: "state=running" });
	}
	t.after(() => {
		rmSync(marker, { force: true });
		runtime.bossTurnBusy = false;
		runtime.notificationContext = undefined;
		runtime.heldSignals.length = 0;
		runtime.registry.clear();
		for (const id of ids) runtime.runningAgents.delete(id);
	});
	return ids;
}

test("a live host user queue wins even after 15s; clearing it never replays old notifications", async (t) => {
	const ids = setup(t);
	writeFileSync(marker, JSON.stringify({ at: Date.now() - 60_000, pendingUserInput: true, ownerPid: process.pid }));
	const sent: string[] = [];
	const pi = { sendUserMessage: (text: string) => sent.push(text), sendMessage: (m: { content: string }) => sent.push(m.content) } as any;
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[0], 1)), false);
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[1], 1)), false);
	assert.equal(await runtime.sendUserMessage(pi, "[subagent-question] agentId=priority-first help"), false);
	runtime.flushHeldSignals(pi);
	assert.equal(sent.length, 0);
	assert.equal(runtime.heldSignals.length, 0);
	rmSync(marker);
	runtime.flushHeldSignals(pi);
	await new Promise(resolve => setTimeout(resolve, 300));
	assert.equal(sent.length, 0, "no deferred notification flush after user cancellation");
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[2], 2)), true, "a new idle notification may send directly");
	assert.equal(sent.length, 1);
	assert.equal(sent[0], sample(ids[2], 2));
});

test("busy notifications and failed sends do not create a replay queue", async (t) => {
	const ids = setup(t);
	runtime.bossTurnBusy = true;
	const sent: string[] = [];
	const pi = { sendUserMessage: () => { throw new Error("unavailable"); }, sendMessage: (m: { content: string }) => sent.push(m.content) } as any;
	t.mock.method(console, "error", () => {});
	await runtime.sendUserMessage(pi, sample(ids[0], 1));
	await runtime.sendUserMessage(pi, sample(ids[1], 1));
	assert.equal(runtime.heldSignals.length, 0);
	runtime.bossTurnBusy = false;
	assert.equal(await runtime.sendUserMessage(pi, sample(ids[0], 2)), false);
	runtime.flushHeldSignals(pi);
	await new Promise(resolve => setTimeout(resolve, 300));
	assert.deepEqual(sent, []);
	assert.equal(runtime.heldSignals.length, 0);
});
