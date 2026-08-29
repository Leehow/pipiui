import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function fail(message: string): never {
	process.stderr.write(`[fake-pi-worker] ${message}\n`);
	process.exit(2);
}

if (process.env.PI_SUBAGENT_CHILD !== "1") {
	fail("requires PI_SUBAGENT_CHILD=1");
}

const argv = process.argv;
const modeIndex = argv.indexOf("--mode");
const transportMode = modeIndex >= 0 ? argv[modeIndex + 1] : undefined;
const prompt = argv[argv.length - 1] ?? "";
const sessionIdArg = argv.find((value) => value.startsWith("pipiui-")) ?? "";
const modelIndex = argv.indexOf("--model");
const resolvedModel = modelIndex >= 0 && modelIndex + 1 < argv.length ? argv[modelIndex + 1]! : "(none)";
const thinkingIndex = argv.indexOf("--thinking");
const resolvedThinking = thinkingIndex >= 0 && thinkingIndex + 1 < argv.length ? argv[thinkingIndex + 1]! : "";

function markerIdentity(text: string): { agentId: string; behavior: string; dispatchModel: boolean } {
	const seam = text.match(/\[seam:([a-z0-9_-]+?)(?::([a-z0-9-]+))?\]/);
	const dispatchModel = text.match(/\[dm:([a-z0-9_-]+)\]/);
	return {
		agentId: sessionIdArg.replace(/^pipiui-/, "") || seam?.[1] || dispatchModel?.[1] || "unknown",
		behavior: seam?.[2] ?? "ok",
		dispatchModel: Boolean(dispatchModel),
	};
}

function line(event: unknown): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

function writeChildState(agentId: string, extra: Record<string, unknown> = {}): void {
	const root = process.env.PIPIUI_MAIN_CWD;
	if (!root) return;
	const statePath = join(root, `rpc-child-${agentId}.json`);
	let previous: Record<string, unknown> = {};
	try {
		previous = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
	} catch {
		// First write for this child.
	}
	writeFileSync(statePath, JSON.stringify({ ...previous, pid: process.pid, ...extra }));
}

function parkResident(agentId: string, ignoreTerm: boolean): Promise<never> {
	writeChildState(agentId, { final: true });
	if (ignoreTerm) {
		process.on("SIGTERM", () => writeChildState(agentId, { sigterm: true }));
	}
	const keepAlive = setInterval(() => {}, 60_000);
	void keepAlive;
	const hardExit = setTimeout(() => process.exit(0), 30_000);
	void hardExit;
	return new Promise(() => {});
}

function assistantText(agentId: string): string {
	return `fake-ok:${agentId} model=${resolvedModel}${resolvedThinking ? ` thinking=${resolvedThinking}` : ""}`;
}

async function runPrintWorker(text: string, rpcCommandId?: string): Promise<never> {
	const { agentId, behavior } = markerIdentity(text);
	line({ type: "session_start", cwd: process.cwd() });
	if (rpcCommandId) line({ id: rpcCommandId, type: "response", command: "prompt", success: true });
	if (behavior === "final-hold") {
		line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: assistantText(agentId) }] } });
		return parkResident(agentId, false);
	}
	if (behavior === "hang") {
		const keepAlive = setInterval(() => {}, 60_000);
		void keepAlive;
		const hardExit = setTimeout(() => process.exit(0), 30_000);
		void hardExit;
		await new Promise<never>(() => {});
	}
	if (behavior === "fail") {
		line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "planned failure" }] } });
		process.exit(3);
	}
	line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: assistantText(agentId) }] } });
	process.exit(0);
}

let rpcExitOnGetState = false;

async function runResidentPrompt(rpcCommandId: string | undefined, text: string): Promise<never> {
	const { agentId, behavior, dispatchModel } = markerIdentity(text);
	if (rpcCommandId) line({ id: rpcCommandId, type: "response", command: "prompt", success: true });
	line({ type: "session_start", cwd: process.cwd() });
	line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: assistantText(agentId) }] } });
	line({ type: "agent_settled" });
	writeChildState(agentId);
	if (dispatchModel) process.exit(0);
	if (behavior === "rpc-hold") return parkResident(agentId, false);
	const token = process.env.PIPIUI_RESIDENT_RPC_WAKE_TOKEN ?? "";
	line({ type: "extension_ui_request", method: "setStatus", statusKey: `pipiui-resident-rpc-wake:${token}` });
	if (behavior === "rpc-exit") {
		rpcExitOnGetState = true;
		return parkResident(agentId, false);
	}
	if (behavior === "rpc-stubborn") return parkResident(agentId, true);
	return parkResident(agentId, false);
}

async function runRpcWorker(): Promise<never> {
	const spawnedId = process.env.PIPIUI_AGENT_ID;
	if (spawnedId) writeChildState(spawnedId);
	let buffer = "";
	process.stdin.on("data", (chunk) => {
		buffer += String(chunk);
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			const commandLine = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			try {
				const command = JSON.parse(commandLine) as { id?: string; type?: string; message?: string };
				if (command.type === "get_state" && rpcExitOnGetState) process.exit(0);
				if (command.type === "prompt") void runResidentPrompt(command.id, command.message ?? "");
			} catch {
				process.exit(2);
			}
		}
	});
	await new Promise<never>(() => {});
}

if (transportMode === "json" && argv.includes("-p")) {
	await runPrintWorker(prompt);
}
if (transportMode === "rpc") {
	await runRpcWorker();
}
fail(`rejects unsupported transport mode: ${transportMode ?? "missing"}`);
