/**
 * In-child session worktree: first write/edit → create tree → ext.emit bind.
 *
 * Host (pi-backend) already routes `ext.emit` `git-capability`/`session-workspace`
 * onto setSessionWorkspace. This module must not invent a new bridge action.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import {
	ensureSessionWorktree,
	type SessionWorktreeExisting,
	type SessionWorktreeRequest,
	type SessionWorktreeResult,
} from "../host/session-worktree.ts";

export const SESSION_WORKSPACE_EXTENSION_ID = "git-capability";
export const SESSION_WORKSPACE_EVENT = "session-workspace";
const EMIT_TIMEOUT_MS = 5_000;

export type SessionWorkspaceOp = "bind" | "unbind";

export type SessionWorkspaceEmitPayload = {
	op: SessionWorkspaceOp;
	workspaceCwd?: string;
	branch?: string;
	worktreePath?: string;
};

export type EncodedSessionWorkspaceEmit = {
	url: string;
	body: {
		schemaVersion: 1;
		sessionCapability: string;
		action: "ext.emit";
		extensionId: typeof SESSION_WORKSPACE_EXTENSION_ID;
		event: typeof SESSION_WORKSPACE_EVENT;
		payload: SessionWorkspaceEmitPayload;
	};
};

export function isSessionWriteTool(toolName: unknown): boolean {
	return toolName === "write" || toolName === "edit";
}

function nonBlank(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function envOf(env: NodeJS.ProcessEnv, key: string): string | undefined {
	const value = env[key];
	return nonBlank(value) ? value.trim() : undefined;
}

export function canonicalProjectRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return envOf(env, "PIPIUI_PROJECT_ROOT") ?? envOf(env, "PIPIUI_MAIN_CWD");
}

/**
 * Bridge body the host onExtEmit handler already accepts.
 * Missing port/capability → undefined (fail closed, no POST).
 */
export function encodeSessionWorkspaceEmit(
	payload: SessionWorkspaceEmitPayload,
	env: NodeJS.ProcessEnv = process.env,
): EncodedSessionWorkspaceEmit | undefined {
	const port = envOf(env, "PIPIUI_BRIDGE_PORT");
	const sessionCapability = envOf(env, "PIPIUI_SESSION_CAPABILITY");
	if (!port || !sessionCapability) return undefined;
	if (payload.op !== "bind" && payload.op !== "unbind") return undefined;
	const bodyPayload: SessionWorkspaceEmitPayload = payload.op === "unbind"
		? { op: "unbind" }
		: {
			op: "bind",
			workspaceCwd: payload.workspaceCwd,
			branch: payload.branch,
			worktreePath: payload.worktreePath,
		};
	return {
		url: `http://127.0.0.1:${port}/rpc`,
		body: {
			schemaVersion: 1,
			sessionCapability,
			action: "ext.emit",
			extensionId: SESSION_WORKSPACE_EXTENSION_ID,
			event: SESSION_WORKSPACE_EVENT,
			payload: bodyPayload,
		},
	};
}

export function sessionWorkspaceSidecarPath(projectRoot: string, sessionId: string): string {
	const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "");
	return path.join(projectRoot, ".pi", "agent", "sessions", `${safe}.workspace.json`);
}

export function readSessionWorkspaceSidecar(
	projectRoot: string,
	sessionId: string,
): SessionWorktreeExisting | undefined {
	try {
		const raw = JSON.parse(readFileSync(sessionWorkspaceSidecarPath(projectRoot, sessionId), "utf8")) as unknown;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
		const row = raw as Record<string, unknown>;
		if (typeof row.branch !== "string" || !row.branch.startsWith("pipiui/session-")) return undefined;
		if (typeof row.worktreePath !== "string" || !row.worktreePath) return undefined;
		return { branch: row.branch, worktreePath: row.worktreePath };
	} catch {
		return undefined;
	}
}

/** Best-effort title from the session JSONL header (`*_${sessionId}.jsonl`). */
export function readSessionTitleFromDisk(projectRoot: string, sessionId: string): string | undefined {
	const dir = path.join(projectRoot, ".pi", "agent", "sessions");
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return undefined;
	}
	const suffix = `_${sessionId}.jsonl`;
	const match = names.find((name) => name.endsWith(suffix));
	if (!match) return undefined;
	try {
		const first = readFileSync(path.join(dir, match), "utf8").split(/\r?\n/, 1)[0];
		const row = JSON.parse(first) as Record<string, unknown>;
		if (nonBlank(row.name)) return row.name.trim();
		if (nonBlank(row.title)) return row.title.trim();
	} catch {
		return undefined;
	}
	return undefined;
}

