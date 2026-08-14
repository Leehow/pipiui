import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { makeStrictJsonSchema, omitNulls } from "./strict-json-schema.ts";

/** Default number of active-lineage matches returned to the model. */
export const SESSION_RECALL_DEFAULT_LIMIT = 6;
/** Small hard cap: recall is a bounded pointer back into raw session history. */
export const SESSION_RECALL_MAX_LIMIT = 12;
/** Total text returned by one session_recall invocation. */
export const SESSION_RECALL_MAX_RESULT_CHARS = 6_000;
/** Per-entry excerpt cap inside the total response budget. */
export const SESSION_RECALL_MAX_SNIPPET_CHARS = 700;

interface SessionEntryLike {
	id?: unknown;
	parentId?: unknown;
	type?: unknown;
	message?: unknown;
	content?: unknown;
	summary?: unknown;
	fromId?: unknown;
	customType?: unknown;
	toolName?: unknown;
	provider?: unknown;
	modelId?: unknown;
	thinkingLevel?: unknown;
	label?: unknown;
	[key: string]: unknown;
}

interface SessionManagerLike {
	getSessionFile?: () => unknown;
	getLeafId?: () => unknown;
	getBranch?: () => unknown;
}

interface ParsedSession {
	entries: SessionEntryLike[];
	malformedLines: number;
	readError?: unknown;
	empty: boolean;
}

interface ActiveLineage {
	ids: Set<string>;
	source: "session-manager" | "leaf" | "latest-entry" | "unavailable";
}

interface RecallableEntry {
	id: string;
	type: string;
	snippet: string;
	searchText: string;
}

export interface SessionRecallInput {
	query: unknown;
	limit?: unknown;
	sessionFile?: unknown;
	sessionManager?: SessionManagerLike | null;
}

export interface SessionRecallOutput {
	text: string;
	details: {
		status: "ok" | "no-session" | "unavailable" | "empty" | "no-lineage" | "no-match";
		matches: number;
		returned: number;
		malformedLines: number;
		lineageSource?: ActiveLineage["source"];
	};
}

const SessionRecallParams = Type.Object({
	query: Type.String({
		description:
			"Text to find in the raw transcript of this session's active lineage (for example an agentId, verification result, plan, worktree, file, or user correction).",
		minLength: 1,
	}),
	limit: Type.Optional(
		Type.Integer({
			description: `Maximum matching entries to return (default ${SESSION_RECALL_DEFAULT_LIMIT}, max ${SESSION_RECALL_MAX_LIMIT}).`,
			minimum: 1,
			maximum: SESSION_RECALL_MAX_LIMIT,
		}),
	),
}, { additionalProperties: false });

function asRecord(value: unknown): SessionEntryLike | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as SessionEntryLike)
		: undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clipText(value: unknown, maxChars: number): string {
	const text = typeof value === "string" ? value.replace(/\u0000/g, "").trim() : "";
	if (!text || maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	if (maxChars === 1) return "…";
	const head = text.slice(0, maxChars - 1).trimEnd();
	return `${head || text.slice(0, maxChars - 1)}…`;
}

function oneLine(value: unknown, maxChars: number): string {
	return clipText(typeof value === "string" ? value.replace(/\s+/g, " ") : "", maxChars);
}

function boundedJson(value: unknown, maxChars: number = 12_000): string {
	try {
		return clipText(
			JSON.stringify(value, (_key, nested) => {
				if (typeof nested === "string") return clipText(nested, 1_000);
				if (Array.isArray(nested) && nested.length > 24) {
					return [...nested.slice(0, 24), `[${nested.length - 24} more items]`];
				}
				return nested;
			}),
			maxChars,
		);
	} catch {
		return "";
	}
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		const block = asRecord(part);
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		} else if (block.type === "thinking" && typeof block.thinking === "string") {
			parts.push(block.thinking);
		} else if (block.type === "toolCall") {
			const name = asNonEmptyString(block.name) ?? "tool";
			const args = boundedJson(block.arguments, 500);
			parts.push(args ? `${name}(${args})` : name);
		}
	}
	return parts.join("\n");
}

