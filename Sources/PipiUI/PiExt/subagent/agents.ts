/**
 * Agent discovery, package validation, and capability compilation.
 *
 * Legacy flat definitions remain supported at `<root>/agents/<name>.md`.
 * Standard v1 packages live at `<root>/agents/<name>/AGENT.md` and are
 * deliberately strict: malformed declarations are rejected rather than being
 * interpreted as broader permissions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "user" | "project";
export type AgentOrigin = AgentSource | "bundled";
export type AgentMode = "read-only" | "worker";
export type AgentWorktree = "none" | "isolated";
export type AgentFilesystemCapability = "none" | "read-only" | "workspace-write";
export type AgentDesktopCapability = "none" | "requestable";
export type AgentDeliverable = "implementation" | "report" | "verdict";

/**
 * Parsed v1 capability policy. `legacy` is intentionally explicit: old flat
 * files without a capabilities block retain their historical tool behavior,
 * while every standard package starts fail-closed.
 */
export interface AgentCapabilities {
	filesystem: AgentFilesystemCapability;
	shell: boolean;
	web: boolean;
	/** Exact dynamically registered MCP tool names; never an all-server grant. */
	mcpTools: string[];
	desktop: AgentDesktopCapability;
	delegation: boolean;
	legacy: boolean;
}

/**
 * How the runtime must treat this agent, declared by the definition itself.
 * Traits influence session persistence/prompt routing; capabilities decide the
 * actual available tool set and worktree policy.
 */
export interface AgentTraits {
	/** Deliverable is read-only, so no worker session/worktree/verify is useful. */
	readOnly: boolean;
	/** Receives orchestration philosophy only when delegation is also enabled. */
	delegates: boolean;
	/** Cannot pull SKILL.md through the read tool. */
	blockSkillReads: boolean;
	/** Its done message carries a full report rather than a short verdict. */
	reportsInFull: boolean;
}

export interface AgentConfig {
	name: string;
	description: string;
	/** Undefined only for a legacy definition that omitted `tools`; preserve its old allowlist behavior. */
	tools?: string[];
	/** Raw frontmatter `tools`, retained for management/inspection. It may only narrow v1 capabilities. */
	explicitTools?: string[];
	model?: string;
	systemPrompt: string;
	/** Existing user/project display and confirmation semantics. Bundled agents retain `user`. */
	source: AgentSource;
	/** Security origin. Only bundled reserved definitions may receive runtime trust. */
	origin: AgentOrigin;
	filePath: string;
	format: "legacy" | "package";
	schema: 1 | "legacy";
	mode: AgentMode;
	worktree: AgentWorktree;
	deliverable: AgentDeliverable;
	capabilities: AgentCapabilities;
	traits: AgentTraits;
}

export interface AgentDiagnostic {
	severity: "error" | "warning";
	code: string;
	message: string;
	filePath?: string;
	agentName?: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	diagnostics: AgentDiagnostic[];
}

export interface AgentDiscoveryRoots {
	userDir: string;
	projectAgentsDir: string | null;
	pipiuiAgentsDir?: string;
}

/** Reusable parser seam for management/validation callers. */
export interface AgentValidationInput {
	filePath: string;
	content: string;
	source: AgentSource;
	origin: AgentOrigin;
	format: "legacy" | "package";
	directoryName?: string;
}

export interface AgentValidationResult {
	agent?: AgentConfig;
	diagnostics: AgentDiagnostic[];
}

/** Stable static permission projection; dispatch adds further runtime gates. */
export interface AgentPermissionSummary {
	version: 1;
	capabilities: AgentCapabilities;
	/** Capability-derived set before an explicit `tools` narrowing; null for legacy no-capabilities mode. */
	capabilityTools: string[] | null;
	/** Raw frontmatter `tools`; null means omitted. */
	explicitTools: string[] | null;
	/** Capability/tools intersection that runtime begins from; null means legacy unrestricted behavior. */
	effectiveTools: string[] | null;
	legacyUnconstrained: boolean;
	runtimeConstraints: string[];
}

