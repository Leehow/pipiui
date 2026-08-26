import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeStrictToolArguments } from "../strict-json-schema.ts";

/** Mirror of the public single `subagent` schema subset prepareArguments actually walks. */
const singleSchema = {
	type: "object",
	properties: {
		prompt: { type: "string", minLength: 1 },
		description: { type: "string", minLength: 1 },
		subagent_type: { type: "string" },
		agentId: { type: "string" },
		isolation: { type: "string" },
		resume_from: { type: "string" },
		title: { type: "string" },
		fresh: { type: "boolean" },
		verify: { type: "string" },
		cwd: { type: "string" },
		background: { type: "boolean" },
	},
};

/** Subset of SubagentChainParams that prepareArguments actually walks. */
const chainSchema = {
	type: "object",
	properties: {
		chain: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				properties: {
					prompt: { type: "string", minLength: 1 },
					description: { type: "string", minLength: 1 },
					subagent_type: { type: "string" },
					agentId: { type: "string" },
					isolation: { type: "string" },
					verify: { type: "string" },
					thinking: { type: "string" },
					scope: { type: "array", items: { type: "string" } },
				},
			},
		},
		background: { type: "boolean" },
	},
};

function chainPrompts(args: unknown): string[] {
	if (!args || typeof args !== "object" || Array.isArray(args)) return [];
	const chain = (args as { chain?: unknown }).chain;
	if (!Array.isArray(chain)) return [];
	return chain.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return "";
		const prompt = (item as { prompt?: unknown }).prompt;
		return typeof prompt === "string" ? prompt : "";
	});
}

test("nested chain wrapper unwraps to the inner steps instead of empty objects", () => {
	const nested = {
		chain: [
			{
				background: false,
				chain: [
					{
						agentId: "ext-row-badge2",
						description: "重加外部标记",
						isolation: "none",
						prompt: "Re-add the external badge on SessionRow.",
						subagent_type: "general-purpose",
						verify: "npm test",
					},
					{
						agentId: "pkg-ext-badge2",
						description: "fast-app 重打新包",
						isolation: "none",
						prompt: "Package the app. Prior step output:\n{previous}",
						subagent_type: "general-purpose",
					},
				],
			},
		],
	};

	const sanitized = sanitizeStrictToolArguments(chainSchema, nested) as {
		chain: Array<Record<string, unknown>>;
		background?: boolean;
	};

	assert.equal(sanitized.chain.length, 2);
	assert.deepEqual(chainPrompts(sanitized), [
		"Re-add the external badge on SessionRow.",
		"Package the app. Prior step output:\n{previous}",
	]);
	assert.equal(sanitized.chain[0]?.description, "重加外部标记");
	assert.equal(sanitized.chain[1]?.description, "fast-app 重打新包");
	assert.equal(sanitized.background, false);
});

test("string junk in a chain is dropped so a valid first step still runs", () => {
	const mangled = {
		chain: [
			{
				description: "重加外部标记",
				prompt: "Re-add the badge.",
			},
			"scopeLearningId2",
			"subagent_type2",
			"thinking2",
		],
	};

	const sanitized = sanitizeStrictToolArguments(chainSchema, mangled) as {
		chain: Array<Record<string, unknown>>;
	};

	assert.equal(sanitized.chain.length, 1);
	assert.equal(sanitized.chain[0]?.prompt, "Re-add the badge.");
	assert.equal(sanitized.chain[0]?.description, "重加外部标记");
});

test("a flat chain of real steps is left intact", () => {
	const flat = {
		chain: [
			{
				description: "重加外部标记并打包",
				prompt: "Re-add the badge, then package.",
				subagent_type: "general-purpose",
			},
		],
	};

	const sanitized = sanitizeStrictToolArguments(chainSchema, flat) as {
		chain: Array<Record<string, unknown>>;
	};

	assert.equal(sanitized.chain.length, 1);
	assert.equal(sanitized.chain[0]?.prompt, "Re-add the badge, then package.");
	assert.equal(sanitized.chain[0]?.description, "重加外部标记并打包");
});

test("single dispatch keeps an explicit agentId through the strict sanitizer", () => {
	const sanitized = sanitizeStrictToolArguments(singleSchema, {
		prompt: "Fix the login race.",
		description: "fix login race",
		subagent_type: "general-purpose",
		agentId: "login-race",
		fresh: true,
		verify: "npm test",
		unknownJunk: "should be dropped",
	}) as Record<string, unknown>;

	assert.equal(sanitized.agentId, "login-race");
	assert.equal(sanitized.fresh, true);
	assert.equal(sanitized.verify, "npm test");
	assert.equal("unknownJunk" in sanitized, false);
});

test("resume_from fills agentId, and title fills description, but nothing is invented", () => {
	const resumed = sanitizeStrictToolArguments(singleSchema, {
		prompt: "Continue the fix.",
		description: "continue login fix",
		resume_from: "login-race",
	}) as Record<string, unknown>;
	assert.equal(resumed.agentId, "login-race");
	assert.equal(resumed.resume_from, "login-race");

	const titled = sanitizeStrictToolArguments(singleSchema, {
		prompt: "Map the auth flow.",
		title: "map auth flow",
		subagent_type: "explore",
	}) as Record<string, unknown>;
	assert.equal(titled.description, "map auth flow");
	assert.equal(titled.agentId, undefined);
});

test("an unknown slug-shaped subagent_type is never remapped into agentId/resume_from", () => {
	// Regression pin (final BLOCK): the old remapUnknownSubagentType turned an unknown type
	// that looked like an id into resume_from + agentId. Unknown types must fail loud at the
	// dispatch gate instead of silently becoming a resume of some worker.
	const sanitized = sanitizeStrictToolArguments(singleSchema, {
		prompt: "Map the auth flow.",
		description: "map auth flow",
		subagent_type: "quota-pill",
	}) as Record<string, unknown>;
	assert.equal(sanitized.subagent_type, "quota-pill", "the unknown name stays a type and reaches the loud unknown-agent error");
	assert.equal(sanitized.agentId, undefined);
	assert.equal(sanitized.resume_from, undefined);
});

test("no agentId is derived from description: a missing id stays missing", () => {
	// Regression pin: general-purpose + description used to auto-slug an agentId, silently
	// turning a same-shaped new dispatch into a resume of that worker. The contract now
	// rejects a missing id at execute() with a named error instead.
	const sanitized = sanitizeStrictToolArguments(singleSchema, {
		prompt: "Investigate the flaky test.",
		description: "flaky test audit",
		subagent_type: "general-purpose",
		isolation: "worktree",
	}) as Record<string, unknown>;

	assert.equal(sanitized.agentId, undefined);
	assert.equal("agentId" in sanitized && sanitized.agentId !== undefined, false);
});