function resolveSessionTitle(env: NodeJS.ProcessEnv, projectRoot: string, sessionId: string): string | undefined {
	return envOf(env, "PIPIUI_SESSION_TITLE") ?? readSessionTitleFromDisk(projectRoot, sessionId);
}

function isBoundSessionWorktreeCwd(env: NodeJS.ProcessEnv, exists: (p: string) => boolean): boolean {
	const root = envOf(env, "PIPIUI_PROJECT_ROOT");
	const cwd = envOf(env, "PIPIUI_MAIN_CWD");
	if (!root || !cwd) return false;
	const area = path.resolve(root, ".pi", "worktrees") + path.sep;
	const resolved = path.resolve(cwd);
	if (!resolved.startsWith(area)) return false;
	const name = path.basename(resolved);
	return name.startsWith("session-") && exists(resolved);
}

export type SessionWorktreeHookDeps = {
	env?: NodeJS.ProcessEnv;
	ensure?: (input: SessionWorktreeRequest) => Promise<SessionWorktreeResult>;
	postEmit?: (url: string, body: unknown) => Promise<void>;
	existsSync?: (p: string) => boolean;
	readSidecar?: (projectRoot: string, sessionId: string) => SessionWorktreeExisting | undefined;
	readTitle?: (projectRoot: string, sessionId: string) => string | undefined;
};

async function defaultPostEmit(url: string, body: unknown): Promise<void> {
	try {
		await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(EMIT_TIMEOUT_MS),
		});
	} catch {
		// Bind is best-effort: a dropped POST leaves an unbound tree the next write will retry
		// only if the in-process flag is reset. Host restart recovers via sidecar/session_start.
	}
}

export function createSessionWorktreeHooks(deps: SessionWorktreeHookDeps = {}) {
	const env = () => deps.env ?? process.env;
	const exists = deps.existsSync ?? existsSync;
	const ensure = deps.ensure ?? ensureSessionWorktree;
	const postEmit = deps.postEmit ?? defaultPostEmit;
	const readSidecar = deps.readSidecar ?? readSessionWorkspaceSidecar;
	let triggered = false;

	async function bindNow(): Promise<void> {
		try {
			const snapshot = env();
			const sessionId = envOf(snapshot, "PIPIUI_SESSION_ID");
			const projectRoot = canonicalProjectRoot(snapshot);
			if (!sessionId || !projectRoot) return;
			const existing = readSidecar(projectRoot, sessionId);
			const title = deps.readTitle
				? deps.readTitle(projectRoot, sessionId)
				: resolveSessionTitle(snapshot, projectRoot, sessionId);
			const created = await ensure({
				canonicalRoot: projectRoot,
				sessionId,
				sessionTitle: title,
				...(existing ? { existing } : {}),
			});
			if (!created.ok) return;
			const encoded = encodeSessionWorkspaceEmit({
				op: "bind",
				workspaceCwd: created.workspaceCwd,
				branch: created.branch,
				worktreePath: created.worktreePath,
			}, snapshot);
			if (!encoded) return;
			await postEmit(encoded.url, encoded.body);
		} catch {
			// Best-effort: never throw into the tool_call/session_start listener.
		}
	}

	return {
		get triggered() {
			return triggered;
		},
		onToolCall(toolName: unknown): void {
			if (triggered) return;
			if (!isSessionWriteTool(toolName)) return;
			triggered = true;
			void bindNow();
		},
		onSessionStart(): void {
			const snapshot = env();
			if (isBoundSessionWorktreeCwd(snapshot, exists)) {
				triggered = true;
				return;
			}
			const sessionId = envOf(snapshot, "PIPIUI_SESSION_ID");
			const projectRoot = canonicalProjectRoot(snapshot);
			if (!sessionId || !projectRoot) return;
			const existing = readSidecar(projectRoot, sessionId);
			// Sidecar points at a missing tree (swept): recreate and re-bind. Host is idempotent.
			if (!existing || exists(existing.worktreePath)) return;
			triggered = true;
			void bindNow();
		},
	};
}

export function registerSessionWorktreeHooks(pi: ExtensionAPI, deps?: SessionWorktreeHookDeps): void {
	const hooks = createSessionWorktreeHooks(deps);
	pi.on("tool_call", (event) => {
		hooks.onToolCall(event.toolName);
	});
	pi.on("session_start", () => {
		hooks.onSessionStart();
	});
}
