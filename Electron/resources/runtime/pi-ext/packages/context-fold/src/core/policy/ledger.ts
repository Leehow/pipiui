/*
 * ledger.ts — the shared risk detector: which load-bearing tokens a piece of text contains.
 *
 * Pure, zero-latency regex harvest with two consumers:
 *   • `categorize(text)` sorts text into five buckets (paths, commands, errors, exact values,
 *     decisions). The digest uses it to decide which lines of a folded block are worth keeping
 *     verbatim; the seed index uses the same categories for mechanical recovery metadata.
 *   • `ERROR_MARKER_SOURCE` / `errorMarkerRe()` are the one error lexicon, shared with the seed
 *     index so "what counts as an error line" is answered identically everywhere.
 *
 * No Date, no Math.random, no global state — same input ⇒ byte-identical output.
 */

import { safeSlice } from "../tokens";

const VALUE_STOPWORDS = new Set([
	"the", "and", "for", "this", "that", "with", "from", "true", "false", "null",
	"const", "let", "var", "type", "return", "import", "export", "function",
]);

const PER_BLOCK_CAP = 3;

interface CategorizedMarkers {
	paths: string[];
	commands: string[];
	errors: string[];
	exact_values: string[];
	decisions: string[];
}

/**
 * The one error-marker lexicon, shared by the fold digests and the seed index. Compound names
 * (ImportError, ModuleNotFoundError, ValueError, RuntimeException, …) have no word boundary
 * before "Error", so `\bError` misses them — match the whole PascalCase name instead. The
 * plain-word list is deliberately broad and any-case: test runners say "3 failed", tools print
 * "fatal:", CI says "Aborted" — a failure signal in any of those spellings must count as
 * error-shaped (this detector feeds the ladder digest's kept-verbatim risk lines and the index's
 * error field; a missed spelling is the failure mode). Kept as a SOURCE string so each consumer
 * builds its own regex (no shared lastIndex).
 */
export const ERROR_MARKER_SOURCE =
	"(?:\\b(?:[A-Z][A-Za-z]*(?:Error|Exception|Warning)|[Ee]rror|ERROR|FAIL(?:ED|URE)?|[Ff]ail(?:ed|ure)s?|FATAL|[Ff]atal|PANIC|[Pp]anic|[Aa]borted|exception|Traceback|ENOENT|ECONNREFUSED)\\b|npm ERR!|Segmentation fault|core dumped|Permission denied|✗|✘)";

/** A fresh error-marker test regex (no flags — safe for `.test()` reuse). */
export function errorMarkerRe(): RegExp {
	return new RegExp(ERROR_MARKER_SOURCE);
}

/** The ledger's snippet-capturing form: marker plus up to 60 trailing chars. */
function errorSnippetRe(): RegExp {
	return new RegExp(`${ERROR_MARKER_SOURCE}[: ]*[^\\n]{0,60}`, "g");
}

/** Categorize a block's text into salience buckets. Pure regex work, bounded O(n). */
export function categorize(text: string): CategorizedMarkers {
	const result: CategorizedMarkers = { paths: [], commands: [], errors: [], exact_values: [], decisions: [] };
	if (typeof text !== "string" || text.length === 0) return result;
	const seen = new Set<string>(); // global dedup across all categories
	const add = (bucket: string[], val: string): void => {
		const t = safeSlice(val.trim(), 80);
		if (!t || seen.has(t) || bucket.length >= PER_BLOCK_CAP) return;
		seen.add(t);
		bucket.push(t);
	};

	for (const m of text.matchAll(
		/\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|svelte|rs|py|go|java|rb|yml|yaml|toml|sh|env|log|conf|cfg|txt|sql|proto|lock)\b/g,
	)) {
		add(result.paths, m[0]);
	}
	for (const m of text.matchAll(/(?:^|\s)((?:\.{1,2}|src|lib|app|dist|build|test|scripts?)\/[\w./-]+)/gm)) {
		add(result.paths, m[1]);
	}

	for (const m of text.matchAll(/^\s*\$\s+(.+)/gm)) add(result.commands, m[1]);
	for (const m of text.matchAll(
		/\b(?:npm|npx|pnpm|yarn|bun|node|git|docker|kubectl|make|cargo|go|python3?|pytest|deno|uv|gh)\s+\S[^\n.!?;]{0,60}/g,
	)) {
		add(result.commands, m[0].trim());
	}

	for (const m of text.matchAll(errorSnippetRe())) {
		add(result.errors, safeSlice(m[0], 60));
	}
	if (/\s+at\s+\S+\s*\(/.test(text)) add(result.errors, "stack trace");

	for (const m of text.matchAll(/\b(\w[\w.-]*)[ \t]*[:=][ \t]*(\S+)/g)) {
		const key = m[1];
		const val = m[2];
		if (!VALUE_STOPWORDS.has(key.toLowerCase()) && val.length > 2 && val.length < 60) {
			add(result.exact_values, `${key}=${val}`);
		}
	}

	for (const m of text.matchAll(
		/[^.!?\n]{0,200}\b(?:decided|chose|standardized on|going with|will use|selected|picked)\b[^.!?\n]{0,200}/gi,
	)) {
		add(result.decisions, m[0].trim());
	}

	return result;
}
