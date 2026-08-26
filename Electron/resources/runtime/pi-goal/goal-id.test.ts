import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GoalPromptContext } from "./src/prompts.ts";

const root = dirname(fileURLToPath(import.meta.url));

register("./test-shims/loader.mjs", pathToFileURL(join(root, "goal-id.test.ts")));

const {
	buildGoalId,
	goalSlug,
	GoalIdSequence,
	parseGoalId,
} = await import("./src/goal-id.ts");
const { createGoal, goalIdRejectionReason, nextGoalInstance } = await import("./src/runtime.ts");
const { buildGoalPrompt, buildGoalSystemPrompt } = await import("./src/prompts.ts");
const { loadGoalStateFromSession, serializeGoalState } = await import("./src/persistence.ts");

const SEMANTIC_GOAL_ID = /^[\p{L}\p{N}][\p{L}\p{N}-]*\.[1-9][0-9]{0,8}$/u;
const LEGACY_UUID = "0f1e2d3c-4b5a-4978-8976-a5b4c3d2e1f0";

function promptContext(overrides: Partial<GoalPromptContext> = {}): GoalPromptContext {
	return {
		id: "fix-login-race.1",
		text: "Fix the login race",
		status: "active",
		iteration: 0,
		tokensUsed: 0,
		startedAt: 0,
		updatedAt: 0,
		timeUsedSeconds: 0,
		baselineTokens: 0,
		...overrides,
	};
}

describe("goal id slug derivation", () => {
	it("produces short readable kebab-case slugs from objective text", () => {
		assert.equal(goalSlug("Fix the login race!!"), "fix-the-login-race");
		assert.equal(goalSlug("  ship   v2 -- now  "), "ship-v2-now");
	});

	it("keeps non-Latin objectives readable instead of collapsing to a fallback", () => {
		assert.equal(goalSlug("修复登录流程并验证"), "修复登录流程并验证");
	});

	it("normalizes accents and punctuation-only text", () => {
		assert.equal(goalSlug("café résumé"), "cafe-resume");
		assert.equal(goalSlug("!!! --- ???"), "goal");
		assert.equal(goalSlug(""), "goal");
	});

	it("caps slug length without trailing separators", () => {
		const long = "a".repeat(100);
		const slug = goalSlug(long);
		assert.ok(slug.length <= 40, `slug too long: ${slug.length}`);
		assert.ok(!slug.endsWith("-"), `trailing separator: ${slug}`);
	});

	it("builds and parses <slug>.<generation> ids symmetrically", () => {
		assert.equal(buildGoalId("fix-login", 3), "fix-login.3");
		assert.deepEqual(parseGoalId("fix-login.3"), { slug: "fix-login", generation: 3 });
		assert.deepEqual(parseGoalId("修复登录.12"), { slug: "修复登录", generation: 12 });
	});

	it("refuses to parse legacy UUID or malformed ids", () => {
		assert.equal(parseGoalId(LEGACY_UUID), undefined);
		assert.equal(parseGoalId("fix-login"), undefined);
		assert.equal(parseGoalId("fix-login.0"), undefined);
		assert.equal(parseGoalId("fix-login.03"), undefined);
		assert.equal(parseGoalId(".2"), undefined);
	});
});

