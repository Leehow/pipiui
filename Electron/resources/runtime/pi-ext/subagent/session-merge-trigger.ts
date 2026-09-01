/**
 * After a closeout-secretary worker lands ok, merge the bound Boss session
 * worktree (`pipiui/session-*`) into the canonical checkout.
 *
 * No bind / not secretary / not ok → no-op. Does not unbind; the host owns that.
 * needs-fixer is escalated on the existing Boss signal channel (trySendUserMessage).
 */

import { existsSync } from "node:fs";
import * as path from "node:path";

import type { SessionMergeRequest } from "../../extensions/git-capability/host/session-merge.ts";
import type { WorktreeFinalizationStateV1 } from "../../extensions/git-capability/host/worktree/schema.ts";

export const SESSION_MERGE_FAILED_PREFIX = "[session-merge-failed]";

export type SessionMergeBinding = {
	canonicalRoot: string;
	sessionBranch: string;
	worktreePath: string;
};

export function resolveSessionMergeBinding(
	env: NodeJS.ProcessEnv = process.env,
	exists: (value: string) => boolean = existsSync,
): SessionMergeBinding | undefined {
	const root = typeof env.PIPIUI_PROJECT_ROOT === "string" ? env.PIPIUI_PROJECT_ROOT.trim() : "";
	const cwd = typeof env.PIPIUI_MAIN_CWD === "string" ? env.PIPIUI_MAIN_CWD.trim() : "";
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

export function formatSessionMergeFailedSignal(state: WorktreeFinalizationStateV1): string {
	const { result } = state;
	return [
		`${SESSION_MERGE_FAILED_PREFIX} branch=${result.worktree.branch} path=${result.worktree.path} disposition=${result.disposition} merge=${result.merge}`,
		"",
		"reason:",
		result.recovery.reason || result.messages.join("\n") || "session merge failed",
		"",
		"Worktree kept. Dispatch a general-purpose fixer against this session branch/worktree. Do not treat this message as a new user request.",
	].join("\n");
}

export type MaybeMergeBoundSessionInput = {
	isCloseoutSecretary: boolean;
	terminalOk: boolean;
	env?: NodeJS.ProcessEnv;
	merge?: (request: SessionMergeRequest) => Promise<WorktreeFinalizationStateV1>;
	escalate?: (text: string) => void;
	existsSync?: (value: string) => boolean;
};

export async function maybeMergeBoundSessionAfterSecretary(
	input: MaybeMergeBoundSessionInput,
): Promise<WorktreeFinalizationStateV1 | undefined> {
	if (!input.isCloseoutSecretary || !input.terminalOk) return undefined;
	const binding = resolveSessionMergeBinding(input.env ?? process.env, input.existsSync ?? existsSync);
	if (!binding) return undefined;
	try {
		const merge = input.merge
			?? (await import("../../extensions/git-capability/host/session-merge.ts")).mergeSessionWorktree;
		const state = await merge(binding);
		if (state.result.disposition === "needs-fixer") {
			input.escalate?.(formatSessionMergeFailedSignal(state));
		}
		return state;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.escalate?.(`${SESSION_MERGE_FAILED_PREFIX} ${message}`);
		return undefined;
	}
}
