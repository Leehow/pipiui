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

export interface AgentExtensionToolRequest {
	name: string;
	extensionId: string;
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
	/**
	 * Extension `addTools` that are not in the capability universe. Kept off `tools`
	 * until dispatch so legacy `tools === undefined` and host availability still win.
	 */
	extensionToolRequests?: AgentExtensionToolRequest[];
	/** Subtractive overlay for legacy unconstrained definitions; never converted into an allowlist. */
	extensionRemovedTools?: string[];
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
	/** Operations the merge actually accepted. Absent on base discovery. */
	appliedPatches?: AppliedExtensionPatch[];
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
	// Optional execution-policy keys used by project agents (COC stewards).
	// Declaring them here keeps catalog discovery from treating a valid
	// project agent as a broken extension. Dispatch still applies its own
	// depth/skill/turn gates; these fields do not widen capabilities.
	"thinking",
	"systemPromptMode",
	"inheritProjectContext",
	"inheritSkills",
	"async",
	"turnBudget",
	"maxSubagentDepth",
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
/**
 * Readonly retrieval tools from project-enabled extensions. Role-gated by filesystem
 * capability (explore / reviewer = read-only; general-purpose = workspace-write).
 * Not bound to a single extension id: a mount that is not present simply does not register.
 * Writable extension tools must not be listed here — they stay off explore/reviewer.
 */
export const READONLY_RETRIEVAL_TOOL_NAMES = [
	"code_search",
	"code_nav",
	"repo_map",
	"read_spans",
	"memory_query",
	"memory_status",
	"skill_search",
	"skill_load",
] as const;
const READONLY_RETRIEVAL_TOOL_SET = new Set<string>(READONLY_RETRIEVAL_TOOL_NAMES);
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
		// Project-enabled extension readonly tools: injected by filesystem role, not extension id.
		names.push(...READONLY_RETRIEVAL_TOOL_NAMES);
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
	if (capabilities.delegation) {
		names.push(
			"subagent",
			"subagent_chain",
			"subagent_abort",
			"subagent_resolve",
			"subagent_status",
		);
	}
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
	// Frontmatter `tools` may only narrow. Readonly retrieval tools are role-injected
	// from the capability set so bundled explore/reviewer/general-purpose lists cannot drop them.
	if (capabilityTools) {
		const injected = capabilityTools.filter((name) => READONLY_RETRIEVAL_TOOL_SET.has(name));
		return [...new Set([...explicitTools, ...injected])];
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
		diagnostic(
			diagnostics,
			"error",
			"duplicate-name",
			`Duplicate agent name \`${name}\` in one ${origin} scope; all conflicting definitions are ignored.`,
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
			`Agent \`${agent.name}\` from ${label} overrides ${previous.origin} \`${previous.name}\`; existing scope precedence is preserved.`,
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

export const EXT_AGENT_CONTRIBUTIONS_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS";
export const EXT_AGENT_CONTRIBUTIONS_FILE_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS_FILE";
/** Host-minted canonical jail directory for the sidecar file (realpath-resolved session dir). */
export const EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV = "PIPIUI_EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT";
/** Canonical sidecar basename suffix; the runtime refuses any other file name. */
const EXT_AGENT_CONTRIBUTIONS_SIDECAR_SUFFIX = ".ext-agent-contributions.json";

export const CANONICAL_PRIVILEGED_BUNDLED_ROLES = [
	"secretary",
	"operator",
	"computer-verifier",
	"computer-terminal",
	"computer-use-leader",
	"computer-use",
] as const;

const CANONICAL_PRIVILEGED_BUNDLED_ROLE_SET = new Set<string>(CANONICAL_PRIVILEGED_BUNDLED_ROLES);
const HOST_DENIED_PATCH_TOOLS = new Set<string>([
	WORKER_BROWSER_TOOL,
	...RESERVED_DESKTOP_TOOLS,
	SECRETARY_COMMIT_TOOL,
	"session_recall",
	"memory_query",
	"memory_status",
	"skill_search",
	"skill_load",
	"subagent",
	"subagent_parallel",
	"subagent_chain",
	"subagent_abort",
	"subagent_resolve",
	"subagent_status",
	"subagent_manage",
	"computer_task",
]);
const BUILTIN_PATCH_TOOLS = new Set<string>([
	"read",
	"grep",
	"find",
	"ls",
	"edit",
	"write",
	"bash",
	"web_search",
	"fetch_content",
	"source_check",
	"get_search_content",
	"arxiv_fetch",
	...READONLY_RETRIEVAL_TOOL_NAMES,
	...HOST_DENIED_PATCH_TOOLS,
]);
function isBuiltInOrReservedPatchTool(name: string): boolean {
	return BUILTIN_PATCH_TOOLS.has(name);
}
const SNAPSHOT_FIELDS = new Set(["version", "extensions"]);
const EXTENSION_FIELDS = new Set(["id", "origin", "root", "agents", "patches", "providedTools"]);
const PATCH_FIELDS = new Set(["target", "appendPrompt", "replacePrompt", "addTools", "removeTools"]);
const EXTENSION_ORIGIN_RANK = { builtin: 0, app: 1, project: 2 } as const;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_EXTENSIONS = 64;
const MAX_AGENTS_PER_EXTENSION = 32;
const MAX_PATCHES_PER_EXTENSION = 64;
const MAX_TOOL_NAMES = 64;
const EXTENSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROMPT_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export type ExtensionContributionOrigin = "builtin" | "app" | "project";

export type AgentPatchOperationKind = "appendPrompt" | "replacePrompt" | "addTools" | "removeTools";

/** Accepted patch provenance. Extension id/origin, target, op kinds, accepted tool names only. */
export interface AppliedExtensionPatch {
	extensionId: string;
	origin: ExtensionContributionOrigin;
	target: string;
	operations: AgentPatchOperationKind[];
	addTools?: string[];
	removeTools?: string[];
}

export interface ExtensionAgentPatch {
	target: string;
	appendPrompt?: string;
	replacePrompt?: string;
	addTools?: string[];
	removeTools?: string[];
}

export interface ExtensionAgentContribution {
	id: string;
	origin: ExtensionContributionOrigin;
	root: string;
	agents: string[];
	patches: ExtensionAgentPatch[];
	providedTools: string[];
}

export interface ExtensionAgentContributionSnapshot {
	extensions: ExtensionAgentContribution[];
	diagnostics: AgentDiagnostic[];
}

export function isCanonicalPrivilegedBundledRole(name: string, origin: AgentOrigin): boolean {
	return origin === "bundled" && CANONICAL_PRIVILEGED_BUNDLED_ROLE_SET.has(name);
}

export function mountedExtensionIdsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
	return (env.PIPIUI_MOUNTED_EXTENSIONS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/** Same name as spawn-assembly `REGISTERED_EXTENSION_PATHS_ENV`. Duplicated to avoid a backend import. */
export const REGISTERED_EXTENSION_PATHS_ENV = "PIPIUI_EXT_REGISTERED_PATHS";
const OWNERSHIP_CAPTURE_INSTALLED = Symbol.for("pipiui.extensionToolOwnership.installed");

/** toolName → unique Pi-effective owner extension id. Host/bundled/runtime winners are absent. */
export type ExtensionToolOwnership = ReadonlyMap<string, string>;
export type MountedExtensionMount = { id: string; path: string };
export type LoadedExtensionToolSource = {
	path?: string;
	resolvedPath?: string;
	tools?: unknown;
	sourceInfo?: { path?: string };
};
/** One entry from Pi's first-wins `getAllRegisteredTools()` / active registry. */
export type EffectiveToolWinner = {
	name?: string;
	definition?: { name?: unknown };
	sourceInfo?: { path?: string };
	path?: string;
	resolvedPath?: string;
};

let liveExtensionToolOwnership: Map<string, string> = new Map();
let liveExtensionToolOwnershipCaptured = false;

export function extensionToolOwnership(): ExtensionToolOwnership {
	return liveExtensionToolOwnership;
}

export function hasCapturedExtensionToolOwnership(): boolean {
	return liveExtensionToolOwnershipCaptured;
}

export function resetExtensionToolOwnership(): void {
	liveExtensionToolOwnership = new Map();
	liveExtensionToolOwnershipCaptured = false;
}

export function mountedExtensionMountsFromEnv(env: NodeJS.ProcessEnv = process.env): MountedExtensionMount[] {
	const ids = mountedExtensionIdsFromEnv(env);
	const paths = (env[REGISTERED_EXTENSION_PATHS_ENV] ?? "").split(path.delimiter).filter(Boolean);
	const count = Math.min(ids.length, paths.length);
	const mounts: MountedExtensionMount[] = [];
	for (let index = 0; index < count; index++) mounts.push({ id: ids[index]!, path: paths[index]! });
	return mounts;
}

function pathAliases(value: string): string[] {
	if (!value) return [];
	const aliases = new Set<string>([value]);
	try {
		aliases.add(path.resolve(value));
	} catch {
		/* ignore */
	}
	try {
		aliases.add(fs.realpathSync(value));
	} catch {
		/* ignore */
	}
	return [...aliases];
}

/** Host/bundled subagent runtime files can never be a third-party owner identity. */
function isHostBundledSubagentRuntimePath(value: string): boolean {
	if (!value) return false;
	const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
	const marker = "/pi-ext/subagent/";
	const index = normalized.indexOf(marker);
	if (index < 0) return normalized.endsWith("/pi-ext/subagent");
	const rest = normalized.slice(index + marker.length);
	if (!rest) return true;
	const top = rest.split("/")[0] ?? "";
	return top !== "test" && top !== "tests";
}

type ResolvedExtensionMount = {
	id: string;
	aliases: string[];
	reserved: boolean;
};

function resolveExtensionMounts(mounts: readonly MountedExtensionMount[]): ResolvedExtensionMount[] {
	const resolved: ResolvedExtensionMount[] = [];
	for (const mount of mounts) {
		const id = mount.id.trim();
		if (!id) continue;
		const aliases = pathAliases(mount.path);
		resolved.push({
			id,
			aliases,
			reserved: aliases.some(isHostBundledSubagentRuntimePath),
		});
	}
	return resolved;
}

type ExtensionMountOwnerIndex = {
	pathToId: Map<string, string>;
	ambiguous: Set<string>;
	reserved: Set<string>;
};

/**
 * Fail-closed path → owner index. A canonical path claimed by more than one
 * extension id, or any host/bundled subagent runtime path, is ambiguous and
 * never yields an owner. Last-write / registration order is ignored.
 */
function buildExtensionMountOwnerIndex(mounts: readonly ResolvedExtensionMount[]): ExtensionMountOwnerIndex {
	const aliasToIds = new Map<string, Set<string>>();
	const reserved = new Set<string>();
	const tainted = new Set<string>();
	for (const mount of mounts) {
		if (mount.reserved) tainted.add(mount.id);
		for (const alias of mount.aliases) {
			if (mount.reserved || isHostBundledSubagentRuntimePath(alias)) reserved.add(alias);
			const ids = aliasToIds.get(alias) ?? new Set<string>();
			ids.add(mount.id);
			aliasToIds.set(alias, ids);
		}
	}
	for (const ids of aliasToIds.values()) {
		if (ids.size > 1) {
			for (const id of ids) tainted.add(id);
		}
	}
	const pathToId = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const [alias, ids] of aliasToIds) {
		if (reserved.has(alias)) {
			ambiguous.add(alias);
			continue;
		}
		const live = [...ids].filter((id) => !tainted.has(id));
		if (live.length === 1) pathToId.set(alias, live[0]!);
		else ambiguous.add(alias);
	}
	return { pathToId, ambiguous, reserved };
}

function collectRegisteredToolNames(tools: unknown): string[] {
	const names: string[] = [];
	const add = (name: unknown) => {
		if (typeof name === "string" && name.trim()) names.push(name.trim());
	};
	if (!tools) return names;
	if (tools instanceof Map) {
		for (const [key, value] of tools) {
			add(key);
			if (value && typeof value === "object") {
				const record = value as { definition?: { name?: unknown }; name?: unknown };
				add(record.definition?.name ?? record.name);
			}
		}
		return names;
	}
	if (typeof (tools as Iterable<unknown>)[Symbol.iterator] === "function") {
		for (const item of tools as Iterable<unknown>) {
			if (typeof item === "string") add(item);
			else if (item && typeof item === "object") add((item as { name?: unknown }).name);
		}
	}
	return names;
}

function winnerToolName(winner: EffectiveToolWinner): string {
	if (typeof winner.name === "string" && winner.name.trim()) return winner.name.trim();
	if (typeof winner.definition?.name === "string" && winner.definition.name.trim()) return winner.definition.name.trim();
	return "";
}

function winnerSourcePaths(winner: EffectiveToolWinner | LoadedExtensionToolSource): string[] {
	const paths: string[] = [];
	if (winner.sourceInfo?.path) paths.push(...pathAliases(winner.sourceInfo.path));
	if (winner.path) paths.push(...pathAliases(winner.path));
	if (winner.resolvedPath) paths.push(...pathAliases(winner.resolvedPath));
	return paths;
}

function ownerIdForPaths(paths: string[], index: ExtensionMountOwnerIndex): string | undefined {
	const ids = new Set<string>();
	for (const alias of paths) {
		if (index.reserved.has(alias) || isHostBundledSubagentRuntimePath(alias) || index.ambiguous.has(alias)) {
			return undefined;
		}
		const ownerId = index.pathToId.get(alias);
		if (ownerId) ids.add(ownerId);
	}
	if (ids.size !== 1) return undefined;
	return [...ids][0];
}

/**
 * Runtime-authoritative unique owner map: tool name → the mounted extension id
 * that won Pi's final active registry (first registration per name). Snapshot
 * `providedTools` is never consulted. Host/bundled/subagent-runtime winners and
 * ambiguous canonical mount identities never become third-party owners.
 */
export function captureExtensionToolOwnership(input: {
	extensions?: readonly LoadedExtensionToolSource[];
	winners?: readonly EffectiveToolWinner[];
	mounts?: readonly MountedExtensionMount[];
	env?: NodeJS.ProcessEnv;
}): Map<string, string> {
	const mounts = resolveExtensionMounts(input.mounts ?? mountedExtensionMountsFromEnv(input.env));
	const index = buildExtensionMountOwnerIndex(mounts);
	const next = new Map<string, string>();
	const claimed = new Set<string>();
	const recordWinner = (name: string, paths: string[]) => {
		if (!name || claimed.has(name) || isBuiltInOrReservedPatchTool(name)) return;
		claimed.add(name);
		const ownerId = ownerIdForPaths(paths, index);
		if (!ownerId) return;
		next.set(name, ownerId);
	};
	if (input.winners) {
		for (const winner of input.winners) {
			recordWinner(winnerToolName(winner), winnerSourcePaths(winner));
		}
	} else {
		for (const extension of input.extensions ?? []) {
			for (const name of collectRegisteredToolNames(extension.tools)) {
				recordWinner(name, winnerSourcePaths(extension));
			}
		}
	}
	liveExtensionToolOwnership = next;
	liveExtensionToolOwnershipCaptured = true;
	return next;
}

export function captureExtensionToolOwnershipFromLoadedExtensions(
	extensions: ReadonlyArray<LoadedExtensionToolSource>,
	env: NodeJS.ProcessEnv = process.env,
): Map<string, string> {
	return captureExtensionToolOwnership({ extensions, env });
}

type OwnershipCaptureRunner = {
	prototype: {
		bindCore: (...args: unknown[]) => unknown;
		getAllRegisteredTools?: () => EffectiveToolWinner[];
		[OWNERSHIP_CAPTURE_INSTALLED]?: boolean;
	};
};

/** Wrap Pi's ExtensionRunner.bindCore to snapshot the final first-wins registry. */
export function installExtensionToolOwnershipCapture(runnerClass?: OwnershipCaptureRunner): boolean {
	if (!runnerClass) return false;
	const proto = runnerClass.prototype;
	if (proto[OWNERSHIP_CAPTURE_INSTALLED]) return false;
	const original = proto.bindCore;
	proto.bindCore = function bindCoreAndCaptureOwnership(
		this: {
			extensions?: LoadedExtensionToolSource[];
			getAllRegisteredTools?: () => EffectiveToolWinner[];
		},
		...args: unknown[]
	) {
		try {
			if (typeof this.getAllRegisteredTools === "function") {
				captureExtensionToolOwnership({
					winners: this.getAllRegisteredTools() ?? [],
					extensions: this.extensions ?? [],
				});
			} else {
				captureExtensionToolOwnershipFromLoadedExtensions(this.extensions ?? []);
			}
		} catch {
			resetExtensionToolOwnership();
		}
		return original.apply(this, args);
	};
	proto[OWNERSHIP_CAPTURE_INSTALLED] = true;
	return true;
}

function isOwnershipMap(value: unknown): value is ExtensionToolOwnership {
	return value instanceof Map;
}

function requestOwnsTool(
	extensionId: string,
	toolName: string,
	ownership: Iterable<string> | ExtensionToolOwnership,
): boolean {
	if (isBuiltInOrReservedPatchTool(toolName)) return false;
	if (isOwnershipMap(ownership)) return ownership.get(toolName) === extensionId;
	for (const name of ownership) {
		if (name.trim() === toolName) return true;
	}
	return false;
}

function rejectUnownedAddTool(
	diagnostics: AgentDiagnostic[],
	extensionId: string,
	agentName: string,
	toolName: string,
	ownership: Iterable<string> | ExtensionToolOwnership,
	unmounted = false,
): void {
	if (unmounted) {
		diagnostic(
			diagnostics,
			"error",
			"contribution-add-tool-unmounted",
			`Extension \`${extensionId}\` is not mounted; tool \`${toolName}\` was not applied to \`${agentName}\`.`,
			extensionId,
			agentName,
		);
		return;
	}
	const owner = isOwnershipMap(ownership) ? ownership.get(toolName) : undefined;
	if (owner && owner !== extensionId) {
		diagnostic(
			diagnostics,
			"error",
			"contribution-add-tool-unowned",
			`Tool \`${toolName}\` is owned by \`${owner}\`, not \`${extensionId}\`; addTools rejected for \`${agentName}\`.`,
			extensionId,
			agentName,
		);
		return;
	}
	diagnostic(
		diagnostics,
		"error",
		"contribution-add-tool-unregistered",
		`Tool \`${toolName}\` has no extension owner in Pi's effective registry (unregistered, host, bundled, or another runtime winner); extension \`${extensionId}\` cannot add it to \`${agentName}\`.`,
		extensionId,
		agentName,
	);
}

/**
 * Final pre-dispatch view of patched tools. Universe `addTools` already live on
 * `agent.tools`; extension-provided extras stay provenance-tagged until the
 * extension is actually mounted. Legacy `tools === undefined` is preserved.
 * Snapshot `providedTools` is ignored; only Pi's unique winner owner counts.
 */
export function dispatchExtensionToolNames(
	mountedExtensionIds: Iterable<string> = mountedExtensionIdsFromEnv(),
	_snapshot?: ExtensionAgentContributionSnapshot,
	ownership: ExtensionToolOwnership = extensionToolOwnership(),
): string[] {
	const mounted = new Set([...mountedExtensionIds].map((id) => id.trim()).filter(Boolean));
	const names = new Set<string>();
	for (const [toolName, ownerId] of ownership) {
		if (!mounted.has(ownerId) || isBuiltInOrReservedPatchTool(toolName)) continue;
		names.add(toolName);
	}
	return [...names];
}

export function dispatchToolPatch(
	agent: AgentConfig,
	mountedExtensionIds: Iterable<string> = mountedExtensionIdsFromEnv(),
	ownership: Iterable<string> | ExtensionToolOwnership = extensionToolOwnership(),
): { declaredTools: string[] | undefined; extraDisabledTools: string[]; diagnostics: AgentDiagnostic[] } {
	const mounted = new Set([...mountedExtensionIds].map((id) => id.trim()).filter(Boolean));
	const diagnostics: AgentDiagnostic[] = [];
	const extras: string[] = [];
	for (const request of agent.extensionToolRequests ?? []) {
		if (isBuiltInOrReservedPatchTool(request.name)) {
			rejectUnownedAddTool(diagnostics, request.extensionId, agent.name, request.name, ownership);
			continue;
		}
		if (!mounted.has(request.extensionId)) {
			rejectUnownedAddTool(diagnostics, request.extensionId, agent.name, request.name, ownership, true);
			continue;
		}
		if (!requestOwnsTool(request.extensionId, request.name, ownership)) {
			rejectUnownedAddTool(diagnostics, request.extensionId, agent.name, request.name, ownership);
			continue;
		}
		extras.push(request.name);
	}
	if (agent.tools === undefined) {
		return {
			declaredTools: undefined,
			extraDisabledTools: [...new Set(agent.extensionRemovedTools ?? [])],
			diagnostics,
		};
	}
	const names = [...agent.tools];
	for (const extra of extras) {
		if (!names.includes(extra)) names.push(extra);
	}
	return { declaredTools: names, extraDisabledTools: [], diagnostics };
}

export function loadExtensionAgentContributionSnapshot(
	env: NodeJS.ProcessEnv = process.env,
): ExtensionAgentContributionSnapshot {
	const inline = typeof env[EXT_AGENT_CONTRIBUTIONS_ENV] === "string" ? env[EXT_AGENT_CONTRIBUTIONS_ENV]!.trim() : "";
	if (inline) return parseExtensionAgentContributionSnapshot(inline, EXT_AGENT_CONTRIBUTIONS_ENV);
	const file = typeof env[EXT_AGENT_CONTRIBUTIONS_FILE_ENV] === "string" ? env[EXT_AGENT_CONTRIBUTIONS_FILE_ENV]!.trim() : "";
	if (!file) return { extensions: [], diagnostics: [] };
	const sessionRoot = typeof env[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV] === "string"
		? env[EXT_AGENT_CONTRIBUTIONS_SESSION_ROOT_ENV]!.trim()
		: "";
	return readContributionSnapshotFile(file, sessionRoot);
}

function snapshotSourceLabel(source: string): string {
	if (!source) return EXT_AGENT_CONTRIBUTIONS_ENV;
	if (path.isAbsolute(source) || source.includes("/") || source.includes("\\")) return EXT_AGENT_CONTRIBUTIONS_FILE_ENV;
	return source;
}

export function parseExtensionAgentContributionSnapshot(
	raw: string,
	source = EXT_AGENT_CONTRIBUTIONS_ENV,
): ExtensionAgentContributionSnapshot {
	const diagnostics: AgentDiagnostic[] = [];
	const label = snapshotSourceLabel(source);
	if (Buffer.byteLength(raw, "utf8") > MAX_SNAPSHOT_BYTES) {
		diagnostic(diagnostics, "error", "contribution-snapshot-oversize", `Extension contribution snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes.`, label);
		return { extensions: [], diagnostics };
	}
	if (PROMPT_FORBIDDEN.test(raw) || raw.includes("\0")) {
		diagnostic(diagnostics, "error", "contribution-snapshot-invalid", "Extension contribution snapshot contains control characters.", label);
		return { extensions: [], diagnostics };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		diagnostic(
			diagnostics,
			"error",
			"contribution-snapshot-invalid",
			"Extension contribution snapshot is not JSON.",
			label,
		);
		return { extensions: [], diagnostics };
	}
	return validateContributionSnapshot(parsed, label, diagnostics);
}

function isConfinedSnapshotPath(value: string): boolean {
	return path.isAbsolute(value) && !PROMPT_FORBIDDEN.test(value) && !value.includes("\0");
}
const SIDECAR_OWNER_MODE = 0o600;
function sameSidecarInode(left: fs.Stats, right: fs.Stats): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}
function sidecarStatRejectReason(stat: fs.Stats): { oversize: boolean; message: string } | undefined {
	if (!stat.isFile()) {
		return { oversize: false, message: "Extension contribution snapshot file path is not a regular file." };
	}
	if ((stat.mode & 0o777) !== SIDECAR_OWNER_MODE) {
		return { oversize: false, message: "Extension contribution snapshot file must be owner-only (0600)." };
	}
	if (stat.nlink !== 1) {
		return { oversize: false, message: "Extension contribution snapshot file must not be hard-linked." };
	}
	if (stat.size > MAX_SNAPSHOT_BYTES) {
		return { oversize: true, message: `Extension contribution snapshot file exceeds ${MAX_SNAPSHOT_BYTES} bytes.` };
	}
	return undefined;
}
/** Test-only probes between lstat and open, and after the opened fd is fstat'd. Never used in production. */
export type ContributionSidecarReadProbe = {
	afterLstat?: (filePath: string) => void;
	afterOpen?: (filePath: string) => void;
};
let contributionSidecarReadProbe: ContributionSidecarReadProbe | undefined;
export function setContributionSidecarReadProbeForTest(probe?: ContributionSidecarReadProbe): void {
	contributionSidecarReadProbe = probe;
}
/**
 * Read the session-owned sidecar under a realpath jail - never a bare `isAbsolute` check.
 *
 * Security checks bind to the inode actually opened: pre-open lstat, O_NOFOLLOW open,
 * fstat of that fd (regular / exact 0600 / nlink===1 / size / same dev+ino as pre-lstat),
 * then a current-path lstat+realpath that must name the same inode so the jail verdict
 * cannot drift onto a swapped file. Bytes are always read from that verified fd.
 * Every violation fails closed: diagnostics only, no extensions.
 */
function readContributionSnapshotFile(filePath: string, sessionRoot = ""): ExtensionAgentContributionSnapshot {
	const diagnostics: AgentDiagnostic[] = [];
	const sourceLabel = EXT_AGENT_CONTRIBUTIONS_FILE_ENV;
	const invalid = (message: string): ExtensionAgentContributionSnapshot => {
		diagnostic(diagnostics, "error", "contribution-snapshot-invalid", message, sourceLabel);
		return { extensions: [], diagnostics };
	};
	const rejected = (reason: { oversize: boolean; message: string }): ExtensionAgentContributionSnapshot => {
		if (reason.oversize) {
			diagnostic(diagnostics, "error", "contribution-snapshot-oversize", reason.message, sourceLabel);
			return { extensions: [], diagnostics };
		}
		return invalid(reason.message);
	};
	if (!isConfinedSnapshotPath(filePath) || !isConfinedSnapshotPath(sessionRoot)) {
		return invalid("Extension contribution snapshot file requires a confined absolute path and a session root.");
	}
	if (!path.basename(filePath).endsWith(EXT_AGENT_CONTRIBUTIONS_SIDECAR_SUFFIX)) {
		return invalid(`Extension contribution snapshot file must end with ${EXT_AGENT_CONTRIBUTIONS_SIDECAR_SUFFIX}.`);
	}
	let preStat: fs.Stats;
	try {
		// Lstat the ORIGINAL path: a symlink at the final component must be rejected even
		// when its target lives inside the same jail directory, so the resolved inode is
		// never inspected in its place.
		preStat = fs.lstatSync(filePath);
	} catch {
		diagnostic(
			diagnostics,
			"error",
			"contribution-missing-file",
			"Cannot stat extension contribution snapshot file.",
			sourceLabel,
		);
		return { extensions: [], diagnostics };
	}
	const preReject = sidecarStatRejectReason(preStat);
	if (preReject) return rejected(preReject);
	const noFollow = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
	let fd: number | undefined;
	try {
		contributionSidecarReadProbe?.afterLstat?.(filePath);
		fd = fs.openSync(filePath, fs.constants.O_RDONLY | (noFollow ?? 0));
		const opened = fs.fstatSync(fd);
		const openedReject = sidecarStatRejectReason(opened);
		if (openedReject) {
			const error = new Error(openedReject.message);
			(error as NodeJS.ErrnoException).code = openedReject.oversize ? "CONTRIB_OVERSIZE" : "CONTRIB_INVALID";
			throw error;
		}
		if (!sameSidecarInode(preStat, opened)) {
			throw new Error("sidecar inode changed between lstat and open");
		}
		contributionSidecarReadProbe?.afterOpen?.(filePath);
		// Bind the jail to the opened inode: the live path must still name this fd,
		// and its realpath parent must be the host-minted session root.
		const current = fs.lstatSync(filePath);
		if (!current.isFile() || !sameSidecarInode(opened, current)) {
			throw new Error("sidecar path no longer names the opened inode");
		}
		let realFile: string;
		let realRoot: string;
		try {
			realFile = fs.realpathSync(filePath);
			realRoot = fs.realpathSync(sessionRoot);
		} catch {
			diagnostic(
				diagnostics,
				"error",
				"contribution-missing-file",
				"Cannot resolve extension contribution snapshot file.",
				sourceLabel,
			);
			return { extensions: [], diagnostics };
		}
		const realFileStat = fs.lstatSync(realFile);
		if (!sameSidecarInode(opened, realFileStat)) {
			throw new Error("sidecar realpath does not name the opened inode");
		}
		if (path.dirname(realFile) !== realRoot || !fs.statSync(realRoot).isDirectory()) {
			return invalid("Extension contribution snapshot file is outside the session-owned jail.");
		}
		const buffer = Buffer.alloc(opened.size);
		let offset = 0;
		while (offset < buffer.length) {
			const read = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
			if (read <= 0) break;
			offset += read;
		}
		return parseExtensionAgentContributionSnapshot(buffer.toString("utf8", 0, offset), sourceLabel);
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		const oversize = err.code === "CONTRIB_OVERSIZE" || (error instanceof Error && /exceeds \d+ bytes/.test(error.message));
		const specific = err.code === "CONTRIB_INVALID" && error instanceof Error ? error.message : undefined;
		const message = oversize
			? `Extension contribution snapshot file exceeds ${MAX_SNAPSHOT_BYTES} bytes.`
			: (specific ?? "Cannot read extension contribution snapshot file.");
		const code = oversize ? "contribution-snapshot-oversize" : "contribution-snapshot-invalid";
		diagnostic(diagnostics, "error", code, message, sourceLabel);
		return { extensions: [], diagnostics };
	} finally {
		if (fd !== undefined) {
			try { fs.closeSync(fd); } catch { /* already closed */ }
		}
	}
}

function validateContributionSnapshot(
	raw: unknown,
	source: string,
	diagnostics: AgentDiagnostic[],
): ExtensionAgentContributionSnapshot {
	if (!isRecord(raw)) {
		diagnostic(diagnostics, "error", "contribution-snapshot-invalid", "Extension contribution snapshot must be an object.", source);
		return { extensions: [], diagnostics };
	}
	for (const key of Object.keys(raw)) {
		if (!SNAPSHOT_FIELDS.has(key)) {
			diagnostic(diagnostics, "error", "contribution-snapshot-invalid", `Unknown snapshot field \`${key}\`.`, source);
			return { extensions: [], diagnostics };
		}
	}
	if (raw.version !== STANDARD_SCHEMA) {
		diagnostic(diagnostics, "error", "contribution-snapshot-invalid", "Extension contribution snapshot requires `version: 1`.", source);
		return { extensions: [], diagnostics };
	}
	if (!Array.isArray(raw.extensions)) {
		diagnostic(diagnostics, "error", "contribution-snapshot-invalid", "Extension contribution snapshot `extensions` must be an array.", source);
		return { extensions: [], diagnostics };
	}
	if (raw.extensions.length > MAX_EXTENSIONS) {
		diagnostic(diagnostics, "error", "contribution-snapshot-oversize", `Extension contribution snapshot has more than ${MAX_EXTENSIONS} extensions.`, source);
		return { extensions: [], diagnostics };
	}
	const extensions: ExtensionAgentContribution[] = [];
	const seenIds = new Set<string>();
	for (let index = 0; index < raw.extensions.length; index++) {
		const entry = parseContributionExtension(raw.extensions[index], source, index, diagnostics);
		if (!entry) continue;
		if (seenIds.has(entry.id)) {
			diagnostic(diagnostics, "warning", "contribution-duplicate-id", `Duplicate extension id \`${entry.id}\` in contribution snapshot; later entry is kept in origin/id order.`, source, entry.id);
		}
		seenIds.add(entry.id);
		extensions.push(entry);
	}
	extensions.sort((left, right) => {
		const originDelta = EXTENSION_ORIGIN_RANK[left.origin] - EXTENSION_ORIGIN_RANK[right.origin];
		return originDelta !== 0 ? originDelta : left.id.localeCompare(right.id);
	});
	return { extensions, diagnostics };
}

function parseContributionExtension(
	raw: unknown,
	source: string,
	index: number,
	diagnostics: AgentDiagnostic[],
): ExtensionAgentContribution | undefined {
	const label = `${source} extensions[${index}]`;
	if (!isRecord(raw)) {
		diagnostic(diagnostics, "error", "contribution-extension-invalid", "Contribution extension entry must be an object.", label);
		return undefined;
	}
	for (const key of Object.keys(raw)) {
		if (!EXTENSION_FIELDS.has(key)) {
			diagnostic(diagnostics, "error", "contribution-extension-invalid", `Unknown contribution extension field \`${key}\`.`, label);
			return undefined;
		}
	}
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (!id || !EXTENSION_ID.test(id)) {
		diagnostic(diagnostics, "error", "contribution-extension-invalid", "Contribution extension `id` is missing or invalid.", label);
		return undefined;
	}
	if (raw.origin !== "builtin" && raw.origin !== "app" && raw.origin !== "project") {
		diagnostic(diagnostics, "error", "contribution-extension-invalid", "Contribution extension `origin` must be `builtin`, `app`, or `project`.", label, id);
		return undefined;
	}
	const root = typeof raw.root === "string" ? raw.root.trim() : "";
	if (!root || !path.isAbsolute(root) || PROMPT_FORBIDDEN.test(root) || root.includes("\0")) {
		diagnostic(diagnostics, "error", "contribution-extension-invalid", "Contribution extension `root` must be an absolute path.", label, id);
		return undefined;
	}
	const agents = parsePathList(raw.agents, "agents", label, id, diagnostics, MAX_AGENTS_PER_EXTENSION);
	const patchesRaw = raw.patches;
	if (patchesRaw !== undefined && !Array.isArray(patchesRaw)) {
		diagnostic(diagnostics, "error", "contribution-extension-invalid", "Contribution extension `patches` must be an array.", label, id);
		return undefined;
	}
	if ((patchesRaw?.length ?? 0) > MAX_PATCHES_PER_EXTENSION) {
		diagnostic(diagnostics, "error", "contribution-snapshot-oversize", `Contribution extension \`${id}\` has more than ${MAX_PATCHES_PER_EXTENSION} patches.`, label, id);
		return undefined;
	}
	const patches: ExtensionAgentPatch[] = [];
	for (let patchIndex = 0; patchIndex < (patchesRaw?.length ?? 0); patchIndex++) {
		const patch = parseContributionPatch(patchesRaw![patchIndex], `${label} patches[${patchIndex}]`, id, diagnostics);
		if (patch) patches.push(patch);
	}
	const providedTools = parseToolNameList(raw.providedTools, "providedTools", label, id, diagnostics);
	if (agents === undefined || providedTools === undefined) return undefined;
	return { id, origin: raw.origin, root, agents, patches, providedTools };
}

function parseContributionPatch(
	raw: unknown,
	label: string,
	extensionId: string,
	diagnostics: AgentDiagnostic[],
): ExtensionAgentPatch | undefined {
	if (!isRecord(raw)) {
		diagnostic(diagnostics, "error", "contribution-patch-invalid", "Contribution patch must be an object.", label, extensionId);
		return undefined;
	}
	for (const key of Object.keys(raw)) {
		if (!PATCH_FIELDS.has(key)) {
			diagnostic(diagnostics, "error", "contribution-patch-invalid", `Unknown contribution patch field \`${key}\`.`, label, extensionId);
			return undefined;
		}
	}
	const target = typeof raw.target === "string" ? raw.target.trim() : "";
	if (!target) {
		diagnostic(diagnostics, "error", "contribution-patch-invalid", "Contribution patch `target` must be a non-empty string.", label, extensionId);
		return undefined;
	}
	const appendPrompt = optionalAbsolutePath(raw.appendPrompt, "appendPrompt", label, extensionId, diagnostics);
	const replacePrompt = optionalAbsolutePath(raw.replacePrompt, "replacePrompt", label, extensionId, diagnostics);
	if (appendPrompt === false || replacePrompt === false) return undefined;
	if (appendPrompt && replacePrompt) {
		diagnostic(diagnostics, "error", "contribution-patch-invalid", "Contribution patch cannot set both `appendPrompt` and `replacePrompt`.", label, target);
		return undefined;
	}
	const addTools = parseToolNameList(raw.addTools, "addTools", label, target, diagnostics);
	const removeTools = parseToolNameList(raw.removeTools, "removeTools", label, target, diagnostics);
	if (addTools === undefined || removeTools === undefined) return undefined;
	if (!appendPrompt && !replacePrompt && addTools.length === 0 && removeTools.length === 0) {
		diagnostic(diagnostics, "error", "contribution-patch-invalid", "Contribution patch has no prompt or tool operations.", label, target);
		return undefined;
	}
	return {
		target,
		...(appendPrompt ? { appendPrompt } : {}),
		...(replacePrompt ? { replacePrompt } : {}),
		...(addTools.length > 0 ? { addTools } : {}),
		...(removeTools.length > 0 ? { removeTools } : {}),
	};
}

function parsePathList(
	raw: unknown,
	field: string,
	label: string,
	extensionId: string,
	diagnostics: AgentDiagnostic[],
	limit: number,
): string[] | undefined {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		diagnostic(diagnostics, "error", "contribution-extension-invalid", `Contribution extension \`${field}\` must be an array.`, label, extensionId);
		return undefined;
	}
	if (raw.length > limit) {
		diagnostic(diagnostics, "error", "contribution-snapshot-oversize", `Contribution extension \`${field}\` exceeds ${limit} entries.`, label, extensionId);
		return undefined;
	}
	const paths: string[] = [];
	for (let index = 0; index < raw.length; index++) {
		const value = typeof raw[index] === "string" ? raw[index].trim() : "";
		if (!value || !path.isAbsolute(value) || PROMPT_FORBIDDEN.test(value) || value.includes("\0")) {
			diagnostic(diagnostics, "error", "contribution-path-escape", `Contribution ${field}[${index}] must be an absolute path.`, label, extensionId);
			return undefined;
		}
		paths.push(value);
	}
	return paths;
}

function parseToolNameList(
	raw: unknown,
	field: string,
	label: string,
	agentName: string,
	diagnostics: AgentDiagnostic[],
): string[] | undefined {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		diagnostic(diagnostics, "error", "contribution-patch-invalid", `Contribution \`${field}\` must be an array of tool names.`, label, agentName);
		return undefined;
	}
	if (raw.length > MAX_TOOL_NAMES) {
		diagnostic(diagnostics, "error", "contribution-snapshot-oversize", `Contribution \`${field}\` exceeds ${MAX_TOOL_NAMES} names.`, label, agentName);
		return undefined;
	}
	const names: string[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < raw.length; index++) {
		if (typeof raw[index] !== "string" || !raw[index].trim()) {
			diagnostic(diagnostics, "error", "contribution-patch-invalid", `Contribution \`${field}\` entry ${index + 1} must be a non-empty string.`, label, agentName);
			return undefined;
		}
		const name = raw[index].trim();
		if (PROMPT_FORBIDDEN.test(name) || name.includes("\0")) {
			diagnostic(diagnostics, "error", "contribution-patch-invalid", `Contribution \`${field}\` entry ${index + 1} contains control characters.`, label, agentName);
			return undefined;
		}
		if (!seen.has(name)) {
			seen.add(name);
			names.push(name);
		}
	}
	return names;
}

