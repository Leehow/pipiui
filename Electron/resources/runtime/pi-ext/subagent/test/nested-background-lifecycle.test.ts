/**
 * Bundled-Pi process regression coverage for resident nested RPC parents.
 *
 * A local OpenAI-compatible SSE server is the deterministic model: no network or
 * credentials. The real bundled CLI loads the production subagent extension,
 * executes an actual model tool call, then spawns its real print/RPC descendants.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { NestedBackgroundLifecycle } from "../nested-background-lifecycle.ts";
import {
	createResidentRpcShutdownWaker,
	RESIDENT_RPC_SHUTDOWN_WAKE_STATUS_PREFIX,
	residentRpcShutdownWakeStatusKey,
} from "../resident-rpc-wake.ts";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";

type Scenario = "print" | "single" | "parallel" | "abort";
type PiEvent = { type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> }; [key: string]: unknown };

type MockState = {
	leafStarted: Set<string>;
	leafCompleted: Set<string>;
	leafAborted: Set<string>;
	requests: string[];
};

const suiteRoot = mkdtempSync(join(tmpdir(), "nested-background-real-pi-"));
const agentDir = join(suiteRoot, "agent");
const providerPath = join(suiteRoot, "fixture-provider.mjs");
const cliPath = fileURLToPath(new URL("../../../../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));
const subagentExtension = fileURLToPath(new URL("../index.ts", import.meta.url));
const agentsDir = fileURLToPath(new URL("../../agents", import.meta.url));

function writeFixtureProvider(baseUrl: string): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "pipiui-subagent-models-runtime.json"), JSON.stringify({
		explore: { models: [{ model: "fixture/mock" }] },
		"general-purpose": { models: [{ model: "fixture/mock" }] },
	}), "utf8");
	writeFileSync(providerPath, `
export default function (pi) {
  const noiseStatusKey = process.env.PIPIUI_TEST_NOISE_WAKE_STATUS_KEY;
  if (noiseStatusKey) {
    // The outer RPC interceptor becomes idle only after its agent_settled event
    // has been published. Delay the same-name noise beyond this handler so it
    // actually exercises the production idle/token guard.
    pi.on("agent_settled", (_event, ctx) => {
      setTimeout(() => ctx.ui.setStatus(noiseStatusKey, ""), 0);
    });
  }
  pi.registerProvider("fixture", {
    name: "Fixture provider",
    baseUrl: ${JSON.stringify(baseUrl)},
    apiKey: "fixture-key",
    api: "openai-completions",
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    models: [{
      id: "mock",
      name: "Fixture mock",
      reasoning: false,
      input: ["text"],
      contextWindow: 8192,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }]
  });
}
`, "utf8");
}

function textOf(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
		? (part as { text: string }).text
		: "").join("\n");
}

function sse(res: import("node:http").ServerResponse, payloads: unknown[], delayMs = 0, onClosed?: () => void): void {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
	let sent = false;
	res.on("close", () => {
		if (!sent) onClosed?.();
	});
	setTimeout(() => {
		if (res.destroyed) return;
		for (const payload of payloads) res.write(`data: ${JSON.stringify(payload)}\n\n`);
		res.write("data: [DONE]\n\n");
		sent = true;
		res.end();
	}, delayMs).unref?.();
}

function textResponse(text: string) {
	return [
		{ id: "fixture", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
		{ id: "fixture", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
	];
}

function toolResponse(input: Record<string, unknown>) {
	return [
		{
			id: "fixture", object: "chat.completion.chunk", created: 1, model: "mock",
			choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name: "subagent", arguments: JSON.stringify(input) } }] }, finish_reason: null }],
		},
		{ id: "fixture", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
	];
}

async function startMockServer(): Promise<{ server: Server; port: number; state: MockState }> {
	const state: MockState = { leafStarted: new Set(), leafCompleted: new Set(), leafAborted: new Set(), requests: [] };
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => { raw += String(chunk); });
		req.on("end", () => {
			let body: { messages?: unknown[] };
			try { body = JSON.parse(raw) as { messages?: unknown[] }; }
			catch { res.writeHead(400).end("bad json"); return; }
			const messages = Array.isArray(body.messages) ? body.messages : [];
			const nonSystem = messages.filter((message) => (message as { role?: unknown }).role !== "system" && (message as { role?: unknown }).role !== "developer");
			const transcript = nonSystem.map(textOf).join("\n");
			state.requests.push(JSON.stringify(nonSystem.map((message) => ({ role: (message as { role?: unknown }).role, text: textOf(message) }))).slice(-1_500));
			const leaf = /Task: slow-([a-z-]+)/.exec(transcript)?.[1];
			if (leaf) {
				state.leafStarted.add(leaf);
				const delay = leaf === "abort" ? 8_000 : 2_500;
				sse(res, textResponse(`grandchild ${leaf} completed`), delay, () => state.leafAborted.add(leaf));
				res.on("finish", () => state.leafCompleted.add(leaf));
				return;
			}
			if (transcript.includes("[subagent-done]")) {
				sse(res, textResponse("parent completion consumed"));
				return;
			}
			if (
				messages.some((message) => (message as { role?: unknown }).role === "tool")
				|| /agentId=slow-(?:print|single|parallel|abort|a|b)\b/.test(transcript)
			) {
				// Let the accepted background process reach its real bundled print
				// prompt before the parent emits its first final and print-mode tears down.
				sse(res, textResponse("parent first final"), 1_200);
				return;
			}
			if (transcript.includes("Task: parent-parallel")) {
				sse(res, toolResponse({
				tasks: [
					{ agent: "explore", task: "slow-a", agentId: "slow-a", subagent_type: "explore", run_in_background: true },
					{ agent: "explore", task: "slow-b", agentId: "slow-b", subagent_type: "explore", run_in_background: true },
				],
			}));
				return;
			}
			const scenario = /Task: parent-([a-z]+)/.exec(transcript)?.[1] ?? "single";
			sse(res, toolResponse({
				prompt: `slow-${scenario}`,
				description: "slow grandchild",
				subagent_type: "explore",
				agentId: `slow-${scenario}`,
				run_in_background: true,
			}));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return { server, port: address.port, state };
}

function directChildPids(parentPid: number): number[] {
	return execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
		.split("\n")
		.map((line) => line.trim().split(/\s+/).map(Number))
		.filter(([pid, ppid]) => Number.isInteger(pid) && ppid === parentPid)
		.map(([pid]) => pid);
}

function acceptedRunId(requests: string[], agentId: string): string | undefined {
	const escapedAgentId = agentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = requests
		.map((request) => new RegExp(`agentId=${escapedAgentId}\\s+runId=([^\\s\\"]+)`).exec(request))
		.find((candidate): candidate is RegExpExecArray => candidate !== null);
	return match?.[1];
}

function waitFor(check: () => boolean, label: string, attempts = 300): Promise<void> {
	return new Promise((resolve, reject) => {
		let attempt = 0;
		const tick = () => {
			if (check()) return resolve();
			if (++attempt >= attempts) return reject(new Error(`${label}; mock requests=${JSON.stringify(activeMockState?.requests ?? [])}`));
			setTimeout(tick, 20);
		};
		tick();
	});
}

function exitWithin<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(label)), timeoutMs);
		promise.then(
			(value) => { clearTimeout(timer); resolve(value); },
			(error) => { clearTimeout(timer); reject(error); },
		);
	});
}

let activeMockState: MockState | undefined;

function spawnBundledParent(
	mode: "rpc" | "json",
	scenario: Scenario,
	port: number,
	options: { noiseStatusKey?: string } = {},
): {
	proc: ChildProcess;
	events: PiEvent[];
	wakeStatusKey?: string;
	exit: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
} {
	const wakeToken = mode === "rpc" ? randomUUID() : undefined;
	const wakeStatusKey = wakeToken ? residentRpcShutdownWakeStatusKey(wakeToken) : undefined;
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PI_CODING_AGENT_DIR: agentDir,
		PIPIUI_SUBAGENT_MODELS_FILE: join(agentDir, "pipiui-subagent-models-runtime.json"),
		PIPIUI_MAIN_CWD: suiteRoot,
		PIPIUI_AGENTS_DIR: agentsDir,
		PIPIUI_AGENT_DEPTH: "1",
		PIPIUI_AGENT_ID: `parent-${scenario}`,
		PIPIUI_AGENT_RUN_ID: `run-${scenario}`,
		PIPIUI_AGENT_ROLE: "worker",
		PIPIUI_AGENT_MAX_DEPTH: "2",
		PIPIUI_WORKTREE: "0",
		PIPIUI_NODE_PATH: process.execPath,
		PIPIUI_MAIN_MODEL: "fixture/mock",
		PIPIUI_MAIN_MODEL_FILE: join(suiteRoot, "no-main-model.txt"),
		PIPIUI_SUBAGENT_EXT: subagentExtension,
		PIPIUI_EXT_REGISTERED_PATHS: providerPath,
		PIPIUI_TEST_PROVIDER_URL: `http://127.0.0.1:${port}/v1`,
		PIPIUI_NESTED_RPC_PARENT: mode === "rpc" ? "1" : "",
		PIPIUI_RESIDENT_RPC_WAKE_TOKEN: wakeToken,
		PIPIUI_TEST_NOISE_WAKE_STATUS_KEY: options.noiseStatusKey,
	};
	scrubSubagentRuntimeTestHostEnvironment(env);
	const args = [cliPath, "--mode", mode, "--no-session", "--approve", "--no-skills", "--no-extensions", "-e", subagentExtension, "-e", providerPath, "--model", "fixture/mock"];
	if (mode === "json") args.push("-p", `Task: parent-${scenario}`);
	const proc = spawn(process.execPath, args, { cwd: suiteRoot, env, stdio: ["pipe", "pipe", "pipe"] });
	const events: PiEvent[] = [];
	let stdout = "";
	let stderr = "";
	let residentIdle = false;
	const residentShutdownWaker = wakeStatusKey
		? createResidentRpcShutdownWaker({
			statusKey: wakeStatusKey,
			requestId: randomUUID(),
			stdin: () => proc.stdin,
			isResidentIdle: () => residentIdle,
			isClosed: () => proc.exitCode !== null || proc.killed,
		})
		: undefined;
	proc.stdout.on("data", (chunk) => {
		stdout += String(chunk);
		for (;;) {
			const newline = stdout.indexOf("\n");
			if (newline < 0) break;
			const line = stdout.slice(0, newline);
			stdout = stdout.slice(newline + 1);
			try {
				const event = JSON.parse(line) as PiEvent;
				if (event.type === "agent_settled") residentIdle = true;
				else if (event.type === "agent_start" || event.type === "turn_start") residentIdle = false;
				events.push(event);
				residentShutdownWaker?.consume(event);
			} catch { /* RPC/JSON only emits JSONL */ }
		}
	});
	proc.stderr.on("data", (chunk) => { stderr += String(chunk); });
	const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve, reject) => {
		const timeout = setTimeout(() => {
			proc.kill("SIGKILL");
			reject(new Error(`bundled Pi ${mode}/${scenario} timed out; stderr=${stderr}`));
		}, 15_000);
		proc.once("error", (error) => { residentShutdownWaker?.dispose(); reject(error); });
		proc.once("close", (code, signal) => {
			residentShutdownWaker?.dispose();
			clearTimeout(timeout);
			resolve({ code, signal, stderr });
		});
	});
	if (mode === "rpc") proc.stdin.write(`${JSON.stringify({ id: "initial", type: "prompt", message: `Task: parent-${scenario}` })}\n`);
	else proc.stdin.end(); // real print workers receive ignored/EOF stdin; do not block readPipedStdin.
	return { proc, events, wakeStatusKey, exit };
}

