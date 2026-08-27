import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { ChildProcessTracker } from "../child-process-tracker.ts";

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForSpawn(child: ReturnType<typeof spawn>): Promise<number> {
	if (typeof child.pid === "number") return child.pid;
	await new Promise<void>((resolve, reject) => {
		child.once("spawn", resolve);
		child.once("error", reject);
	});
	assert.equal(typeof child.pid, "number");
	return child.pid!;
}

test("drain proves cooperative exit and escalates a SIGTERM-ignoring child", async (t) => {
	const tracker = new ChildProcessTracker();
	const cooperative = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		stdio: "ignore",
	});
	const stubborn = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
		stdio: "ignore",
	});
	tracker.track(cooperative);
	tracker.track(stubborn);
	const cooperativePid = await waitForSpawn(cooperative);
	const stubbornPid = await waitForSpawn(stubborn);
	t.after(() => {
		for (const child of [cooperative, stubborn]) {
			try { child.kill("SIGKILL"); } catch { /* best-effort test cleanup */ }
		}
	});

	// Let the stubborn child install its signal handler before the drain starts.
	await new Promise((resolve) => setTimeout(resolve, 100));
	const result = await tracker.drain(100, 2_000);

	assert.deepEqual(result, {
		requested: 2,
		termExited: 1,
		forceKilled: 1,
		remainingPids: [],
	});
	assert.equal(tracker.size(), 0);
	assert.equal(alive(cooperativePid), false, "cooperative child pid must be gone");
	assert.equal(alive(stubbornPid), false, "SIGTERM-ignoring child pid must be gone after escalation");
});

test("concurrent drain callers share one bounded cleanup", async (t) => {
	const tracker = new ChildProcessTracker();
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	tracker.track(child);
	const pid = await waitForSpawn(child);
	t.after(() => {
		try { child.kill("SIGKILL"); } catch { /* best-effort test cleanup */ }
	});

	const first = tracker.drain(1_000, 1_000);
	const second = tracker.drain(1_000, 1_000);
	assert.equal(first, second);
	assert.deepEqual(await first, {
		requested: 1,
		termExited: 1,
		forceKilled: 0,
		remainingPids: [],
	});
	assert.equal(alive(pid), false);
	assert.equal(tracker.size(), 0);
});
