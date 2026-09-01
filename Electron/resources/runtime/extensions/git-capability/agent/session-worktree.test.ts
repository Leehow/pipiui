import test from "node:test";
import assert from "node:assert/strict";

import {
	canonicalProjectRoot,
	createSessionWorktreeHooks,
	encodeSessionWorkspaceEmit,
	isSessionWriteTool,
	SESSION_WORKSPACE_EVENT,
	SESSION_WORKSPACE_EXTENSION_ID,
} from "./session-worktree.ts";

test("isSessionWriteTool only matches write and edit", () => {
	assert.equal(isSessionWriteTool("write"), true);
	assert.equal(isSessionWriteTool("edit"), true);
	assert.equal(isSessionWriteTool("bash"), false);
	assert.equal(isSessionWriteTool("read"), false);
	assert.equal(isSessionWriteTool("apply_patch"), false);
	assert.equal(isSessionWriteTool("git"), false);
});

test("canonicalProjectRoot prefers PIPIUI_PROJECT_ROOT then PIPIUI_MAIN_CWD", () => {
	assert.equal(canonicalProjectRoot({ PIPIUI_PROJECT_ROOT: "/proj", PIPIUI_MAIN_CWD: "/wt" }), "/proj");
	assert.equal(canonicalProjectRoot({ PIPIUI_MAIN_CWD: "/wt" }), "/wt");
	assert.equal(canonicalProjectRoot({}), undefined);
});

test("encodeSessionWorkspaceEmit matches the host ext.emit contract", () => {
	const encoded = encodeSessionWorkspaceEmit(
		{
			op: "bind",
			workspaceCwd: "/proj/.pi/worktrees/session-fix",
			branch: "pipiui/session-fix",
			worktreePath: "/proj/.pi/worktrees/session-fix",
		},
		{ PIPIUI_BRIDGE_PORT: "9", PIPIUI_SESSION_CAPABILITY: "cap-token" },
	);
	assert.ok(encoded);
	assert.equal(encoded.url, "http://127.0.0.1:9/rpc");
	assert.deepEqual(encoded.body, {
		schemaVersion: 1,
		sessionCapability: "cap-token",
		action: "ext.emit",
		extensionId: SESSION_WORKSPACE_EXTENSION_ID,
		event: SESSION_WORKSPACE_EVENT,
		payload: {
			op: "bind",
			workspaceCwd: "/proj/.pi/worktrees/session-fix",
			branch: "pipiui/session-fix",
			worktreePath: "/proj/.pi/worktrees/session-fix",
		},
	});
	assert.equal(
		encodeSessionWorkspaceEmit({ op: "bind" }, { PIPIUI_BRIDGE_PORT: "9" }),
		undefined,
	);
});

test("first write/edit binds once; bash never triggers", async () => {
	const calls: unknown[] = [];
	const posts: unknown[] = [];
	const hooks = createSessionWorktreeHooks({
		env: {
			PIPIUI_PROJECT_ROOT: "/proj",
			PIPIUI_SESSION_ID: "s1",
			PIPIUI_BRIDGE_PORT: "9",
			PIPIUI_SESSION_CAPABILITY: "cap",
		},
		readSidecar: () => undefined,
		readTitle: () => "Fix Login",
		ensure: async (input) => {
			calls.push(input);
			return {
				ok: true,
				workspaceCwd: "/proj/.pi/worktrees/session-fix-login",
				branch: "pipiui/session-fix-login",
				worktreePath: "/proj/.pi/worktrees/session-fix-login",
			};
		},
		postEmit: async (_url, body) => {
			posts.push(body);
		},
	});

	hooks.onToolCall("bash");
	hooks.onToolCall("read");
	assert.equal(hooks.triggered, false);
	assert.equal(calls.length, 0);

	hooks.onToolCall("write");
	hooks.onToolCall("edit");
	hooks.onToolCall("write");
	assert.equal(hooks.triggered, true);

	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls.length, 1);
	assert.equal(posts.length, 1);
	const body = posts[0] as { payload: { op: string; branch: string } };
	assert.equal(body.payload.op, "bind");
	assert.equal(body.payload.branch, "pipiui/session-fix-login");
	assert.deepEqual(calls[0], {
		canonicalRoot: "/proj",
		sessionId: "s1",
		sessionTitle: "Fix Login",
	});
});

test("session_start rebinds when the sidecar path is gone", async () => {
	const calls: unknown[] = [];
	const hooks = createSessionWorktreeHooks({
		env: {
			PIPIUI_PROJECT_ROOT: "/proj",
			PIPIUI_MAIN_CWD: "/proj",
			PIPIUI_SESSION_ID: "s1",
			PIPIUI_BRIDGE_PORT: "9",
			PIPIUI_SESSION_CAPABILITY: "cap",
		},
		existsSync: () => false,
		readSidecar: () => ({
			branch: "pipiui/session-fix",
			worktreePath: "/proj/.pi/worktrees/session-fix",
		}),
		ensure: async (input) => {
			calls.push(input);
			return {
				ok: true,
				workspaceCwd: "/proj/.pi/worktrees/session-fix",
				branch: "pipiui/session-fix",
				worktreePath: "/proj/.pi/worktrees/session-fix",
			};
		},
		postEmit: async () => {},
	});
	hooks.onSessionStart();
	assert.equal(hooks.triggered, true);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], {
		canonicalRoot: "/proj",
		sessionId: "s1",
		sessionTitle: undefined,
		existing: { branch: "pipiui/session-fix", worktreePath: "/proj/.pi/worktrees/session-fix" },
	});
});

test("session_start skips bind when already running inside the session worktree", async () => {
	let ensureCalls = 0;
	const hooks = createSessionWorktreeHooks({
		env: {
			PIPIUI_PROJECT_ROOT: "/proj",
			PIPIUI_MAIN_CWD: "/proj/.pi/worktrees/session-fix",
			PIPIUI_SESSION_ID: "s1",
			PIPIUI_BRIDGE_PORT: "9",
			PIPIUI_SESSION_CAPABILITY: "cap",
		},
		existsSync: () => true,
		readSidecar: () => ({
			branch: "pipiui/session-fix",
			worktreePath: "/proj/.pi/worktrees/session-fix",
		}),
		ensure: async () => {
			ensureCalls += 1;
			return { ok: false, code: "error", error: "should not run" };
		},
		postEmit: async () => {},
	});
	hooks.onSessionStart();
	hooks.onToolCall("write");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(hooks.triggered, true);
	assert.equal(ensureCalls, 0);
});