function assistantText(events: PiEvent[]): string[] {
	return events
		.filter((event) => event.type === "message_end" && event.message?.role === "assistant")
		.map((event) => event.message?.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "");
}

test("resident leases are exact-run idempotent and every terminal transition re-evaluates shutdown", () => {
	let changes = 0;
	const lifecycle = new NestedBackgroundLifecycle(() => { changes++; });
	lifecycle.register("queued", "run-a");
	lifecycle.register("running", "run-b");
	lifecycle.noteSettled();
	assert.equal(lifecycle.shouldShutdown(), false);
	lifecycle.noteTerminal("queued", "run-a", false); // exact queued cancellation
	assert.equal(lifecycle.shouldShutdown(), false);
	lifecycle.noteTerminal("running", "run-b", true);
	lifecycle.noteCompletionObserved("running", "run-b");
	lifecycle.noteAssistantFinal("stop");
	assert.equal(lifecycle.shouldShutdown(), true);
	// A late duplicate normal terminal must not reopen the already consumed run-b obligation.
	lifecycle.noteTerminal("running", "run-b", true);
	assert.equal(lifecycle.shouldShutdown(), true);
	assert.ok(changes >= 6, "every accepted/terminal/consumption transition calls the common shutdown seam");
});

test("resident RPC waker accepts only the current idle attempt token once", () => {
	const writes: string[] = [];
	let closed = false;
	const stdin = {
		writable: true,
		write(chunk: string): boolean {
			writes.push(chunk);
			return true;
		},
	};
	const currentToken = "current-attempt-token";
	const currentStatusKey = `${RESIDENT_RPC_SHUTDOWN_WAKE_STATUS_PREFIX}${currentToken}`;
	const status = (statusKey: string) => ({
		type: "extension_ui_request",
		method: "setStatus",
		statusKey,
	});
	const waker = createResidentRpcShutdownWaker({
		statusKey: currentStatusKey,
		requestId: "current-attempt-request",
		stdin: () => stdin,
		isResidentIdle: () => true,
		isClosed: () => closed,
	});

	// A stale attempt sends the same setStatus shape while residentIdle=true. It
	// must neither write nor consume the one-shot guard before the real wake.
	assert.equal(waker.consume(status(`${RESIDENT_RPC_SHUTDOWN_WAKE_STATUS_PREFIX}old-attempt-token`)), false);
	assert.deepEqual(writes, []);
	assert.equal(waker.consume(status(currentStatusKey)), true);
	assert.deepEqual(writes, ["{\"id\":\"current-attempt-request\",\"type\":\"get_state\"}\n"]);
	assert.equal(waker.consume(status(`${RESIDENT_RPC_SHUTDOWN_WAKE_STATUS_PREFIX}old-attempt-token`)), false);
	assert.equal(waker.consume(status(currentStatusKey)), false, "a repeated correct wake cannot write twice");
	assert.equal(writes.length, 1);

	const closedWaker = createResidentRpcShutdownWaker({
		statusKey: currentStatusKey,
		requestId: "closed-request",
		stdin: () => stdin,
		isResidentIdle: () => true,
		isClosed: () => closed,
	});
	closed = true;
	assert.equal(closedWaker.consume(status(currentStatusKey)), false);
	closed = false;
	const disposedWaker = createResidentRpcShutdownWaker({
		statusKey: currentStatusKey,
		requestId: "disposed-request",
		stdin: () => stdin,
		isResidentIdle: () => true,
		isClosed: () => closed,
	});
	disposedWaker.dispose();
	assert.equal(disposedWaker.consume(status(currentStatusKey)), false);
	assert.equal(writes.length, 1, "closed and disposed wakers never write");
});

