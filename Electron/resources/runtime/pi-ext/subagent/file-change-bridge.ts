/** Compact write/edit payloads for the PipiUI subagent log (counts, not file bodies). */

export type CompactFileChange = {
	path: string;
	payloadChars: number;
	addedChars: number;
	removedChars: number;
	addedLines?: number;
	removedLines?: number;
};

const LINE_DIFF_INPUT_LIMIT = 4000;

export function logicalLines(text: string): string[] {
	if (!text) return [];
	const lines = text.split("\n");
	if (text.endsWith("\n")) lines.pop();
	return lines;
}

function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function lcsLength(oldLines: string[], newLines: string[]): number {
	const n = oldLines.length;
	const m = newLines.length;
	let prev = new Array<number>(m + 1).fill(0);
	let curr = new Array<number>(m + 1).fill(0);
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			curr[j] =
				oldLines[i - 1] === newLines[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!);
		}
		const swap = prev;
		prev = curr;
		curr = swap;
		curr.fill(0);
	}
	return prev[m]!;
}

export function hunkLineCounts(oldText: string, newText: string): { added: number; removed: number } {
	const oldL = logicalLines(oldText);
	const newL = logicalLines(newText);
	if (arraysEqual(oldL, newL)) return { added: 0, removed: 0 };
	if (oldL.length + newL.length > LINE_DIFF_INPUT_LIMIT) {
		return { added: newL.length, removed: oldL.length };
	}
	const lcs = lcsLength(oldL, newL);
	return { added: newL.length - lcs, removed: oldL.length - lcs };
}

function editLineTotals(args: Record<string, unknown>): { added: number; removed: number } {
	const hunks: { oldText: string; newText: string }[] = [];
	if (Array.isArray(args.edits)) {
		for (const item of args.edits) {
			if (!item || typeof item !== "object") continue;
			const rec = item as Record<string, unknown>;
			if (typeof rec.oldText === "string" && typeof rec.newText === "string") {
				hunks.push({ oldText: rec.oldText, newText: rec.newText });
			}
		}
	}
	if (hunks.length === 0 && typeof args.oldText === "string" && typeof args.newText === "string") {
		hunks.push({ oldText: args.oldText, newText: args.newText });
	}
	let added = 0;
	let removed = 0;
	for (const hunk of hunks) {
		const counts = hunkLineCounts(hunk.oldText, hunk.newText);
		added += counts.added;
		removed += counts.removed;
	}
	return { added, removed };
}

function pathOf(args: Record<string, unknown>, raw = ""): string {
	const path = args.path ?? args.file_path;
	if (typeof path === "string" && path) return path;
	const scraped = scrapePath(raw);
	return scraped || "…";
}

function scrapePath(text: string): string {
	const match = text.match(/"(?:path|file_path)"\s*:\s*"((?:\\.|[^"\\])*)/);
	return match?.[1]?.replace(/\\(.)/g, "$1") ?? "";
}

function scrapeString(key: string, text: string): string {
	const needle = `"${key}"`;
	const start = text.indexOf(needle);
	if (start < 0) return "";
	let i = start + needle.length;
	while (i < text.length && /\s/.test(text[i]!)) i += 1;
	if (text[i] !== ":") return "";
	i += 1;
	while (i < text.length && /\s/.test(text[i]!)) i += 1;
	if (text[i] !== '"') return "";
	i += 1;
	let out = "";
	while (i < text.length) {
		const c = text[i]!;
		if (c === "\\") {
			const next = text[i + 1];
			if (next === undefined) break;
			out += next;
			i += 2;
			continue;
		}
		if (c === '"') break;
		out += c;
		i += 1;
	}
	return out;
}

function scrapeAll(key: string, text: string): string[] {
	const values: string[] = [];
	let rest = text;
	while (rest.length > 0) {
		const value = scrapeString(key, rest);
		if (!value && !rest.includes(`"${key}"`)) break;
		if (value) values.push(value);
		const at = rest.indexOf(`"${key}"`);
		if (at < 0) break;
		rest = rest.slice(at + key.length + 3);
	}
	return values;
}

function parseObject(raw: string): Record<string, unknown> | undefined {
	try {
		const value = JSON.parse(raw) as unknown;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
	} catch {
		// truncated
	}
	return undefined;
}

function sumField(edits: unknown, key: "oldText" | "newText"): number {
	if (!Array.isArray(edits)) return 0;
	return edits.reduce((sum, item) => {
		if (!item || typeof item !== "object") return sum;
		const text = (item as Record<string, unknown>)[key];
		return sum + (typeof text === "string" ? text.length : 0);
	}, 0);
}

export function compactFileChangeFromArgs(name: string, args: Record<string, unknown>): CompactFileChange | null {
	if (name !== "write" && name !== "edit") return null;
	if (name === "write") {
		const content = typeof args.content === "string" ? args.content : "";
		return {
			path: pathOf(args),
			payloadChars: content.length,
			addedChars: content.length,
			removedChars: 0,
			addedLines: logicalLines(content).length,
			removedLines: 0,
		};
	}
	const added = Array.isArray(args.edits)
		? sumField(args.edits, "newText")
		: typeof args.newText === "string"
			? args.newText.length
			: 0;
	const removed = Array.isArray(args.edits)
		? sumField(args.edits, "oldText")
		: typeof args.oldText === "string"
			? args.oldText.length
			: 0;
	const lines = editLineTotals(args);
	return {
		path: pathOf(args),
		payloadChars: added,
		addedChars: added,
		removedChars: removed,
		addedLines: lines.added,
		removedLines: lines.removed,
	};
}

export function compactFileChangeFromPartial(name: string, raw: string): CompactFileChange | null {
	if (name !== "write" && name !== "edit") return null;
	const parsed = parseObject(raw);
	if (parsed) return compactFileChangeFromArgs(name, parsed);
	if (name === "write") {
		const content = scrapeString("content", raw);
		return {
			path: pathOf({}, raw),
			payloadChars: content.length,
			addedChars: content.length,
			removedChars: 0,
			addedLines: logicalLines(content).length,
			removedLines: 0,
		};
	}
	const newParts = scrapeAll("newText", raw);
	const oldParts = scrapeAll("oldText", raw);
	const added = newParts.reduce((sum, part) => sum + part.length, 0);
	const removed = oldParts.reduce((sum, part) => sum + part.length, 0);
	const pairCount = Math.min(oldParts.length, newParts.length);
	let addedLines = 0;
	let removedLines = 0;
	for (let i = 0; i < pairCount; i++) {
		const counts = hunkLineCounts(oldParts[i]!, newParts[i]!);
		addedLines += counts.added;
		removedLines += counts.removed;
	}
	return {
		path: pathOf({}, raw),
		payloadChars: added,
		addedChars: added,
		removedChars: removed,
		addedLines,
		removedLines,
	};
}

export function stringifyCompactFileChange(stats: CompactFileChange, extra?: Record<string, unknown>): string {
	return JSON.stringify({
		path: stats.path,
		payloadChars: stats.payloadChars,
		addedChars: stats.addedChars,
		removedChars: stats.removedChars,
		addedLines: stats.addedLines ?? 0,
		removedLines: stats.removedLines ?? 0,
		...extra,
	});
}
