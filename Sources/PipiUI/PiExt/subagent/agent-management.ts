/**
 * UI-independent Agent management API for the bundled PipiUI subagent extension.
 *
 * Stable `subagent_manage` result contract:
 * `{ version: 1, success, action, diagnostics, data }`.
 * `data` is action-specific but always JSON-safe; diagnostics are the exact
 * `agents.ts` parser/catalog diagnostics. This module never dispatches an
 * agent, mounts desktop, changes search grants, or bypasses project-agent
 * confirmation. It only reads definitions or safely writes a user/project
 * package after explicit `install`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	discoverAgents,
	summarizeAgentPermissions,
	validateAgentDefinition,
	type AgentConfig,
	type AgentDiagnostic,
	type AgentOrigin,
	type AgentScope,
	type AgentSource,
} from "./agents.ts";

const CONTRACT_VERSION = 1 as const;
const PACKAGE_FILE = "AGENT.md";
const SAFE_AGENT_NAME = /^[a-z][a-z0-9-]{0,62}$/;

type ManageAction = "list" | "inspect" | "validate" | "scaffold" | "install";
type MutableScope = "user" | "project";

type ManageResult = {
	version: typeof CONTRACT_VERSION;
	success: boolean;
	action: ManageAction;
	diagnostics: AgentDiagnostic[];
	data: Record<string, unknown>;
};

type CapabilitiesInput = {
	filesystem?: "none" | "read-only" | "workspace-write";
	shell?: boolean;
	web?: boolean;
	mcpTools?: string[];
	desktop?: "none" | "requestable";
	delegation?: boolean;
};

type ManageParams = {
	action: ManageAction;
	scope?: AgentScope;
	name?: string;
	description?: string;
	model?: string;
	mode?: "read-only" | "worker";
	capabilities?: CapabilitiesInput;
	worktree?: "none" | "isolated";
	deliverable?: "implementation" | "report" | "verdict";
	tools?: string[];
	prompt?: string;
	draft?: string;
	path?: string;
	format?: "legacy" | "package";
	overwrite?: boolean;
};

const ScopeParam = Type.Optional(
	StringEnum(["user", "project", "both"] as const, {
		description: "Discovery scope. list/inspect accept user, project, or both; mutation actions accept only user or project.",
	}),
);

const CapabilitiesParams = Type.Optional(
	Type.Object({
		filesystem: Type.Optional(StringEnum(["none", "read-only", "workspace-write"] as const)),
		shell: Type.Optional(Type.Boolean()),
		web: Type.Optional(Type.Boolean()),
		mcpTools: Type.Optional(Type.Array(Type.String({ maxLength: 160 }))),
		desktop: Type.Optional(StringEnum(["none", "requestable"] as const)),
		delegation: Type.Optional(Type.Boolean()),
	}),
);

const SubagentManageParams = Type.Object({
	action: StringEnum(["list", "inspect", "validate", "scaffold", "install"] as const, {
		description: "list definitions, inspect one definition, validate a draft/path, scaffold a v1 package, or safely install a validated scaffold/draft.",
	}),
	scope: ScopeParam,
	name: Type.Optional(Type.String({ maxLength: 64, description: "Agent name. Required by inspect/scaffold/install; lower-kebab-case for scaffold/install." })),
	description: Type.Optional(Type.String({ maxLength: 1_000, description: "One-sentence agent description for scaffold." })),
	model: Type.Optional(Type.String({ maxLength: 300, description: "Optional model for scaffold." })),
	mode: Type.Optional(StringEnum(["read-only", "worker"] as const)),
	capabilities: CapabilitiesParams,
	worktree: Type.Optional(StringEnum(["none", "isolated"] as const)),
	deliverable: Type.Optional(StringEnum(["implementation", "report", "verdict"] as const)),
	tools: Type.Optional(Type.Array(Type.String({ maxLength: 160 }), { description: "Optional explicit tools. Parser accepts these only as a narrowing subset of capabilities." })),
	prompt: Type.Optional(Type.String({ maxLength: 30_000, description: "Optional non-empty package prompt body for scaffold." })),
	draft: Type.Optional(Type.String({ maxLength: 80_000, description: "AGENT.md content for validate/install. install never accepts an arbitrary output path." })),
	path: Type.Optional(Type.String({ maxLength: 1_000, description: "For validate only: root-relative existing candidate file (`name.md` or `name/AGENT.md`). Absolute and traversal paths are rejected." })),
	format: Type.Optional(StringEnum(["legacy", "package"] as const, { description: "Draft format for validate; package is the default." })),
	overwrite: Type.Optional(Type.Boolean({ description: "install only: false by default. True atomically replaces an existing regular AGENT.md file." })),
});

function parserIdentity(scope: MutableScope): { source: AgentSource; origin: AgentOrigin } {
	return scope === "project"
		? { source: "project", origin: "project" }
		: { source: "user", origin: "user" };
}

function errorDiagnostic(code: string, message: string, filePath?: string): AgentDiagnostic {
	return { severity: "error", code, message, ...(filePath ? { filePath } : {}) };
}

function result(
	action: ManageAction,
	success: boolean,
	diagnostics: AgentDiagnostic[],
	data: Record<string, unknown> = {},
): ManageResult {
	return { version: CONTRACT_VERSION, success, action, diagnostics, data };
}

function toolResponse(value: ManageResult) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
		details: value,
		...(value.success ? {} : { isError: true }),
	};
}

function agentData(agent: AgentConfig): Record<string, unknown> {
	return {
		name: agent.name,
		description: agent.description,
		origin: agent.origin,
		source: agent.source,
		format: agent.format,
		filePath: agent.filePath,
		model: agent.model ?? null,
		mode: agent.mode,
		worktree: agent.worktree,
		deliverable: agent.deliverable,
		capabilities: agent.capabilities,
		explicitTools: agent.explicitTools ?? null,
		tools: agent.tools ?? null,
		permissionSummary: summarizeAgentPermissions(agent),
	};
}

function mutableScope(value: AgentScope | undefined): MutableScope | null {
	if (value === undefined || value === "user") return "user";
	if (value === "project") return "project";
	return null;
}

function safeContextCwd(cwd: unknown): string {
	if (typeof cwd !== "string" || !cwd.trim() || !path.isAbsolute(cwd)) {
		throw new Error("Management requires an absolute session cwd.");
	}
	return path.resolve(cwd);
}

/** Existing nearest project root mirrors discovery; absent roots are created at this session cwd. */
function projectAgentsRoot(cwd: string): string {
	if (cwd === path.parse(cwd).root) {
		throw new Error("Management refuses to create project agents from the filesystem root.");
	}
	return discoverAgents(cwd, "both").projectAgentsDir ?? path.join(cwd, CONFIG_DIR_NAME, "agents");
}

