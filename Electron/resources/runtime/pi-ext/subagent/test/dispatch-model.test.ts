/**
 * Per-dispatch model pin regression tests.
 *
 * Covers: default inheritance unchanged (no model → role chain → session model), explicit
 * pin propagation through single / tasks[] / chain[] to the spawned child's --model arg,
 * loud rejection of invalid / unavailable / user-hidden pins (never silent substitution),
 * host-catalog visibility in the Boss routing block, pin-suppressed fallback advancement,
 * and actual-model observability on job records.
 *
 * Worker children execute the dedicated fake-pi-worker.ts fixture. The test suite itself is
 * never a child entry, so transport changes cannot recursively register these tests.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";

// Environment for the extension under test must exist BEFORE importing index.ts.
scrubSubagentRuntimeTestHostEnvironment();
process.env.PIPIUI_AGENT_DEPTH = "0"; // this suite IS the boss
process.env.PIPIUI_AGENT_TREE_DEPTH = "0";
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
// Hermetic model resolution: this dev process may have been launched by the PipiUI host with
// real PIPIUI_* env. Pin every default-resolution input to controlled fixtures BEFORE the
// module import so「跟随主」resolves from the suite, never from the developer's machine.
delete process.env.PIPIUI_MAIN_MODEL;
delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;

type RegisteredTool = {
	name: string;
	parameters: unknown;
	prepareArguments?: (args: unknown) => unknown;
	execute: (...args: never[]) => Promise<unknown>;
};

function createFakePi() {
	const tools = new Map<string, RegisteredTool>();
	const hooks = new Map<string, Array<(event: unknown) => unknown>>();
	const api = {
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		on(event: string, handler: (event: unknown) => unknown) {
			const list = hooks.get(event) ?? [];
			list.push(handler);
			hooks.set(event, list);
		},
		sendMessage() {},
		ui: { notify() {} },
	} as unknown as Parameters<Awaited<ReturnType<typeof loadExtension>>>[0];
	return { api, tools, hooks };
}

const CATALOG_A = "pinprov/model-alpha";
const CATALOG_B = "pinprov/model-beta";
const HIDDEN_REF = "pinprov/model-hidden";

/**
 * One shared suite root: index.ts captures PIPIUI_MAIN_CWD at import time, so every test
 * runs against the same isolated cwd. Per-test state resets below.
 */
const suiteMainCwd = mkdtempSync(join(tmpdir(), "dispatch-model-"));
mkdirSync(join(suiteMainCwd, ".pi"), { recursive: true });
process.env.PIPIUI_MAIN_CWD = suiteMainCwd;
process.env.PIPIUI_AGENTS_DIR = fileURLToPath(new URL("../../agents", import.meta.url));
process.env.PIPIUI_NODE_PATH = process.execPath;
process.env.PIPIUI_SUBAGENT_TEST_CHILD_ENTRY = fileURLToPath(new URL("./fake-pi-worker.ts", import.meta.url));
process.env.PIPIUI_WORKTREE = "0";
// Neutralize the host's real main-model.txt so frontmatter/session priorities are observable.
process.env.PIPIUI_MAIN_MODEL_FILE = join(suiteMainCwd, "no-such-main-model.txt");

