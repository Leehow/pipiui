export const RESERVED_DESKTOP_TOOL_NAMES = Object.freeze([
	"computer",
	"open_application",
]);

/** App-issued one-run capability may add only this read-only broker tool. */
export const MEMORY_BROKER_TOOL_NAME = "memory_query";

/** Per-task Computer Use grants a boss may attach to a dispatch. Omission = no grant. */
export const DESKTOP_GRANT_VALUES = Object.freeze(["user-requested", "ui-verify"]);

/** True only for an explicit, recognized per-task desktop grant value. */
export function isDesktopGrant(value) {
	return DESKTOP_GRANT_VALUES.includes(value);
}

/**
 * Resolve the per-task desktop gate. A grant is honored only when the host
 * Computer Use capability is available; a requested-but-unavailable grant is
 * an explicit early failure, never a silent no-op that fakes authorization.
 */
export function resolveDesktopGrant({ desktop, hostAvailable }) {
	if (!isDesktopGrant(desktop)) {
		return { granted: false, reason: "none" };
	}
	if (!hostAvailable) {
		return {
			granted: false,
			reason: "unavailable",
			problem: `Cannot dispatch with desktop:"${desktop}": Computer Use capability is not available in this host (global Computer Use toggle is off, or the strategy extension is not mounted). Either omit desktop (no desktop tools are injected) or enable Computer Use globally before re-dispatching.`,
		};
	}
	return { granted: true, reason: desktop };
}

/**
 * Central child-prompt policy appended to every dispatched subagent that holds
 * a desktop grant. Applies to ALL subagents: a grant never turns desktop into
 * a general-purpose tool.
 */
export const DESKTOP_GRANT_CHILD_POLICY = `[Computer Use grant]
This dispatch explicitly authorized desktop steps (computer / open_application) for THIS task only. Strict rules:
- For files, logs, process or file waiting, polling, and build/test verification, use read/bash instead of computer: read/bash for files, logs, process or file waiting, polling, and build/test verification; use the built-in browser tool for ordinary web work.
- Waiting, sleeping, polling logs, compiling, running tests, reading files, and ordinary web research are FORBIDDEN via computer — use read/bash or the browser tool instead.
- Never use bash, shell, AppleScript, osascript, \`open\`, process signals, or synthetic input to operate or replace a requested GUI/App interaction.
- When the user requested a visible App/GUI operation, you MUST use open_application and computer for those desktop steps.
- If the user named Chrome, Safari, another external browser, or "my browser", you MUST use exactly that browser: open_application to pin it, then computer batches. Never substitute the built-in browser tool for a user-named external browser.
- The grant authorizes only the necessary desktop steps for THIS task; it does not expand the task scope. You may not self-grant, extend, or propagate desktop access to other agents, sessions, or future tasks.
- For a ui-verify grant: use desktop only for the visual acceptance check of the app just built/changed in this task, then return to normal tools.
- Pack desktop actions: one batch must complete each coherent sequence (click → type → confirm). Single-action batches are the expensive round-trip anti-pattern; split only when the next step genuinely depends on seeing the previous result.`;

const RESERVED_DESKTOP_TOOLS = new Set(RESERVED_DESKTOP_TOOL_NAMES);

/** Remove generic denylist entries that must be controlled only by the global
 * Computer Use button. The returned names are unique and sorted. */
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
// `web_search` is deliberately absent: it may be provider-native (xAI / GLM /
// Codex / Claude) even when pi-web-access is off.
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
 * Resolve the exact Pi CLI tool-selection argument for one dispatched
 * subagent. This pure seam is shared by production and behavioral tests so a
 * stale JSON denylist cannot silently reintroduce a desktop-tool gate.
 *
 * PipiUI-only names are retained only when the main process exported a usable
 * matching route. This prevents Pi's `--tools` allowlist from naming a tool
 * whose extension is feature-gated off or unavailable.
 */
export function resolveSubagentToolSelection({
	declaredTools,
	disabledTools,
	hasDesktopCapability,
	hasMemoryBrokerCapability = false,
	allowRecursiveDelegation,
	availableExtensionTools = [],
}) {
	const disabled = new Set(sanitizeDisabledToolNames(disabledTools));
	const available = new Set(
		Array.isArray(availableExtensionTools)
			? availableExtensionTools.filter((name) => PIPIUI_EXTENSION_ONLY_TOOL_SET.has(name))
			: [],
	);
	// An array (including []) means a v1/explicit constrained policy. Undefined
	// is the legacy no-`tools` form and intentionally keeps its old exclude-list
	// behavior. Desktop names are never trusted from frontmatter: only a real
	// dispatch grant adds them below.
	if (Array.isArray(declaredTools)) {
		const allowed = new Set(
			declaredTools.filter(
				(name) =>
					!disabled.has(name) &&
					!RESERVED_DESKTOP_TOOLS.has(name) &&
					(allowRecursiveDelegation || name !== "subagent") &&
					(!PIPIUI_EXTENSION_ONLY_TOOL_SET.has(name) || available.has(name)),
			),
		);
		if (hasDesktopCapability) {
			for (const name of RESERVED_DESKTOP_TOOL_NAMES) allowed.add(name);
		}
		// The host-issued capability, not frontmatter, grants the bounded
		// read-only query. There are no broker durable-write tool names here.
		if (hasMemoryBrokerCapability && !disabled.has(MEMORY_BROKER_TOOL_NAME)) {
			allowed.add(MEMORY_BROKER_TOOL_NAME);
		}
		return allowed.size > 0
			? { flag: "--tools", names: [...allowed] }
			: { flag: "--no-tools", names: [] };
	}

	if (!allowRecursiveDelegation) disabled.add("subagent");
	// Even a legacy unconstrained worker cannot surface a provider/custom
	// desktop tool unless the host AND this dispatch granted it.
	if (!hasDesktopCapability) {
		for (const name of RESERVED_DESKTOP_TOOL_NAMES) disabled.add(name);
	}
	return {
		flag: "--exclude-tools",
		names: [...disabled].sort(),
	};
}
