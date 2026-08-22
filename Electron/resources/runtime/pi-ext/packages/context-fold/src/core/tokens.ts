/*
 * tokens.ts — crude, uniform token estimation.
 *
 * Bare-bones: ~4 chars per token. Good enough to drive the budget bar and the fold
 * boundary. A real per-model tokenizer is deferred; everything downstream reads from
 * estTokens so swapping it is a one-line change. (Ported verbatim from Accordion
 * `engine/tokens.ts`, pinned commit 0c22434.)
 */

const CHARS_PER_TOKEN = 4;
/** Per-block structural overhead (role tags, delimiters). */
export const BLOCK_OVERHEAD = 4;

export function estTokens(s: string): number {
	if (!s) return 0;
	return Math.ceil(s.length / CHARS_PER_TOKEN);
}

/** Prefix slice that never splits a surrogate pair (backs off one unit at a mid-pair cut). */
export function safeSlice(s: string, end: number): string {
	if (end >= s.length) return s;
	const c = s.charCodeAt(end - 1);
	return s.slice(0, c >= 0xd800 && c <= 0xdbff ? end - 1 : end);
}

export function clip(s: string, n: number): string {
	const m = Math.max(1, n);
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= m ? t : safeSlice(t, m - 1).trimEnd() + "…";
}

export function firstLine(s: string, n = 100): string {
	const line = (s.split("\n").find((l) => l.trim()) ?? "").trim();
	return clip(line, n);
}
