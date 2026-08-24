import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import {
	installFatalHookPropagation,
	isPipiUIFatalHookError,
	PIPIUI_FATAL_HOOK_ERROR,
	registerFatalHookPropagation,
} from "../fatal-hook.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

function fatalError(message: string): Error {
	const error = new Error(message);
	error.name = PIPIUI_FATAL_HOOK_ERROR;
	(error as Error & { pipiuiFatalHook: true }).pipiuiFatalHook = true;
	return error;
}

function extension(path: string, handler: Handler) {
	return {
		path,
		handlers: new Map<string, Handler[]>([["before_provider_request", [handler]]]),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function createRunner(handlers: Array<{ path: string; handler: Handler }>) {
	const runner = new ExtensionRunner(
		handlers.map((item) => extension(item.path, item.handler)),
		{} as never,
		process.cwd(),
		{ getSessionId: () => "sess-a" } as never,
		{} as never,
	);
	return runner;
}

async function sendWithRunner(
	runner: ExtensionRunner,
	payload: Record<string, unknown>,
): Promise<{ providerCalls: number; payload?: unknown; error?: unknown }> {
	let providerCalls = 0;
	try {
		const next = await runner.emitBeforeProviderRequest(payload);
		providerCalls += 1;
		return { providerCalls, payload: next };
	} catch (error) {
		return { providerCalls, error };
	}
}

installFatalHookPropagation(ExtensionRunner);

test("ordinary hook throw is still swallowed and the provider is called", async () => {
	const errors: unknown[] = [];
	const runner = createRunner([
		{
			path: "third-party",
			handler: () => {
				throw new Error("third-party boom /Users/haoli/secret.json Bearer sk-live file-abc");
			},
		},
	]);
	runner.onError((error) => errors.push(error));
	const incoming = { model: "grok-4.6", input: [{ role: "user", content: "hi" }] };
	const result = await sendWithRunner(runner, incoming);
	assert.equal(result.providerCalls, 1);
	assert.equal(result.payload, incoming);
	assert.equal(errors.length, 1);
});

test("tagged fatal hook error aborts before the provider call", async () => {
	const runner = createRunner([
		{
			path: "pipiui-structured",
			handler: () => {
				throw fatalError("无法读取 Structured Output 请求，拒绝静默退化为普通发送");
			},
		},
	]);
	const result = await sendWithRunner(runner, {
		model: "grok-4.6",
		input: [{ role: "user", content: "hi" }],
	});
	assert.equal(result.providerCalls, 0);
	assert.equal(isPipiUIFatalHookError(result.error), true);
	assert.match(String((result.error as Error).message), /拒绝静默退化为普通发送/);
});

test("a later ordinary hook still runs when an earlier ordinary hook throws", async () => {
	let later = 0;
	const runner = createRunner([
		{ path: "a", handler: () => { throw new Error("ignore me"); } },
		{
			path: "b",
			handler: (_event, _ctx) => {
				later += 1;
				return { injected: true };
			},
		},
	]);
	const result = await sendWithRunner(runner, { model: "x" });
	assert.equal(later, 1);
	assert.equal(result.providerCalls, 1);
	assert.deepEqual(result.payload, { injected: true });
});

test("registerFatalHookPropagation is idempotent and logs when the class is missing", (t) => {
	const errors: string[] = [];
	t.mock.method(console, "error", (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	});
	registerFatalHookPropagation();
	assert.match(errors[0] ?? "", /ExtensionRunner not found/);
	assert.equal(installFatalHookPropagation(ExtensionRunner), false);
});
