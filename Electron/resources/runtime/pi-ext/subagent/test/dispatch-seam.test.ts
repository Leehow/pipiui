/**
 * Behavior tests through the REGISTERED subagent tool's real prepare/execute seam.
 *
 * No source-regex confidence: this file imports the real extension default export,
 * registers it against a fake ExtensionAPI, then calls the registered `subagent` /
 * `subagent_abort` tools' prepareArguments + execute exactly like pi would.
 *
 * Worker children never spawn real Pi: the runtime resolves the child invocation through
 * getPiInvocation(), which prefers PIPIUI_NODE_PATH + process.argv[1]. Under this test both
 * point at this very file, so the child re-executes it with `--mode json` worker args —
 * the reentry guard at the bottom turns this process into a scripted fake worker whose
 * behavior per agentId comes from a control JSON next to this file.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";

// Environment for the extension under test must exist BEFORE importing index.ts: the
// module reads PIPIUI_AGENT_DEPTH / PIPIUI_MAIN_CWD / PIPIUI_AGENTS_DIR at load time.
scrubSubagentRuntimeTestHostEnvironment();
process.env.PIPIUI_AGENT_DEPTH = "0"; // this suite IS the boss (depth 0) regardless of the harness that ran it
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;

/**
 * Worker-mode fake pi. The runtime re-executes THIS FILE as the worker child
 * (getPiInvocation: PIPIUI_NODE_PATH + process.argv[1]); this branch speaks the worker
 * protocol and ALWAYS process.exit()s — it can never fall through into the test suite
 * below. Per-child behavior is scripted entirely through the prompt markers this suite
 * embeds ([seam:<id>:<mode>]), the only channel that survives child-env sanitization.
 * The hang mode keeps a referenced keepalive with a bounded hard exit so a leaked child
 * cannot hold the test process open.
 */
async function runFakeWorkerChild(prompt = process.argv[process.argv.length - 1] ?? "", rpcCommandId?: string): Promise<never> {
	const argv = process.argv;
	const sessionIdArg = argv.find((value) => value.startsWith("pipiui-")) ?? "";
	const fromSession = sessionIdArg.replace(/^pipiui-/, "");
	const marker = prompt.match(/\[seam:([a-z0-9_-]+?)(?::([a-z]+))?\]/);
	const agentId = fromSession || marker?.[1] || "unknown";
	const mode = marker?.[2] ?? "ok";
	const line = (event: unknown) => process.stdout.write(JSON.stringify(event) + "\n");
	line({ type: "session_start", cwd: process.cwd() });
	if (rpcCommandId) line({ id: rpcCommandId, type: "response", command: "prompt", success: true });
	if (mode === "hang") {
		// Referenced keepalive: the test aborts this run via subagent_abort exact-run
		// binding; the hard cap bounds a leaked child's lifetime.
		const keepAlive = setInterval(() => {}, 60_000);
		void keepAlive;
		const hardExit = setTimeout(() => process.exit(0), 30_000);
		void hardExit;
		// Park forever inside worker mode — never return into the module.
		for (;;) {
			// eslint-disable-next-line no-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, 5_000));
		}
	}
	if (mode === "fail") {
		line({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "planned failure" }] },
		});
		process.exit(3);
	}
	line({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: `fake-ok:${agentId}` }] },
	});
	process.exit(0);
}

async function runFakeRpcWorkerChild(): Promise<never> {
	let buffer = "";
	process.stdin.on("data", (chunk) => {
		buffer += String(chunk);
		const newline = buffer.indexOf("\n");
		if (newline < 0) return;
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		try {
			const command = JSON.parse(line) as { id?: string; type?: string; message?: string };
			if (command.type === "prompt") void runFakeWorkerChild(command.message ?? "", command.id);
		} catch {
			process.exit(2);
		}
	});
	await new Promise<never>(() => {});
}

if (
	process.argv.includes("-p")
	&& process.argv.includes("--mode")
	&& process.argv.includes("json")
) {
	await runFakeWorkerChild();
}
if (process.argv.includes("--mode") && process.argv.includes("rpc")) {
	await runFakeRpcWorkerChild();
}

import { sanitizeStrictToolArguments } from "../strict-json-schema.ts";
import { setAgentLeaseMutationHooksForTests } from "../agent-lease.ts";

type RegisteredTool = {
	name: string;
	parameters: unknown;
	prepareArguments?: (args: unknown) => unknown;
	execute: (...args: never[]) => Promise<unknown>;
};

type FakeExtensionAPI = Parameters<Awaited<ReturnType<typeof loadExtension>>>[0];

function createFakePi() {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => unknown }>();
	const notifications: Array<{ text: string; kind: string }> = [];
	const sentMessages: string[] = [];
	const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
	const api = {
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, definition: { description: string; handler: (args: string, ctx: unknown) => unknown }) {
			commands.set(name, definition);
		},
		on(event: string, handler: (...args: never[]) => unknown) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		sendMessage() {},
		sendUserMessage: async (text: string) => {
			sentMessages.push(text);
		},
		ui: {
			notify: (text: string, kind: string) => notifications.push({ text, kind }),
		},
	} as unknown as FakeExtensionAPI;
	return { api, tools, commands, notifications, sentMessages, handlers };
}

/** TypedBox-free schema check: which properties does the sanitized payload keep? */
function prepared(tool: RegisteredTool, args: unknown): Record<string, unknown> {
	const out = tool.prepareArguments ? tool.prepareArguments(args) : args;
	assert.ok(out && typeof out === "object" && !Array.isArray(out), "prepared args must be an object");
	return out as Record<string, unknown>;
}

const agentsDir = fileURLToPath(new URL("../../agents", import.meta.url));