const STANDARD_SCHEMA = 1;
const STANDARD_AGENT_FILE = "AGENT.md";
const STANDARD_FIELDS = new Set([
	"schema",
	"name",
	"description",
	"model",
	"mode",
	"capabilities",
	"worktree",
	"deliverable",
	"tools",
	"read-only",
	"delegates",
	"block-skill-reads",
]);
const CAPABILITY_FIELDS = new Set([
	"filesystem",
	"shell",
	"web",
	"mcp",
	"desktop",
	"delegation",
]);
const RESERVED_DESKTOP_TOOLS = new Set(["computer", "open_application"]);
const WORKER_BROWSER_TOOL = "browser";
const SECRETARY_COMMIT_TOOL = "secretary_commit";
const MCP_TOOL_NAME = /^mcp_[A-Za-z0-9_-]+_[A-Za-z0-9_.-]+$/;

function str(raw: unknown): string | undefined {
	return typeof raw === "string" ? raw : undefined;
}

/** Anything but an explicit truthy value is the conservative legacy default. */
function flag(raw: unknown): boolean {
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "number") return raw === 1;
	const value = str(raw)?.trim().toLowerCase();
	return value === "true" || value === "yes" || value === "1";
}

/** Compatibility export used by existing callers/tests. Strict package parsing lives below. */
export function parseAgentTraits(frontmatter: Record<string, unknown>): AgentTraits {
	return {
		readOnly: flag(frontmatter["read-only"]),
		delegates: flag(frontmatter.delegates),
		blockSkillReads: flag(frontmatter["block-skill-reads"]),
		reportsInFull: str(frontmatter.deliverable)?.trim().toLowerCase() === "report",
	};
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
	return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function diagnostic(
	diagnostics: AgentDiagnostic[],
	severity: AgentDiagnostic["severity"],
	code: string,
	message: string,
	filePath?: string,
	agentName?: string,
): void {
	diagnostics.push({ severity, code, message, ...(filePath ? { filePath } : {}), ...(agentName ? { agentName } : {}) });
}

function hasErrors(diagnostics: AgentDiagnostic[]): boolean {
	return diagnostics.some((entry) => entry.severity === "error");
}

function requireString(
	frontmatter: Record<string, unknown>,
	key: string,
	filePath: string,
	diagnostics: AgentDiagnostic[],
	options: { required: boolean } = { required: false },
): string | undefined {
	const raw = frontmatter[key];
	if (raw === undefined || raw === null) {
		if (options.required) diagnostic(diagnostics, "error", "missing-field", `Missing required frontmatter field \`${key}\`.`, filePath);
		return undefined;
	}
	if (typeof raw !== "string") {
		diagnostic(diagnostics, "error", "invalid-field", `Frontmatter field \`${key}\` must be a string.`, filePath);
		return undefined;
	}
	const value = raw.trim();
	if (!value) {
		diagnostic(diagnostics, "error", "invalid-field", `Frontmatter field \`${key}\` must not be blank.`, filePath);
		return undefined;
	}
	return value;
}

function strictBoolean(
	frontmatter: Record<string, unknown>,
	key: string,
	filePath: string,
	diagnostics: AgentDiagnostic[],
): boolean | undefined {
	if (!hasOwn(frontmatter, key)) return undefined;
	const raw = frontmatter[key];
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "number" && (raw === 0 || raw === 1)) return raw === 1;
	if (typeof raw === "string") {
		const normalized = raw.trim().toLowerCase();
		if (["true", "yes", "1"].includes(normalized)) return true;
		if (["false", "no", "0"].includes(normalized)) return false;
	}
	diagnostic(diagnostics, "error", "invalid-field", `Frontmatter field \`${key}\` must be boolean.`, filePath);
	return undefined;
}

