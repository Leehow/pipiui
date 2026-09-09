/**
 * pi-subagents → PipiUI package converter.
 *
 * `pi-subagents` (nicobailon/pi-subagents, MIT) is the most widely installed
 * subagent extension for pi, and its agent files — `<name>.md`, a frontmatter
 * block followed by the prompt body — are what the community shares. PipiUI
 * keeps its own strict `schema: 1` AGENT.md packages. This module turns one
 * format into the other so those files can be installed here without
 * hand-editing.
 *
 * Pure: no filesystem, no environment, no discovery. `subagent_manage`
 * (agent-management.ts) reads the source, runs this converter, validates the
 * draft through the same runtime parser every package goes through, and
 * installs it through the same atomic path scaffold uses.
 *
 * Every rule here is mechanical. A tool name either maps to a PipiUI
 * capability or it does not; a field either has a PipiUI home or it is dropped
 * and reported. Nothing is inferred from the agent's name or its prose — the
 * caller decides `mode` / `deliverable` when the defaults are wrong.
 */

import type { AgentDiagnostic } from "./agents.ts";

export const PI_SUBAGENTS_CONVERTER_VERSION = 1 as const;

/** Same rule agent-management.ts enforces for scaffold/install names. */
const SAFE_AGENT_NAME = /^[a-z][a-z0-9-]{0,62}$/;

/** pi's builtin tool set — what an upstream file means when it omits `tools:`. */
const PI_DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

const FILESYSTEM_READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const FILESYSTEM_WRITE_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash"]);
/** Must stay identical to the `web` capability compile in agents.ts. */
const WEB_TOOLS = new Set(["web_search", "fetch_content", "source_check", "get_search_content", "arxiv_fetch"]);
const DELEGATION_ENTRY_TOOL = "subagent";
/** PipiUI grants delegation as one unit; must match agents.ts capabilityToolNames. */
const DELEGATION_TOOLS = ["subagent", "subagent_chain", "subagent_abort", "subagent_resolve", "subagent_status"] as const;
const MCP_PREFIX = "mcp:";
const MCP_SERVER = /^[A-Za-z0-9_-]+$/;
const MCP_TOOL = /^[A-Za-z0-9_.-]+$/;

/** Upstream tools that PipiUI issues from the runtime rather than from frontmatter. */
const RUNTIME_ISSUED_TOOLS: Record<string, string> = {
	contact_supervisor: "PipiUI issues `ask_boss` to every dispatched worker; it is not granted by frontmatter.",
};

/**
 * Upstream frontmatter fields with no PipiUI frontmatter home. Each entry is the
 * reason reported when the field is dropped. A field missing from both this
 * table and the mapped set is reported as unknown — that is how a new upstream
 * field surfaces at the next sync instead of vanishing silently.
 */
