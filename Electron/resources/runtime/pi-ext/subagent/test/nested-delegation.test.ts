import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	discoverBundledAgentsFromDirectory,
	summarizeAgentPermissions,
	type AgentConfig,
} from "../agents.ts";
import {
	DELEGATION_TOOL_NAMES,
	isDelegationTool,
	resolveSubagentToolSelection,
} from "../desktop-tool-policy.mjs";
import {
	childReceivesDelegationTools,
	rejectDispatchAtDepth,
	rejectNestedDelegationTypes,
	resolveEffectiveSubagentDepth,
	resolveSubagentMaxDepth,
	runtimeRolePolicyForAgent,
} from "../runtime-policy.ts";

const agentsDir = fileURLToPath(new URL("../../agents", import.meta.url));
const bundled = discoverBundledAgentsFromDirectory(agentsDir);
const bundledByName = new Map(bundled.agents.map((agent) => [agent.name, agent]));

function requireBundled(name: string): AgentConfig {
	const agent = bundledByName.get(name);
	assert.ok(agent, `bundled agent missing: ${name}`);
	return agent;
}

const DEFAULT_MAX_DEPTH = 2;

test("agent tree is hard-capped at three layers even when the environment asks for more", () => {
	assert.equal(resolveSubagentMaxDepth(undefined), 2);
	assert.equal(resolveSubagentMaxDepth("0"), 0);
	assert.equal(resolveSubagentMaxDepth("1"), 1);
	assert.equal(resolveSubagentMaxDepth("2"), 2);
	assert.equal(resolveSubagentMaxDepth("3"), 2);
	assert.equal(resolveSubagentMaxDepth("999"), 2);
	assert.equal(resolveSubagentMaxDepth("-1"), 0);
	assert.equal(resolveSubagentMaxDepth("invalid"), 2);
});

test("inherited tree depth cannot move backward when a child rewrites its reported depth", () => {
	assert.equal(resolveEffectiveSubagentDepth(undefined, undefined), 0);
	assert.equal(resolveEffectiveSubagentDepth("1", undefined), 1);
	assert.equal(resolveEffectiveSubagentDepth("0", "2"), 2);
	assert.equal(resolveEffectiveSubagentDepth("1", "2"), 2);
	assert.equal(resolveEffectiveSubagentDepth("999", "1"), 2);
});

