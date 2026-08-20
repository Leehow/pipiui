/**
 * Codex / OpenAI strict function-calling requires every object to:
 *   - set additionalProperties: false
 *   - list every property key in required
 * Optional fields stay expressible only as nullable (type includes "null").
 *
 * `strict: "prefer"` turns into function.strict=true. A Type.Optional field
 * is therefore invalid until it is rewritten this way.
 */

type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function schemaTypes(schema: JsonSchema): string[] {
	if (Array.isArray(schema.type)) {
		return schema.type.filter((entry): entry is string => typeof entry === "string");
	}
	return typeof schema.type === "string" ? [schema.type] : [];
}

function isNullSchema(value: unknown): boolean {
	return isRecord(value) && schemaTypes(value).length === 1 && schemaTypes(value)[0] === "null";
}

function addNullToEnum(schema: JsonSchema): void {
	if (Array.isArray(schema.enum) && !schema.enum.includes(null)) {
		schema.enum = [...schema.enum, null];
	}
	if (schema.const !== undefined && schema.const !== null) {
		schema.enum = [schema.const, null];
		delete schema.const;
	}
}

/** Make a copy of a JSON Schema accept JSON null without using allOf. */
export function makeNullableJsonSchema(schema: unknown): unknown {
	if (!isRecord(schema)) {
		return { anyOf: [schema, { type: "null" }] };
	}
	const types = schemaTypes(schema);
	if (types.includes("null") || isNullSchema(schema)) {
		addNullToEnum(schema);
		return schema;
	}
	if (types.length > 0) {
		schema.type = [...types, "null"];
		addNullToEnum(schema);
		return schema;
	}
	if (Array.isArray(schema.anyOf)) {
		if (!schema.anyOf.some(isNullSchema)) schema.anyOf = [...schema.anyOf, { type: "null" }];
		return schema;
	}
	if (Array.isArray(schema.oneOf)) {
		if (!schema.oneOf.some(isNullSchema)) schema.oneOf = [...schema.oneOf, { type: "null" }];
		return schema;
	}
	return { anyOf: [schema, { type: "null" }] };
}

function normalizeNode(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizeNode);
	if (!isRecord(value)) return value;

	if (isRecord(value.properties)) {
		for (const [key, entry] of Object.entries(value.properties)) {
			value.properties[key] = normalizeNode(entry);
		}
	}
	if (value.items !== undefined) value.items = normalizeNode(value.items);
	if (Array.isArray(value.anyOf)) value.anyOf = value.anyOf.map(normalizeNode);
	if (Array.isArray(value.oneOf)) value.oneOf = value.oneOf.map(normalizeNode);
	if (Array.isArray(value.allOf)) value.allOf = value.allOf.map(normalizeNode);
	if (isRecord(value.additionalProperties)) {
		value.additionalProperties = normalizeNode(value.additionalProperties);
	}
	if (isRecord(value.$defs)) {
		for (const [key, entry] of Object.entries(value.$defs)) {
			value.$defs[key] = normalizeNode(entry);
		}
	}
	if (isRecord(value.definitions)) {
		for (const [key, entry] of Object.entries(value.definitions)) {
			value.definitions[key] = normalizeNode(entry);
		}
	}

	const types = schemaTypes(value);
	const isObject = types.includes("object") || (types.length === 0 && isRecord(value.properties));
	if (isObject && isRecord(value.properties)) {
		value.additionalProperties = false;
		const keys = Object.keys(value.properties);
		const required = new Set(Array.isArray(value.required) ? value.required.filter((key) => typeof key === "string") : []);
		for (const key of keys) {
			if (!required.has(key)) {
				value.properties[key] = makeNullableJsonSchema(value.properties[key]);
			}
		}
		value.required = keys;
	}
	return value;
}

/** Deep-clone a TypeBox / JSON Schema and make it Codex-strict. */
export function makeStrictJsonSchema<T>(schema: T): T {
	return normalizeNode(cloneJson(schema)) as T;
}

