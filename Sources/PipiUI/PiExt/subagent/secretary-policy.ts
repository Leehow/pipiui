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

const FORBIDDEN_GIT_MUTATION =
	/\bgit\b(?:\s+(?:(?:-C|--git-dir|--work-tree|-c)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)))*\s+(?:clean|reset|restore|checkout|stash|merge|cherry-pick|rebase|push)\b/i;
// Keep short `-D` case-sensitive so the explicitly permitted non-force `-d`
// does not become equivalent under an `/i` regular expression.
const FORCED_SHORT_BRANCH_DELETE =
	/\bgit\b(?:\s+(?:(?:-C|--git-dir|--work-tree|-c)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)))*\s+branch\b(?:(?![;&|\n]).)*\s-D\b/;
const FORCED_LONG_BRANCH_DELETE =
	/\bgit\b(?:\s+(?:(?:-C|--git-dir|--work-tree|-c)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)))*\s+branch\b(?:(?![;&|\n]).)*(?:--delete\s+--force\b|--force\s+--delete\b|\s-d\s+-f\b|\s-f\s+-d\b)/i;
const DESTRUCTIVE_FILE_REMOVAL =
	/(?:^|[;&|])\s*(?:(?:sudo|command)\s+)?(?:rm|unlink|rmdir)\b|\bfind\b(?:(?![;&|\n]).)*\s-delete\b/i;

export function secretaryBashBlock(input: unknown): SecretaryToolBlock | undefined {
	const command = commandFromInput(input);
	if (!command) return block("bash/shell requires a non-empty command.");
	if (FORBIDDEN_GIT_MUTATION.test(command)) {
		return block("this Git mutation is forbidden during closeout.");
	}
	if (
		FORCED_SHORT_BRANCH_DELETE.test(command) ||
		FORCED_LONG_BRANCH_DELETE.test(command)
	) {
		return block("forced branch deletion is forbidden; only non-force git branch -d is allowed.");
	}
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
