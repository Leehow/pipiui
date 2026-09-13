import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function workerCodingToolsArgs(
	extensionPath: string | undefined,
	options: { computerWorker?: boolean } = {},
): string[] {
	if (!extensionPath || options.computerWorker) return [];
	return ["-e", extensionPath];
}

function expandUserPath(rawPath: string): string {
	if (rawPath === "~") return homedir();
	if (rawPath.startsWith("~/")) return join(homedir(), rawPath.slice(2));
	return rawPath;
}

export function resolveReadTarget(rawPath: string, cwd: string): string {
	return resolve(cwd, expandUserPath(rawPath));
}

export async function readPathIfDirectory(rawPath: string, cwd: string): Promise<string | undefined> {
	if (!rawPath) return undefined;
	const absolutePath = resolveReadTarget(rawPath, cwd);
	let info;
	try {
		info = await stat(absolutePath);
	} catch {
		return undefined;
	}
	if (!info.isDirectory()) return undefined;

	let names: string[];
	try {
		names = await readdir(absolutePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `\`${rawPath}\` is a directory, but it could not be listed: ${message}`;
	}

	names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
	const entries: string[] = [];
	for (const name of names) {
		let suffix = "";
		try {
			if ((await stat(join(absolutePath, name))).isDirectory()) suffix = "/";
		} catch {
			continue;
		}
		entries.push(name + suffix);
	}

	const body = entries.length > 0 ? entries.join("\n") : "(empty directory)";
	return (
		`\`${rawPath}\` is a directory. Listed below. Use the \`ls\` tool to list directories; \`read\` is for files.\n\n` +
		body
	);
}

/** Pi's read tool treats every early stop as "keep paging". Grok Build does
 *  not: a requested window is complete, and a hard cap is a failure that
 *  points at grep — never "continue until complete". */
const READ_CONTINUE_FOOTER =
	/\n\n\[(?:\d+ more lines in file|Showing lines \d+-\d+ of \d+(?: \([^)]+\))?)\. Use offset=\d+ to continue\.\]\s*$/;

export function rewriteReadToolText(text: string, params: { offset?: number; limit?: number } = {}): string {
	const match = text.match(READ_CONTINUE_FOOTER);
	if (!match || match.index === undefined) return text;
	if (!match[0].includes("Showing lines")) return text.slice(0, match.index);
	if (params.limit != null || params.offset != null) {
		return (
			"The requested line range exceeds the read cap (2000 lines or 50KB).\n" +
			"Try a smaller limit, a different starting offset, or use the grep tool to search for specific content."
		);
	}
	return (
		"File content exceeds the read cap (2000 lines or 50KB).\n" +
		"Use offset and limit to read a shorter range, or use the grep tool to search for specific content."
	);
}

export function readToolDescription(base: string): string {
	const withoutContinue = base.replace(/\s*When you need the full file, continue with offset until complete\./, "").trimEnd();
	const withGrep = /grep/i.test(withoutContinue)
		? withoutContinue
		: `${withoutContinue} Do not page through a whole file; use grep to find a specific region.`;
	if (/directory/i.test(withGrep)) return withGrep;
	return `${withGrep} If path is a directory, lists its entries instead of failing. Prefer the ls tool for directories.`;
}

