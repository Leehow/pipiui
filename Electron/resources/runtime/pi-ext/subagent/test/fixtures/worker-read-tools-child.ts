/**
 * Short-lived production-spawn probe. Loads the real skillloader and
 * memory-broker worker extension, inspects registered tools, optionally
 * executes read-only tools, prints one JSON report, and exits.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import installSkillLoader, {
	resolveSkillRoots,
	shouldInjectSkillCatalog,
} from "../../../../extensions/pipiui-skillloader.ts";
import { installMemoryBrokerExtension } from "../../../packages/memory-broker/src/extension.ts";
import { registerSessionRecallTool } from "../../session-recall.ts";

type RegisteredTool = {
	name: string;
	execute?: (...args: never[]) => unknown;
};

function fakePi() {
	const tools = new Map<string, RegisteredTool>();
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	return {
		tools,
		handlers,
		api: {
			on(event: string, handler: (...args: unknown[]) => unknown) {
				const values = handlers.get(event) ?? [];
				values.push(handler);
				handlers.set(event, values);
			},
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
			registerCommand() {},
		},
	};
}

function toolText(result: unknown): { text: string; details: Record<string, unknown>; isError: boolean } {
	if (!result || typeof result !== "object") {
		return { text: "", details: {}, isError: true };
	}
	const value = result as {
		content?: Array<{ type?: string; text?: string }>;
		details?: Record<string, unknown>;
		isError?: boolean;
	};
	const text = value.content?.map((part) => part.text ?? "").join("") ?? "";
	return {
		text,
		details: value.details && typeof value.details === "object" ? value.details : {},
		isError: value.isError === true,
	};
}

async function callTool(
	tools: Map<string, RegisteredTool>,
	name: string,
	params: Record<string, unknown> = {},
): Promise<{ present: boolean; text: string; details: Record<string, unknown>; isError: boolean; error?: string }> {
	const tool = tools.get(name);
	if (!tool?.execute) return { present: false, text: "", details: {}, isError: true };
	try {
		const result = await tool.execute("probe-1" as never, params as never);
		return { present: true, ...toolText(result) };
	} catch (error) {
		return {
			present: true,
			text: "",
			details: {},
			isError: true,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function main(): Promise<void> {
	const scenario = process.env.PIPIUI_WORKER_PROBE_SCENARIO ?? "valid";
	const skillName = process.env.PIPIUI_WORKER_PROBE_SKILL ?? "fixture-worker-skill";
	const claim = process.env.PIPIUI_WORKER_PROBE_CLAIM ?? "";
	const pi = fakePi();

	installSkillLoader(pi.api as never);
	registerSessionRecallTool(pi.api as never);
	await installMemoryBrokerExtension(pi.api as never, {}, process.env);

	const hook = pi.handlers.get("before_agent_start")?.[0];
	const next = hook?.({
		systemPrompt: "base\n\n<available_skills>\nsecret catalog\n</available_skills>",
	}) as { systemPrompt?: string } | undefined;
	const prompt = next?.systemPrompt ?? "";
	const roots = resolveSkillRoots(process.env);
	const globalPi = join(homedir(), ".pi");

	const shouldCallMemory = scenario !== "missing" && scenario !== "malformed";
	const memoryQuery = shouldCallMemory
		? await callTool(pi.tools, "memory_query", { query: claim || "fixture", scope: "project" })
		: { present: pi.tools.has("memory_query"), text: "", details: {}, isError: true };
	const memoryStatus = shouldCallMemory
		? await callTool(pi.tools, "memory_status")
		: { present: pi.tools.has("memory_status"), text: "", details: {}, isError: true };
	const skillSearch = await callTool(pi.tools, "skill_search", { query: "fixture" });
	const skillLoad = await callTool(pi.tools, "skill_load", { name: skillName });

	const report = {
		ok: true,
		scenario,
		role: process.env.PIPIUI_WORKER_PROBE_ROLE ?? "",
		registeredTools: [...pi.tools.keys()].sort(),
		roots,
		injectsCatalog: shouldInjectSkillCatalog(process.env),
		prompt,
		globalPiExcluded: roots.every((root) => root !== globalPi && !root.startsWith(`${globalPi}/`)),
		memoryQuery,
		memoryStatus,
		skillSearch,
		skillLoad,
	};
	process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((error) => {
	process.stdout.write(`${JSON.stringify({
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	})}\n`);
	process.exitCode = 1;
});