/** Drop JSON nulls so execute() can keep treating omitted optionals as undefined. */
export function omitNulls<T>(value: T): T {
	if (value === null) return undefined as T;
	if (Array.isArray(value)) return value.map((entry) => omitNulls(entry)) as T;
	if (!isRecord(value)) return value;
	const out: JsonSchema = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry === null) continue;
		out[key] = omitNulls(entry);
	}
	return out as T;
}

const NULL_SENTINELS = new Set(["", "null", "undefined", "none", "n/a", "na", "unused", "not used", "not-used"]);
const SINGLE_MODE_KEYS = ["agent", "task", "title", "prompt", "description", "subagent_type"] as const;

function isNullableSchema(schema: JsonSchema): boolean {
	if (schemaTypes(schema).includes("null")) return true;
	if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
	if (Array.isArray(schema.anyOf) && schema.anyOf.some(isNullSchema)) return true;
	if (Array.isArray(schema.oneOf) && schema.oneOf.some(isNullSchema)) return true;
	return false;
}

function isNullSentinel(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	return typeof value === "string" && NULL_SENTINELS.has(value.trim().toLowerCase());
}

function schemaEnum(schema: JsonSchema): unknown[] {
	return Array.isArray(schema.enum) ? schema.enum : [];
}

function unwrapQuotedScalar(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return value;
		}
	}
	return value;
}

function coerceScalar(schema: JsonSchema, value: unknown): unknown {
	if (isNullSentinel(value) && isNullableSchema(schema)) return null;
	if (typeof value === "string") {
		const unquoted = unwrapQuotedScalar(value);
		if (unquoted !== value) {
			if (schemaEnum(schema).includes(unquoted)) return unquoted;
			if (isNullSentinel(unquoted) && isNullableSchema(schema)) return null;
		}
		if (schemaEnum(schema).length > 0 && !schemaEnum(schema).includes(value) && isNullableSchema(schema)) {
			return null;
		}
	}
	return value;
}

function prepareNode(schema: unknown, value: unknown): unknown {
	if (!isRecord(schema)) return value;
	const types = schemaTypes(schema);
	if (types.includes("array") && schema.items !== undefined) {
		if (value === undefined || value === null) return isNullableSchema(schema) ? null : value;
		if (!Array.isArray(value)) return value;
		const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
		if (value.length < minItems && isNullableSchema(schema)) return null;
		return value.map((entry) => prepareNode(schema.items, entry));
	}
	const isObject = types.includes("object") || (types.length === 0 && isRecord(schema.properties));
	if (isObject && isRecord(schema.properties)) {
		const source = isRecord(value) ? value : {};
		const out: JsonSchema = {};
		for (const [key, property] of Object.entries(schema.properties)) {
			if (!isRecord(property)) continue;
			if (!(key in source) || source[key] === undefined) {
				if (isNullableSchema(property)) out[key] = null;
				continue;
			}
			out[key] = prepareNode(property, source[key]);
		}
		if (Array.isArray(out.chain) && out.chain.length > 0) {
			for (const key of SINGLE_MODE_KEYS) {
				if (key in out && isNullSentinel(source[key])) out[key] = null;
			}
		}
		return out;
	}
	return coerceScalar(schema, value);
}

/**
 * Compatibility shim for `prepareArguments`: models that ignore constrained
 * sampling omit nullable required keys or send sentinels (`action: "single"`,
 * `thinking: "null"`, `chain: []` on a minItems array). Fill / coerce those
 * before local schema validation.
 */
export function prepareStrictToolArguments(schema: unknown, args: unknown): unknown {
	return prepareNode(schema, args);
}

export function bindPrepareStrictToolArguments(schema: unknown): (args: unknown) => unknown {
	return (args) => prepareStrictToolArguments(schema, args);
}

/**
 * Pre-validation sanitizer for `prepareArguments` on strict
 * (`additionalProperties: false`) tools. pi validates arguments BEFORE
 * execute() runs, so null-valued fillers (`action: null`, `chain: null`) and
 * unknown keys must be dropped here — the validator error does not name the
 * offending property, so a model that hits it otherwise retries blindly in an
 * endless loop while the session looks stuck on "等待模型响应".
 *
 * `omitNulls` strips null-valued keys (declared or not); the prepare step then
 * drops any remaining unknown keys and coerces sentinel scalars.
 */
function hasNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

const KNOWN_AGENT_TYPES = new Set([
	"computer-terminal",
	"computer-use-leader",
	"computer-verifier",
	"explore",
	"general-purpose",
	"operator",
	"plan",
	"reviewer",
	"secretary",
]);
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,23}$/;
const TITLE_AS_TASK_MIN_LENGTH = 80;

function mapIsolationToWorktree(value: unknown): "isolated" | "none" | undefined {
	if (value === "worktree" || value === "isolated") return "isolated";
	if (value === "none") return "none";
	return undefined;
}

function mapWorktreeToIsolation(value: unknown): "worktree" | "none" | undefined {
	if (value === "worktree" || value === "isolated") return "worktree";
	if (value === "none") return "none";
	return undefined;
}

function slugAgentId(value: string): string | undefined {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 24)
		.replace(/-+$/g, "");
	return AGENT_ID_PATTERN.test(slug) ? slug : undefined;
}

function inferredAgentType(value: JsonSchema): "explore" | "general-purpose" {
	if (
		value.isolation != null && value.isolation !== ""
		|| value.worktree != null && value.worktree !== ""
		|| hasNonEmptyString(value.noWorktreeReason)
		|| hasNonEmptyString(value.verify)
		|| value.heartbeatSecs != null
		|| value.timeoutSecs != null
	) {
		return "general-purpose";
	}
	return "explore";
}

function expandShortBrief(label: string, agentType: unknown): string {
	const title = label.trim();
	if (title.length >= TITLE_AS_TASK_MIN_LENGTH) return title;
	const footer = agentType === "general-purpose"
		? "Complete the work implied by this title. Follow repository conventions. Do not expand scope."
		: "Read-only investigation implied by this title. Find the relevant code and report findings. Do not modify files.";
	return `${title}\n\n${footer}`;
}

function shortLabel(prompt: string): string {
	const firstLine = prompt.trim().split(/\n/, 1)[0] ?? "";
	const words = firstLine.split(/\s+/).filter(Boolean).slice(0, 5);
	const label = words.join(" ");
	return label.length > 0 ? label.slice(0, 80) : "subagent task";
}