const DROPPED_FIELD_REASONS: Record<string, string> = {
	package: "PipiUI names are the package directory; the upstream runtime-name prefix is not used.",
	advertise: "no PipiUI equivalent.",
	alias: "PipiUI has no agent aliases; dispatch by name.",
	aliases: "PipiUI has no agent aliases; dispatch by name.",
	fallbackModels: "per-role fallback chains live in PipiUI's Subagent model settings, not in frontmatter.",
	fast: "no PipiUI equivalent.",
	systemPromptMode: "PipiUI always sends its base prompt first and the agent prompt after it; there is no replace mode.",
	inheritProjectContext: "PipiUI workers receive project context through the dispatch brief and context_doc, not frontmatter.",
	inheritGlobalContext: "PipiUI workers receive project context through the dispatch brief and context_doc, not frontmatter.",
	inheritSkills: "PipiUI workers load skills on demand through skill_search / skill_load.",
	defaultContext: "fork is a per-dispatch choice in PipiUI (`fork: true`); the Boss decides per task.",
	async: "background execution is per-dispatch in PipiUI (`run_in_background`).",
	timeoutMs: "wall-clock limits are per-dispatch in PipiUI (`timeoutSecs`).",
	toolTimeoutMs: "no PipiUI equivalent.",
	acceptance: "PipiUI attests a per-dispatch `verify` command instead of an acceptance contract.",
	acceptanceRole: "PipiUI attests a per-dispatch `verify` command instead of an acceptance contract.",
	skill: "PipiUI workers load skills on demand through skill_search / skill_load.",
	skills: "PipiUI workers load skills on demand through skill_search / skill_load.",
	skillPath: "PipiUI workers load skills on demand through skill_search / skill_load.",
	extensions: "PipiUI workers run with a fixed extension set; per-agent extensions cannot be loaded.",
	subagentOnlyExtensions: "PipiUI workers run with a fixed extension set; per-agent extensions cannot be loaded.",
	mutationTools: "no PipiUI equivalent.",
	output: "output routing belongs in the dispatch brief in PipiUI.",
	outputMode: "output routing belongs in the dispatch brief in PipiUI.",
	defaultReads: "default reads belong in the dispatch brief in PipiUI.",
	defaultProgress: "progress forwarding is per-dispatch in PipiUI (`progressLog`).",
	interactive: "no PipiUI equivalent.",
	maxSubagentDepth: "PipiUI enforces its own delegation depth policy.",
	completionGuard: "no PipiUI equivalent.",
	toolBudget: "tool budgets are per-dispatch in PipiUI (`toolBudget`).",
	permission: "PipiUI derives worker permissions from capabilities.",
	permissions: "PipiUI derives worker permissions from capabilities.",
	memory: "PipiUI memory access is host-issued per role.",
};

/** Fields the converter consumes rather than drops. */
const MAPPED_FIELDS = new Set([
	"name",
	"description",
	"tools",
	"excludeTools",
	"allowNestedSubagents",
	"model",
	"thinking",
	"runner",
]);

export interface PiSubagentFrontmatter {
	/** Every recognized `key: value` line, values as raw strings (upstream never types them). */
	fields: Map<string, string>;
	body: string;
	/** False when the file does not open with a frontmatter block. */
	hasFrontmatter: boolean;
}

/**
 * Upstream's grammar is not YAML: `key: value` lines, quoted scalars, and
 * indented blocks for empty / `>` / `|` values; anything else is ignored.
 * Mirroring it keeps every community file parseable without a YAML round trip.
 */
export function parsePiSubagentFile(content: string): PiSubagentFrontmatter {
	const fields = new Map<string, string>();
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---")) return { fields, body: normalized.trim(), hasFrontmatter: false };
	const end = normalized.indexOf("\n---", 3);
	if (end < 0) return { fields, body: normalized.trim(), hasFrontmatter: false };
	const block = normalized.slice(3, end).split("\n");
	const body = normalized.slice(end + 4).trim();

	for (let index = 0; index < block.length; index += 1) {
		const line = block[index];
		const match = /^([\w-]+):\s*(.*)$/.exec(line);
		if (!match) continue;
		const key = match[1];
		let value = match[2].trim();
		const folded = value === ">" || value === ">-";
		const literal = value === "|" || value === "|-";
		if (value === "" || folded || literal) {
			const collected: string[] = [];
			let cursor = index + 1;
			while (cursor < block.length) {
				const candidate = block[cursor];
				if (candidate.trim() === "") {
					// A blank line belongs to the block only when more indented text follows.
					const next = block.slice(cursor + 1).find((entry) => entry.trim() !== "");
					if (next === undefined || !/^\s/.test(next)) break;
					collected.push("");
					cursor += 1;
					continue;
				}
				if (!/^\s/.test(candidate)) break;
				collected.push(candidate);
				cursor += 1;
			}
			index = cursor - 1;
			const indent = collected
				.filter((entry) => entry.trim() !== "")
				.reduce((min, entry) => Math.min(min, /^\s*/.exec(entry)![0].length), Number.POSITIVE_INFINITY);
			const stripped = collected.map((entry) => (entry.trim() === "" ? "" : entry.slice(Number.isFinite(indent) ? indent : 0)));
			value = folded
				? stripped.join("\n").split(/\n{2,}/).map((paragraph) => paragraph.split("\n").join(" ").trim()).join("\n").trim()
				: stripped.join("\n").trim();
		} else if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
			value = value.slice(1, -1);
		}
		fields.set(key, value);
	}
	return { fields, body, hasFrontmatter: true };
}

