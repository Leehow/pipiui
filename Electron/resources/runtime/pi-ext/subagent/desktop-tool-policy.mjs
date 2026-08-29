export const RESERVED_DESKTOP_TOOL_NAMES = Object.freeze([
	"computer",
	"open_application",
]);

/** Tools that exist only to dispatch or control workers. Nested roles lose the whole set. */
export const DELEGATION_TOOL_NAMES = Object.freeze([
	"subagent",
	"subagent_chain",
	"subagent_abort",
	"subagent_resolve",
	"subagent_status",
]);

export function isDelegationTool(name) {
	return DELEGATION_TOOL_NAMES.includes(name);
}

/** App-issued one-run capability may add only these read-only broker tools. */
export const MEMORY_BROKER_TOOL_NAMES = Object.freeze(["memory_query", "memory_status"]);
export const MEMORY_BROKER_TOOL_NAME = MEMORY_BROKER_TOOL_NAMES[0];
export const MEMORY_STATUS_TOOL_NAME = MEMORY_BROKER_TOOL_NAMES[1];

/** Explicit skillloader mount may add only these read-only tools. No manage/mutate API. */
export const SKILL_LOADER_TOOL_NAMES = Object.freeze(["skill_search", "skill_load"]);

/**
 * Read-only recall of this session's own compacted-out JSONL history. Granted by
 * the dispatch (not frontmatter) whenever the subagent extension that registers
 * the tool is mounted for the child: a worker whose context was compacted has no
 * other way to find its own task.
 */
export const SESSION_RECALL_TOOL_NAME = "session_recall";

// Desktop control lives only in the main session; a dispatched child never
// receives these tools, whatever its frontmatter or the denylist says.
const RESERVED_DESKTOP_TOOLS = new Set(RESERVED_DESKTOP_TOOL_NAMES);

/** Drop generic denylist entries for main-session-only desktop tools: a
 * dispatched child never carries them, so a stale entry is noise, not a gate.
 * The returned names are unique and sorted. */
export function sanitizeDisabledToolNames(names) {
	return [...new Set(
		[...(names ?? [])].filter(
			(name) =>
				typeof name === "string" &&
				!RESERVED_DESKTOP_TOOLS.has(name),
		),
	)].sort();
}

// These tools exist only when PipiUI mounted the corresponding local extension.
// `web_search` is deliberately absent from this set: it may be provider-native
// even when pi-web-access is off. Capability-driven hiding of the generic
// client tool is a separate flag (`hideGenericWebSearch`), never a provider id.
export const PIPIUI_EXTENSION_ONLY_TOOL_NAMES = Object.freeze([
	"fetch_content",
	"source_check",
	"get_search_content",
	"arxiv_fetch",
]);

const PIPIUI_EXTENSION_ONLY_TOOL_SET = new Set(PIPIUI_EXTENSION_ONLY_TOOL_NAMES);