function optionalAbsolutePath(
	raw: unknown,
	field: string,
	label: string,
	extensionId: string,
	diagnostics: AgentDiagnostic[],
): string | false | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "string" || !raw.trim() || !path.isAbsolute(raw.trim()) || PROMPT_FORBIDDEN.test(raw) || raw.includes("\0")) {
		diagnostic(diagnostics, "error", "contribution-path-escape", `Contribution patch \`${field}\` must be an absolute path.`, label, extensionId);
		return false;
	}
	return raw.trim();
}

function cloneAgent(agent: AgentConfig): AgentConfig {
	return {
		...agent,
		...(agent.tools !== undefined ? { tools: [...agent.tools] } : {}),
		...(agent.explicitTools !== undefined ? { explicitTools: [...agent.explicitTools] } : {}),
		capabilities: { ...agent.capabilities, mcpTools: [...agent.capabilities.mcpTools] },
		traits: { ...agent.traits },
		...(agent.extensionToolRequests
			? { extensionToolRequests: agent.extensionToolRequests.map((request) => ({ ...request })) }
			: {}),
		...(agent.extensionRemovedTools ? { extensionRemovedTools: [...agent.extensionRemovedTools] } : {}),
	};
}

function realPathIfExists(target: string): string | undefined {
	try {
		return fs.realpathSync(target);
	} catch {
		return undefined;
	}
}