function applyAliasesToRecord(value: JsonSchema): JsonSchema {
	const out: JsonSchema = { ...value };
	if (!hasNonEmptyString(out.prompt) && hasNonEmptyString(out.task)) out.prompt = out.task;
	if (!hasNonEmptyString(out.task) && hasNonEmptyString(out.prompt)) out.task = out.prompt;
	if (!hasNonEmptyString(out.description) && hasNonEmptyString(out.title)) out.description = out.title;
	if (!hasNonEmptyString(out.title) && hasNonEmptyString(out.description)) out.title = out.description;
	if (!hasNonEmptyString(out.subagent_type) && hasNonEmptyString(out.agent)) out.subagent_type = out.agent;
	if (!hasNonEmptyString(out.agent) && hasNonEmptyString(out.subagent_type)) out.agent = out.subagent_type;
	if ((out.isolation == null || out.isolation === "") && out.worktree != null && out.worktree !== "") {
		const mapped = mapWorktreeToIsolation(out.worktree);
		if (mapped) out.isolation = mapped;
	}
	if ((out.worktree == null || out.worktree === "") && out.isolation != null && out.isolation !== "") {
		const mapped = mapIsolationToWorktree(out.isolation);
		if (mapped) out.worktree = mapped;
	}
	if (out.run_in_background == null && typeof out.background === "boolean") out.run_in_background = out.background;
	if (out.background == null && typeof out.run_in_background === "boolean") out.background = out.run_in_background;
	if (!hasNonEmptyString(out.resume_from) && hasNonEmptyString(out.agentId)) out.resume_from = out.agentId;
	if (!hasNonEmptyString(out.agentId) && hasNonEmptyString(out.resume_from)) out.agentId = out.resume_from;

	if (!hasNonEmptyString(out.subagent_type) && !hasNonEmptyString(out.agent) && hasNonEmptyString(out.prompt)) {
		out.subagent_type = "general-purpose";
		out.agent = "general-purpose";
	}

	const typeName = hasNonEmptyString(out.subagent_type) ? out.subagent_type : out.agent;
	const typeForBrief = hasNonEmptyString(typeName) && KNOWN_AGENT_TYPES.has(typeName)
		? typeName
		: inferredAgentType(out);
	const label = hasNonEmptyString(out.description) ? out.description : hasNonEmptyString(out.title) ? out.title : "";
	if (!hasNonEmptyString(out.prompt) && !hasNonEmptyString(out.task) && label) {
		const brief = expandShortBrief(label, typeForBrief);
		out.prompt = brief;
		out.task = brief;
	}
	if (!hasNonEmptyString(out.description) && !hasNonEmptyString(out.title) && hasNonEmptyString(out.prompt)) {
		const generated = shortLabel(out.prompt);
		out.description = generated;
		out.title = generated;
	}

	if (
		(out.agent === "general-purpose" || out.subagent_type === "general-purpose")
		&& !hasNonEmptyString(out.agentId)
		&& hasNonEmptyString(out.description)
	) {
		const slug = slugAgentId(out.description);
		if (slug) {
			out.agentId = slug;
			if (!hasNonEmptyString(out.resume_from)) out.resume_from = slug;
		}
	}

	if (!hasNonEmptyString(out.agent) && hasNonEmptyString(out.subagent_type)) out.agent = out.subagent_type;
	if (!hasNonEmptyString(out.task) && hasNonEmptyString(out.prompt)) out.task = out.prompt;
	if (!hasNonEmptyString(out.title) && hasNonEmptyString(out.description)) out.title = out.description;
	return out;
}

function isChainWrapper(value: unknown): value is JsonSchema {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.chain) || value.chain.length === 0) return false;
	return !hasNonEmptyString(value.prompt) && !hasNonEmptyString(value.task);
}

function flattenChainItems(items: unknown[]): unknown[] {
	const out: unknown[] = [];
	for (const item of items) {
		if (isChainWrapper(item)) out.push(...flattenChainItems(item.chain));
		else out.push(item);
	}
	return out;
}

function firstWrapperBoolean(items: unknown[], key: "background" | "run_in_background"): boolean | undefined {
	for (const item of items) {
		if (!isChainWrapper(item)) continue;
		if (typeof item[key] === "boolean") return item[key];
		const nested = firstWrapperBoolean(item.chain, key);
		if (nested !== undefined) return nested;
	}
	return undefined;
}

/**
 * Models sometimes emit `subagent_chain({ chain: [{ background, chain: [steps] }] })`
 * instead of `subagent_chain({ chain: [steps], background })`. prepareNode then
 * drops the inner `chain` (unknown on ChainItem) and validation sees `[{}]`,
 * which triggers a long GLM retry on a huge session.
 */
function unwrapNestedChainRecord(value: JsonSchema): JsonSchema {
	if (!Array.isArray(value.chain) || value.chain.length === 0) return value;
	if (!value.chain.some(isChainWrapper)) return value;
	const out: JsonSchema = { ...value, chain: flattenChainItems(value.chain) };
	if (out.background == null) {
		const hoisted = firstWrapperBoolean(value.chain, "background");
		if (hoisted !== undefined) out.background = hoisted;
	}
	if (out.run_in_background == null) {
		const hoisted = firstWrapperBoolean(value.chain, "run_in_background");
		if (hoisted !== undefined) out.run_in_background = hoisted;
	}
	return out;
}

/**
 * Bidirectional Grok Build ↔ PipiUI dispatch names.
 * Public schema is {prompt, description, subagent_type, isolation, …};
 * execute() still reads {task, agent, title, worktree, background, agentId}.
 */
