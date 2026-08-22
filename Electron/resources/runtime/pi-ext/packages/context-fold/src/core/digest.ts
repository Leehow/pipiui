/*
 * digest.ts — what a folded block collapses to.
 *
 * Deterministic, per-kind. Each kind keeps a different essence when folded: a tool_call keeps
 * WHAT it did, a tool_result keeps only its shape and a taste of WHAT it saw. No LLM here —
 * these are structured digests so behaviour is reproducible and debuggable.
 *
 * Every digest carries a leading `{#<code> FOLDED}` tag. This is the engine's source-of-truth
 * string: it is the exact text the agent receives in place of the folded content. The agent
 * reads the short `code` from the tag and calls `unfold`/`recall_folded` with it to pull the block
 * back to full content. The code is a 6-char base36 FNV-1a hash of the block's durable id —
 * stateless and globally stable (same block → same code, every session).
 *
 * Ported ~verbatim from Accordion `engine/digest.ts` (pinned commit 0c22434); only the type
 * imports were retargeted to this port's block model.
 */
import type { BlockKind, DigestBlock } from "./block";
import { estTokens, clip, firstLine, safeSlice, BLOCK_OVERHEAD } from "./tokens";
import { categorize } from "./policy/ledger";

/**
 * Kinds the wire can actually fold and send. A `tool_call` is never folded (it would orphan its
 * result) and a `user` block (intent) is never folded. ONLY these kinds get a `{#code FOLDED}`
 * tag — so the agent is never shown a handle for a block it can't actually unfold.
 */
export const FOLDABLE_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>(["tool_result"]);

/**
 * The ONE foldability predicate, shared by the view and the wire: a block may be folded iff its
 * KIND is foldable and linearize saw all of it. KIND plus the `opaque` flag ONLY — deliberately
 * content- and id-independent. The durable-id guard (`isDurableId`) is a separate wire-emit
 * concern, NOT part of foldability. `opaque` marks a result carrying non-text parts (an image):
 * substitution would replace the whole content array and silently drop them from the view.
 */
export function wireFoldable(b: DigestBlock): boolean {
	return FOLDABLE_KINDS.has(b.kind) && !(b as { opaque?: boolean }).opaque;
}

/** Short, stable handle for a block, derived purely from its durable id (FNV-1a → base36, 6 chars). */
export function foldCode(id: string): string {
	let h = 0x811c9dc5; // FNV-1a 32-bit
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}

/** The folded-block marker the agent sees and passes back to `unfold`, e.g. `{#3f9a2c FOLDED}`. */
export function foldTag(id: string): string {
	return `{#${foldCode(id)} FOLDED}`;
}

/**
 * Per-block memo of the (immutable) digest string.
 *
 * TRIPWIRE: there is no invalidation. Sound ONLY because a committed block's content fields are
 * never mutated in place. If a future feature mutates an existing block's `text`/`tokens`, it
 * MUST clear this cache for that block.
 */
const digestCache = new WeakMap<DigestBlock, string>();

/**
 * The full folded representation. Foldable kinds get the `{#<code> FOLDED}` tag followed by the
 * per-kind body; non-foldable kinds (user / tool_call) get the body alone — they are never sent
 * folded, so tagging them would show a handle the agent can never use.
 */
export function digest(b: DigestBlock): string {
	const cached = digestCache.get(b);
	if (cached !== undefined) return cached;
	const body = digestBody(b);
	const out = FOLDABLE_KINDS.has(b.kind) ? `${foldTag(b.id)} ${body}` : body;
	digestCache.set(b, out);
	return out;
}
/** The per-kind essence kept when a block is folded (without the tag). */
function digestBody(b: DigestBlock): string {
	switch (b.kind) {
		case "user":
			return "“" + clip(b.text, 100) + "”";
		case "text":
			return clip(b.text, 120);
		case "thinking": {
			const tok = estTokens(b.text);
			const gist = firstLine(b.text, 80);
			return `thought · ~${tok} tok${gist ? " · " + gist : ""}`;
		}
		case "tool_call":
			return `${b.toolName ?? "tool"}(${clip(b.text.replace(/^\S+\s*/, ""), 70)})`;
		case "tool_result": {
			const name = b.toolName ?? "result";
			if (!b.text.trim()) return `${name} → ${b.isError ? "error" : "empty"}`;
			const lines = b.text.split("\n").filter((l) => l.trim()).length;
			const tag = b.isError ? "error" : `${lines} line${lines === 1 ? "" : "s"}`;
			const peek = firstLine(b.text, 60);
			const head = `${name} → ${tag}, ~${b.tokens} tok${peek ? " · " + peek : ""}`;
			// Risk-line retention: a folded result never reduces a load-bearing error/risk line to a
			// one-line summary. Keep the detected risk lines verbatim, tightly
			// capped and errors-first, so a buried ImportError survives the fold.
			const risk = collectRiskLines(b.text, { maxLines: DIGEST_RISK_LINES, maxChars: DIGEST_RISK_CHARS });
			return risk.length ? `${head}\n${risk.join("\n")}` : head;
		}
		default:
			return clip(b.text, 80);
	}
}

/**
 * Token cost of a frozen layer's substituted content. The text varies per block and session, so it
 * is not cached on the block. Uses the same estimate and per-block overhead as a digest.
 */
export function substTokens(content: string): number {
	return estTokens(content) + BLOCK_OVERHEAD;
}

// ── Risk-line retention ────────────────────────────────────────────────────────

/** Risk-line caps for a folded digest — tight, so a routine result grows only a little. */
const DIGEST_RISK_LINES = 6;
const DIGEST_RISK_CHARS = 400;
/** Per-line clip for retained risk lines (bounds one pathological line). */
const RISK_LINE_CLIP = 200;

/**
 * Is a single line risk-bearing, and does it carry an ERROR/traceback? Uses the ledger's
 * `categorize` harvester — the single detector shared by digests and the seed index.
 */
function lineRisk(line: string): { risk: boolean; error: boolean } {
	const c = categorize(line);
	const error = c.errors.length > 0;
	const risk = error || c.exact_values.length > 0 || c.decisions.length > 0 || c.commands.length > 0 || c.paths.length > 0;
	return { risk, error };
}

/**
 * Collect the verbatim lines of `text` that carry a risk flag, deduped, errors first, then other
 * risk lines — capped by both line count and total characters.
 */
export function collectRiskLines(text: string, opts: { maxLines: number; maxChars: number }): string[] {
	const errors: string[] = [];
	const others: string[] = [];
	const seen = new Set<string>();
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || seen.has(line)) continue;
		const { risk, error } = lineRisk(line);
		if (!risk) continue;
		seen.add(line);
		(error ? errors : others).push(line.length > RISK_LINE_CLIP ? safeSlice(line, RISK_LINE_CLIP - 1) + "…" : line);
	}
	const out: string[] = [];
	let chars = 0;
	for (const line of [...errors, ...others]) {
		if (out.length >= opts.maxLines) break;
		if (out.length > 0 && chars + line.length > opts.maxChars) break;
		out.push(line);
		chars += line.length + 1;
	}
	return out;
}
