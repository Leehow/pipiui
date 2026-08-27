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
async function runFakeWorkerChild(): Promise<never> {
	const argv = process.argv;
	const prompt = argv[argv.length - 1] ?? "";
	const sessionIdArg = argv.find((value) => value.startsWith("pipiui-")) ?? "";
	const fromSession = sessionIdArg.replace(/^pipiui-/, "");
	const marker = prompt.match(/\[seam:([a-z0-9_-]+?)(?::([a-z]+))?\]/);
	const agentId = fromSession || marker?.[1] || "unknown";
	const mode = marker?.[2] ?? "ok";
	const line = (event: unknown) => process.stdout.write(JSON.stringify(event) + "\n");
	line({ type: "session_start", cwd: process.cwd() });
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

if (
	process.argv.includes("-p")
	&& process.argv.includes("--mode")
	&& process.argv.includes("json")
) {
	await runFakeWorkerChild();
}

import { sanitizeStrictToolArguments } from "../strict-json-schema.ts";

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
	const api = {
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, definition: { description: string; handler: (args: string, ctx: unknown) => unknown }) {
			commands.set(name, definition);
		},
		on() {},
		sendMessage() {},
		ui: {
			notify: (text: string, kind: string) => notifications.push({ text, kind }),
		},
	} as unknown as FakeExtensionAPI;
	return { api, tools, commands, notifications };
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


// Suite-root teardown: prove every real spawned worker exited before removing its state.
after(async () => {
	const drained = await drainPipiuiTrackedChildren(250, 2_000);
	assert.deepEqual(drained.remainingPids, [], "all dispatch-seam worker children were reaped");
	rmSync(suiteMainCwd, { recursive: true, force: true });
});

// Sync fallback for abrupt runner exit; normal completion uses the awaited hook above.
process.on("exit", () => rmSync(suiteMainCwd, { recursive: true, force: true }));
