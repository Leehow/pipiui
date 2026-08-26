/**
 * Minimal agent-half fixture: registers `owned_tool` through Pi's registerTool seam.
 * Used to prove addTools ownership comes from real registration, not snapshot self-report.
 */
export default function ownedToolExtension(pi: {
	registerTool: (tool: {
		name: string;
		label?: string;
		description?: string;
		parameters?: unknown;
		execute?: (...args: never[]) => unknown;
	}) => void;
}): void {
	pi.registerTool({
		name: "owned_tool",
		label: "Owned Tool",
		description: "Fixture tool owned by the extension that registered it.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() {
			return { content: [{ type: "text", text: "owned_tool" }] };
		},
	});
}
