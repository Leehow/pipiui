import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeStrictToolArguments } from "../strict-json-schema.ts";

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
