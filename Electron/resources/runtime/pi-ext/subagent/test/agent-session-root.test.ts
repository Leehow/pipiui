import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveAgentSessionRoot } from "../agent-session-root.ts";

test("prefers PIPIUI_PROJECT_ROOT over MAIN_CWD so JSONL survives session-worktree cleanup", () => {
	assert.equal(
		resolveAgentSessionRoot("/canonical/project", "/session/.pi/worktrees/session-x"),
		"/canonical/project",
	);
});

test("falls back to MAIN_CWD when PROJECT_ROOT is missing or blank", () => {
	assert.equal(resolveAgentSessionRoot(undefined, "/workspace"), "/workspace");
	assert.equal(resolveAgentSessionRoot("", "/workspace"), "/workspace");
	assert.equal(resolveAgentSessionRoot("   ", "/workspace"), "/workspace");
});

test("returns undefined when neither root is set", () => {
	assert.equal(resolveAgentSessionRoot(undefined, undefined), undefined);
	assert.equal(resolveAgentSessionRoot("", ""), undefined);
	assert.equal(resolveAgentSessionRoot("  ", "  "), undefined);
});

test("index.ts wires agent-sessions through resolveAgentSessionRoot, not MAIN_CWD alone", () => {
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(source, /resolveAgentSessionRoot\(PIPIUI_PROJECT_ROOT, PIPIUI_MAIN_CWD\)/);
	assert.doesNotMatch(source, /path\.join\(PIPIUI_MAIN_CWD,\s*["']\.pi["'],\s*["']agent-sessions["']\)/);
});
