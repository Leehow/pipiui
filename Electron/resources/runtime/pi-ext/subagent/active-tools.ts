/**
 * In-flight tool set for host activity projection.
 * Prefers toolCallId; missing ids use a conservative one-at-a-time fallback.
 * Summaries are allowlisted metadata only — never prompt, secrets, file body, or stdio.
 */

export type ActiveTool = {
	toolCallId?: string;
	name: string;
	startedAt: number;
	summary: string;
};

const MAX_SUMMARY = 160;
const MAX_COMMAND = 120;
const MAX_PATH = 80;

function cleanBounded(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
	if (!trimmed) return undefined;
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function boundActivitySummary(name: string, extra = ""): string {
	const text = extra ? `${name} ${extra}` : name;
	return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text;
}

/** Allowlisted, length-capped extras only. Unknown / sensitive tools return undefined. */
export function summarizeActiveToolArgs(
	toolName: string,
	args: Record<string, unknown> | undefined,
): string | undefined {
	if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
	switch (toolName) {
		case "edit":
		case "write":
		case "read":
		case "ls":
			return cleanBounded(args.file_path ?? args.path, MAX_PATH);
		case "bash":
		case "shell":
			return cleanBounded(args.command, MAX_COMMAND);
		case "skill_load":
			return cleanBounded(args.name, MAX_PATH);
		case "skill_search":
			return cleanBounded(args.query, MAX_COMMAND);
		default:
			return undefined;
	}
}

/** Resolve the in-flight tool for a streaming contentIndex. Never falls back to latest. */
export function activeToolForContentIndex(
	tools: ActiveTool[],
	idsByIndex: ReadonlyMap<number, string>,
	contentIndex: number,
	name: string,
): ActiveTool | undefined {
	const id = idsByIndex.get(contentIndex);
	if (id) return tools.find((item) => item.toolCallId === id);
	return tools.find((item) => !item.toolCallId && item.name === name);
}

export function upsertActiveTool(tools: ActiveTool[], tool: ActiveTool): ActiveTool[] {
	if (tool.toolCallId) {
		const byId = tools.findIndex((item) => item.toolCallId === tool.toolCallId);
		if (byId >= 0) {
			const next = tools.slice();
			next[byId] = { ...tools[byId], ...tool, startedAt: tools[byId].startedAt };
			return next;
		}
		const placeholder = tools.findIndex((item) => !item.toolCallId && item.name === tool.name);
		if (placeholder >= 0) {
			const next = tools.slice();
			next[placeholder] = { ...tools[placeholder], ...tool, startedAt: tools[placeholder].startedAt };
			return next;
		}
	}
	return [...tools, tool];
}

export function removeActiveTool(
	tools: ActiveTool[],
	ref: { toolCallId?: string; name?: string },
): ActiveTool[] {
	if (ref.toolCallId) {
		const next = tools.filter((item) => item.toolCallId !== ref.toolCallId);
		return next.length === tools.length ? tools : next;
	}
	if (ref.name) {
		const named = tools
			.map((item, index) => ({ item, index }))
			.filter((entry) => entry.item.name === ref.name && !entry.item.toolCallId);
		if (named.length === 1) return tools.filter((_, index) => index !== named[0].index);
		if (named.length > 1) {
			const latest = named.reduce((a, b) => (a.item.startedAt >= b.item.startedAt ? a : b));
			return tools.filter((_, index) => index !== latest.index);
		}
		return tools;
	}
	const anonymous = tools
		.map((item, index) => ({ item, index }))
		.filter((entry) => !entry.item.toolCallId);
	if (anonymous.length === 0) return tools;
	const latest = anonymous.reduce((a, b) => (a.item.startedAt >= b.item.startedAt ? a : b));
	return tools.filter((_, index) => index !== latest.index);
}

export function latestActiveTool(tools: ActiveTool[]): ActiveTool | undefined {
	if (tools.length === 0) return undefined;
	return tools.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
}