function contributionRel(rootReal: string, candidate: string): string {
	const rel = path.relative(rootReal, candidate);
	if (!rel || path.isAbsolute(rel) || rel.startsWith("..")) return path.basename(candidate);
	return rel.split(path.sep).join("/");
}

function confinedToRoot(
	rootReal: string,
	candidate: string,
	diagnostics: AgentDiagnostic[],
	message: string,
	sourceLabel: string,
	agentName?: string,
): string | undefined {
	const real = realPathIfExists(candidate);
	if (!real) {
		diagnostic(diagnostics, "error", "contribution-missing-file", message, sourceLabel, agentName);
		return undefined;
	}
	const rel = path.relative(rootReal, real);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		diagnostic(diagnostics, "error", "contribution-path-escape", message, sourceLabel, agentName);
		return undefined;
	}
	return real;
}

function readConfinedPrompt(
	rootReal: string,
	promptPath: string,
	diagnostics: AgentDiagnostic[],
	agentName: string,
	sourceLabel: string,
): string | undefined {
	const rel = contributionRel(rootReal, promptPath);
	const real = confinedToRoot(
		rootReal,
		promptPath,
		diagnostics,
		`Prompt file is missing or escapes extension root (\`${rel}\`).`,
		sourceLabel,
		agentName,
	);
	if (!real) return undefined;
	try {
		const stat = fs.statSync(real);
		if (!stat.isFile()) {
			diagnostic(diagnostics, "error", "contribution-missing-file", `Prompt path is not a file (\`${rel}\`).`, sourceLabel, agentName);
			return undefined;
		}
		if (stat.size > MAX_PROMPT_BYTES) {
			diagnostic(diagnostics, "error", "contribution-prompt-invalid", `Prompt file exceeds ${MAX_PROMPT_BYTES} bytes.`, sourceLabel, agentName);
			return undefined;
		}
		const text = fs.readFileSync(real, "utf8");
		if (PROMPT_FORBIDDEN.test(text) || text.includes("\0")) {
			diagnostic(diagnostics, "error", "contribution-prompt-invalid", "Prompt file contains control characters.", sourceLabel, agentName);
			return undefined;
		}
		const trimmed = text.trim();
		if (!trimmed) {
			diagnostic(diagnostics, "error", "contribution-prompt-invalid", "Prompt file is empty.", sourceLabel, agentName);
			return undefined;
		}
		return trimmed;
	} catch {
		diagnostic(
			diagnostics,
			"error",
			"contribution-missing-file",
			`Cannot read prompt file (\`${rel}\`).`,
			sourceLabel,
			agentName,
		);
		return undefined;
	}
}

