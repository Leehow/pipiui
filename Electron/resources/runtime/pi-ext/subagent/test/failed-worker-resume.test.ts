/** Failed -> same-id dispatch uses the registered tool and a real protocol-fixture child. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubSubagentRuntimeTestHostEnvironment } from "./test-environment.ts";
import { registerGitWorktreePlacementProviderV1 } from "../../../extensions/git-capability/agent/worktree-service.ts";

scrubSubagentRuntimeTestHostEnvironment();
const root = mkdtempSync(join(tmpdir(), "failed-worker-resume-"));
const sessions = join(root, ".pi", "agent-sessions");
mkdirSync(sessions, { recursive: true });
process.env.PIPIUI_AGENT_DEPTH = "0";
process.env.PIPIUI_AGENT_TREE_DEPTH = "0";
process.env.PIPIUI_MAIN_CWD = root;
process.env.PIPIUI_AGENTS_DIR = fileURLToPath(new URL("../../agents", import.meta.url));
process.env.PIPIUI_NODE_PATH = process.execPath;
process.env.PIPIUI_SUBAGENT_TEST_CHILD_ENTRY = fileURLToPath(new URL("./fake-pi-worker.ts", import.meta.url));
delete process.env.PIPIUI_FANOUT_ACTIVE;
delete process.env.PIPIUI_AGENT_ID;
delete process.env.PIPIUI_AGENT_RUN_ID;
registerGitWorktreePlacementProviderV1();
const { default: loadExtension, drainPipiuiTrackedChildren } = await import("../index.ts");

test("a failed general-purpose worker resumes the same retained conversation under a new runId", async (t) => {
	t.after(async () => {
		const drained = await drainPipiuiTrackedChildren(250, 2_000);
		assert.deepEqual(drained.remainingPids, []);
		rmSync(root, { recursive: true, force: true });
	});
	const tools = new Map<string, any>();
	loadExtension({
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand() {}, on() {}, sendMessage() {}, async sendUserMessage() {},
	} as any);
	const dispatch = tools.get("subagent");
	const status = tools.get("subagent_status");
	const ctx = { cwd: root, model: undefined, isIdle: () => true, hasPendingMessages: () => false };
	const agentId = "retained-worker";
	const sessionFile = join(sessions, `1_pipiui-${agentId}.jsonl`);
	// The fixture does not implement Pi's session writer; seed its previously saved context.
	const saved = [
		{ type: "session", version: 3, id: `pipiui-${agentId}`, cwd: root },
		{ type: "message", id: "prior", parentId: null, message: { role: "user", content: "Keep the existing research and decisions." } },
	].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
	writeFileSync(sessionFile, saved);
	async function run(behavior: string) {
		const args = dispatch.prepareArguments({
			prompt: `Continue this slice [seam:${agentId}:${behavior}].`,
			description: "continue retained worker", subagent_type: "general-purpose",
			agentId, isolation: "none", run_in_background: false,
		});
		return dispatch.execute(`resume-${behavior}`, args, undefined, undefined, ctx);
	}
	const failed = await run("fail");
	assert.equal(failed.isError, true);
	assert.equal(readFileSync(sessionFile, "utf8"), saved, "failure must not discard the saved context");
	const failedStatus = await status.execute("failed-status", { agentId, full: true }, undefined, undefined, ctx);
	assert.match(failedStatus.content[0].text, /(?:workerState|state): failed/);
	const resumed = await run("ok");
	assert.notEqual(resumed.isError, true, JSON.stringify(resumed));
	const before = failed.details.results[0];
	const after = resumed.details.results[0];
	assert.equal(after.agentId, agentId);
	assert.equal(after.resumed, true);
	assert.notEqual(after.runId, before.runId, "the episode changes, not the worker identity");
	assert.equal(readFileSync(sessionFile, "utf8"), saved, "same-id resume must preserve the existing conversation");
	assert.match(resumed.content[0].text, /fake-ok:retained-worker/);
});