/** Upstream list syntax: `- item` lines or comma-separated, both split on commas. */
export function parsePiSubagentList(raw: string | undefined): string[] {
	if (!raw) return [];
	const items: string[] = [];
	for (const line of raw.split("\n")) {
		const entry = line.replace(/^\s*-\s+/, "");
		for (const part of entry.split(",")) {
			const trimmed = part.trim();
			if (trimmed) items.push(trimmed);
		}
	}
	return items;
}

export interface PiSubagentImportOptions {
	/** Install under this name instead of the upstream `name`. */
	name?: string;
	/** Force the PipiUI mode; `read-only` also removes edit/write from the tool list. */
	mode?: "read-only" | "worker";
	deliverable?: "implementation" | "report" | "verdict";
	/** Recorded in provenance only: a path, or `sample:<id>`. */
	source: string;
}

export interface DroppedField {
	field: string;
	value: string;
	reason: string;
}

export interface DroppedTool {
	tool: string;
	reason: string;
}

export interface PiSubagentMapping {
	name: string;
	description: string;
	model?: string;
	thinking?: string;
	mode: "read-only" | "worker";
	worktree: "none" | "isolated";
	deliverable: "implementation" | "report" | "verdict";
	capabilities: {
		filesystem: "none" | "read-only" | "workspace-write";
		shell: boolean;
		web: boolean;
		mcpTools: string[];
		delegation: boolean;
	};
	/** The narrowing subset handed to `tools:`; always explicit so upstream allowlists survive. */
	tools: string[];
}

export interface PiSubagentImportResult {
	ok: boolean;
	name?: string;
	/** A complete `schema: 1` AGENT.md; present only when `ok`. */
	draft?: string;
	mapping?: PiSubagentMapping;
	diagnostics: AgentDiagnostic[];
	droppedFields: DroppedField[];
	droppedTools: DroppedTool[];
	provenance: {
		format: "pi-subagents";
		converter: typeof PI_SUBAGENTS_CONVERTER_VERSION;
		source: string;
		upstreamName?: string;
	};
}

