/**
 * Done-message formatting, TLDR extraction, and result text helpers.
 * Pure move from index.ts — behavior preserved.
 */

import type { Message } from "@earendil-works/pi-ai";

// Done-message caps (clean-context orchestration):
// - Injected [subagent-done] Result body is a TLDR slice (TLDR_DONE_CAP); full text
//   lives only in the job registry and is pulled via subagent_status full:true.
// - VERDICT/REPORT/ERROR caps still size chain/foreground aggregates and error paths
//   that embed more than the TLDR pointer message.
export const TLDR_DONE_CAP = 2500;
export const TLDR_FALLBACK_NON_EMPTY_LINES = 15;
export const VERDICT_DONE_CAP = 1500;
export const REPORT_DONE_CAP = 6000;
export const ERROR_DONE_CAP = 6000;

/** Tail lines of attested verify embedded in done / chain messages. */
export const VERIFY_DONE_TAIL_LINES = 12;

export interface VerifyAttestation {
	command: string;
	exitCode: number | null;
	timedOut: boolean;
	tail: string;
}

/** Minimal result shape used by done-message / verify formatting helpers. */
export interface DoneMessageResult {
	agent: string;
	task: string;
	title?: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: { cost: number; turns?: number };
	stopReason?: string;
	errorMessage?: string;
	agentId?: string;
	verify?: VerifyAttestation;
	verifySkipped?: boolean;
	verifyDropped?: boolean;
	reportsInFull?: boolean;
	resumed?: boolean;
}


/**
 * Head-keeping truncation for job-store and status display (and chain aggregates).
 * [subagent-done] injects extractDoneTldr instead; full text stays in the registry.
 * Worker templates put key sections FIRST, so keep the head and mark the omission in
 * the same bracketed style as truncateParallelOutput. Store and status must truncate
 * the SAME direction — mixing head-keep and tail-keep makes full:true return a
 * disjoint slice of what the boss already saw.
 */
export function truncateTextHead(text: string, cap: number): string {
	if (text.length <= cap) return text;
	return `${text.slice(0, cap)}\n\n[Output truncated: ${text.length - cap} chars omitted.]`;
}

export function formatVerifyExit(att: VerifyAttestation): string {
	if (att.timedOut) return "null (timed out)";
	return String(att.exitCode ?? "null");
}

/** `Verify: $ ... → exit N (attested)` line for a runtime attestation. */
export function formatVerifyLine(att: VerifyAttestation): string {
	return `Verify: $ ${att.command} → exit ${formatVerifyExit(att)} (attested)`;
}

/**
 * `verified` tri-state shared by done messages and foreground aggregates.
 * Abort/error short-circuits to none — no testimony was gathered for a synthesized failure.
 */
export function verifiedStateFor(
	result: DoneMessageResult,
	extra?: { aborted?: boolean; error?: string | boolean },
): "pass" | "fail" | "none" {
	const aborted = extra?.aborted ?? result.stopReason === "aborted";
	const att = result.verify;
	return aborted || extra?.error || !att ? "none" : !att.timedOut && att.exitCode === 0 ? "pass" : "fail";
}

/**
 * Done-message / chain aggregate cap. The agent declares whether its deliverable is a
 * report (`deliverable: report`); a verdict is the default, including for an agent whose
 * definition never loaded. Error/abort overrides both.
 * Note: background [subagent-done] injects extractDoneTldr (TLDR_DONE_CAP), not this cap.
 */
export function doneCapForResult(result: { reportsInFull?: boolean }, isError: boolean): number {
	if (isError) return ERROR_DONE_CAP;
	return result.reportsInFull ? REPORT_DONE_CAP : VERDICT_DONE_CAP;
}

/** Match a `## Heading` block from its line through the line before the next `## ` heading. */
export function extractMarkdownSection(text: string, heading: string): string | null {
	const startRe = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\s|$)`, "im");
	const match = startRe.exec(text);
	if (!match || match.index === undefined) return null;
	const start = match.index;
	const after = start + match[0].length;
	const next = /^## /m.exec(text.slice(after));
	const end = next ? after + next.index : text.length;
	return text.slice(start, end).replace(/\s+$/g, "");
}

/**
 * Boss-facing slice of a worker's final text for [subagent-done].
 * Prefer `## TLDR` (+ optional `## What I did not check`); else the first ~15 non-empty lines.
 * Full text stays in the job registry for `subagent_status full:true`.
 */