function envPath(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Resolve the usable PipiUI extension routes exported by the main process. */
export function resolvePipiUIExtensionRouting({
	webAccessExtension,
	arxivExtension,
} = {}) {
	const routes = [];
	const web = envPath(webAccessExtension);
	const arxiv = envPath(arxivExtension);

	if (web) {
		routes.push({
			path: web,
			toolNames: ["web_search", "fetch_content", "source_check", "get_search_content"],
			extensionOnlyToolNames: ["fetch_content", "source_check", "get_search_content"],
		});
	}
	if (arxiv) {
		routes.push({
			path: arxiv,
			toolNames: ["arxiv_fetch"],
			extensionOnlyToolNames: ["arxiv_fetch"],
		});
	}

	return {
		routes,
		extensionOnlyTools: routes.flatMap((route) => route.extensionOnlyToolNames),
	};
}

/**
 * Pick `-e` routes that can expose at least one selected tool. Pi 0.84's
 * `--tools` is an allowlist across built-in, extension, and custom tools, so
 * mounting a route alone must never widen a role's effective tool set.
 */
export function toolSelectionAllows(selection, name) {
	if (!selection || selection.flag === "--no-tools") return false;
	const names = new Set(Array.isArray(selection.names) ? selection.names : []);
	if (selection.flag === "--tools") return names.has(name);
	if (selection.flag === "--exclude-tools") return !names.has(name);
	return false;
}

export function selectPipiUIExtensionRoutes(routing, selection) {
	const routes = Array.isArray(routing?.routes) ? routing.routes : [];
	if (!selection || selection.flag === "--no-tools") return [];
	const selected = [];
	const paths = new Set();
	for (const route of routes) {
		if (!route?.path || paths.has(route.path)) continue;
		if (!Array.isArray(route.toolNames) || !route.toolNames.some((name) => toolSelectionAllows(selection, name))) continue;
		paths.add(route.path);
		selected.push(route);
	}
	return selected;
}

/**
 * Hide PipiUI generic `web_search` only when the capability bag declares
 * native `web_search`. A lone `x_search` entry does not hide it. Matches
 * host-api `modelHidesGenericWebSearch` — no provider-name branch.
 */
export function nativeSearchCapabilityHidesGenericWebSearch(capability) {
	return Array.isArray(capability?.tools) && capability.tools.includes("web_search");
}

/** Look up a `provider/id` in the host-written native-search runtime catalog. */
export function hideGenericWebSearchForModelRef(modelRef, catalog) {
	if (!modelRef || !catalog || typeof catalog !== "object") return false;
	const key = String(modelRef).trim();
	return key ? nativeSearchCapabilityHidesGenericWebSearch(catalog[key]) : false;
}

/**
 * Resolve the exact Pi CLI tool-selection argument for one dispatched
 * subagent. This pure seam is shared by production and behavioral tests so a
 * stale JSON denylist cannot silently reintroduce a desktop-tool gate.
 *
 * PipiUI-only names are retained only when the main process exported a usable
 * matching route. This prevents Pi's `--tools` allowlist from naming a tool
 * whose extension is feature-gated off or unavailable.
 *
 * Generic `web_search` is hidden only when `hideGenericWebSearch` is set from
 * the worker model's effective native-search capability — never a provider id.
 */
/**
 * Stable omission reasons for durable read tools. Attribution/getActiveTools
 * already see the final registered set; this names *why* a durable tool is absent.
 */
export function diagnoseWorkerReadToolOmissions({
	hasMemoryBrokerCapability = false,
	hasSessionRecall = false,
	hasSkillLoader = false,
	memoryOmissionReason,
} = {}) {
	const reasons = {};
	if (!hasMemoryBrokerCapability) {
		const reason = memoryOmissionReason || "capability-not-issued";
		reasons.memory_query = reason;
		reasons.memory_status = reason;
	}
	if (!hasSessionRecall) reasons.session_recall = "extension-not-mounted";
	if (!hasSkillLoader) {
		reasons.skill_search = "skillloader-not-mounted";
		reasons.skill_load = "skillloader-not-mounted";
	}
	return reasons;
}

export function formatWorkerReadToolOmissions(reasons) {
	return Object.entries(reasons ?? {})
		.map(([name, reason]) => `${name}=${reason}`)
		.sort()
		.join(";");
}

/** Host-exported or bundled skillloader path. Empty/missing means do not mount. */
export function resolveWorkerSkillLoaderPath({
	env = process.env,
	existsSync,
	bundledPath,
} = {}) {
	const fromEnv = typeof env?.PIPIUI_SKILLLOADER_EXT === "string"
		? env.PIPIUI_SKILLLOADER_EXT.trim()
		: "";
	if (fromEnv) return fromEnv;
	if (bundledPath && typeof existsSync === "function" && existsSync(bundledPath)) return bundledPath;
	return undefined;
}

export function workerSkillLoaderMountArgs(skillLoaderPath) {
	if (!skillLoaderPath) return [];
	return ["-e", skillLoaderPath];
}

export function resolveSubagentToolSelection({
	declaredTools,
	disabledTools,
	hasMemoryBrokerCapability = false,
	hasSessionRecall = false,
	hasSkillLoader = false,
	allowRecursiveDelegation,
	availableExtensionTools = [],
	hideGenericWebSearch = false,
}) {
	const disabled = new Set(sanitizeDisabledToolNames(disabledTools));
	if (hideGenericWebSearch) disabled.add("web_search");
	const available = new Set(
		Array.isArray(availableExtensionTools)
			? availableExtensionTools.filter((name) => PIPIUI_EXTENSION_ONLY_TOOL_SET.has(name))
			: [],
	);
	// An array (including []) means a v1/explicit constrained policy. Undefined
	// is the legacy no-`tools` form and intentionally keeps its old exclude-list
	// behavior. Desktop names are main-session-only and are never trusted from
	// frontmatter.
	if (Array.isArray(declaredTools)) {
		const allowed = new Set(
			declaredTools.filter(
				(name) =>
					!disabled.has(name) &&
					!RESERVED_DESKTOP_TOOLS.has(name) &&
					(allowRecursiveDelegation || !isDelegationTool(name)) &&
					(!PIPIUI_EXTENSION_ONLY_TOOL_SET.has(name) || available.has(name)),
			),
		);
		// Host-issued capability, not frontmatter, grants the bounded read-only
		// broker tools. Dead names are stripped when the capability is absent.
		// There are no broker durable-write tool names here.
		for (const name of MEMORY_BROKER_TOOL_NAMES) allowed.delete(name);
		if (hasMemoryBrokerCapability) {
			for (const name of MEMORY_BROKER_TOOL_NAMES) {
				if (!disabled.has(name)) allowed.add(name);
			}
		}
		// Same host-issued pattern for self-continuity: the subagent extension is
		// mounted (hasSessionRecall), so the name is never dead in the allowlist.
		allowed.delete(SESSION_RECALL_TOOL_NAME);
		if (hasSessionRecall && !disabled.has(SESSION_RECALL_TOOL_NAME)) {
			allowed.add(SESSION_RECALL_TOOL_NAME);
		}
		// Explicit skillloader mount only. Automatic skill bootstrap stays off.
		for (const name of SKILL_LOADER_TOOL_NAMES) allowed.delete(name);
		if (hasSkillLoader) {
			for (const name of SKILL_LOADER_TOOL_NAMES) {
				if (!disabled.has(name)) allowed.add(name);
			}
		}
		return allowed.size > 0
			? { flag: "--tools", names: [...allowed] }
			: { flag: "--no-tools", names: [] };
	}

	if (!allowRecursiveDelegation) {
		for (const name of DELEGATION_TOOL_NAMES) disabled.add(name);
	}
	// Even a legacy unconstrained worker never surfaces a main-session desktop tool.
	for (const name of RESERVED_DESKTOP_TOOL_NAMES) disabled.add(name);
	return {
		flag: "--exclude-tools",
		names: [...disabled].sort(),
	};
}
