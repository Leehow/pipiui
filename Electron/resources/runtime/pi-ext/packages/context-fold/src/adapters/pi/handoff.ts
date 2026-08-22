/*
 * handoff.ts — `/fold-handoff`: write a seed for starting a fresh session.
 *
 * The seed is the deterministic index (same renderer as det compaction) plus the goal the user
 * stated on the command line. No model is called: everything in the file is extracted verbatim
 * from the session, so there is nothing in it that can be a paraphrase or a fabrication.
 *
 * The seed is WRITTEN TO DISK in the session directory and its path reported — nothing is
 * injected into context, nothing fires on its own.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderDetCompactionSummary } from "./compact";
import type { SeedIndexStore } from "./index-store";

const PREAMBLE = [
	"> Everything below is extracted verbatim from the session — no model wrote any of it, so",
	"> exact identifiers, paths, commands, and error strings are preserved as they appeared.",
	"> Each recovery pointer names the on-disk artifact holding the full content.",
].join("\n");

/** Assemble the handoff seed (pure). */
export function buildHandoffSeed(opts: { goal: string; indexBody: string; at: string }): string {
	return [
		`# Session handoff seed — ${opts.at}`,
		"",
		PREAMBLE,
		"",
		"## Goal for the next session",
		opts.goal.trim() || "(not stated — set one before starting the new session)",
		"",
		opts.indexBody,
	].join("\n");
}

interface HandoffCtx {
	ui?: { notify?(msg: string, level?: string): void };
	sessionManager: {
		getSessionDir(): string;
		getSessionId(): string;
	};
}

export function registerHandoffCommand(
	pi: ExtensionAPI,
	deps: { indexFor(ctx: HandoffCtx): SeedIndexStore; spoolDirFor(ctx: HandoffCtx): string },
): void {
	pi.registerCommand("fold-handoff", {
		description:
			"Write a handoff seed for a fresh session, rendered verbatim from the deterministic seed index. Usage: /fold-handoff <goal for the next session>",
		handler: async (args, cmdCtx) => {
			const ctx = cmdCtx as unknown as HandoffCtx;
			const notify = (msg: string, level = "info") => ctx.ui?.notify?.(msg, level);
			try {
				const indexBody = renderDetCompactionSummary({
					records: deps.indexFor(ctx).readAll(),
					spoolDir: deps.spoolDirFor(ctx),
				});
				const seed = buildHandoffSeed({
					goal: typeof args === "string" ? args : "",
					indexBody,
					at: new Date().toISOString(),
				});
				const out = join(ctx.sessionManager.getSessionDir(), `handoff-${ctx.sessionManager.getSessionId()}.md`);
				writeFileSync(out, seed, "utf8");
				notify(`handoff seed written: ${out}\nReview it, start a fresh session (/new), and paste or reference it there.`, "info");
			} catch (err) {
				notify(`fold-handoff failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});
}