export function extractDoneTldr(text: string, cap = TLDR_DONE_CAP): string {
	const raw = text.replace(/\s+$/g, "");
	if (!raw) return "(no output)";

	let body: string;
	const tldr = extractMarkdownSection(raw, "TLDR");
	if (tldr) {
		const parts = [tldr];
		const notChecked = extractMarkdownSection(raw, "What I did not check");
		if (notChecked && notChecked !== tldr) parts.push(notChecked);
		body = parts.join("\n\n");
	} else {
		const picked: string[] = [];
		let nonEmpty = 0;
		for (const line of raw.split("\n")) {
			picked.push(line);
			if (line.trim().length > 0) {
				nonEmpty++;
				if (nonEmpty >= TLDR_FALLBACK_NON_EMPTY_LINES) break;
			}
		}
		body = picked.join("\n").replace(/\s+$/g, "");
	}

	if (!body) return "(no output)";
	if (body.length <= cap) return body;
	return `${body.slice(0, Math.max(0, cap - 1))}…`;
}

export function formatSubagentDoneMessage(
	result: DoneMessageResult,
	extra?: { aborted?: boolean; error?: string },
): string {
	const aborted = extra?.aborted ?? result.stopReason === "aborted";
	const ok = !isFailedResult(result) && !aborted && !extra?.error;
	const att = result.verify;
	// `ok` stays process-level; `verified` reflects only the runtime-attested verify command.
	const verified = verifiedStateFor(result, extra);
	// Inject only a TLDR slice — full worker text is stored on the job and pulled on demand.
	const output = extractDoneTldr(
		extra?.error || getResultOutput(result) || result.stderr || "(no output)",
	);
	const cost =
		typeof result.usage.cost === "number" ? result.usage.cost.toFixed(4) : String(result.usage.cost ?? 0);
	const title =
		result.title?.trim() || (result.task.split("\n")[0] ?? "").trim().slice(0, 80) || "(untitled)";
	const lines = [
		`[subagent-done] agentId=${result.agentId ?? "?"} name=${result.agent} ok=${ok} verified=${verified} cost=${cost} turns=${result.usage.turns ?? 0}${result.resumed ? " resumed=true" : ""}`,
		`Title: ${title}`,
	];
	if (verified === "none") {
		if (!att && result.verifyDropped) {
			// Read-only role: the report IS the deliverable, so re-dispatching to make a
			// shell command pass would loop forever. Say so instead of failing the agent.
			lines.push(
				`Verification: not applicable — \`${result.agent}\` is read-only, so the runtime dropped the brief's verify command. Judge this report on its content; do not re-dispatch to make a verify pass.`,
			);
		} else if (!att && result.verifySkipped) {
			// Brief carried a verify command but it was not run (agent aborted).
			lines.push("Verification: skipped (agent aborted)");
		} else {
			lines.push("Verification: worker-claimed only (no verify in brief)");
		}
	} else if (att) {
		lines.push(formatVerifyLine(att));
		for (const tailLine of att.tail.split("\n").slice(-VERIFY_DONE_TAIL_LINES)) {
			lines.push(`  ${tailLine}`);
		}
	}
	lines.push(
		"Result:",
		output,
		`Full report: subagent_status({agentId:"${result.agentId ?? "?"}", full:true})`,
	);
	return lines.join("\n");
}

/** Per-step attested verify blocks for chain results: `Verify[i/n]: $ ... → exit N (attested)`. */
export function formatChainVerifyPrefix(results: DoneMessageResult[]): string {
	const lines: string[] = [];
	results.forEach((r, i) => {
		if (!r.verify) return;
		lines.push(`Verify[${i + 1}/${results.length}]: $ ${r.verify.command} → exit ${formatVerifyExit(r.verify)} (attested)`);
		for (const tailLine of r.verify.tail.split("\n").slice(-VERIFY_DONE_TAIL_LINES)) {
			lines.push(`  ${tailLine}`);
		}
	});
	if (lines.length === 0) return "";
	// Cap the aggregated prefix (REPORT_DONE_CAP): unbounded chain length × ~2000
	// chars/step must not blow up the tool result. Head-keep, earliest steps first.
	return `${truncateTextHead(lines.join("\n"), REPORT_DONE_CAP)}\n`;
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

export function isFailedResult(result: DoneMessageResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultOutput(result: DoneMessageResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}