function parseSessionFile(sessionFile: string): ParsedSession {
	let raw: string;
	try {
		raw = fs.readFileSync(sessionFile, "utf8");
	} catch (error) {
		return { entries: [], malformedLines: 0, readError: error, empty: false };
	}
	if (!raw.trim()) return { entries: [], malformedLines: 0, empty: true };
	const entries: SessionEntryLike[] = [];
	let malformedLines = 0;
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const entry = asRecord(JSON.parse(trimmed));
			if (entry) entries.push(entry);
			else malformedLines++;
		} catch {
			malformedLines++;
		}
	}
	return { entries, malformedLines, empty: entries.length === 0 };
}

function idsFromBranch(value: unknown, knownIds: Set<string>): Set<string> {
	if (!Array.isArray(value)) return new Set();
	const ids = new Set<string>();
	for (const item of value) {
		const id = typeof item === "string" ? item : asNonEmptyString(asRecord(item)?.id);
		if (id && knownIds.has(id)) ids.add(id);
	}
	return ids;
}

function activeLineage(entries: SessionEntryLike[], manager?: SessionManagerLike | null): ActiveLineage {
	const byId = new Map<string, SessionEntryLike>();
	for (const entry of entries) {
		const id = asNonEmptyString(entry.id);
		if (id) byId.set(id, entry);
	}
	const knownIds = new Set(byId.keys());
	try {
		const branchIds = idsFromBranch(manager?.getBranch?.(), knownIds);
		if (branchIds.size > 0) return { ids: branchIds, source: "session-manager" };
	} catch {
		// Fall back to the current leaf below. A recall tool must never throw on an adapter mismatch.
	}

	let leafId: string | undefined;
	try {
		leafId = asNonEmptyString(manager?.getLeafId?.());
	} catch {
		leafId = undefined;
	}
	let source: ActiveLineage["source"] = "leaf";
	if (!leafId || !byId.has(leafId)) {
		const newest = [...entries]
			.reverse()
			.find((entry) => entry.type !== "session" && asNonEmptyString(entry.id));
		leafId = asNonEmptyString(newest?.id);
		source = "latest-entry";
	}
	if (!leafId || !byId.has(leafId)) return { ids: new Set(), source: "unavailable" };

	const ids = new Set<string>();
	let cursor: string | undefined = leafId;
	while (cursor && !ids.has(cursor)) {
		const entry = byId.get(cursor);
		if (!entry) break;
		ids.add(cursor);
		cursor = asNonEmptyString(entry.parentId);
	}
	return { ids, source };
}