export function adoptGrokBuildDispatch<T>(value: T): T {
	if (!isRecord(value)) return value;
	const out = applyAliasesToRecord(unwrapNestedChainRecord(value));
	if (Array.isArray(out.tasks)) {
		out.tasks = out.tasks.map((item) => (isRecord(item) ? applyAliasesToRecord(item) : item));
	}
	if (Array.isArray(out.chain)) {
		out.chain = out.chain.map((item) => (isRecord(item) ? applyAliasesToRecord(item) : item));
	}
	return out as T;
}

function remapUnknownTypeName(value: JsonSchema, knownNames: ReadonlySet<string>): JsonSchema {
	const typeName = hasNonEmptyString(value.subagent_type) ? value.subagent_type : value.agent;
	if (!hasNonEmptyString(typeName) || knownNames.has(typeName) || KNOWN_AGENT_TYPES.has(typeName)) {
		return value;
	}
	if (!AGENT_ID_PATTERN.test(typeName)) return value;
	const out: JsonSchema = { ...value };
	if (!hasNonEmptyString(out.agentId)) out.agentId = typeName;
	if (!hasNonEmptyString(out.resume_from)) out.resume_from = typeName;
	const inferred = inferredAgentType(out);
	out.subagent_type = inferred;
	out.agent = inferred;
	return out;
}

/** After agent discovery: treat an unknown type that looks like an id as resume_from. */
export function remapUnknownSubagentType<T>(value: T, knownNames: ReadonlySet<string>): T {
	if (!isRecord(value)) return value;
	const out = remapUnknownTypeName(value, knownNames);
	if (Array.isArray(out.tasks)) {
		out.tasks = out.tasks.map((item) => (isRecord(item) ? remapUnknownTypeName(item, knownNames) : item));
	}
	if (Array.isArray(out.chain)) {
		out.chain = out.chain.map((item) => (isRecord(item) ? remapUnknownTypeName(item, knownNames) : item));
	}
	return out as T;
}

function dropEmptyChainItems(value: JsonSchema): JsonSchema {
	if (!Array.isArray(value.chain)) return value;
	const chain = value.chain.filter((item) => {
		if (!isRecord(item)) return false;
		return hasNonEmptyString(item.prompt) || hasNonEmptyString(item.task) || hasNonEmptyString(item.description);
	});
	if (chain.length === value.chain.length) return value;
	return { ...value, chain };
}

export function sanitizeStrictToolArguments(schema: unknown, args: unknown): unknown {
	const aliased = adoptGrokBuildDispatch(args);
	const stripped = omitNulls(aliased);
	if (typeof stripped !== "object" || stripped === null || Array.isArray(stripped)) return stripped;
	const prepared = prepareStrictToolArguments(schema, stripped);
	if (!isRecord(prepared)) return prepared;
	if (!isRecord(schema) || !isRecord(schema.properties) || !isRecord(schema.properties.chain)) return prepared;
	return dropEmptyChainItems(prepared);
}

export function bindSanitizeStrictToolArguments(schema: unknown): (args: unknown) => unknown {
	return (args) => sanitizeStrictToolArguments(schema, args);
}

function functionParameters(tool: JsonSchema): { container: JsonSchema; key: "parameters" } | undefined {
	if (tool.type === "function" && isRecord(tool.parameters)) {
		return { container: tool, key: "parameters" };
	}
	if (tool.type === "function" && isRecord(tool.function) && isRecord(tool.function.parameters)) {
		return { container: tool.function, key: "parameters" };
	}
	return undefined;
}

/** Rewrite every function tool's parameters in a provider payload. */
export function makeStrictFunctionTools(tools: unknown): unknown[] {
	const current = Array.isArray(tools) ? tools : [];
	return current.map((tool) => {
		if (!isRecord(tool)) return tool;
		const target = functionParameters(tool);
		if (!target) return tool;
		const next = { ...tool };
		if (target.container === tool) {
			next.parameters = makeStrictJsonSchema(target.container.parameters);
			return next;
		}
		next.function = {
			...tool.function,
			parameters: makeStrictJsonSchema(target.container.parameters),
		};
		return next;
	});
}
