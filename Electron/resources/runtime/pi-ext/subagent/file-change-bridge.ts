/** Compact write/edit payloads for the PipiUI subagent log (counts, not file bodies). */

export type CompactFileChange = {
	path: string;
	payloadChars: number;
	addedChars: number;
	removedChars: number;
};

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
	return { path: pathOf(args), payloadChars: added, addedChars: added, removedChars: removed };
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
		};
	}
	const added = scrapeAll("newText", raw).reduce((sum, part) => sum + part.length, 0);
	const removed = scrapeAll("oldText", raw).reduce((sum, part) => sum + part.length, 0);
	return { path: pathOf({}, raw), payloadChars: added, addedChars: added, removedChars: removed };
}

export function stringifyCompactFileChange(stats: CompactFileChange, extra?: Record<string, unknown>): string {
	return JSON.stringify({
		path: stats.path,
		payloadChars: stats.payloadChars,
		addedChars: stats.addedChars,
		removedChars: stats.removedChars,
		...extra,
	});
}