/** Diagnostic candidates only: relaxed comparison must never authorize a write. */
export function editMismatchHint(content: string, oldText: string): string | undefined {
	if (content.length > 2 * 1024 * 1024 || oldText.length > 16 * 1024) return undefined;
	const expected = oldText.replace(/\r\n?/g, "\n").split("\n");
	if (expected[0] === "") expected.shift();
	if (expected.at(-1) === "") expected.pop();
	if (!expected.length || expected.length > 60) return undefined;
	const lines = content.replace(/\r\n?/g, "\n").split("\n");
	const comparable = (line: string) => line.replace(/[\t '"\u2018\u2019\u201c\u201d]/g, "");
	const wanted = expected.map(comparable);
	if (!wanted.some(Boolean)) return undefined;
	let start: number | undefined;
	for (let i = 0; i <= lines.length - expected.length; i++) {
		if (!wanted.every((line, j) => comparable(lines[i + j]) === line)) continue;
		if (start !== undefined) return undefined; // Ambiguous: require an explicit read.
		start = i;
	}
	if (start === undefined) return undefined;
	const actual = lines.slice(start, start + expected.length);
	const differentLine = expected.findIndex((line, i) => line !== actual[i]);
	if (differentLine < 0) return undefined;
	let column = 0;
	const before = expected[differentLine], current = actual[differentLine];
	while (column < before.length && column < current.length && before[column] === current[column]) column++;
	const quote = (value: string | undefined) => value === undefined ? "end of line" : JSON.stringify(value);
	const difference = `First difference at file line ${start + differentLine + 1}, column ${column + 1}: ` +
		`oldText has ${quote(before[column])}; the file has ${quote(current[column])}.`;
	const block = actual.join("\n") + (oldText.endsWith("\n") ? "\n" : "");
	const encoded = JSON.stringify(block);
	return [
		`A unique candidate at lines ${start + 1}-${start + actual.length} differs in quote characters or whitespace. It was NOT applied.`,
		difference,
		encoded.length <= 4000
			? `Current block as a JSON string (decode once; preserve its exact characters in oldText):\n${encoded}`
			: `Read that line range to obtain the complete current block before rebuilding the edit.`,
	].join("\n");
}

/* ------------------------------------------------------------------ */
/* Composite search helpers: let one grep/read/ls call absorb the      */
/* `cd X && grep/ls/cat` chains models otherwise assemble in bash.     */
/* ------------------------------------------------------------------ */

export interface GrepLine {
	kind: "match" | "before" | "after";
	path: string;
	lineNumber: number;
	raw: string;
}

const MATCH_LINE = /^(.+):(\d+):(.*)$/;
const CONTEXT_LINE = /^(.+)-(\d+)-(.*)$/;

/** Split a base grep tool output into structured lines, dropping notices.
 *  Context lines before a match become `before` once the match follows. */
export function parseGrepOutput(text: string): GrepLine[] {
	const trimmed = text.trim();
	if (!trimmed || trimmed === "No matches found") return [];
	// Notices are appended as a trailing "\n\n[...]" block.
	const body = trimmed.replace(/\n\n\[[^\]]*\]$/, "");
	const lines: GrepLine[] = [];
	let pendingBefore: GrepLine[] = [];
	let lastMatch: GrepLine | undefined;
	for (const raw of body.split("\n")) {
		const match = raw.match(MATCH_LINE);
		if (match) {
			lines.push(...pendingBefore);
			pendingBefore = [];
			lastMatch = { kind: "match", path: match[1], lineNumber: Number(match[2]), raw };
			lines.push(lastMatch);
			continue;
		}
		const context = raw.match(CONTEXT_LINE);
		if (context) {
			const line: GrepLine = { kind: "after", path: context[1], lineNumber: Number(context[2]), raw };
			if (lastMatch && line.lineNumber > lastMatch.lineNumber) {
				lines.push(line);
			} else {
				line.kind = "before";
				pendingBefore.push(line);
			}
			continue;
		}
		if (raw.trim()) lines.push({ kind: "match", path: "", lineNumber: 0, raw });
	}
	lines.push(...pendingBefore);
	return lines;
}

export function globToRegExp(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				re += ".*";
				i++;
				if (glob[i + 1] === "/") i++;
			} else {
				re += "[^/]*";
			}
		} else if (ch === "?") re += "[^/]";
		else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}$`);
}

/** Does a search-relative path hit any exclude glob (as path or ancestor dir)?
 *  Slash-free globs also match any single path segment, so `*.jsonl` reaches
 *  nested files and `node_modules` reaches nested directories. */
export function pathMatchesExcludes(relPath: string, excludes: string[]): boolean {
	if (excludes.length === 0) return false;
	const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
	const parts = normalized.split("/");
	const candidates: string[] = [normalized];
	for (let i = 1; i < parts.length; i++) candidates.push(parts.slice(0, i).join("/"));
	for (const glob of excludes) {
		const re = globToRegExp(glob);
		if (candidates.some((c) => re.test(c))) return true;
		if (!glob.includes("/") && parts.some((segment) => re.test(segment))) return true;
	}
	return false;
}

/** Group parsed grep lines into keep/drop decisions per match, preserving
 *  context lines of kept matches. Returns renderable output lines. */
export function filterGrepLines(lines: GrepLine[], excludes: string[]): string[] {
	if (excludes.length === 0) return lines.map((l) => l.raw);
	const out: string[] = [];
	let pendingBefore: string[] = [];
	let keepAfter = false;
	for (const line of lines) {
		if (line.kind === "match") {
			const keep = !pathMatchesExcludes(line.path, excludes);
			if (keep) {
				out.push(...pendingBefore, line.raw);
				keepAfter = true;
			} else {
				keepAfter = false;
			}
			pendingBefore = [];
		} else if (line.kind === "before") {
			pendingBefore.push(line.raw);
		} else if (keepAfter) {
			out.push(line.raw);
		}
	}
	return out;
}

/** Summarize parsed matches as `grep -c` style per-file counts. */
export function grepCountSummary(lines: GrepLine[]): string {
	const counts = new Map<string, number>();
	for (const line of lines) {
		if (line.kind !== "match" || !line.path) continue;
		counts.set(line.path, (counts.get(line.path) ?? 0) + 1);
	}
	if (counts.size === 0) return "No matches found";
	const body = [...counts.entries()].map(([path, n]) => `${path}: ${n}`).join("\n");
	const total = [...counts.values()].reduce((a, b) => a + b, 0);
	return `${body}\n\ntotal: ${total} matches in ${counts.size} files`;
}

/** Summarize parsed matches as `grep -l` style file list. */
export function grepFilesSummary(lines: GrepLine[]): string {
	const files = new Set<string>();
	for (const line of lines) {
		if (line.kind === "match" && line.path) files.add(line.path);
	}
	if (files.size === 0) return "No matches found";
	return `${[...files].join("\n")}\n\n${files.size} files`;
}

const COMPOSITE_MAX_BYTES = 64 * 1024;

export function capCompositeOutput(text: string): string {
	if (text.length <= COMPOSITE_MAX_BYTES) return text;
	return `${text.slice(0, COMPOSITE_MAX_BYTES)}\n\n[Composite output truncated to ${COMPOSITE_MAX_BYTES / 1024}KB. Narrow paths, add exclude, or lower limit.]`;
}