function summarizeEntry(entry: SessionEntryLike): RecallableEntry | undefined {
	const id = asNonEmptyString(entry.id);
	const type = asNonEmptyString(entry.type);
	if (!id || !type || type === "session") return undefined;
	let kind = type;
	let snippet = "";
	if (type === "message") {
		const message = asRecord(entry.message);
		const role = asNonEmptyString(message?.role) ?? "unknown";
		kind = `message:${role}`;
		const toolName = asNonEmptyString(message?.toolName);
		const text = contentText(message?.content);
		snippet = `${role}${toolName ? ` (${toolName})` : ""}: ${oneLine(text, SESSION_RECALL_MAX_SNIPPET_CHARS) || "(no text content)"}`;
	} else if (type === "compaction") {
		snippet = `compaction: ${oneLine(entry.summary, SESSION_RECALL_MAX_SNIPPET_CHARS) || "(no summary text)"}`;
	} else if (type === "branch_summary") {
		snippet = `branch summary from ${asNonEmptyString(entry.fromId) ?? "unknown"}: ${oneLine(entry.summary, SESSION_RECALL_MAX_SNIPPET_CHARS) || "(no summary text)"}`;
	} else if (type === "custom_message") {
		const customType = asNonEmptyString(entry.customType);
		snippet = `${customType ? `${customType}: ` : ""}${oneLine(contentText(entry.content), SESSION_RECALL_MAX_SNIPPET_CHARS) || "(no text content)"}`;
	} else if (type === "model_change") {
		snippet = `model: ${asNonEmptyString(entry.provider) ?? "unknown"}/${asNonEmptyString(entry.modelId) ?? "unknown"}`;
	} else if (type === "thinking_level_change") {
		snippet = `thinking level: ${asNonEmptyString(entry.thinkingLevel) ?? "unknown"}`;
	} else if (type === "label") {
		snippet = `label: ${asNonEmptyString(entry.label) ?? "(cleared)"}`;
	} else {
		snippet = oneLine(boundedJson(entry, SESSION_RECALL_MAX_SNIPPET_CHARS), SESSION_RECALL_MAX_SNIPPET_CHARS) || "(no printable fields)";
	}
	return {
		id,
		type: kind,
		snippet,
		searchText: `${id}\n${kind}\n${snippet}\n${boundedJson(entry)}`.toLowerCase(),
	};
}