function agentIdentityForExtension(origin: ExtensionContributionOrigin): { source: AgentSource; origin: AgentOrigin } {
	return origin === "project"
		? { source: "project", origin: "project" }
		: { source: "user", origin: "user" };
}

function loadContributedPackage(
	extension: ExtensionAgentContribution,
	rootReal: string,
	agentPath: string,
	diagnostics: AgentDiagnostic[],
): AgentConfig | undefined {
	const rel = contributionRel(rootReal, agentPath);
	const real = confinedToRoot(
		rootReal,
		agentPath,
		diagnostics,
		`Contributed agent path is missing or escapes extension root (\`${rel}\`).`,
		extension.id,
	);
	if (!real) return undefined;
	const packageFile = statIsDirectory(real) ? path.join(real, STANDARD_AGENT_FILE) : real;
	const pkgRel = contributionRel(rootReal, packageFile);
	if (path.basename(packageFile) !== STANDARD_AGENT_FILE) {
		diagnostic(diagnostics, "error", "contribution-extension-invalid", `Contributed agent must be a ${STANDARD_AGENT_FILE} package (\`${rel}\`).`, extension.id);
		return undefined;
	}
	const packageReal = confinedToRoot(
		rootReal,
		packageFile,
		diagnostics,
		`Contributed agent package is missing or escapes extension root (\`${pkgRel}\`).`,
		extension.id,
	);
	if (!packageReal || !statIsFile(packageReal)) {
		diagnostic(diagnostics, "error", "contribution-missing-file", `Contributed agent package is not a file (\`${pkgRel}\`).`, extension.id);
		return undefined;
	}
	const identity = agentIdentityForExtension(extension.origin);
	try {
		const parsed = parseAgentFile({
			filePath: packageReal,
			content: fs.readFileSync(packageReal, "utf8"),
			source: identity.source,
			origin: identity.origin,
			format: "package",
			directoryName: path.basename(path.dirname(packageReal)),
		});
		for (const entry of parsed.diagnostics) {
			diagnostics.push({
				...entry,
				filePath: extension.id,
				message: entry.message,
			});
		}
		return parsed.config;
	} catch {
		diagnostic(
			diagnostics,
			"error",
			"read-error",
			`Cannot read contributed agent package (\`${pkgRel}\`).`,
			extension.id,
		);
		return undefined;
	}
}

