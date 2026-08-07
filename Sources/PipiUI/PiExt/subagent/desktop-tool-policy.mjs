export const RESERVED_DESKTOP_TOOL_NAMES = Object.freeze([
	"computer",
	"open_application",
]);

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
- NEVER use computer when read/bash/browser can do the job: read/bash for files, logs, process or file waiting, polling, and build/test verification; built-in browser tool for ordinary web work.
- Waiting, sleeping, polling logs, compiling, running tests, reading files, and ordinary web research are FORBIDDEN via computer — use read/bash or the browser tool instead.
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

/**
 * Resolve the exact Pi CLI tool-selection argument for one dispatched
 * subagent. This pure seam is shared by production and behavioral tests so a
 * stale JSON denylist cannot silently reintroduce a desktop-tool gate.
 */
export function resolveSubagentToolSelection({
	declaredTools,
	disabledTools,
	hasDesktopCapability,
	allowRecursiveDelegation,
}) {
	const disabled = new Set(sanitizeDisabledToolNames(disabledTools));
	if (Array.isArray(declaredTools) && declaredTools.length > 0) {
		const allowed = new Set(
			declaredTools.filter(
				(name) =>
					!disabled.has(name) &&
					(allowRecursiveDelegation || name !== "subagent"),
			),
		);
		if (hasDesktopCapability) {
			for (const name of RESERVED_DESKTOP_TOOL_NAMES) allowed.add(name);
		}
		return allowed.size > 0
			? { flag: "--tools", names: [...allowed] }
			: { flag: "--no-tools", names: [] };
	}

	if (!allowRecursiveDelegation) disabled.add("subagent");
	return {
		flag: "--exclude-tools",
		names: [...disabled].sort(),
	};
}
