import * as fs from "node:fs";
import * as path from "node:path";

export interface SecretaryToolCall {
	toolName: string;
	input: unknown;
}

export interface SecretaryToolBlock {
	block: true;
	reason: string;
}

function block(reason: string): SecretaryToolBlock {
	return { block: true, reason: `Closeout secretary runtime policy: ${reason}` };
}

/**
 * Resolve a possibly-not-yet-created path through its nearest existing ancestor.
 * This catches symlinks inside `.pi/boss` that point outside the allowed root.
 */
function canonicalPotentialPath(candidate: string): string | null {
	let cursor = path.resolve(candidate);
	const missing: string[] = [];
	while (!fs.existsSync(cursor)) {
		const parent = path.dirname(cursor);
		if (parent === cursor) return null;
		missing.push(path.basename(cursor));
		cursor = parent;
	}
	try {
		return path.resolve(fs.realpathSync.native(cursor), ...missing.reverse());
	} catch {
		return null;
	}
}

function containsAmbiguousSegments(candidate: string): boolean {
	return candidate.split(path.sep).some((part) => part === "." || part === "..");
}

function writePathFromInput(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const record = input as Record<string, unknown>;
	const value = record.file_path ?? record.path;
	return typeof value === "string" && value.trim() ? value : null;
}

function commandFromInput(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const value = (input as Record<string, unknown>).command;
	return typeof value === "string" && value.trim() ? value : null;
}

export function secretaryWriteBlock(
	input: unknown,
	mainCwd: string | undefined,
): SecretaryToolBlock | undefined {
	if (!mainCwd || !path.isAbsolute(mainCwd)) {
		return block("PIPIUI_MAIN_CWD is missing or ambiguous; edit/write is denied.");
	}
	const requested = writePathFromInput(input);
	if (!requested || !path.isAbsolute(requested) || containsAmbiguousSegments(requested)) {
		return block("edit/write requires one unambiguous absolute file path.");
	}
	const canonicalMain = canonicalPotentialPath(mainCwd);
	if (!canonicalMain) {
		return block("the canonical main-session directory cannot be established.");
	}
	const allowedRoot = canonicalPotentialPath(path.join(canonicalMain, ".pi", "boss"));
	const canonicalTarget = canonicalPotentialPath(requested);
	if (!allowedRoot || !canonicalTarget) {
		return block("the canonical write target cannot be established.");
	}
	if (
		allowedRoot !== canonicalMain &&
		!allowedRoot.startsWith(`${canonicalMain}${path.sep}`)
	) {
		return block("the canonical .pi/boss root escapes PIPIUI_MAIN_CWD.");
	}
	if (
		canonicalTarget !== allowedRoot &&
		!canonicalTarget.startsWith(`${allowedRoot}${path.sep}`)
	) {
		return block("edit/write is allowed only under PIPIUI_MAIN_CWD/.pi/boss/.");
	}
	return undefined;
}

const DESTRUCTIVE_FILE_REMOVAL =
	/(?:^|[;&|])\s*(?:(?:sudo|command)\s+)?(?:rm|unlink|rmdir)\b|\bfind\b(?:(?![;&|\n]).)*\s-delete\b/i;

const READ_ONLY_GIT_COMMANDS = new Set([
	"cat-file",
	"diff",
	"diff-tree",
	"for-each-ref",
	"log",
	"ls-files",
	"ls-tree",
	"merge-base",
	"name-rev",
	"rev-parse",
	"show",
	"show-ref",
	"status",
]);

function shellTokens(command: string): string[] {
	const tokens: string[] = [];
	const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s;&|]+)/g;
	for (const match of command.matchAll(pattern)) {
		tokens.push(match[1] ?? match[2] ?? match[3]);
	}
	return tokens;
}

function gitInvocationBlock(command: string): SecretaryToolBlock | undefined {
	for (const match of command.matchAll(/\bgit\b/gi)) {
		const tail = command.slice((match.index ?? 0) + match[0].length).split(/[;&|\n]/, 1)[0];
		const tokens = shellTokens(tail);
		let cursor = 0;
		while (cursor < tokens.length && tokens[cursor].startsWith("-")) {
			const option = tokens[cursor];
			if (
				option === "-C" ||
				option === "-c" ||
				option === "--git-dir" ||
				option === "--work-tree" ||
				option === "--namespace"
			) {
				cursor += 2;
				continue;
			}
			if (
				option.startsWith("--git-dir=") ||
				option.startsWith("--work-tree=") ||
				option.startsWith("--namespace=") ||
				option === "--no-pager" ||
				option === "--paginate"
			) {
				cursor += 1;
				continue;
			}
			return block("unrecognized Git global option is denied during closeout.");
		}

		const subcommand = tokens[cursor]?.toLowerCase();
		const args = tokens.slice(cursor + 1);
		if (!subcommand) return block("an incomplete Git invocation is denied during closeout.");
		if (READ_ONLY_GIT_COMMANDS.has(subcommand)) continue;
		if (subcommand === "worktree" && args[0]?.toLowerCase() === "list") continue;
		if (subcommand === "branch") {
			if (args.length === 0) continue;
			if (
				args.length === 2 &&
				args[0] === "-d" &&
				/^pipiui\/agent-[A-Za-z0-9._/-]+$/.test(args[1])
			) {
				continue;
			}
			const readOnlyBranchOptions = new Set([
				"-a",
				"-r",
				"-v",
				"-vv",
				"--contains",
				"--format",
				"--list",
				"--merged",
				"--no-merged",
				"--no-contains",
				"--show-current",
				"--sort",
			]);
			if (
				readOnlyBranchOptions.has(args[0].split("=", 1)[0]) &&
				args.every((arg) => !arg.startsWith("-") || readOnlyBranchOptions.has(arg.split("=", 1)[0]))
			) {
				continue;
			}
		}
		return block(
			"raw Git mutation is denied; commits must use the dedicated secretary_commit tool.",
		);
	}
	return undefined;
}

export function secretaryBashBlock(input: unknown): SecretaryToolBlock | undefined {
	const command = commandFromInput(input);
	if (!command) return block("bash/shell requires a non-empty command.");
	const gitBlock = gitInvocationBlock(command);
	if (gitBlock) return gitBlock;
	if (DESTRUCTIVE_FILE_REMOVAL.test(command)) {
		return block("destructive filesystem removal is forbidden during closeout.");
	}
	return undefined;
}

/**
 * Defense-in-depth enforcement for the runtime-owned secretary process.
 * Prompt instructions are advisory; this hook is authoritative.
 */
export function secretaryToolCallBlock(
	processRole: string | undefined,
	event: SecretaryToolCall,
	mainCwd: string | undefined,
): SecretaryToolBlock | undefined {
	if (processRole !== "closeout-secretary") return undefined;
	if (event.toolName === "edit" || event.toolName === "write") {
		return secretaryWriteBlock(event.input, mainCwd);
	}
	if (event.toolName === "bash" || event.toolName === "shell") {
		return secretaryBashBlock(event.input);
	}
	return undefined;
}