test("bundled print tears down a slow descendant while resident RPC consumes it and exits cleanly", async () => {
	const { server, port, state } = await startMockServer();
	activeMockState = state;
	writeFixtureProvider(`http://127.0.0.1:${port}/v1`);
	try {
		const print = spawnBundledParent("json", "print", port);
		let printExit: { code: number | null; signal: NodeJS.Signals | null; stderr: string };
		try {
			printExit = await print.exit;
		} catch (error) {
			throw new Error(`${error instanceof Error ? error.message : String(error)}; requests=${JSON.stringify(state.requests)}; events=${JSON.stringify(print.events).slice(-6_000)}`);
		}
		assert.equal(printExit.code, 0, printExit.stderr);
		await waitFor(() => state.leafStarted.has("print"), "print leaf never started");
		await waitFor(() => state.leafAborted.has("print"), "print session_shutdown did not abort slow leaf");
		assert.equal(state.leafCompleted.has("print"), false);

		const rpc = spawnBundledParent("rpc", "single", port);
		const rpcExit = await rpc.exit;
		assert.equal(rpcExit.code, 0, rpcExit.stderr);
		assert.equal(state.leafCompleted.has("single"), true);
		assert.equal(state.leafAborted.has("single"), false);
		const output = assistantText(rpc.events);
		assert.ok(output.includes("parent first final"));
		assert.equal(output.at(-1), "parent completion consumed", "last assistant result must consume completion follow-up");
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		activeMockState = undefined;
	}
});