function normalizeQuery(value: unknown): string {
	return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function matchesQuery(entry: RecallableEntry, query: string): boolean {
	if (entry.searchText.includes(query)) return true;
	const terms = query.split(" ").filter((term) => term.length >= 2);
	return terms.length > 1 && terms.every((term) => entry.searchText.includes(term));
}

function boundedLimit(value: unknown): number {
	const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : SESSION_RECALL_DEFAULT_LIMIT;
	return Math.max(1, Math.min(SESSION_RECALL_MAX_LIMIT, numeric));
}

function noMatchText(query: string, malformedLines: number): string {
	const note = malformedLines > 0 ? ` Skipped ${malformedLines} malformed JSONL line(s).` : "";
	return `Session recall: no active-lineage entries matched "${clipText(query, 300)}".${note}`;
}

/**
 * Search raw JSONL only on the session manager's current root→leaf path. This
 * intentionally does not offer all-branches search, scoring, or drill-down:
 * it is a small, deterministic escape hatch for facts compacted out of context.
 */
export function recallActiveSession(input: SessionRecallInput): SessionRecallOutput {
	const query = normalizeQuery(input.query);
	if (!query) {
		return {
			text: "Session recall: provide a non-empty query.",
			details: { status: "no-match", matches: 0, returned: 0, malformedLines: 0 },
		};
	}
	const sessionFile = asNonEmptyString(input.sessionFile);
	if (!sessionFile) {
		return {
			text: "Session recall is unavailable: this session has no persisted JSONL file.",
			details: { status: "no-session", matches: 0, returned: 0, malformedLines: 0 },
		};
	}

	const parsed = parseSessionFile(sessionFile);
	if (parsed.readError) {
		const code = (parsed.readError as NodeJS.ErrnoException).code;
		const reason = code === "ENOENT" ? "the session file no longer exists (ENOENT)" : `the session file could not be read${code ? ` (${code})` : ""}`;
		return {
			text: `Session recall is unavailable: ${reason}.`,
			details: { status: "unavailable", matches: 0, returned: 0, malformedLines: 0 },
		};
	}
	if (parsed.empty) {
		const malformed = parsed.malformedLines;
		return {
			text:
				malformed > 0
					? `Session recall: the current session has no readable entries (${malformed} malformed JSONL line(s) skipped).`
					: "Session recall: the current session has no entries yet.",
			details: { status: "empty", matches: 0, returned: 0, malformedLines: malformed },
		};
	}

	const lineage = activeLineage(parsed.entries, input.sessionManager);
	if (lineage.ids.size === 0) {
		return {
			text: "Session recall is unavailable: the active session lineage could not be determined.",
			details: {
				status: "no-lineage",
				matches: 0,
				returned: 0,
				malformedLines: parsed.malformedLines,
				lineageSource: lineage.source,
			},
		};
	}
	const activeEntries = parsed.entries
		.filter((entry) => {
			const id = asNonEmptyString(entry.id);
			return !!id && lineage.ids.has(id);
		})
		.map(summarizeEntry)
		.filter((entry): entry is RecallableEntry => !!entry);
	if (activeEntries.length === 0) {
		return {
			text: "Session recall: the active lineage has no readable entries.",
			details: {
				status: "empty",
				matches: 0,
				returned: 0,
				malformedLines: parsed.malformedLines,
				lineageSource: lineage.source,
			},
		};
	}

	const matches = activeEntries.filter((entry) => matchesQuery(entry, query));
	if (matches.length === 0) {
		return {
			text: noMatchText(query, parsed.malformedLines),
			details: {
				status: "no-match",
				matches: 0,
				returned: 0,
				malformedLines: parsed.malformedLines,
				lineageSource: lineage.source,
			},
		};
	}

	const selected = matches.slice(-boundedLimit(input.limit));
	let text = `Session recall (active lineage; ${matches.length} match${matches.length === 1 ? "" : "es"}; showing ${selected.length}):`;
	let returned = 0;
	for (const entry of selected) {
		const prefix = `- [${entry.id} ${entry.type}] `;
		const available = SESSION_RECALL_MAX_RESULT_CHARS - text.length - 1 - prefix.length;
		if (available < 2) break;
		const snippet = clipText(entry.snippet, Math.min(SESSION_RECALL_MAX_SNIPPET_CHARS, available));
		if (!snippet) continue;
		text += `\n${prefix}${snippet}`;
		returned++;
	}
	if (parsed.malformedLines > 0) {
		const note = `\n\nNote: skipped ${parsed.malformedLines} malformed JSONL line(s).`;
		if (text.length + note.length <= SESSION_RECALL_MAX_RESULT_CHARS) text += note;
	}
	return {
		text,
		details: {
			status: "ok",
			matches: matches.length,
			returned,
			malformedLines: parsed.malformedLines,
			lineageSource: lineage.source,
		},
	};
}

function sessionFileFromContext(ctx: unknown): string | undefined {
	const manager = asRecord(ctx)?.sessionManager as SessionManagerLike | undefined;
	try {
		const sessionFile = asNonEmptyString(manager?.getSessionFile?.());
		if (sessionFile) return sessionFile;
	} catch {
		// PI_SESSION_FILE below is a useful compatibility fallback for minimal hosts.
	}
	return asNonEmptyString(process.env.PI_SESSION_FILE);
}

function sessionManagerFromContext(ctx: unknown): SessionManagerLike | undefined {
	const manager = asRecord(ctx)?.sessionManager;
	return typeof manager === "object" && manager !== null ? (manager as SessionManagerLike) : undefined;
}

/** Register the read-only, current-session raw-history recall tool. */
export function registerSessionRecallTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "session_recall",
		label: "Session Recall",
		description: [
			"Read-only recall from the raw JSONL transcript of the current Pi session.",
			"Searches only the current active lineage, including history compacted out of live context; it never searches other branches.",
			"Use a focused query such as an agentId, verification result, plan, worktree, file, or user correction. Results are bounded entry snippets, not a full transcript.",
		].join(" "),
		// Without a snippet this tool is absent from Pi's rendered tool list, and the one
		// caller who most needs it — a Boss whose context was just compacted — is the least
		// likely to go looking for a tool nobody mentioned.
		promptSnippet: "Recall this session's own earlier history, including what compaction dropped",
		parameters: makeStrictJsonSchema(SessionRecallParams),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			params = omitNulls(params);
			const result = recallActiveSession({
				query: params.query,
				limit: params.limit,
				sessionFile: sessionFileFromContext(ctx),
				sessionManager: sessionManagerFromContext(ctx),
			});
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},
	});
}
