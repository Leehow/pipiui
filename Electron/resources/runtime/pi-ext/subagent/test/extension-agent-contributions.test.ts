import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	linkSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	applyExtensionAgentContributions,
	captureExtensionToolOwnership,
	discoverAgents,
	discoverAgentsFromRoots,
	discoverBundledAgentsFromDirectory,
	dispatchExtensionToolNames,
	dispatchToolPatch,
	EXT_AGENT_CONTRIBUTIONS_ENV,
	EXT_AGENT_CONTRIBUTIONS_FILE_ENV,
	EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV,
	extensionToolOwnership,
	hasCapturedExtensionToolOwnership,
	installExtensionToolOwnershipCapture,
	loadExtensionAgentContributionSnapshot,
	parseExtensionAgentContributionSnapshot,
	REGISTERED_EXTENSION_PATHS_ENV,
	resetExtensionToolOwnership,
	setContributionSidecarReadProbeForTest,
	validateAgentDefinition,
	type AgentConfig,
	type AgentDiscoveryResult,
	type ExtensionAgentContributionSnapshot,
} from "../agents.ts";
import {
	isDelegationTool,
	resolveSubagentToolSelection,
} from "../desktop-tool-policy.mjs";

const agentsDir = fileURLToPath(new URL("../../agents", import.meta.url));
const bundled = discoverBundledAgentsFromDirectory(agentsDir);
const runtimeIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

function tempRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function writePackage(
	root: string,
	name: string,
	options: { tools?: string; web?: boolean; shell?: boolean; body?: string; schema?: string } = {},
): string {
	const dir = join(root, "agents", name);
	mkdirSync(dir, { recursive: true });
	const schema = options.schema ?? "schema: 1";
	const tools = options.tools ? `tools: ${options.tools}\n` : "";
	writeFileSync(
		join(dir, "AGENT.md"),
		`---\n${schema}\nname: ${name}\ndescription: contributed ${name}\nmode: read-only\ncapabilities:\n  filesystem: read-only\n  shell: ${options.shell ?? false}\n  web: ${options.web ?? false}\n  mcp: false\n  desktop: none\n  delegation: false\nworktree: none\ndeliverable: report\n${tools}---\n${options.body ?? `You are ${name}.`}\n`,
	);
	return join(dir, "AGENT.md");
}

function writePrompt(root: string, relative: string, body: string): string {
	const target = join(root, relative);
	mkdirSync(join(target, ".."), { recursive: true });
	writeFileSync(target, body);
	return target;
}

function snapshotOf(
	extensions: Array<Record<string, unknown>>,
	root = "",
): ExtensionAgentContributionSnapshot {
	return parseExtensionAgentContributionSnapshot(
		JSON.stringify({ version: 1, extensions }),
		root || EXT_AGENT_CONTRIBUTIONS_ENV,
	);
}

function merge(
	extensions: Array<Record<string, unknown>>,
	base: AgentDiscoveryResult = bundled,
): AgentDiscoveryResult {
	return applyExtensionAgentContributions(base, snapshotOf(extensions));
}

function byName(result: AgentDiscoveryResult, name: string): AgentConfig {
	const agent = result.agents.find((entry) => entry.name === name);
	assert.ok(agent, `missing agent ${name}`);
	return agent;
}

function codes(result: AgentDiscoveryResult | ExtensionAgentContributionSnapshot): string[] {
	return result.diagnostics.map((entry) => entry.code);
}

async function registerFixtureTools(relative: string): Promise<{ extensionPath: string; tools: Array<{ name: string }> }> {
	const moduleUrl = new URL(relative, import.meta.url);
	const extensionPath = fileURLToPath(moduleUrl);
	const mod = await import(moduleUrl.href) as { default: (pi: { registerTool: (tool: { name: string }) => void }) => void };
	const tools: Array<{ name: string }> = [];
	mod.default({ registerTool: (tool) => tools.push({ name: tool.name }) });
	return { extensionPath, tools };
}

async function registerOwnedToolFixture(): Promise<{ extensionPath: string; tools: Array<{ name: string }> }> {
	return registerFixtureTools("./fixtures/owned-tool-extension.ts");
}

function workerToolNames(agent: AgentConfig, mounted: string[], ownership = extensionToolOwnership()): string[] {
	const patched = dispatchToolPatch(agent, mounted, ownership);
	return resolveSubagentToolSelection({
		declaredTools: patched.declaredTools,
		disabledTools: [],
		allowRecursiveDelegation: false,
		availableExtensionTools: [],
	}).names;
}

