import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
	discoverBundledAgentsFromDirectory,
	READONLY_RETRIEVAL_TOOL_NAMES,
	summarizeAgentPermissions,
	validateAgentDefinition,
} from "../agents.ts";

const agentsDir = fileURLToPath(new URL("../../agents", import.meta.url));
const bundled = discoverBundledAgentsFromDirectory(agentsDir);

function parsePackage(name: string, frontmatter: string): ReturnType<typeof validateAgentDefinition> {
	return validateAgentDefinition({
		filePath: `/tmp/${name}/AGENT.md`,
		content: `---\n${frontmatter}\n---\nbody\n`,
		source: "project",
		origin: "bundled",
		format: "package",
		directoryName: name,
	});
}

test("explore / general-purpose / reviewer compile readonly retrieval tools even when frontmatter omits them", () => {
	for (const name of ["explore", "general-purpose", "reviewer"]) {
		const agent = bundled.agents.find((item) => item.name === name);
		assert.ok(agent, name);
		for (const tool of READONLY_RETRIEVAL_TOOL_NAMES) {
			assert.ok(agent.tools?.includes(tool), `${name} missing ${tool}`);
			assert.ok(summarizeAgentPermissions(agent).capabilityTools?.includes(tool), `${name} capability missing ${tool}`);
		}
		assert.equal(agent.tools?.includes("edit") ?? false, name === "general-purpose", name);
	}
});

test("filesystem:none does not receive retrieval tools; writable tools stay off read-only roles", () => {
	const none = parsePackage("none-role", [
		"schema: 1",
		"name: none-role",
		"description: no filesystem",
		"mode: read-only",
		"capabilities:",
		"  filesystem: none",
		"  shell: false",
		"  web: false",
		"  mcp: false",
		"  desktop: none",
		"  delegation: false",
		"worktree: none",
		"deliverable: report",
	].join("\n"));
	assert.deepEqual(none.diagnostics.filter((item) => item.severity === "error"), []);
	assert.ok(none.agent);
	for (const tool of READONLY_RETRIEVAL_TOOL_NAMES) {
		assert.equal(none.agent.tools?.includes(tool) ?? false, false, tool);
	}

	const explore = parsePackage("explore", [
		"schema: 1",
		"name: explore",
		"description: research",
		"mode: read-only",
		"capabilities:",
		"  filesystem: read-only",
		"  shell: false",
		"  web: false",
		"  mcp: false",
		"  desktop: none",
		"  delegation: false",
		"worktree: none",
		"deliverable: report",
		"tools: read, grep, edit",
	].join("\n"));
	assert.ok(explore.diagnostics.some((item) => item.code === "tools-outside-capabilities"));
	assert.ok(explore.agent === undefined || explore.diagnostics.some((item) => item.severity === "error"));
});