describe("GoalIdSequence allocation", () => {
	it("allocates monotonic readable generations per slug", () => {
		const ids = new GoalIdSequence();
		assert.equal(ids.allocate("fix login"), "fix-login.1");
		assert.equal(ids.allocate("fix login"), "fix-login.2");
		assert.equal(ids.allocate("do other work"), "do-other-work.1");
	});

	it("keeps duplicate objectives from colliding across restarts via seed", () => {
		const first = new GoalIdSequence();
		const firstId = first.allocate("fix login");
		// Simulated restart: only the previously issued id is known.
		const second = new GoalIdSequence();
		second.seed(firstId);
		const reissued = second.allocate("fix login");
		assert.notEqual(reissued, firstId);
		assert.equal(reissued, "fix-login.2");
	});

	it("never reuses the previous id when rotating an instance", () => {
		const ids = new GoalIdSequence();
		const firstId = ids.allocate("fix login");
		const rotated = ids.allocate("fix login", firstId);
		assert.notEqual(rotated, firstId);
		assert.equal(rotated, "fix-login.2");
	});

	it("restores from a persisted snapshot and ignores malformed entries", () => {
		const ids = new GoalIdSequence();
		ids.restore({ "fix-login": 4, bad: "not-a-number", "": 2, "has.dot": 3, __proto__: 9 });
		assert.equal(ids.allocate("fix login"), "fix-login.5");
		assert.equal(ids.allocate("has dot"), "has-dot.1");
	});

	it("snapshots only valid allocated generations for persistence", () => {
		const ids = new GoalIdSequence();
		ids.allocate("fix login");
		ids.allocate("fix login");
		ids.allocate("other");
		const snapshot = ids.snapshot();
		assert.deepEqual(snapshot, { "fix-login": 2, other: 1 });
		const restored = new GoalIdSequence();
		restored.restore(snapshot);
		assert.equal(restored.allocate("fix login"), "fix-login.3");
	});

	it("seeding never lowers an allocated generation", () => {
		const ids = new GoalIdSequence();
		ids.allocate("fix login");
		ids.allocate("fix login");
		ids.seed("fix-login.1");
		assert.equal(ids.allocate("fix login"), "fix-login.3");
	});

	it("never reissues the first slug's id after more than 32 distinct objectives", () => {
		// Regression: an earlier 32-slug eviction cap silently forgot `fix-login`
		// and reissued `fix-login.1`, colliding with an id the model had seen.
		const ids = new GoalIdSequence();
		const firstId = ids.allocate("fix login");
		assert.equal(firstId, "fix-login.1");
		for (let i = 2; i <= 40; i++) ids.allocate(`distinct objective number ${i}`);
		assert.equal(ids.allocate("fix login"), "fix-login.2");
	});

	it("keeps every allocated slug in the snapshot, however many there are", () => {
		const ids = new GoalIdSequence();
		for (let i = 1; i <= 60; i++) ids.allocate(`objective ${i}`);
		const snapshot = ids.snapshot();
		assert.equal(Object.keys(snapshot).length, 60);
		assert.equal(snapshot["objective-1"], 1);
	});
});

describe("issued goal ids are never reissued across reloads and lifecycle", () => {
	function allocateForty(ids: InstanceType<typeof GoalIdSequence>) {
		const firstId = ids.allocate("fix login");
		for (let i = 2; i <= 40; i++) ids.allocate(`distinct objective number ${i}`);
		return firstId;
	}

	it("re-creates the first objective with a fresh generation after a simulated reload", () => {
		const before = new GoalIdSequence();
		const firstId = allocateForty(before);
		const after = new GoalIdSequence();
		after.restore(before.snapshot());
		const reissued = after.allocate("fix login");
		assert.notEqual(reissued, firstId);
		assert.equal(reissued, "fix-login.2");
	});

	it("round-trips the full >32-slug sequence through the persisted session entry", () => {
		const ids = new GoalIdSequence();
		const firstId = allocateForty(ids);
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "goal-state",
						data: serializeGoalState(undefined, ids.snapshot()),
					},
				],
			},
		};
		const loaded = loadGoalStateFromSession(ctx);
		assert.equal(Object.keys(loaded.goalIdSequence ?? {}).length, 40);
		const reloaded = new GoalIdSequence();
		reloaded.restore(loaded.goalIdSequence);
		assert.notEqual(reloaded.allocate("fix login"), firstId);
		assert.equal(reloaded.allocate("fix login"), "fix-login.3");
	});

	it("clearing the goal does not free its id: a cleared goal's text gets a new generation", () => {
		const ids = new GoalIdSequence();
		const clearedId = ids.allocate("fix login");
		// clear persists `{goal: null}` while carrying the sequence snapshot.
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "goal-state",
						data: serializeGoalState(undefined, ids.snapshot()),
					},
				],
			},
		};
		const reloaded = new GoalIdSequence();
		reloaded.restore(loadGoalStateFromSession(ctx).goalIdSequence);
		assert.notEqual(reloaded.allocate("fix login"), clearedId);
	});

	it("resume and edit of a restored goal never reissue the restored id", () => {
		const first = new GoalIdSequence();
		const started = createGoal("Fix the login race", undefined, 0, first);
		const reloaded = new GoalIdSequence();
		reloaded.restore(first.snapshot());
		reloaded.seed(started.id);
		const resumed = nextGoalInstance(started, reloaded);
		assert.equal(resumed.id, "fix-the-login-race.2");
		assert.notEqual(resumed.id, started.id);
		// Editing back to an objective text used by an earlier goal also gets
		// that slug's next generation, never a reissue.
		reloaded.allocate("harden session flow");
		const edited = nextGoalInstance(resumed, reloaded, "harden session flow");
		assert.equal(edited.id, "harden-session-flow.2");
	});
});