function recordExtensionToolRequest(agent: AgentConfig, name: string, extensionId: string): void {
	const already = agent.extensionToolRequests?.some((request) => request.name === name && request.extensionId === extensionId);
	if (!already) {
		agent.extensionToolRequests = [...(agent.extensionToolRequests ?? []), { name, extensionId }];
	}
}

function applyToolPatch(
	agent: AgentConfig,
	patch: ExtensionAgentPatch,
	extension: ExtensionAgentContribution,
	diagnostics: AgentDiagnostic[],
): { addTools: string[]; removeTools: string[] } {
	const trustedSecretary = agent.origin === "bundled" && agent.name === "secretary";
	const universe = agent.capabilities.legacy ? null : new Set(capabilityToolNames(agent.capabilities, trustedSecretary));
	const acceptedAdd: string[] = [];
	const ownership = extensionToolOwnership();
	const captured = hasCapturedExtensionToolOwnership();
	for (const name of patch.addTools ?? []) {
		if (HOST_DENIED_PATCH_TOOLS.has(name)) {
			diagnostic(
				diagnostics,
				"error",
				"contribution-reserved-tool",
				`Extension \`${extension.id}\` cannot add host-issued or reserved tool \`${name}\` to \`${agent.name}\`.`,
				extension.id,
				agent.name,
			);
			continue;
		}
		if (universe?.has(name)) {
			if (agent.tools !== undefined && !agent.tools.includes(name)) agent.tools.push(name);
			acceptedAdd.push(name);
			continue;
		}
		if (isBuiltInOrReservedPatchTool(name)) {
			diagnostic(
				diagnostics,
				"error",
				"contribution-add-tool-denied",
				`Extension \`${extension.id}\` cannot add \`${name}\` to \`${agent.name}\`: not in the capability universe, and built-in/reserved/host tools cannot ride the extension branch.`,
				extension.id,
				agent.name,
			);
			continue;
		}
		// Non-universe custom addTools are provisional until Pi's unique winner is known.
		// Snapshot `providedTools` is never an allowlist.
		if (captured) {
			if (!requestOwnsTool(extension.id, name, ownership)) {
				rejectUnownedAddTool(diagnostics, extension.id, agent.name, name, ownership);
				continue;
			}
			recordExtensionToolRequest(agent, name, extension.id);
			acceptedAdd.push(name);
			continue;
		}
		recordExtensionToolRequest(agent, name, extension.id);
	}
	const removed = [...new Set(patch.removeTools ?? [])];
	if (removed.length === 0) return { addTools: acceptedAdd, removeTools: [] };
	const removedSet = new Set(removed);
	if (agent.tools !== undefined) {
		agent.tools = agent.tools.filter((name) => !removedSet.has(name));
	} else {
		agent.extensionRemovedTools = [...new Set([...(agent.extensionRemovedTools ?? []), ...removed])];
	}
	if (agent.extensionToolRequests) {
		agent.extensionToolRequests = agent.extensionToolRequests.filter((request) => !removedSet.has(request.name));
		if (agent.extensionToolRequests.length === 0) delete agent.extensionToolRequests;
	}
	return { addTools: acceptedAdd, removeTools: removed };
}

