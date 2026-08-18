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