describe("semantic goal instance ids", () => {
	it("createGoal issues a readable semantic id instead of a UUID", () => {
		const goal = createGoal("Fix the login race", undefined, 0, new GoalIdSequence());
		assert.equal(goal.id, "fix-the-login-race.1");
		assert.match(goal.id, SEMANTIC_GOAL_ID);
		assert.ok(!/[0-9a-f]{8}-/.test(goal.id), `id looks random: ${goal.id}`);
	});

	it("duplicate objectives get distinct readable ids", () => {
		const ids = new GoalIdSequence();
		const first = createGoal("Fix the login race", undefined, 0, ids);
		const second = createGoal("Fix the login race", undefined, 0, ids);
		assert.equal(first.id, "fix-the-login-race.1");
		assert.equal(second.id, "fix-the-login-race.2");
		assert.notEqual(first.id, second.id);
	});

	it("resume rotation keeps the slug and bumps the generation", () => {
		const ids = new GoalIdSequence();
		const goal = createGoal("Fix the login race", undefined, 0, ids);
		const resumed = nextGoalInstance(goal, ids);
		assert.equal(resumed.id, "fix-the-login-race.2");
		assert.equal(resumed.text, goal.text);
		assert.equal(resumed.iteration, goal.iteration);
		assert.equal(resumed.tokensUsed, goal.tokensUsed);
	});

	it("edit rotation derives the slug from the updated objective", () => {
		const ids = new GoalIdSequence();
		const goal = createGoal("Fix the login race", undefined, 0, ids);
		const edited = nextGoalInstance(goal, ids, "Harden the session refresh flow");
		assert.equal(edited.id, "harden-the-session-refresh-flow.1");
		assert.equal(edited.text, "Harden the session refresh flow");
	});

	it("rotating a persisted legacy UUID goal issues a semantic id that differs", () => {
		const ids = new GoalIdSequence();
		ids.seed(LEGACY_UUID); // parse fails: ignored, must not break anything
		const legacy = { ...createGoal("Fix the login race", undefined, 0, ids), id: LEGACY_UUID };
		const rotated = nextGoalInstance(legacy, ids);
		assert.match(rotated.id, SEMANTIC_GOAL_ID);
		assert.notEqual(rotated.id, LEGACY_UUID);
	});
});

describe("goal_id stale-turn guard stays exact-match", () => {
	it("accepts only the exact current id", () => {
		const goal = { ...promptContext(), id: "fix-login-race.2" };
		assert.equal(goalIdRejectionReason(goal, "fix-login-race.2"), undefined);
	});

	it("rejects older generations and foreign ids", () => {
		const goal = { ...promptContext(), id: "fix-login-race.2" };
		assert.match(goalIdRejectionReason(goal, "fix-login-race.1") ?? "", /does not match/);
		assert.match(goalIdRejectionReason(goal, "fix-login-race.3") ?? "", /does not match/);
		assert.match(goalIdRejectionReason(goal, "fix-login-race") ?? "", /does not match/);
		assert.match(goalIdRejectionReason(goal, LEGACY_UUID) ?? "", /does not match/);
	});

	it("rejects missing and over-long ids", () => {
		const goal = promptContext();
		assert.match(goalIdRejectionReason(goal, "") ?? "", /missing goal_id/);
		assert.match(goalIdRejectionReason(goal, "x".repeat(129)) ?? "", /too long/);
	});
});