function parseStringList(
	raw: unknown,
	field: string,
	filePath: string,
	diagnostics: AgentDiagnostic[],
	options: { commaString?: boolean } = {},
): string[] | undefined {
	let values: unknown[];
	if (typeof raw === "string" && options.commaString) {
		values = raw.split(",");
	} else if (Array.isArray(raw)) {
		values = raw;
	} else {
		diagnostic(diagnostics, "error", "invalid-field", `Frontmatter field \`${field}\` must be a list${options.commaString ? " or comma-separated string" : ""}.`, filePath);
		return undefined;
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < values.length; index++) {
		if (typeof values[index] !== "string" || !values[index].trim()) {
			diagnostic(diagnostics, "error", "invalid-field", `Frontmatter field \`${field}\` entry ${index + 1} must be a non-empty string.`, filePath);
			continue;
		}
		const value = values[index].trim();
		if (!seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return result;
}

function parseTools(
	frontmatter: Record<string, unknown>,
	filePath: string,
	diagnostics: AgentDiagnostic[],
): string[] | undefined {
	if (!hasOwn(frontmatter, "tools")) return undefined;
	const raw = frontmatter.tools;
	if (typeof raw === "string") {
		const list = raw.trim() ? raw.split(",") : [];
		return parseStringList(list, "tools", filePath, diagnostics);
	}
	return parseStringList(raw, "tools", filePath, diagnostics);
}

function parseSchema(
	frontmatter: Record<string, unknown>,
	format: "legacy" | "package",
	filePath: string,
	diagnostics: AgentDiagnostic[],
): 1 | "legacy" {
	const raw = frontmatter.schema;
	const recognized = raw === STANDARD_SCHEMA || raw === "1";
	if (format === "package") {
		if (!recognized) {
			diagnostic(diagnostics, "error", "invalid-schema", "Standard agent packages require `schema: 1`.", filePath);
		}
		return STANDARD_SCHEMA;
	}
	if (raw !== undefined && !recognized) {
		diagnostic(diagnostics, "error", "invalid-schema", "Legacy agent `schema`, when present, must be `1`.", filePath);
	}
	return recognized ? STANDARD_SCHEMA : "legacy";
}

function parseMode(
	frontmatter: Record<string, unknown>,
	format: "legacy" | "package",
	filePath: string,
	diagnostics: AgentDiagnostic[],
): AgentMode | undefined {
	const raw = requireString(frontmatter, "mode", filePath, diagnostics, { required: format === "package" });
	if (raw === undefined) return undefined;
	if (raw === "read-only" || raw === "worker") return raw;
	diagnostic(diagnostics, "error", "invalid-field", "Frontmatter field `mode` must be `read-only` or `worker`.", filePath);
	return undefined;
}

function parseWorktree(
	frontmatter: Record<string, unknown>,
	format: "legacy" | "package",
	filePath: string,
	diagnostics: AgentDiagnostic[],
): AgentWorktree | undefined {
	const raw = requireString(frontmatter, "worktree", filePath, diagnostics, { required: format === "package" });
	if (raw === undefined) return undefined;
	if (raw === "none" || raw === "isolated") return raw;
	diagnostic(diagnostics, "error", "invalid-field", "Frontmatter field `worktree` must be `none` or `isolated`.", filePath);
	return undefined;
}

function parseDeliverable(
	frontmatter: Record<string, unknown>,
	format: "legacy" | "package",
	filePath: string,
	diagnostics: AgentDiagnostic[],
): AgentDeliverable | undefined {
	const raw = requireString(frontmatter, "deliverable", filePath, diagnostics, { required: format === "package" });
	if (raw === undefined) return undefined;
	if (raw === "implementation" || raw === "report" || raw === "verdict") return raw;
	diagnostic(diagnostics, "error", "invalid-field", "Frontmatter field `deliverable` must be `implementation`, `report`, or `verdict`.", filePath);
	return undefined;
}

function parseMcpTools(raw: unknown, filePath: string, diagnostics: AgentDiagnostic[]): string[] | undefined {
	if (raw === false) return [];
	let tools: string[] | undefined;
	if (Array.isArray(raw)) {
		tools = parseStringList(raw, "capabilities.mcp", filePath, diagnostics);
	} else if (isRecord(raw)) {
		for (const key of Object.keys(raw)) {
			if (key !== "tools") {
				diagnostic(diagnostics, "error", "unknown-capability", `Unknown ` + "`capabilities.mcp." + key + "`; only explicit `tools` are supported.", filePath);
			}
		}
		if (!hasOwn(raw, "tools")) {
			diagnostic(diagnostics, "error", "invalid-field", "`capabilities.mcp` must be false or `{ tools: [...] }`.", filePath);
			return undefined;
		}
		tools = parseStringList(raw.tools, "capabilities.mcp.tools", filePath, diagnostics);
	} else {
		diagnostic(
			diagnostics,
			"error",
			"invalid-field",
			"`capabilities.mcp` must be false, an explicit tool list, or `{ tools: [...] }`; all-server grants are not supported.",
			filePath,
		);
		return undefined;
	}
	if (tools === undefined) return undefined;
	for (const name of tools) {
		if (!MCP_TOOL_NAME.test(name)) {
			diagnostic(diagnostics, "error", "invalid-field", `MCP tool \`${name}\` must use the exact registered name form \`mcp_<server>_<tool>\`.`, filePath);
		}
	}
	return tools;
}

function defaultCapabilities(legacy: boolean): AgentCapabilities {
	return {
		filesystem: "none",
		shell: false,
		web: false,
		mcpTools: [],
		desktop: legacy ? "requestable" : "none",
		delegation: legacy,
		legacy,
	};
}

function parseCapabilities(
	frontmatter: Record<string, unknown>,
	format: "legacy" | "package",
	filePath: string,
	diagnostics: AgentDiagnostic[],
): AgentCapabilities {
	if (!hasOwn(frontmatter, "capabilities")) {
		if (format === "package") {
			diagnostic(diagnostics, "error", "missing-field", "Standard agent packages require a `capabilities` mapping.", filePath);
		}
		return defaultCapabilities(format === "legacy");
	}
	const raw = frontmatter.capabilities;
	if (!isRecord(raw)) {
		diagnostic(diagnostics, "error", "invalid-field", "Frontmatter field `capabilities` must be a mapping.", filePath);
		return defaultCapabilities(false);
	}
	for (const key of Object.keys(raw)) {
		if (!CAPABILITY_FIELDS.has(key)) {
			diagnostic(diagnostics, "error", "unknown-capability", `Unknown capability \`${key}\`; agent rejected fail-closed.`, filePath);
		}
	}
	const capabilities = defaultCapabilities(false);
	if (hasOwn(raw, "filesystem")) {
		const value = raw.filesystem;
		if (value === "none" || value === "read-only" || value === "workspace-write") {
			capabilities.filesystem = value;
		} else {
			diagnostic(diagnostics, "error", "invalid-field", "`capabilities.filesystem` must be `none`, `read-only`, or `workspace-write`.", filePath);
		}
	}
	if (hasOwn(raw, "shell")) {
		const value = strictBoolean(raw, "shell", filePath, diagnostics);
		if (value !== undefined) capabilities.shell = value;
	}
	if (hasOwn(raw, "web")) {
		const value = strictBoolean(raw, "web", filePath, diagnostics);
		if (value !== undefined) capabilities.web = value;
	}
	if (hasOwn(raw, "mcp")) {
		const tools = parseMcpTools(raw.mcp, filePath, diagnostics);
		if (tools !== undefined) capabilities.mcpTools = tools;
	}
	if (hasOwn(raw, "desktop")) {
		if (raw.desktop === "none" || raw.desktop === "requestable") {
			capabilities.desktop = raw.desktop;
		} else {
			diagnostic(diagnostics, "error", "invalid-field", "`capabilities.desktop` must be `none` or `requestable`.", filePath);
		}
	}
	if (hasOwn(raw, "delegation")) {
		const value = strictBoolean(raw, "delegation", filePath, diagnostics);
		if (value !== undefined) capabilities.delegation = value;
	}
	return capabilities;
}

function capabilityToolNames(capabilities: AgentCapabilities, trustedSecretary: boolean): string[] {
	const names: string[] = [];
	if (capabilities.filesystem === "read-only" || capabilities.filesystem === "workspace-write") {
		names.push("read", "grep", "find", "ls");
	}
	if (capabilities.filesystem === "workspace-write") names.push("edit", "write");
	if (capabilities.shell) names.push("bash");
	if (capabilities.web) {
		names.push(
			"web_search",
			"fetch_content",
			"source_check",
			"get_search_content",
			"arxiv_fetch",
		);
	}
	names.push(...capabilities.mcpTools);
	if (capabilities.delegation) names.push("subagent");
	if (trustedSecretary) names.push(SECRETARY_COMMIT_TOOL);
	return [...new Set(names)];
}

function validateExplicitTools(
	explicitTools: string[] | undefined,
	capabilityTools: string[] | undefined,
	trustedSecretary: boolean,
	filePath: string,
	diagnostics: AgentDiagnostic[],
): string[] | undefined {
	if (explicitTools === undefined) return capabilityTools;
	const allowed = capabilityTools ? new Set(capabilityTools) : undefined;
	for (const tool of explicitTools) {
		if (tool === WORKER_BROWSER_TOOL) {
			diagnostic(
				diagnostics,
				"error",
				"unsupported-tool",
				"`browser` is not available to dispatched workers: PipiUI does not safely mount the main-session WebView bridge in worker processes.",
				filePath,
			);
			continue;
		}
		if (RESERVED_DESKTOP_TOOLS.has(tool)) {
			diagnostic(
				diagnostics,
				"error",
				"reserved-tool",
				`\`${tool}\` is injected only by the global Computer Use × per-task desktop grant; it cannot be declared in agent frontmatter.`,
				filePath,
			);
			continue;
		}
		if (tool === SECRETARY_COMMIT_TOOL && !trustedSecretary) {
			diagnostic(
				diagnostics,
				"error",
				"reserved-tool",
				"`secretary_commit` is reserved for the bundled `secretary` runtime origin and cannot grant a custom agent closeout privileges.",
				filePath,
			);
			continue;
		}
		if (allowed && !allowed.has(tool)) {
			diagnostic(
				diagnostics,
				"error",
				"tools-outside-capabilities",
				`Tool \`${tool}\` is not enabled by this agent's capabilities; \`tools\` may only narrow the resolved capability set.`,
				filePath,
			);
		}
	}
	return explicitTools;
}

interface ParseResult {
	config?: AgentConfig;
	diagnostics: AgentDiagnostic[];
}

function parseAgentFile(input: {
	filePath: string;
	content: string;
	source: AgentSource;
	origin: AgentOrigin;
	format: "legacy" | "package";
	directoryName?: string;
}): ParseResult {
	const diagnostics: AgentDiagnostic[] = [];
	let frontmatter: Record<string, unknown> = {};
	let body = "";
	try {
		const parsed = parseFrontmatter<Record<string, unknown>>(input.content);
		frontmatter = isRecord(parsed.frontmatter) ? parsed.frontmatter : {};
		body = typeof parsed.body === "string" ? parsed.body : "";
	} catch (error) {
		diagnostic(diagnostics, "error", "parse-error", `Cannot parse agent frontmatter: ${error instanceof Error ? error.message : String(error)}`, input.filePath);
		return { diagnostics };
	}

	for (const key of Object.keys(frontmatter)) {
		if (STANDARD_FIELDS.has(key)) continue;
		diagnostic(
			diagnostics,
			input.format === "package" ? "error" : "warning",
			"unknown-field",
			`Unknown frontmatter field \`${key}\`${input.format === "package" ? "; standard packages reject unknown fields." : "; ignored by legacy compatibility mode."}`,
			input.filePath,
		);
	}

	const schema = parseSchema(frontmatter, input.format, input.filePath, diagnostics);
	const name = requireString(frontmatter, "name", input.filePath, diagnostics, { required: true });
	const description = requireString(frontmatter, "description", input.filePath, diagnostics, { required: true });
	const model = hasOwn(frontmatter, "model")
		? requireString(frontmatter, "model", input.filePath, diagnostics)
		: undefined;
	if (input.format === "package" && input.directoryName && name && name !== input.directoryName) {
		diagnostic(diagnostics, "error", "package-name-mismatch", `Package directory \`${input.directoryName}\` must match frontmatter \`name: ${name}\`.`, input.filePath, name);
	}
	if (input.format === "package" && !body.trim()) {
		diagnostic(diagnostics, "error", "missing-prompt", "Standard agent packages require a non-empty prompt body after frontmatter.", input.filePath, name);
	}

	const readOnlyField = strictBoolean(frontmatter, "read-only", input.filePath, diagnostics);
	const delegatesField = strictBoolean(frontmatter, "delegates", input.filePath, diagnostics);
	const blockSkillReadsField = strictBoolean(frontmatter, "block-skill-reads", input.filePath, diagnostics);
	const parsedMode = parseMode(frontmatter, input.format, input.filePath, diagnostics);
	const mode = parsedMode ?? (readOnlyField === true ? "read-only" : "worker");
	if (parsedMode && readOnlyField !== undefined && (parsedMode === "read-only") !== readOnlyField) {
		diagnostic(diagnostics, "error", "conflicting-field", "`mode` conflicts with legacy `read-only` trait.", input.filePath, name);
	}

	const capabilities = parseCapabilities(frontmatter, input.format, input.filePath, diagnostics);
	const parsedWorktree = parseWorktree(frontmatter, input.format, input.filePath, diagnostics);
	const worktree = parsedWorktree ?? (mode === "read-only" ? "none" : "isolated");
	if (mode === "read-only" && worktree !== "none") {
		diagnostic(diagnostics, "error", "conflicting-field", "Read-only agents must declare `worktree: none`.", input.filePath, name);
	}
	if (!capabilities.legacy && mode === "read-only" && capabilities.filesystem === "workspace-write") {
		diagnostic(diagnostics, "error", "conflicting-field", "Read-only agents cannot request `filesystem: workspace-write`.", input.filePath, name);
	}

	const parsedDeliverable = parseDeliverable(frontmatter, input.format, input.filePath, diagnostics);
	const deliverable = parsedDeliverable ?? (parseAgentTraits(frontmatter).reportsInFull ? "report" : "implementation");
	const traits: AgentTraits = {
		readOnly: mode === "read-only",
		delegates: false,
		blockSkillReads: blockSkillReadsField ?? parseAgentTraits(frontmatter).blockSkillReads,
		reportsInFull: deliverable === "report",
	};
	if (capabilities.legacy) {
		traits.delegates = delegatesField ?? parseAgentTraits(frontmatter).delegates;
	} else {
		if (delegatesField === true && !capabilities.delegation) {
			diagnostic(diagnostics, "error", "conflicting-field", "`delegates: true` requires `capabilities.delegation: true`.", input.filePath, name);
		}
		traits.delegates = capabilities.delegation && (delegatesField ?? true);
	}

	const explicitTools = parseTools(frontmatter, input.filePath, diagnostics);
	const trustedSecretary = input.origin === "bundled" && name === "secretary";
	const compiledTools = validateExplicitTools(
		explicitTools,
		capabilities.legacy ? undefined : capabilityToolNames(capabilities, trustedSecretary),
		trustedSecretary,
		input.filePath,
		diagnostics,
	);

	if (hasErrors(diagnostics) || !name || !description) return { diagnostics };
	return {
		config: {
			name,
			description,
			...(compiledTools !== undefined ? { tools: compiledTools } : {}),
			...(explicitTools !== undefined ? { explicitTools } : {}),
			...(model ? { model } : {}),
			systemPrompt: body,
			source: input.source,
			origin: input.origin,
			filePath: input.filePath,
			format: input.format,
			schema,
			mode,
			worktree,
			deliverable,
			capabilities,
			traits,
		},
		diagnostics,
	};
}

/**
 * Validate a legacy file or v1 package through the exact runtime parser. This
 * is the public management seam; callers must not reimplement schema rules.
 */
export function validateAgentDefinition(input: AgentValidationInput): AgentValidationResult {
	const parsed = parseAgentFile(input);
	return {
		...(parsed.config ? { agent: parsed.config } : {}),
		diagnostics: parsed.diagnostics,
	};
}

/**
 * Static, inspectable capability/tools projection. It intentionally does not
 * claim a tool is usable: disabled-tools, mounted extensions, a per-task
 * desktop grant, and recursive depth/trust guards are evaluated only at dispatch.
 */
export function summarizeAgentPermissions(agent: AgentConfig): AgentPermissionSummary {
	const trustedSecretary = agent.origin === "bundled" && agent.name === "secretary";
	const capabilityTools = agent.capabilities.legacy
		? null
		: capabilityToolNames(agent.capabilities, trustedSecretary);
	return {
		version: 1,
		capabilities: agent.capabilities,
		capabilityTools,
		explicitTools: agent.explicitTools ?? null,
		effectiveTools: agent.tools ?? null,
		legacyUnconstrained: agent.capabilities.legacy && agent.tools === undefined,
		runtimeConstraints: [
			"Global disabled-tools can remove any listed tool at dispatch.",
			"PipiUI extension availability can remove extension-only tools; web_search may instead be provider-native.",
			"desktop: requestable injects computer/open_application only after the global Computer Use host gate and an explicit per-task desktop grant.",
			"delegation is still constrained by runtime role policy and the recursive depth limit.",
		],
	};
}

interface DirectoryLoadResult {
	agents: AgentConfig[];
	diagnostics: AgentDiagnostic[];
}

function statIsDirectory(target: string): boolean {
	try {
		return fs.statSync(target).isDirectory();
	} catch {
		return false;
	}
}

function statIsFile(target: string): boolean {
	try {
		return fs.statSync(target).isFile();
	} catch {
		return false;
	}
}

function loadAgentsFromDir(dir: string, source: AgentSource, origin: AgentOrigin): DirectoryLoadResult {
	const diagnostics: AgentDiagnostic[] = [];
	if (!statIsDirectory(dir)) return { agents: [], diagnostics };
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
	} catch (error) {
		diagnostic(diagnostics, "warning", "read-error", `Cannot read agent directory: ${error instanceof Error ? error.message : String(error)}`, dir);
		return { agents: [], diagnostics };
	}

	const parsed: AgentConfig[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const target = path.join(dir, entry.name);
		if (entry.name.endsWith(".md") && statIsFile(target)) {
			try {
				const result = parseAgentFile({
					filePath: target,
					content: fs.readFileSync(target, "utf8"),
					source,
					origin,
					format: "legacy",
				});
				diagnostics.push(...result.diagnostics);
				if (result.config) parsed.push(result.config);
			} catch (error) {
				diagnostic(diagnostics, "error", "read-error", `Cannot read agent file: ${error instanceof Error ? error.message : String(error)}`, target);
			}
			continue;
		}
		if (!statIsDirectory(target)) continue;
		const packageFile = path.join(target, STANDARD_AGENT_FILE);
		if (!statIsFile(packageFile)) continue;
		try {
			const result = parseAgentFile({
				filePath: packageFile,
				content: fs.readFileSync(packageFile, "utf8"),
				source,
				origin,
				format: "package",
				directoryName: entry.name,
			});
			diagnostics.push(...result.diagnostics);
			if (result.config) parsed.push(result.config);
		} catch (error) {
			diagnostic(diagnostics, "error", "read-error", `Cannot read agent package: ${error instanceof Error ? error.message : String(error)}`, packageFile);
		}
	}

	const byName = new Map<string, AgentConfig[]>();
	for (const agent of parsed) {
		const sameName = byName.get(agent.name) ?? [];
		sameName.push(agent);
		byName.set(agent.name, sameName);
	}
	const agents: AgentConfig[] = [];
	for (const [name, definitions] of byName) {
		if (definitions.length === 1) {
			agents.push(definitions[0]);
			continue;
		}
		const paths = definitions.map((definition) => definition.filePath).join(", ");
		diagnostic(
			diagnostics,
			"error",
			"duplicate-name",
			`Duplicate agent name \`${name}\` in one ${origin} scope; all conflicting definitions are ignored: ${paths}.`,
			dir,
			name,
		);
	}
	return { agents, diagnostics };
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (statIsDirectory(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function overlayAgents(
	map: Map<string, AgentConfig>,
	candidates: AgentConfig[],
	diagnostics: AgentDiagnostic[],
	label: string,
): void {
	for (const agent of candidates) {
		const previous = map.get(agent.name);
		if (previous) {
			diagnostic(
			diagnostics,
			"warning",
			"shadowed-name",
			`Agent \`${agent.name}\` from ${label} overrides ${previous.origin} definition at ${previous.filePath}; existing scope precedence is preserved.`,
			agent.filePath,
			agent.name,
		);
		}
		map.set(agent.name, agent);
	}
}

/** Pure discovery seam for parser/precedence tests and the production wrapper below. */
export function discoverAgentsFromRoots(roots: AgentDiscoveryRoots, scope: AgentScope): AgentDiscoveryResult {
	const diagnostics: AgentDiagnostic[] = [];
	const user = scope === "project" ? { agents: [], diagnostics: [] } : loadAgentsFromDir(roots.userDir, "user", "user");
	const project = scope === "user" || !roots.projectAgentsDir
		? { agents: [], diagnostics: [] }
		: loadAgentsFromDir(roots.projectAgentsDir, "project", "project");
	// Bundled PipiUI roles retain the historical user/both availability. They deliberately do
	// not appear in project-only scope, where a repository definition must remain confirmable.
	const bundled = roots.pipiuiAgentsDir && scope !== "project"
		? loadAgentsFromDir(roots.pipiuiAgentsDir, "user", "bundled")
		: { agents: [], diagnostics: [] };
	diagnostics.push(...user.diagnostics, ...project.diagnostics, ...bundled.diagnostics);

	const agentMap = new Map<string, AgentConfig>();
	if (scope === "both") {
		overlayAgents(agentMap, user.agents, diagnostics, "user scope");
		overlayAgents(agentMap, project.agents, diagnostics, "project scope");
	} else if (scope === "user") {
		overlayAgents(agentMap, user.agents, diagnostics, "user scope");
	} else {
		overlayAgents(agentMap, project.agents, diagnostics, "project scope");
	}
	overlayAgents(agentMap, bundled.agents, diagnostics, "bundled scope");
	return {
		agents: Array.from(agentMap.values()),
		projectAgentsDir: roots.projectAgentsDir,
		diagnostics,
	};
}

/** Load App-shipped definitions from one exact runtime resource directory. */
export function discoverBundledAgentsFromDirectory(directory: string): AgentDiscoveryResult {
	const loaded = loadAgentsFromDir(directory, "user", "bundled");
	return { agents: loaded.agents, projectAgentsDir: null, diagnostics: loaded.diagnostics };
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	return discoverAgentsFromRoots(
		{
			userDir: path.join(getAgentDir(), "agents"),
			projectAgentsDir: findNearestProjectAgentsDir(cwd),
			pipiuiAgentsDir: process.env.PIPIUI_AGENTS_DIR,
		},
		scope,
	);
}

export function formatAgentDiagnostics(diagnostics: AgentDiagnostic[], maxItems: number = 12): string {
	if (diagnostics.length === 0) return "none";
	const listed = diagnostics.slice(0, Math.max(1, maxItems));
	const text = listed
		.map((entry) => `[${entry.severity}]${entry.filePath ? ` ${entry.filePath}:` : ""} ${entry.message}`)
		.join("\n");
	return diagnostics.length > listed.length ? `${text}\n… ${diagnostics.length - listed.length} more diagnostic(s)` : text;
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining,
	};
}
