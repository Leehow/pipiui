/**
 * Fork source sanitizer: strip signed Anthropic thinking before `--fork`.
 *
 * A fork copies the Boss's session entries into the worker's new session
 * (fork-policy.ts). Anthropic binds a thinking block's signature to the request
 * that produced it; replayed into a different session with thinking enabled the
 * API refuses the transcript, and pi's own `--fork` copies entries verbatim. So
 * when the source holds such blocks we fork from a sanitized copy instead:
 * signed or redacted thinking blocks are removed from Anthropic assistant
 * messages, nothing else is touched, and an Anthropic child is started with
 * thinking off (it reasons fresh from its first turn — the transcript it
 * inherits is the point of the fork, not the reasoning that produced it).
 *
 * Pure except for `prepareSanitizedForkSource`, which reads one JSONL file and
 * writes one. Non-Anthropic sources and sources without signed blocks are left
 * alone: the caller keeps forking from the original file.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const FORK_SCRATCH_KEEP = 20;
export const OMITTED_REASONING_TEXT = "(reasoning omitted: signed thinking blocks cannot be replayed into a forked session)";

type Block = { type?: unknown; thinkingSignature?: unknown; signature?: unknown; redacted?: unknown };
type AssistantLike = { role?: unknown; content?: unknown; api?: unknown; provider?: unknown; model?: unknown };

export function isAnthropicModelRef(ref: string | undefined): boolean {
	return typeof ref === "string" && ref.trim().toLowerCase().startsWith("anthropic/");
}

/** Provenance lives on the message: provider, wire API, or a provider-qualified model id. */
export function isAnthropicAssistantMessage(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const record = message as AssistantLike;
	if (record.role !== "assistant") return false;
	return record.provider === "anthropic"
		|| record.api === "anthropic-messages"
		|| (typeof record.model === "string" && record.model.toLowerCase().startsWith("anthropic/"));
}

/** A thinking block the API would validate on replay: signed, or redacted (payload in the signature). */
export function isSignedThinkingBlock(block: unknown): boolean {
	if (!block || typeof block !== "object") return false;
	const record = block as Block;
	if (record.type === "redacted_thinking") return true;
	if (record.type !== "thinking") return false;
	if (record.redacted === true) return true;
	const signature = record.thinkingSignature ?? record.signature;
	return typeof signature === "string" && signature.length > 0;
}

export interface ForkSanitizeStats {
	removedBlocks: number;
	touchedMessages: number;
	/** Messages left with no content and given the placeholder text block. */
	placeholders: number;
}

export interface ForkSanitizeOutcome extends ForkSanitizeStats {
	lines: string[];
}

/**
 * Sanitize raw JSONL lines. Entry ids, parent links, and every non-assistant entry
 * are preserved byte-for-byte; only rewritten entries are re-serialized.
 * Returns undefined when any line is not JSON — a file we cannot read whole is
 * not one we should partially rewrite.
 */
export function sanitizeForkLines(lines: readonly string[]): ForkSanitizeOutcome | undefined {
	const out: string[] = [];
	const stats: ForkSanitizeStats = { removedBlocks: 0, touchedMessages: 0, placeholders: 0 };
	for (const line of lines) {
		if (line.trim() === "") {
			out.push(line);
			continue;
		}
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return undefined;
		}
		const record = entry as { type?: unknown; message?: unknown };
		if (!record || record.type !== "message" || !isAnthropicAssistantMessage(record.message)) {
			out.push(line);
			continue;
		}
		const message = record.message as AssistantLike;
		if (!Array.isArray(message.content)) {
			out.push(line);
			continue;
		}
		const kept = message.content.filter((block) => !isSignedThinkingBlock(block));
		const removed = message.content.length - kept.length;
		if (removed === 0) {
			out.push(line);
			continue;
		}
		stats.removedBlocks += removed;
		stats.touchedMessages += 1;
		if (kept.length === 0) {
			// An assistant turn that was only reasoning: the API rejects empty content, and
			// dropping the entry would orphan every later entry that points at it.
			kept.push({ type: "text", text: OMITTED_REASONING_TEXT });
			stats.placeholders += 1;
		}
		out.push(JSON.stringify({ ...record, message: { ...message, content: kept } }));
	}
	return { lines: out, ...stats };
}

export interface PreparedForkSource extends ForkSanitizeStats {
	path: string;
}

/** Keep the scratch directory bounded; the copies are consumed at spawn and never reopened. */
export function pruneForkScratch(dir: string, keep = FORK_SCRATCH_KEEP): void {
	let entries: Array<{ name: string; mtimeMs: number }>;
	try {
		entries = fs.readdirSync(dir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }));
	} catch {
		return;
	}
	entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
	for (const stale of entries.slice(keep)) {
		try {
			fs.unlinkSync(path.join(dir, stale.name));
		} catch {
			// Best effort.
		}
	}
}

/**
 * Read the Boss session, and when it carries signed Anthropic thinking write a
 * sanitized copy under `scratchDir` named for this dispatch. Returns undefined
 * when nothing had to change (fork from the original) or the file could not be
 * read as JSONL (fork from the original and let pi report what it will).
 */
export function prepareSanitizedForkSource(
	sourcePath: string,
	scratchDir: string,
	label: { agentId: string; runId: string },
): PreparedForkSource | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(sourcePath, "utf8");
	} catch {
		return undefined;
	}
	const trailingNewline = raw.endsWith("\n");
	const lines = raw.split("\n");
	if (trailingNewline) lines.pop();
	const outcome = sanitizeForkLines(lines);
	if (!outcome || outcome.removedBlocks === 0) return undefined;
	const safeLabel = `${label.agentId}.${label.runId}`.replace(/[^A-Za-z0-9._-]/g, "_");
	const target = path.join(scratchDir, `${safeLabel}.jsonl`);
	const tmp = `${target}.${process.pid}.tmp`;
	try {
		fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
		fs.writeFileSync(tmp, `${outcome.lines.join("\n")}${trailingNewline ? "\n" : ""}`, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(tmp, target);
	} catch {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// Nothing staged.
		}
		return undefined;
	}
	pruneForkScratch(scratchDir);
	return { path: target, removedBlocks: outcome.removedBlocks, touchedMessages: outcome.touchedMessages, placeholders: outcome.placeholders };
}

/** One line for [subagent-done]; absent when the fork needed no sanitizing. */
export function formatForkSanitizedLine(input: { removedBlocks: number; touchedMessages: number; thinkingOff: boolean }): string {
	const thinking = input.thinkingOff
		? "; thinking forced off for this Anthropic child (signed blocks cannot be resumed with thinking on)"
		: "";
	return `Fork: ${input.removedBlocks} signed Anthropic thinking block(s) stripped from ${input.touchedMessages} message(s) before copying${thinking}`;
}
