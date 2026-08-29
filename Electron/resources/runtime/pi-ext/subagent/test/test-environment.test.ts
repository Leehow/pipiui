import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";

test("real-seam suites use a dedicated worker entry instead of re-executing their test file", () => {
	for (const name of ["dispatch-model.test.ts", "dispatch-seam.test.ts"]) {
		const source = readFileSync(new URL(name, import.meta.url), "utf8");
		assert.match(source, /PIPIUI_SUBAGENT_TEST_CHILD_ENTRY/, name);
		assert.doesNotMatch(source, /re-executes THIS FILE/, name);
		assert.doesNotMatch(source, /function runFake(?:Rpc)?WorkerChild/, name);
	}
	const worker = readFileSync(new URL("fake-pi-worker.ts", import.meta.url), "utf8");
	assert.doesNotMatch(worker, /from ["']node:test["']/);
	assert.match(worker, /PI_SUBAGENT_CHILD/);
	assert.match(worker, /rejects unsupported transport mode/);
});

test("dedicated fake worker fails closed outside a marked supported child invocation", () => {
	const fixture = fileURLToPath(new URL("fake-pi-worker.ts", import.meta.url));
	const baseEnv = {
		...process.env,
		PIPIUI_AGENT_DEPTH: "1",
		PIPIUI_AGENT_TREE_DEPTH: "1",
	};
	const unmarked = spawnSync(process.execPath, [fixture, "--mode", "json", "-p", "Task"], {
		env: { ...baseEnv, PI_SUBAGENT_CHILD: undefined },
		encoding: "utf8",
	});
	assert.notEqual(unmarked.status, 0);
	assert.match(unmarked.stderr, /requires PI_SUBAGENT_CHILD=1/);

	const unknownMode = spawnSync(process.execPath, [fixture, "--mode", "future-mode"], {
		env: { ...baseEnv, PI_SUBAGENT_CHILD: "1" },
		encoding: "utf8",
	});
	assert.notEqual(unknownMode.status, 0);
	assert.match(unknownMode.stderr, /rejects unsupported transport mode/);
});

test("real-seam test bootstrap removes live host/session capabilities and preserves unrelated inputs", () => {
	const environment: NodeJS.ProcessEnv = {
		PATH: "/test/bin",
		PIPIUI_MAIN_CWD: "/tmp/suite",
		PIPIUI_NODE_PATH: "/test/node",
		PIPIUI_BRIDGE_PORT: "12345",
		PIPIUI_SESSION_KEY: "live-session",
		PIPIUI_SESSION_CAPABILITY: "live-capability",
		PIPIUI_SESSION_ID: "live-id",
		PIPIUI_HOST_PROTOCOL: "1",
		PIPIUI_COMPUTER_CAPABILITY: "computer-capability",
		PIPIUI_CUA_BROKER_TOKEN: "cua-token",
		PIPIUI_MEMORY_BROKER_TOKEN: "memory-token",
		PIPIUI_TERMINAL_CAPABILITY: "terminal-capability",
	};

	scrubSubagentRuntimeTestHostEnvironment(environment);

	assert.deepEqual(environment, {
		PATH: "/test/bin",
		PIPIUI_MAIN_CWD: "/tmp/suite",
		PIPIUI_NODE_PATH: "/test/node",
	});
});
