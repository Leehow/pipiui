import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	discoverBundledAgentsFromDirectory,
	READONLY_RETRIEVAL_TOOL_NAMES,
	summarizeAgentPermissions,
	validateAgentDefinition,
} from "../agents.ts";
import {
	MEMORY_BROKER_TOOL_NAMES,
	RESERVED_DESKTOP_TOOL_NAMES,
	SESSION_RECALL_TOOL_NAME,
	SKILL_LOADER_TOOL_NAMES,
	diagnoseWorkerReadToolOmissions,
	formatWorkerReadToolOmissions,
	resolveSubagentToolSelection,
	resolveWorkerSkillLoaderPath,
	workerSkillLoaderMountArgs,
} from "../desktop-tool-policy.mjs";
import { runtimeRolePolicyForAgent } from "../runtime-policy.ts";
import {
	resolveSkillRoots,
	shouldInjectSkillCatalog,
	default as installSkillLoader,
} from "../../../extensions/pipiui-skillloader.ts";
import { InMemoryMemoryBackend } from "../../packages/memory-broker/src/backend.ts";
import {
	installMemoryBrokerExtension,
	issueMainMemoryBrokerChildEnvironment,
} from "../../packages/memory-broker/src/extension.ts";
import {
	currentMemoryBrokerPackageIdentity,
	issuedMemoryBrokerPackageIdentity,
} from "../../packages/memory-broker/src/runtime-identity.ts";

const agentsDir = fileURLToPath(new URL("../../agents", import.meta.url));
const runtimeIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const bundledSkillLoader = fileURLToPath(
	new URL("../../../extensions/pipiui-skillloader.ts", import.meta.url),
);
const childProbePath = fileURLToPath(
	new URL("./fixtures/worker-read-tools-child.ts", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));
const bundled = discoverBundledAgentsFromDirectory(agentsDir);

const MUTATION_TOOLS = [
	"memory_add",
	"memory_replace",
	"memory_remove",
	"skill_manage",
	"subagent_manage",
] as const;

const DESKTOP_MUTATION_TOOLS = RESERVED_DESKTOP_TOOL_NAMES;
const BUILTIN_ROLES = ["explore", "general-purpose", "reviewer"] as const;
const REQUIRED_READ_TOOLS = [
	"skill_search",
	"skill_load",
	"session_recall",
	"memory_status",
	"memory_query",
] as const;
const FIXTURE_CLAIM = "Fixture memory claim for worker read-tool acceptance.";
const FIXTURE_SKILL = "fixture-worker-skill";
const CHILD_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 15_000;

type ProbeReport = {
	ok: boolean;
	error?: string;
	scenario?: string;
	role?: string;
	registeredTools?: string[];
	roots?: string[];
	injectsCatalog?: boolean;
	prompt?: string;
	globalPiExcluded?: boolean;
	memoryQuery?: { present: boolean; text: string; details: Record<string, unknown>; isError: boolean; error?: string };
	memoryStatus?: { present: boolean; text: string; details: Record<string, unknown>; isError: boolean; error?: string };
	skillSearch?: { present: boolean; text: string; details: Record<string, unknown>; isError: boolean; error?: string };
	skillLoad?: { present: boolean; text: string; details: Record<string, unknown>; isError: boolean; error?: string };
};

function parsePackage(name: string, frontmatter: string) {
	return validateAgentDefinition({
		filePath: `/tmp/${name}/AGENT.md`,
		content: `---\n${frontmatter}\n---\nbody\n`,
		source: "project",
		origin: "bundled",
		format: "package",
		directoryName: name,
	});
}

function selection(partial: Parameters<typeof resolveSubagentToolSelection>[0]) {
	return resolveSubagentToolSelection({
		disabledTools: [],
		hasDesktopCapability: false,
		allowRecursiveDelegation: false,
		availableExtensionTools: ["fetch_content", "source_check", "get_search_content", "arxiv_fetch"],
		...partial,
	});
}

