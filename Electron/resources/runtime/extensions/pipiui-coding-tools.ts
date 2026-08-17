import { createReadToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readPathIfDirectory, readToolDescription, rewriteReadToolText } from "./coding-tools.ts";

export default function (pi: ExtensionAPI) {
	const base = createReadToolDefinition(".");
	pi.registerTool({
		...base,
		description: readToolDescription(base.description),
		promptGuidelines: [
			...(base.promptGuidelines ?? []),
			"If a path is a directory, read lists it; prefer ls for directories and read for files.",
			"Do not page a file you already windowed. Use grep to locate a region; offset/limit only for a short window.",
		],
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctx?.cwd ?? process.cwd();
			const path = typeof params?.path === "string" ? params.path : "";
			const listing = path ? await readPathIfDirectory(path, cwd) : undefined;
			if (listing !== undefined) {
				return { content: [{ type: "text", text: listing }] };
			}
			const result = await createReadToolDefinition(cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			const content = Array.isArray(result?.content)
				? result.content.map((part: { type?: string; text?: string }) => (
					part?.type === "text" && typeof part.text === "string"
						? { ...part, text: rewriteReadToolText(part.text, params) }
						: part
				))
				: result?.content;
			return { ...result, content };
		},
	});
}
