/**
 * Boss-facing `/session_merge` command. Calls the same host merge service as
 * the closeout-secretary auto-trigger. Discard is intentionally not implemented.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { mergeSessionWorktree, type SessionMergeRequest } from "../host/session-merge.ts";
import type { WorktreeFinalizationStateV1 } from "../host/worktree/schema.ts";

function envOf(env: NodeJS.ProcessEnv, key: string): string | undefined {
	const value = env[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveSessionMergeCommandBinding(
	env: NodeJS.ProcessEnv = process.env,
	exists: (value: string) => boolean = existsSync,
): SessionMergeRequest | undefined {
	const root = envOf(env, "PIPIUI_PROJECT_ROOT");
	const cwd = envOf(env, "PIPIUI_MAIN_CWD");
	if (!root || !cwd) return undefined;
	const area = path.resolve(root, ".pi", "worktrees") + path.sep;
	const resolved = path.resolve(cwd);
	if (!resolved.startsWith(area)) return undefined;
	const name = path.basename(resolved);
	if (!name.startsWith("session-") || !exists(resolved)) return undefined;
	return {
		canonicalRoot: path.resolve(root),
		sessionBranch: `pipiui/${name}`,
		worktreePath: resolved,
	};
}

export async function runSessionMergeCommand(input: {
	args?: string;
	env?: NodeJS.ProcessEnv;
	merge?: (request: SessionMergeRequest) => Promise<WorktreeFinalizationStateV1>;
	existsSync?: (value: string) => boolean;
}): Promise<{ ok: boolean; text: string }> {
	const args = (input.args ?? "").trim();
	if (args === "discard" || args.startsWith("discard ")) {
		return { ok: false, text: "session_merge discard is not supported. Only merge is available." };
	}
	const binding = resolveSessionMergeCommandBinding(input.env ?? process.env, input.existsSync ?? existsSync);
	if (!binding) {
		return {
			ok: false,
			text: "No bound session worktree. This session is on the project root; nothing to merge.",
		};
	}
	const merge = input.merge ?? mergeSessionWorktree;
	const state = await merge(binding);
	const { result } = state;
	return {
		ok: result.disposition === "merged",
		text: `session merge: disposition=${result.disposition} merge=${result.merge} cleanup=${result.cleanup}`,
	};
}

export function registerSessionMergeCommand(pi: ExtensionAPI): void {
	pi.registerCommand("session_merge", {
		description: "Merge the bound session worktree branch into the canonical checkout (PipiUI). Discard is not supported.",
		handler: async (args, ctx) => {
			const result = await runSessionMergeCommand({ args, env: process.env });
			ctx.ui.notify(result.text, result.ok ? "info" : "error");
		},
	});
}
