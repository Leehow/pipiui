import test from "node:test";
import assert from "node:assert/strict";

import {
	createJobSnapshot,
	createSupervisorEvent,
	type ContractResult,
	type SupervisorEvent,
	type SupervisorInputPacket,
} from "../supervisor/contract.ts";
import {
	SUPERVISOR_NO_TOOLS,
	SUPERVISOR_SYSTEM_PROMPT,
	SUPERVISOR_THINKING_LEVEL,
	SupervisorSessionRuntimeError,
	countActiveSupervisorJobs,
	createSupervisorSessionRuntime,
	isAbnormalTerminalSupervisorPacket,
	resolveSupervisorModelRef,
	serializeSupervisorInputPacket,
	supervisorProjectScopedPath,
	type SupervisorPiCreateOptions,
	type SupervisorPiSessionFactory,
	type SupervisorPiSessionHandle,
} from "../supervisor/session-runtime.ts";

function unwrap<T>(result: ContractResult<T>, label: string): T {
	assert.equal(result.ok, true, `${label}: ${result.ok ? "" : result.error}`);
	return result.value;
}

function heartbeatEvent(sequence = 1): SupervisorEvent {
	return unwrap(createSupervisorEvent({
		kind: "heartbeat",
		agentId: "worker-a",
		runId: "run-1",
		sequence,
		occurredAt: 1_700_000_000_000 + sequence,
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "running",
			title: "scan workspace",
			elapsedMs: 30_000,
			lastActivityAt: 1_700_000_000_000,
		}), "job"),
		summary: "idle 30s last=read",
	}), "heartbeat");
}

function packetFor(event: SupervisorEvent, active = true): SupervisorInputPacket {
	return {
		event,
		activeJobs: [
			active
				? event.job
				: unwrap(createJobSnapshot({
					agentId: event.job.agentId,
					runId: event.job.runId,
					status: "completed",
				}), "done-job"),
		],
		tasks: [],
	};
}

interface FakeFactory extends SupervisorPiSessionFactory {
	readonly createCount: number;
	readonly promptCount: number;
	readonly disposeCount: number;
	readonly abortCount: number;
	readonly prompts: readonly string[];
	readonly created: readonly SupervisorPiCreateOptions[];
	readonly handles: readonly SupervisorPiSessionHandle[];
	maxInFlight: number;
}

function createFakeFactory(options: {
	reply?: string | ((prompt: string) => string | Promise<string>);
	createError?: Error;
	promptError?: Error;
	delayMs?: number;
	onPromptStart?: () => void | Promise<void>;
} = {}): FakeFactory {
	const created: SupervisorPiCreateOptions[] = [];
	const handles: SupervisorPiSessionHandle[] = [];
	const prompts: string[] = [];
	let createCount = 0;
	let promptCount = 0;
	let disposeCount = 0;
	let abortCount = 0;
	let inFlight = 0;
	let maxInFlight = 0;

	return {
		get createCount() {
			return createCount;
		},
		get promptCount() {
			return promptCount;
		},
		get disposeCount() {
			return disposeCount;
		},
		get abortCount() {
			return abortCount;
		},
		get prompts() {
			return prompts;
		},
		get created() {
			return created;
		},
		get handles() {
			return handles;
		},
		get maxInFlight() {
			return maxInFlight;
		},
		set maxInFlight(value) {
			maxInFlight = value;
		},
		async create(opts) {
			if (options.createError) throw options.createError;
			createCount += 1;
			created.push(opts);
			const handle: SupervisorPiSessionHandle = {
				sessionId: `sup-${createCount}`,
				async prompt(text) {
					options.onPromptStart?.();
					inFlight += 1;
					maxInFlight = Math.max(maxInFlight, inFlight);
					promptCount += 1;
					prompts.push(text);
					try {
						if (options.delayMs) {
							await new Promise((resolve) => setTimeout(resolve, options.delayMs));
						}
						if (options.promptError) throw options.promptError;
						const reply = options.reply;
						if (typeof reply === "function") return await reply(text);
						return reply ?? '{"action":"status"}';
					} finally {
						inFlight -= 1;
					}
				},
				dispose() {
					disposeCount += 1;
				},
				abort() {
					abortCount += 1;
				},
			};
			handles.push(handle);
			return handle;
		},
	};
}

