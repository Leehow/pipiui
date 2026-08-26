/**
 * First-wins collision fixture A: registers `shared_tool`.
 * Loaded before B so Pi's unique winner is this extension.
 */
export default function sharedToolExtensionA(pi: {
	registerTool: (tool: {
		name: string;
		label?: string;
		description?: string;
		parameters?: unknown;
		execute?: (...args: never[]) => unknown;
	}) => void;
}): void {
	pi.registerTool({
		name: "shared_tool",
		label: "Shared Tool A",
		description: "Same name as extension B; first registration wins.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() {
			return { content: [{ type: "text", text: "shared_tool_a" }] };
		},
	});
}
