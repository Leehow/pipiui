/**
 * UI-independent Agent management API for the bundled PipiUI subagent extension.
 *
 * Stable `subagent_manage` result contract:
 * `{ version: 1, success, action, diagnostics, data }`.
 * `data` is action-specific but always JSON-safe; diagnostics are the exact
 * `agents.ts` parser/catalog diagnostics. This module never dispatches an
 * agent, changes search grants, or bypasses project-agent
 * confirmation. It only reads definitions or safely writes a user/project
 * package after explicit `install`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { makeStrictJsonSchema, omitNulls } from "./strict-json-schema.ts";
import { convertPiSubagentDefinition, renderPackageDraft, type PiSubagentImportResult } from "./agent-import.ts";
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

type ManageAction = "list" | "inspect" | "validate" | "scaffold" | "install" | "import";
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
	/** import: a pi-subagents-format file or directory, absolute or relative to the session cwd. */
	source?: string;
	/** import: a vendored upstream sample name, or `*` for every sample. */
	sample?: string;
	/** import: install under this name (single file/sample only). */
	as?: string;
	/** import: convert and report without writing anything. */
	dryRun?: boolean;
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
	}, { additionalProperties: false }),
);

const SubagentManageParams = Type.Object({
	action: StringEnum(["list", "inspect", "validate", "scaffold", "install", "import"] as const, {
		description: "list definitions, inspect one definition, validate a draft/path, scaffold a v1 package, safely install a validated scaffold/draft, or import pi-subagents-format agent files (source path or vendored sample) as v1 packages.",
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
	overwrite: Type.Optional(Type.Boolean({ description: "install/import: false by default. True atomically replaces an existing regular AGENT.md file." })),
	source: Type.Optional(Type.String({ maxLength: 1_000, description: "import only: a pi-subagents-format agent file (`<name>.md`, frontmatter + prompt) or a directory of them, absolute or relative to the session cwd. Mutually exclusive with sample." })),
	sample: Type.Optional(Type.String({ maxLength: 64, description: "import only: a vendored upstream sample (scout, researcher, worker, reviewer, oracle, delegate) or `*` for all six." })),
	as: Type.Optional(Type.String({ maxLength: 64, description: "import only: install a single file/sample under this lower-kebab-case name, e.g. when the upstream name collides with a bundled role." })),
	dryRun: Type.Optional(Type.Boolean({ description: "import only: convert and return the drafts, mappings and dropped fields without writing anything." })),
}, { additionalProperties: false });

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

	const content = renderPackageDraft({
		name,
		description,
		...(typeof params.model === "string" && params.model.trim() ? { model: params.model.trim() } : {}),
		mode,
		capabilities: { filesystem, shell, web, mcpTools: mcpTools.map(String), desktop, delegation },
		worktree,
		deliverable,
		...(Array.isArray(params.tools) ? { tools: params.tools.map(String) } : {}),
		prompt,
	});
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

// --- import: pi-subagents-format files → validated v1 packages ------------------

/** Vendored upstream agents; see ../agent-samples/PI_SUBAGENTS_UPSTREAM.md. */
const SAMPLES_DIR = fileURLToPath(new URL("../agent-samples/pi-subagents/", import.meta.url));
const PROVENANCE_FILE = "IMPORT.json";

class ManageError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

function listSamples(): string[] {
	try {
		return fs.readdirSync(SAMPLES_DIR)
			.filter((entry) => entry.endsWith(".md"))
			.map((entry) => entry.replace(/\.md$/, ""))
			.sort();
	} catch {
		return [];
	}
}

type ImportSource = { label: string; content: string };

/** Resolve `sample` or `source` into file contents. Reads only; never writes. */
function collectImportSources(params: ManageParams, cwd: string): { sources: ImportSource[]; single: boolean } {
	const sample = typeof params.sample === "string" ? params.sample.trim() : "";
	const source = typeof params.source === "string" ? params.source.trim() : "";
	if (sample && source) throw new ManageError("conflicting-source", "import accepts either source or sample, not both.");
	if (sample) {
		const available = listSamples();
		const names = sample === "*" ? available : [sample];
		const sources: ImportSource[] = [];
		for (const name of names) {
			if (!available.includes(name)) {
				throw new ManageError("unknown-sample", `No vendored sample named \`${name}\`. Available: ${available.join(", ") || "(none)"}.`);
			}
			sources.push({ label: `sample:${name}`, content: fs.readFileSync(path.join(SAMPLES_DIR, `${name}.md`), "utf8") });
		}
		return { sources, single: sample !== "*" };
	}
	if (source) {
		const resolved = path.resolve(safeContextCwd(cwd), source);
		if (!fs.existsSync(resolved)) throw new ManageError("source-not-found", `No file or directory at ${resolved}.`);
		const stat = fs.statSync(resolved);
		if (stat.isDirectory()) {
			const files = fs.readdirSync(resolved)
				.filter((entry) => entry.endsWith(".md") && !entry.endsWith(".chain.md") && !entry.startsWith("."))
				.sort();
			return {
				sources: files.map((entry) => {
					const file = path.join(resolved, entry);
					return { label: file, content: fs.readFileSync(file, "utf8") };
				}),
				single: false,
			};
		}
		if (!stat.isFile()) throw new ManageError("source-not-found", `${resolved} is neither a file nor a directory.`);
		return { sources: [{ label: resolved, content: fs.readFileSync(resolved, "utf8") }], single: true };
	}
	throw new ManageError("missing-source", "import requires `source` (a pi-subagents-format file or directory) or `sample` (a vendored sample name, `*` for all).");
}

function writeImportProvenance(
	root: string,
	name: string,
	converted: PiSubagentImportResult,
	source: ImportSource,
): string {
	const provenancePath = resolveWithinRoot(root, path.join(name, PROVENANCE_FILE));
	const payload = {
		version: 1,
		format: converted.provenance.format,
		converter: converted.provenance.converter,
		source: converted.provenance.source,
		...(converted.provenance.upstreamName ? { upstreamName: converted.provenance.upstreamName } : {}),
		sha256: createHash("sha256").update(source.content).digest("hex"),
		importedAt: new Date().toISOString(),
		mapping: converted.mapping,
		droppedFields: converted.droppedFields,
		droppedTools: converted.droppedTools,
	};
	fs.writeFileSync(provenancePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	return provenancePath;
}

/**
 * Convert every source, refuse catalog collisions, then install through the same
 * validated atomic path `install` uses. Provenance lands beside the package so a
 * later sync can tell an imported file from a hand-written one.
 */
function importDefinitions(params: ManageParams, scope: MutableScope, cwd: string): ManageResult {
	let collected: { sources: ImportSource[]; single: boolean };
	try {
		collected = collectImportSources(params, cwd);
	} catch (error) {
		const code = error instanceof ManageError ? error.code : "import-failed";
		return result("import", false, [errorDiagnostic(code, error instanceof Error ? error.message : String(error))], { scope });
	}
	const { sources, single } = collected;
	const as = typeof params.as === "string" && params.as.trim() ? params.as.trim() : undefined;
	if (as && !single) {
		return result("import", false, [errorDiagnostic("invalid-as", "`as` renames a single file or sample; import a directory without it.")], { scope });
	}
	const dryRun = params.dryRun === true;
	const sessionCwd = safeContextCwd(cwd);
	const discovery = discoverAgents(sessionCwd, "both");
	const diagnostics: AgentDiagnostic[] = [];
	const imported: Record<string, unknown>[] = [];
	const skipped: Record<string, unknown>[] = [];

	for (const source of sources) {
		const converted = convertPiSubagentDefinition(source.content, {
			source: source.label,
			...(as ? { name: as } : {}),
			...(params.mode ? { mode: params.mode } : {}),
			...(params.deliverable ? { deliverable: params.deliverable } : {}),
		});
		const entryDiagnostics = converted.diagnostics.map((entry) => ({ ...entry, filePath: source.label }));
		diagnostics.push(...entryDiagnostics);
		if (!converted.ok || !converted.name || !converted.draft) {
			skipped.push({ source: source.label, diagnostics: entryDiagnostics });
			continue;
		}
		const name = converted.name;
		const existing = discovery.agents.find((agent) => agent.name === name);
		if (existing?.origin === "bundled") {
			const conflict = errorDiagnostic(
				"name-conflict-bundled",
				`\`${name}\` is a bundled PipiUI role, and bundled roles shadow every user/project definition; import it under another name with \`as\`.`,
				source.label,
			);
			diagnostics.push(conflict);
			skipped.push({ source: source.label, diagnostics: [conflict] });
			continue;
		}
		if (existing && existing.origin !== scope) {
			diagnostics.push({
				severity: "warning",
				code: "shadowed-name",
				message: `\`${name}\` also exists in ${existing.origin} scope; discovery overlays user → project, so the project copy wins when both are visible.`,
				filePath: source.label,
			});
		}
		const record: Record<string, unknown> = {
			name,
			source: source.label,
			upstreamName: converted.provenance.upstreamName ?? null,
			mapping: converted.mapping,
			droppedFields: converted.droppedFields,
			droppedTools: converted.droppedTools,
			...(dryRun ? { draft: converted.draft } : {}),
		};
		if (dryRun) {
			imported.push(record);
			continue;
		}
		const install = installDraft({ action: "install", name, draft: converted.draft, overwrite: params.overwrite }, scope, cwd);
		diagnostics.push(...install.diagnostics);
		if (!install.success) {
			skipped.push({ source: source.label, diagnostics: install.diagnostics });
			continue;
		}
		let provenancePath: string | null = null;
		try {
			provenancePath = writeImportProvenance(managedRoot(scope, cwd), name, converted, source);
		} catch (error) {
			diagnostics.push({
				severity: "warning",
				code: "provenance-not-written",
				message: `Installed, but ${PROVENANCE_FILE} could not be written: ${error instanceof Error ? error.message : String(error)}`,
				filePath: String(install.data.targetPath),
			});
		}
		imported.push({ ...record, targetPath: install.data.targetPath, provenancePath });
	}

	const success = imported.length > 0 && (!single || skipped.length === 0);
	return result("import", success, diagnostics, {
		scope,
		dryRun,
		imported,
		skipped,
		...(imported.length > 0 && !dryRun
			? { next: `Dispatch with subagent_type: "<name>" and agentScope: "${scope}". Bundled roles still shadow same-named imports.` }
			: {}),
	});
}

export function executeManage(params: ManageParams, cwd: string): ManageResult {
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
	if (action === "import") return importDefinitions(params, scope, cwd);
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
			"import converts pi-subagents-format agent files (the community Pi subagent format: `<name>.md` with frontmatter + prompt) into schema:1 packages and installs them: pass source (file or directory) or sample (vendored upstream agents: scout, researcher, worker, reviewer, oracle, delegate; `*` for all). Tools map to capabilities mechanically; every upstream field or tool without a PipiUI home is listed in droppedFields/droppedTools and recorded in IMPORT.json beside the package. Use dryRun:true to preview, as to rename (bundled role names are refused), mode/deliverable to override the mechanical defaults. External-CLI runners (codex-exec, claude-code, cursor-agent) are refused.",
			"Every result is structured JSON `{version:1, success, action, diagnostics, data}`. Runtime dispatch still applies disabled-tools, extension availability, role/depth limits, and project confirmation separately.",
		].join(" "),
		parameters: makeStrictJsonSchema(SubagentManageParams),
		async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
			rawParams = omitNulls(rawParams);
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