describe("goal id persistence compatibility", () => {
	it("round-trips a semantic id and the id sequence through the session entry", () => {
		const ids = new GoalIdSequence();
		const goal = createGoal("Fix the login race", undefined, 0, ids);
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "goal-state",
						data: serializeGoalState(goal, ids.snapshot()),
					},
				],
			},
		};
		const loaded = loadGoalStateFromSession(ctx);
		assert.equal(loaded.goal?.id, "fix-the-login-race.1");
		assert.deepEqual(loaded.goalIdSequence, { "fix-the-login-race": 1 });

		// A reload seeds from the entry and must not reissue the same id.
		const reloaded = new GoalIdSequence();
		reloaded.restore(loaded.goalIdSequence);
		reloaded.seed(loaded.goal?.id ?? "");
		assert.equal(reloaded.allocate("Fix the login race"), "fix-the-login-race.2");
	});

	it("loads legacy persisted goals with their original UUID id untouched", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "goal-state",
						data: {
							goal: {
								id: LEGACY_UUID,
								text: "Fix the login race",
								status: "paused",
								startedAt: 1,
								updatedAt: 2,
								iteration: 1,
								tokensUsed: 10,
								timeUsedSeconds: 5,
								baselineTokens: 0,
							},
						},
					},
				],
			},
		};
		const loaded = loadGoalStateFromSession(ctx);
		assert.equal(loaded.goal?.id, LEGACY_UUID);
		assert.equal(loaded.goal?.status, "paused");
		assert.equal(loaded.goalIdSequence, undefined);
		// The stale guard still accepts the legacy id while it stays active.
		assert.equal(goalIdRejectionReason(loaded.goal ?? promptContext(), LEGACY_UUID), undefined);
	});

	it("keeps the goal when a persisted id sequence is malformed, dropping only the sequence", () => {
		const ids = new GoalIdSequence();
		const goal = createGoal("Fix the login race", undefined, 0, ids);
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "goal-state",
						data: { ...serializeGoalState(goal), goalIdSequence: "corrupt" },
					},
				],
			},
		};
		const loaded = loadGoalStateFromSession(ctx);
		assert.equal(loaded.goal?.id, "fix-the-login-race.1");
		assert.equal(loaded.goalIdSequence, undefined);
	});

	it("restores the sequence even when no goal is active, so a cleared goal's id is never reissued", () => {
		const ids = new GoalIdSequence();
		ids.allocate("fix login");
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "goal-state",
						data: serializeGoalState(undefined, ids.snapshot()),
					},
				],
			},
		};
		const loaded = loadGoalStateFromSession(ctx);
		assert.equal(loaded.goal, undefined);
		assert.deepEqual(loaded.goalIdSequence, { "fix-login": 1 });
		const reloaded = new GoalIdSequence();
		reloaded.restore(loaded.goalIdSequence);
		assert.equal(reloaded.allocate("fix login"), "fix-login.2");
	});
});

	describe("goal prompts carry the readable id", () => {
	it("embeds the exact semantic id and names all three guarded tools", () => {
		const goal = promptContext();
		const prompt = buildGoalPrompt(goal);
		assert.ok(prompt.includes("<goal_id>"), "missing goal_id block");
		assert.ok(prompt.includes("\nfix-login-race.1\n"), "missing exact id");
		for (const tool of ["goal_complete", "goal_blocked", "goal_wait"]) {
			assert.ok(prompt.includes(tool), `prompt does not mention ${tool}`);
		}
		assert.ok(prompt.includes("instance number"), "missing instance-number guidance");
	});

	it("system prompt exposes the same id", () => {
		assert.ok(buildGoalSystemPrompt(promptContext()).includes("fix-login-race.1"));
	});
});

describe("goal command controller issues and rotates semantic ids end to end", () => {
	it("start and resume send prompts whose <goal_id> is the readable id, bumping per resume", async () => {
		const sent: string[] = [];
		const entries: Array<{ data: unknown }> = [];
		let activeTools = ["goal_complete", "goal_blocked", "goal_wait"];
		const pi = {
			sendUserMessage: async (prompt: string) => {
				sent.push(prompt);
			},
			appendEntry: (_type: string, data: unknown) => {
				entries.push({ data });
			},
			getActiveTools: () => activeTools,
			setActiveTools: (tools: string[]) => {
				activeTools = tools;
			},
		};
		const { GoalRuntime, transitionGoal } = await import("./src/runtime.ts");
		const { GoalCommandController } = await import("./src/commands.ts");
		const runtime = new GoalRuntime(pi as never);
		const controller = new GoalCommandController(runtime);
		const ctx = {
			cwd: "/tmp/pi-goal-id-test",
			mode: "tui" as const,
			ui: { confirm: async () => true, notify: () => {}, setStatus: () => {} },
			isIdle: () => true,
			sessionManager: { getBranch: () => [] },
		};

		await controller.startGoal("Fix the login race", undefined, ctx as never);
		assert.equal(runtime.activeGoal?.id, "fix-the-login-race.1");
		assert.ok(
			sent[0]?.includes("<goal_id>\nfix-the-login-race.1\n</goal_id>"),
			`start prompt missing semantic goal_id: ${sent[0]}`,
		);
		assert.deepEqual(
			(entries.at(-1)?.data as { goalIdSequence?: Record<string, number> })?.goalIdSequence,
			{ "fix-the-login-race": 1 },
		);

		runtime.activeGoal = transitionGoal(runtime.activeGoal!, "paused");
		await controller.resumeGoal(ctx as never);
		assert.equal(runtime.activeGoal?.id, "fix-the-login-race.2");
		assert.ok(
			sent[1]?.includes("<goal_id>\nfix-the-login-race.2\n</goal_id>"),
			`resume prompt missing rotated goal_id: ${sent[1]}`,
		);
		// The stale guard still rejects the pre-resume id the model previously saw.
		assert.match(
			goalIdRejectionReason(runtime.activeGoal!, "fix-the-login-race.1") ?? "",
			/does not match/,
		);
		assert.deepEqual(
			(entries.at(-1)?.data as { goalIdSequence?: Record<string, number> })?.goalIdSequence,
			{ "fix-the-login-race": 2 },
		);
	});
});
