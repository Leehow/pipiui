/**
 * First-wins collision fixture B: registers `shared_tool` after A.
 * Must not become the unique owner when both are mounted.
 */
export default function sharedToolExtensionB(pi: {
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
		label: "Shared Tool B",
		description: "Same name as extension A; later registration loses.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() {
			return { content: [{ type: "text", text: "shared_tool_b" }] };
		},
	});
}