function managedRoot(scope: MutableScope, cwd: string): string {
	return scope === "user"
		? path.join(getAgentDir(), "agents")
		: projectAgentsRoot(safeContextCwd(cwd));
}

function isWithin(child: string, parent: string): boolean {
	return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function nearestExistingAncestor(target: string): string {
	let current = target;
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current);
		if (parent === current) return current;
		current = parent;
	}
	return current;
}

/**
 * Reject traversal and an existing symlink path that resolves outside the known
 * user/project root. Rechecked immediately before the atomic install step.
 */
function resolveWithinRoot(root: string, relative: string): string {
	if (!relative || path.isAbsolute(relative)) {
		throw new Error("Path must be a non-empty root-relative path.");
	}
	const normalized = path.normalize(relative);
	if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
		throw new Error("Path traversal is not allowed.");
	}
	const rootPath = path.resolve(root);
	const target = path.resolve(rootPath, normalized);
	if (!isWithin(target, rootPath)) throw new Error("Path escapes the selected agent root.");

	if (!fs.existsSync(rootPath)) {
		// First install legitimately creates ~/.pi/agent/agents or <project>/.pi/agents.
		// There is no existing child path to escape yet; install re-checks the newly
		// created root and every package component immediately before finalization.
		return target;
	}

	const rootReal = fs.realpathSync(rootPath);
	const existing = nearestExistingAncestor(target);
	const existingReal = fs.realpathSync(existing);
	if (!isWithin(existingReal, rootReal)) {
		throw new Error("Path is inside a symlink that escapes the selected agent root.");
	}
	return target;
}

