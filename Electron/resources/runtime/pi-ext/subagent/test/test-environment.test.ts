import test from "node:test";
import assert from "node:assert/strict";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";

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
