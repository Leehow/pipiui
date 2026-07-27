export const RESERVED_DESKTOP_TOOL_NAMES = Object.freeze([
	"computer",
	"open_application",
]);

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
