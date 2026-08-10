/** Portable subagent-only environment assembly.
 *
 * This deliberately does not replace `PipiSpawnAssembly.swift`: it does not
 * discover files, capture display geometry, inspect TCC, or select a process.
 * It projects an already-validated HostCapabilitiesV1 into the PIPIUI_* names
 * consumed by `PiExt/subagent/index.ts`.
 */

import {
	decodeHostCapabilitiesV1,
	type DecodeResult,
	type HostCapabilitiesV1,
	type ProtocolDiagnostic,
} from "./contract.ts";

export type SubagentEnvironmentV1 = Record<string, string>;

export type EnvironmentAssemblyResultV1 =
	| { ok: true; value: SubagentEnvironmentV1; diagnostics: ProtocolDiagnostic[] }
	| { ok: false; diagnostics: ProtocolDiagnostic[] };

/**
 * Project the stable host contract onto the existing extension's minimum env
 * surface. Per-dispatch values such as PIPIUI_AGENT_ID, PIPIUI_AGENT_RUN_ID,
 * PIPIUI_MEMORY_BROKER_CAPABILITY, and PIPIUI_WORKTREE_PATH intentionally stay
 * with the extension/runtime that creates an individual worker.
 */
export function buildSubagentEnvironmentV1(input: HostCapabilitiesV1 | unknown): EnvironmentAssemblyResultV1 {
	const decoded: DecodeResult<HostCapabilitiesV1> = decodeHostCapabilitiesV1(input);
	if (!decoded.ok) return decoded;
	const capabilities = decoded.value;
	const env: SubagentEnvironmentV1 = {
		PIPIUI_BRIDGE_PORT: String(capabilities.bridge.port),
		// Explicit Electron/portable-host opt-in. Swift's existing assembly does
		// not set this flag and therefore keeps its legacy flat bridge body.
		PIPIUI_HOST_PROTOCOL: "1",
		// Canonical agent_event bodies read only this capability name.
		PIPIUI_SESSION_CAPABILITY: capabilities.bridge.sessionCapability,
		// Legacy siblings (including the current generated PlanRuntimeExtension)
		// still read SESSION_KEY. It is the same opaque value, not a second secret.
		PIPIUI_SESSION_KEY: capabilities.bridge.sessionCapability,
		PIPIUI_MAIN_CWD: capabilities.mainCwd,
	};

	const paths = capabilities.extensions;
	if (paths.subagent) env.PIPIUI_SUBAGENT_EXT = paths.subagent;
	if (paths.agentsDir) env.PIPIUI_AGENTS_DIR = paths.agentsDir;
	if (paths.searchScope) env.PIPIUI_SEARCH_SCOPE_EXT = paths.searchScope;
	if (paths.webSearch) env.PIPIUI_WEBSEARCH_EXT = paths.webSearch;
	if (paths.mcp) env.PIPIUI_MCP_EXT = paths.mcp;
	if (paths.pdf) env.PIPIUI_PDF_EXT = paths.pdf;
	if (paths.pdfHelper) env.PIPIUI_PDF_HELPER = paths.pdfHelper;
	if (paths.github) env.PIPIUI_GITHUB_EXT = paths.github;
	if (paths.arxiv) env.PIPIUI_ARXIV_EXT = paths.arxiv;

	const files = capabilities.modelFiles;
	if (files.mainModelFile) env.PIPIUI_MAIN_MODEL_FILE = files.mainModelFile;
	if (files.subagentModelsFile) env.PIPIUI_SUBAGENT_MODELS_FILE = files.subagentModelsFile;
	if (files.subagentModelCapabilitiesFile) {
		env.PIPIUI_SUBAGENT_MODEL_CAPABILITIES_FILE = files.subagentModelCapabilitiesFile;
	}

	if (capabilities.session.skillReadBlock !== undefined) {
		env.PIPIUI_SKILL_READ_BLOCK = capabilities.session.skillReadBlock ? "1" : "0";
	}

	const platform = capabilities.platform;
	if (platform?.search?.available && platform.search.grantFile) {
		env.PIPIUI_SEARCH_GRANT_FILE = platform.search.grantFile;
	}
	if (platform?.memory?.available) env.PIPIUI_MEMORY_BROKER_ENABLED = "1";
	if (platform?.computer?.available && paths.computer && platform.computer.routingCapability) {
		env.PIPIUI_COMPUTER_EXT = paths.computer;
		env.PIPIUI_COMPUTER_CAPABILITY = platform.computer.routingCapability;
		if (platform.computer.protocolVersion !== undefined) {
			env.PIPIUI_COMPUTER_RUNTIME_PROTOCOL = String(platform.computer.protocolVersion);
		}
	}
	return { ok: true, value: env, diagnostics: decoded.diagnostics };
}