test("zero active workers creates no session and issues no provider request", async () => {
	const factory = createFakeFactory();
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { boss: "anthropic/claude-haiku-4" },
	});

	await runtime.setActiveWorkerCount(0);
	await assert.rejects(
		() => runtime.prompt(packetFor(heartbeatEvent(), false)),
		(error: unknown) => {
			assert.ok(error instanceof SupervisorSessionRuntimeError);
			assert.equal(error.code, "no_active_workers");
			return true;
		},
	);

	assert.equal(factory.createCount, 0);
	assert.equal(factory.promptCount, 0);
	assert.equal(runtime.sessionCreateCount, 0);
	assert.equal(runtime.providerRequestCount, 0);
	assert.equal(runtime.isSessionOpen, false);
});

test("only an abnormal terminal packet may open a one-shot zero-active session", async () => {
	const factory = createFakeFactory({
		reply: '{"action":"escalate","reason":"aborted after SIGTERM","recommendedAction":"Boss should inspect and explicitly redispatch"}',
	});
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { supervisor: "openai-codex/gpt-5.6-luna" },
	});
	const abnormalEvent = unwrap(createSupervisorEvent({
		kind: "wave",
		agentId: "wave",
		runId: "wave-aborted",
		waveId: "wave-aborted",
		sequence: 1,
		occurredAt: 1_700_000_000_100,
		job: unwrap(createJobSnapshot({ agentId: "wave", runId: "wave-aborted", status: "completed" }), "wave-job"),
		summary: "wave closed completed=3 failed=1",
		wave: { waveId: "wave-aborted", running: 0, completed: 3, failed: 1, agentIds: ["worker-a"] },
		evidenceRefs: ["artifact://status/worker-a/run-1"],
	}), "abnormal-wave");
	const abnormalPacket: SupervisorInputPacket = { event: abnormalEvent, activeJobs: [], tasks: [] };

	assert.equal(isAbnormalTerminalSupervisorPacket(abnormalPacket), true);
	const decision = await runtime.prompt(abnormalPacket);
	assert.equal(decision.action, "escalate");
	assert.equal(factory.createCount, 1);
	assert.equal(factory.promptCount, 1);
	assert.equal(factory.disposeCount, 1);
	assert.equal(runtime.isSessionOpen, false);

	const normalEvent = unwrap(createSupervisorEvent({
		kind: "wave",
		agentId: "wave",
		runId: "wave-ok",
		sequence: 1,
		occurredAt: 1_700_000_000_101,
		job: unwrap(createJobSnapshot({ agentId: "wave", runId: "wave-ok", status: "completed" }), "normal-wave-job"),
		summary: "wave closed completed=4 failed=0",
		wave: { waveId: "wave-ok", running: 0, completed: 4, failed: 0, agentIds: ["worker-b"] },
		waveId: "wave-ok",
	}), "normal-wave");
	assert.equal(isAbnormalTerminalSupervisorPacket({ event: normalEvent, activeJobs: [], tasks: [] }), false);
	await assert.rejects(
		() => runtime.prompt({ event: normalEvent, activeJobs: [], tasks: [] }),
		(error: unknown) => error instanceof SupervisorSessionRuntimeError && error.code === "no_active_workers",
	);
	assert.equal(factory.createCount, 1, "normal zero-active wave stays provider-free");
});

test("a hung prompt times out, aborts best effort, and a future epoch can reopen", async () => {
	let promptNumber = 0;
	const never = new Promise<string>(() => undefined);
	const factory = createFakeFactory({
		reply: () => {
			promptNumber += 1;
			return promptNumber === 1 ? never : '{"action":"status"}';
		},
	});
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { supervisor: "openai-codex/gpt-5.6-luna" },
		promptTimeoutMs: 10,
	});
	await runtime.setActiveWorkerCount(1);
	await assert.rejects(
		() => runtime.prompt(packetFor(heartbeatEvent(1))),
		(error: unknown) => error instanceof SupervisorSessionRuntimeError && error.code === "prompt_timeout",
	);
	assert.equal(factory.abortCount, 1);
	assert.equal(runtime.isSessionOpen, false);

	const next = await runtime.prompt(packetFor(heartbeatEvent(2)));
	assert.equal(next.action, "status");
	assert.equal(factory.createCount, 2);
	assert.equal(runtime.epochGeneration, 2);
});