function writeCatalogFile(): string {
	// v3 DISPLAY cache: presentation-only. Acceptance lives in the authority server above,
	// so this file only shapes what the Boss prompt advertises.
	const file = join(suiteMainCwd, `.catalog-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
	writeFileSync(file, JSON.stringify({
		version: 3,
		models: [
			{ id: CATALOG_A, name: "Alpha" },
			{ id: CATALOG_B, name: "Beta" },
		],
	}));
	return file;
}

/**
 * Deterministic stand-in for the backend's authoritative pin endpoint. Started BEFORE the
 * extension module is imported so index.ts captures the port/capability once. Every
 * validated batch must produce exactly ONE POST here sharing one linearization point.
 */
import http from "node:http";
type PinRequestRecord = { refs: unknown[]; capability: unknown; body: Record<string, unknown> };
const ALLOWED_PIN_REFS = new Set([CATALOG_A, CATALOG_B]);
let PIN_AUTHORITY_REVISION = 41;
const pinRequests: PinRequestRecord[] = [];
const resetPinRequests = () => { pinRequests.length = 0; };
const pinAuthorityServer = http.createServer((request, response) => {
	if (request.method !== "POST" || !request.url!.startsWith("/rpc")) {
		response.writeHead(404).end(); return;
	}
	const chunks: Buffer[] = [];
	request.on("data", (c: Buffer) => chunks.push(c));
	request.on("end", () => {
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
		const event = body.event as { refs?: unknown } | undefined;
		pinRequests.push({ refs: Array.isArray(event?.refs) ? event!.refs as unknown[] : [], capability: body.sessionCapability, body });
		if (body.schemaVersion !== 1 || body.sessionCapability !== "dispatch-model-fixture-capability") {
			response.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "unauthorized bridge capability" }));
			return;
		}
		if (body.action !== "model_pin_validate") {
			response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "unsupported action" }));
			return;
		}
		const refs = (event?.refs ?? []) as string[];
		for (let i = 0; i < refs.length; i++) {
			if (!ALLOWED_PIN_REFS.has(refs[i]!)) {
				response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
					schemaVersion: 1,
					decision: "deny",
					code: "model_unavailable",
					invalidIndex: i,
					authorityRevision: PIN_AUTHORITY_REVISION,
					retryable: false,
				}));
				return;
			}
		}
		response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
			schemaVersion: 1,
			decision: "allow",
			authorityRevision: PIN_AUTHORITY_REVISION,
		}));
	});
});
await new Promise<void>((resolve) => pinAuthorityServer.listen(0, "127.0.0.1", resolve));
const pinAuthorityPort = String((pinAuthorityServer.address() as { port: number }).port);
// The fixture holds a listening socket for the whole file: close it (and any keep-alive
// sockets fetch pooled) when the suite ends, or the node:test process never exits.
after(async () => {
	const drained = await drainPipiuiTrackedChildren(250, 2_000);
	assert.deepEqual(drained.remainingPids, [], "all dispatch-model worker children were reaped");
	(pinAuthorityServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
	await new Promise<void>((resolve) => pinAuthorityServer.close(() => resolve()));
	rmSync(suiteMainCwd, { recursive: true, force: true });
});
// Captured by index.ts at import time below.
process.env.PIPIUI_BRIDGE_PORT = pinAuthorityPort;
process.env.PIPIUI_HOST_PROTOCOL = "1";
process.env.PIPIUI_SESSION_CAPABILITY = "dispatch-model-fixture-capability";

const {
	default: loadExtension,
	resolveAgentModel,
	chainAdvanceEntryFor,
	dispatchModelPinSyntaxProblem,
	validateDispatchModelPinsViaHost,
	drainPipiuiTrackedChildren,
} = await import("../index.ts");

function resetSuiteEnv() {
	return () => {
		delete process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE;
		delete process.env.PIPIUI_SUBAGENT_MODELS_FILE;
	};
}

/** The routing block is the LAST registered before_agent_start handler in index.ts. */
function lastHandler(hooks: Map<string, Array<(event: unknown) => unknown>>, event: string): ((event: unknown) => unknown) | undefined {
	const list = hooks.get(event) ?? [];
	return list[list.length - 1];
}

/**
 * Faithful replica of pi-ai validateToolArguments' accept/reject decision: exactly what a
 * real provider call must pass BETWEEN prepareArguments and execute(). A raw Boss call is
 * sanitized first, then validated against the REAL registered TypeBox schema — the stage
 * whose root-required agentId used to kill every legitimate tasks[] wave before this suite
 * only ever inspected prepareArguments output.
 */
function realSchemaVerdict(tool: RegisteredTool, args: unknown): { ok: boolean; errors: string } {
	const clone = structuredClone(args);
	Value.Convert(tool.parameters as never, clone as never);
	const validator = Compile(tool.parameters as never);
	if (validator.Check(clone as never)) return { ok: true, errors: "" };
	return {
		ok: false,
		errors: validator.Errors(clone as never)
			.map((error) => `${error.path || "root"}: ${error.message}`)
			.join("; "),
	};
}

test("dispatch model pin syntax checks are pure; availability is decided by one batched authority RPC", async () => {
	// ── Pure syntax layer (no I/O, no RPC) ──
	assert.equal(dispatchModelPinSyntaxProblem(CATALOG_B), undefined);
	assert.equal(dispatchModelPinSyntaxProblem(`  ${CATALOG_A}  `), undefined);

	// bare id: no provider
	const bare = dispatchModelPinSyntaxProblem("just-a-bare-id");
	assert.match(bare!, /provider\/modelId|provider/);

	// Pi shorthand suffix must go through the thinking field instead
	assert.match(dispatchModelPinSyntaxProblem(`${CATALOG_A}:high`)!, /thinking/);

	// whitespace/control junk, wrong types, empty
	assert.match(dispatchModelPinSyntaxProblem(`${CATALOG_A}\nextra`)!, /空白或控制/);
	assert.match(dispatchModelPinSyntaxProblem(42)!, /必须是字符串/);
	assert.match(dispatchModelPinSyntaxProblem("")!, /不能为空/);

	resetPinRequests();
	// A syntax-invalid pin never reaches the host authority.
	const syntacticBatch = await validateDispatchModelPinsViaHost([
		{ label: "model", model: CATALOG_A },
		{ label: "tasks[0].model", model: 42 },
	]);
	assert.equal(syntacticBatch.ok, false);
	assert.match(syntacticBatch.ok ? "" : syntacticBatch.problem, /tasks\[0\]\.model/);
	assert.equal(pinRequests.length, 0, "no RPC for a locally-rejected pin");

	// ── Authority layer through ONE real HTTP round trip ──
	resetPinRequests();
	const batch = await validateDispatchModelPinsViaHost([
		{ label: "model", model: CATALOG_A },
		{ label: "tasks[1].model", model: CATALOG_B },
	]);
	assert.equal(batch.ok, true);
	assert.deepEqual([...batch.pins.keys()].sort(), [CATALOG_A, CATALOG_B].sort());
	for (const pin of batch.pins.values()) {
		assert.equal(typeof pin.authorityRevision, "number");
	}
	const revisions = new Set([...batch.pins.values()].map((p) => p.authorityRevision));
	assert.equal(revisions.size, 1, "all pins share one linearization point / revision");
	assert.equal(pinRequests.length, 1, "exactly one RPC for the whole batch");
	// Wire contract leaks nothing: refs + capability + action only.
	assert.deepEqual(Object.keys(pinRequests[0]!.body).sort(), ["action", "event", "schemaVersion", "sessionCapability"]);
	assert.deepEqual(pinRequests[0]!.refs.sort(), [...ALLOWED_PIN_REFS].sort());

	// An absent ref → logical model_unavailable deny naming the first invalid index;
	// the WHOLE wave fails closed before anything spawns.
	resetPinRequests();
	const denied = await validateDispatchModelPinsViaHost([
		{ label: "model", model: HIDDEN_REF },
		{ label: "tasks[2].model", model: CATALOG_A },
	]);
	assert.equal(denied.ok, false);
	assert.match(denied.ok ? "" : denied.problem, /model_unavailable/);
	assert.match(denied.ok ? "" : denied.problem, /pinprov\/model-hidden/);
	assert.match(denied.ok ? "" : denied.problem, /未启动/);
	assert.equal(pinRequests.length, 1);
});

test("resolveAgentModel priority: pin > role override > session model > frontmatter; without a pin nothing changes", () => {
	const overridesFile = join(suiteMainCwd, "role-overrides-fixture.json");
	writeFileSync(overridesFile, JSON.stringify({
		explore: { models: [{ model: "roleprov/rolemain", thinking: "low" }] },
	}));
	process.env.PIPIUI_SUBAGENT_MODELS_FILE = overridesFile;
	try {
		// Explicit pin wins over everything else for exactly that resolution.
		assert.equal(resolveAgentModel("explore", "front/fm", "sess/sm", CATALOG_A), CATALOG_A);
		// Without a pin: persisted role override beats session/frontmatter (unchanged behavior).
		assert.equal(resolveAgentModel("explore", "front/fm", "sess/sm"), "roleprov/rolemain");
		// No override configured → current session model at depth 0.
		assert.equal(resolveAgentModel("general-purpose", "front/fm", "sess/sm"), "sess/sm");
		// No override, no session → frontmatter fallback survives.
		assert.equal(resolveAgentModel("general-purpose", "front/fm", undefined), "front/fm");
	} finally {
		rmSync(overridesFile, { force: true });
		resetSuiteEnv()();
	}
});

test("chainAdvanceEntryFor: a pinned dispatch never advances the persisted fallback chain", () => {
	const overridesFile = join(suiteMainCwd, "chain-overrides-fixture.json");
	writeFileSync(overridesFile, JSON.stringify({
		generalPurposeChainProbe: {
			models: [
				{ model: "primary/one" },
				{ model: "fallback/two" },
			],
		},
	}));
	process.env.PIPIUI_SUBAGENT_MODELS_FILE = overridesFile;
	try {
		const unpinned = chainAdvanceEntryFor(undefined, "generalPurposeChainProbe", 1);
		assert.ok(unpinned, "unpinned dispatch keeps the documented chain fallback");
		assert.equal(unpinned!.model, "fallback/two");
		assert.equal(chainAdvanceEntryFor(undefined, "generalPurposeChainProbe", 2), undefined, "past-the-end stays undefined");

		// Pinned: quota/stall paths must NOT switch models — same pinned model retried within
		// resume budgets, then a loud failure. Never a silent downgrade to another model.
		assert.equal(chainAdvanceEntryFor(CATALOG_A, "generalPurposeChainProbe", 1), undefined);
	} finally {
		rmSync(overridesFile, { force: true });
		resetSuiteEnv()();
	}
});

test("boss routing block lists the canonical available models and drops the section without a catalog", async () => {
	const cleanup = resetSuiteEnv();
	const { api, tools, hooks } = createFakePi();
	await loadExtension(api);
	assert.ok(tools.get("subagent"), "subagent tool registered");
	const handler = lastHandler(hooks, "before_agent_start");
	assert.ok(handler, "before_agent_start hook registered");

	const catalogFile = writeCatalogFile();
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = catalogFile;
	try {
		const result = handler({ systemPrompt: "BASE PROMPT" }) as { systemPrompt?: string };
		assert.ok(result?.systemPrompt?.startsWith("BASE PROMPT"));
		assert.match(result.systemPrompt!, /\[Subagent model routing — hot-read\]/);
		assert.match(result.systemPrompt!, /Available models/);
		assert.ok(result.systemPrompt!.includes(CATALOG_A), "catalog ref A visible to the Boss");
		assert.ok(result.systemPrompt!.includes(CATALOG_B), "catalog ref B visible to the Boss");
		assert.doesNotMatch(result.systemPrompt!, /no per-task model/, "stale v1 contract text is gone");
		assert.match(result.systemPrompt!, /per-dispatch `model`|per-dispatch model/);
	} finally {
		rmSync(catalogFile, { force: true });
		delete process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE;
	}

	// Catalog missing → old routing block shape, no model-list section (the guidance sentence
	// mentions Available models, so anchor on the list header itself).
	const withoutCatalog = handler({ systemPrompt: "BASE PROMPT" }) as { systemPrompt?: string };
	assert.ok(withoutCatalog?.systemPrompt);
	assert.doesNotMatch(withoutCatalog.systemPrompt!, /Available models \(exact/);
	cleanup();
});

test("registered seam: valid pin reaches the child's --model; invalid pins are rejected loudly with zero spawns", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const prepared = subagent.prepareArguments!({
		prompt: "Pinned work. [dm:single-pin]",
		description: "pinned work",
		subagent_type: "explore",
		agentId: "single-pin",
		run_in_background: false,
		model: CATALOG_A,
	});
	const out = (await subagent.execute("t-single-pin", prepared, undefined, undefined, {
		cwd: suiteMainCwd,
		model: { provider: "ctxprov", id: "ctx-unpinned" },
	})) as { content: Array<{ type: string; text: string }>; details?: { results?: Array<{ model?: string }> }; isError?: boolean };
	assert.equal(out.isError === true, false, out.content?.[0]?.text);
	assert.match(out.content[0]!.text, /model=pinprov\/model-alpha/, "child received the pinned --model");
	assert.equal(out.details?.results?.[0]?.model, CATALOG_A, "result records the actual pinned model");
});

test("single dispatch: without model, the worker follows the current session model exactly as before", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const prepared = subagent.prepareArguments!({
		prompt: "Default work. [dm:default-follow]",
		description: "default follow",
		subagent_type: "explore",
		agentId: "default-follow",
		background: false,
	});
	const out = (await subagent.execute("t-default", prepared, undefined, undefined, {
		cwd: suiteMainCwd,
		model: { provider: "sessionprov", id: "session-main" },
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(out.isError === true, false, out.content?.[0]?.text);
	assert.match(out.content[0]!.text, /model=sessionprov\/session-main/, "unchanged inheritance follows ctx.model");
});

test("rejected pins: bare id, absent/hidden ref fail closed before any spawn; RPC count proves it", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;

	const syntaxCases: Array<{ name: string; model?: unknown; match: RegExp }> = [
		{ name: "bare id", model: "bare-no-provider", match: /provider\/modelId|完整标识/ },
		{ name: "empty string", model: "   ", match: /不能为空/ },
	];
	for (const [i, c] of syntaxCases.entries()) {
		resetPinRequests();
		const prepared = subagent.prepareArguments!({
			prompt: `Rejected ${c.name}. [dm:reject-${i}]`,
			description: "reject probe",
			subagent_type: "explore",
			agentId: `reject-${i}`,
			...(c.model === undefined ? {} : { model: c.model as string }),
		});
		const out = (await subagent.execute(`t-reject-${i}`, prepared, undefined, undefined, {
			cwd: suiteMainCwd,
			model: { provider: "x", id: "y" },
		})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
		assert.equal(out.isError, true, `${c.name} must be rejected`);
		assert.match(out.content[0]!.text, c.match, `${c.name}: actionable error`);
		assert.equal(pinRequests.length, 0, `${c.name}: locally rejected without any authority traffic`);
	}

	// Availability denial comes from the AUTHORITY now, not the display file: the hidden
	// ref clears syntax, reaches one batched RPC, and is denied with its index named.
	resetPinRequests();
	const prepared = subagent.prepareArguments!({
		prompt: "Hidden ref. [dm:reject-hidden]",
		description: "hidden ref",
		subagent_type: "explore",
		agentId: "reject-hidden",
		model: HIDDEN_REF,
	});
	const hiddenOut = (await subagent.execute("t-reject-hidden", prepared, undefined, undefined, {
		cwd: suiteMainCwd,
		model: { provider: "x", id: "y" },
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(hiddenOut.isError, true);
	assert.match(hiddenOut.content[0]!.text, /model_unavailable/);
	assert.equal(pinRequests.length, 1, "exactly one batched RPC for the availability check");
});

test("parallel tasks[]: two different pinned models run side by side via the REAL strict schema", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;

	// The schema must actually DECLARE tasks (with per-item model), otherwise the sanitizer
	// silently drops it before execute — the exact gap this suite guards against.
	const props = ((subagent.parameters as { properties?: Record<string, unknown> }).properties ?? {});
	assert.ok(props.tasks, "subagent single schema must declare tasks[] for Boss parallel mode");
	const taskItemProps = ((props.tasks as { items?: { properties?: Record<string, unknown> } }).items?.properties ?? {});
	assert.ok(taskItemProps.model, "tasks[] items must declare model");

	// Route a two-model parallel wave through prepareArguments exactly like pi does: unknown
	// keys per item must be dropped while prompt/task alias and model survive. The RAW call
	// carries NO single-only root field (no prompt/description/agentId) plus junk at both
	// levels, so everything below depends on the strict sanitizer doing its job.
	const prepared = subagent.prepareArguments!({
		junkTopLevel: true,
		tasks: [
			{ prompt: "Batch A [dm:batch-a]", description: "batch a", subagent_type: "explore", agentId: "batch-a", background: false, model: CATALOG_B, junkField: true },
			{ prompt: "Batch B [dm:batch-b]", description: "batch b", subagent_type: "explore", agentId: "batch-b", background: false, model: CATALOG_A },
		],
		background: false,
	}) as { tasks?: Array<{ model?: string; task?: string; agentId?: string; junkField?: boolean }> } & Record<string, unknown>;
	assert.equal(prepared.tasks?.length, 2, "declared tasks[] survives the strict sanitizer");
	assert.equal("junkField" in (prepared.tasks![0] ?? {}), false, "unknown keys inside items are dropped");
	assert.equal("junkTopLevel" in prepared, false, "unknown ROOT keys are dropped too");

	// THE regression gate the reviewer demanded: the PREPARED call must clear the REAL
	// registered schema (pi validates here, before execute()). With root agentId still
	// schema-required this assertion failed even though execute() worked — the exact gap
	// that blocked live Boss tasks[] calls.
	const verdict = realSchemaVerdict(subagent, prepared);
	assert.equal(verdict.ok, true, `prepared tasks-only call must pass REAL schema validation: ${verdict.errors}`);

	assert.ok(prepared.tasks!.every((item) => typeof item.task === "string" && item.task.length > 0), "prompt fills the internal task field per item");
	assert.deepEqual(prepared.tasks!.map((t) => t.model), [CATALOG_B, CATALOG_A], "per-item model pins survive sanitization");

	const batchOut = (await subagent.execute("t-par-batch", prepared, undefined, undefined, {
		cwd: suiteMainCwd,
		model: undefined,
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean; details?: { results?: Array<{ model?: string }> } };
	assert.equal(batchOut.isError === true, false, batchOut.content?.[0]?.text);
	const batchText = batchOut.details?.results?.map((r) => r.model).join(",") ?? "";
	assert.ok(batchText.includes(CATALOG_B) && batchText.includes(CATALOG_A), `both pins recorded: ${batchText}`);
	assert.match(batchOut.content[0]!.text, /model=pinprov\/model-beta[\s\S]*model=pinprov\/model-alpha|model=pinprov\/model-alpha[\s\S]*model=pinprov\/model-beta/);

	// Mixing modes is rejected by the runtime gate even though the schema now allows both.
	const mixedPrepared = subagent.prepareArguments!({
		prompt: "Single mode too.",
		description: "mixed modes",
		agentId: "mixed",
		tasks: [{ agent: "explore", task: "Task mode [dm:mixed]", agentId: "mixed-task" }],
	});
	const mixed = (await subagent.execute("t-mixed", mixedPrepared, undefined, undefined, { cwd: suiteMainCwd, model: undefined })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.match(mixed.content[0]!.text, /exactly one mode/i);
});

test("bare tasks[] wave with NO single fields clears the REAL schema and both item pins enter spawn", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;

	// Exactly what the Boss emits for a legal parallel fan-out in the declared internal
	// spelling: per-item task/agentId/model and NOT ONE single-only root field. Before the
	// root-agentId fix this call died in schema validation and never reached execute().
	const raw = {
		tasks: [
			{ task: "Wave left. [dm:bare-left]", agentId: "bare-left", model: CATALOG_A },
			{ task: "Wave right. [dm:bare-right]", agentId: "bare-right", model: CATALOG_B },
		],
		run_in_background: false,
	};
	const prepared = subagent.prepareArguments!(raw) as Record<string, unknown>;
	const bareVerdict = realSchemaVerdict(subagent, prepared);
	assert.equal(bareVerdict.ok, true, `bare tasks[] wave must pass REAL schema validation: ${bareVerdict.errors}`);

	// ctx.model is the session default both workers are pinned AWAY from: seeing it below
	// would mean the pins were lost; seeing the two distinct pins means each entered spawn.
	const out = (await subagent.execute("t-bare", prepared, undefined, undefined, {
		cwd: suiteMainCwd,
		model: { provider: "bossprov", id: "boss-default" },
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(out.isError === true, false, out.content?.[0]?.text);
	const text = out.content.map((c) => c.text).join("\n");
	assert.match(text, /model=pinprov\/model-alpha/, "item 0's pin reached its child --model argv");
	assert.match(text, /model=pinprov\/model-beta/, "item 1's DIFFERENT pin reached its child --model argv");
});

test("tasks items stay strictly identified: missing item agentId or empty array fails REAL validation before execute", async () => {
	const cleanup = resetSuiteEnv();
	try {
		process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
		const { api, tools } = createFakePi();
		await loadExtension(api);
		const subagent = tools.get("subagent")!;

		// An item without its own agentId never sneaks through: the failure happens at schema
		// level with the offending path named.
		const noId = subagent.prepareArguments!({ tasks: [{ task: "No identity here." }] }) as unknown;
		const noIdVerdict = realSchemaVerdict(subagent, noId);
		assert.equal(noIdVerdict.ok, false, "task item without agentId must fail REAL schema validation");
		assert.match(noIdVerdict.errors, /tasks.*agentId|agentId/, "error names the required path");

		// minItems stays enforced on the declared array.
		const emptyTasks = subagent.prepareArguments!({ tasks: [] }) as unknown;
		assert.equal(realSchemaVerdict(subagent, emptyTasks).ok, false, "tasks[] minItems enforced by the real schema");
	} finally {
		cleanup();
	}
});

test("exactly-one-mode gate: schema-legal but illegal empty / id-less / mixed calls are rejected by name", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const ctx = { cwd: suiteMainCwd, model: undefined };

	async function expectNamedRejection(label: string, raw: Record<string, unknown>, match: RegExp): Promise<void> {
		const prepared = subagent.prepareArguments!(raw) as Record<string, unknown>;
		// These shapes must clear REAL validation (that is why they cannot be blocked at the
		// schema in a union-of-modes tool) — only to be rejected by the runtime gates.
		const verdict = realSchemaVerdict(subagent, prepared);
		assert.equal(verdict.ok, true, `${label}: expected REAL-schema acceptance first, got ${verdict.errors}`);
		const out = (await subagent.execute(`t-mode-${label}`, prepared, undefined, undefined, ctx)) as {
			content: Array<{ type: string; text: string }>;
			isError?: boolean;
		};
		assert.equal(out.isError, true, `${label} must be rejected`);
		assert.match(out.content[0]!.text, match, `${label}: error must name the problem`);
	}

	// Empty call: zero modes detected, guidance names what a single dispatch needs.
	await expectNamedRejection("empty", {}, /exactly one mode/i);

	// Single missing its identity: schema can no longer catch it (root agentId is optional so
	// tasks[] mode fits), so the runtime identity gate names the miss instead of spawning.
	await expectNamedRejection("single-no-id", {
		prompt: "Solo work. [dm:solo-x]",
		description: "solo work",
		subagent_type: "explore",
	}, /Missing agentId for this dispatch/);

	// Mixed modes stay mutually exclusive even though every field is individually optional.
	await expectNamedRejection("mixed", {
		prompt: "Single mode too.",
		description: "mixed modes",
		agentId: "mode-mixed",
		tasks: [{ task: "Task mode [dm:mixed-t]", agentId: "mode-mixed-task" }],
	}, /exactly one mode/i);
});

test("chain[]: step-level pins propagate down the ordered steps", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const chainTool = tools.get("subagent_chain")!;
	assert.ok(chainTool, "subagent_chain registered");
	const prepared = chainTool.prepareArguments!({
		chain: [
			{
				prompt: "First step. [dm:step-one]",
				description: "first step",
				subagent_type: "explore",
				agentId: "step-one",
				model: CATALOG_B,
			},
			{
				prompt: "Second step. {previous} [dm:step-two]",
				description: "second step",
				subagent_type: "explore",
				agentId: "step-two",
				model: CATALOG_A,
			},
		],
	});
	const out = (await chainTool.execute("t-chain", prepared, undefined, undefined, {
		cwd: suiteMainCwd,
		model: { provider: "nono", id: "nope" },
	})) as { content: Array<{ type: string; text: string }>; details?: { results?: Array<{ model?: string }> }; isError?: boolean };
	assert.equal(out.isError === true, false, out.content?.[0]?.text);
	const models = out.details?.results?.map((r) => r.model) ?? [];
	assert.deepEqual(models, [CATALOG_B, CATALOG_A], `each step kept its own pin: ${models.join(",")}`);
});

test("job status records the actual started model for a pinned run", async (t) => {
	const cleanup = resetSuiteEnv();
	t.after(() => cleanup());
	process.env.PIPIUI_SUBAGENT_MODEL_CATALOG_FILE = writeCatalogFile();
	const { api, tools } = createFakePi();
	await loadExtension(api);
	const subagent = tools.get("subagent")!;
	const status = tools.get("subagent_status")!;
	// Background dispatch so we can inspect the RUNNING record mid-flight.
	const prepared = subagent.prepareArguments!({
		prompt: "Status model probe. [dm:status-m]",
		description: "status model",
		subagent_type: "explore",
		agentId: "status-m",
		run_in_background: true,
		model: CATALOG_A,
	});
	const receipt = (await subagent.execute("t-status-m", prepared, undefined, undefined, {
		cwd: suiteMainCwd,
		model: { provider: "boss", id: "bossmodel" },
	})) as { content: Array<{ type: string; text: string }>; isError?: boolean };
	assert.equal(receipt.isError === true, false, receipt.content?.[0]?.text);
	const runId = receipt.content[0]!.text.match(/agentId=status-m runId=([^\s]+)/)![1]!;
	// The per-job view (status by agentId) must expose the actual started model — while
	// running AND after terminal finalize. The pinned model, never the Boss session model.
	let sawPinned = false;
	for (let i = 0; i < 50 && !sawPinned; i++) {
		const listing = (await status.execute(`t-status-${i}`, omitNullsClone({ agentId: "status-m" }), undefined, undefined, {
			cwd: suiteMainCwd,
			model: undefined,
		})) as { content: Array<{ type: string; text: string }> };
		sawPinned = listing.content.some((c) => c.type === "text"
			&& c.text.includes(`runId: ${runId}`)
			&& c.text.includes(`model: ${CATALOG_A}`));
		if (!sawPinned) await new Promise((r) => setTimeout(r, 100));
	}
	assert.ok(sawPinned, "subagent_status shows the actual started model for the pinned run");
});

/** Local clone helper mirroring omitNulls so this suite has no cross-import surprises. */
function omitNullsClone(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined));
}

test("model switches re-point the live job record (actual-model observability)", async () => {
	const source = await import("node:fs/promises").then((m) =>
		m.readFile(new URL("../index.ts", import.meta.url), "utf8"),
	);
	// Both real switch sites (provider-stall resume + quota/retry fallback) must update the
	// running job's model so subagent_status reports the model the run actually uses now.
	const stallSite = source.slice(
		source.indexOf('const stallChainEntry = chainAdvanceEntryFor'),
		source.indexOf('autoResumeCount = 0; // the new model gets its own same-model resume budget'),
	);
	assert.match(stallSite, /jobPatchModel\(pipiuiAgentId, runId, currentResult\.model\)/);
	const quotaSite = source.slice(
		source.indexOf('if (fallbackReason && nextChainEntry) {'),
		source.indexOf('autoResumeCount = 0; // the new model gets its own same-model resume budget', source.indexOf('if (fallbackReason && nextChainEntry) {')),
	);
	assert.match(quotaSite, /jobPatchModel\(pipiuiAgentId, runId, currentResult\.model\)/);
});