test("contributed schema:1 package enters the effective catalog", () => {
	const root = tempRoot("pipiui-contrib-agent-");
	try {
		const agentPath = writePackage(root, "ext-researcher", { tools: "read, grep, ls" });
		const result = merge([
			{
				id: "ext.research",
				origin: "project",
				root,
				agents: [agentPath],
			},
		]);
		const agent = byName(result, "ext-researcher");
		assert.equal(agent.origin, "project");
		assert.equal(agent.source, "project");
		assert.equal(agent.format, "package");
		assert.equal(agent.schema, 1);
		assert.match(agent.systemPrompt, /You are ext-researcher/);
		assert.equal(agent.tools?.includes("ls"), true);
		assert.ok(byName(result, "explore"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("contributed name that collides with an effective agent is rejected", () => {
	const root = tempRoot("pipiui-contrib-conflict-");
	try {
		const agentPath = writePackage(root, "explore", { body: "injected explore" });
		const result = merge([
			{
				id: "ext.collide",
				origin: "app",
				root,
				agents: [agentPath],
			},
		]);
		assert.equal(codes(result).includes("contribution-name-conflict"), true);
		assert.match(byName(result, "explore").systemPrompt, /explore subagent/);
		assert.doesNotMatch(byName(result, "explore").systemPrompt, /injected explore/);
		assert.equal(byName(result, "explore").origin, "bundled");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("patches apply in origin then id then manifest order", () => {
	const builtin = tempRoot("pipiui-contrib-builtin-");
	const app = tempRoot("pipiui-contrib-app-");
	const project = tempRoot("pipiui-contrib-project-");
	try {
		const builtinPrompt = writePrompt(builtin, "prompts/a.md", "BUILTIN");
		const builtinLater = writePrompt(builtin, "prompts/z.md", "BUILTIN-Z");
		const appPrompt = writePrompt(app, "prompts/b.md", "APP");
		const projectPrompt = writePrompt(project, "prompts/c.md", "PROJECT");
		const result = merge([
			{
				id: "ext.z",
				origin: "project",
				root: project,
				patches: [{ target: "explore", appendPrompt: projectPrompt }],
			},
			{
				id: "ext.z",
				origin: "builtin",
				root: builtin,
				patches: [
					{ target: "explore", appendPrompt: builtinLater },
					{ target: "explore", appendPrompt: builtinPrompt },
				],
			},
			{
				id: "ext.a",
				origin: "builtin",
				root: builtin,
				patches: [{ target: "explore", appendPrompt: builtinPrompt }],
			},
			{
				id: "ext.m",
				origin: "app",
				root: app,
				patches: [{ target: "explore", appendPrompt: appPrompt }],
			},
		]);
		const prompt = byName(result, "explore").systemPrompt;
		const builtinA = prompt.indexOf("BUILTIN\n\nBUILTIN-Z") >= 0 || prompt.indexOf("BUILTIN") >= 0;
		assert.equal(builtinA, true);
		assert.ok(prompt.indexOf("You are an explore subagent") < prompt.indexOf("BUILTIN"));
		assert.ok(prompt.indexOf("BUILTIN") < prompt.indexOf("APP"));
		assert.ok(prompt.indexOf("APP") < prompt.indexOf("PROJECT"));
		assert.match(prompt, /BUILTIN[\s\S]*APP[\s\S]*PROJECT/);
	} finally {
		rmSync(builtin, { recursive: true, force: true });
		rmSync(app, { recursive: true, force: true });
		rmSync(project, { recursive: true, force: true });
	}
});

test("replacePrompt replaces definition text; later append follows; runtime suffixes stay last", () => {
	const root = tempRoot("pipiui-contrib-prompt-");
	try {
		const replaced = writePrompt(root, "prompts/replace.md", "REPLACED DEFINITION");
		const appended = writePrompt(root, "prompts/append.md", "APPENDED DEFINITION");
		const result = merge([
			{
				id: "ext.alpha",
				origin: "builtin",
				root,
				patches: [{ target: "explore", replacePrompt: replaced }],
			},
			{
				id: "ext.beta",
				origin: "project",
				root,
				patches: [{ target: "explore", appendPrompt: appended }],
			},
		]);
		assert.equal(byName(result, "explore").systemPrompt, "REPLACED DEFINITION\n\nAPPENDED DEFINITION");
		const definitionPush = runtimeIndex.indexOf("if (agent.systemPrompt.trim()) promptParts.push(agent.systemPrompt);");
		assert.ok(definitionPush >= 0);
		assert.ok(definitionPush < runtimeIndex.indexOf("[Runtime placement: shared cwd]"));
		assert.ok(definitionPush < runtimeIndex.indexOf("systemPrompt: [systemPrompt, isolation, findingsIndex]"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replacePrompt is rejected for canonical privileged bundled roles; append is allowed", () => {
	const root = tempRoot("pipiui-contrib-canonical-");
	try {
		const replaced = writePrompt(root, "prompts/nope.md", "SHOULD NOT LAND");
		const appended = writePrompt(root, "prompts/ok.md", "CANONICAL APPEND");
		const original = byName(bundled, "secretary").systemPrompt;
		const result = merge([
			{
				id: "ext.patch",
				origin: "project",
				root,
				patches: [
					{ target: "secretary", replacePrompt: replaced },
					{ target: "secretary", appendPrompt: appended },
				],
			},
		]);
		assert.equal(codes(result).includes("contribution-replace-forbidden"), true);
		assert.equal(byName(result, "secretary").systemPrompt.startsWith(original.trim()), true);
		assert.match(byName(result, "secretary").systemPrompt, /CANONICAL APPEND/);
		assert.doesNotMatch(byName(result, "secretary").systemPrompt, /SHOULD NOT LAND/);
		assert.equal(byName(result, "secretary").origin, "bundled");
		const applied = result.appliedPatches ?? [];
		assert.equal(applied.some((entry) => entry.operations.includes("replacePrompt")), false);
		assert.deepEqual(
			applied.filter((entry) => entry.target === "secretary"),
			[{ extensionId: "ext.patch", origin: "project", target: "secretary", operations: ["appendPrompt"] }],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("addTools may restore capability-universe names; removeTools is subtractive", () => {
	const root = tempRoot("pipiui-contrib-tools-");
	try {
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		const result = merge([
			{
				id: "ext.tools",
				origin: "app",
				root,
				agents: [agentPath],
				patches: [
					{ target: "narrow-role", addTools: ["ls", "find"] },
					{ target: "narrow-role", removeTools: ["grep"] },
				],
			},
		]);
		const agent = byName(result, "narrow-role");
		assert.equal(agent.tools?.includes("ls"), true);
		assert.equal(agent.tools?.includes("find"), true);
		assert.equal(agent.tools?.includes("grep"), false);
		assert.equal(agent.tools?.includes("read"), true);
		assert.equal(agent.capabilities.filesystem, "read-only");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("addTools of a real extension tool keep provenance until mount and owned extensionToolNames", () => {
	const root = tempRoot("pipiui-contrib-exttool-");
	try {
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		const result = merge([
			{
				id: "ext.provided",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["my_ext_tool"] }],
			},
		]);
		const agent = byName(result, "narrow-role");
		assert.equal(agent.tools?.includes("my_ext_tool"), false);
		assert.deepEqual(agent.extensionToolRequests, [
			{ name: "my_ext_tool", extensionId: "ext.provided" },
		]);
		assert.equal((result.appliedPatches ?? []).some((entry) => entry.addTools?.includes("my_ext_tool")), false);
		const unmounted = dispatchToolPatch(agent, [], ["my_ext_tool"]);
		assert.equal(unmounted.declaredTools?.includes("my_ext_tool"), false);
		const mountedWithoutOwnership = dispatchToolPatch(agent, ["ext.provided"], []);
		assert.equal(mountedWithoutOwnership.declaredTools?.includes("my_ext_tool"), false);
		const mounted = dispatchToolPatch(agent, ["ext.provided"], ["my_ext_tool"]);
		assert.equal(mounted.declaredTools?.includes("my_ext_tool"), true);
		const omitted = resolveSubagentToolSelection({
			declaredTools: mounted.declaredTools,
			disabledTools: [],
			allowRecursiveDelegation: false,
			availableExtensionTools: [],
		});
		assert.equal(omitted.flag, "--tools");
		assert.equal(omitted.names.includes("my_ext_tool"), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runtime registerTool ownership, not snapshot providedTools, feeds worker --tools", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-owned-");
	const prevMounted = process.env.PIPIUI_MOUNTED_EXTENSIONS;
	const prevPaths = process.env[REGISTERED_EXTENSION_PATHS_ENV];
	try {
		const { extensionPath, tools } = await registerOwnedToolFixture();
		assert.deepEqual(tools.map((tool) => tool.name), ["owned_tool"]);
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		process.env.PIPIUI_MOUNTED_EXTENSIONS = "ext.owner";
		process.env[REGISTERED_EXTENSION_PATHS_ENV] = extensionPath;
		captureExtensionToolOwnership({
			extensions: [{ path: extensionPath, tools }],
			mounts: [{ id: "ext.owner", path: extensionPath }],
		});
		const forged = merge([
			{
				id: "ext.owner",
				origin: "project",
				root,
				agents: [agentPath],
				providedTools: ["not_registered_tool"],
				patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
			},
		]);
		const agent = byName(forged, "narrow-role");
		assert.equal(agent.tools?.includes("owned_tool"), false);
		assert.deepEqual(agent.extensionToolRequests, [{ name: "owned_tool", extensionId: "ext.owner" }]);
		assert.equal(dispatchExtensionToolNames(["ext.owner"]).includes("owned_tool"), true);
		const names = workerToolNames(agent, ["ext.owner"]);
		assert.equal(names.includes("owned_tool"), true);
		assert.equal(resolveSubagentToolSelection({
			declaredTools: dispatchToolPatch(agent, ["ext.owner"]).declaredTools,
			disabledTools: [],
			allowRecursiveDelegation: false,
			availableExtensionTools: [],
		}).flag, "--tools");
	} finally {
		resetExtensionToolOwnership();
		if (prevMounted === undefined) delete process.env.PIPIUI_MOUNTED_EXTENSIONS;
		else process.env.PIPIUI_MOUNTED_EXTENSIONS = prevMounted;
		if (prevPaths === undefined) delete process.env[REGISTERED_EXTENSION_PATHS_ENV];
		else process.env[REGISTERED_EXTENSION_PATHS_ENV] = prevPaths;
		rmSync(root, { recursive: true, force: true });
	}
});

test("same-name tool registered by another extension cannot satisfy addTools", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-other-");
	try {
		const { extensionPath, tools } = await registerOwnedToolFixture();
		const otherPath = join(root, "other-ext.ts");
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		captureExtensionToolOwnership({
			extensions: [{ path: otherPath, tools }],
			mounts: [
				{ id: "ext.owner", path: extensionPath },
				{ id: "ext.other", path: otherPath },
			],
		});
		const result = merge([
			{
				id: "ext.owner",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
			},
		]);
		const names = workerToolNames(byName(result, "narrow-role"), ["ext.owner", "ext.other"]);
		assert.equal(names.includes("owned_tool"), false);
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("unmounted or disabled extensions cannot add owned_tool", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-unmounted-");
	try {
		const { extensionPath, tools } = await registerOwnedToolFixture();
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		captureExtensionToolOwnership({
			extensions: [{ path: extensionPath, tools }],
			mounts: [{ id: "ext.owner", path: extensionPath }],
		});
		const result = merge([
			{
				id: "ext.owner",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
			},
		]);
		const agent = byName(result, "narrow-role");
		assert.equal(workerToolNames(agent, []).includes("owned_tool"), false);
		assert.equal(workerToolNames(agent, ["ext.disabled"]).includes("owned_tool"), false);
		resetExtensionToolOwnership();
		assert.equal(workerToolNames(agent, ["ext.owner"]).includes("owned_tool"), false);
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("snapshot providedTools cannot forge ownership", () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-forge-");
	try {
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		const result = merge([
			{
				id: "ext.forge",
				origin: "project",
				root,
				agents: [agentPath],
				providedTools: ["owned_tool"],
				patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
			},
		]);
		const agent = byName(result, "narrow-role");
		assert.deepEqual(agent.extensionToolRequests, [{ name: "owned_tool", extensionId: "ext.forge" }]);
		assert.equal(dispatchExtensionToolNames(["ext.forge"]).includes("owned_tool"), false);
		assert.equal(workerToolNames(agent, ["ext.forge"]).includes("owned_tool"), false);
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("bindCore capture maps loaded extension tools onto mounted ids", async () => {
	resetExtensionToolOwnership();
	const { extensionPath, tools } = await registerOwnedToolFixture();
	const prevMounted = process.env.PIPIUI_MOUNTED_EXTENSIONS;
	const prevPaths = process.env[REGISTERED_EXTENSION_PATHS_ENV];
	class FakeRunner {
		extensions: Array<{ path: string; tools: Array<{ name: string }> }> = [];
		bindCore() {
			return "bound";
		}
	}
	try {
		process.env.PIPIUI_MOUNTED_EXTENSIONS = "ext.owner";
		process.env[REGISTERED_EXTENSION_PATHS_ENV] = extensionPath;
		installExtensionToolOwnershipCapture(FakeRunner);
		const runner = new FakeRunner();
		runner.extensions = [{ path: extensionPath, tools }];
		assert.equal(runner.bindCore(), "bound");
		assert.equal(hasCapturedExtensionToolOwnership(), true);
		assert.equal(extensionToolOwnership().get("owned_tool"), "ext.owner");
		assert.equal(extensionToolOwnership().has("bash"), false);
	} finally {
		resetExtensionToolOwnership();
		if (prevMounted === undefined) delete process.env.PIPIUI_MOUNTED_EXTENSIONS;
		else process.env.PIPIUI_MOUNTED_EXTENSIONS = prevMounted;
		if (prevPaths === undefined) delete process.env[REGISTERED_EXTENSION_PATHS_ENV];
		else process.env[REGISTERED_EXTENSION_PATHS_ENV] = prevPaths;
	}
});

test("capture drops builtin/host/reserved names from the owned set", () => {
	resetExtensionToolOwnership();
	try {
		captureExtensionToolOwnership({
			extensions: [{
				path: "/ext/evil.ts",
				tools: [
					{ name: "owned_tool" },
					{ name: "bash" },
					{ name: "browser" },
					{ name: "computer" },
					{ name: "open_application" },
					{ name: "secretary_commit" },
					{ name: "memory_query" },
					{ name: "subagent" },
				],
			}],
			mounts: [{ id: "ext.evil", path: "/ext/evil.ts" }],
		});
		assert.equal(extensionToolOwnership().get("owned_tool"), "ext.evil");
		assert.equal(extensionToolOwnership().has("bash"), false);
		assert.equal(extensionToolOwnership().has("browser"), false);
		assert.equal(extensionToolOwnership().has("computer"), false);
		assert.equal(extensionToolOwnership().has("open_application"), false);
		assert.equal(extensionToolOwnership().has("secretary_commit"), false);
		assert.equal(extensionToolOwnership().has("memory_query"), false);
		assert.equal(extensionToolOwnership().has("subagent"), false);
	} finally {
		resetExtensionToolOwnership();
	}
});

test("two extensions registering the same tool: only Pi's first-wins owner can addTools", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-shared-");
	try {
		const a = await registerFixtureTools("./fixtures/shared-tool-extension-a.ts");
		const b = await registerFixtureTools("./fixtures/shared-tool-extension-b.ts");
		assert.deepEqual(a.tools.map((tool) => tool.name), ["shared_tool"]);
		assert.deepEqual(b.tools.map((tool) => tool.name), ["shared_tool"]);
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		captureExtensionToolOwnership({
			extensions: [
				{ path: a.extensionPath, tools: a.tools },
				{ path: b.extensionPath, tools: b.tools },
			],
			mounts: [
				{ id: "ext.a", path: a.extensionPath },
				{ id: "ext.b", path: b.extensionPath },
			],
		});
		assert.equal(extensionToolOwnership().get("shared_tool"), "ext.a");
		const fromWinner = merge([
			{
				id: "ext.a",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["shared_tool"] }],
			},
		]);
		assert.deepEqual(fromWinner.appliedPatches?.some((entry) => entry.addTools?.includes("shared_tool")), true);
		assert.equal(workerToolNames(byName(fromWinner, "narrow-role"), ["ext.a", "ext.b"]).includes("shared_tool"), true);

		resetExtensionToolOwnership();
		captureExtensionToolOwnership({
			extensions: [
				{ path: a.extensionPath, tools: a.tools },
				{ path: b.extensionPath, tools: b.tools },
			],
			mounts: [
				{ id: "ext.a", path: a.extensionPath },
				{ id: "ext.b", path: b.extensionPath },
			],
		});
		const fromLoser = merge([
			{
				id: "ext.b",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["shared_tool"] }],
			},
		]);
		assert.equal(byName(fromLoser, "narrow-role").extensionToolRequests, undefined);
		assert.equal((fromLoser.appliedPatches ?? []).some((entry) => entry.addTools?.includes("shared_tool")), false);
		assert.ok(fromLoser.diagnostics.some((entry) => entry.code === "contribution-add-tool-unowned"));
		assert.equal(workerToolNames(byName(fromLoser, "narrow-role"), ["ext.a", "ext.b"]).includes("shared_tool"), false);
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("host subagent_manage winner is never a third-party owner", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-manage-");
	try {
		const colliding = await registerFixtureTools("./fixtures/collide-manage-extension.ts");
		const hostPath = fileURLToPath(new URL("../index.ts", import.meta.url));
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		captureExtensionToolOwnership({
			winners: [
				{ name: "subagent_manage", path: hostPath, sourceInfo: { path: hostPath } },
				{ name: "subagent_manage", path: colliding.extensionPath, sourceInfo: { path: colliding.extensionPath } },
			],
			mounts: [{ id: "ext.evil", path: colliding.extensionPath }],
		});
		assert.equal(extensionToolOwnership().has("subagent_manage"), false);
		const result = merge([
			{
				id: "ext.evil",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["subagent_manage"] }],
			},
		]);
		assert.equal(byName(result, "narrow-role").extensionToolRequests, undefined);
		assert.equal((result.appliedPatches ?? []).some((entry) => entry.addTools?.includes("subagent_manage")), false);
		assert.ok(result.diagnostics.some((entry) => entry.code === "contribution-reserved-tool"));
		const patched = dispatchToolPatch(byName(result, "narrow-role"), ["ext.evil"]);
		assert.equal(patched.declaredTools?.includes("subagent_manage"), false);
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("symlink alias of another extension mount is ambiguous and grants no owner", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-symlink-a-");
	try {
		const a = await registerFixtureTools("./fixtures/shared-tool-extension-a.ts");
		const bLink = join(root, "b-alias.ts");
		symlinkSync(a.extensionPath, bLink);
		captureExtensionToolOwnership({
			winners: [
				{ name: "shared_tool", sourceInfo: { path: a.extensionPath } },
				{ name: "shared_tool", sourceInfo: { path: bLink } },
			],
			mounts: [
				{ id: "ext.a", path: a.extensionPath },
				{ id: "ext.b", path: bLink },
			],
		});
		assert.equal(extensionToolOwnership().has("shared_tool"), false);
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("symlink to host subagent entry cannot own subagent_manage", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-symlink-host-");
	try {
		const hostPath = fileURLToPath(new URL("../index.ts", import.meta.url));
		const bLink = join(root, "host-alias.ts");
		symlinkSync(hostPath, bLink);
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		captureExtensionToolOwnership({
			winners: [{ name: "subagent_manage", sourceInfo: { path: bLink } }],
			mounts: [{ id: "ext.evil", path: bLink }],
		});
		assert.equal(extensionToolOwnership().has("subagent_manage"), false);
		captureExtensionToolOwnership({
			winners: [{ name: "subagent_manage", sourceInfo: { path: hostPath } }],
			mounts: [{ id: "ext.evil", path: bLink }],
		});
		assert.equal(extensionToolOwnership().has("subagent_manage"), false);
		const result = merge([
			{
				id: "ext.evil",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["subagent_manage"] }],
			},
		]);
		assert.equal(byName(result, "narrow-role").extensionToolRequests, undefined);
		assert.ok(result.diagnostics.some((entry) => entry.code === "contribution-reserved-tool"));
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("duplicate canonical mount alias and forged env grant no owner", async () => {
	resetExtensionToolOwnership();
	const a = await registerFixtureTools("./fixtures/shared-tool-extension-a.ts");
	const prevMounted = process.env.PIPIUI_MOUNTED_EXTENSIONS;
	const prevPaths = process.env[REGISTERED_EXTENSION_PATHS_ENV];
	try {
		captureExtensionToolOwnership({
			winners: [{ name: "shared_tool", sourceInfo: { path: a.extensionPath } }],
			mounts: [
				{ id: "ext.a", path: a.extensionPath },
				{ id: "ext.b", path: a.extensionPath },
			],
		});
		assert.equal(extensionToolOwnership().has("shared_tool"), false);

		process.env.PIPIUI_MOUNTED_EXTENSIONS = ["ext.a", "ext.forge"].join(",");
		process.env[REGISTERED_EXTENSION_PATHS_ENV] = [a.extensionPath, a.extensionPath].join(
			process.platform === "win32" ? ";" : ":",
		);
		captureExtensionToolOwnership({
			winners: [{ name: "shared_tool", sourceInfo: { path: a.extensionPath } }],
		});
		assert.equal(extensionToolOwnership().has("shared_tool"), false);
	} finally {
		resetExtensionToolOwnership();
		if (prevMounted === undefined) delete process.env.PIPIUI_MOUNTED_EXTENSIONS;
		else process.env.PIPIUI_MOUNTED_EXTENSIONS = prevMounted;
		if (prevPaths === undefined) delete process.env[REGISTERED_EXTENSION_PATHS_ENV];
		else process.env[REGISTERED_EXTENSION_PATHS_ENV] = prevPaths;
	}
});

test("shadowed-name and duplicate-name messages omit absolute path fragments", () => {
	const root = tempRoot("pipiui-contrib-space-path-");
	try {
		const secretAgents = join(root, "Top Secret", "agents");
		const first = writePackage(join(root, "Top Secret"), "explore", { tools: "read", body: "user explore" });
		mkdirSync(join(secretAgents, "explore-dup"), { recursive: true });
		writeFileSync(
			join(secretAgents, "explore.md"),
			`---\nschema: 1\nname: collide\ndescription: flat collide\nmode: read-only\ncapabilities:\n  filesystem: read-only\n  shell: false\n  web: false\n  mcp: false\n  desktop: none\n  delegation: false\nworktree: none\ndeliverable: report\n---\nflat\n`,
		);
		writeFileSync(
			join(secretAgents, "collide.md"),
			`---\nschema: 1\nname: collide\ndescription: other collide\nmode: read-only\ncapabilities:\n  filesystem: read-only\n  shell: false\n  web: false\n  mcp: false\n  desktop: none\n  delegation: false\nworktree: none\ndeliverable: report\n---\nother\n`,
		);
		const discovered = discoverAgentsFromRoots(
			{ userDir: secretAgents, projectAgentsDir: null, pipiuiAgentsDir: agentsDir },
			"both",
		);
		const shadowed = discovered.diagnostics.filter((entry) => entry.code === "shadowed-name");
		const duplicates = discovered.diagnostics.filter((entry) => entry.code === "duplicate-name");
		assert.ok(shadowed.length > 0);
		assert.ok(duplicates.length > 0);
		for (const entry of [...shadowed, ...duplicates]) {
			assert.equal(entry.message.includes("Top Secret"), false, entry.message);
			assert.equal(entry.message.includes("AGENT.md"), false, entry.message);
			assert.equal(entry.message.includes(first), false, entry.message);
			assert.equal(entry.message.includes("/"), false, entry.message);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ghost_tool is a provisional request, never applied, and dispatch rejects it", () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-ghost-");
	try {
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		const result = merge([
			{
				id: "ext.ghost",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["ghost_tool"] }],
			},
		]);
		const agent = byName(result, "narrow-role");
		assert.deepEqual(agent.extensionToolRequests, [{ name: "ghost_tool", extensionId: "ext.ghost" }]);
		assert.equal((result.appliedPatches ?? []).some((entry) => entry.operations.includes("addTools")), false);
		assert.equal(agent.tools?.includes("ghost_tool"), false);
		const patched = dispatchToolPatch(agent, ["ext.ghost"]);
		assert.equal(patched.declaredTools?.includes("ghost_tool"), false);
		assert.ok(patched.diagnostics.some((entry) => entry.code === "contribution-add-tool-unregistered"));
		assert.equal(JSON.stringify(patched.diagnostics).includes("/"), false);
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("captured unique winner is recorded as applied; disabled/unmounted still cannot dispatch", async () => {
	resetExtensionToolOwnership();
	const root = tempRoot("pipiui-contrib-live-owner-");
	try {
		const { extensionPath, tools } = await registerOwnedToolFixture();
		const agentPath = writePackage(root, "narrow-role", { tools: "read, grep" });
		captureExtensionToolOwnership({
			extensions: [{ path: extensionPath, tools }],
			mounts: [{ id: "ext.owner", path: extensionPath }],
		});
		const result = merge([
			{
				id: "ext.owner",
				origin: "project",
				root,
				agents: [agentPath],
				patches: [{ target: "narrow-role", addTools: ["owned_tool"] }],
			},
		]);
		assert.deepEqual(result.appliedPatches, [{
			extensionId: "ext.owner",
			origin: "project",
			target: "narrow-role",
			operations: ["addTools"],
			addTools: ["owned_tool"],
		}]);
		assert.equal(workerToolNames(byName(result, "narrow-role"), ["ext.owner"]).includes("owned_tool"), true);
		assert.equal(workerToolNames(byName(result, "narrow-role"), []).includes("owned_tool"), false);
		const unmounted = dispatchToolPatch(byName(result, "narrow-role"), []);
		assert.ok(unmounted.diagnostics.some((entry) => entry.code === "contribution-add-tool-unmounted"));
	} finally {
		resetExtensionToolOwnership();
		rmSync(root, { recursive: true, force: true });
	}
});

test("getAllRegisteredTools first-wins sourceInfo maps only the unique owner", async () => {
	resetExtensionToolOwnership();
	const a = await registerFixtureTools("./fixtures/shared-tool-extension-a.ts");
	const b = await registerFixtureTools("./fixtures/shared-tool-extension-b.ts");
	class FakeRunner {
		extensions = [
			{ path: a.extensionPath, tools: a.tools },
			{ path: b.extensionPath, tools: b.tools },
		];
		bindCore() {
			return "bound";
		}
		getAllRegisteredTools() {
			return [
				{ definition: { name: "shared_tool" }, sourceInfo: { path: a.extensionPath } },
			];
		}
	}
	const prevMounted = process.env.PIPIUI_MOUNTED_EXTENSIONS;
	const prevPaths = process.env[REGISTERED_EXTENSION_PATHS_ENV];
	try {
		process.env.PIPIUI_MOUNTED_EXTENSIONS = ["ext.a", "ext.b"].join(",");
		process.env[REGISTERED_EXTENSION_PATHS_ENV] = [a.extensionPath, b.extensionPath].join(
			process.platform === "win32" ? ";" : ":",
		);
		installExtensionToolOwnershipCapture(FakeRunner);
		assert.equal(new FakeRunner().bindCore(), "bound");
		assert.equal(extensionToolOwnership().get("shared_tool"), "ext.a");
	} finally {
		resetExtensionToolOwnership();
		if (prevMounted === undefined) delete process.env.PIPIUI_MOUNTED_EXTENSIONS;
		else process.env.PIPIUI_MOUNTED_EXTENSIONS = prevMounted;
		if (prevPaths === undefined) delete process.env[REGISTERED_EXTENSION_PATHS_ENV];
		else process.env[REGISTERED_EXTENSION_PATHS_ENV] = prevPaths;
	}
});

test("addTools cannot grant bash/browser/computer/secretary_commit/memory/delegation outside the universe", () => {
	const root = tempRoot("pipiui-contrib-escalation-");
	try {
		const agentPath = writePackage(root, "no-shell", { tools: "read, grep", shell: false });
		const result = merge([
			{
				id: "ext.shell",
				origin: "project",
				root,
				agents: [agentPath],
				providedTools: ["bash", "browser", "computer", "secretary_commit", "memory_query", "subagent"],
				patches: [{
					target: "no-shell",
					addTools: ["bash", "browser", "computer", "secretary_commit", "memory_query", "subagent"],
				}],
			},
		]);
		const agent = byName(result, "no-shell");
		assert.equal(agent.capabilities.shell, false);
		assert.equal(agent.tools?.includes("bash"), false);
		assert.equal(agent.extensionToolRequests, undefined);
		assert.ok(result.diagnostics.some((entry) => entry.code === "contribution-add-tool-denied" && entry.message.includes("`bash`")));
		assert.ok(result.diagnostics.filter((entry) => entry.code === "contribution-reserved-tool").length >= 5);
		const patched = dispatchToolPatch(agent, ["ext.shell"], ["bash", "browser", "computer", "secretary_commit", "memory_query", "subagent"]);
		assert.equal(patched.declaredTools?.includes("bash"), false);
		assert.equal(patched.declaredTools?.includes("browser"), false);
		assert.equal(patched.declaredTools?.includes("computer"), false);
		assert.equal(patched.declaredTools?.includes("secretary_commit"), false);
		assert.equal(patched.declaredTools?.includes("subagent"), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reserved and host-issued addTools are denied", () => {
	const root = tempRoot("pipiui-contrib-reserved-");
	try {
		const before = byName(bundled, "explore").tools ?? [];
		const result = merge([
			{
				id: "ext.evil",
				origin: "project",
				root,
				providedTools: ["computer", "browser", "secretary_commit"],
				patches: [
					{
						target: "explore",
						addTools: [
							"browser",
							"computer",
							"open_application",
							"secretary_commit",
							"memory_query",
							"session_recall",
							"skill_load",
							"subagent",
						],
					},
				],
			},
		]);
		assert.ok(result.diagnostics.filter((entry) => entry.code === "contribution-reserved-tool").length >= 8);
		assert.deepEqual(byName(result, "explore").tools, before);
		assert.equal(byName(result, "explore").extensionToolRequests, undefined);
		const patched = dispatchToolPatch(byName(result, "explore"), ["ext.evil"]);
		const selection = resolveSubagentToolSelection({
			declaredTools: patched.declaredTools?.filter((name) => !isDelegationTool(name)),
			disabledTools: [],
			hasMemoryBrokerCapability: false,
			hasSessionRecall: false,
			hasSkillLoader: false,
			allowRecursiveDelegation: false,
			availableExtensionTools: ["fetch_content"],
		});
		assert.equal(selection.names.includes("browser"), false);
		assert.equal(selection.names.includes("computer"), false);
		assert.equal(selection.names.includes("open_application"), false);
		assert.equal(selection.names.includes("secretary_commit"), false);
		assert.equal(selection.names.includes("memory_query"), false);
		assert.equal(selection.names.includes("session_recall"), false);
		assert.equal(selection.names.includes("skill_load"), false);
		assert.equal(selection.names.includes("subagent"), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("legacy tools===undefined stays unconstrained; removeTools is extra-disabled only", () => {
	const parsed = validateAgentDefinition({
		filePath: "/tmp/legacy-role.md",
		content: "---\nname: legacy-role\ndescription: old flat file\n---\nlegacy body\n",
		source: "user",
		origin: "user",
		format: "legacy",
	});
	assert.ok(parsed.agent);
	assert.equal(parsed.agent.tools, undefined);
	const root = tempRoot("pipiui-contrib-legacy-");
	try {
		const result = applyExtensionAgentContributions(
			{ agents: [parsed.agent], projectAgentsDir: null, diagnostics: parsed.diagnostics },
			snapshotOf([
				{
					id: "ext.legacy",
					origin: "app",
					root,
					providedTools: ["my_ext_tool"],
					patches: [{ target: "legacy-role", addTools: ["my_ext_tool"], removeTools: ["bash"] }],
				},
			]),
		);
		const agent = byName(result, "legacy-role");
		assert.equal(agent.tools, undefined);
		assert.deepEqual(agent.extensionRemovedTools, ["bash"]);
		const patch = dispatchToolPatch(agent, ["ext.legacy"]);
		assert.equal(patch.declaredTools, undefined);
		assert.deepEqual(patch.extraDisabledTools, ["bash"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing patch target is diagnosed and does not crash discovery", () => {
	const root = tempRoot("pipiui-contrib-missing-");
	try {
		const result = merge([
			{
				id: "ext.missing",
				origin: "builtin",
				root,
				patches: [{ target: "no-such-agent", addTools: ["ls"] }],
			},
		]);
		assert.equal(codes(result).includes("contribution-target-missing"), true);
		assert.ok(result.agents.some((agent) => agent.name === "explore"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("illegal snapshot JSON, unknown fields, escaped paths, and missing files fail closed", () => {
	const invalid = parseExtensionAgentContributionSnapshot("{not-json");
	assert.equal(codes(invalid).includes("contribution-snapshot-invalid"), true);
	assert.deepEqual(invalid.extensions, []);

	const unknown = parseExtensionAgentContributionSnapshot(JSON.stringify({ version: 1, extensions: [], extra: true }));
	assert.equal(codes(unknown).includes("contribution-snapshot-invalid"), true);

	const oversize = parseExtensionAgentContributionSnapshot(`{"version":1,"extensions":${"[]".padStart(256 * 1024, " ")}}x`);
	assert.equal(codes(oversize).includes("contribution-snapshot-oversize") || codes(oversize).includes("contribution-snapshot-invalid"), true);

	const root = tempRoot("pipiui-contrib-escape-");
	const outside = tempRoot("pipiui-contrib-outside-");
	try {
		writeFileSync(join(outside, "secret.md"), "SECRET");
		const escaped = merge([
			{
				id: "ext.escape",
				origin: "project",
				root,
				agents: [join(outside, "agents", "x", "AGENT.md")],
			},
		]);
		assert.equal(
			codes(escaped).includes("contribution-path-escape") || codes(escaped).includes("contribution-missing-file"),
			true,
		);
		assert.equal(escaped.agents.some((agent) => agent.filePath.includes("secret.md")), false);

		writePrompt(root, "inside.md", "ok");
		symlinkSync(join(outside, "secret.md"), join(root, "link.md"));
		const linked = merge([
			{
				id: "ext.link",
				origin: "app",
				root,
				patches: [{ target: "explore", appendPrompt: join(root, "link.md") }],
			},
		]);
		assert.equal(codes(linked).includes("contribution-path-escape"), true);
		assert.doesNotMatch(byName(linked, "explore").systemPrompt, /SECRET/);

		const missingPrompt = merge([
			{
				id: "ext.gone",
				origin: "builtin",
				root,
				patches: [{ target: "explore", appendPrompt: join(root, "nope.md") }],
			},
		]);
		assert.equal(codes(missingPrompt).includes("contribution-missing-file"), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("schema:1 parser is not relaxed for contributed packages", () => {
	const root = tempRoot("pipiui-contrib-schema-");
	try {
		const agentPath = writePackage(root, "bad-role", { schema: "schema: 2" });
		const result = merge([
			{
				id: "ext.bad",
				origin: "project",
				root,
				agents: [agentPath],
			},
		]);
		assert.equal(result.agents.some((agent) => agent.name === "bad-role"), false);
		assert.ok(result.diagnostics.some((entry) => entry.code === "invalid-schema"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("discoverAgents, recovery, and nested dispatch share the same merged discovery", () => {
	assert.equal((runtimeIndex.match(/discoverAgents\(/g) ?? []).length >= 3, true);
	assert.equal(runtimeIndex.includes("discoverAgentsFromRoots("), false);
	assert.match(runtimeIndex, /const discovery = discoverAgents\(cwd, "both"\)/);
	assert.match(runtimeIndex, /const discovery = discoverAgents\(ctx.cwd, agentScope\)/);
	assert.match(runtimeIndex, /discoverAgents\(process.cwd\(\), "user"\)/);
	assert.match(runtimeIndex, /dispatchToolPatch\(\s*agent,\s*mountedExtensionIds,\s*extensionToolOwnership\(\),\s*\)/);
	assert.match(runtimeIndex, /installExtensionToolOwnershipCapture\(ExtensionRunner\)/);

	const root = tempRoot("pipiui-contrib-discover-");
	const prev = process.env[EXT_AGENT_CONTRIBUTIONS_ENV];
	const prevAgents = process.env.PIPIUI_AGENTS_DIR;
	const prevHome = process.env.PI_CODING_AGENT_DIR;
	try {
		const agentPath = writePackage(root, "env-researcher");
		process.env.PIPIUI_AGENTS_DIR = agentsDir;
		process.env.PI_CODING_AGENT_DIR = root;
		process.env[EXT_AGENT_CONTRIBUTIONS_ENV] = JSON.stringify({
			version: 1,
			extensions: [
				{
					id: "ext.env",
					origin: "project",
					root,
					agents: [agentPath],
					patches: [{ target: "explore", addTools: ["ls"] }],
				},
			],
		});
		const loaded = loadExtensionAgentContributionSnapshot();
		assert.equal(loaded.extensions[0]?.id, "ext.env");
		const cwd = tempRoot("pipiui-contrib-cwd-");
		try {
			const discovered = discoverAgents(cwd, "both");
			assert.ok(discovered.agents.some((agent) => agent.name === "env-researcher"));
			assert.ok(discovered.agents.some((agent) => agent.name === "explore"));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	} finally {
		if (prev === undefined) delete process.env[EXT_AGENT_CONTRIBUTIONS_ENV];
		else process.env[EXT_AGENT_CONTRIBUTIONS_ENV] = prev;
		if (prevAgents === undefined) delete process.env.PIPIUI_AGENTS_DIR;
		else process.env.PIPIUI_AGENTS_DIR = prevAgents;
		if (prevHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prevHome;
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar file env: session-root realpath jail, regular 0600 file, main/worker parity", () => {
	const root = tempRoot("pipiui-contrib-sidecar-");
	try {
		const sessionDir = join(root, "sessions", "proj");
		mkdirSync(sessionDir, { recursive: true });
		const sidecar = join(sessionDir, "chat-1.ext-agent-contributions.json");
		writeFileSync(sidecar, JSON.stringify({
			version: 1,
			extensions: [{
				id: "ext.file",
				origin: "project",
				root,
				agents: [],
				patches: [],
			}],
		}), { mode: 0o600 });
		const env = {
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: sidecar,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		};
		const main = loadExtensionAgentContributionSnapshot(env);
		const worker = loadExtensionAgentContributionSnapshot(env);
		assert.deepEqual(main.diagnostics, worker.diagnostics);
		assert.deepEqual(main.extensions.map((entry) => entry.id), ["ext.file"]);
		assert.equal(worker.extensions[0]?.id, "ext.file");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar file env fails closed without a session root env", () => {
	const root = tempRoot("pipiui-contrib-noroot-");
	try {
		const sidecar = join(root, "chat.ext-agent-contributions.json");
		writeFileSync(sidecar, JSON.stringify({ version: 1, extensions: [] }), { mode: 0o600 });
		const loaded = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: sidecar,
		});
		assert.equal(loaded.extensions.length, 0);
		assert.ok(loaded.diagnostics.some((entry) => entry.code === "contribution-snapshot-invalid"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar file env rejects a symlinked file and never reads the target", () => {
	const root = tempRoot("pipiui-contrib-fileslink-");
	try {
		const sessionDir = join(root, "sessions", "proj");
		mkdirSync(sessionDir, { recursive: true });
		const victim = join(root, "victim.json");
		writeFileSync(victim, JSON.stringify({ version: 1, extensions: [] }), { mode: 0o600 });
		const sidecar = join(sessionDir, "chat-1.ext-agent-contributions.json");
		symlinkSync(victim, sidecar);
		const loaded = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: sidecar,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(loaded.extensions.length, 0);
		assert.ok(loaded.diagnostics.some((entry) => entry.code === "contribution-snapshot-invalid"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar file env rejects a symlinked file whose target is inside the same jail", () => {
	const root = tempRoot("pipiui-contrib-fileslink2-");
	try {
		const sessionDir = join(root, "sessions", "proj");
		mkdirSync(sessionDir, { recursive: true });
		const body = JSON.stringify({
			version: 1,
			extensions: [{ id: "ext.decoy", origin: "project", root, agents: [], patches: [] }],
		});
		const target = join(sessionDir, "real-snapshot.json");
		writeFileSync(target, body, { mode: 0o600 });
		const sidecar = join(sessionDir, "chat-1.ext-agent-contributions.json");
		symlinkSync(target, sidecar);
		const loaded = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: sidecar,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(loaded.extensions.length, 0);
		assert.ok(loaded.diagnostics.some((entry) => entry.code === "contribution-snapshot-invalid"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar file env rejects files outside the session-owned jail", () => {
	const root = tempRoot("pipiui-contrib-jail-");
	try {
		const sessionDir = join(root, "sessions", "proj");
		mkdirSync(sessionDir, { recursive: true });
		const outsideDir = join(root, "elsewhere");
		mkdirSync(outsideDir, { recursive: true });
		const outside = join(outsideDir, "chat-1.ext-agent-contributions.json");
		writeFileSync(outside, JSON.stringify({ version: 1, extensions: [] }), { mode: 0o600 });
		const loaded = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: outside,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(loaded.extensions.length, 0);
		assert.ok(loaded.diagnostics.some((entry) => entry.code === "contribution-snapshot-invalid"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar file env rejects group/other-readable files, hard links, and foreign names", () => {
	const root = tempRoot("pipiui-contrib-perm-");
	try {
		const sessionDir = join(root, "sessions", "proj");
		mkdirSync(sessionDir, { recursive: true });
		const body = JSON.stringify({ version: 1, extensions: [] });
		const permissive = join(sessionDir, "chat-1.ext-agent-contributions.json");
		writeFileSync(permissive, body, { mode: 0o644 });
		const permissiveLoad = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: permissive,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(permissiveLoad.extensions.length, 0);
		assert.ok(permissiveLoad.diagnostics.some((entry) => entry.message.includes("owner-only")));

		rmSync(permissive);
		const original = join(root, "original.json");
		writeFileSync(original, body, { mode: 0o600 });
		const linked = join(sessionDir, "chat-2.ext-agent-contributions.json");
		linkSync(original, linked);
		const linkedLoad = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: linked,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(linkedLoad.extensions.length, 0);
		assert.ok(linkedLoad.diagnostics.some((entry) => entry.message.includes("hard-linked")));

		const foreign = join(sessionDir, "chat-3.json");
		writeFileSync(foreign, body, { mode: 0o600 });
		const foreignLoad = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: foreign,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(foreignLoad.extensions.length, 0);
		assert.ok(foreignLoad.diagnostics.some((entry) => entry.message.includes("must end with")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar read fails closed when the inode is swapped after lstat", () => {
	const root = tempRoot("pipiui-contrib-inodeswap-");
	try {
		const sessionDir = join(root, "sessions", "proj");
		mkdirSync(sessionDir, { recursive: true });
		const sidecar = join(sessionDir, "chat-1.ext-agent-contributions.json");
		writeFileSync(sidecar, JSON.stringify({
			version: 1,
			extensions: [{ id: "ext.original", origin: "project", root, agents: [], patches: [] }],
		}), { mode: 0o600 });
		const decoy = join(sessionDir, "decoy.json");
		writeFileSync(decoy, JSON.stringify({
			version: 1,
			extensions: [{ id: "ext.swapped", origin: "project", root, agents: [], patches: [] }],
		}), { mode: 0o600 });
		setContributionSidecarReadProbeForTest({
			afterLstat(filePath) {
				rmSync(filePath);
				renameSync(decoy, filePath);
			},
		});
		const loaded = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: sidecar,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(loaded.extensions.length, 0);
		assert.equal(loaded.extensions.some((entry) => entry.id === "ext.swapped"), false);
		assert.equal(loaded.extensions.some((entry) => entry.id === "ext.original"), false);
		assert.ok(loaded.diagnostics.some((entry) => entry.code === "contribution-snapshot-invalid"));
	} finally {
		setContributionSidecarReadProbeForTest(undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test("sidecar read fails closed when the path is replaced after open", () => {
	const root = tempRoot("pipiui-contrib-openrace-");
	try {
		const sessionDir = join(root, "sessions", "proj");
		mkdirSync(sessionDir, { recursive: true });
		const sidecar = join(sessionDir, "chat-1.ext-agent-contributions.json");
		writeFileSync(sidecar, JSON.stringify({
			version: 1,
			extensions: [{ id: "ext.original", origin: "project", root, agents: [], patches: [] }],
		}), { mode: 0o600 });
		const replacement = join(sessionDir, "replacement.json");
		writeFileSync(replacement, JSON.stringify({
			version: 1,
			extensions: [{ id: "ext.escaped", origin: "project", root, agents: [], patches: [] }],
		}), { mode: 0o600 });
		setContributionSidecarReadProbeForTest({
			afterOpen(filePath) {
				rmSync(filePath);
				renameSync(replacement, filePath);
			},
		});
		const loaded = loadExtensionAgentContributionSnapshot({
			[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]: sidecar,
			[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]: sessionDir,
		});
		assert.equal(loaded.extensions.length, 0);
		assert.equal(loaded.extensions.some((entry) => entry.id === "ext.escaped"), false);
		assert.equal(loaded.extensions.some((entry) => entry.id === "ext.original"), false);
		assert.ok(loaded.diagnostics.some((entry) => entry.code === "contribution-snapshot-invalid"));
	} finally {
		setContributionSidecarReadProbeForTest(undefined);
		rmSync(root, { recursive: true, force: true });
	}
});

test("appliedPatches omit rejected canonical replacePrompt and reserved addTools", () => {
	const root = tempRoot("pipiui-contrib-fake-success-");
	try {
		const replaced = writePrompt(root, "prompts/nope.md", "SHOULD NOT LAND");
		const result = merge([
			{
				id: "ext.fake",
				origin: "project",
				root,
				patches: [{
					target: "secretary",
					replacePrompt: replaced,
					addTools: ["computer", "browser", "secretary_commit"],
				}],
			},
		]);
		assert.equal(codes(result).includes("contribution-replace-forbidden"), true);
		assert.ok(result.diagnostics.some((entry) => entry.code === "contribution-reserved-tool"));
		assert.deepEqual(result.appliedPatches ?? [], []);
		assert.doesNotMatch(byName(result, "secretary").systemPrompt, /SHOULD NOT LAND/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("appliedPatches record only operations that actually succeeded", () => {
	const root = tempRoot("pipiui-contrib-partial-");
	try {
		const replaced = writePrompt(root, "prompts/nope.md", "SHOULD NOT LAND");
		const appended = writePrompt(root, "prompts/ok.md", "PARTIAL APPEND");
		const result = merge([
			{
				id: "ext.partial",
				origin: "project",
				root,
				patches: [
					{ target: "secretary", replacePrompt: replaced, addTools: ["computer"] },
					{
						target: "explore",
						appendPrompt: appended,
						addTools: ["code_search", "computer", "write"],
						removeTools: ["arxiv_fetch"],
					},
				],
			},
		]);
		assert.equal(codes(result).includes("contribution-replace-forbidden"), true);
		assert.equal(codes(result).includes("contribution-reserved-tool"), true);
		assert.equal(codes(result).includes("contribution-add-tool-denied"), true);
		assert.match(byName(result, "explore").systemPrompt, /PARTIAL APPEND/);
		assert.doesNotMatch(byName(result, "secretary").systemPrompt, /SHOULD NOT LAND/);
		assert.deepEqual(result.appliedPatches, [{
			extensionId: "ext.partial",
			origin: "project",
			target: "explore",
			operations: ["appendPrompt", "addTools", "removeTools"],
			addTools: ["code_search"],
			removeTools: ["arxiv_fetch"],
		}]);
		assert.equal(JSON.stringify(result.appliedPatches).includes(replaced), false);
		assert.equal(JSON.stringify(result.appliedPatches).includes("computer"), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("contribution diagnostics use extension labels and omit absolute paths", () => {
	const root = tempRoot("pipiui-contrib-nopath-");
	const outside = tempRoot("pipiui-contrib-nopath-out-");
	try {
		writeFileSync(join(outside, "secret.md"), "SECRET_BODY");
		const conflict = writePackage(root, "explore", { body: "injected" });
		const result = merge([
			{
				id: "ext.nopath",
				origin: "project",
				root,
				agents: [conflict],
				patches: [
					{ target: "explore", appendPrompt: join(root, "missing.md") },
					{ target: "explore", appendPrompt: join(outside, "secret.md") },
				],
			},
		]);
		const blob = JSON.stringify(result.diagnostics);
		assert.equal(blob.includes(root), false);
		assert.equal(blob.includes(outside), false);
		assert.equal(blob.includes("SECRET_BODY"), false);
		assert.ok(result.diagnostics.every((entry) => !entry.filePath || entry.filePath === "ext.nopath" || entry.filePath === "explore"));
		assert.ok(codes(result).includes("contribution-name-conflict"));
		assert.ok(codes(result).includes("contribution-missing-file") || codes(result).includes("contribution-path-escape"));
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});
