/*
 * externalized.ts — detect worker tool_results whose full report already lives on disk.
 *
 * A [subagent-done] follow-up names `.pi/findings/<agentId>.md` when the runtime wrote the
 * worker's report. Those blocks are safe to fold first: the bytes are still recallable from
 * the spool, and the report itself is on disk. This file only annotates metadata; it never
 * folds, never reads the findings body, and never mutates the view in place.
 */
import { existsSync } from "node:fs";
import type { ViewBlock } from "../contract";

const SUBAGENT_DONE_AGENT = /\[subagent-done\][^\n]*\bagentId=([A-Za-z0-9._-]+)/;
/** `Findings: <path> — …` as written by formatFindingsLine; path may contain spaces. */
const FINDINGS_LINE = /^Findings:\s+(.+?)\s+—/m;
const FINDINGS_LINE_FALLBACK = /^Findings:\s+(\S+)/m;
const FINDINGS_PATH_IN_TEXT = /(?:^|[\s`"'(])(\S*\/\.pi\/findings\/[A-Za-z0-9._-]+\.md)/;

export interface SubagentDoneRef {
	agentId?: string;
	findingsPath?: string;
}

export interface ExternalizedIndex {
	byAgentId: Map<string, string>;
	paths: Set<string>;
}

/** Conservative filesystem check: refuse NUL / `..` segments, then existsSync. */
export function defaultFindingsExists(path: string): boolean {
	if (!path || path.includes("\0") || path.split(/[\\/]/).includes("..")) return false;
	try {
		return existsSync(path);
	} catch {
		return false;
	}
}

/** Parse a [subagent-done] body (or any block that quotes one) for agentId + findings path. */
export function parseSubagentDone(text: string): SubagentDoneRef {
	if (!text || !text.includes("[subagent-done]")) return {};
	const agentId = SUBAGENT_DONE_AGENT.exec(text)?.[1];
	const fromLine = FINDINGS_LINE.exec(text)?.[1]?.trim() ?? FINDINGS_LINE_FALLBACK.exec(text)?.[1]?.trim();
	const findingsPath = fromLine || FINDINGS_PATH_IN_TEXT.exec(text)?.[1];
	const inferred = findingsPath ? agentIdFromFindingsPath(findingsPath) : undefined;
	return { agentId: agentId || inferred, findingsPath };
}

export function agentIdFromFindingsPath(path: string): string | undefined {
	const base = path.split(/[\\/]/).pop() ?? "";
	if (!base.endsWith(".md")) return undefined;
	const id = base.slice(0, -3);
	return id.length > 0 ? id : undefined;
}

export function agentIdFromToolArgs(args: Record<string, unknown> | undefined): string | undefined {
	const id = args?.agentId;
	return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/** Walk tool_call args and [subagent-done] text to attach agentId onto matching blocks. */
export function pairAgentIds(blocks: ViewBlock[]): ViewBlock[] {
	const byCall = new Map<string, string>();
	for (const block of blocks) {
		const fromArgs = agentIdFromToolArgs(block.toolArgs);
		if (block.kind === "tool_call" && block.callId && fromArgs) byCall.set(block.callId, fromArgs);
	}
	let changed = false;
	const out = blocks.map((block) => {
		if (block.agentId) return block;
		const fromCall = block.callId ? byCall.get(block.callId) : undefined;
		const fromText = block.text ? parseSubagentDone(block.text).agentId : undefined;
		const agentId = fromCall || fromText;
		if (!agentId) return block;
		changed = true;
		return { ...block, agentId };
	});
	return changed ? out : blocks;
}

/** Collect agentId → findings path for every [subagent-done] whose named file exists. */
export function indexExternalizedFindings(
	blocks: readonly ViewBlock[],
	findingsExists: (path: string) => boolean = defaultFindingsExists,
): ExternalizedIndex {
	const byAgentId = new Map<string, string>();
	const paths = new Set<string>();
	for (const block of blocks) {
		const ref = parseSubagentDone(block.text ?? "");
		if (!ref.findingsPath || !findingsExists(ref.findingsPath)) continue;
		paths.add(ref.findingsPath);
		if (ref.agentId) byAgentId.set(ref.agentId, ref.findingsPath);
	}
	return { byAgentId, paths };
}

function isExternalizedBlock(block: ViewBlock, agentId: string | undefined, index: ExternalizedIndex): boolean {
	if (agentId && index.byAgentId.has(agentId)) return true;
	const text = block.text;
	if (!text || index.paths.size === 0) return false;
	for (const path of index.paths) {
		if (text.includes(path)) return true;
	}
	return false;
}

/**
 * Return a new block list with `agentId` / `externalized` filled in. Pre-marked
 * `externalized: true` is kept (test / host seam). Does not mutate `blocks`.
 */
export function annotateExternalized(
	blocks: ViewBlock[],
	findingsExists: (path: string) => boolean = defaultFindingsExists,
): ViewBlock[] {
	const paired = pairAgentIds(blocks);
	const index = indexExternalizedFindings(paired, findingsExists);
	const anyPre = paired.some((block) => block.externalized === true);
	if (index.byAgentId.size === 0 && index.paths.size === 0 && !anyPre) return paired;

	let changed = false;
	const out = paired.map((block) => {
		const computed = isExternalizedBlock(block, block.agentId, index);
		const externalized = block.externalized === true || computed;
		if (externalized === block.externalized) return block;
		changed = true;
		return { ...block, externalized };
	});
	return changed ? out : paired;
}