test("first active event lazily creates one session and later events reuse it", async () => {
	const factory = createFakeFactory();
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { generalPurpose: "openai/gpt-4.1-mini" },
	});

	await runtime.setActiveWorkerCount(1);
	const first = await runtime.prompt(packetFor(heartbeatEvent(1)));
	const second = await runtime.prompt(packetFor(heartbeatEvent(2)));

	assert.equal(first.action, "status");
	assert.equal(second.action, "status");
	assert.equal(factory.createCount, 1);
	assert.equal(factory.promptCount, 2);
	assert.equal(factory.handles.length, 1);
	assert.equal(runtime.epochGeneration, 1);
	assert.equal(runtime.isSessionOpen, true);
	assert.equal(factory.created[0]?.model, "openai/gpt-4.1-mini");
	assert.equal(factory.created[0]?.thinkingLevel, SUPERVISOR_THINKING_LEVEL);
	assert.deepEqual(factory.created[0]?.tools, []);
	assert.deepEqual(factory.created[0]?.customTools, []);
	assert.equal(factory.created[0]?.noTools, SUPERVISOR_NO_TOOLS);
	assert.equal(factory.created[0]?.projectScopedPath, supervisorProjectScopedPath("/tmp/pipiui-supervisor-s2"));
});

test("concurrent prompts are serialized onto one AgentSession", async () => {
	const factory = createFakeFactory({
		delayMs: 20,
		reply: '{"action":"wait"}',
	});
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { boss: "google/gemini-2.5-flash" },
	});

	await runtime.setActiveWorkerCount(2);
	const results = await Promise.all([
		runtime.prompt(packetFor(heartbeatEvent(1))),
		runtime.prompt(packetFor(heartbeatEvent(2))),
		runtime.prompt(packetFor(heartbeatEvent(3))),
	]);

	assert.deepEqual(results.map((item) => item.action), ["wait", "wait", "wait"]);
	assert.equal(factory.createCount, 1);
	assert.equal(factory.promptCount, 3);
	assert.equal(factory.maxInFlight, 1);
});

test("draining workers disposes the epoch and the next epoch gets a new session", async () => {
	const factory = createFakeFactory();
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { supervisor: "anthropic/claude-haiku-4" },
	});

	let releasePrompt!: () => void;
	const started = Promise.withResolvers<void>();
	const blocked = new Promise<void>((resolve) => {
		releasePrompt = resolve;
	});
	const blockingFactory = createFakeFactory({
		reply: async () => {
			started.resolve();
			await blocked;
			return '{"action":"status"}';
		},
	});
	const blockingRuntime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory: blockingFactory,
		models: { supervisor: "anthropic/claude-haiku-4" },
	});

	await blockingRuntime.setActiveWorkerCount(1);
	const inFlight = blockingRuntime.prompt(packetFor(heartbeatEvent(1)));
	await started.promise;
	const drain = blockingRuntime.setActiveWorkerCount(0);
	assert.equal(blockingFactory.disposeCount, 0);
	releasePrompt();
	await inFlight;
	await drain;
	assert.equal(blockingFactory.disposeCount, 1);
	assert.equal(blockingRuntime.isSessionOpen, false);

	await runtime.setActiveWorkerCount(1);
	await runtime.prompt(packetFor(heartbeatEvent(1)));
	const firstHandle = factory.handles[0];
	await runtime.setActiveWorkerCount(0);
	assert.equal(factory.disposeCount, 1);
	assert.equal(runtime.isSessionOpen, false);

	await runtime.setActiveWorkerCount(2);
	await runtime.prompt(packetFor(heartbeatEvent(2)));
	assert.equal(factory.createCount, 2);
	assert.equal(runtime.epochGeneration, 2);
	assert.notEqual(factory.handles[1], firstHandle);
	assert.equal(runtime.isSessionOpen, true);
});

