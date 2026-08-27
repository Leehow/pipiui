import { afterEach, describe, expect, it } from "vitest";

import { GOAL_AUTO_RESUME_ENV, initialGoalAutoResume } from "../../../resources/runtime/pi-goal/src/auto-resume.js";
import { registerGoalLifecycle } from "../../../resources/runtime/pi-goal/src/lifecycle.js";
import { GoalRuntime } from "../../../resources/runtime/pi-goal/src/runtime.js";
import type { ActiveGoal } from "../../../resources/runtime/pi-goal/src/persistence.js";

const ENV_KEY = GOAL_AUTO_RESUME_ENV;

/** Records `pi.on` registrations and replays the input handler on demand. */
function recordingPi() {
	const handlers = new Map<string, (event: any, ctx: any) => unknown>();
	const pi = {
		on: (event: string, handler: (event: any, ctx: any) => unknown) => {
			handlers.set(event, handler);
		},
		sendUserMessage: () => {
			throw new Error("unexpected automatic prompt in test");
		},
	};
	return { pi: pi as never, handlers };
}

function activeGoal(): ActiveGoal {
	return {
		id: "auth-fix",
		text: "finish the fix",
		status: "active",
		startedAt: 1,
		updatedAt: 1,
		iteration: 0,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		baselineTokens: 0,
		automaticModelTurns: 0,
		toolFreeRepeatCount: 0,
	};
}

afterEach(() => {
	delete process.env[ENV_KEY];
});

describe("pi-goal auto-revival suppression", () => {
	it("defaults to run when the host sends no block marker", () => {
		expect(initialGoalAutoResume({})).toBe("run");
		expect(initialGoalAutoResume({ [ENV_KEY]: "unrelated" })).toBe("run");
		expect(initialGoalAutoResume({ [ENV_KEY]: "blocked" })).toBe("blocked");
	});

	it("blocks continuations, wait-timer restore, and recovery runs for a spawned-blocked session", () => {
		process.env[ENV_KEY] = "blocked";
		const { pi } = recordingPi();
		const runtime = new GoalRuntime(pi);
		runtime.activeGoal = activeGoal();

		expect(runtime.blocksAutoResume()).toBe(true);
		// agent_end / session_compact continuation intents must not be minted.
		expect(runtime.requestContinuation(runtime.activeGoal)).toBe(false);
		expect((runtime as any).continuationIntent).toBeUndefined();
		// A late intent can never be delivered either.
		expect(runtime.dispatchContinuationIfSettled({} as never)).toBe(false);
		// session_start goal-restore must not re-arm a persisted wait timer.
		runtime.activeGoal.waiting = { resumeAt: Date.now() - 1000 } as never;
		expect(runtime.restoreGoalWaitTimer({} as never)).toBe(false);
		// Recovery auto-runs stay inert.
		expect(runtime.beginRecoveryRunIfNeeded()).toBeUndefined();
		expect((runtime as any).agentRunGoalId).toBeUndefined();
	});

	it("genuine user input lifts the block; goal-generated traffic does not", async () => {
		process.env[ENV_KEY] = "blocked";
		const { pi, handlers } = recordingPi();
		const runtime = new GoalRuntime(pi);
		registerGoalLifecycle(pi as never, runtime, { bindSession() {}, unbindSession() {} } as never);

		const inputHandler = handlers.get("input")!;
		expect(inputHandler).toBeDefined();

		// Goal-generated continuation traffic is extension-sourced: stays blocked.
		await inputHandler({ source: "extension", text: "pi-goal-continuation:x" }, {});
		expect(runtime.blocksAutoResume()).toBe(true);

		// A real user keystroke lifts the block for the process lifetime.
		await inputHandler({ text: "hello" }, {});
		expect(runtime.blocksAutoResume()).toBe(false);
		runtime.activeGoal = activeGoal();
		expect(runtime.requestContinuation(runtime.activeGoal)).toBe(true);
	});
});