function assertSafeName(value: unknown): string {
	const name = typeof value === "string" ? value.trim() : "";
	if (!SAFE_AGENT_NAME.test(name)) {
		throw new Error("name must be lower-kebab-case (1-63 chars) and cannot contain traversal or separators.");
	}
	return name;
}

function existingCandidate(
	scope: MutableScope,
	cwd: string,
	relativePath: string,
): { filePath: string; format: "legacy" | "package"; directoryName?: string } {
	const root = managedRoot(scope, cwd);
	const filePath = resolveWithinRoot(root, relativePath);
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		throw new Error("Candidate path does not name an existing regular file inside the selected agent root.");
	}
	const base = path.basename(filePath);
	if (base === PACKAGE_FILE) {
		return { filePath, format: "package", directoryName: path.basename(path.dirname(filePath)) };
	}
	if (path.extname(base) === ".md") return { filePath, format: "legacy" };
	throw new Error("Candidate path must be a legacy .md file or package AGENT.md.");
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function renderScaffold(params: ManageParams, scope: MutableScope, cwd: string): {
	name: string;
	targetPath: string;
	content: string;
	validation: ReturnType<typeof validateAgentDefinition>;
} {
	const name = assertSafeName(params.name);
	const description = typeof params.description === "string" ? params.description.trim() : "";
	if (!description) throw new Error("description is required for scaffold.");
	const mode = params.mode ?? "read-only";
	const caps = params.capabilities ?? {};
	const filesystem = caps.filesystem ?? "none";
	const shell = caps.shell ?? false;
	const web = caps.web ?? false;
	const mcpTools = Array.isArray(caps.mcpTools) ? caps.mcpTools : [];
	const desktop = caps.desktop ?? "none";
	const delegation = caps.delegation ?? false;
	const worktree = params.worktree ?? "none";
	const deliverable = params.deliverable ?? (mode === "read-only" ? "report" : "implementation");
	const prompt = typeof params.prompt === "string" && params.prompt.trim()
		? params.prompt.trim()
		: `You are a focused subagent. Complete only the delegated task and return a concise ${deliverable}.`;
	const root = managedRoot(scope, cwd);
	const targetPath = resolveWithinRoot(root, path.join(name, PACKAGE_FILE));

	const lines = [
		"---",
		"schema: 1",
		`name: ${name}`,
		`description: ${yamlString(description)}`,
		...(typeof params.model === "string" && params.model.trim() ? [`model: ${yamlString(params.model.trim())}`] : []),
		`mode: ${mode}`,
		"capabilities:",
		`  filesystem: ${filesystem}`,
		`  shell: ${shell}`,
		`  web: ${web}`,
		...(mcpTools.length === 0
			? ["  mcp: false"]
			: ["  mcp:", "    tools:", ...mcpTools.map((tool) => `      - ${yamlString(String(tool))}`)]),
		`  desktop: ${desktop}`,
		`  delegation: ${delegation}`,
		`worktree: ${worktree}`,
		`deliverable: ${deliverable}`,
		...(Array.isArray(params.tools) ? ["tools:", ...params.tools.map((tool) => `  - ${yamlString(String(tool))}`)] : []),
		"---",
		"",
		prompt,
		"",
	];
	const content = lines.join("\n");
	const identity = parserIdentity(scope);
	const validation = validateAgentDefinition({
		filePath: targetPath,
		content,
		...identity,
		format: "package",
		directoryName: name,
	});
	return { name, targetPath, content, validation };
}

