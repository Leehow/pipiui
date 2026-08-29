/**
 * Retired computer-use role keys must not appear in the Boss hot-read routing
 * block even when they still exist as persisted override keys.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";

scrubSubagentRuntimeTestHostEnvironment();
process.env.PIPIUI_AGENT_DEPTH = "0";
process.env.PIPIUI_AGENT_TREE_DEPTH = "0";
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
delete process.env.PIPIUI_MAIN_MODEL;
delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;
process.env.PIPIUI_AGENTS_DIR = fileURLToPath(new URL("../../agents", import.meta.url));

const { formatSubagentModelRoutingBlock } = await import("../index.ts");

test("formatSubagentModelRoutingBlock omits persisted retired computer-use keys", () => {
	const dir = mkdtempSync(join(tmpdir(), "pipi-retired-routing-"));
	const overridesFile = join(dir, "pipiui-subagent-models-runtime.json");
	writeFileSync(overridesFile, JSON.stringify({
		explore: [{ model: "roleprov/explore" }],
		"general-purpose": [{ model: "roleprov/gp" }],
		operator: [{ model: "roleprov/operator" }],
		reviewer: [{ model: "roleprov/reviewer" }],
		secretary: [{ model: "roleprov/secretary" }],
		"computer-use": [{ model: "openai-codex/gpt-5.6-terra" }],
		"computer-use-leader": [{ model: "openai-codex/gpt-5.6-terra" }],
		"computer-verifier": [{ model: "openai-codex/gpt-5.6-terra" }],
		"computer-terminal": [{ model: "openai-codex/gpt-5.6-terra" }],
	}));
	process.env.PIPIUI_SUBAGENT_MODELS_FILE = overridesFile;
	try {
		const block = formatSubagentModelRoutingBlock();
		assert.ok(block, "Boss routing block is present at depth 0");
		assert.match(block, /\[Subagent model routing — hot-read\]/);
		assert.match(block, /^- explore:/m);
		assert.match(block, /^- general-purpose:/m);
		assert.match(block, /^- operator:/m);
		assert.match(block, /^- reviewer:/m);
		assert.match(block, /^- secretary:/m);
		assert.doesNotMatch(block, /^- computer-use:/m);
		assert.doesNotMatch(block, /^- computer-use-leader:/m);
		assert.doesNotMatch(block, /^- computer-verifier:/m);
		assert.doesNotMatch(block, /^- computer-terminal:/m);
		assert.doesNotMatch(block, /computer-use/);
		assert.doesNotMatch(block, /computer-verifier/);
		assert.doesNotMatch(block, /computer-terminal/);
	} finally {
		delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;
		rmSync(dir, { recursive: true, force: true });
	}
});
