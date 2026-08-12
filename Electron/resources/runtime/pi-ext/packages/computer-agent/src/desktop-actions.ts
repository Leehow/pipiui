const targetProperties = {
	x: { type: "number" }, y: { type: "number" },
	coordinate: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
	element_token: { type: "string", minLength: 1 }, element_index: { type: "integer", minimum: 0 },
	snapshot_id: { type: "string", minLength: 1 }, delivery_mode: { type: "string", minLength: 1 },
};
const closedAction = (types: string[], properties: Record<string, unknown>, required: string[] = []) => ({
	type: "object", additionalProperties: false,
	properties: { type: { enum: types }, ...targetProperties, ...properties },
	required: ["type", ...required],
});

const modelActionSchemas = [
		closedAction(["click", "left_click", "right_click", "middle_click", "double_click", "triple_click"], {}),
		closedAction(["type"], { text: { type: "string" } }, ["text"]),
		{ ...closedAction(["key", "keypress"], { key: { type: "string", minLength: 1 }, keys: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1 } } }), anyOf: [{ required: ["key"] }, { required: ["keys"] }] },
		closedAction(["scroll"], { direction: { enum: ["up", "down", "left", "right"] }, scroll_direction: { enum: ["up", "down", "left", "right"] }, amount: { type: "number" }, scroll_amount: { type: "number" } }),
		closedAction(["wait"], { duration: { type: "number", minimum: 0 }, duration_ms: { type: "number", minimum: 0 } }),
		closedAction(["screenshot"], {}),
];

/** Model-visible generic actions; file-list type-ahead has its own deep tool. */
export const desktopModelActionSchema = { oneOf: modelActionSchemas };

/** Host/broker action schema also admits the internal dedicated-tool envelope. */
export const desktopActionSchema = {
	oneOf: [
		...modelActionSchemas,
		closedAction(["typeahead"], { text: { type: "string", minLength: 1, maxLength: 255 } }, ["text"]),
	],
};

const allowedCommon = new Set(["type", "x", "y", "coordinate", "element_token", "element_index", "snapshot_id", "delivery_mode"]);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const nonempty = (value: unknown) => typeof value === "string" && value.length > 0;

export function validateDesktopActions(value: unknown): asserts value is Array<Record<string, unknown>> {
	if (!Array.isArray(value) || value.length < 1 || value.length > 64) throw new Error("mutate requires 1...64 actions");
	for (const action of value) {
		if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("desktop action must be an object");
		const item = action as Record<string, unknown>;
		const type = item.type;
		if (!nonempty(type) || !["click", "left_click", "right_click", "middle_click", "double_click", "triple_click", "type", "typeahead", "key", "keypress", "scroll", "wait", "screenshot"].includes(type)) throw new Error("unsupported desktop action type");
		const extra = new Set<string>();
		if (type === "type" || type === "typeahead") extra.add("text");
		if (type === "key" || type === "keypress") { extra.add("key"); extra.add("keys"); }
		if (type === "scroll") for (const key of ["direction", "scroll_direction", "amount", "scroll_amount"]) extra.add(key);
		if (type === "wait") { extra.add("duration"); extra.add("duration_ms"); }
		if (Object.keys(item).some((key) => !allowedCommon.has(key) && !extra.has(key))) throw new Error("desktop action contains unsupported fields");
		if ((item.x !== undefined && !finite(item.x)) || (item.y !== undefined && !finite(item.y))) throw new Error("desktop action coordinates must be finite numbers");
		if (item.coordinate !== undefined && (!Array.isArray(item.coordinate) || item.coordinate.length !== 2 || !item.coordinate.every(finite))) throw new Error("desktop action coordinate must contain two finite numbers");
		if (item.element_index !== undefined && (!Number.isInteger(item.element_index) || Number(item.element_index) < 0)) throw new Error("desktop action element_index must be a nonnegative integer");
		for (const key of ["element_token", "snapshot_id", "delivery_mode"]) if (item[key] !== undefined && !nonempty(item[key])) throw new Error(`desktop action ${key} must be a non-empty string`);
		if (type === "type" && typeof item.text !== "string") throw new Error("type action requires text");
		if (type === "typeahead") {
			if (typeof item.text !== "string" || item.text.length < 1 || item.text.length > 255 || !/^[A-Za-z0-9._ -]+$/.test(item.text) || item.text.includes("/") || item.text === "." || item.text === "..") throw new Error("typeahead requires one bounded basename");
		}
		if (type === "key" || type === "keypress") {
			const keys = Array.isArray(item.keys) ? item.keys : item.key !== undefined ? [item.key] : [];
			if (keys.length < 1 || keys.length > 8 || !keys.every(nonempty)) throw new Error("key action requires 1...8 non-empty keys");
		}
		for (const key of ["direction", "scroll_direction"]) if (item[key] !== undefined && !["up", "down", "left", "right"].includes(String(item[key]))) throw new Error("scroll direction is invalid");
		for (const key of ["amount", "scroll_amount", "duration", "duration_ms"]) if (item[key] !== undefined && (!finite(item[key]) || Number(item[key]) < 0)) throw new Error(`desktop action ${key} must be a nonnegative finite number`);
	}
}
