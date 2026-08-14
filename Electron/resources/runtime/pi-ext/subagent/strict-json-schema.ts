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
const SINGLE_MODE_KEYS = ["agent", "task", "title"] as const;

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
export function sanitizeStrictToolArguments(schema: unknown, args: unknown): unknown {
	const stripped = omitNulls(args);
	if (typeof stripped !== "object" || stripped === null || Array.isArray(stripped)) return stripped;
	return prepareStrictToolArguments(schema, stripped);
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