function applyPromptPatch(
	agent: AgentConfig,
	patch: ExtensionAgentPatch,
	extension: ExtensionAgentContribution,
	rootReal: string,
	diagnostics: AgentDiagnostic[],
): { appendPrompt: boolean; replacePrompt: boolean } {
	let replacePrompt = false;
	let appendPrompt = false;
	if (patch.replacePrompt) {
		if (isCanonicalPrivilegedBundledRole(agent.name, agent.origin)) {
			diagnostic(
				diagnostics,
				"error",
				"contribution-replace-forbidden",
				`Extension \`${extension.id}\` cannot replacePrompt on canonical privileged bundled role \`${agent.name}\`.`,
				extension.id,
				agent.name,
			);
		} else {
			const text = readConfinedPrompt(rootReal, patch.replacePrompt, diagnostics, agent.name, extension.id);
			if (text !== undefined) {
				agent.systemPrompt = text;
				replacePrompt = true;
			}
		}
	}
	if (patch.appendPrompt) {
		const text = readConfinedPrompt(rootReal, patch.appendPrompt, diagnostics, agent.name, extension.id);
		if (text !== undefined) {
			agent.systemPrompt = agent.systemPrompt.trim() ? `${agent.systemPrompt.trimEnd()}\n\n${text}` : text;
			appendPrompt = true;
		}
	}
	return { appendPrompt, replacePrompt };
}