function fakePi() {
	const tools = new Map<string, { name: string; execute?: (...args: unknown[]) => unknown }>();
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	return {
		tools,
		handlers,
		api: {
			on(event: string, handler: (...args: unknown[]) => unknown) {
				const values = handlers.get(event) ?? [];
				values.push(handler);
				handlers.set(event, values);
			},
			registerTool(tool: { name: string }) {
				tools.set(tool.name, tool);
			},
			registerCommand() {},
		},
	};
}

test("spawn still isolates automatic skills and mounts the bundled skillloader", () => {
	assert.match(runtimeIndex, /args\.push\("--no-skills"\)/);
	assert.match(runtimeIndex, /args\.push\("--no-extensions"\)/);
	assert.match(runtimeIndex, /workerSkillLoaderMountArgs\(workerSkillLoaderPath/);
	assert.match(runtimeIndex, /hasSkillLoader: Boolean\(workerSkillLoaderPath\)/);
	assert.match(runtimeIndex, /PIPIUI_SUBAGENT_SKILL_ISOLATION: "1"/);
	assert.doesNotMatch(runtimeIndex, /args\.push\("--skills"\)/);
	assert.match(runtimeIndex, /loading is never a mandatory gate/);
	assert.doesNotMatch(runtimeIndex, /you MUST NOT load, read, or follow using-superpowers/);

	const mounted = workerSkillLoaderMountArgs(bundledSkillLoader);
	assert.deepEqual(mounted, ["-e", bundledSkillLoader]);
	assert.deepEqual(workerSkillLoaderMountArgs(bundledSkillLoader, { computerWorker: true }), []);
	assert.equal(
		resolveWorkerSkillLoaderPath({ env: { PIPIUI_SKILLLOADER_EXT: "/host/pipiui-skillloader.ts" } }),
		"/host/pipiui-skillloader.ts",
	);
	assert.equal(
		resolveWorkerSkillLoaderPath({
			env: {},
			bundledPath: bundledSkillLoader,
			existsSync: (candidate) => candidate === bundledSkillLoader,
		}),
		bundledSkillLoader,
	);
	assert.equal(resolveWorkerSkillLoaderPath({ env: {}, bundledPath: bundledSkillLoader, existsSync: () => false }), undefined);
});

test("filesystem roles compile skill and memory read tools; plan-compatible custom workers match", () => {
	for (const name of BUILTIN_ROLES) {
		const agent = bundled.agents.find((item) => item.name === name);
		assert.ok(agent, name);
		for (const tool of READONLY_RETRIEVAL_TOOL_NAMES) {
			assert.ok(agent.tools?.includes(tool), `${name} missing ${tool}`);
		}
		for (const tool of MUTATION_TOOLS) {
			assert.equal(agent.tools?.includes(tool) ?? false, false, `${name} leaked ${tool}`);
		}
		assert.equal(agent.tools?.includes("edit") ?? false, name === "general-purpose", name);
		assert.equal(agent.tools?.some((tool) => RESERVED_DESKTOP_TOOL_NAMES.includes(tool)) ?? false, false, name);
	}

	const plan = parsePackage("plan", [
		"schema: 1",
		"name: plan",
		"description: planning",
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
	].join("\n"));
	assert.deepEqual(plan.diagnostics.filter((item) => item.severity === "error"), []);
	assert.ok(plan.agent);
	for (const tool of ["skill_search", "skill_load", "memory_query", "memory_status"]) {
		assert.ok(plan.agent.tools?.includes(tool), `plan missing ${tool}`);
		assert.ok(summarizeAgentPermissions(plan.agent).capabilityTools?.includes(tool), tool);
	}
	assert.equal(plan.agent.tools?.includes("edit") ?? false, false);
});

test("resolver fail-closes memory without capability and grants both read tools when present", () => {
	const declared = ["read", "grep", "memory_query", "memory_status", "skill_search", "skill_load", "session_recall"];
	const closed = selection({
		declaredTools: declared,
		hasMemoryBrokerCapability: false,
		hasSessionRecall: true,
		hasSkillLoader: true,
	});
	assert.equal(closed.flag, "--tools");
	assert.equal(closed.names.includes("memory_query"), false);
	assert.equal(closed.names.includes("memory_status"), false);
	assert.ok(closed.names.includes("session_recall"));
	assert.ok(closed.names.includes("skill_search"));
	assert.ok(closed.names.includes("skill_load"));

	const open = selection({
		declaredTools: ["read", "grep"],
		hasMemoryBrokerCapability: true,
		hasSessionRecall: true,
		hasSkillLoader: true,
	});
	for (const name of [...MEMORY_BROKER_TOOL_NAMES, SESSION_RECALL_TOOL_NAME, ...SKILL_LOADER_TOOL_NAMES]) {
		assert.ok(open.names.includes(name), name);
	}
	for (const name of MUTATION_TOOLS) {
		assert.equal(open.names.includes(name), false, name);
	}

	const invalid = diagnoseWorkerReadToolOmissions({
		hasMemoryBrokerCapability: false,
		hasSessionRecall: true,
		hasSkillLoader: true,
		memoryOmissionReason: "package-not-verified",
	});
	assert.equal(invalid.memory_query, "package-not-verified");
	assert.equal(invalid.memory_status, "package-not-verified");
	assert.equal(invalid.session_recall, undefined);
	assert.match(formatWorkerReadToolOmissions(invalid), /memory_query=package-not-verified/);
});

test("role security is unchanged: no desktop, no mutation, no implicit skill bootstrap", () => {
	for (const name of BUILTIN_ROLES) {
		const agent = bundled.agents.find((item) => item.name === name);
		assert.ok(agent, name);
		const tools = selection({
			declaredTools: agent.tools,
			hasMemoryBrokerCapability: true,
			hasSessionRecall: true,
			hasSkillLoader: true,
			allowRecursiveDelegation: name === "general-purpose",
		}).names;
		assert.equal(tools.some((tool) => RESERVED_DESKTOP_TOOL_NAMES.includes(tool as typeof RESERVED_DESKTOP_TOOL_NAMES[number])), false, name);
		for (const tool of MUTATION_TOOLS) assert.equal(tools.includes(tool), false, `${name} ${tool}`);
		if (name !== "general-purpose") {
			assert.equal(tools.includes("edit"), false, name);
			assert.equal(tools.includes("write"), false, name);
		}
	}
});

test("skill roots stay project-local and skip automatic catalog under isolation", () => {
	const projectHome = "/tmp/project/.pi/agent";
	const bundledRoot = "/runtime/built-in-skills";
	const extraRoot = "/tmp/project/.pi/agent/extra-skills";
	const roots = resolveSkillRoots({
		PIPIUI_BUILT_IN_SKILL_ROOT: bundledRoot,
		PIPIUI_SKILL_ROOTS: `${extraRoot}${delimiter}${join(homedir(), ".pi", "skills")}`,
		PI_CODING_AGENT_DIR: projectHome,
	} as NodeJS.ProcessEnv);
	assert.ok(roots.includes(bundledRoot));
	assert.ok(roots.includes(join(projectHome, "skills")));
	assert.ok(roots.includes(extraRoot));
	assert.equal(roots.some((root) => root.includes(`${join(homedir(), ".pi")}`)), false);

	const globalHome = resolveSkillRoots({
		PI_CODING_AGENT_DIR: join(homedir(), ".pi", "agent"),
		PIPIUI_SKILL_ROOTS: join(homedir(), ".pi"),
	} as NodeJS.ProcessEnv);
	assert.equal(globalHome.some((root) => root.startsWith(join(homedir(), ".pi"))), false);

	assert.equal(shouldInjectSkillCatalog({ PIPIUI_SUBAGENT_SKILL_ISOLATION: "1" }), false);
	assert.equal(shouldInjectSkillCatalog({}), true);

	const pi = fakePi();
	installSkillLoader(pi.api as never);
	const hook = pi.handlers.get("before_agent_start")?.[0];
	assert.ok(hook);
	const previous = process.env.PIPIUI_SUBAGENT_SKILL_ISOLATION;
	process.env.PIPIUI_SUBAGENT_SKILL_ISOLATION = "1";
	try {
		const next = hook({
			systemPrompt: "base\n\n<available_skills>\nsecret catalog\n</available_skills>",
		}) as { systemPrompt?: string } | undefined;
		const prompt = next?.systemPrompt ?? "";
		assert.doesNotMatch(prompt, /<available_skills>/);
		assert.doesNotMatch(prompt, /secret catalog/);
	} finally {
		if (previous === undefined) delete process.env.PIPIUI_SUBAGENT_SKILL_ISOLATION;
		else process.env.PIPIUI_SUBAGENT_SKILL_ISOLATION = previous;
	}
	assert.ok(pi.tools.has("skill_search"));
	assert.ok(pi.tools.has("skill_load"));
	assert.equal(pi.tools.has("skill_manage"), false);
});

test("memory child tools register only with a valid capability and stay read-only", async () => {
	const closed = fakePi();
	await installMemoryBrokerExtension(closed.api as never, {}, {
		PIPIUI_MEMORY_BROKER_MODE: "worker",
		PIPIUI_AGENT_ROLE: "worker",
	});
	assert.equal(closed.tools.has("memory_query"), false);
	assert.equal(closed.tools.has("memory_status"), false);

	const open = fakePi();
	await installMemoryBrokerExtension(open.api as never, {}, {
		PIPIUI_MEMORY_BROKER_MODE: "worker",
		PIPIUI_AGENT_ROLE: "worker",
		PIPIUI_MEMORY_BROKER_URL: "http://127.0.0.1:9/v1/memory",
		PIPIUI_MEMORY_BROKER_TOKEN: "t".repeat(43),
		PIPIUI_MEMORY_BROKER_CAPABILITY: "c".repeat(32),
		PIPIUI_AGENT_ID: "explore-1",
		PIPIUI_AGENT_RUN_ID: "run-1",
		PIPIUI_MEMORY_PROJECT_ROOT: "/tmp/project",
	});
	assert.ok(open.tools.has("memory_query"));
	assert.ok(open.tools.has("memory_status"));
	assert.equal(open.tools.has("memory_add"), false);
	assert.equal(open.tools.has("memory_replace"), false);
	assert.equal(open.tools.has("memory_remove"), false);
});

function listIfExists(directory: string): string[] {
	try {
		return readdirSync(directory).sort();
	} catch {
		return [];
	}
}

function parseProbeReport(stdout: string): ProbeReport {
	const lines = stdout.trim().split(/\r?\n/).reverse();
	for (const line of lines) {
		try {
			return JSON.parse(line) as ProbeReport;
		} catch {
			// Child may emit a banner line; keep scanning for the JSON report.
		}
	}
	throw new Error(`child produced no JSON report: ${stdout.slice(0, 800)}`);
}

function assertNoForbiddenTools(tools: string[], label: string): void {
	for (const name of [...MUTATION_TOOLS, ...DESKTOP_MUTATION_TOOLS]) {
		assert.equal(tools.includes(name), false, `${label} leaked ${name}`);
	}
}

function assertRequiredReadTools(tools: string[], label: string): void {
	for (const name of REQUIRED_READ_TOOLS) {
		assert.ok(tools.includes(name), `${label} missing ${name}`);
	}
}

function flipCapability(value: string): string {
	const last = value.slice(-1);
	return `${value.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

async function writeSkill(root: string, name: string, description: string, body: string): Promise<void> {
	const directory = join(root, name);
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
		"utf8",
	);
}

function spawnProbe(env: NodeJS.ProcessEnv): {
	child: ChildProcessWithoutNullStreams;
	done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>;
} {
	const child = spawn(
		process.execPath,
		["--experimental-strip-types", "--no-warnings=MODULE_TYPELESS_PACKAGE_JSON", childProbePath],
		{
			cwd: fileURLToPath(new URL(".", import.meta.url)),
			env,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: CHILD_TIMEOUT_MS,
		},
	);
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});
	const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
		const timer = setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
			reject(new Error(`child timed out after ${CHILD_TIMEOUT_MS}ms`));
		}, CHILD_TIMEOUT_MS + 250);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, stdout, stderr });
		});
	});
	return { child, done };
}

async function terminateOwnChild(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		new Promise<void>((resolve) => child.once("close", () => resolve())),
		new Promise<void>((resolve) => setTimeout(resolve, 500)),
	]);
	if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function listenerGone(url: string): Promise<boolean> {
	try {
		await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(400) });
		return false;
	} catch {
		return true;
	}
}

test("production spawn exposes signed read-only tools and fail-closes negatives", { timeout: TEST_TIMEOUT_MS }, async () => {
	const sessionDir = join(repoRoot, ".pi", "agent", "sessions");
	const attributionPath = join(repoRoot, ".pi", "agent", "retrieval-attribution.jsonl");
	const sessionsBefore = listIfExists(sessionDir);
	const attributionBefore = existsSync(attributionPath) ? await readFile(attributionPath, "utf8") : "";
	const tmp = await mkdtemp(join(tmpdir(), "pipiui-worker-read-tools-"));
	const projectRoot = join(tmp, "project");
	const agentHome = join(projectRoot, ".pi", "agent");
	const bundledRoot = join(tmp, "bundled-skills");
	const extraRoot = join(agentHome, "extra-skills");
	const children = new Set<ChildProcessWithoutNullStreams>();
	const previousEnv: Record<string, string | undefined> = {};
	const envKeys = [
		"PIPIUI_MEMORY_BROKER_MODE",
		"PIPIUI_MEMORY_BROKER_URL",
		"PIPIUI_MEMORY_BROKER_TOKEN",
		"PIPIUI_MEMORY_BROKER_CAPABILITY",
		"PIPIUI_MEMORY_PROJECT_ROOT",
		"PIPIUI_MEMORY_BROKER_PACKAGE_ROOT",
		"PIPIUI_MEMORY_BROKER_EXTENSION",
		"PIPIUI_MEMORY_BROKER_PACKAGE_VERSION",
		"PIPIUI_MEMORY_BROKER_STATE_DIR",
		"PIPIUI_MEMORY_CHAT_SESSION_ID",
		"PIPIUI_MEMORY_CATALOG_DIR",
		"PI_CODING_AGENT_DIR",
		"PIPIUI_ACTIVE_PROJECT_PI_HOME",
		"PIPIUI_SUBAGENT_SKILL_ISOLATION",
		"PIPIUI_BUILT_IN_SKILL_ROOT",
		"PIPIUI_SKILL_ROOTS",
	];
	for (const key of envKeys) previousEnv[key] = process.env[key];

	const backend = new InMemoryMemoryBackend({
		results: [{ claim: FIXTURE_CLAIM, score: 0.97 }],
		ready: true,
		detail: "in-memory fixture broker",
	});
	const host = fakePi();
	let shutdown: ((...args: unknown[]) => unknown) | undefined;
	let brokerUrl: string | undefined;

	try {
		await mkdir(join(agentHome, "skills"), { recursive: true });
		await writeSkill(join(agentHome, "skills"), FIXTURE_SKILL, "Fixture skill for worker read-tool acceptance", "Use the fixture worker skill body.");
		await writeSkill(bundledRoot, "bundled-fixture-skill", "Bundled runtime fixture skill", "Bundled skill body.");
		await writeSkill(extraRoot, "extra-fixture-skill", "Project extra skill root", "Extra skill body.");

		await installMemoryBrokerExtension(host.api as never, {
			backendFactory: async () => backend,
			catalogDirectory: join(tmp, "catalog"),
		}, {
			PIPIUI_MEMORY_BROKER_MODE: "main",
			PIPIUI_MEMORY_PROJECT_ROOT: projectRoot,
			PIPIUI_MEMORY_CHAT_SESSION_ID: "worker-read-tools-integration",
			PIPIUI_MEMORY_BROKER_STATE_DIR: "",
		});
		const start = host.handlers.get("session_start")?.[0];
		shutdown = host.handlers.get("session_shutdown")?.[0];
		assert.ok(start, "production session_start hook missing");
		assert.ok(shutdown, "production session_shutdown hook missing");
		await start({}, { cwd: projectRoot });

		const identity = currentMemoryBrokerPackageIdentity();
		assert.ok(identity, "memory-broker package identity must resolve");

		const fixtureEnv = {
			PI_CODING_AGENT_DIR: agentHome,
			PIPIUI_ACTIVE_PROJECT_PI_HOME: agentHome,
			PIPIUI_SUBAGENT_SKILL_ISOLATION: "1",
			PIPIUI_BUILT_IN_SKILL_ROOT: bundledRoot,
			PIPIUI_SKILL_ROOTS: `${extraRoot}${delimiter}${join(homedir(), ".pi", "skills")}`,
			PIPIUI_WORKER_PROBE_SKILL: FIXTURE_SKILL,
			PIPIUI_WORKER_PROBE_CLAIM: FIXTURE_CLAIM,
			PIPIUI_MEMORY_BROKER_STATE_DIR: "",
		};

		const runProbe = async (
			role: (typeof BUILTIN_ROLES)[number],
			scenario: string,
			mutate?: (env: Record<string, string>) => void,
		): Promise<ProbeReport> => {
			const agent = bundled.agents.find((item) => item.name === role);
			assert.ok(agent, role);
			assert.equal(runtimeRolePolicyForAgent(agent).role, "worker", role);
			const issued = issueMainMemoryBrokerChildEnvironment({
				agentID: `${role}-probe`,
				runID: `${role}-run`,
				role: "worker",
			});
			assert.ok(issued, `${role} capability was not issued`);
			assert.ok(issuedMemoryBrokerPackageIdentity(issued, identity));
			const env: Record<string, string> = {
				...Object.fromEntries(
					Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
				),
				...issued,
				...fixtureEnv,
				PIPIUI_MEMORY_BROKER_MODE: "worker",
				PIPIUI_AGENT_ROLE: "worker",
				PIPIUI_WORKER_PROBE_SCENARIO: scenario,
				PIPIUI_WORKER_PROBE_ROLE: role,
			};
			mutate?.(env);
			const launched = spawnProbe(env);
			children.add(launched.child);
			try {
				const result = await launched.done;
				assert.equal(result.signal, null, `${role}/${scenario} killed: ${result.stderr.slice(0, 400)}`);
				assert.equal(result.code, 0, `${role}/${scenario} exit ${result.code}: ${result.stderr.slice(0, 800)}`);
				return parseProbeReport(result.stdout);
			} finally {
				children.delete(launched.child);
				await terminateOwnChild(launched.child);
			}
		};

		for (const role of BUILTIN_ROLES) {
			const agent = bundled.agents.find((item) => item.name === role);
			assert.ok(agent, role);
			const selected = selection({
				declaredTools: agent.tools,
				hasMemoryBrokerCapability: true,
				hasSessionRecall: true,
				hasSkillLoader: true,
				allowRecursiveDelegation: role === "general-purpose",
			});
			assertRequiredReadTools(selected.names, `${role} selection`);
			assertNoForbiddenTools(selected.names, `${role} selection`);

			const report = await runProbe(role, "valid");
			assert.equal(report.ok, true, report.error);
			assertRequiredReadTools(report.registeredTools ?? [], `${role} registered`);
			assertNoForbiddenTools(report.registeredTools ?? [], `${role} registered`);
			assert.equal(report.injectsCatalog, false, role);
			assert.doesNotMatch(report.prompt ?? "", /<available_skills>/);
			assert.doesNotMatch(report.prompt ?? "", /secret catalog/);
			assert.equal(report.globalPiExcluded, true, role);
			assert.ok(report.roots?.includes(bundledRoot), `${role} missing bundled skill root`);
			assert.ok(report.roots?.includes(join(agentHome, "skills")), `${role} missing project skill root`);
			assert.ok(report.roots?.includes(extraRoot), `${role} missing extra skill root`);
			assert.equal((report.roots ?? []).some((root) => root.startsWith(join(homedir(), ".pi"))), false, role);
			assert.equal(report.memoryQuery?.present, true, role);
			assert.equal(report.memoryQuery?.isError, false, `${role} memory_query ${report.memoryQuery?.text}`);
			assert.match(report.memoryQuery?.text ?? "", /Fixture memory claim for worker read-tool acceptance/);
			assert.equal(report.memoryStatus?.present, true, role);
			assert.equal(report.memoryStatus?.isError, false, `${role} memory_status ${report.memoryStatus?.text}`);
			assert.match(report.memoryStatus?.text ?? "", /Memory backend is ready/);
			assert.equal(report.skillSearch?.present, true, role);
			assert.match(report.skillSearch?.text ?? "", /fixture-worker-skill/);
			assert.equal(report.skillLoad?.present, true, role);
			assert.match(report.skillLoad?.text ?? "", /Use the fixture worker skill body/);
		}

		const closedSelection = selection({
			declaredTools: bundled.agents.find((item) => item.name === "explore")?.tools,
			hasMemoryBrokerCapability: false,
			hasSessionRecall: true,
			hasSkillLoader: true,
		});
		assert.equal(closedSelection.names.includes("memory_query"), false);
		assert.equal(closedSelection.names.includes("memory_status"), false);

		const missing = await runProbe("explore", "missing", (env) => {
			delete env.PIPIUI_MEMORY_BROKER_URL;
			delete env.PIPIUI_MEMORY_BROKER_TOKEN;
			delete env.PIPIUI_MEMORY_BROKER_CAPABILITY;
		});
		assert.equal(missing.memoryQuery?.present, false);
		assert.equal(missing.memoryStatus?.present, false);
		assert.ok(missing.registeredTools?.includes("skill_search"));
		assert.ok(missing.registeredTools?.includes("session_recall"));
		assertNoForbiddenTools(missing.registeredTools ?? [], "missing");

		const malformed = await runProbe("explore", "malformed", (env) => {
			env.PIPIUI_MEMORY_BROKER_URL = "http://example.com/v1/memory";
			env.PIPIUI_MEMORY_BROKER_CAPABILITY = "short";
		});
		assert.equal(malformed.memoryQuery?.present, false);
		assert.equal(malformed.memoryStatus?.present, false);

		const tampered = await runProbe("explore", "tampered", (env) => {
			env.PIPIUI_MEMORY_BROKER_CAPABILITY = flipCapability(env.PIPIUI_MEMORY_BROKER_CAPABILITY);
		});
		assert.equal(tampered.memoryQuery?.present, true);
		assert.equal(tampered.memoryQuery?.isError, true);
		assert.match(`${tampered.memoryQuery?.text ?? ""} ${tampered.memoryQuery?.error ?? ""}`, /unauthor|unavail/i);
		assert.equal(tampered.memoryStatus?.present, true);
		assert.equal(tampered.memoryStatus?.isError, true);

		const wrongAgent = await runProbe("explore", "wrong-agent", (env) => {
			env.PIPIUI_AGENT_ID = "someone-else";
		});
		assert.equal(wrongAgent.memoryQuery?.isError, true);
		assert.match(`${wrongAgent.memoryQuery?.text ?? ""} ${wrongAgent.memoryQuery?.error ?? ""}`, /unauthor|unavail/i);

		const wrongRun = await runProbe("explore", "wrong-run", (env) => {
			env.PIPIUI_AGENT_RUN_ID = "stale-run";
		});
		assert.equal(wrongRun.memoryQuery?.isError, true);
		assert.match(`${wrongRun.memoryQuery?.text ?? ""} ${wrongRun.memoryQuery?.error ?? ""}`, /stale|unauthor|unavail/i);

		const wrongProject = await runProbe("explore", "wrong-project", (env) => {
			delete env.PIPIUI_MEMORY_PROJECT_ROOT;
		});
		assert.equal(wrongProject.memoryQuery?.present, false);
		assert.equal(wrongProject.memoryStatus?.present, false);

		const issued = issueMainMemoryBrokerChildEnvironment({
			agentID: "package-probe",
			runID: "package-run",
			role: "worker",
		});
		assert.ok(issued);
		brokerUrl = issued.PIPIUI_MEMORY_BROKER_URL;
		const tamperedPackage = {
			...issued,
			PIPIUI_MEMORY_BROKER_PACKAGE_VERSION: "0.0.0-tampered",
		};
		assert.equal(issuedMemoryBrokerPackageIdentity(tamperedPackage, identity), undefined);
		const packageDenied = diagnoseWorkerReadToolOmissions({
			hasMemoryBrokerCapability: false,
			hasSessionRecall: true,
			hasSkillLoader: true,
			memoryOmissionReason: "package-not-verified",
		});
		assert.equal(packageDenied.memory_query, "package-not-verified");
		assert.equal(packageDenied.memory_status, "package-not-verified");
		const packageSelection = selection({
			declaredTools: bundled.agents.find((item) => item.name === "explore")?.tools,
			hasMemoryBrokerCapability: false,
			hasSessionRecall: true,
			hasSkillLoader: true,
		});
		assert.equal(packageSelection.names.includes("memory_query"), false);
		assert.equal(packageSelection.names.includes("memory_status"), false);

		const operator = bundled.agents.find((item) => item.name === "operator");
		assert.ok(operator);
		assert.equal(runtimeRolePolicyForAgent(operator).role, "operator");
		const roleDenied = diagnoseWorkerReadToolOmissions({
			hasMemoryBrokerCapability: false,
			hasSessionRecall: true,
			hasSkillLoader: true,
			memoryOmissionReason: "disabled-by-role",
		});
		assert.equal(roleDenied.memory_query, "disabled-by-role");
		assert.equal(roleDenied.memory_status, "disabled-by-role");
	} finally {
		for (const child of children) await terminateOwnChild(child);
		children.clear();
		try {
			await shutdown?.();
		} catch {
			// shutdown is best-effort; the temp dir and child kill still run.
		}
		if (brokerUrl) {
			assert.equal(await listenerGone(brokerUrl), true, "broker listener survived shutdown");
		}
		for (const key of envKeys) {
			if (previousEnv[key] === undefined) delete process.env[key];
			else process.env[key] = previousEnv[key];
		}
		await rm(tmp, { recursive: true, force: true });
		assert.equal(existsSync(tmp), false, "temp fixture directory leaked");
		assert.deepEqual(listIfExists(sessionDir), sessionsBefore);
		const attributionAfter = existsSync(attributionPath) ? await readFile(attributionPath, "utf8") : "";
		assert.equal(attributionAfter, attributionBefore);
	}
});