/**
 * One shared suite root: index.ts captures PIPIUI_MAIN_CWD at import time, so every test in
 * this file must run against the same isolated main cwd (no repo worktrees, no real
 * .pi/agent state). Per-test state resets below.
 */
const suiteMainCwd = mkdtempSync(join(tmpdir(), "dispatch-seam-"));
const suiteSessionsDir = join(suiteMainCwd, ".pi", "agent-sessions");
mkdirSync(suiteSessionsDir, { recursive: true });
process.env.PIPIUI_MAIN_CWD = suiteMainCwd;
process.env.PIPIUI_AGENTS_DIR = agentsDir;
process.env.PIPIUI_NODE_PATH = process.execPath;
process.env.PIPIUI_WORKTREE = "0";

const { default: loadExtension, drainPipiuiTrackedChildren } = await import("../index.ts");

/** Per-test reset: clear retained sessions and any leftover harness files. */
function setupSuiteEnv() {
	for (const file of readdirSync(suiteSessionsDir)) rmSync(join(suiteSessionsDir, file), { force: true });
	return () => {
		for (const file of readdirSync(suiteSessionsDir)) rmSync(join(suiteSessionsDir, file), { force: true });
	};
}

test("registered tool seam: provider schema + prepare rejects missing IDs; explicit ids survive", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools } = createFakePi();
	await loadExtension(api);

	const subagent = tools.get("subagent")!;
	assert.ok(subagent, "subagent tool must be registered");
	const chain = tools.get("subagent_chain")!;
	assert.ok(chain, "subagent_chain tool must be registered");

	// Provider schema: root agentId is declared but NOT required — the parallel tasks[] mode
	// omits it (each item carries its own). Single-mode enforcement lives at the execute()
	// identity gate, asserted right below with its named error. TypeBox omits `required`
	// when nothing is required, so assert against the declared array directly.
	assert.ok(Boolean((subagent.parameters as { properties?: Record<string, unknown> }).properties?.agentId), "single schema must still DECLARE agentId");
	const rootRequired = (subagent.parameters as { required?: string[] }).required ?? [];
	assert.equal(rootRequired.includes("agentId"), false, "root agentId must be schema-optional so bare tasks[] waves validate; identity is enforced at execute()");
	const chainItemSchema = (chain.parameters as { properties?: { chain?: { items?: { properties?: Record<string, unknown> } } } })
		.properties?.chain?.items?.properties ?? {};
	assert.ok(chainItemSchema.agentId, "chain item schema must declare agentId");

	// Prepare keeps the explicit semantic id and drops junk; a missing id stays missing.
	const kept = prepared(subagent, {
		prompt: "Fix the race.",
		description: "fix race",
		agentId: "race-fix",
		fresh: true,
		junk: true,
	});
	assert.equal(kept.agentId, "race-fix");
	assert.equal(kept.fresh, true);
	assert.equal("junk" in kept, false);

	// Unknown slug-shaped subagent_type is NOT remapped into agentId/resume_from.
	const unknownType = sanitizeStrictToolArguments(subagent.parameters, {
		prompt: "Map auth.",
		description: "map auth",
		subagent_type: "race-fix",
	}) as Record<string, unknown>;
	assert.equal(unknownType.agentId, undefined);
	assert.equal(unknownType.resume_from, undefined);

	// execute() rejects a missing id at the dispatch gate (no spawn happens).
	const missing = (await subagent.execute("t1", {
		prompt: "Do work.",
		description: "do work",
		subagent_type: "explore",
	}, undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(missing.isError, true);
	assert.match(missing.content[0]!.text, /Missing agentId for this dispatch/);

	// execute() rejects an unknown agent type loudly (no identity remapping).
	const unknown = (await subagent.execute("t2", {
		prompt: "Do work.",
		description: "do work",
		subagent_type: "no-such-role",
		agentId: "probe",
	}, undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(unknown.isError, true);
	assert.match(unknown.content[0]!.text, /Unknown agent/);
});

test("queued dispatch allocates runId; exact abort releases the reservation so the same ID redispatches", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const abort = tools.get("subagent_abort")!;

	// Public single dispatches only, each through the registered prepareArguments seam:
	// first a hanging blocker, then qfix with blockedBy — the single form's documented
	// queue semantics hold it behind the blocker instead of spawning immediately.
	const blockerPrepared = prepared(subagent, {
		prompt: "Block the slot. [seam:blocker:hang].",
		description: "blocker",
		subagent_type: "explore",
		agentId: "blocker",
		run_in_background: true,
	});
	const blockerOut = (await subagent.execute("q1", blockerPrepared, undefined, undefined, {
		cwd: tmpdir(),
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(blockerOut.isError === true, false, JSON.stringify(blockerOut.content));

	const qfixPrepared = prepared(subagent, {
		prompt: "Queued work. [seam:qfix].",
		description: "queued work",
		subagent_type: "explore",
		agentId: "qfix",
		blockedBy: ["blocker"],
		run_in_background: true,
	});
	const dispatched = (await subagent.execute("q1b", qfixPrepared, undefined, undefined, {
		cwd: tmpdir(),
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(dispatched.isError === true, false, JSON.stringify(dispatched.content));
	const receipt = dispatched.content[0]!.text;
	const runId = receipt.match(/agentId=qfix runId=([^\s]+)/)![1]!;
	assert.ok(runId.length > 0, "queued item must carry its accepted runId in the receipt");

	// Same-ID redispatch while queued must be refused (the queued item reserves the id).
	const requeuePrepared = prepared(subagent, {
		prompt: "Same id again. [seam:qfix].",
		description: "same id",
		subagent_type: "explore",
		agentId: "qfix",
		run_in_background: true,
	});
	const requeue = (await subagent.execute("q2", requeuePrepared, undefined, undefined, {
		cwd: tmpdir(),
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(requeue.isError, true);
	assert.match(requeue.content[0]!.text, /already running/);

	// A WRONG runId cannot cancel the queued item — the queue entry survives.
	const wrongRun = (await abort.execute("q3", { agentId: "qfix", runId: "bogus-run" }, undefined, undefined, { cwd: tmpdir() })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(wrongRun.isError, true);
	assert.match(wrongRun.content[0]!.text, /Cannot abort agentId=qfix/);

	// Abort without a runId is a named contract error (runId is schema-required).
	const noRun = (await abort.execute("q4", { agentId: "qfix" } as never, undefined, undefined, { cwd: tmpdir() })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(noRun.isError, true);
	assert.match(noRun.content[0]!.text, /requires both agentId and the exact runId/);

	// Exact {agentId, runId} drops the queued item synchronously and frees the id.
	const exact = (await abort.execute("q5", { agentId: "qfix", runId }, undefined, undefined, { cwd: tmpdir() })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(exact.isError === true, false, JSON.stringify(exact.content));
	assert.match(exact.content[0]!.text, /Dropped queued agentId=qfix runId=/);

	// …and the same id can be dispatched again right away (reservation released).
	const redispatchPrepared = prepared(subagent, {
		prompt: "Fresh dispatch on freed id. [seam:qfix].",
		description: "freed id",
		subagent_type: "explore",
		agentId: "qfix",
		run_in_background: false,
	});
	const redispatch = (await subagent.execute("q6", redispatchPrepared, undefined, undefined, {
		cwd: tmpdir(),
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(redispatch.isError === true, false, JSON.stringify(redispatch.content));
	assert.match(redispatch.content[0]!.text, /fake-ok:qfix/);
});

test("abort before blocked signal flush discards the stale exact queued run", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools, sentMessages, handlers } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const abort = tools.get("subagent_abort")!;

	// Hold automatic delivery behind an active boss turn, then create a real unknown-dependency
	// held item. Its signal must remain tied to this queued {agentId, runId} generation.
	for (const handler of handlers.get("before_agent_start") ?? []) handler({ systemPrompt: "" } as never);
	const dispatched = (await subagent.execute("stale-1", prepared(subagent, {
		prompt: "This must remain queued.",
		description: "stale blocked",
		subagent_type: "explore",
		agentId: "stale-card",
		blockedBy: ["never-published"],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(dispatched.isError === true, false, JSON.stringify(dispatched.content));
	const runId = dispatched.content[0]!.text.match(/agentId=stale-card runId=([^\s]+)/)![1]!;
	await Promise.resolve();

	const dropped = (await abort.execute("stale-2", { agentId: "stale-card", runId }, undefined, undefined, { cwd: tmpdir() })) as { isError?: boolean };
	assert.equal(dropped.isError === true, false);
	for (const handler of handlers.get("agent_settled") ?? []) {
		handler({} as never, { sessionManager: { getSessionId: () => "seam", getBranch: () => "main" } } as never);
	}
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(sentMessages.some((text) => text.includes("agentId=stale-card") && text.includes("[subagent-blocked]")), false);
});

test("chain step-1 failure releases unstarted tail ids (registered chain prepare)", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const chain = tools.get("subagent_chain")!;


	// The registered chain tool's own prepareArguments walks the public {prompt, description}
	// item shape into the internal runner fields before execute.
	const chainPrepared = prepared(chain, {
		chain: [
			{ prompt: "Step one. [seam:cone:fail].", description: "step one", subagent_type: "explore", agentId: "cone" },
			{ prompt: "Step two. [seam:ctwo].", description: "step two", subagent_type: "explore", agentId: "ctwo" },
			{ prompt: "Step three. [seam:cthree].", description: "step three", subagent_type: "explore", agentId: "cthree" },
		],
	}) as unknown as { chain: Array<Record<string, unknown>> };
	assert.ok(Array.isArray(chainPrepared.chain) && chainPrepared.chain.length === 3, "chain prepare must keep all steps");
	assert.equal(chainPrepared.chain[0]!.agentId, "cone");

	// Step 1 fails; steps 2-3 never start. Their ids must be released, not stuck reserved.
	const stopped = (await chain.execute("c1", chainPrepared as never, undefined, undefined, {
		cwd: tmpdir(),
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(stopped.isError, true, "step-1 failure must stop the chain");
	assert.match(stopped.content[0]!.text, /Chain stopped at step 1/);

	// The unstarted tail ids are immediately dispatchable again through the single tool.
	for (const id of ["ctwo", "cthree"]) {
		const attemptPrepared = prepared(subagent, {
			prompt: `Redispatch tail id [seam:${id}].`,
			description: "tail redispatch",
			subagent_type: "explore",
			agentId: id,
			run_in_background: false,
		});
		const redispatch = (await subagent.execute(`c-${id}`, attemptPrepared, undefined, undefined, {
			cwd: tmpdir(),
			model: undefined,
		})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
		assert.equal(redispatch.isError === true, false, `${id} must be re-dispatchable after the chain stopped`);
		assert.match(redispatch.content[0]!.text, new RegExp(`fake-ok:${id}`));
	}
});

test("chain fresh discards a retained general-purpose session; resume keeps it", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const chain = tools.get("subagent_chain")!;

	// Writable general-purpose worker with isolation none keeps a real session file
	// (pipiui-<agentId>.jsonl) across runs. fresh:true must discard that stored context
	// before the child starts; a plain resume must keep it.
	const sessionId = "pipiui-fworker";
	const sessionFile = join(suiteSessionsDir, `1_${sessionId}.jsonl`);

	// --- resume (no fresh): the pre-existing session file survives the run ---
	writeFileSync(sessionFile, JSON.stringify({ cwd: "/tmp", session: "old-context" }) + "\n");
	const resumePrepared = prepared(chain, {
		chain: [
			{ prompt: "Resume the worker [seam:fworker].", description: "resume worker", subagent_type: "general-purpose", agentId: "fworker", isolation: "none" },
		],
	}) as never;
	const resumed = (await chain.execute("f1", resumePrepared, undefined, undefined, {
		cwd: tmpdir(),
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean; details?: { results?: Array<{ resumed?: boolean }> } };
	assert.equal(resumed.isError === true, false, JSON.stringify(resumed.content));
	assert.equal(existsSync(sessionFile), true, "non-fresh resume must keep the retained session file");
	assert.equal(resumed.details?.results?.[0]?.resumed, true, "resume run must report resumed=true");

	// --- fresh:true: the stored context is discarded before the child starts ---
	const freshPrepared = prepared(chain, {
		chain: [
			{ prompt: "Cold-start the worker [seam:fworker].", description: "cold start", subagent_type: "general-purpose", agentId: "fworker", isolation: "none", fresh: true },
		],
	}) as never;
	const fresh = (await chain.execute("f2", freshPrepared, undefined, undefined, {
		cwd: tmpdir(),
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean; details?: { results?: Array<{ resumed?: boolean }> } };
	assert.equal(fresh.isError === true, false, JSON.stringify(fresh.content));
	assert.equal(existsSync(sessionFile), false, "fresh:true must discard the retained session file before the run");
	assert.notEqual(fresh.details?.results?.[0]?.resumed, true, "fresh run must not report resumed=true");
});

test("retired agent-<16hex> ids: only a writable role with a real session resumes; read-only/metadata/fresh all reject", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;

	const legacy = "agent-b0371343a315731e";

	// Case 1 — metadata-only history (the id appears in agent-slices.json, no session):
	// bookkeeping is not resumable context; the gate refuses the retired shape.
	writeFileSync(join(suiteMainCwd, ".pi", "agent-slices.json"), JSON.stringify({
		version: 1,
		slices: [{ agentId: legacy, name: "general-purpose", task: "stale bookkeeping", runId: "old-run", state: "failed", updatedAt: Date.now() }],
	}));
	const metadataOnly = (await subagent.execute("l1", prepared(subagent, {
		prompt: `Resume legacy [seam:${legacy}:ok].`,
		description: "legacy metadata resume",
		subagent_type: "general-purpose",
		agentId: legacy,
		isolation: "none",
		run_in_background: false,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(metadataOnly.isError, true, "metadata-only history must not pass the continuation gate");
	assert.match(metadataOnly.content[0]!.text, /retired auto-generated shape/);

	// Case 2 — read-only role with a matching session file: explore forces --no-session,
	// so the file is not context this dispatch would reopen; reject.
	writeFileSync(join(suiteSessionsDir, `1_pipiui-${legacy}.jsonl`), JSON.stringify({ cwd: "/tmp" }) + "\n");
	const readOnly = (await subagent.execute("l2", prepared(subagent, {
		prompt: `Resume legacy as explore [seam:${legacy}:ok].`,
		description: "legacy read-only resume",
		subagent_type: "explore",
		agentId: legacy,
		run_in_background: false,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(readOnly.isError, true, "read-only role must reject even with a matching session file");
	assert.match(readOnly.content[0]!.text, /retired auto-generated shape/);
	assert.match(readOnly.content[0]!.text, /not resumable here/);

	// Case 3 — writable general-purpose with the real retained session: non-fresh resume
	// passes the gate and the worker runs resumed.
	const realResume = (await subagent.execute("l3", prepared(subagent, {
		prompt: `Resume legacy with session [seam:${legacy}:ok].`,
		description: "legacy real resume",
		subagent_type: "general-purpose",
		agentId: legacy,
		isolation: "none",
		run_in_background: false,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean; details?: { results?: Array<{ resumed?: boolean }> } };
	assert.equal(realResume.isError === true, false, JSON.stringify(realResume.content));
	assert.equal(realResume.details?.results?.[0]?.resumed, true, "session-backed legacy id must resume, not cold-start");

	// Case 4 — fresh:true rejects even with the real session and the writable role: the
	// retired shape is continuation-only and may never create a cold opaque worker.
	const coldStart = (await subagent.execute("l4", prepared(subagent, {
		prompt: `Cold-start legacy [seam:${legacy}:ok].`,
		description: "legacy cold start",
		subagent_type: "general-purpose",
		agentId: legacy,
		isolation: "none",
		fresh: true,
		run_in_background: false,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(coldStart.isError, true, "fresh:true on a retired-shape id must be rejected");
	assert.match(coldStart.content[0]!.text, /cannot be started cold/);
});

test("abort guidance in model-facing strings always carries runId", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;

	// A hanging worker produces a receipt with its exact runId; every abort form printed
	// to the model includes both identifiers.
	const dispatched = (await subagent.execute("h1", {
		prompt: "Hang forever. [seam:hworker:hang].",
		description: "hang",
		subagent_type: "explore",
		agentId: "hworker",
		run_in_background: true,
	}, undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(dispatched.isError === true, false, JSON.stringify(dispatched.content));
	const receipt = dispatched.content[0]!.text;
	assert.match(receipt, /agentId=hworker runId=([^\s]+)/);
	const runId = receipt.match(/runId=([^\s]+)/)![1]!;
	assert.match(receipt, /subagent_abort\(\{agentId, runId\}\)/);

	// Exact-run abort of the LIVE worker works and names both ids in its result.
	// The background hand-over registers the run asynchronously; poll until it is live.
	const abort = tools.get("subagent_abort")!;
	let stopped: { content: Array<{ type: string; text: string }>; isError?: boolean } | undefined;
	for (let attempt = 0; attempt < 50 && !stopped; attempt++) {
		await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
		const attemptResult = (await abort.execute("h3", { agentId: "hworker", runId }, undefined, undefined, {
			cwd: tmpdir(),
		})) as { content: Array<{ type: string; text: string }> ; isError?: boolean };
		if (attemptResult.isError !== true) stopped = attemptResult;
	}
	assert.ok(stopped, "exact-run abort must succeed once the run is live");
	assert.equal(stopped.isError === true, false, JSON.stringify(stopped.content));
	assert.match(stopped.content[0]!.text, /Abort requested for agentId=hworker runId=/);
});


/** Bounded deterministic poll (no fixed grace periods): awaits check() until it holds. */
async function waitUntilTrue(check: () => Promise<boolean>, label: string, attempts = 250): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		if (await check()) return;
		await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
	}
	assert.ok(await check(), `${label} not reached within poll budget`);
}

async function statusText(status: RegisteredTool): Promise<string> {
	const out = (await status.execute("st", {}, undefined, undefined, { cwd: tmpdir() })) as {
		content: Array<{ type: string; text: string }>;
	};
	return out.content[0]!.text;
}

const projectAgentsDir = join(suiteMainCwd, ".pi", "agents");

function writeProjectAgent(name: string): void {
	mkdirSync(projectAgentsDir, { recursive: true });
	writeFileSync(join(projectAgentsDir, `${name}.md`), [
		"---",
		"schema: 1",
		`name: ${name}`,
		`description: Project-sourced probe ${name} for dispatch acceptance-barrier regressions.`,
		"mode: worker",
		"capabilities:",
		"  filesystem: workspace-write",
		"  shell: true",
		"  web: true",
		"  mcp: false",
		"  desktop: none",
		"  delegation: false",
		"worktree: none",
		"deliverable: report",
		"---",
		"Probe body.",
		"",
	].join("\n"));
}

function removeProjectAgents(): void {
	rmSync(projectAgentsDir, { recursive: true, force: true });
}

test("a settled producer's reservation release repumps its cross-call dependent into running", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const status = tools.get("subagent_status")!;

	// One atomic tasks[] wave: prod-a settles on its own; dep-a is registered in the SAME
	// batch behind it. prod-a's terminal event pumps while its id reservation still answers
	// running-like; only the centralized reservation release can admit dep-a.
	const wave = (await subagent.execute("rp-1", {
		tasks: [
			{ task: "Producer settles fast. [seam:prod-a].", agentId: "prod-a", subagent_type: "explore", run_in_background: true },
			{ task: "Dependent work. [seam:dep-a].", agentId: "dep-a", subagent_type: "explore", blockedBy: ["prod-a"], run_in_background: true },
		],
	}, undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(wave.isError === true, false, JSON.stringify(wave.content));

	// Without the release repump, dep-a waits forever: this poll is the regression.
	await waitUntilTrue(
		async () => /\| dep-a \|[^|]*\|[^|]*\| worker=ok \|/.test(await statusText(status)),
		"dep-a must run to completion after its producer settles",
	);
});

test("exact queued abort of a producer repumps its dependent into a genuine held signal", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => cleanup());
	const { api, tools, sentMessages } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const abort = tools.get("subagent_abort")!;
	const status = tools.get("subagent_status")!;

	// gate-b runs (hangs) so prod-b stays QUEUED behind it, and dep-b waits behind prod-b.
	const gateOut = (await subagent.execute("qb-0", prepared(subagent, {
		prompt: "Gate slot. [seam:gate-b:hang].",
		description: "gate slot",
		subagent_type: "explore",
		agentId: "gate-b",
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(gateOut.isError === true, false, JSON.stringify(gateOut.content));
	const gateRunId = gateOut.content[0]!.text.match(/agentId=gate-b runId=([^\s]+)/)![1]!;

	const prodOut = (await subagent.execute("qb-1", prepared(subagent, {
		prompt: "Queued producer. [seam:prod-b].",
		description: "queued producer",
		subagent_type: "explore",
		agentId: "prod-b",
		blockedBy: ["gate-b"],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(prodOut.isError === true, false, JSON.stringify(prodOut.content));
	const prodRunId = prodOut.content[0]!.text.match(/agentId=prod-b runId=([^\s]+)/)![1]!;

	const depOut = (await subagent.execute("qb-2", prepared(subagent, {
		prompt: "Dependent work. [seam:dep-b].",
		description: "dependent",
		subagent_type: "explore",
		agentId: "dep-b",
		blockedBy: ["prod-b"],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(depOut.isError === true, false, JSON.stringify(depOut.content));
	const depRunId = depOut.content[0]!.text.match(/agentId=dep-b runId=([^\s]+)/)![1]!;

	// Precondition: dep-b is quietly waiting on its reserved/queued producer — no held signal.
	let text = await statusText(status);
	assert.match(text, /agentId=dep-b runId=[^\s]+ role=explore[^\n]*state=queued: waiting for prod-b/);
	assert.doesNotMatch(text, /agentId=dep-b .*never dispatched/);

	// Stale {agentId, runId} must cancel nothing: the queued producer and its dependent wait.
	const stale = (await abort.execute("qb-3", { agentId: "prod-b", runId: "bogus-run" }, undefined, undefined, { cwd: tmpdir() })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(stale.isError, true);
	assert.match(stale.content[0]!.text, /Cannot abort agentId=prod-b/);
	text = await statusText(status);
	// "[unchanged]" is itself the proof: the stale pair must alter neither the queue entry nor
	// its dependent's waiting state.
	assert.ok(
		text.includes("[unchanged since previous subagent_status]")
			|| /agentId=prod-b runId=[^\s]+ role=explore[^\n]*state=queued: waiting for gate-b/.test(text),
		"a stale runId abort must change nothing about the queued producer or its dependent",
	);

	// Exact queued abort drops the producer; the reservation release must repump the queue so
	// dep-b is held against the producer's true post-cancel state — not left waiting forever.
	const exact = (await abort.execute("qb-4", { agentId: "prod-b", runId: prodRunId }, undefined, undefined, { cwd: tmpdir() })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(exact.isError === true, false, JSON.stringify(exact.content));
	assert.match(exact.content[0]!.text, /Dropped queued agentId=prod-b runId=/);
	await waitUntilTrue(
		async () => /agentId=dep-b runId=[^\s]+ role=explore[^\n]*state=queued: held \(dependency prod-b was never dispatched\)/.test(await statusText(status)),
		"dep-b must become held after its queued producer is exact-aborted",
	);
	await waitUntilTrue(
		() => Promise.resolve(sentMessages.filter((line) => line.includes("agentId=dep-b") && line.includes("[subagent-blocked]")).length === 1),
		"exactly one blocked signal for dep-b",
	);

	// The same id is immediately redispatchable (no stranded reservation/token).
	const redispatch = (await subagent.execute("qb-5", prepared(subagent, {
		prompt: "Prod id freed. [seam:prod-b].",
		description: "freed id",
		subagent_type: "explore",
		agentId: "prod-b",
		run_in_background: false,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(redispatch.isError === true, false, JSON.stringify(redispatch.content));
	assert.match(redispatch.content[0]!.text, /fake-ok:prod-b/);

	// Hygiene: drop the held dependent so no queued leftover leaks into later tests.
	await abort.execute("qb-5b", { agentId: "dep-b", runId: depRunId }, undefined, undefined, { cwd: tmpdir() });

	// Release the hanging gate so the suite teardown can reap every child.
	await waitUntilTrue(async () => {
		const attempt = (await abort.execute("qb-6", { agentId: "gate-b", runId: gateRunId }, undefined, undefined, { cwd: tmpdir() })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
		return attempt.isError !== true;
	}, "gate-b must be abortable once its run is live");
});

test("pending acceptance is visible during the project-agent confirmation; denial releases and repumps", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => {
		removeProjectAgents();
		cleanup();
	});
	writeProjectAgent("projgate");
	const { api, tools, sentMessages } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const abort = tools.get("subagent_abort")!;
	const status = tools.get("subagent_status")!;

	// The project-agent confirmation is the FIRST async acceptance barrier; park the dispatch
	// on it and observe what a concurrent dependent sees while the wave is suspended.
	let confirmEntered = false;
	let denyConfirmation: (ok: boolean) => void = () => {};
	const confirmation = new Promise<boolean>((resolve) => {
		denyConfirmation = resolve;
	});
	const gatedExecute = subagent.execute("pc-1", {
		prompt: "Gated dispatch. [seam:gate-c].",
		description: "gated dispatch",
		subagent_type: "projgate",
		agentId: "gate-c",
		agentScope: "both",
		run_in_background: true,
	}, undefined, undefined, {
		cwd: suiteMainCwd,
		hasUI: true,
		ui: { confirm: () => {
			confirmEntered = true;
			return confirmation;
		} },
	}) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
	await waitUntilTrue(() => confirmEntered, "dispatch must reach the project-agent confirmation");

	// While gate-c is suspended at the confirmation, a dependent must see the deterministic
	// pending state — never a transient "never dispatched" held signal.
	const depOut = (await subagent.execute("pc-2", prepared(subagent, {
		prompt: "Dependent work. [seam:dep-c].",
		description: "dependent",
		subagent_type: "explore",
		agentId: "dep-c",
		blockedBy: ["gate-c"],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(depOut.isError === true, false, JSON.stringify(depOut.content));
	const depRunId = depOut.content[0]!.text.match(/agentId=dep-c runId=([^\s]+)/)![1]!;
	const waiting = await statusText(status);
	assert.match(waiting, /agentId=dep-c runId=[^\s]+ role=explore[^\n]*state=queued: waiting for gate-c/);
	assert.doesNotMatch(waiting, /agentId=dep-c .*never dispatched/);
	assert.equal(sentMessages.some((line) => line.includes("agentId=dep-c") && line.includes("[subagent-blocked]")), false);

	// Denial rejects the wave; the pending token must release (finally) and repump, so the
	// dependent is held against the genuine post-denial state — not left waiting forever.
	denyConfirmation(false);
	const gated = await gatedExecute;
	assert.match(gated.content[0]!.text, /Canceled: project-local agents not approved/);
	await waitUntilTrue(
		async () => /agentId=dep-c runId=[^\s]+ role=explore[^\n]*state=queued: held \(dependency gate-c was never dispatched\)/.test(await statusText(status)),
		"dep-c must become held after the confirmation denial",
	);
	await waitUntilTrue(
		() => Promise.resolve(sentMessages.filter((line) => line.includes("agentId=dep-c") && line.includes("[subagent-blocked]")).length === 1),
		"exactly one blocked signal for dep-c",
	);

	// No phantom token: the id accepts a fresh dispatch right after the denial.
	const redispatch = (await subagent.execute("pc-3", prepared(subagent, {
		prompt: "Fresh after denial. [seam:gate-c].",
		description: "fresh after denial",
		subagent_type: "projgate",
		agentId: "gate-c",
		agentScope: "both",
		confirmProjectAgents: false,
		run_in_background: false,
	}), undefined, undefined, { cwd: suiteMainCwd, model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(redispatch.isError === true, false, JSON.stringify(redispatch.content));
	assert.match(redispatch.content[0]!.text, /fake-ok:gate-c/);

	// Hygiene: drop the held dependent so no queued leftover leaks into later tests.
	await abort.execute("pc-4", { agentId: "dep-c", runId: depRunId }, undefined, undefined, { cwd: tmpdir() });
});

test("post-await identity failure releases the pending token; dependents see genuine unknown", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => {
		removeProjectAgents();
		cleanup();
	});
	writeProjectAgent("projgate");
	const { api, tools, sentMessages } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const abort = tools.get("subagent_abort")!;
	const status = tools.get("subagent_status")!;

	// A retired-shape id whose retained session makes it resumable at the pre-acceptance
	// gate. The second identity gate re-reads the mutable session state after the await —
	// remove the session while the dispatch hangs at the confirmation so only the second
	// gate fails. That failure historically returned WITHOUT releasing the pending token,
	// stranding dependents on a phantom running-like id forever.
	const legacy = "agent-0f1e2d3c4b5a6978";
	const legacySession = join(suiteSessionsDir, `1_pipiui-${legacy}.jsonl`);
	writeFileSync(legacySession, JSON.stringify({ cwd: "/tmp", session: "retained" }) + "\n");

	let confirmEntered = false;
	let allowConfirmation: (ok: boolean) => void = () => {};
	const confirmation = new Promise<boolean>((resolve) => {
		allowConfirmation = resolve;
	});
	const legacyExecute = subagent.execute("pi-1", {
		prompt: `Resume legacy [seam:${legacy}:ok].`,
		description: "legacy resume",
		subagent_type: "projgate",
		agentId: legacy,
		agentScope: "both",
		run_in_background: true,
	}, undefined, undefined, {
		cwd: suiteMainCwd,
		hasUI: true,
		ui: { confirm: () => {
			confirmEntered = true;
			return confirmation;
		} },
	}) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
	await waitUntilTrue(() => confirmEntered, "legacy dispatch must reach the project-agent confirmation");
	rmSync(legacySession, { force: true });
	allowConfirmation(true);

	const legacyResult = await legacyExecute;
	assert.equal(legacyResult.isError, true, "the vanished session must fail the second identity gate");
	assert.match(legacyResult.content[0]!.text, /retired auto-generated shape/);

	// The token was released: a dependent of that id must see the genuine unknown state and
	// be held immediately — not wait forever on the phantom pending id.
	const depOut = (await subagent.execute("pi-2", prepared(subagent, {
		prompt: "Dependent work. [seam:dep-d].",
		description: "dependent",
		subagent_type: "explore",
		agentId: "dep-d",
		blockedBy: [legacy],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(depOut.isError === true, false, JSON.stringify(depOut.content));
	const depRunId = depOut.content[0]!.text.match(/agentId=dep-d runId=([^\s]+)/)![1]!;
	const text = await statusText(status);
	assert.match(text, new RegExp(`agentId=dep-d runId=[^\\s]+ role=explore[^\\n]*state=queued: held \\(dependency ${legacy} was never dispatched\\)`));
	await waitUntilTrue(
		() => Promise.resolve(sentMessages.filter((line) => line.includes("agentId=dep-d") && line.includes("[subagent-blocked]")).length === 1),
		"exactly one blocked signal for dep-d",
	);

	// Hygiene: drop the held dependent.
	await abort.execute("pi-3", { agentId: "dep-d", runId: depRunId }, undefined, undefined, { cwd: tmpdir() });
});
test("staggered overlapping acceptances of one id release independently; later duplicate still rejected", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => {
		removeProjectAgents();
		cleanup();
	});
	writeProjectAgent("projgate");
	const { api, tools, sentMessages } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const status = tools.get("subagent_status")!;

	// Two dispatches of the SAME agentId, each parked on its own project-agent
	// confirmation (the first async acceptance barrier), so their pending tokens overlap.
	let releaseFirst: (ok: boolean) => void = () => {};
	let releaseSecond: (ok: boolean) => void = () => {};
	const firstGate = new Promise<boolean>((resolve) => { releaseFirst = resolve; });
	const secondGate = new Promise<boolean>((resolve) => { releaseSecond = resolve; });
	const overlapExecute = (callId: string, reached: { value: boolean }, gate: Promise<boolean>) =>
		subagent.execute(callId, {
			prompt: "Overlap acceptance probe. [seam:overlap].",
			description: "overlap probe",
			subagent_type: "projgate",
			agentId: "overlap",
			agentScope: "both",
			run_in_background: true,
		}, undefined, undefined, {
			cwd: suiteMainCwd,
			hasUI: true,
			ui: { confirm: () => {
				reached.value = true;
				return gate;
			} },
		}) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

	const firstEntered = { value: false };
	const secondEntered = { value: false };
	const firstExecute = overlapExecute("ov-1", firstEntered, firstGate);
	const secondExecute = overlapExecute("ov-2", secondEntered, secondGate);
	await waitUntilTrue(() => Promise.resolve(firstEntered.value), "first dispatch must reach its confirmation");
	await waitUntilTrue(() => Promise.resolve(secondEntered.value), "second dispatch must reach its confirmation");

	// While BOTH claimants are pending, a dependent sees a running-like id — never unknown.
	const depOut = (await subagent.execute("ov-3", prepared(subagent, {
		prompt: "Dependent work. [seam:ovdep].",
		description: "dependent",
		subagent_type: "explore",
		agentId: "ovdep",
		blockedBy: ["overlap"],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(depOut.isError === true, false, JSON.stringify(depOut.content));
	const waiting = await statusText(status);
	assert.match(waiting, /agentId=ovdep runId=[^\s]+ role=explore[^\n]*state=queued: waiting for overlap/);
	assert.doesNotMatch(waiting, /agentId=ovdep .*never dispatched/);

	// The LATER duplicate, resumed first, is still rejected by the selector: the first
	// claimant's pending token keeps the id taken.
	releaseSecond(true);
	const second = await secondExecute;
	assert.equal(second.isError, true, "the later duplicate acceptance must be rejected");
	assert.match(second.content[0]!.text, /already running/);

	// Releasing the duplicate's token must NOT make the id unknown: the first claimant is
	// still pending, so the dependent keeps waiting — no false never-dispatched signal.
	// "[unchanged]" is itself the proof: the dependent's waiting state is untouched.
	const afterDuplicateRelease = await statusText(status);
	assert.ok(
		afterDuplicateRelease.includes("[unchanged since previous subagent_status]")
			|| /agentId=ovdep runId=[^\s]+ role=explore[^\n]*state=queued: waiting for overlap/.test(afterDuplicateRelease),
		"the duplicate's release must leave ovdep waiting on the still-pending first claimant",
	);
	assert.doesNotMatch(afterDuplicateRelease, /agentId=ovdep .*never dispatched/);
	assert.equal(sentMessages.some((line) => line.includes("agentId=ovdep") && line.includes("[subagent-blocked]")), false);

	// Resuming the FIRST claimant dispatches normally and repumps the dependent to done.
	releaseFirst(true);
	const first = await firstExecute;
	assert.equal(first.isError === true, false, JSON.stringify(first.content));
	await waitUntilTrue(
		async () => /\| ovdep \|[^|]*\|[^|]*\| worker=ok \|/.test(await statusText(status)),
		"ovdep must run to completion after overlap's acceptance completed",
	);
});

test("queued-single setup failure before spawn frees the id, repumps dependents, allows redispatch", async (t) => {
	const cleanup = setupSuiteEnv();
	t.after(() => {
		setAgentLeaseMutationHooksForTests();
		cleanup();
	});
	const { api, tools, sentMessages } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const abort = tools.get("subagent_abort")!;
	const status = tools.get("subagent_status")!;

	// The lease mutation hook makes the queued single's runSingleAgent throw during lease
	// acquisition — a rejection that escapes BEFORE runSingleAgent's finally owns the
	// acceptance reservation. The queued run must finalize honestly and release it.
	let failNextPrexLease = true;
	setAgentLeaseMutationHooksForTests({
		insideCriticalSection: (agentId) => {
			if (agentId === "prex" && failNextPrexLease) {
				failNextPrexLease = false;
				throw new Error("simulated lease setup failure");
			}
		},
	});

	const gateOut = (await subagent.execute("qs-1", prepared(subagent, {
		prompt: "Gate work. [seam:sgate].",
		description: "gate",
		subagent_type: "explore",
		agentId: "sgate",
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(gateOut.isError === true, false, JSON.stringify(gateOut.content));

	const prexOut = (await subagent.execute("qs-2", prepared(subagent, {
		prompt: "Queued setup probe. [seam:prex].",
		description: "queued setup probe",
		subagent_type: "explore",
		agentId: "prex",
		blockedBy: ["sgate"],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(prexOut.isError === true, false, JSON.stringify(prexOut.content));
	const prexRunId = prexOut.content[0]!.text.match(/agentId=prex runId=([^\s]+)/)![1]!;
	assert.ok(prexRunId.length > 0);

	// The dependent is accepted while prex is queued/reserved, so its transition to held
	// can only come from the failure's release repump — not from admission-time state.
	const depOut = (await subagent.execute("qs-3", prepared(subagent, {
		prompt: "Dependent work. [seam:predep].",
		description: "dependent",
		subagent_type: "explore",
		agentId: "predep",
		blockedBy: ["prex"],
		run_in_background: true,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(depOut.isError === true, false, JSON.stringify(depOut.content));
	const depRunId = depOut.content[0]!.text.match(/agentId=predep runId=([^\s]+)/)![1]!;

	// The no-spawn exit is an honest terminal delivered through the normal channel...
	await waitUntilTrue(
		() => Promise.resolve(sentMessages.some((line) => line.includes("[subagent-done]") && line.includes("agentId=prex "))),
		"prex's setup failure must reach the boss channel as a done receipt",
	);

	// ...and its reservation release must repump the dependent into exactly one genuine
	// held signal — never an eternal wait on a phantom running id.
	await waitUntilTrue(
		async () => /agentId=predep runId=[^\s]+ role=explore[^\n]*state=queued: held \(dependency prex did not succeed\)/.test(await statusText(status)),
		"predep must become held after prex's setup failure",
	);
	await waitUntilTrue(
		() => Promise.resolve(sentMessages.filter((line) => line.includes("agentId=predep") && line.includes("[subagent-blocked]")).length === 1),
		"exactly one blocked signal for predep",
	);

	// The freed id accepts an immediate redispatch (hook disarmed on first failure).
	const redispatch = (await subagent.execute("qs-4", prepared(subagent, {
		prompt: "Redispatch on freed id. [seam:prex].",
		description: "freed id",
		subagent_type: "explore",
		agentId: "prex",
		run_in_background: false,
	}), undefined, undefined, { cwd: tmpdir(), model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(redispatch.isError === true, false, JSON.stringify(redispatch.content));
	assert.match(redispatch.content[0]!.text, /fake-ok:prex/);

	// Hygiene: drop the held dependent so no queued leftover leaks into later tests.
	await abort.execute("qs-5", { agentId: "predep", runId: depRunId }, undefined, undefined, { cwd: tmpdir() });
});

after(async () => {
	const drained = await drainPipiuiTrackedChildren(250, 2_000);
	assert.deepEqual(drained.remainingPids, [], "all dispatch-seam worker children were reaped");
	rmSync(suiteMainCwd, { recursive: true, force: true });
});

// Sync fallback for abrupt runner exit; normal completion uses the awaited hook above.
process.on("exit", () => rmSync(suiteMainCwd, { recursive: true, force: true }));