test("model sources are resolved when each epoch is created and never hot-swap an open session", async () => {
	const factory = createFakeFactory();
	let selected = "openai-codex/gpt-5.6-sol";
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: () => ({ supervisor: selected, boss: "anthropic/claude-sonnet-4" }),
	});

	selected = "openai-codex/gpt-5.6-luna";
	await runtime.setActiveWorkerCount(1);
	await runtime.prompt(packetFor(heartbeatEvent(1)));
	assert.equal(factory.created[0]?.model, "openai-codex/gpt-5.6-luna");

	selected = "openai-codex/gpt-5.6-terra";
	await runtime.prompt(packetFor(heartbeatEvent(2)));
	assert.equal(factory.createCount, 1, "an open epoch stays pinned to its creation model");
	assert.equal(factory.created[0]?.model, "openai-codex/gpt-5.6-luna");

	await runtime.setActiveWorkerCount(0);
	await runtime.setActiveWorkerCount(1);
	await runtime.prompt(packetFor(heartbeatEvent(3)));
	assert.equal(factory.createCount, 2);
	assert.equal(factory.created[1]?.model, "openai-codex/gpt-5.6-terra");
});

test("model resolution prefers Supervisor then general-purpose then Boss, requires provider qualification, and forces thinking off", () => {
	assert.deepEqual(
		resolveSupervisorModelRef({
			supervisor: "openai/gpt-4.1-mini",
			generalPurpose: "anthropic/claude-haiku-4",
			boss: "anthropic/claude-opus-4",
		}),
		{ model: "openai/gpt-4.1-mini", thinkingLevel: "off", source: "supervisor" },
	);
	assert.deepEqual(
		resolveSupervisorModelRef({
			generalPurpose: "google/gemini-2.5-flash",
			boss: "anthropic/claude-opus-4",
		}),
		{ model: "google/gemini-2.5-flash", thinkingLevel: "off", source: "generalPurpose" },
	);
	assert.deepEqual(
		resolveSupervisorModelRef({ boss: "anthropic/claude-sonnet-4" }),
		{ model: "anthropic/claude-sonnet-4", thinkingLevel: "off", source: "boss" },
	);

	assert.throws(
		() => resolveSupervisorModelRef({ supervisor: "gpt-4.1-mini", generalPurpose: "openai/gpt-4.1-mini" }),
		(error: unknown) => {
			assert.ok(error instanceof SupervisorSessionRuntimeError);
			assert.equal(error.code, "unqualified_model");
			return true;
		},
	);
	assert.throws(
		() => resolveSupervisorModelRef({}),
		(error: unknown) => {
			assert.ok(error instanceof SupervisorSessionRuntimeError);
			assert.equal(error.code, "no_model");
			return true;
		},
	);
	assert.equal(SUPERVISOR_THINKING_LEVEL, "off");
});

test("creation and prompt failures surface as typed runtime errors without swallowing", async () => {
	const createFactory = createFakeFactory({ createError: new Error("session manager refused") });
	const createRuntime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory: createFactory,
		models: { boss: "openai/gpt-4.1-mini" },
	});
	await createRuntime.setActiveWorkerCount(1);
	await assert.rejects(
		() => createRuntime.prompt(packetFor(heartbeatEvent())),
		(error: unknown) => {
			assert.ok(error instanceof SupervisorSessionRuntimeError);
			assert.equal(error.code, "create_failed");
			assert.match(error.message, /session manager refused/);
			return true;
		},
	);
	assert.equal(createFactory.promptCount, 0);

	const promptFactory = createFakeFactory({ promptError: new Error("provider 429") });
	const promptRuntime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory: promptFactory,
		models: { boss: "openai/gpt-4.1-mini" },
	});
	await promptRuntime.setActiveWorkerCount(1);
	await assert.rejects(
		() => promptRuntime.prompt(packetFor(heartbeatEvent())),
		(error: unknown) => {
			assert.ok(error instanceof SupervisorSessionRuntimeError);
			assert.equal(error.code, "prompt_failed");
			assert.match(error.message, /provider 429/);
			return true;
		},
	);

	const invalidFactory = createFakeFactory({ reply: "not-json and no object" });
	const invalidRuntime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory: invalidFactory,
		models: { boss: "openai/gpt-4.1-mini" },
	});
	await invalidRuntime.setActiveWorkerCount(1);
	await assert.rejects(
		() => invalidRuntime.prompt(packetFor(heartbeatEvent())),
		(error: unknown) => {
			assert.ok(error instanceof SupervisorSessionRuntimeError);
			assert.equal(error.code, "prompt_failed");
			return true;
		},
	);
});