test("bundled RPC registers every tasks[] receipt until both grandchildren terminalize", async () => {
	const { server, port, state } = await startMockServer();
	activeMockState = state;
	writeFixtureProvider(`http://127.0.0.1:${port}/v1`);
	try {
		const rpc = spawnBundledParent("rpc", "parallel", port);
		const exit = await rpc.exit;
		assert.equal(exit.code, 0, exit.stderr);
		assert.deepEqual([...state.leafCompleted].sort(), ["a", "b"]);
		assert.equal(state.leafAborted.size, 0);
		assert.equal(assistantText(rpc.events).at(-1), "parent completion consumed");
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		activeMockState = undefined;
	}
});

test("bundled resident RPC wakes itself after its settled last descendant is aborted", async () => {
	const { server, port, state } = await startMockServer();
	activeMockState = state;
	writeFixtureProvider(`http://127.0.0.1:${port}/v1`);
	const noiseStatusKey = residentRpcShutdownWakeStatusKey("ordinary-extension-noise");
	const rpc = spawnBundledParent("rpc", "abort", port, { noiseStatusKey });
	let leafPid: number | undefined;
	try {
		await waitFor(() => state.leafStarted.has("abort"), "idle-abort leaf never started");
		await waitFor(() => rpc.events.some((event) => event.type === "agent_settled"), "resident parent never reached first settled", 100);
		await waitFor(() => rpc.events.some((event) =>
			event.type === "extension_ui_request" &&
			event.method === "setStatus" &&
			event.statusKey === noiseStatusKey,
		), "ordinary extension noise was not emitted", 100);
		const firstSettled = rpc.events.findIndex((event) => event.type === "agent_settled");
		const noiseWake = rpc.events.findIndex((event) =>
			event.type === "extension_ui_request" &&
			event.method === "setStatus" &&
			event.statusKey === noiseStatusKey,
		);
		assert.ok(noiseWake > firstSettled, "wrong-token noise must arrive after the outer interceptor is resident-idle");
		assert.equal(rpc.proc.exitCode, null, "wrong-token noise must not wake or consume the resident shutdown guard");
		await waitFor(() => {
			leafPid = directChildPids(rpc.proc.pid!).at(0);
			return leafPid !== undefined;
		}, "idle-abort leaf pid was not found", 100);
		let runId: string | undefined;
		await waitFor(() => {
			runId = acceptedRunId(state.requests, "slow-abort");
			return runId !== undefined;
		}, "idle-abort receipt did not expose its exact runId", 100);

		const abortedAt = Date.now();
		// A bundled extension command reaches the production abortRunningAgent path
		// directly, without opening a model turn after the parent's first final.
		rpc.proc.stdin.write(`${JSON.stringify({
			id: "abort-idle-descendant",
			type: "prompt",
			message: `/subagent_abort slow-abort ${runId}`,
		})}\n`);
		await waitFor(() => state.leafAborted.has("abort"), "subagent_abort left leaf request open", 100);
		await waitFor(() => rpc.events.some((event) =>
			event.type === "extension_ui_request" &&
			event.method === "setStatus" &&
			event.statusKey === rpc.wakeStatusKey,
		), "resident parent did not emit its attempt-matched shutdown wake", 100);
		const realWake = rpc.events.findIndex((event) =>
			event.type === "extension_ui_request" &&
			event.method === "setStatus" &&
			event.statusKey === rpc.wakeStatusKey,
		);
		assert.ok(realWake > noiseWake, "the real shutdown wake must follow wrong-token noise");

		// spawnBundledParent mounts the same production interceptor used by runSingleAgent;
		// this test never writes get_state itself.
		const exit = await exitWithin(
			rpc.exit,
			2_000,
			"resident parent did not naturally exit after shutdown wake",
		);
		assert.equal(exit.code, 0, exit.stderr);
		assert.equal(exit.signal, null);
		assert.ok(Date.now() - abortedAt < 2_000, "resident exit waited for an outer timeout");
		assert.equal(state.leafCompleted.has("abort"), false);
		assert.equal(state.requests.some((request) => request.includes("[subagent-done]")), false, "aborted job must not create a completion follow-up");
		assert.deepEqual(
			assistantText(rpc.events).filter(Boolean),
			["parent first final"],
			"shutdown wake must not create a model turn",
		);
		assert.throws(() => process.kill(leafPid!, 0), { code: "ESRCH" });
	} finally {
		if (rpc.proc.exitCode === null && !rpc.proc.killed) rpc.proc.kill("SIGKILL");
		await new Promise<void>((resolve) => server.close(() => resolve()));
		activeMockState = undefined;
	}
});

test("bundled RPC SIGTERM aborts the slow descendant without an orphan", async () => {
	const { server, port, state } = await startMockServer();
	activeMockState = state;
	writeFixtureProvider(`http://127.0.0.1:${port}/v1`);
	try {
		const rpc = spawnBundledParent("rpc", "abort", port);
		try {
			await waitFor(() => state.leafStarted.has("abort"), "abort leaf never started");
		} catch (error) {
			rpc.proc.kill("SIGTERM");
			await rpc.exit;
			throw new Error(`${error instanceof Error ? error.message : String(error)}; events=${JSON.stringify(rpc.events).slice(-6_000)}`);
		}
		rpc.proc.kill("SIGTERM");
		const exit = await rpc.exit;
		assert.equal(exit.code, 143, exit.stderr);
		await waitFor(() => state.leafAborted.has("abort"), "SIGTERM left slow descendant alive");
		assert.equal(state.leafCompleted.has("abort"), false);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		activeMockState = undefined;
	}
});

after(() => rmSync(suiteRoot, { recursive: true, force: true }));