function diagnostic(severity: AgentDiagnostic["severity"], code: string, message: string): AgentDiagnostic {
	return { severity, code, message };
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

export interface PackageDraftFields {
	name: string;
	description: string;
	model?: string;
	thinking?: string;
	mode: "read-only" | "worker";
	capabilities: {
		filesystem: "none" | "read-only" | "workspace-write";
		shell: boolean;
		web: boolean;
		mcpTools: string[];
		desktop?: "none" | "requestable";
		delegation: boolean;
	};
	worktree: "none" | "isolated";
	deliverable: "implementation" | "report" | "verdict";
	tools?: string[];
	prompt: string;
}

/** The one serializer for `schema: 1` packages; scaffold and import both emit through it. */
export function renderPackageDraft(fields: PackageDraftFields): string {
	const { capabilities } = fields;
	const lines = [
		"---",
		"schema: 1",
		`name: ${fields.name}`,
		`description: ${yamlString(fields.description)}`,
		...(fields.model ? [`model: ${yamlString(fields.model)}`] : []),
		...(fields.thinking ? [`thinking: ${yamlString(fields.thinking)}`] : []),
		`mode: ${fields.mode}`,
		"capabilities:",
		`  filesystem: ${capabilities.filesystem}`,
		`  shell: ${capabilities.shell}`,
		`  web: ${capabilities.web}`,
		...(capabilities.mcpTools.length === 0
			? ["  mcp: false"]
			: ["  mcp:", "    tools:", ...capabilities.mcpTools.map((tool) => `      - ${yamlString(tool)}`)]),
		`  desktop: ${capabilities.desktop ?? "none"}`,
		`  delegation: ${capabilities.delegation}`,
		`worktree: ${fields.worktree}`,
		`deliverable: ${fields.deliverable}`,
		...(Array.isArray(fields.tools) ? ["tools:", ...fields.tools.map((tool) => `  - ${yamlString(tool)}`)] : []),
		"---",
		"",
		fields.prompt,
		"",
	];
	return lines.join("\n");
}

function isTrue(value: string | undefined): boolean {
	return value !== undefined && value.trim() === "true";
}

/** Convert one upstream file. Never throws; every problem is a diagnostic. */
export function convertPiSubagentDefinition(content: string, options: PiSubagentImportOptions): PiSubagentImportResult {
	const diagnostics: AgentDiagnostic[] = [];
	const droppedFields: DroppedField[] = [];
	const droppedTools: DroppedTool[] = [];
	const parsed = parsePiSubagentFile(content);
	const upstreamName = parsed.fields.get("name")?.trim() || undefined;
	const provenance = {
		format: "pi-subagents" as const,
		converter: PI_SUBAGENTS_CONVERTER_VERSION,
		source: options.source,
		...(upstreamName ? { upstreamName } : {}),
	};
	const fail = (): PiSubagentImportResult => ({ ok: false, diagnostics, droppedFields, droppedTools, provenance, ...(upstreamName ? { name: upstreamName } : {}) });

	if (!parsed.hasFrontmatter) {
		diagnostics.push(diagnostic("error", "missing-frontmatter", "The file does not open with a `---` frontmatter block."));
		return fail();
	}

	// Runner first: an external runner means nothing else in the file applies here.
	const runner = parsed.fields.get("runner");
	if (runner !== undefined) {
		const type = /(?:^|\n)\s*type:\s*["']?([\w-]+)["']?/.exec(runner)?.[1] ?? "";
		if (type && type !== "pi") {
			diagnostics.push(diagnostic(
				"error",
				"unsupported-runner",
				`runner.type \`${type}\` needs an external CLI worker runtime, which PipiUI does not have yet; only native pi agents can be imported.`,
			));
			return fail();
		}
		droppedFields.push({ field: "runner", value: runner, reason: "native pi runner is the only PipiUI runtime; the field is implicit." });
	}

	// Identity.
	const requestedName = (options.name ?? upstreamName ?? "").trim().toLowerCase();
	if (!upstreamName) diagnostics.push(diagnostic("error", "missing-field", "frontmatter `name` is required."));
	if (upstreamName && !SAFE_AGENT_NAME.test(requestedName)) {
		diagnostics.push(diagnostic(
			"error",
			"invalid-name",
			`\`${requestedName}\` is not lower-kebab-case (1-63 chars); pass \`as\` to choose a PipiUI name.`,
		));
	}
	const description = parsed.fields.get("description")?.trim() ?? "";
	if (!description) diagnostics.push(diagnostic("error", "missing-field", "frontmatter `description` is required."));
	if (!parsed.body) diagnostics.push(diagnostic("error", "missing-prompt", "The prompt body after the frontmatter is empty."));
	if (diagnostics.some((entry) => entry.severity === "error")) return fail();

	// Tools → capabilities.
	const declaredTools = parsed.fields.has("tools")
		? parsePiSubagentList(parsed.fields.get("tools"))
		: [...PI_DEFAULT_TOOLS];
	if (!parsed.fields.has("tools")) {
		droppedFields.push({ field: "tools", value: "(omitted)", reason: "upstream omission means pi's builtin tool set; mapped as read/grep/find/ls/edit/write/bash." });
	}
	const excluded = new Set(parsePiSubagentList(parsed.fields.get("excludeTools")));
	if (parsed.fields.has("excludeTools")) {
		droppedFields.push({ field: "excludeTools", value: parsed.fields.get("excludeTools") ?? "", reason: "applied: removed from the tool list before mapping." });
	}
	const requested = declaredTools.filter((tool) => !excluded.has(tool));
	const forceReadOnly = options.mode === "read-only";
	const kept = new Set<string>();
	const mcpTools: string[] = [];
	let delegation = false;
	for (const tool of requested) {
		if (FILESYSTEM_READ_TOOLS.has(tool) || SHELL_TOOLS.has(tool) || WEB_TOOLS.has(tool)) {
			kept.add(tool);
			continue;
		}
		if (FILESYSTEM_WRITE_TOOLS.has(tool)) {
			if (forceReadOnly) droppedTools.push({ tool, reason: "mode was forced to read-only." });
			else kept.add(tool);
			continue;
		}
		if (tool === DELEGATION_ENTRY_TOOL) {
			delegation = true;
			continue;
		}
		if (tool.startsWith(MCP_PREFIX)) {
			const [server, ...rest] = tool.slice(MCP_PREFIX.length).split("/");
			const name = rest.join("/");
			if (server && MCP_SERVER.test(server) && name && MCP_TOOL.test(name)) {
				mcpTools.push(`mcp_${server}_${name}`);
			} else {
				droppedTools.push({ tool, reason: "MCP reference must be `mcp:<server>/<tool>` with plain identifiers." });
			}
			continue;
		}
		if (tool in RUNTIME_ISSUED_TOOLS) {
			droppedTools.push({ tool, reason: RUNTIME_ISSUED_TOOLS[tool] });
			continue;
		}
		droppedTools.push({ tool, reason: "no PipiUI equivalent." });
	}
	if (isTrue(parsed.fields.get("allowNestedSubagents"))) delegation = true;
	if (parsed.fields.has("allowNestedSubagents")) {
		droppedFields.push({ field: "allowNestedSubagents", value: parsed.fields.get("allowNestedSubagents") ?? "", reason: "applied: mapped to the delegation capability." });
	}

	const hasWrite = [...kept].some((tool) => FILESYSTEM_WRITE_TOOLS.has(tool));
	const hasRead = [...kept].some((tool) => FILESYSTEM_READ_TOOLS.has(tool));
	const filesystem: PiSubagentMapping["capabilities"]["filesystem"] = hasWrite ? "workspace-write" : hasRead ? "read-only" : "none";
	const mode: PiSubagentMapping["mode"] = options.mode ?? (filesystem === "workspace-write" ? "worker" : "read-only");
	const worktree: PiSubagentMapping["worktree"] = mode === "read-only" ? "none" : "isolated";
	const deliverable: PiSubagentMapping["deliverable"] = options.deliverable ?? (mode === "read-only" ? "report" : "implementation");
	const tools = [
		...[...kept].sort(),
		...mcpTools,
		...(delegation ? DELEGATION_TOOLS : []),
	];

	// Model / thinking.
	let model: string | undefined;
	const rawModel = parsed.fields.get("model")?.trim();
	if (rawModel) {
		if (/^[A-Za-z0-9_.-]+\/\S+$/.test(rawModel)) model = rawModel;
		else droppedFields.push({ field: "model", value: rawModel, reason: "PipiUI needs a provider-qualified `provider/model`; the role's model comes from Subagent model settings instead." });
	}
	let thinking: string | undefined;
	const rawThinking = parsed.fields.get("thinking")?.trim();
	if (rawThinking && rawThinking !== "false") thinking = rawThinking;
	else if (rawThinking === "false") droppedFields.push({ field: "thinking", value: rawThinking, reason: "thinking is per-dispatch in PipiUI; `false` has no frontmatter form." });

	// Everything else.
	for (const [field, value] of parsed.fields) {
		if (MAPPED_FIELDS.has(field)) continue;
		if (field in DROPPED_FIELD_REASONS) {
			droppedFields.push({ field, value, reason: DROPPED_FIELD_REASONS[field] });
			continue;
		}
		droppedFields.push({ field, value, reason: "not a pi-subagents field this converter knows; check the upstream changelog." });
		diagnostics.push(diagnostic("warning", "unknown-upstream-field", `Upstream field \`${field}\` is unknown to the converter and was dropped.`));
	}

	const mapping: PiSubagentMapping = {
		name: requestedName,
		description,
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		mode,
		worktree,
		deliverable,
		capabilities: {
			filesystem,
			shell: [...kept].some((tool) => SHELL_TOOLS.has(tool)),
			web: [...kept].some((tool) => WEB_TOOLS.has(tool)),
			mcpTools,
			delegation,
		},
		tools,
	};
	const draft = renderPackageDraft({
		...mapping,
		capabilities: { ...mapping.capabilities, desktop: "none" },
		prompt: parsed.body,
	});
	return { ok: true, name: requestedName, draft, mapping, diagnostics, droppedFields, droppedTools, provenance };
}