function assembleChildTools(agent: AgentConfig, childDepth: number, maxDepth = DEFAULT_MAX_DEPTH) {
	const runtimePolicy = runtimeRolePolicyForAgent(agent);
	const allowRecursiveDelegation = childReceivesDelegationTools({
		allowRecursiveDelegation: runtimePolicy.allowRecursiveDelegation,
		childDepth,
		maxDepth,
	});
	return resolveSubagentToolSelection({
		declaredTools: agent.tools?.filter((name) => allowRecursiveDelegation || !isDelegationTool(name)),
		disabledTools: [],
		hasMemoryBrokerCapability: false,
		hasSessionRecall: true,
		allowRecursiveDelegation,
		availableExtensionTools: ["fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
	});
}

function selectionNames(selection: { flag: string; names: string[] }): string[] {
	assert.equal(selection.flag, "--tools");
	return selection.names;
}

test("runtimeRolePolicyForAgent still derives recursive delegation from the capability flag", () => {
	const generalPurpose = requireBundled("general-purpose");
	assert.equal(generalPurpose.origin, "bundled");
	assert.equal(generalPurpose.capabilities.delegation, true);
	assert.equal(runtimeRolePolicyForAgent(generalPurpose).allowRecursiveDelegation, true);
	assert.equal(runtimeRolePolicyForAgent(requireBundled("explore")).allowRecursiveDelegation, false);
	assert.equal(runtimeRolePolicyForAgent(requireBundled("reviewer")).allowRecursiveDelegation, false);
	assert.equal(runtimeRolePolicyForAgent(requireBundled("secretary")).allowRecursiveDelegation, false);
});

test("other built-in roles remain non-delegating", () => {
	assert.deepEqual(bundled.diagnostics.filter((item) => item.severity === "error"), []);
	const delegating = bundled.agents.filter((agent) => agent.capabilities.delegation).map((agent) => agent.name);
	assert.deepEqual(delegating, ["general-purpose"]);
	for (const name of [
		"explore",
		"reviewer",
		"secretary",
	]) {
		const agent = requireBundled(name);
		assert.equal(agent.capabilities.delegation, false, name);
		assert.equal(runtimeRolePolicyForAgent(agent).allowRecursiveDelegation, false, name);
		const tools = selectionNames(assembleChildTools(agent, 1));
		assert.equal(tools.some(isDelegationTool), false, name);
		assert.equal(summarizeAgentPermissions(agent).capabilityTools?.some(isDelegationTool) ?? false, false, name);
	}
});

test("depth-1 general-purpose with delegation capability receives dispatch tools", () => {
	const agent = requireBundled("general-purpose");
	const tools = selectionNames(assembleChildTools(agent, 1));
	for (const name of DELEGATION_TOOL_NAMES) {
		assert.ok(tools.includes(name), `missing ${name}`);
	}
	assert.equal(childReceivesDelegationTools({
		allowRecursiveDelegation: true,
		childDepth: 1,
		maxDepth: DEFAULT_MAX_DEPTH,
	}), true);
});

test("depth-2 child receives no delegation tools at assembly and execution still rejects", () => {
	const generalPurpose = requireBundled("general-purpose");
	const tools = selectionNames(assembleChildTools(generalPurpose, 2));
	assert.equal(tools.some(isDelegationTool), false);
	assert.equal(childReceivesDelegationTools({
		allowRecursiveDelegation: true,
		childDepth: 2,
		maxDepth: DEFAULT_MAX_DEPTH,
	}), false);
	assert.match(
		rejectDispatchAtDepth({ depth: 2, maxDepth: DEFAULT_MAX_DEPTH }) ?? "",
		/Subagent depth limit reached \(depth 2, max 2\)/,
	);
	assert.equal(rejectDispatchAtDepth({ depth: 1, maxDepth: DEFAULT_MAX_DEPTH }), null);
	assert.equal(rejectDispatchAtDepth({ depth: 0, maxDepth: DEFAULT_MAX_DEPTH }), null);
});

test("depth-1 general-purpose may dispatch only explore and general-purpose", () => {
	assert.equal(rejectNestedDelegationTypes({ callerDepth: 1, agentNames: ["explore"] }), null);
	assert.equal(rejectNestedDelegationTypes({ callerDepth: 1, agentNames: ["general-purpose"] }), null);
	assert.equal(
		rejectNestedDelegationTypes({ callerDepth: 1, agentNames: ["explore", "general-purpose"] }),
		null,
	);
	for (const name of [
		"reviewer",
		"secretary",
	]) {
		const problem = rejectNestedDelegationTypes({ callerDepth: 1, agentNames: [name] });
		assert.match(problem ?? "", /not allowed/);
		assert.match(problem ?? "", new RegExp(`"${name}"`));
		assert.doesNotMatch(problem ?? "", /general-purpose.*explore/);
	}
	assert.equal(rejectNestedDelegationTypes({ callerDepth: 0, agentNames: ["reviewer", "secretary"] }), null);
});

test("wired execute/assembly path uses the depth and nested-type guards", () => {
	const runtimeIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	assert.match(runtimeIndex, /rejectDispatchAtDepth\(\{ depth: PIPIUI_DEPTH, maxDepth: PIPIUI_MAX_DEPTH \}\)/);
	assert.match(runtimeIndex, /rejectNestedDelegationTypes\(/);
	assert.match(runtimeIndex, /childReceivesDelegationTools\(/);
	assert.match(runtimeIndex, /callerDepth: PIPIUI_DEPTH/);
	assert.match(runtimeIndex, /resolveEffectiveSubagentDepth\([\s\S]*PIPIUI_AGENT_TREE_DEPTH/);
	assert.match(runtimeIndex, /PIPIUI_AGENT_TREE_DEPTH: String\(childDepth\)/);
	assert.match(runtimeIndex, /resolveSubagentMaxDepth\(process\.env\.PIPIUI_AGENT_MAX_DEPTH\)/);
	const agentDefinition = readFileSync(new URL("../../agents/general-purpose/AGENT.md", import.meta.url), "utf8");
	assert.match(agentDefinition, /delegation: true/);
	assert.match(agentDefinition, /ONLY `subagent_type` explore and general-purpose/);
	assert.doesNotMatch(agentDefinition, /do not try to spawn further subagents/);
});
