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