function recordAppliedPatch(
	applied: AppliedExtensionPatch[],
	extension: ExtensionAgentContribution,
	target: string,
	promptOps: { appendPrompt: boolean; replacePrompt: boolean },
	toolOps: { addTools: string[]; removeTools: string[] },
): void {
	const operations: AgentPatchOperationKind[] = [];
	if (promptOps.appendPrompt) operations.push("appendPrompt");
	if (promptOps.replacePrompt) operations.push("replacePrompt");
	if (toolOps.addTools.length) operations.push("addTools");
	if (toolOps.removeTools.length) operations.push("removeTools");
	if (!operations.length) return;
	applied.push({
	extensionId: extension.id,
		origin: extension.origin,
		target,
		operations,
		...(toolOps.addTools.length ? { addTools: toolOps.addTools } : {}),
		...(toolOps.removeTools.length ? { removeTools: toolOps.removeTools } : {}),
	});
}

export function applyExtensionAgentContributions(
	base: AgentDiscoveryResult,
	snapshot: ExtensionAgentContributionSnapshot,
): AgentDiscoveryResult {
	const diagnostics = [...base.diagnostics, ...snapshot.diagnostics];
	const appliedPatches: AppliedExtensionPatch[] = [...(base.appliedPatches ?? [])];
	const agentMap = new Map(base.agents.map((agent) => [agent.name, agent]));
	for (const extension of snapshot.extensions) {
		const rootReal = realPathIfExists(extension.root);
		if (!rootReal || !statIsDirectory(rootReal)) {
			diagnostic(
				diagnostics,
				"error",
				"contribution-missing-file",
				`Contribution extension \`${extension.id}\` root is missing or not a directory.`,
				extension.id,
				extension.id,
			);
			continue;
		}
		for (const agentPath of extension.agents) {
			const contributed = loadContributedPackage(extension, rootReal, agentPath, diagnostics);
			if (!contributed) continue;
			const existing = agentMap.get(contributed.name);
			if (existing) {
				diagnostic(
					diagnostics,
					"error",
					"contribution-name-conflict",
					`Contributed agent \`${contributed.name}\` from \`${extension.id}\` conflicts with existing ${existing.origin} definition; contribution rejected.`,
					extension.id,
					contributed.name,
				);
				continue;
			}
			agentMap.set(contributed.name, contributed);
		}
		for (const patch of extension.patches) {
			const current = agentMap.get(patch.target);
			if (!current) {
				diagnostic(
					diagnostics,
					"error",
					"contribution-target-missing",
					`Extension \`${extension.id}\` patch target \`${patch.target}\` is not in the effective catalog.`,
					extension.id,
					patch.target,
				);
				continue;
			}
			const next = cloneAgent(current);
			const promptOps = applyPromptPatch(next, patch, extension, rootReal, diagnostics);
			const toolOps = applyToolPatch(next, patch, extension, diagnostics);
			recordAppliedPatch(appliedPatches, extension, patch.target, promptOps, toolOps);
			agentMap.set(next.name, next);
		}
	}
	return {
		agents: Array.from(agentMap.values()),
		projectAgentsDir: base.projectAgentsDir,
		diagnostics,
		appliedPatches,
	};
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const base = discoverAgentsFromRoots(
		{
			userDir: path.join(getAgentDir(), "agents"),
			projectAgentsDir: findNearestProjectAgentsDir(cwd),
			pipiuiAgentsDir: process.env.PIPIUI_AGENTS_DIR,
		},
		scope,
	);
	try {
		return applyExtensionAgentContributions(base, loadExtensionAgentContributionSnapshot());
	} catch (error) {
		return {
			...base,
			diagnostics: [
				...base.diagnostics,
				{
					severity: "error",
					code: "contribution-snapshot-invalid",
					message: `Extension contribution merge failed: ${error instanceof Error ? error.message : String(error)}.`,
				},
			],
		};
	}
}

function diagnosticScopeLabel(entry: AgentDiagnostic): string {
	if (entry.agentName) return ` ${entry.agentName}:`;
	const marker = entry.filePath;
	if (marker && !path.isAbsolute(marker) && !marker.includes("/") && !marker.includes("\\")) {
		return ` ${marker}:`;
	}
	return "";
}

export function formatAgentDiagnostics(diagnostics: AgentDiagnostic[], maxItems: number = 12): string {
	if (diagnostics.length === 0) return "none";
	const listed = diagnostics.slice(0, Math.max(1, maxItems));
	const text = listed
		.map((entry) => `[${entry.severity}]${diagnosticScopeLabel(entry)} ${entry.message}`)
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