test("prompt is a bounded compact S1 packet with no transcript fields", async () => {
	const factory = createFakeFactory({
		reply: '```json\n{"action":"wait","reason":"still running"}\n```',
	});
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { generalPurpose: "anthropic/claude-haiku-4" },
	});
	const event = heartbeatEvent(4);
	const packet: SupervisorInputPacket = {
		...packetFor(event),
		tasks: [{ taskId: "t-1", title: "scan", status: "running" }],
		priorAction: { kind: "status", agentId: "worker-a", runId: "run-1" },
	};
	const dirty = {
		...packet,
		transcript: "boss log",
		messages: [{ role: "assistant", content: "secret" }],
		findings: "worker dump",
		event: { ...packet.event, findings: "hidden" },
	} as SupervisorInputPacket;

	await runtime.setActiveWorkerCount(1);
	const decision = await runtime.prompt(dirty);
	assert.equal(decision.action, "wait");

	const sent = factory.prompts[0] ?? "";
	const compact = serializeSupervisorInputPacket(packet);
	assert.equal(sent, compact);
	assert.equal("transcript" in JSON.parse(sent), false);
	assert.equal("messages" in JSON.parse(sent), false);
	assert.equal("findings" in JSON.parse(sent), false);
	assert.equal("findings" in JSON.parse(sent).event, false);
	assert.match(sent, /"kind":"heartbeat"/);
	assert.doesNotMatch(sent, /boss log|worker dump|secret/);

	const system = factory.created[0]?.systemPrompt ?? "";
	assert.equal(system, SUPERVISOR_SYSTEM_PROMPT);
	assert.match(system, /compact S1 JSON packet/i);
	assert.match(system, /JSON object/);
	assert.match(system, /transcript/);
	assert.match(system, /no shell, filesystem, web/i);
	assert.match(system, /Successful worker completions default to forward/);
	assert.match(system, /Use wait on a successful completion only when/);
	assert.match(system, /Never wait on a failed, interrupted, or verify-failed completion/);
	assert.match(system, /resume and retry are not self-service production actions/i);
	assert.match(system, /failure cause, safe management actions attempted.*next action the Boss should take/i);
	assert.doesNotMatch(system, /prefer .*resume|bounded retry/i);
	assert.equal(countActiveSupervisorJobs(packet.activeJobs), 1);
});

test("watch packets serialize compactly and the prompt explains watch routing", async () => {
	const factory = createFakeFactory({ reply: '{"action":"wait"}' });
	const runtime = createSupervisorSessionRuntime({
		projectRoot: "/tmp/pipiui-supervisor-s2",
		factory,
		models: { generalPurpose: "anthropic/claude-haiku-4" },
	});
	const watchEvent = unwrap(createSupervisorEvent({
		kind: "watch",
		agentId: "worker-a",
		runId: "run-1",
		sequence: 2,
		occurredAt: 1_700_000_000_500,
		job: unwrap(createJobSnapshot({
			agentId: "worker-a",
			runId: "run-1",
			status: "running",
			verify: "none",
			lastActivityAt: 1_700_000_000_500,
		}), "watch-job"),
		summary: "status=running phase=generating activity=+128B verify=none",
		evidenceRefs: ["artifact://status/worker-a/run-1"],
	}), "watch");
	const packet = packetFor(watchEvent);

	await runtime.setActiveWorkerCount(1);
	const decision = await runtime.prompt(packet);
	assert.equal(decision.action, "wait");

	const sent = factory.prompts[0] ?? "";
	assert.equal(sent, serializeSupervisorInputPacket(packet));
	const parsed = JSON.parse(sent) as {
		event: { identity: { kind: string }; job: { status: string; verify: string }; evidenceRefs?: string[] };
	};
	assert.equal(parsed.event.identity.kind, "watch");
	assert.equal(parsed.event.job.status, "running");
	assert.equal(parsed.event.job.verify, "none");
	assert.deepEqual(parsed.event.evidenceRefs, ["artifact://status/worker-a/run-1"]);
	assert.equal("transcript" in parsed, false);
	assert.equal("messages" in parsed, false);
	assert.equal("findings" in parsed, false);
	assert.equal("findings" in parsed.event, false);
	assert.match(sent, /"kind":"watch"/);
	assert.doesNotMatch(sent, /transcript|messages|findings/);

	const system = factory.created[0]?.systemPrompt ?? "";
	assert.match(system, /watch events are periodic bounded samples/i);
	assert.match(system, /For watch, ordinary progress stays silent with wait or status/i);
	assert.match(system, /escalate abnormal activity, stall-like quiet, or verify\/finalization trouble/i);
});