function validateDraft(
	params: ManageParams,
	scope: MutableScope,
	cwd: string,
): { validation: ReturnType<typeof validateAgentDefinition>; filePath: string; format: "legacy" | "package" } {
	const identity = parserIdentity(scope);
	if (typeof params.draft === "string") {
		const format = params.format ?? "package";
		const name = typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined;
		const root = managedRoot(scope, cwd);
		const filePath = format === "package"
			? resolveWithinRoot(root, path.join(name ?? "draft", PACKAGE_FILE))
			: resolveWithinRoot(root, `${name ?? "draft"}.md`);
		return {
			filePath,
			format,
			validation: validateAgentDefinition({
				filePath,
				content: params.draft,
				...identity,
				format,
				...(format === "package" && name ? { directoryName: name } : {}),
			}),
		};
	}
	if (typeof params.path !== "string") {
		throw new Error("validate requires draft or root-relative path.");
	}
	const candidate = existingCandidate(scope, cwd, params.path);
	const content = fs.readFileSync(candidate.filePath, "utf8");
	return {
		filePath: candidate.filePath,
		format: candidate.format,
		validation: validateAgentDefinition({ content, ...candidate, ...identity }),
	};
}

function installDraft(params: ManageParams, scope: MutableScope, cwd: string): ManageResult {
	if (typeof params.draft !== "string") {
		return result("install", false, [errorDiagnostic("missing-draft", "install requires a package draft returned by scaffold or supplied for validation.")]);
	}
	let name: string;
	try {
		name = assertSafeName(params.name);
	} catch (error) {
		return result("install", false, [errorDiagnostic("invalid-name", error instanceof Error ? error.message : String(error))]);
	}
	const root = managedRoot(scope, cwd);
	const packageDirectory = resolveWithinRoot(root, name);
	const targetPath = resolveWithinRoot(root, path.join(name, PACKAGE_FILE));
	const identity = parserIdentity(scope);
	const validation = validateAgentDefinition({
		filePath: targetPath,
		content: params.draft,
		...identity,
		format: "package",
		directoryName: name,
	});
	if (!validation.agent || validation.diagnostics.some((entry) => entry.severity === "error")) {
		return result("install", false, validation.diagnostics, {
			targetPath,
			validation: { agent: validation.agent ? agentData(validation.agent) : null },
		});
	}

	let stagingPath: string | undefined;
	try {
		fs.mkdirSync(packageDirectory, { recursive: true, mode: 0o700 });
		// mkdir can follow a newly introduced symlink; re-check before any write.
		resolveWithinRoot(root, name);
		if (fs.existsSync(packageDirectory) && fs.lstatSync(packageDirectory).isSymbolicLink()) {
			throw new Error("Package directory may not be a symbolic link.");
		}
		if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink()) {
			throw new Error("Existing AGENT.md may not be a symbolic link.");
		}
		if (fs.existsSync(targetPath) && !params.overwrite) {
			return result("install", false, [errorDiagnostic("already-exists", "AGENT.md already exists; pass overwrite:true to replace it.", targetPath)], { targetPath });
		}

		stagingPath = resolveWithinRoot(
			root,
			path.join(name, `.${PACKAGE_FILE}.staging-${process.pid}-${randomBytes(8).toString("hex")}`),
		);
		fs.writeFileSync(stagingPath, params.draft, { encoding: "utf8", mode: 0o600, flag: "wx" });
		// Set the final mode on the staging inode before its atomic link/rename.
		// After committing, do not chmod the target: a post-commit failure must not
		// report an install failure after the package is already visible.
		fs.chmodSync(stagingPath, 0o600);
		// Re-check the nearest existing paths immediately before finalization.
		resolveWithinRoot(root, name);
		resolveWithinRoot(root, path.join(name, path.basename(stagingPath)));
		if (params.overwrite) {
			fs.renameSync(stagingPath, targetPath);
		} else {
			// link() gives no-overwrite semantics atomically; both paths are in the
			// same package directory, then the staging link is removed.
			fs.linkSync(stagingPath, targetPath);
			fs.unlinkSync(stagingPath);
		}
		stagingPath = undefined;
		const verified = validateAgentDefinition({
			filePath: targetPath,
			content: fs.readFileSync(targetPath, "utf8"),
			...identity,
			format: "package",
			directoryName: name,
		});
		const success = Boolean(verified.agent) && !verified.diagnostics.some((entry) => entry.severity === "error");
		return result("install", success, verified.diagnostics, {
			targetPath,
			agent: verified.agent ? agentData(verified.agent) : null,
			validation: { format: "package" },
		});
	} catch (error) {
		return result("install", false, [
			errorDiagnostic("install-failed", error instanceof Error ? error.message : String(error), targetPath),
		], { targetPath });
	} finally {
		if (stagingPath) {
			try { fs.unlinkSync(stagingPath); } catch { /* best effort staging cleanup */ }
		}
	}
}

function executeManage(params: ManageParams, cwd: string): ManageResult {
	const action = params.action;
	if (action === "list" || action === "inspect") {
		const scope = params.scope ?? "user";
		const discovery = discoverAgents(cwd, scope);
		if (action === "list") {
			return result("list", true, discovery.diagnostics, {
				scope,
				projectAgentsDir: discovery.projectAgentsDir,
				agents: discovery.agents.map(agentData),
			});
		}
		const name = typeof params.name === "string" ? params.name.trim() : "";
		if (!name) return result("inspect", false, [errorDiagnostic("missing-name", "inspect requires name.")], { scope });
		const agent = discovery.agents.find((candidate) => candidate.name === name);
		if (!agent) {
			return result("inspect", false, [
				...discovery.diagnostics,
				errorDiagnostic("not-found", `No discovered agent named \`${name}\` in ${scope} scope.`),
			], { scope, projectAgentsDir: discovery.projectAgentsDir });
		}
		return result("inspect", true, discovery.diagnostics, {
			scope,
			projectAgentsDir: discovery.projectAgentsDir,
			agent: agentData(agent),
		});
	}

	const scope = mutableScope(params.scope);
	if (!scope) {
		return result(action, false, [errorDiagnostic("invalid-scope", `${action} accepts only user or project scope; bundled and both are read-only discovery scopes.`)]);
	}
	if (action === "validate") {
		try {
			const checked = validateDraft(params, scope, cwd);
			const success = Boolean(checked.validation.agent) && !checked.validation.diagnostics.some((entry) => entry.severity === "error");
			return result("validate", success, checked.validation.diagnostics, {
				scope,
				filePath: checked.filePath,
				format: checked.format,
				agent: checked.validation.agent ? agentData(checked.validation.agent) : null,
			});
		} catch (error) {
			return result("validate", false, [errorDiagnostic("validate-failed", error instanceof Error ? error.message : String(error))], { scope });
		}
	}
	if (action === "scaffold") {
		try {
			const scaffold = renderScaffold(params, scope, cwd);
			const success = Boolean(scaffold.validation.agent) && !scaffold.validation.diagnostics.some((entry) => entry.severity === "error");
			return result("scaffold", success, scaffold.validation.diagnostics, {
				scope,
				targetPath: scaffold.targetPath,
				content: scaffold.content,
				agent: scaffold.validation.agent ? agentData(scaffold.validation.agent) : null,
			});
		} catch (error) {
			return result("scaffold", false, [errorDiagnostic("scaffold-failed", error instanceof Error ? error.message : String(error))], { scope });
		}
	}
	return installDraft(params, scope, cwd);
}

/** Register the standalone management tool; it intentionally has no relation to dispatch execution. */
export function registerSubagentManagementTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "subagent_manage",
		label: "Subagent Manage",
		description: [
			"UI-independent management API for PipiUI agent definitions. It never dispatches or starts an agent.",
			"list returns current user/project/bundled definitions with origin, format, diagnostics and static permission summaries.",
			"inspect returns one definition; validate uses the runtime agents.ts parser; scaffold produces a least-privilege schema:1 package; install safely writes only a validated user/project package.",
			"Every result is structured JSON `{version:1, success, action, diagnostics, data}`. Runtime dispatch still applies disabled-tools, extension availability, desktop per-task grants, role/depth limits, and project confirmation separately.",
		].join(" "),
		parameters: SubagentManageParams,
		async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
			try {
				return toolResponse(executeManage(rawParams as ManageParams, safeContextCwd(ctx.cwd)));
			} catch (error) {
				const action = (rawParams as Partial<ManageParams>).action ?? "list";
				return toolResponse(result(
					action,
					false,
					[errorDiagnostic("management-failed", error instanceof Error ? error.message : String(error))],
				));
			}
		},
	});
}
